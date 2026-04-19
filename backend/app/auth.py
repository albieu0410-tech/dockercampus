from datetime import datetime, timedelta, timezone
from typing import Optional, Callable

import os
import random
import string
import uuid
import resend
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except Exception:
        return None


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = uuid.UUID(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_role(role: str) -> Callable:
    async def _role_check(current_user: User = Depends(get_current_user)) -> User:
        current_role = getattr(current_user.role, "value", str(current_user.role))
        if current_role != role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{role} only")
        return current_user

    return _role_check


async def require_professor(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "professor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Professors only")
    return current_user


def generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def send_otp_email(email: str, otp: str) -> None:
    if not settings.RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="Missing RESEND_API_KEY")

    resend.api_key = settings.RESEND_API_KEY
    resend.Emails.send(
        {
            "from": "DockCampus <noreply@dockcampus.sudelca.com>",
            "to": email,
            "subject": "Your DockCampus login code",
            "html": f"""
            <div style="font-family: monospace; max-width: 400px; margin: 0 auto; padding: 40px;">
                <h2 style="color: #f97316;">DockCampus</h2>
                <p>Your login code is:</p>
                <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #f97316; padding: 20px; background: #18181b; border-radius: 8px; text-align: center;">
                    {otp}
                </div>
                <p style="color: #71717a; font-size: 12px; margin-top: 20px;">
                    This code expires in 10 minutes. If you didn't request this, ignore this email.
                </p>
            </div>
            """,
        }
    )
