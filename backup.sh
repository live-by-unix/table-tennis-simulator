#!/usr/bin/env bash
# Backup the PostgreSQL database to backups/ using pg_dump.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env 2>/dev/null || true; set +a
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/tabletennis}"
BACKUP_DIR="$PWD/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/tabletennis-$TS.sql.gz"
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DATABASE_URL" | gzip > "$OUT"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-tabletennis}" | gzip > "$OUT"
else
  echo "ERROR: need pg_dump or docker access" >&2; exit 1
fi
echo "Backup written: $OUT"
