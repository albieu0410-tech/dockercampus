import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, Query
from fastapi.responses import StreamingResponse
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
import os
import websockets
from datetime import datetime

from app.database import get_db
from app.models import User, Container, ContainerStatus
from app.schemas import ContainerCreate, ContainerOut, ContainerAction
from app.auth import get_current_user

router = APIRouter(prefix="/containers", tags=["containers"])

RUST_SERVICE_URL = os.getenv(
    "CONTAINER_ENGINE_URL", "http://container-engine:8001"
)


def _serialize_container(container: Container) -> dict:
    return {
        "id": container.id,
        "docker_container_id": container.docker_container_id,
        "port": container.port,
        "status": container.status,
        "cpu_limit": container.cpu_limit,
        "memory_limit_mb": container.memory_limit_mb,
        "user_id": container.user_id,
        "created_at": container.created_at,
        "editor_url": (
            f"https://dockcampus.sudelca.com/app/{container.user_id}/"
        ),
    }


@router.get("", response_model=list[ContainerOut])
async def list_containers(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    offset = (page - 1) * limit
    result = await db.execute(
        select(Container)
        .where(Container.user_id == current_user.id)
        .offset(offset)
        .limit(limit)
    )
    containers = result.scalars().all()
    return [_serialize_container(c) for c in containers]


@router.post("", response_model=ContainerOut, status_code=201)
async def create_container(
    body: ContainerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(
        select(Container).where(Container.user_id == current_user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="You already have a container",
        )

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/create",
                json={
                    "user_id": str(current_user.id),
                    "memory_limit_mb": 512,
                    "cpu_limit": 0.5,
                },
                timeout=30,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e.response.text}",
            )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e}",
            )

    rust_data = resp.json()

    try:
        new_container = Container(
            user_id=current_user.id,
            docker_container_id=rust_data["container_id"],
            port=rust_data["port"],
            status=ContainerStatus.running,
            cpu_limit=0.5,
            memory_limit_mb=512,
        )
        db.add(new_container)
        await db.commit()
        await db.refresh(new_container)
        return _serialize_container(new_container)
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(Container).where(
                Container.docker_container_id == rust_data["container_id"]
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            return _serialize_container(existing)
        raise HTTPException(
            status_code=500,
            detail="Failed to save container",
        )


@router.post("/{container_id}/action")
async def container_action(
    container_id: str,
    body: ContainerAction,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Container).where(
            Container.id == container_id,
            Container.user_id == current_user.id,
        )
    )
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(
            status_code=404,
            detail="Container not found",
        )

    action_map = {
        "start": "start",
        "stop": "stop",
        "restart": "start",
    }
    rust_action = action_map.get(body.action)
    if not rust_action:
        raise HTTPException(status_code=400, detail="Invalid action")

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{RUST_SERVICE_URL}/containers"
                f"/{current_user.id}/{rust_action}",
                timeout=30,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e.response.text}",
            )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e}",
            )

    new_status = (
        ContainerStatus.running
        if body.action != "stop"
        else ContainerStatus.stopped
    )
    container.status = new_status

    if body.action != "stop":
        container.last_activity = datetime.utcnow()

    await db.commit()
    return {"container_id": container_id, "status": body.action}


@router.post("/{user_id}/wake")
async def wake_container(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    import uuid as uuid_module
    try:
        uid = uuid_module.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    result = await db.execute(
        select(Container).where(
            Container.user_id == uid,
            Container.status == ContainerStatus.sleeping,
        )
    )
    container = result.scalar_one_or_none()

    if not container:
        return {"status": "not_sleeping"}

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/{user_id}/start",
                timeout=15,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to wake container: {e}",
            )

    container.status = ContainerStatus.running
    container.last_activity = datetime.utcnow()
    await db.commit()

    return {"status": "awake"}


@router.delete("/{container_id}", status_code=204)
async def delete_container(
    container_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Container).where(
            Container.id == container_id,
            Container.user_id == current_user.id,
        )
    )
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(
            status_code=404,
            detail="Container not found",
        )

    async with httpx.AsyncClient() as client:
        try:
            await client.delete(
                f"{RUST_SERVICE_URL}/containers"
                f"/{current_user.id}/delete",
                timeout=30,
            )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e}",
            )

    await db.delete(container)
    await db.commit()


@router.get("/proxy-info/{user_id}")
async def get_proxy_info(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    import uuid as uuid_module
    try:
        uid = uuid_module.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    result = await db.execute(
        select(Container).where(Container.user_id == uid)
    )
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="No container found")
    return {"port": container.port, "status": container.status}


@router.api_route(
    "/app/{user_id}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def proxy_to_container(
    user_id: str,
    path: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    import uuid as uuid_module
    try:
        uid = uuid_module.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    result = await db.execute(
        select(Container).where(Container.user_id == uid)
    )
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(
            status_code=404,
            detail="Container not found",
        )

    if container.status == ContainerStatus.sleeping:
        # Update last_activity and trigger wake
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"http://localhost:8000/containers/{user_id}/wake",
                    timeout=10,
                )
            except Exception:
                pass
        raise HTTPException(
            status_code=503,
            detail="Container is waking up. Please try again in a few seconds.",
        )

    if container.status != ContainerStatus.running:
        raise HTTPException(
            status_code=503,
            detail="Container is not running",
        )

    # Update last activity
    await db.execute(
        update(Container)
        .where(Container.user_id == uid)
        .values(last_activity=datetime.utcnow())
    )
    await db.commit()

    target_url = f"http://host.docker.internal:{container.port}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    async with httpx.AsyncClient(follow_redirects=True) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers={
                    k: v
                    for k, v in request.headers.items()
                    if k.lower() not in ["host", "content-length"]
                },
                content=await request.body(),
                timeout=30,
            )
            excluded_headers = ["transfer-encoding"]
            headers = {
                k: v
                for k, v in resp.headers.items()
                if k.lower() not in excluded_headers
            }
            return StreamingResponse(
                content=resp.aiter_bytes(),
                status_code=resp.status_code,
                headers=headers,
            )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Proxy error: {e}",
            )


@router.websocket("/app/{user_id}/{path:path}")
async def proxy_websocket(
    websocket: WebSocket,
    user_id: str,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    import uuid as uuid_module
    try:
        uid = uuid_module.UUID(user_id)
    except ValueError:
        await websocket.close(code=4000)
        return

    result = await db.execute(
        select(Container).where(Container.user_id == uid)
    )
    container = result.scalar_one_or_none()
    if not container:
        await websocket.close(code=4004)
        return

    await websocket.accept()

    target_url = (
        f"ws://host.docker.internal:{container.port}/{path}"
    )
    if websocket.url.query:
        target_url += f"?{websocket.url.query}"

    try:
        async with websockets.connect(target_url) as ws:
            async def forward():
                async for message in websocket.iter_bytes():
                    await ws.send(message)

            async def backward():
                async for message in ws:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            import asyncio
            await asyncio.gather(forward(), backward())
    except WebSocketDisconnect:
        return
    except Exception:
        await websocket.close()
