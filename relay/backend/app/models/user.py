from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from enum import Enum

class Role(str, Enum):
    EMPLOYEE = "EMPLOYEE"
    MANAGER = "MANAGER"
    FINANCE = "FINANCE"
    DIRECTOR = "DIRECTOR"
    ADMIN = "ADMIN"

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Role = Role.EMPLOYEE

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserInDB(BaseModel):
    id: str = Field(alias="_id")
    email: EmailStr
    password_hash: str
    name: str
    role: Role

class UserResponse(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: Role
