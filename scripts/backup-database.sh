#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/backup-database.sh BACKUP.dump" >&2
  exit 2
fi

output=$1
case "$output" in
  /*) ;;
  *) output="$(pwd)/$output" ;;
esac
mkdir -p "$(dirname "$output")"
compose() {
  if [ -n "${COMPOSE_ENV_FILE:-}" ]; then
    docker compose --env-file "$COMPOSE_ENV_FILE" "$@"
  else
    docker compose "$@"
  fi
}
compose exec -T postgres sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --create --clean --if-exists' \
  > "$output"
compose exec -T postgres pg_restore --list < "$output" >/dev/null
echo "Verified database backup: $output"
