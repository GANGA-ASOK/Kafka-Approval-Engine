# Start infra and wait until healthy.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
docker compose up -d
for ($i = 0; $i -lt 60; $i++) {
  $bad = docker compose ps --format '{{.Name}} {{.Health}}' | Where-Object { $_ -match 'relay_(mongodb|redis|kafka) ' -and $_ -notmatch ' healthy' }
  if (-not $bad) { Write-Host 'Infra is healthy. Kafka UI: http://localhost:8080'; exit 0 }
  Start-Sleep -Seconds 3
}
docker compose ps
throw 'Timed out waiting for infra health'
