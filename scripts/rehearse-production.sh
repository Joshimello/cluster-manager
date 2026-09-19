#!/usr/bin/env sh
set -eu

project="cluster-manager-rehearsal-$$"
port="${REHEARSAL_PORT:-31080}"
work="$(mktemp -d "${TMPDIR:-/tmp}/cluster-manager-rehearsal.XXXXXX")"
environment="$work/rehearsal.env"
backup="$work/rehearsal.dump"

cleanup() {
  COMPOSE_PROJECT_NAME="$project" docker compose --env-file "$environment" down --volumes >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

cat > "$environment" <<EOF
COMPOSE_PROJECT_NAME=$project
POSTGRES_DB=cluster_manager
POSTGRES_USER=cluster_manager
POSTGRES_PASSWORD=rehearsal-only-not-a-production-secret
ORIGIN=https://cluster-manager.rehearsal.invalid
PLATFORM_BIND_ADDRESS=127.0.0.1
PLATFORM_PORT=$port
PLATFORM_VERSION=rehearsal
TELEMETRY_RETENTION_HOURS=24
EOF

docker build --target production \
  --tag ghcr.io/joshimello/cluster-manager-platform:rehearsal platform >/dev/null
docker compose --env-file "$environment" up -d --wait
curl --fail --silent "http://127.0.0.1:$port/health" >/dev/null
docker compose --env-file "$environment" exec -T platform \
  npm run admin:bootstrap -- --username rehearsal-admin --display-name "Rehearsal Administrator" >/dev/null

COMPOSE_PROJECT_NAME="$project" COMPOSE_ENV_FILE="$environment" \
  scripts/backup-database.sh "$backup" >/dev/null
docker compose --env-file "$environment" exec -T postgres sh -c \
  'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="delete from users"' >/dev/null
COMPOSE_PROJECT_NAME="$project" COMPOSE_ENV_FILE="$environment" \
  scripts/restore-database.sh --confirm-replace-database "$backup" >/dev/null
docker compose --env-file "$environment" exec -T postgres sh -c \
  'test "$(psql --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="select count(*) from users")" = 1'
docker compose --env-file "$environment" up -d --wait >/dev/null
curl --fail --silent "http://127.0.0.1:$port/health" >/dev/null

echo "Production rehearsal passed: clean start, migration, health, bootstrap, backup, destructive change, restore, and restart."
