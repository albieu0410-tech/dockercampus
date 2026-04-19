import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    generate_otp,
    send_otp_email,
    require_role,
)
from app.database import get_db
from app.models import User, InviteCode, OTPSession
from app.schemas import (
    RegisterRequest,
    LoginRequest,
    LoginResponse,
    VerifyOTPRequest,
    TokenResponse,
    UserOut,
    InviteCodeCreate,
    InviteCodeOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])
OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5

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

    if user.is_verified:
        token = create_access_token({"sub": str(user.id)})
        return LoginResponse(access_token=token)

    otp = generate_otp()
    send_otp_email(user.email, otp)

    existing = await db.execute(select(OTPSession).where(OTPSession.user_id == user.id))
    for session in existing.scalars().all():
        await db.delete(session)

    otp_session = OTPSession(
        user_id=user.id,
        otp_code=otp,
        expires_at=datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES),
    )
    db.add(otp_session)
    await db.commit()
    await db.refresh(otp_session)

    return LoginResponse(
        otp_session_id=otp_session.id,
        message="Check your email for a 6-digit code.",
    )


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(body: VerifyOTPRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(OTPSession).where(OTPSession.id == body.otp_session_id))
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="OTP session not found")
    if session.expires_at < datetime.utcnow():
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=410, detail="OTP expired. Please log in again.")
    if session.attempts >= MAX_ATTEMPTS:
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=429, detail="Too many attempts. Please log in again.")

    if body.otp_code != session.otp_code:
        session.attempts += 1
        await db.commit()
        remaining = MAX_ATTEMPTS - session.attempts
        raise HTTPException(status_code=401, detail=f"Invalid code. {remaining} attempt(s) remaining.")

    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.is_verified:
        user.is_verified = True

    await db.delete(session)
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
