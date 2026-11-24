"""Idempotent seeding of the default workflow and demo users (CONTRACT sections 2 and 3)."""

import logging
import uuid

from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import get_database
from app.core.security import get_password_hash
from app.workflow.rules import DEFAULT_WORKFLOW_ID, default_workflow_document

log = logging.getLogger("relay.seed")

DEMO_PASSWORD = "Relay@123"
DEMO_USERS = [
    {"email": "employee@relay.dev", "name": "Esha Employee", "role": "EMPLOYEE", "department": "Engineering"},
    {"email": "manager@relay.dev", "name": "Manoj Manager", "role": "MANAGER", "department": "Engineering"},
    {"email": "finance@relay.dev", "name": "Farah Finance", "role": "FINANCE", "department": "Finance"},
    {"email": "director@relay.dev", "name": "Dev Director", "role": "DIRECTOR", "department": "Leadership"},
    {"email": "admin@relay.dev", "name": "Ada Admin", "role": "ADMIN", "department": "Operations"},
]


def new_user_id() -> str:
    return f"USER-{uuid.uuid4().hex[:8].upper()}"


async def seed_default_workflow() -> None:
    db = get_database()
    # $setOnInsert: never overwrite an admin's edits on restart.
    res = await db.workflows.update_one(
        {"_id": DEFAULT_WORKFLOW_ID},
        {"$setOnInsert": {k: v for k, v in default_workflow_document(utcnow()).items() if k != "_id"}},
        upsert=True,
    )
    if res.upserted_id:
        log.info("Seeded default workflow %s", DEFAULT_WORKFLOW_ID)


async def seed_demo_users() -> None:
    db = get_database()
    for u in DEMO_USERS:
        if await db.users.find_one({"email": u["email"]}, {"_id": 1}):
            continue
        try:
            await db.users.insert_one(
                {"_id": new_user_id(), **u, "password_hash": get_password_hash(DEMO_PASSWORD), "created_at": utcnow()}
            )
            log.info("Seeded demo user %s (%s)", u["email"], u["role"])
        except DuplicateKeyError:
            pass  # another process seeded it concurrently


async def seed_all(include_demo_users: bool) -> None:
    await seed_default_workflow()
    if include_demo_users:
        await seed_demo_users()
