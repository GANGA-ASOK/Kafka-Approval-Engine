from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from app.models.user import UserCreate, UserLogin, UserResponse, UserInDB
from app.core.security import get_password_hash, verify_password, create_access_token, decode_access_token
from app.core.db import get_database
import uuid

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    
    db = get_database()
    user_data = await db.users.find_one({"_id": payload["sub"]})
    if not user_data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    
    return UserInDB(**user_data)

@router.post("/register", response_model=UserResponse)
async def register(user_in: UserCreate):
    db = get_database()
    existing_user = await db.users.find_one({"email": user_in.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = f"USER-{uuid.uuid4().hex[:8].upper()}"
    hashed_password = get_password_hash(user_in.password)
    
    user_dict = {
        "_id": user_id,
        "email": user_in.email,
        "password_hash": hashed_password,
        "name": user_in.name,
        "role": user_in.role.value
    }
    
    await db.users.insert_one(user_dict)
    
    return UserResponse(
        id=user_id,
        email=user_dict["email"],
        name=user_dict["name"],
        role=user_dict["role"]
    )

@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    db = get_database()
    user = await db.users.find_one({"email": form_data.username})
    
    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
    access_token = create_access_token(data={"sub": user["_id"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: UserInDB = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        role=current_user.role
    )
