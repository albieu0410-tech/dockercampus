from sqlalchemy import String, Boolean, DateTime, ForeignKey, Enum as PgEnum, Integer, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
import enum
import uuid


class UserRole(str, enum.Enum):
    student = "student"
    professor = "professor"


class ContainerStatus(str, enum.Enum):
    running = "running"
    stopped = "stopped"
    error = "error"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        PgEnum(UserRole, name="user_role", create_type=False), nullable=False, default=UserRole.student
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    containers: Mapped[list["Container"]] = relationship("Container", back_populates="owner")


class Container(Base):
    __tablename__ = "containers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    docker_container_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=True)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ContainerStatus] = mapped_column(
        PgEnum(ContainerStatus, name="container_status", create_type=False),
        nullable=False,
        default=ContainerStatus.stopped,
    )
    cpu_limit: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    memory_limit_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=512)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    owner: Mapped["User"] = relationship("User", back_populates="containers")
