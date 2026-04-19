import os
import re
import httpx
import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User, Container, Deployment, GithubConnection
from app.schemas import DeploymentCreate, DeploymentOut
from app.auth import get_current_user

router = APIRouter(prefix="/deployments", tags=["deployments"])

RUST_SERVICE_URL = os.getenv("CONTAINER_ENGINE_URL", "http://container-engine:8001")
BASE_URL = os.getenv("BASE_URL", "https://dockcampus.sudelca.com")


async def detect_port_from_dockerfile(dockerfile_content: str) -> int | None:
    match = re.search(r"EXPOSE\s+(\d+)", dockerfile_content, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


async def run_deployment(
    deployment_id: str,
    container_port: int,
    repo_url: str,
    github_token: str | None,
    custom_port: int | None,
    db: AsyncSession,
):
    result = await db.execute(
        select(Deployment).where(Deployment.id == deployment_id)
    )
    deployment = result.scalar_one_or_none()
    if not deployment:
        return

    logs = []

    try:
        deployment.status = "cloning"
        await db.commit()

        clone_url = repo_url
        if github_token and "github.com" in repo_url:
            clone_url = repo_url.replace(
                "https://", f"https://{github_token}@"
            )

        async with httpx.AsyncClient() as client:
            clone_resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/{deployment.user_id}/exec",
                json={
                    "command": f"git clone {clone_url} /home/coder/workspace/app && echo 'CLONE_SUCCESS'"
                },
                timeout=60,
            )
            clone_data = clone_resp.json()
            logs.append(f"Clone: {clone_data.get('output', '')}")

        deployment.status = "detecting"
        deployment.build_logs = "\n".join(logs)
        await db.commit()

        async with httpx.AsyncClient() as client:
            dockerfile_resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/{deployment.user_id}/exec",
                json={"command": "cat /home/coder/workspace/app/Dockerfile 2>/dev/null || echo 'NO_DOCKERFILE'"},
                timeout=10,
            )
            dockerfile_content = dockerfile_resp.json().get("output", "")

        detected_port = await detect_port_from_dockerfile(dockerfile_content)
        final_port = custom_port or detected_port or 3000

        deployment.detected_port = detected_port
        deployment.status = "building"
        deployment.build_logs = "\n".join(logs)
        await db.commit()

        async with httpx.AsyncClient() as client:
            build_resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/{deployment.user_id}/exec",
                json={
                    "command": "cd /home/coder/workspace/app && docker build -t student-app . 2>&1 || echo 'BUILD_FAILED'"
                },
                timeout=300,
            )
            build_output = build_resp.json().get("output", "")
            logs.append(f"Build: {build_output}")

        if "BUILD_FAILED" in build_output:
            deployment.status = "failed"
            deployment.build_logs = "\n".join(logs)
            await db.commit()
            return

        deployment.status = "starting"
        deployment.build_logs = "\n".join(logs)
        await db.commit()

        async with httpx.AsyncClient() as client:
            run_resp = await client.post(
                f"{RUST_SERVICE_URL}/containers/{deployment.user_id}/exec",
                json={
                    "command": f"docker run -d -p {final_port}:{final_port} --name student-app-{deployment.user_id} student-app 2>&1"
                },
                timeout=30,
            )
            run_output = run_resp.json().get("output", "")
            logs.append(f"Run: {run_output}")

        public_url = f"{BASE_URL}/app/{deployment.user_id}/proxy/{final_port}/"
        deployment.status = "running"
        deployment.public_url = public_url
        deployment.build_logs = "\n".join(logs)
        await db.commit()

    except Exception as e:
        deployment.status = "failed"
        logs.append(f"Error: {str(e)}")
        deployment.build_logs = "\n".join(logs)
        await db.commit()


@router.post("", response_model=DeploymentOut, status_code=201)
async def create_deployment(
    body: DeploymentCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    container_result = await db.execute(
        select(Container).where(Container.user_id == current_user.id)
    )
    container = container_result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="No container found — create one first")
    if container.status != "running":
        raise HTTPException(status_code=400, detail="Container is not running")

    github_result = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == current_user.id)
    )
    github_connection = github_result.scalar_one_or_none()
    github_token = github_connection.github_access_token if github_connection else None

    deployment = Deployment(
        user_id=current_user.id,
        container_id=container.id,
        repo_url=body.repo_url,
        github_token=github_token,
        custom_port=body.custom_port,
        status="pending",
    )
    db.add(deployment)
    await db.commit()
    await db.refresh(deployment)

    background_tasks.add_task(
        run_deployment,
        str(deployment.id),
        container.port,
        body.repo_url,
        github_token,
        body.custom_port,
        db,
    )

    return deployment


@router.get("", response_model=list[DeploymentOut])
async def list_deployments(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Deployment).where(Deployment.user_id == current_user.id)
    )
    return result.scalars().all()


@router.get("/{deployment_id}", response_model=DeploymentOut)
async def get_deployment(
    deployment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import uuid
    result = await db.execute(
        select(Deployment).where(
            Deployment.id == uuid.UUID(deployment_id),
            Deployment.user_id == current_user.id,
        )
    )
    deployment = result.scalar_one_or_none()
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment
