"""Application settings (pydantic-settings, env-overridable, `.env` supported)."""

from functools import cached_property
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    PROJECT_NAME: str = "RELAY API"

    # Infrastructure
    MONGODB_URL: str = "mongodb://localhost:27017"
    DATABASE_NAME: str = "relay"
    REDIS_URL: str = "redis://localhost:6379/0"
    KAFKA_BOOTSTRAP_SERVERS: str = "localhost:9092"

    # Auth
    SECRET_KEY: str = "supersecretkey_change_in_production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day
    BCRYPT_ROUNDS: int = 12

    # HTTP
    CORS_ORIGINS: str = "http://localhost:5173"

    # Eventing / workers
    EVENT_BUS: Literal["kafka", "memory"] = "kafka"
    RUN_WORKERS: bool = True
    SLA_CHECK_INTERVAL_SECONDS: float = 15
    MAX_EVENT_RETRIES: int = 3
    RETRY_BACKOFF_SECONDS: float = 2
    SEED_DEMO_DATA: bool = True

    # Kafka tuning
    KAFKA_TOPIC_PARTITIONS: int = 3
    KAFKA_REPLICATION_FACTOR: int = 1
    KAFKA_CONNECT_RETRY_MAX_SECONDS: float = 30
    KAFKA_PUBLISH_TIMEOUT_SECONDS: float = 5

    # Outbox relay (events that could not be published are buffered in Mongo)
    OUTBOX_RELAY_INTERVAL_SECONDS: float = 3

    @cached_property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
