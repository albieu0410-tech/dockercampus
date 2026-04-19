import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import User, GithubConnection
from app.schemas import GithubConnectionOut
from app.auth import get_current_user, verify_token

router = APIRouter(prefix="/auth/github", tags=["github"])

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", "https://api.sudelca.com/auth/github/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://dockcampus.sudelca.com")


@router.get("/login")
async def github_login(token: str, db: AsyncSession = Depends(get_db)):
    user_id = verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    github_auth_url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&redirect_uri={GITHUB_REDIRECT_URI}"
        f"&scope=repo,read:user"
        f"&state={user_id}"
    )
    return RedirectResponse(url=github_auth_url)


@router.get("/callback")
async def github_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": GITHUB_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
        )
        token_data = token_resp.json()

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Failed to get GitHub access token")

    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )
        github_user = user_resp.json()

    github_username = github_user.get("login")
    import uuid
    user_id = uuid.UUID(state)

    result = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == user_id)
    )
    connection = result.scalar_one_or_none()

    if connection:
        connection.github_access_token = access_token
        connection.github_username = github_username
    else:
        connection = GithubConnection(
            user_id=user_id,
            github_username=github_username,
            github_access_token=access_token,
        )
        db.add(connection)

    await db.commit()

    return RedirectResponse(url=f"{FRONTEND_URL}/dashboard?github=connected")


@router.get("/status", response_model=GithubConnectionOut | None)
async def github_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == current_user.id)
    )
    return result.scalar_one_or_none()


@router.get("/repos")
async def list_repos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GithubConnection).where(GithubConnection.user_id == current_user.id)
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="GitHub not connected")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.github.com/user/repos?sort=updated&per_page=30",
            headers={
                "Authorization": f"Bearer {connection.github_access_token}",
                "Accept": "application/json",
            },
        )
        repos = resp.json()

    return [
        {
            "name": r["name"],
            "full_name": r["full_name"],
            "url": r["clone_url"],
            "private": r["private"],
            "description": r.get("description"),
            "updated_at": r["updated_at"],
        }
        for r in repos
    ]
