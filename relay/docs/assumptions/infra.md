# Infra/docs assumptions
- Kafka image: `apache/kafka:3.8.1` (official, KRaft). Bitnami free images are gone. Listeners: INTERNAL `kafka:29092`, EXTERNAL `localhost:9092`, CONTROLLER 29093. Only 9092 is published to the host.
- `KAFKA_NUM_PARTITIONS=3` and auto topic creation on as a safety net; backend still creates topics explicitly.
- Compose project is named `relay`; container names kept as `relay_*`. Obsolete `version:` key removed.
- Backend/frontend compose services live under profile `app`; plain `docker compose up -d` is infra only.
- Backend Dockerfile runs `uv sync --frozen --no-dev --no-install-project` and copies only `app/`; assumes the app runs from `app/` (not the `src/backend` package) and that `uv.lock` is committed. Health check uses `GET /api/health`.
- Frontend container is served on host port 3000 (nginx :80) to avoid clashing with Vite on 5173; compose default CORS includes http://localhost:3000. The frontend source did not yet read `VITE_API_URL` when written; the build arg is passed through in case it does.
- demo_flow.py uses only the stdlib, accepts either `_id` or `id` in request responses, and finds the dead letter via `event.request_id` from `GET /admin/dlq`. DLQ wait defaults to 45 s (depends on backoff settings).
- README testing section is generic because the test layout was not yet present.
