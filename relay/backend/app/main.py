"""RELAY API - FastAPI application with lifespan-managed infrastructure and background workers."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.admin import router as admin_router
from app.api.audit import router as audit_router
from app.api.auth import router as auth_router
from app.api.requests import router as requests_router
from app.api.stats import router as stats_router
from app.api.workflows import router as workflows_router
from app.core import db as mongo
from app.core import redis as redis_core
from app.core.config import settings
from app.runtime import Runtime, configure_logging, get_runtime, set_runtime


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    runtime = Runtime()
    set_runtime(runtime)
    await runtime.start()
    app.state.runtime = runtime
    try:
        yield
    finally:
        await runtime.stop()
        set_runtime(None)


app = FastAPI(title=settings.PROJECT_NAME, version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Idempotent-Replayed"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    """Keep `detail` a human-readable string (contract error shape); full errors under `errors`."""
    errors = exc.errors()
    parts = []
    for e in errors:
        loc = ".".join(str(p) for p in e.get("loc", ()) if p not in ("body", "query", "path", "header"))
        parts.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
    return JSONResponse(
        status_code=422,
        content={"detail": "; ".join(parts) or "Validation error", "errors": jsonable_encoder(errors)},
    )


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(requests_router, prefix="/api/requests", tags=["requests"])
app.include_router(workflows_router, prefix="/api/workflows", tags=["workflows"])
app.include_router(audit_router, prefix="/api/audit", tags=["audit"])
app.include_router(stats_router, prefix="/api/stats", tags=["stats"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])


@app.get("/health", tags=["health"])
@app.get("/api/health", tags=["health"], include_in_schema=False)
async def health():
    runtime = get_runtime()
    components = {
        "mongo": "up" if await mongo.ping() else "down",
        "redis": "up" if await redis_core.ping() else "down",
        "kafka": await runtime.bus.health(),
    }
    ok = all(v in ("up", "disabled") for v in components.values())
    return {
        "status": "ok" if ok else "degraded",
        "components": components,
        "event_bus": runtime.bus.name,
        "workers": runtime.run_workers,
    }
