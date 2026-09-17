# Development guide

This guide covers local development, tests, database migrations, UI components, and
the simulated node environment.

## Requirements

For the containerized workflow:

- Docker with Docker Compose
- Make, optionally, for the documented shortcuts

For running checks directly on the host:

- Node.js 24 or later
- npm 11 or later
- Go 1.24 or later

## Start the development stack

```bash
git clone https://github.com/Joshimello/cluster-manager.git
cd cluster-manager
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

The equivalent shortcut creates `.env` when it is absent:

```bash
make up
```

Open <http://localhost:5173>. The readiness endpoint is
<http://localhost:5173/health>. The stack runs PostgreSQL, the SvelteKit platform, and
two independently enrolled simulated nodes named `ws01` and `ws02`.

Create the first administrator after the stack becomes healthy:

```bash
docker compose -f docker-compose.dev.yml exec platform \
  npm run admin:bootstrap -- --username admin --display-name "Lab Administrator"
```

The command works only when no users exist and prints a generated temporary password
once. Sign in and replace it when prompted.

Source changes under `platform/` are mounted into the development container and are
picked up by Vite. PostgreSQL data and container-installed npm dependencies use named
Docker volumes.

Stop the stack with `make down`. To also remove development data and dependency
volumes:

```bash
docker compose -f docker-compose.dev.yml down --volumes
```

## Common commands

```bash
make install                 # install platform dependencies on the host
make test                    # platform and Go tests
make check                   # Svelte/TypeScript, lint/format, and Go vet
make format                  # format platform and Go source
make build                   # production platform and node builds
make db-migrate              # apply checked-in migrations in the dev stack
make ps                      # inspect services
make logs                    # follow service logs
```

Node-specific acceptance tests:

```bash
make test-ubuntu-reconcile   # real account, SSH, collision, and signal behavior
make test-ubuntu-deploy      # binary, config permissions, and systemd unit
make test-shared-posix       # two-client shared-volume ownership behavior
```

## Workflow smoke tests

The smoke tests require the running development stack and an administrator account:

```bash
docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m3-smoke

docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m4-smoke

docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m5-smoke

docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m6-smoke
```

The stop-request test uses a deterministic conflict scenario:

```bash
NODE_WS01_SIMULATION_SCENARIO=reservation-conflict \
  docker compose -f docker-compose.dev.yml up -d --force-recreate node-ws01
docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m7-smoke
NODE_WS01_SIMULATION_SCENARIO=normal \
  docker compose -f docker-compose.dev.yml up -d --force-recreate node-ws01
```

Node enrollment and credential isolation can be checked with:

```bash
docker compose -f docker-compose.dev.yml exec platform npm run test:node-smoke
```

The authentication smoke test is intended for a disposable, freshly bootstrapped
database because it changes the administrator password and creates a user:

```bash
BASE_URL=http://localhost:5173 \
ADMIN_USERNAME=admin \
ADMIN_TEMPORARY_PASSWORD='the-bootstrap-password' \
ADMIN_NEW_PASSWORD='a-new-test-password-of-at-least-8-characters' \
npm --prefix platform run test:auth-smoke
```

## Simulation scenarios

The normal Go node binary supports simulation through `NODE_SIMULATE=true`. Available
`NODE_SIMULATION_SCENARIO` values are:

```text
normal
high-cpu
high-disk
multi-user
free-gpus
busy-gpus
multi-process
owner-use
reservation-conflict
mixed-owner
unknown-owner
offline
```

The development Compose stack exposes these as
`NODE_WS01_SIMULATION_SCENARIO` and `NODE_WS02_SIMULATION_SCENARIO`. Recreate the
affected service after changing a value:

```bash
docker compose -f docker-compose.dev.yml up -d --force-recreate node-ws01
```

## Database migrations

Generate a migration after changing `platform/src/lib/server/db/schema.ts`:

```bash
cd platform
DATABASE_URL=postgres://cluster_manager:cluster_manager_development_only@localhost:5432/cluster_manager \
  npm run db:generate
```

Inspect generated SQL before committing it, then verify migration metadata:

```bash
npm run db:check
```

The reservation schema uses PostgreSQL's `btree_gist` extension to enforce
non-overlapping active reservations. The POSIX identity schema uses a bounded sequence,
constraints, and an immutability trigger.

## UI component workflow

The platform owns its shadcn-svelte component source under
`platform/src/lib/components/ui`. Theme tokens are in `platform/src/app.css`, and
`platform/components.json` records the preset and aliases.

Add only the component needed for a workflow:

```bash
cd platform
npx shadcn-svelte@latest add dialog
```

Review the complete generated diff, especially changes to existing components,
`src/app.css`, `package.json`, and `package-lock.json`. Run formatting, checks, tests,
and a production build afterward.

When dependencies change while Compose is running, refresh its dependency volume:

```bash
docker compose -f docker-compose.dev.yml run --rm --no-deps platform npm ci
docker compose -f docker-compose.dev.yml up -d platform
```

## Health behavior

`GET /health` queries PostgreSQL and the migrated metadata table:

- HTTP 200 with `{"status":"ready","version":"…"}` when ready
- HTTP 503 with `{"status":"not_ready","version":"…"}` when unavailable

The public home page remains renderable during a database outage.

## Working on the Go node

```bash
cd node
go test ./...
go vet ./...
go run ./cmd/cluster-node --version
```

Production nodes run directly on Ubuntu under systemd. The node container exists for
reproducible builds and simulation, not as the production deployment model. Active
root-only configuration is stored at `/etc/cluster-manager/node.json`; credentials and
the account-provenance ledger live under `/var/lib/cluster-manager`.

For production deployment and recovery, continue with the
[operations runbook](operations.md). For real workstation setup, use the
[node installation guide](node-installation.md).
