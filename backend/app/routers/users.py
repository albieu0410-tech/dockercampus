import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    get_current_user,
    hash_password,
    require_professor,
    verify_password,
)
from app.database import get_db
from app.models import User, Class, ClassMembership
from app.schemas import (
    ChangePasswordRequest,
    UpdateProfileRequest,
    UpdateUserRequest,
    UserOut,
)

router = APIRouter(prefix="/users", tags=["users"])

PASSWORD_REGEX = re.compile(
    r'^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};:\'"'
    r'",.<>?/\\|`~]).{8,}$'
)


def validate_password(password: str):
    if not PASSWORD_REGEX.match(password):
        raise HTTPException(
            status_code=400,
            detail=(
                "Password must be at least 8 characters and include "
                "an uppercase letter, a number, and a special character."
            ),
        )


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
async def update_profile(
    body: UpdateProfileRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.full_name is not None:
        current_user.full_name = body.full_name
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/me/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(
        body.current_password, current_user.hashed_password
    ):
        raise HTTPException(
            status_code=401,
            detail="Current password is incorrect",
        )
    validate_password(body.new_password)
    current_user.hashed_password = hash_password(body.new_password)
    await db.commit()
    return {"message": "Password updated successfully"}


@router.delete("/me", status_code=204)
async def delete_account(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value == "admin":
        raise HTTPException(
            status_code=400,
            detail="Admin accounts cannot be self-deleted",
        )
    await db.delete(current_user)
    await db.commit()


@router.get("", response_model=list[UserOut])
async def list_users(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value not in ("admin", "professor"):
        raise HTTPException(
            status_code=403,
            detail="Insufficient permissions",
        )
    offset = (page - 1) * limit
    result = await db.execute(
        select(User).offset(offset).limit(limit)
    )
    return result.scalars().all()


@router.get("/students", response_model=list[UserOut])
async def list_students(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, le=100),
    class_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_professor),
):
    offset = (page - 1) * limit

    if class_id:
        # Verify professor owns this class
        class_result = await db.execute(
            select(Class).where(
                Class.id == class_id,
                Class.professor_id == current_user.id,
            )
        )
        class_ = class_result.scalar_one_or_none()
        if not class_:
            raise HTTPException(
                status_code=404,
                detail="Class not found",
            )

        result = await db.execute(
            select(User)
            .join(
                ClassMembership,
                ClassMembership.user_id == User.id,
            )
            .where(ClassMembership.class_id == class_id)
            .offset(offset)
            .limit(limit)
        )
    else:
        # All students in any of this professor's classes
        result = await db.execute(
            select(User)
            .join(
                ClassMembership,
                ClassMembership.user_id == User.id,
            )
            .join(
                Class,
                Class.id == ClassMembership.class_id,
            )
            .where(
                Class.professor_id == current_user.id,
                User.role == "student",
            )
            .distinct()
            .offset(offset)
            .limit(limit)
        )

    return result.scalars().all()


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    await db.commit()
    await db.refresh(user)
    return user
