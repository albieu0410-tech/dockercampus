import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_role
from app.database import get_db
from app.models import Class, ClassMembership, User
from app.schemas import (
    ClassCreate,
    ClassOut,
    ClassMembershipCreate,
    ClassMembershipOut,
    UserOut,
)

router = APIRouter(prefix="/classes", tags=["classes"])


@router.post("", response_model=ClassOut, status_code=201)
async def create_class(
    body: ClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("professor")),
):
    class_ = Class(
        name=body.name,
        description=body.description,
        professor_id=current_user.id,
    )
    db.add(class_)
    await db.commit()
    await db.refresh(class_)
    return class_


@router.get("", response_model=list[ClassOut])
async def list_classes(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    offset = (page - 1) * limit

    if current_user.role.value in ("professor", "admin"):
        result = await db.execute(
            select(Class)
            .where(Class.professor_id == current_user.id)
            .offset(offset)
            .limit(limit)
        )
    else:
        result = await db.execute(
            select(Class)
            .join(
                ClassMembership,
                ClassMembership.class_id == Class.id,
            )
            .where(ClassMembership.user_id == current_user.id)
            .offset(offset)
            .limit(limit)
        )

    return result.scalars().all()


@router.get("/{class_id}", response_model=ClassOut)
async def get_class(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Class).where(Class.id == class_id)
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    if (
        current_user.role.value == "professor"
        and class_.professor_id != current_user.id
    ):
        raise HTTPException(status_code=403, detail="Not your class")

    return class_


@router.patch("/{class_id}", response_model=ClassOut)
async def update_class(
    class_id: uuid.UUID,
    body: ClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("professor")),
):
    result = await db.execute(
        select(Class).where(
            Class.id == class_id,
            Class.professor_id == current_user.id,
        )
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    class_.name = body.name
    if body.description is not None:
        class_.description = body.description

    await db.commit()
    await db.refresh(class_)
    return class_


@router.delete("/{class_id}", status_code=204)
async def delete_class(
    class_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("professor")),
):
    result = await db.execute(
        select(Class).where(
            Class.id == class_id,
            Class.professor_id == current_user.id,
        )
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    await db.delete(class_)
    await db.commit()


@router.get(
    "/{class_id}/students",
    response_model=list[UserOut],
)
async def list_class_students(
    class_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("professor")),
):
    result = await db.execute(
        select(Class).where(
            Class.id == class_id,
            Class.professor_id == current_user.id,
        )
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    offset = (page - 1) * limit
    students_result = await db.execute(
        select(User)
        .join(
            ClassMembership,
            ClassMembership.user_id == User.id,
        )
        .where(ClassMembership.class_id == class_id)
        .offset(offset)
        .limit(limit)
    )
    return students_result.scalars().all()


@router.post(
    "/{class_id}/students",
    response_model=ClassMembershipOut,
    status_code=201,
)
async def add_student_to_class(
    class_id: uuid.UUID,
    body: ClassMembershipCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("professor")),
):
    result = await db.execute(
        select(Class).where(
            Class.id == class_id,
            Class.professor_id == current_user.id,
        )
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    user_result = await db.execute(
        select(User).where(User.id == body.user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = await db.execute(
        select(ClassMembership).where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="User already in this class",
        )

    membership = ClassMembership(
        class_id=class_id,
        user_id=body.user_id,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return membership


@router.delete(
    "/{class_id}/students/{user_id}",
    status_code=204,
)
async def remove_student_from_class(
    class_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("professor")),
):
    result = await db.execute(
        select(Class).where(
            Class.id == class_id,
            Class.professor_id == current_user.id,
        )
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        raise HTTPException(status_code=404, detail="Class not found")

    membership_result = await db.execute(
        select(ClassMembership).where(
            ClassMembership.class_id == class_id,
            ClassMembership.user_id == user_id,
        )
    )
    membership = membership_result.scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=404,
            detail="Student not in this class",
        )

    await db.delete(membership)
    await db.commit()
