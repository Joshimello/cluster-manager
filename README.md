# Cluster Manager

Cluster Manager is an internal platform for managing a small research lab's shared
Ubuntu GPU workstations. The central SvelteKit application is the source of truth,
and a small Go node service will reconcile and report each workstation's state.

The project is being delivered in independently testable milestones. See
[`specs.md`](specs.md) for the requirements and [`todo.md`](todo.md) for the
implementation plan.

## Current status

Milestone 0 is complete and provides a bootable development and production-shaped
foundation:

- SvelteKit and TypeScript platform
- PostgreSQL with Drizzle migrations
- database-backed readiness endpoint
- minimal Go node executable
- Docker Compose development and production configurations

User management, workstation connectivity, GPU monitoring, and reservations are not
implemented yet. Milestone 1 will add secure login and user administration.

## Requirements

For the containerized development workflow:

- Docker with Docker Compose
- Make (optional, but used by the documented shortcuts)

For running checks directly on the host:

- Node.js 24 or later
- npm 11 or later
- Go 1.24 or later

## Start the development system

```bash
git clone https://github.com/Joshimello/cluster-manager.git
cd cluster-manager
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Or use the equivalent shortcut, which creates `.env` when it is absent:

```bash
make up
```

Then open <http://localhost:5173>. A healthy installation displays **Platform and
database are ready**. The machine-readable readiness endpoint is available at
<http://localhost:5173/health>.

Source changes under `platform/` are mounted into the development container and are
picked up by Vite. PostgreSQL data and container-installed npm dependencies are kept
in named Docker volumes.

Stop the development system with:

```bash
make down
```

To also delete development database data and dependency volumes:

```bash
docker compose -f docker-compose.dev.yml down --volumes
```

## Common development commands

Install host dependencies:

```bash
make install
```

Run tests, static checks, formatting, and builds:

```bash
make test
make check
make format
make build
```

Inspect the development stack:

```bash
make ps
make logs
```

Apply checked-in database migrations inside the running development platform:

```bash
make db-migrate
```

Generate a migration after changing
`platform/src/lib/server/db/schema.ts`:

```bash
cd platform
DATABASE_URL=postgres://cluster_manager:cluster_manager_development_only@localhost:5432/cluster_manager npm run db:generate
```

Always inspect generated SQL before committing it. Verify migration metadata with
`npm run db:check`.

## Health behavior

`GET /health` queries the migrated `platform_metadata` table:

- HTTP 200 and `{"status":"ready"}` when PostgreSQL and the schema are available
- HTTP 503 and `{"status":"not_ready"}` when they are unavailable

The web home page remains renderable when the database is down and reports the
unavailable state.

## Production-shaped Compose

`docker-compose.yml` builds a production SvelteKit image and runs PostgreSQL with a
persistent volume. Before using it, replace the development password in `.env` and set
`ORIGIN` to the externally reachable HTTPS origin.

```bash
docker compose up -d --build
docker compose ps
```

The production Compose file is an initial foundation, not yet a complete deployment
guide. HTTPS/reverse proxy configuration, backups, and operational hardening are part
of the production-readiness milestone.

## Go node skeleton

The node does not connect to the platform yet. It can be checked independently:

```bash
cd node
go test ./...
go vet ./...
go run ./cmd/cluster-manager-node --version
```

The production node will eventually run directly on Ubuntu under systemd, not in a
container. Its Dockerfile exists for reproducible builds and later development
simulation.
