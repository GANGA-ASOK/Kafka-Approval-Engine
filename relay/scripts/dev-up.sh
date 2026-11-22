#!/usr/bin/env bash
# Start infra (Mongo, Redis, Kafka, Kafka UI) and wait until healthy.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d
echo "Waiting for services to be healthy..."
for i in $(seq 1 60); do
  unhealthy=$(docker compose ps --format '{{.Name}} {{.Health}}' | grep -E 'relay_(mongodb|redis|kafka) ' | grep -v ' healthy' || true)
  [ -z "$unhealthy" ] && { echo "Infra is healthy. Kafka UI: http://localhost:8080"; exit 0; }
  sleep 3
done
echo "Timed out waiting for health:"; docker compose ps; exit 1
