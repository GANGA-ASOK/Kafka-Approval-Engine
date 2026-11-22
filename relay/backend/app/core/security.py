"""Password hashing (bcrypt, used directly - passlib is incompatible with bcrypt>=4.1) and JWTs."""

from datetime import timedelta

import bcrypt
import jwt

from app.core.clock import utcnow
from app.core.config import settings

# bcrypt only looks at the first 72 bytes and bcrypt>=5 raises for longer inputs.
MAX_PASSWORD_BYTES = 72


def get_password_hash(password: str) -> str:
    pw = password.encode("utf-8")
    if len(pw) > MAX_PASSWORD_BYTES:
        raise ValueError("Password must be at most 72 bytes")
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode("ascii")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    pw = plain_password.encode("utf-8")
    if len(pw) > MAX_PASSWORD_BYTES or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(pw, hashed_password.encode("ascii"))
    except ValueError:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    now = utcnow()
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode = {**data, "iat": now, "exp": expire}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None
