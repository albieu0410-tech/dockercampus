import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    firebase_send_magic_link,
    firebase_verify_magic_link,
    require_role,
)
from app.database import get_db
from app.models import User, InviteCode
from app.schemas import (
    RegisterRequest,
    LoginRequest,
    LoginResponse,
    VerifyMagicLinkRequest,
    TokenResponse,
    UserOut,
    InviteCodeCreate,
    InviteCodeOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    invite_result = await db.execute(
        select(InviteCode).where(
            InviteCode.code == body.invite_code,
            InviteCode.is_used == False,
        )
    )
    invite = invite_result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid or already-used invite code")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invite code has expired")

    user_result = await db.execute(select(User).where(User.email == body.email))
    if user_result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=invite.role,
        is_verified=False,
    )
    db.add(user)
    await db.flush()

    invite.is_used = True
    invite.used_by = user.id

    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    await firebase_send_magic_link(user.email)
    return LoginResponse()


@router.post("/verify-magic-link", response_model=TokenResponse)
async def verify_magic_link(body: VerifyMagicLinkRequest, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(User).where(User.email == body.email))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    firebase_uid = await firebase_verify_magic_link(body.email, body.oob_code)

    if not user.is_verified:
        user.is_verified = True
        user.firebase_uid = firebase_uid

    await db.commit()

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token)


@router.post("/invite-codes", response_model=InviteCodeOut, status_code=status.HTTP_201_CREATED)
async def create_invite_code(
    body: InviteCodeCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    invite = InviteCode(code=secrets.token_urlsafe(16), role=body.role, expires_at=body.expires_at)
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


@router.get("/invite-codes", response_model=list[InviteCodeOut])
async def list_invite_codes(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    result = await db.execute(select(InviteCode).order_by(InviteCode.created_at.desc()))
    return result.scalars().all()
