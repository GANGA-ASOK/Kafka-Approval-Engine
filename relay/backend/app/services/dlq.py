"""Dead-letter administration: replay (re-publish with a new event_id) or discard."""

import uuid
from typing import Any

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from app.core.clock import utcnow
from app.core.db import get_database
from app.events.envelope import MAIN_TOPIC, EventEnvelope, EventType, Source, actor_from_user, new_event
from app.events.publisher import EventPublisher
from app.models.user import UserInDB


async def _claim(dl_id: str, new_status: str, extra: dict[str, Any]) -> dict[str, Any]:
    db = get_database()
    doc = await db.dead_letters.find_one_and_update(
        {"_id": dl_id, "status": "PENDING"},
        {"$set": {"status": new_status, **extra}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        existing = await db.dead_letters.find_one({"_id": dl_id}, {"status": 1})
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dead letter not found")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Dead letter is already {existing['status']}")
    return doc


async def replay(dl_id: str, admin: UserInDB, publisher: EventPublisher) -> dict[str, Any]:
    new_event_id = str(uuid.uuid4())
    doc = await _claim(dl_id, "REPLAYED",
                       {"replayed_at": utcnow(), "replayed_by": admin.id, "replay_event_id": new_event_id})
    original = EventEnvelope.model_validate(doc["event"])
    replayed = original.model_copy(
        update={
            "event_id": new_event_id,
            "attempt": 0,
            "retry_at": None,
            "last_error": None,
            "target_group": None,
            "occurred_at": utcnow(),
            # `replayed=true` bypasses the `[fail]` fault injection in the workflow engine.
            "payload": {**original.payload, "replayed": True, "replay_of": original.event_id,
                        "dead_letter_id": dl_id},
        }
    )
    await publisher.publish(MAIN_TOPIC, replayed)
    await publisher.publish(
        MAIN_TOPIC,
        new_event(
            EventType.EVENT_REPLAYED,
            original.request_id,
            source=Source.API,
            actor=actor_from_user(admin),
            correlation_id=original.correlation_id,
            payload={
                "dead_letter_id": dl_id,
                "original_event_id": original.event_id,
                "original_event_type": original.event_type,
                "new_event_id": new_event_id,
            },
        ),
    )
    return doc


async def discard(dl_id: str, admin: UserInDB) -> dict[str, Any]:
    return await _claim(dl_id, "DISCARDED", {"discarded_at": utcnow(), "discarded_by": admin.id})
