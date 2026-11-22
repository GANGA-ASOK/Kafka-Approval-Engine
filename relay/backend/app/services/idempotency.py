"""Idempotency primitives.

1. `ProcessedEventStore` - consumer-side dedupe: Redis fast-path key + Mongo `processed_events`
   (unique on (group, event_id)) as the source of truth.
2. `ApiIdempotencyCache` - `Idempotency-Key` support for POST /api/requests (Redis, 24 h).
"""

import hashlib
import json
import logging
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import get_database
from app.core.redis import get_redis

log = logging.getLogger("relay.idempotency")

PROCESSED_TTL_SECONDS = 7 * 24 * 3600
API_IDEM_TTL_SECONDS = 24 * 3600
_IN_PROGRESS = "__in_progress__"


class ProcessedEventStore:
    @staticmethod
    def _redis_key(group: str, key: str) -> str:
        return f"relay:processed:{group}:{key}"

    async def is_processed(self, group: str, key: str) -> bool:
        try:
            if await get_redis().exists(self._redis_key(group, key)):
                return True
        except Exception:  # noqa: BLE001 - Redis is only a fast path
            log.debug("redis unavailable for idempotency fast path", exc_info=True)
        doc = await get_database().processed_events.find_one({"group": group, "event_id": key}, {"_id": 1})
        if doc is not None:
            await self._remember(group, key)
            return True
        return False

    async def mark_processed(self, group: str, key: str, *, event_type: str, status: str = "PROCESSED") -> None:
        try:
            await get_database().processed_events.insert_one(
                {
                    "_id": f"{group}:{key}",
                    "group": group,
                    "event_id": key,
                    "event_type": event_type,
                    "status": status,
                    "processed_at": utcnow(),
                }
            )
        except DuplicateKeyError:
            pass
        await self._remember(group, key)

    async def _remember(self, group: str, key: str) -> None:
        try:
            await get_redis().set(self._redis_key(group, key), "1", ex=PROCESSED_TTL_SECONDS)
        except Exception:  # noqa: BLE001
            log.debug("redis unavailable for idempotency fast path", exc_info=True)


class IdempotencyConflict(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class ApiIdempotencyCache:
    """First response for (user, key) is cached 24 h and replayed for duplicates."""

    @staticmethod
    def _key(user_id: str, key: str) -> str:
        return f"relay:idem:{user_id}:{key}"

    @staticmethod
    def fingerprint(body: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()

    async def begin(self, user_id: str, key: str, fingerprint: str) -> dict[str, Any] | None:
        """Returns the cached response for a replay, or None if the caller should proceed.
        Raises IdempotencyConflict if the key is in flight or was used with a different body."""
        redis = get_redis()
        rkey = self._key(user_id, key)
        placeholder = json.dumps({"state": _IN_PROGRESS, "fingerprint": fingerprint})
        if await redis.set(rkey, placeholder, nx=True, ex=60):
            return None
        raw = await redis.get(rkey)
        if raw is None:  # expired between calls - proceed
            await redis.set(rkey, placeholder, ex=60)
            return None
        cached = json.loads(raw)
        if cached.get("fingerprint") != fingerprint:
            raise IdempotencyConflict("Idempotency-Key was already used with a different request body")
        if cached.get("state") == _IN_PROGRESS:
            raise IdempotencyConflict("A request with this Idempotency-Key is still being processed")
        return cached

    async def complete(self, user_id: str, key: str, fingerprint: str, status_code: int, body: Any) -> None:
        await get_redis().set(
            self._key(user_id, key),
            json.dumps({"state": "done", "fingerprint": fingerprint, "status_code": status_code, "body": body}),
            ex=API_IDEM_TTL_SECONDS,
        )

    async def abort(self, user_id: str, key: str) -> None:
        try:
            await get_redis().delete(self._key(user_id, key))
        except Exception:  # noqa: BLE001
            pass
