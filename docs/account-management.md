# Account management and migration

Deploy the additive platform migration before installing node **v0.5.0 or newer**,
which provides `account-management-v1`. Existing nodes keep their desired-state protocol; the
Users tab displays **Node update required** until a capable node reports a complete
account scan. This feature does not move a database, copy home directories, change
networking, or renumber Linux identities.

## Import an existing account

Open **Administration → Workstations → workstation → Users**. Local discovery is
read-only and shows human accounts, numeric IDs, home paths, ownership, eligibility,
and conflict reasons. System accounts and accounts with disabled login shells are
excluded. An importable account must have:

- A platform-compatible username (3–32 lowercase letters, digits, `_` or `-`, beginning with a letter).
- Equal UID/GID in `20000–59999`, with a matching same-name private group.
- An ordinary, user-owned `/home/<username>` directory under the ordinary root-owned `/home` parent.
- No conflicting platform username, numeric identity, discovered identity reservation, or deleted user tombstone.

Choose **Import account**, review the exact identity, and type the username. This
explicitly transfers full management, including future deletion rights. A new
platform user is a regular user, keeps the local UID/GID, and receives a temporary
password shown once. They must change it at their first web login. An existing
active platform user with the exact username and UID/GID keeps their existing
platform password; credentials and assignment generations on other workstations
are unchanged.

The operation stays pending until the node validates the approved account
incarnation, records ownership durably, and confirms password synchronization.
Files, supplementary memberships, subordinate IDs, sessions, and jobs remain.
Ordinary reconciliation never adopts an unapproved account. A changed Linux
identity or ownership record blocks the operation. Changes to local passwd/group
files invalidate outstanding approvals conservatively; refresh discovery and
explicitly retry after reviewing the current identity.

Discovered numeric IDs are reserved permanently, including after cleanup. Imports
and allocation use the same database lock. A fresh database does not resolve
identity conflicts automatically: for example, a NAS administrator already using
UID `20000` cannot be merged with a different Linux user using that UID. Existing
NAS administrator identities are never changed by import.

## Revoke access or delete accounts

**Revoke access** locks login on that assignment while preserving the Linux account
and files. **Remove workstation account** revokes the assignment and removes only
that machine's managed Linux account. The platform user and other assignments remain.

**Delete user** immediately disables web access, revokes sessions and assignments,
and cancels applicable reservations. Cleanup is tracked on every workstation with
an account assignment, including previously revoked assignments. Deleted users'
cleanup remains visible under **Administration → Users → Account operations**.

Removal dialogs list machines and home paths, require the exact username, and offer
**Permanently delete home directory**, unchecked by default. Cleanup never kills
jobs. Processes, interactive sessions, home mounts, unsafe paths, or changed
ownership block removal. Private groups are removed only if their recorded identity
matches and no other user uses them. Unrelated files and external symlink targets
are preserved. Offline, blocked, failed, and expired operations require an explicit
admin retry; reconnecting or ending a job does not authorize deferred deletion.

Both the heartbeat and complete discovery scan must be at most 45 seconds old
before dispatch. Commands expire after 15 minutes. Node execution is serialized
with reconciliation and uses a root-only, durable
`/var/lib/cluster-manager/account-operations.json` journal. Retain this journal and
`managed-state.json`: they prevent duplicate commands and stale desired state from
deleting or recreating a subsequently replaced account. Receipts are retried after
connection loss, independently of command expiry. Requests and results are audited;
account snapshots never contain passwords, password hashes, or SSH keys.

Normal node uninstall preserves accounts, homes, the ownership ledger, and the
operation journal. The explicitly confirmed destructive uninstall also accepts
imported accounts belonging to the current workstation registration and uses the
same cleanup guards. Foreign ownership records remain preserved.

## Switch a workstation to another platform

1. Back up the new platform database. Install platform support and check readiness
   before updating the node. Resolve username/ID conflicts before importing.
2. On the workstation, stop **both** the old and current agent services if present:
   `cluster-manager-node.service` and `cluster-node.service`. Disable the old agent
   so it cannot reconnect and change passwords after migration. Do not uninstall
   with a purge option.
3. Make a root-only backup of `/etc/cluster-manager/`, the service configuration,
   `/var/lib/cluster-manager/node-credential`, `managed-state.json`, and
   `account-operations.json` when present. Back up valuable home data separately.
   Keep credentials private; do not paste them into tickets or audit notes.
4. Update the node binary to a release supporting `account-management-v1`. Create
   the workstation in the new platform and issue a **fresh enrollment token**.
   Run `sudo cluster-node setup` with the new platform URL, workstation name, and
   enrollment token. Keep the existing ownership ledger and journal. The new
   registration receives its own node credential; never reuse the old platform's
   credential. Confirm only the new service runs and reports to the new URL.
5. Wait for a fresh complete account scan. Previously managed accounts are shown
   with their old ownership records and remain available for explicit import.
   Import selected accounts rather than bulk-assigning colliding usernames.
6. Wait for **completed** import and password synchronization. Deliver new user
   credentials out of band; verify SSH with the new password and verify files,
   UID/GID, groups, subordinate IDs, and running work before retiring the old
   platform's workstation registration.

For the later Pro6000 migration, acceptance is: `ssdviggo` stays UID/GID `20003`,
files remain intact, and new credentials work; `joshualeanjw-test` can be explicitly
imported and removed through the platform. No production migration is performed
by implementing or testing this feature.

## User profile

All signed-in users, including admins, can edit their display name under
**Account → Identity**. Names are trimmed, repeated whitespace is collapsed, and
the resulting name must contain 1–120 characters. Duplicate names are allowed.
The server selects the user exclusively from the authenticated session. Username,
UID/GID, credentials, roles, and time zone stay unchanged; the displayed profile
refreshes after saving. Display name and time zone use separate actions and feedback.

## Validation

Use an isolated PostgreSQL database with all platform migrations applied:

```bash
cd platform
npm run test:database
npm run check
npm test
```

Linux integration tests create and delete real accounts **only inside a disposable
container**. `SYS_ADMIN` is used solely for the home bind-mount refusal test:

```bash
cd node
go test ./...
docker build -f integration/ubuntu.Dockerfile -t cluster-manager-account-tests .
docker run --rm --cap-add SYS_ADMIN --security-opt apparmor=unconfined cluster-manager-account-tests
```

The simulator advertises discovery and operations, seeds unmanaged `migrant`
(`20500`) and `migration-test` (`20501`) accounts, and models newly provisioned
accounts. Scenario `account-busy` refuses cleanup until an admin retries with a
new operation after the scenario changes. Simulated telemetry is not real usage.

An optional end-to-end simulator test requires a running, freshly seeded local
simulator and an isolated local database with a fixture administrator. It retains
the `migration-test` tombstone and operation history for review:

```bash
cd platform
RUN_ACCOUNT_SIMULATOR_TESTS=true ACCOUNT_SIMULATOR_WORKSTATION=account-simulator \
  npx vitest run src/lib/server/nodes/accounts.simulator.test.ts --maxWorkers=1
```
