# Production operations

This runbook covers the first single-management-host deployment. Keep the repository,
`.env`, database backups, and node credentials accessible only to trusted operators.

## Management host deployment

Install Docker Engine with the Compose plugin, clone a tagged release, then configure it:

```bash
cp .env.production.example .env
chmod 600 .env
${EDITOR:-vi} .env
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

Every placeholder must be replaced. `ORIGIN` is the public HTTPS origin and
`PLATFORM_VERSION` is the deployed release/tag. PostgreSQL is not published to the
host. Its data lives in the `postgres-data` named volume. The app port binds to
loopback by default; change `PLATFORM_BIND_ADDRESS` only when the reverse proxy runs on
another trusted host or container network.

Bootstrap the first administrator once:

```bash
docker compose exec platform npm run admin:bootstrap -- \
  --username admin --display-name "Lab Administrator"
```

Copy the generated password immediately, sign in, and replace it when prompted.

## HTTPS reverse proxy

The platform deliberately does not terminate TLS. Put Caddy, nginx, Traefik, or the
NAS reverse proxy in front of `127.0.0.1:3000`. The proxy must:

- present a trusted certificate and redirect HTTP to HTTPS;
- preserve `Host` and forward `X-Forwarded-Proto: https`;
- use the exact public URL configured as `ORIGIN`;
- restrict request-body sizes and apply normal access-log rotation;
- not expose PostgreSQL or any node credential/state file.

Do not enable `ALLOW_INSECURE_PRODUCTION_ORIGIN`; it exists only for isolated automated
rehearsals. Nodes must use the public HTTPS URL and validate its certificate.

## Updates

Back up first, check out the intended tag, set `PLATFORM_VERSION`, then run:

```bash
scripts/backup-database.sh backups/pre-upgrade.dump
docker compose build --pull
docker compose up -d --wait
docker compose ps
```

The platform validates its environment and applies forward database migrations before
serving. Read the release notes before rollback: an older app may not understand a
newer schema. Prefer restoring the pre-upgrade backup with the matching release.

## Backup and restore

Create and validate a PostgreSQL custom-format backup:

```bash
scripts/backup-database.sh backups/cluster-manager-$(date +%F).dump
```

Copy backups off the management host, encrypt them at rest, and test restoration after
schema or PostgreSQL changes. Audit and reservation history are intentionally retained
and included. Restore replaces the live database and briefly stops the platform:

```bash
scripts/restore-database.sh --confirm-replace-database backups/cluster-manager-2026-09-16.dump
docker compose up -d --wait
```

The explicit confirmation flag prevents accidental replacement. The M8 rehearsal
performs a backup, deletes data, restores it, and verifies the recovered control plane:

```bash
scripts/rehearse-production.sh
```

## Credential recovery

If every administrator password is lost, choose an existing trusted user and run:

```bash
docker compose exec platform npm run admin:recover -- --username trusted-user
```

This enables/promotes that account, revokes its web sessions, clears its Linux password
verifier, records an audit event, and prints a one-time temporary password. Log in and
change it immediately; that final step regenerates the matching Linux verifier.

For a lost node credential, open **Administration → Workstations**, select **Rotate /
enroll**, copy the one-time token, remove the node's stale credential file, place the
token in its root-only configuration, and restart the service. Rotation immediately
revokes the old credential. Remove the enrollment token from the configuration after
the new credential is written.

## Retention and logs

Expired sessions are deleted in batches. GPU observations and their process rows are
kept for `TELEMETRY_RETENTION_HOURS` (24 by default, allowed range 1–720) and removed in
bounded batches. Current GPU state remains on the GPU record. Audit events, users,
assignments, reservations, and stop requests are not automatically deleted.

Platform and node logs are newline-delimited JSON. Container logs rotate locally at
10 MiB × 5 files. Use `docker compose logs --since=1h platform postgres`; use
`journalctl -u cluster-manager-node --since=-1h -o cat` on a node. Request logs include
a response `x-request-id`, path without query strings, status, duration, and authenticated
username, but never passwords, hashes, enrollment tokens, node credentials, command
arguments, or process environments.

## Failure behavior

- **Platform/network outage:** existing SSH sessions, Linux accounts, and workloads
  continue. Nodes retry with backoff and make no account or process changes without
  authenticated state/instructions. New web actions are unavailable.
- **Database outage:** readiness returns 503 and authenticated actions are unavailable.
  Existing node/SSH state is unchanged; browser cookies are retained for recovery.
- **Node outage:** after the freshness window, telemetry becomes stale/offline and GPU
  coordination becomes unknown. Reservations remain, while SSH and workloads already
  on that workstation are not changed by the platform.
- **Restart:** Compose restarts the app/database unless stopped by an operator; systemd
  restarts a failed node. Reconciliation is idempotent and does not delete homes.

Before escalating, record the platform/node versions, request ID, workstation name,
connection state, relevant audit event, and a narrow log window. Do not paste secrets.
