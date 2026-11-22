"""Redis client (redis.asyncio) used for idempotency fast path, API idempotency cache and locks."""

import logging

import redis.asyncio as aioredis

from app.core.config import settings

log = logging.getLogger("relay.redis")


class _RedisState:
    client: aioredis.Redis | None = None
    owned: bool = False


_state = _RedisState()


def set_redis(client) -> None:
    """Inject a client (used by tests with fakeredis)."""
    _state.client = client
    _state.owned = False


async def connect_to_redis() -> None:
    if _state.client is not None:
        return
    _state.client = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
        health_check_interval=30,
    )
    _state.owned = True


async def close_redis() -> None:
    if _state.client is not None and _state.owned:
        await _state.client.aclose()
    _state.client = None


def get_redis() -> aioredis.Redis:
    if _state.client is None:
        raise RuntimeError("Redis is not initialised")
    return _state.client


async def ping() -> bool:
    try:
        return bool(await get_redis().ping())
    except Exception:  # noqa: BLE001 - health probe
        return False
