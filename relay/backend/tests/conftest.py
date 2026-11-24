"""Test fixtures: in-memory event bus + mongomock-motor + fakeredis; no external services."""

import os

# Must be set before `app.core.config` is imported.
os.environ.update(
    {
        "EVENT_BUS": "memory",
        "RUN_WORKERS": "true",
        "SEED_DEMO_DATA": "true",
        "RETRY_BACKOFF_SECONDS": "0",
        "MAX_EVENT_RETRIES": "3",
        "SLA_CHECK_INTERVAL_SECONDS": "3600",  # tests drive the SLA monitor manually via tick()
        "OUTBOX_RELAY_INTERVAL_SECONDS": "3600",
        "BCRYPT_ROUNDS": "4",
        "CORS_ORIGINS": "http://localhost:5173",
    }
)

import fakeredis  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from app.core import db as mongo  # noqa: E402
from app.core import redis as redis_core  # noqa: E402
from app.runtime import get_runtime  # noqa: E402

PASSWORD = "Relay@123"


@pytest.fixture
async def app():
    mongo.set_client(AsyncMongoMockClient(tz_aware=True))
    redis_core.set_redis(fakeredis.FakeAsyncRedis(decode_responses=True))
    from app.main import app as fastapi_app
    from app.main import lifespan

    async with lifespan(fastapi_app):
        yield fastapi_app


@pytest.fixture
def runtime(app):
    return get_runtime()


@pytest.fixture
def bus(runtime):
    return runtime.bus


@pytest.fixture
def db(app):
    return mongo.get_database()


class Api:
    """Thin helper around an httpx client bound to the ASGI app."""

    def __init__(self, client: httpx.AsyncClient, bus) -> None:
        self.client = client
        self.bus = bus
        self._tokens: dict[str, str] = {}

    async def token(self, who: str) -> str:
        email = who if "@" in who else f"{who}@relay.dev"
        if email not in self._tokens:
            r = await self.client.post("/api/auth/login", data={"username": email, "password": PASSWORD})
            assert r.status_code == 200, r.text
            self._tokens[email] = r.json()["access_token"]
        return self._tokens[email]

    async def h(self, who: str, **extra) -> dict[str, str]:
        return {"Authorization": f"Bearer {await self.token(who)}", **extra}

    async def get(self, who: str, url: str, **kw):
        return await self.client.get(url, headers=await self.h(who), **kw)

    async def post(self, who: str, url: str, json=None, headers=None, **kw):
        return await self.client.post(url, json=json, headers={**(await self.h(who)), **(headers or {})}, **kw)

    async def put(self, who: str, url: str, json=None):
        return await self.client.put(url, json=json, headers=await self.h(who))

    async def drain(self):
        await self.bus.drain()

    async def create(self, who: str = "employee", amount: float = 5000, title: str = "Laptop", **fields):
        body = {"title": title, "description": "test", "amount": amount, "department": "Engineering", **fields}
        r = await self.post(who, "/api/requests", json=body)
        assert r.status_code == 201, r.text
        await self.drain()
        return r.json()

    async def request(self, rid: str, who: str = "admin") -> dict:
        r = await self.get(who, f"/api/requests/{rid}")
        assert r.status_code == 200, r.text
        return r.json()

    async def decide(self, who: str, rid: str, decision: str = "APPROVE", comment: str | None = None, drain=True):
        r = await self.post(who, f"/api/requests/{rid}/decision", json={"decision": decision, "comment": comment})
        if drain:
            await self.drain()
        return r


@pytest.fixture
async def api(app, bus):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield Api(client, bus)
