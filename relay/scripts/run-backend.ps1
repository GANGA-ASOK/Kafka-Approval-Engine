Set-Location (Join-Path $PSScriptRoot '..\backend')
uv sync
uv run uvicorn app.main:app --reload --port 8000
