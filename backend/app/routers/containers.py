import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import os

from app.database import get_db
from app.models import User, Container
from app.schemas import ContainerCreate, ContainerOut, ContainerAction
from app.auth import get_current_user

router = APIRouter(prefix="/containers", tags=["containers"])

RUST_SERVICE_URL = os.getenv("RUST_SERVICE_URL", "http://container-engine:8001")


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
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{RUST_SERVICE_URL}/containers",
                json={"name": body.name, "image": body.image, "user_id": str(current_user.id)},
                timeout=10,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Rust service error: {e}")

    rust_data = resp.json()

    result = await db.execute(
        select(Container).where(Container.id == rust_data["id"])
    )
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=500, detail="Container created but not found in DB")
    return container


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

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/{container_id}/{body.action}",
                timeout=10,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Rust service error: {e}")

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
                f"{RUST_SERVICE_URL}/containers/{container_id}",
                timeout=10,
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Rust service error: {e}")

    await db.delete(container)
    await db.commit()
