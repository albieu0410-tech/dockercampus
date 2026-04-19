from datetime import datetime, timedelta, timezone
from typing import Optional, Callable

import firebase_admin
import httpx
import os
import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from firebase_admin import credentials
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


def _ensure_firebase_initialized() -> None:
    if firebase_admin._apps:
        return
    if not settings.GOOGLE_APPLICATION_CREDENTIALS:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_APPLICATION_CREDENTIALS")
    cred = credentials.Certificate(settings.GOOGLE_APPLICATION_CREDENTIALS)
    firebase_admin.initialize_app(cred)


async def firebase_send_otp(email: str) -> str:
    _ensure_firebase_initialized()
    if not settings.FIREBASE_API_KEY:
        raise HTTPException(status_code=500, detail="Missing FIREBASE_API_KEY")

    url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={settings.FIREBASE_API_KEY}"
    payload = {
        "requestType": "EMAIL_SIGNIN",
        "email": email,
        "canHandleCodeInApp": True,
        "continueUrl": "https://dockcampus.sudelca.com/login",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Firebase OTP send failed: {resp.text}")
    session_info = resp.json().get("sessionInfo", "")
    if not session_info:
        raise HTTPException(status_code=502, detail="Firebase returned no sessionInfo")
    return session_info


async def firebase_verify_otp(session_info: str, otp_code: str, email: str) -> str:
    _ensure_firebase_initialized()
    if not settings.FIREBASE_API_KEY:
        raise HTTPException(status_code=500, detail="Missing FIREBASE_API_KEY")

    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key={settings.FIREBASE_API_KEY}"
    payload = {"email": email, "oobCode": otp_code, "sessionInfo": session_info}
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        error_msg = resp.json().get("error", {}).get("message", resp.text)
        raise HTTPException(status_code=401, detail=f"OTP verification failed: {error_msg}")
    local_id = resp.json().get("localId", "")
    if not local_id:
        raise HTTPException(status_code=502, detail="Firebase returned no localId")
    return local_id
