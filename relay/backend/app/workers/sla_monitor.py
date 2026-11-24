"""SLA monitor: periodically finds overdue active steps and publishes `SLA_BREACHED`.

- Only one instance scans at a time: Redis lock `relay:lock:sla-monitor` (SET NX EX, renewed by the
  holder). If Redis is down the scan still runs - the engine's escalation-level check keeps it safe.
- Dedupe per breach: `relay:sla:{request_id}:{step_index}:{escalation_level}` (SET NX).
- Escalated steps get a fresh `due_at`; if that one passes too, the next escalation level fires.
"""

import asyncio
import logging
import uuid
from datetime import datetime

from app.core.clock import iso, utcnow
from app.core.config import settings
from app.core.db import get_database
from app.core.redis import get_redis
from app.events.envelope import MAIN_TOPIC, EventType, Source, new_event
from app.events.publisher import EventPublisher
from app.models.request import ACTIVE_STATUSES, StepStatus

log = logging.getLogger("relay.workers.sla")

LOCK_KEY = "relay:lock:sla-monitor"
DEDUPE_TTL_SECONDS = 7 * 24 * 3600


class SlaMonitor:
    def __init__(self, publisher: EventPublisher, interval: float | None = None) -> None:
        self.publisher = publisher
        self.interval = interval if interval is not None else settings.SLA_CHECK_INTERVAL_SECONDS
        self.instance_id = uuid.uuid4().hex
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="sla-monitor")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        try:
            redis = get_redis()
            if await redis.get(LOCK_KEY) == self.instance_id:
                await redis.delete(LOCK_KEY)
        except Exception:  # noqa: BLE001
            pass

    async def _run(self) -> None:
        log.info("SLA monitor started (interval %.1fs)", self.interval)
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("SLA monitor tick failed")
            await asyncio.sleep(self.interval)

    async def _acquire_lock(self) -> bool:
        ttl = max(int(self.interval * 2), 5)
        try:
            redis = get_redis()
            if await redis.set(LOCK_KEY, self.instance_id, nx=True, ex=ttl):
                return True
            if await redis.get(LOCK_KEY) == self.instance_id:
                await redis.expire(LOCK_KEY, ttl)
                return True
            return False
        except Exception:  # noqa: BLE001
            log.warning("Redis unavailable; SLA scan proceeds without the distributed lock")
            return True

    async def _first_time(self, key: str) -> bool:
        try:
            return bool(await get_redis().set(key, "1", nx=True, ex=DEDUPE_TTL_SECONDS))
        except Exception:  # noqa: BLE001
            return True

    async def tick(self, now: datetime | None = None) -> int:
        """Scan once; returns the number of SLA_BREACHED events published."""
        if not await self._acquire_lock():
            return 0
        now = now or utcnow()
        cursor = get_database().requests.find(
            {"status": {"$in": [s.value for s in ACTIVE_STATUSES]}, "sla_due_at": {"$ne": None, "$lt": now}}
        )
        published = 0
        async for doc in cursor:
            idx = doc.get("current_step")
            if idx is None or idx >= len(doc.get("steps") or []):
                continue
            step = doc["steps"][idx]
            if step.get("status") != StepStatus.PENDING:
                continue
            level = step.get("escalation_level", 0)
            if not await self._first_time(f"relay:sla:{doc['_id']}:{idx}:{level}"):
                continue
            await self.publisher.publish(
                MAIN_TOPIC,
                new_event(
                    EventType.SLA_BREACHED,
                    doc["_id"],
                    source=Source.SLA_MONITOR,
                    payload={
                        "step_index": idx,
                        "due_at": iso(step.get("due_at")),
                        "role": step.get("assigned_role"),
                        "escalation_level": level,
                    },
                ),
            )
            published += 1
            log.info("SLA breached: %s step %s (%s, level %s)", doc["_id"], idx, step.get("assigned_role"), level)
        return published
