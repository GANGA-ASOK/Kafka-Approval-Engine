"""Timezone-aware UTC time helpers (single place to read the clock)."""

from datetime import UTC, datetime, timedelta


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(value: datetime | None) -> datetime | None:
    """Normalise a datetime (possibly naive from a driver) to aware UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def iso(value: datetime | None) -> str | None:
    """Serialise to ISO-8601 UTC with a trailing `Z`."""
    if value is None:
        return None
    return ensure_utc(value).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | datetime | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return ensure_utc(value)
    return ensure_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


def hours(h: float) -> timedelta:
    return timedelta(seconds=float(h) * 3600)
