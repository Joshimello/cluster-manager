# Cluster Manager

Cluster Manager is an internal platform for managing a small research lab's shared
Ubuntu GPU workstations. The central SvelteKit application is the source of truth,
and a small Go node service reconciles and reports each workstation's state.

The project is being delivered in independently testable milestones. See
[`specs.md`](specs.md) for the requirements and [`todo.md`](todo.md) for the
implementation plan.

## Current status

Milestone 8 is complete. The repository provides a deployable v1, including:

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
- per-GPU reservations with 30-minute boundaries, six-hour duration, and seven-day horizon rules
- PostgreSQL exclusion constraints that prevent concurrent overlapping reservations
- privacy-safe user schedules, owner cancellation, and retained booking history
- explicit, reasoned, and audited administrator overrides and cancellations
- reservation/process correlation, conflict status, and privacy-safe views
- user stop requests and admin-controlled, identity-revalidated SIGTERM/SIGKILL handling
- operational dashboards, filtered/paginated audit browsing, and version visibility
- bounded session/telemetry cleanup and structured, rotated operational logs
- production environment validation, HTTPS proxy guidance, backup/restore, and recovery tools
- a versioned node build/install/upgrade workflow and an end-to-end production rehearsal

Real NVIDIA discovery is implemented; its hardware smoke test remains conditional on
access to an NVIDIA Ubuntu workstation. Development simulation covers all v1 workflows
without a GPU.

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

Install a real Ubuntu node from the latest verified GitHub release with:

```bash
curl -fsSL https://raw.githubusercontent.com/Joshimello/cluster-manager/main/install-node.sh | sudo bash
```

See [the Ubuntu node installation guide](docs/node-installation.md) for lifecycle,
upgrade, diagnostics, and safe uninstall details.

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

Run the Milestone 5 reservation and concurrency workflow:

```bash
docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m5-smoke
```

The reservations migration installs PostgreSQL's `btree_gist` extension so the
database can enforce non-overlapping active time ranges.

Run the Milestone 7 stop-request workflow with `ws01` in the deterministic conflict
scenario:

```bash
NODE_WS01_SIMULATION_SCENARIO=reservation-conflict \
  docker compose -f docker-compose.dev.yml up -d --force-recreate node-ws01
docker compose -f docker-compose.dev.yml exec \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='your-admin-password' \
  platform npm run test:m7-smoke
NODE_WS01_SIMULATION_SCENARIO=normal \
  docker compose -f docker-compose.dev.yml up -d --force-recreate node-ws01
```

The disposable Ubuntu test also verifies real `SIGTERM`, authorized `SIGKILL`
escalation, and refusal on a process-start identity mismatch.

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
ADMIN_NEW_PASSWORD='a-new-test-password-of-at-least-8-characters' \
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

`GET /health` queries the migrated `platform_metadata` table and returns the deployed
platform version:

- HTTP 200 and `{"status":"ready","version":"…"}` when PostgreSQL and the schema are available
- HTTP 503 and `{"status":"not_ready","version":"…"}` when they are unavailable

The web home page remains renderable when the database is down and reports the
unavailable state.

## Production-shaped Compose

`docker-compose.yml` builds the hardened production SvelteKit image and runs PostgreSQL
with a persistent volume. Follow the complete [production operations runbook](docs/operations.md)
and [security review](docs/security-review.md). Start from the production environment template:

```bash
cp .env.production.example .env
# replace every placeholder, then:
docker compose up -d --build --wait
```

Use `scripts/rehearse-production.sh` to exercise clean startup, migrations, health,
bootstrap, backup, destructive data change, restoration, and restart in an isolated
temporary Compose project.

## Go node skeleton

The node can be checked independently:

```bash
cd node
go test ./...
go vet ./...
go run ./cmd/cluster-node --version
```

For real nodes, use `install-node.sh` and the `cluster-node` lifecycle commands rather
than constructing configuration manually. The active root-only configuration is
`/etc/cluster-manager/node.json`; the node credential and account-provenance ledger
live under `/var/lib/cluster-manager`. A legacy configuration containing a one-time
enrollment token is still read, then rewritten without the token after enrollment.

Simulation uses the normal node binary with `NODE_SIMULATE=true`. Set
`NODE_SIMULATION_SCENARIO` to `normal`, `high-cpu`, `high-disk`, `multi-user`,
`free-gpus`, `busy-gpus`, `multi-process`, `owner-use`, `reservation-conflict`,
`mixed-owner`, `unknown-owner`, or `offline`. The reservation-focused scenarios use
the Linux usernames `alice` and `bob`; for example, reserve a GPU for `alice` and use
`reservation-conflict` to report Bob's process on it.

The development Compose stack exposes this as `NODE_WS01_SIMULATION_SCENARIO` and
`NODE_WS02_SIMULATION_SCENARIO`. After changing either value in `.env`, recreate just
that simulated node, for example:

```bash
docker compose -f docker-compose.dev.yml up -d --force-recreate node-ws01
```

The production node is intended to run directly on Ubuntu under systemd; its container
is for reproducible builds and development simulation.

The integration smoke test requires a running development stack:

```bash
docker compose -f docker-compose.dev.yml exec platform npm run test:node-smoke
```

It verifies enrollment replay safety, credential isolation and revocation, heartbeat
acceptance, and protection against out-of-order inventory.
