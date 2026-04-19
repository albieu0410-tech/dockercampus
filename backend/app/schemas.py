from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional
from app.models import UserRole, ContainerStatus
import uuid


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    invite_code: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    access_token: Optional[str] = None
    otp_session_id: Optional[uuid.UUID] = None
    message: Optional[str] = None


class VerifyOTPRequest(BaseModel):
    otp_session_id: uuid.UUID
    otp_code: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ContainerCreate(BaseModel):
    name: str
    image: str


class ContainerOut(BaseModel):
    id: uuid.UUID
    docker_container_id: str | None
    port: int
    status: ContainerStatus
    cpu_limit: float
    memory_limit_mb: int
    user_id: uuid.UUID
    created_at: datetime
    editor_url: str | None = None

    model_config = {"from_attributes": True}


class ContainerAction(BaseModel):
    action: str  # "start" | "stop" | "restart"


class GithubConnectionOut(BaseModel):
    id: uuid.UUID
    github_username: str
    created_at: datetime
    model_config = {"from_attributes": True}


class DeploymentCreate(BaseModel):
    repo_url: str
    custom_port: int | None = None


class DeploymentOut(BaseModel):
    id: uuid.UUID
    repo_url: str
    detected_port: int | None
    custom_port: int | None
    status: str
    build_logs: str | None
    public_url: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class InviteCodeCreate(BaseModel):
    role: UserRole = UserRole.student
    expires_at: Optional[datetime] = None


class InviteCodeOut(BaseModel):
    id: uuid.UUID
    code: str
    role: UserRole
    is_used: bool
    expires_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}
