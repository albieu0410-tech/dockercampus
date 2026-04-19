import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import os

from app.database import get_db
from app.models import User, Container, ContainerStatus
from app.schemas import ContainerCreate, ContainerOut, ContainerAction
from app.auth import get_current_user

router = APIRouter(prefix="/containers", tags=["containers"])

RUST_SERVICE_URL = os.getenv("CONTAINER_ENGINE_URL", "http://container-engine:8001")


@router.get("/", response_model=list[ContainerOut])
async def list_containers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Container).where(Container.user_id == current_user.id)
    )
    return result.scalars().all()


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
    return new_container


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
