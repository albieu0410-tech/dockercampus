from pydantic import BaseModel, EmailStr
from datetime import datetime
from app.models import UserRole
import uuid


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
    container_id: str
    name: str
    image: str
    status: str
    owner_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class ContainerAction(BaseModel):
    action: str
