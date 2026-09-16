# Cluster Manager

Cluster Manager is an internal platform for managing a small research lab's shared
Ubuntu GPU workstations. The central SvelteKit application is the source of truth,
and a small Go node service will reconcile and report each workstation's state.

The project is being delivered in independently testable milestones. See
[`specs.md`](specs.md) for the requirements and [`todo.md`](todo.md) for the
implementation plan.

## Current status

Milestone 4 is complete. The repository currently provides:

- SvelteKit and TypeScript platform
- PostgreSQL with Drizzle migrations
- database-backed readiness endpoint
- a Go node with enrollment, persistent credentials, Linux inventory, and retry/backoff
- Docker Compose development and production configurations
- platform login with secure server-side sessions
- administrator-managed users, roles, account status, and credential resets
- forced replacement of generated temporary passwords
- audit history for user and credential administration
- administrator-managed workstation identities and credential rotation/revocation
- authenticated heartbeat and inventory ingestion with out-of-order protection
- online, stale, and offline workstation presentation
- two independently enrolled simulated workstations in the development stack
- a responsive shadcn-svelte component foundation using Tailwind CSS v4
- shared component treatments for forms, status, feedback, credentials, and tables
- one-workstation user assignment with audited assign, move, and revoke workflows
- synchronized platform and Linux password verifiers without plaintext storage
- authenticated per-node desired state and reconciliation status reporting
- idempotent Ubuntu account, home, password-only SSH, and rootless Podman provisioning
- a hardened systemd unit, Ubuntu installation guide, and disposable Ubuntu acceptance test
- stable GPU inventory with current utilization, VRAM, and temperature telemetry
- attributed GPU-process monitoring with a narrow executable-name privacy boundary
- 24-hour bounded observation retention and explicit stale-telemetry presentation
- auto-refreshing administrator and per-user GPU views with process visibility isolation
- free, busy, and multi-process simulation scenarios for GPU-free development

GPU reservations are not implemented yet. Real NVIDIA discovery is implemented but its
hardware smoke test remains conditional on access to an NVIDIA Ubuntu workstation.

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
<http://localhost:5173/health>. The stack also starts `ws01` and `ws02` with separate
persistent credentials and useful simulated inventory.

### Create the initial administrator

After the stack is healthy, bootstrap the first administrator:

```bash
docker compose -f docker-compose.dev.yml exec platform \
  npm run admin:bootstrap -- --username admin --display-name "Lab Administrator"
```

The command works only while the platform has no users. It prints a generated
temporary password exactly once. Save it, log in at <http://localhost:5173/login>, and
replace it when prompted. A second bootstrap attempt is refused.

Administrators can then create users, change display names and roles, enable or
disable accounts, reset credentials, and inspect audit history from the
**Administration** area. Generated/reset credentials are displayed only in the action
response and must be copied before leaving the page.

The **Workstations** administration page shows node connection state and inventory.
Creating a workstation displays a one-time, 30-minute enrollment token. Deliver that
token to the intended machine, then configure the node with the matching workstation
name. Issuing a new enrollment token revokes the previous node credential.

The **Users** administration page assigns, moves, or revokes each user's workstation.
The immutable platform username is also the Linux username. A user's platform password
is their workstation SSH password; Cluster Manager derives separate one-way hashes for
web login and Linux PAM and never stores or sends plaintext. Nodes report pending,
applied, or errored provisioning state back to both the admin view and the user's
dashboard.

See [the Ubuntu node installation guide](docs/node-installation.md) for direct node and
systemd deployment.

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

Run the Milestone 3 workflow smoke test against the development stack:

```bash
docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m3-smoke
```

Run real account and SSH reconciliation in a disposable Ubuntu 24.04 image:

```bash
make test-ubuntu-reconcile
```

Run the Milestone 4 monitoring workflow against both simulated nodes:

```bash
docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m4-smoke
```

## UI component workflow

The platform uses repository-owned shadcn-svelte components under
`platform/src/lib/components/ui`. Theme tokens live in `platform/src/app.css`, and
`platform/components.json` records the Vega preset, neutral base color, Lucide icons,
and project aliases.

Add or update only the component needed for the current workflow from the platform
directory:

```bash
cd platform
npx shadcn-svelte@latest add dialog
```

The CLI writes source into this repository; it is not a runtime component service.
Review the complete generated diff before committing, especially changes to existing
UI components, `src/app.css`, `package.json`, and `package-lock.json`. Run formatting,
type checks, linting, tests, and a production build after generation.

When package dependencies change while the Compose development stack is already
running, refresh its named dependency volume from the lockfile and restart the
platform service:

```bash
docker compose -f docker-compose.dev.yml run --rm --no-deps platform npm ci
docker compose -f docker-compose.dev.yml up -d platform
```

The M4 views intentionally prioritize current status and use live cards and tables.
Future historical charts should start with the shadcn-svelte Chart integration and
LayerChart, with their versions reviewed when that visualization work is scheduled.

The authentication smoke test is intended for a disposable, freshly bootstrapped
installation because it changes the initial admin password and creates a test user:

```bash
BASE_URL=http://localhost:5173 \
ADMIN_USERNAME=admin \
ADMIN_TEMPORARY_PASSWORD='the-bootstrap-password' \
ADMIN_NEW_PASSWORD='a-new-test-password-of-at-least-12-characters' \
npm --prefix platform run test:auth-smoke
```

It verifies login, required password replacement, user creation, role enforcement,
account disabling, session invalidation, credential reset, and audit visibility.

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

The node can be checked independently:

```bash
cd node
go test ./...
go vet ./...
go run ./cmd/cluster-manager-node --version
```

For a real Ubuntu node, set at least `NODE_PLATFORM_URL`, `NODE_WORKSTATION_NAME`, and
`NODE_ENROLLMENT_TOKEN` on first start. The platform URL must use HTTPS unless
`NODE_ALLOW_INSECURE_HTTP=true` is explicitly set for local development. The node
stores its generated credential at `/var/lib/cluster-manager/node-credential` by
default; `NODE_CREDENTIAL_FILE` changes that location. Configuration can alternatively
be supplied as JSON through `NODE_CONFIG_FILE`, and an enrollment token may be read
from `NODE_ENROLLMENT_TOKEN_FILE`.

Simulation uses the normal node binary with `NODE_SIMULATE=true`. Supported scenarios
are `normal`, `high-cpu`, `high-disk`, `multi-user`, and `offline` through
`NODE_SIMULATION_SCENARIO`. The production node is intended to run directly on Ubuntu
under systemd; its container is for reproducible builds and development simulation.

The integration smoke test requires a running development stack:

```bash
docker compose -f docker-compose.dev.yml exec platform npm run test:node-smoke
```

It verifies enrollment replay safety, credential isolation and revocation, heartbeat
acceptance, and protection against out-of-order inventory.
