"""Shared model helpers."""

from datetime import datetime
from typing import Annotated, Any

from pydantic import BeforeValidator, PlainSerializer

from app.core.clock import iso, parse_iso

# Timezone-aware UTC datetime that serialises as an ISO-8601 string ending in `Z`.
UTCDateTime = Annotated[
    datetime,
    BeforeValidator(parse_iso),
    PlainSerializer(iso, return_type=str, when_used="always"),
]


def to_jsonable(value: Any) -> Any:
    """Recursively convert datetimes to ISO strings (for raw dict payloads)."""
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_jsonable(v) for v in value]
    return value
