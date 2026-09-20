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
If operators must also use other names or addresses, `CSRF_TRUSTED_ORIGINS` accepts a
comma-separated list of additional exact origins, such as
`http://192.168.50.141:3000,http://localhost:3000`. Wildcards, paths, credentials, and
mixed HTTP/HTTPS lists are rejected. Keep this list as small as possible; it relaxes
form-submission origin checks only for the named origins and does not configure CORS.
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

Deploy platform and node versions that both support platform-assigned POSIX identities,
because the v1 desired-state shape requires UID/GID. Incompatible payloads fail closed
and leave accounts unchanged. Development accounts using host-selected IDs must be
purged and recreated; there is intentionally no automatic renumbering.

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

### Workstation node updates

Once a node advertises managed-update support, an administrator can install an exact
newer stable release from that workstation's detail page. Only online, active, enrolled
nodes are eligible, only one update may be active per node, and the administrator must
type the workstation name before dispatch. A pending instruction can be cancelled until
the node claims it.

The node verifies GitHub's release checksum and the candidate version before changing
the installation. It then saves the current binary and service unit and arms a local
rollback watchdog. The backup is removed only after the replacement authenticates and
sends a healthy heartbeat; failure or loss of management-plane connectivity restores the
previous version automatically. Success requires three consecutive authenticated
heartbeats. Updates do not alter node configuration, credentials,
accounts, homes, jobs, or provenance.

Use a canary rollout: update one non-critical node, wait for **Succeeded**, confirm the
reported version and telemetry, and run `sudo /usr/local/sbin/cluster-node doctor` before
continuing. A node without the managed-update capability must be upgraded manually once.
If an update reports **Rolled back** or **Failed**, preserve the node journal and platform
audit record, investigate the release, and do not retry it across the fleet.

### GPU stress diagnostics

GPU diagnostics are deliberately admin-only. Confirm that the workstation is online,
the intended GPUs are idle, and no reservation overlaps the displayed safety window.
Choose the shortest useful duration and retain the default 85°C cutoff unless the
hardware owner has approved another value. The node always enforces a 90°C ceiling.

While a run is pending or active, the platform blocks overlapping reservations and node
updates. It never cancels an existing reservation to make room for a test. Use the
diagnostic detail page for live utilization, VRAM, temperature, power, bounded logs, and
per-GPU results. Cancellation is best effort through the platform, while duration and
thermal termination remain local safety controls.

If diagnostics are unavailable, run `sudo /usr/local/sbin/cluster-node doctor`, then
`sudo /usr/local/sbin/cluster-node diagnostics setup`. Do not replace the image tag or
edit the trust manifest manually; upgrades distribute a checksummed manifest containing
the exact permitted GHCR digest.

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

The explicit confirmation flag prevents accidental replacement. The production rehearsal
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

Expired sessions are deleted in batches. Workstation and GPU observations, including
GPU process rows, are kept for `TELEMETRY_RETENTION_HOURS` (24 by default, allowed range
1–720) and removed in bounded batches. The monitoring UI offers 15-minute, 1-hour,
6-hour, and 24-hour graphs; if retention is shorter than the selected window, it shows
only the available portion. Current workstation and GPU state remains available after
historical rows expire. Audit events, users, assignments, reservations, and stop requests
are not automatically deleted.

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
- **Node update failure:** the node keeps a local copy of the prior binary and unit and
  restores them unless the replacement authenticates and confirms health before the
  watchdog deadline. Review `journalctl -u cluster-node` and the update history before
  trying another release.
- **Restart:** Compose restarts the app/database unless stopped by an operator; systemd
  restarts a failed node. Reconciliation is idempotent and does not delete homes.

Before escalating, record the platform/node versions, request ID, workstation name,
connection state, relevant audit event, and a narrow log window. Do not paste secrets.
