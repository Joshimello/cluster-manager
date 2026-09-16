#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ] || [ "$1" != "--confirm-replace-database" ]; then
  echo "usage: scripts/restore-database.sh --confirm-replace-database BACKUP.dump" >&2
  exit 2
fi

backup=$2
if [ ! -f "$backup" ]; then
  echo "backup does not exist: $backup" >&2
  exit 2
fi
docker compose exec -T postgres pg_restore --list < "$backup" >/dev/null
docker compose stop platform
docker compose exec -T postgres sh -c \
  'pg_restore --username="$POSTGRES_USER" --dbname=postgres --clean --if-exists --create --exit-on-error' \
  < "$backup"
docker compose up -d platform
echo "Database restored and platform restarted."
