import secrets
import os
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Request
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
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.limiter import limiter

router = APIRouter(prefix="/auth", tags=["auth"])

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

ALLOWED_DOMAINS = [
    d.strip()
    for d in os.getenv("ALLOWED_EMAIL_DOMAINS", "").split(",")
    if d.strip()
]

PASSWORD_REGEX = re.compile(
    r'^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};:\'"'
    r'",.<>?/\\|`~]).{8,}$'
)


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("3/minute")
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    if ALLOWED_DOMAINS:
        domain = body.email.split("@")[-1]
        if domain not in ALLOWED_DOMAINS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Email domain not allowed. "
                    f"Allowed: {', '.join(ALLOWED_DOMAINS)}"
                ),
            )

    if not PASSWORD_REGEX.match(body.password):
        raise HTTPException(
            status_code=400,
            detail=(
                "Password must be at least 8 characters and include "
                "an uppercase letter, a number, and a special character."
            ),
        )

    invite_result = await db.execute(
        select(InviteCode).where(
            InviteCode.code == body.invite_code,
            InviteCode.is_used == False,
        )
    )
    invite = invite_result.scalar_one_or_none()
    if not invite:
        raise HTTPException(
            status_code=400,
            detail="Invalid or already-used invite code",
        )
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="Invite code has expired",
        )

    user_result = await db.execute(
        select(User).where(User.email == body.email)
    )
    if user_result.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Email already registered",
        )

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
@limiter.limit("5/minute")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.email == body.email)
    )
    user = result.scalar_one_or_none()

    # Check lockout before anything else
    if user and user.locked_until:
        if user.locked_until > datetime.utcnow():
            remaining = (
                user.locked_until - datetime.utcnow()
            ).seconds // 60
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Account locked. "
                    f"Try again in {remaining} minute(s)."
                ),
            )
        else:
            # Lockout expired, reset
            user.locked_until = None
            user.failed_login_attempts = 0
            await db.commit()

    if not user or not verify_password(
        body.password, user.hashed_password
    ):
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_LOGIN_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(
                    minutes=LOCKOUT_MINUTES
                )
            await db.commit()
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="Account is disabled",
        )

    # Successful login — reset failure counter
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()

    if user.is_verified:
        token = create_access_token({"sub": str(user.id)})
        return LoginResponse(access_token=token)

    # Not verified yet — send OTP
    otp = generate_otp()
    send_otp_email(user.email, otp)

    existing = await db.execute(
        select(OTPSession).where(OTPSession.user_id == user.id)
    )
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
@limiter.limit("10/minute")
async def verify_otp(
    request: Request,
    body: VerifyOTPRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(OTPSession).where(OTPSession.id == body.otp_session_id)
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=404,
            detail="OTP session not found",
        )
    if session.expires_at < datetime.utcnow():
        await db.delete(session)
        await db.commit()
        raise HTTPException(
            status_code=410,
            detail="OTP expired. Please log in again.",
        )
    if session.attempts >= MAX_ATTEMPTS:
        await db.delete(session)
        await db.commit()
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please log in again.",
        )

    if body.otp_code != session.otp_code:
        session.attempts += 1
        await db.commit()
        remaining = MAX_ATTEMPTS - session.attempts
        raise HTTPException(
            status_code=401,
            detail=f"Invalid code. {remaining} attempt(s) remaining.",
        )

    user_result = await db.execute(
        select(User).where(User.id == session.user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.is_verified:
        user.is_verified = True

    await db.delete(session)
    await db.commit()

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token)


@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.email == body.email)
    )
    user = result.scalar_one_or_none()

    # Always return the same response
    # Never reveal whether the email exists
    if user and user.is_active:
        token = secrets.token_urlsafe(32)
        user.password_reset_token = token
        user.password_reset_expires = datetime.utcnow() + timedelta(
            hours=1
        )
        await db.commit()

        frontend_url = os.getenv(
            "FRONTEND_URL", "https://dockcampus.sudelca.com"
        )
        reset_link = f"{frontend_url}/reset-password?token={token}"
        _send_password_reset_email(user.email, reset_link)

    return {
        "message": (
            "If that email exists, a reset link has been sent."
        )
    }


@router.post("/reset-password")
@limiter.limit("5/minute")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    if not PASSWORD_REGEX.match(body.new_password):
        raise HTTPException(
            status_code=400,
            detail=(
                "Password must be at least 8 characters and include "
                "an uppercase letter, a number, and a special character."
            ),
        )

    result = await db.execute(
        select(User).where(
            User.password_reset_token == body.token,
        )
    )
    user = result.scalar_one_or_none()

    if not user or not user.password_reset_expires:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired reset token",
        )

    if user.password_reset_expires < datetime.utcnow():
        user.password_reset_token = None
        user.password_reset_expires = None
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="Reset token has expired. Please request a new one.",
        )

    user.hashed_password = hash_password(body.new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()

    return {"message": "Password updated successfully"}


@router.post(
    "/invite-codes",
    response_model=InviteCodeOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite_code(
    body: InviteCodeCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    invite = InviteCode(
        code=secrets.token_urlsafe(16),
        role=body.role,
        expires_at=body.expires_at,
        class_id=body.class_id,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


@router.get("/invite-codes", response_model=list[InviteCodeOut])
async def list_invite_codes(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    result = await db.execute(
        select(InviteCode).order_by(InviteCode.created_at.desc())
    )
    return result.scalars().all()


def _send_password_reset_email(email: str, reset_link: str) -> None:
    import resend
    from app.config import settings

    if not settings.RESEND_API_KEY:
        return

    resend.api_key = settings.RESEND_API_KEY
    resend.Emails.send(
        {
            "from": "DockCampus <noreply@dockcampus.sudelca.com>",
            "to": email,
            "subject": "Reset your DockCampus password",
            "html": f"""
            <div style="font-family: monospace; max-width: 400px;
                        margin: 0 auto; padding: 40px;">
                <h2 style="color: #f97316;">DockCampus</h2>
                <p>Click the link below to reset your password:</p>
                <a href="{reset_link}"
                   style="display: inline-block; margin: 20px 0;
                          padding: 12px 24px; background: #f97316;
                          color: white; text-decoration: none;
                          border-radius: 6px;">
                    Reset Password
                </a>
                <p style="color: #71717a; font-size: 12px;">
                    This link expires in 1 hour.
                    If you didn't request this, ignore this email.
                </p>
            </div>
            """,
        }
    )
