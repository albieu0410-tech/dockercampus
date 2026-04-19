import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
import os

from app.database import get_db
from app.models import User, Container, ContainerStatus
from app.schemas import ContainerCreate, ContainerOut, ContainerAction
from app.auth import get_current_user

router = APIRouter(prefix="/containers", tags=["containers"])

RUST_SERVICE_URL = os.getenv("CONTAINER_ENGINE_URL", "http://container-engine:8001")


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
        "editor_url": f"https://dockcampus.sudelca.com/app/{container.user_id}",
    }


@router.get("/", response_model=list[ContainerOut])
async def list_containers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Container).where(Container.user_id == current_user.id)
    )
    containers = result.scalars().all()
    return [_serialize_container(container) for container in containers]


@router.post("/", response_model=ContainerOut, status_code=201)
async def create_container(
    body: ContainerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(
        select(Container).where(Container.user_id == current_user.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have a container")

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/create",
                json={
                    "user_id": str(current_user.id),
                    "memory_limit_mb": 512,
                    "cpu_limit": 0.5
                },
                timeout=30,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e.response.text}"
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Container engine error: {e}")

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
        raise HTTPException(status_code=500, detail="Failed to save container")


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
        raise HTTPException(status_code=404, detail="Container not found")

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
                f"{RUST_SERVICE_URL}/containers/{current_user.id}/{rust_action}",
                timeout=30,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Container engine error: {e.response.text}"
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Container engine error: {e}")

    container.status = ContainerStatus.running if body.action != "stop" else ContainerStatus.stopped
    await db.commit()
    return {"container_id": container_id, "status": body.action}


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
        raise HTTPException(status_code=404, detail="Container not found")

    async with httpx.AsyncClient() as client:
        try:
            await client.delete(
                f"{RUST_SERVICE_URL}/containers/{current_user.id}/delete",
                timeout=30,
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Container engine error: {e}")

    await db.delete(container)
    await db.commit()


@router.get("/proxy-info/{user_id}")
async def get_proxy_info(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Container).where(Container.user_id == user_id)
    )
    container = result.scalar_one_or_none()
    if not container or container.status != ContainerStatus.running:
        raise HTTPException(status_code=404, detail="No running container")
    return {"port": container.port}


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
    result = await db.execute(
        select(Container).where(Container.user_id == user_id)
    )
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    target_url = f"http://localhost:{container.port}/{path}"
    headers = dict(request.headers)
    headers.pop("host", None)

    async with httpx.AsyncClient() as client:
        resp = await client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=await request.body(),
            timeout=30,
        )
        return StreamingResponse(
            resp.aiter_bytes(),
            status_code=resp.status_code,
            headers=dict(resp.headers),
        )
