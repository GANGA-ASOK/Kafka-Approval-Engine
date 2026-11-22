# Stop everything. Pass -v to also delete data volumes.
Set-Location (Join-Path $PSScriptRoot '..')
docker compose --profile app down @args
