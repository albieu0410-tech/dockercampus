from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import User
from schemas import UserOut
from auth import get_current_user, require_professor

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_professor),
):
    result = await db.execute(select(User))
    return result.scalars().all()


@router.get("/students", response_model=list[UserOut])
async def list_students(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_professor),
):
    result = await db.execute(select(User).where(User.role == "student"))
    return result.scalars().all()