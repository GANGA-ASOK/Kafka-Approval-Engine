from enum import StrEnum

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Role(StrEnum):
    EMPLOYEE = "EMPLOYEE"
    MANAGER = "MANAGER"
    FINANCE = "FINANCE"
    DIRECTOR = "DIRECTOR"
    ADMIN = "ADMIN"


ROLE_RANK = {r: i for i, r in enumerate(Role)}
APPROVER_ROLES = (Role.MANAGER, Role.FINANCE, Role.DIRECTOR, Role.ADMIN)


def _password_bytes(v: str) -> str:
    if len(v.encode("utf-8")) > 72:
        raise ValueError("password must be at most 72 bytes")
    return v


class UserCreate(BaseModel):
    """Public registration. Any `role` sent by the client is ignored (always EMPLOYEE)."""

    model_config = ConfigDict(extra="ignore")

    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=120)
    department: str | None = Field(default=None, max_length=120)

    _pw = field_validator("password")(_password_bytes)


class AdminUserCreate(UserCreate):
    role: Role = Role.EMPLOYEE


class UserInDB(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(alias="_id")
    email: EmailStr
    password_hash: str
    name: str
    role: Role
    department: str | None = None


class UserResponse(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: Role
    department: str | None = None

    @classmethod
    def from_db(cls, user: "UserInDB | dict") -> "UserResponse":
        if isinstance(user, dict):
            user = UserInDB.model_validate(user)
        return cls(id=user.id, email=user.email, name=user.name, role=user.role, department=user.department)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
