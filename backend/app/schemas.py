from pydantic import BaseModel, EmailStr
from datetime import datetime
from app.models import UserRole


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.student


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
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
    id: int
    container_id: str
    name: str
    image: str
    status: str
    owner_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ContainerAction(BaseModel):
    action: str  # "start" | "stop" | "restart"
