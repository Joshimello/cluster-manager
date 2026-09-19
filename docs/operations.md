# Production operations

This runbook covers the first single-management-host deployment. Keep the repository,
`.env`, database backups, and node credentials accessible only to trusted operators.

## Management host deployment

Install Docker Engine with the Compose plugin, clone the repository, then configure
the production environment:

```bash
cp .env.production.example .env
chmod 600 .env
${EDITOR:-vi} .env
docker compose config --quiet
docker compose pull
docker compose up -d --wait
docker compose ps
curl --fail http://127.0.0.1:3000/health
```

Every placeholder must be replaced. `ORIGIN` is the exact browser-facing origin.
`PLATFORM_VERSION` selects the image tag from
`ghcr.io/joshimello/cluster-manager-platform`; use a release tag for reproducible
deployments or `latest` for the newest stable release. The image supports Linux
`amd64` and `arm64` and is built by GitHub Actions rather than on the management host.
PostgreSQL is not published to the
host. Its data lives in the `postgres-data` named volume. The app port binds to
loopback by default; change `PLATFORM_BIND_ADDRESS` only when the reverse proxy runs on
another trusted host or container network.

HTTPS is required by default. For a deployment reached directly through an encrypted
private overlay network, HTTP may be enabled explicitly:

```dotenv
ORIGIN=http://100.64.0.10:3000
ALLOW_HTTP=true
PLATFORM_BIND_ADDRESS=100.64.0.10
PLATFORM_PORT=3000
```

Replace the example address with the management host's private-overlay address. Bind
to that address specifically: do not use `0.0.0.0`, which would also publish the
platform on unrelated host interfaces. HTTP mode issues non-`Secure` session cookies
because browsers will not send `Secure` cookies over HTTP. The overlay must provide
authenticated encryption and access control; use HTTPS for ordinary LAN, institutional,
or internet-facing deployments. `ALLOW_HTTP` accepts only `true` or `false` and
defaults to `false`.

Bootstrap the first administrator once:

```bash
docker compose exec platform npm run admin:bootstrap -- \
  --username admin --display-name "Lab Administrator"
```

Copy the generated password immediately, sign in, and replace it when prompted.

## POSIX identity and shared-storage planning

Reserve UID/GID range `20000–59999` exclusively for Cluster Manager on the management
database, every workstation, and any shared NAS. The platform allocates a never-reused
equal UID/private-GID pair and nodes must create that exact identity. Monitor remaining
sequence capacity as part of user onboarding; exhaustion rejects creation rather than
reusing an identity.

Deploy the platform and all nodes from the same M8.2-or-newer release window because
the v1 desired-state shape now requires UID/GID. Incompatible payloads fail closed and
leave accounts unchanged. Pre-M8.2 development accounts using host-selected IDs must
be purged and recreated; there is intentionally no automatic renumbering.

Cluster Manager does not configure NFS or shared homes. If the lab supplies a shared
project export, use `root_squash`, permit only managed client networks, and document
that NFS `AUTH_SYS` trusts client-provided numeric IDs. A root-compromised client can
impersonate users despite consistent ownership; use stronger storage authentication if
that threat is in scope.

## HTTPS reverse proxy

The platform deliberately does not terminate TLS. Put Caddy, nginx, Traefik, or the
NAS reverse proxy in front of `127.0.0.1:3000`. The proxy must:

- present a trusted certificate and redirect HTTP to HTTPS;
- preserve `Host` and forward `X-Forwarded-Proto: https`;
- use the exact public URL configured as `ORIGIN`;
- restrict request-body sizes and apply normal access-log rotation;
- not expose PostgreSQL or any node credential/state file.

Nodes should use the public HTTPS URL and validate its certificate. An explicitly
private HTTP deployment must instead enroll nodes with `cluster-node setup
--allow-http`; the node records that opt-in in its root-only configuration.

## Updates

Back up first, fetch the current Compose file, set `PLATFORM_VERSION` to the intended
release tag, then pull and restart:

```bash
scripts/backup-database.sh backups/pre-upgrade.dump
git pull --ff-only
docker compose pull
docker compose up -d --wait
docker compose ps
```

The platform validates its environment and applies forward database migrations before
serving. `docker compose pull` downloads the image before the running container is
replaced. Read the release notes before rollback: an older app may not understand a
newer schema. Prefer restoring the pre-upgrade backup with the matching release and
set `PLATFORM_VERSION` back to that release tag.

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
`journalctl -u cluster-node --since=-1h -o cat` on a node. Request logs include
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
- **Identity collision:** username, UID, GID, private-group, or provenance mismatches
  fail before account/SSH mutation and appear on that assignment. Resolve the unrelated
  local identity or deliberately purge/recreate a provenance-owned development account;
  never delete the ledger to bypass the check.
- **Restart:** Compose restarts the app/database unless stopped by an operator; systemd
  restarts a failed node. Reconciliation is idempotent and does not delete homes.

Before escalating, record the platform/node versions, request ID, workstation name,
connection state, relevant audit event, and a narrow log window. Do not paste secrets.
