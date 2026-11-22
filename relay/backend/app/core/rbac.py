"""Authentication + role-based access control dependencies."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.db import get_database
from app.core.security import decode_access_token
from app.models.user import APPROVER_ROLES, Role, UserInDB

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInDB:
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise _UNAUTHORIZED
    user = await get_database().users.find_one({"_id": payload["sub"]})
    if not user:
        raise _UNAUTHORIZED
    # The role is read from the database (not the token) so role changes apply immediately.
    return UserInDB.model_validate(user)


def require_roles(*roles: Role | str) -> Callable[..., Coroutine[Any, Any, UserInDB]]:
    """Dependency factory: `Depends(require_roles(Role.ADMIN))` -> 403 unless the user has one of `roles`."""
    allowed = {Role(r) for r in roles}

    async def _dependency(user: UserInDB = Depends(get_current_user)) -> UserInDB:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(sorted(r.value for r in allowed))}",
            )
        return user

    return _dependency


require_admin = require_roles(Role.ADMIN)
require_approver = require_roles(*APPROVER_ROLES)


def is_approver(user: UserInDB) -> bool:
    return user.role in APPROVER_ROLES
