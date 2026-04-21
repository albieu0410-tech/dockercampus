from datetime import datetime
from typing import Optional

from sqlalchemy import (
    String, Boolean, DateTime, ForeignKey,
    Enum as PgEnum, Integer, Float, Text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
import enum
import uuid


class UserRole(str, enum.Enum):
    student = "student"
    professor = "professor"
    admin = "admin"


class ContainerStatus(str, enum.Enum):
    running = "running"
    stopped = "stopped"
    error = "error"
    sleeping = "sleeping"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    hashed_password: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    full_name: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    role: Mapped[UserRole] = mapped_column(
        PgEnum(UserRole, name="user_role", create_type=False),
        nullable=False,
        default=UserRole.student,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    # Security fields
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    locked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    password_reset_token: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    password_reset_expires: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    containers: Mapped[list["Container"]] = relationship(
        "Container", back_populates="owner"
    )
    class_memberships: Mapped[list["ClassMembership"]] = relationship(
        "ClassMembership", back_populates="user"
    )
    taught_classes: Mapped[list["Class"]] = relationship(
        "Class", back_populates="professor"
    )


class Container(Base):
    __tablename__ = "containers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    docker_container_id: Mapped[Optional[str]] = mapped_column(
        String(255), unique=True, nullable=True
    )
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ContainerStatus] = mapped_column(
        PgEnum(ContainerStatus, name="container_status", create_type=False),
        nullable=False,
        default=ContainerStatus.stopped,
    )
    cpu_limit: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.5
    )
    memory_limit_mb: Mapped[int] = mapped_column(
        Integer, nullable=False, default=512
    )
    last_activity: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    owner: Mapped["User"] = relationship("User", back_populates="containers")


class GithubConnection(Base):
    __tablename__ = "github_connections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False, unique=True
    )
    github_username: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    github_access_token: Mapped[str] = mapped_column(
        String, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    owner: Mapped["User"] = relationship("User")


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    container_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("containers.id"), nullable=False
    )
    repo_url: Mapped[str] = mapped_column(String(500), nullable=False)
    github_token: Mapped[Optional[str]] = mapped_column(
        String, nullable=True
    )
    detected_port: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    custom_port: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending"
    )
    build_logs: Mapped[Optional[str]] = mapped_column(
        String, nullable=True
    )
    public_url: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    owner: Mapped["User"] = relationship("User")
    container: Mapped["Container"] = relationship("Container")


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(
        String, unique=True, nullable=False, index=True
    )
    role: Mapped[UserRole] = mapped_column(
        PgEnum(UserRole, name="user_role", create_type=False),
        nullable=False,
        default=UserRole.student,
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    used_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )
    class_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("classes.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class OTPSession(Base):
    __tablename__ = "otp_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    otp_code: Mapped[str] = mapped_column(String(6), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class Class(Base):
    __tablename__ = "classes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    professor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    professor: Mapped["User"] = relationship(
        "User", back_populates="taught_classes"
    )
    memberships: Mapped[list["ClassMembership"]] = relationship(
        "ClassMembership", back_populates="class_"
    )


class ClassMembership(Base):
    __tablename__ = "class_memberships"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    class_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("classes.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    class_: Mapped["Class"] = relationship(
        "Class", back_populates="memberships"
    )
    user: Mapped["User"] = relationship(
        "User", back_populates="class_memberships"
    )
