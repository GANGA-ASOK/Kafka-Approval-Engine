"""MongoDB access (motor) and index management."""

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from app.core.config import settings

log = logging.getLogger("relay.db")


class _MongoState:
    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None
    owned: bool = False


_state = _MongoState()


def set_client(client) -> None:
    """Inject a client (used by tests with mongomock-motor)."""
    _state.client = client
    _state.db = client[settings.DATABASE_NAME]
    _state.owned = False


async def connect_to_mongo() -> None:
    if _state.client is not None:
        return
    _state.client = AsyncIOMotorClient(
        settings.MONGODB_URL,
        tz_aware=True,
        serverSelectionTimeoutMS=3000,
        uuidRepresentation="standard",
    )
    _state.db = _state.client[settings.DATABASE_NAME]
    _state.owned = True


async def close_mongo_connection() -> None:
    if _state.client is not None and _state.owned:
        _state.client.close()
    _state.client = None
    _state.db = None


def get_database() -> AsyncIOMotorDatabase:
    if _state.db is None:
        raise RuntimeError("MongoDB is not initialised")
    return _state.db


async def ping() -> bool:
    try:
        await get_database().command("ping")
        return True
    except Exception:  # noqa: BLE001 - health probe
        return False


async def ensure_indexes() -> None:
    db = get_database()
    await db.users.create_index([("email", ASCENDING)], unique=True, name="uniq_email")

    await db.requests.create_index([("requester_id", ASCENDING), ("created_at", DESCENDING)])
    await db.requests.create_index([("status", ASCENDING), ("current_approver_role", ASCENDING)])
    await db.requests.create_index([("status", ASCENDING), ("sla_due_at", ASCENDING)])
    await db.requests.create_index([("created_at", DESCENDING)])

    await db.workflows.create_index([("request_type", ASCENDING), ("active", ASCENDING)])

    await db.audit_logs.create_index([("event_id", ASCENDING)], unique=True, name="uniq_event_id")
    await db.audit_logs.create_index([("request_id", ASCENDING), ("occurred_ts", ASCENDING)])
    await db.audit_logs.create_index([("occurred_ts", DESCENDING)])
    await db.audit_logs.create_index([("event_type", ASCENDING), ("occurred_ts", DESCENDING)])
    await db.audit_logs.create_index([("actor_id", ASCENDING), ("occurred_ts", DESCENDING)])
    await db.audit_logs.create_index([("requester_id", ASCENDING), ("occurred_ts", DESCENDING)])

    await db.processed_events.create_index(
        [("group", ASCENDING), ("event_id", ASCENDING)], unique=True, name="uniq_group_event"
    )
    await db.processed_events.create_index(
        [("processed_at", ASCENDING)], expireAfterSeconds=30 * 24 * 3600, name="ttl_processed_at"
    )

    await db.dead_letters.create_index([("status", ASCENDING), ("failed_at", DESCENDING)])
    await db.outbox.create_index([("created_at", ASCENDING)])
    log.info("MongoDB indexes ensured")
