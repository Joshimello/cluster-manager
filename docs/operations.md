# Production operations

## Booking slots and limits

The shared schedule defaults to UTC, independently of account display timezone
preferences. It shows today and the next six days, with time running horizontally
and days vertically. Click a colored reservation bar to view its owner, GPU,
times, and slot type.

Regular bookings take one fixed slot: 00:00–04:00, 04:00–08:00, then two-hour slots
from 08:00 through midnight. Administrators can change the following global limits
in **Administration → Reservations → Booking limits**:

- Six standard slots per Monday–Sunday week.
- Three dynamic slots for today, two for tomorrow, and one for the day after.
- Two overnight slots per week, including both dynamic and standard bookings.

Dynamic slots are used first. Their usage is cumulative for the booking date: two
dynamic reservations made for tomorrow leave one available when that date becomes
today. Slots booked farther ahead use standard quota. Quotas span all GPUs and
workstations assigned to a user. Canceling before a slot starts restores quota;
a slot already used remains counted. Existing reservations keep their times, and
each occupied fixed slot counts as standard usage.

Admins can reserve any active GPU without an assignment. An explicit, audited
bypass can skip quota, slot-size, and booking-horizon restrictions. It consumes no
user quota and requires a reason. It still cannot overlap another reservation,
bypass a diagnostic safety window, or book in the past. The shared scheduling
timezone is also adjustable in Booking limits.

## Deleting users and workstations

Administrators can delete a user from **Administration → Users → Manage**, or a
workstation from its card or its **Settings** tab. Both actions require a confirmation
dialog, remove the entry from management, and cancel current and upcoming GPU
reservations. Deletion is permanent in the UI; it cannot be undone with Enable.

User deletion closes platform sessions immediately and revokes workstation
assignments. Nodes lock the managed Linux account on their next successful
synchronization. Existing processes and home files remain. Administrators cannot
delete their own account or the last active administrator.

Workstation deletion revokes node credentials and enrollment tokens, removes
assignments, and cancels queued updates and diagnostics. A dispatched update or
running diagnostic must finish before deletion. Deletion does not uninstall the
node service or change local accounts, processes, or files; use the documented node
uninstall workflow when retiring the physical machine.

Deleted database records are retained for audit and reservation history and for
safe Linux account reconciliation. Usernames, workstation names, and POSIX
identities remain reserved and cannot be reused.

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

### SSH instruction addresses

Nodes report existing non-loopback, non-link-local IP addresses with their heartbeats.
The address on the default IPv4 route is preferred, with IPv4 addresses preferred
within an interface. This reads interface and route information without probing or
changing networking. The first detected address is used in assigned users' dashboard
SSH commands.

Under **Administration → Workstations → select a workstation → Settings**, an admin
can set **SSH instruction address** to an IP address or hostname users can reach.
This override affects only displayed SSH instructions; it is never sent to the node
as desired configuration and does not change interfaces, routing, DNS, firewalls,
or SSH settings. Clearing it restores automatic selection. Heartbeats cannot replace
an override. Machines behind NAT, VPNs, or with multiple interfaces may need an override.

Existing nodes need the updated node binary to report IPs. Until an address is reported
or an admin sets one, the dashboard explains that the SSH address is unavailable.

### Managed workstation user metrics

**Administration → Workstations → select a workstation → Users** lists all platform
accounts and their access state on that workstation, including unassigned users.
Deleted identities with recorded usage remain labelled as deleted. Metrics include:

- Observed login time: elapsed time with at least one interactive Linux session;
  overlapping sessions count once per user.
- Occupied GPU time: elapsed GPU-hours summed across distinct GPUs per user, based
  on process UID and username. Multiple processes on one GPU count once. This is
  occupancy, not GPU compute utilization; shared GPUs count for each observed user.
- Scheduled GPU time: elapsed reservation hours and upcoming hours. Cancellations
  truncate the elapsed interval. This includes reservations before tracking started.
- Booked use: observed GPU time during the user's own bookings divided by reserved
  GPU time in monitored intervals. Only GPUs reported at both sample endpoints count
  toward this denominator. GPU time outside those bookings is shown separately.
- Last observed activity, current interactive sessions, GPU/process counts, and VRAM.
- Current allocated home-directory disk usage and its measurement timestamp.

Usage totals start with the first accepted heartbeat after this feature is enabled;
pre-existing activity is not reconstructed. Adjacent heartbeat samples estimate elapsed
time by holding the previous observation until the next accepted sample. Duplicate and out-of-order samples do not add usage. Reboots and gaps longer than
three expected heartbeat intervals (with a minimum gap threshold of two minutes) are
excluded. Lifetime aggregates persist after raw telemetry is cleaned up. Offline
live metrics are shown as unknown, not zero, and booking percentages exclude unobserved
intervals rather than treating offline bookings as idle.

Updated nodes include session UIDs and asynchronously scan only provenance-owned local
homes about every five minutes. Each `du` scan is bounded to five seconds, with a
30-second batch budget and rotation across large user lists. It reports allocated
blocks, does not follow symlinks, and excludes other filesystems. This is a storage
snapshot, not cumulative writes or storage outside the managed home. Invalid local
identity, failed scans, and missing reports appear as unavailable; measurements older
than 15 minutes are marked stale. No files or account settings are changed.

Older nodes still provide session and GPU observations. They cannot supply home storage
until their node binary is updated. A legacy session without a UID is attributed only
when that platform account has an applied assignment. GPU and storage observations
must match both the platform username and its immutable POSIX UID. Simulated nodes
label their metrics as simulated in this tab.
