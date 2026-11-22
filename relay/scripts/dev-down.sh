#!/usr/bin/env bash
# Stop everything. Pass -v to also delete data volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --profile app down "$@"
