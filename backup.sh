#!/usr/bin/env bash
# Backup DB. Prefers pg_dump/docker; falls back to built-in JSON dump (no deps).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
set -a; . ./.env 2>/dev/null || true; set +a
DATABASE_URL="${DATABASE_URL:-}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="backups/tabletennis-$TS"

if command -v pg_dump >/dev/null 2>&1 && [ -n "$DATABASE_URL" ]; then
  pg_dump "$DATABASE_URL" | gzip > "$OUT.sql.gz" && echo "Backup: $OUT.sql.gz"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-tabletennis}" | gzip > "$OUT.sql.gz" && echo "Backup: $OUT.sql.gz"
else
  [ -f server/dist/dbbackup.js ] || npm run build --workspace=server
  (cd server && node dist/dbbackup.js dump "../$OUT.json.gz")
fi
