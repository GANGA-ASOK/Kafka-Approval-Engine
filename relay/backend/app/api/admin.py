from typing import Literal

from fastapi import APIRouter, Depends, Query, status

from app.api.auth import create_user
from app.core.db import get_database
from app.core.rbac import require_admin
from app.events.publisher import EventPublisher
from app.models.audit import DeadLetter
from app.models.user import AdminUserCreate, UserInDB, UserResponse
from app.runtime import get_publisher
from app.services import dlq

# Every route in this router is ADMIN-only.
router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/dlq", response_model=list[DeadLetter])
async def list_dead_letters(
    status_: Literal["PENDING", "REPLAYED", "DISCARDED"] | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
):
    q = {"status": status_} if status_ else {}
    cursor = get_database().dead_letters.find(q).sort("failed_at", -1).limit(limit)
    return [DeadLetter.from_db(d) async for d in cursor]


@router.post("/dlq/{dl_id}/replay", response_model=DeadLetter)
async def replay_dead_letter(
    dl_id: str,
    admin: UserInDB = Depends(require_admin),
    publisher: EventPublisher = Depends(get_publisher),
):
    return DeadLetter.from_db(await dlq.replay(dl_id, admin, publisher))


@router.post("/dlq/{dl_id}/discard", response_model=DeadLetter)
async def discard_dead_letter(dl_id: str, admin: UserInDB = Depends(require_admin)):
    return DeadLetter.from_db(await dlq.discard(dl_id, admin))


@router.get("/users", response_model=list[UserResponse])
async def list_users():
    cursor = get_database().users.find({}).sort("email", 1)
    return [UserResponse.from_db(d) async for d in cursor]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_user(body: AdminUserCreate):
    return await create_user(
        email=body.email, password=body.password, name=body.name, role=body.role, department=body.department
    )
