from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import get_database
from app.core.rbac import get_current_user
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.user import Role, TokenResponse, UserCreate, UserInDB, UserResponse
from app.services.seed import new_user_id

router = APIRouter()


async def create_user(*, email: str, password: str, name: str, role: Role, department: str | None) -> UserResponse:
    db = get_database()
    email = email.lower()
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    doc = {
        "_id": new_user_id(),
        "email": email,
        "password_hash": get_password_hash(password),
        "name": name.strip(),
        "role": role.value,
        "department": department,
        "created_at": utcnow(),
    }
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from None
    return UserResponse.from_db(doc)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserCreate):
    """Public sign-up always creates an EMPLOYEE (no privilege escalation)."""
    return await create_user(
        email=user_in.email, password=user_in.password, name=user_in.name,
        role=Role.EMPLOYEE, department=user_in.department,
    )


@router.post("/login", response_model=TokenResponse)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await get_database().users.find_one({"email": form_data.username.strip().lower()})
    if not user or not verify_password(form_data.password, user.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": user["_id"], "role": user["role"], "name": user["name"]})
    return TokenResponse(access_token=token, user=UserResponse.from_db(user))


@router.get("/me", response_model=UserResponse)
async def me(current_user: UserInDB = Depends(get_current_user)):
    return UserResponse.from_db(current_user)
