# Install and manage a workstation node

The supported operator path installs the latest stable GitHub release, then runs
interactive setup as a separate command:

```bash
curl -fsSL https://raw.githubusercontent.com/Joshimello/cluster-manager/main/install-node.sh | sudo bash
sudo /usr/local/sbin/cluster-node setup
```

The piped installer is deliberately non-interactive: it only downloads, verifies,
and installs the CLI. Run `setup` separately so it is attached directly to your
terminal and Ctrl-C always works.

HTTPS is the default. If the platform deliberately uses HTTP inside an encrypted,
access-controlled private network, opt in explicitly during installation:

```bash
curl -fsSL https://raw.githubusercontent.com/Joshimello/cluster-manager/main/install-node.sh \
  | sudo bash
sudo /usr/local/sbin/cluster-node setup --allow-http
```

This does not make HTTP safe on an untrusted LAN or the public internet.

Setup supports Debian 12 or newer and Ubuntu 24.04 or newer on `amd64` and `arm64`.
It verifies systemd, platform URL security, OpenSSH, `uidmap`, and `nvidia-smi`. It asks once before installing
missing OS packages. Have the platform URL, workstation name, and a fresh one-time
enrollment token ready. The token is read without echo and is not saved in the active
configuration.

Setup also offers optional GPU diagnostics. If accepted, it installs Podman and NVIDIA
Container Toolkit from NVIDIA's signed repository, generates the CDI specification,
and pulls the exact release-pinned `gpu-burn` image. Declining does not affect normal
account reconciliation or monitoring. Enable or repair it later with:

```bash
sudo /usr/local/sbin/cluster-node diagnostics setup
```

## Reserve the managed POSIX range

Before setup, reserve UID/GID range `20000–59999` for Cluster Manager on every node
and on any NAS serving shared files. Cluster Manager assigns each platform user one
immutable UID and same-valued private primary GID, then creates that exact identity on
every assigned workstation. Do not let local account tooling, LDAP, or other
provisioners allocate from this range.

Cluster Manager does not renumber or adopt development accounts previously created
with a host-selected UID/GID. On a disposable development node, use the destructive uninstall
to purge those provenance-confirmed accounts, then set up the node again. Deleting only
the ledger is unsafe: retained usernames become unowned collisions.

To inspect the installer first:

```bash
curl -fsSL https://raw.githubusercontent.com/Joshimello/cluster-manager/main/install-node.sh \
  -o install-node.sh
less install-node.sh
sudo bash install-node.sh
sudo /usr/local/sbin/cluster-node setup
```

The installer detects the CPU architecture, shows progress while downloading the
matching release binary and, on supporting releases, its diagnostic trust manifest,
retries transient or stalled transfers, verifies every downloaded asset against
`checksums.txt`, and installs them root-only. Setup is a separate
explicit command. Rerunning the installer may replace an unconfigured CLI when setup
has not completed. Configured installations are upgraded with
`sudo /usr/local/sbin/cluster-node upgrade` instead.

## Lifecycle commands

The executable intentionally lives in `/usr/local/sbin` because node lifecycle
operations are root-controlled. That directory may be absent from an unprivileged
login shell's PATH; invoke administrative commands through `sudo`, as shown below.

```text
cluster-node setup [--platform-url URL] [--name NAME] [--enrollment-token-file PATH] [--allow-http]
cluster-node run
cluster-node status
cluster-node doctor
cluster-node diagnostics setup
cluster-node re-enroll [--enrollment-token-file PATH]
cluster-node upgrade [--version vX.Y.Z]
cluster-node uninstall [--dry-run] [--purge-created-users]
cluster-node version
cluster-node --version
```

Token files must be root-only. Tokens are unavailable as normal command-line arguments
because process listings and shell history can expose arguments.

`upgrade` selects the latest non-prerelease by default, or installs an exact tag. It
verifies SHA-256 before atomically replacing the executable and diagnostic manifest,
then restarts the service.
An exact older tag is allowed for rollback. `re-enroll` retains the current credential
unless the platform accepts its replacement.

## Updates from the admin UI

Nodes that advertise managed-update support can be updated from **Administration →
Workstations → Node software update**. Enter an exact newer stable release and type the
workstation name to confirm. The node downloads the GitHub release itself, verifies the
published SHA-256 checksum and the candidate's reported version, and reports progress
back to the platform.

Before replacing anything, the node saves its current binary and systemd unit and arms
a local two-minute rollback watchdog. The replacement is accepted only after it starts,
authenticates to the platform, and completes three consecutive healthy heartbeats. If it crashes, cannot
authenticate, or loses platform connectivity during confirmation, the watchdog restores
the prior binary and unit and restarts the service. Configuration, credentials, Linux
users, homes, and workloads are never part of an update.

Existing nodes need one manual upgrade to a release that supports managed updates:

```bash
sudo /usr/local/sbin/cluster-node upgrade
```

After its next heartbeat, the admin page will show **Managed updates: Supported**.
Roll out a new release to one non-critical node first and verify its heartbeat, version,
GPU telemetry, and `cluster-node doctor` result before updating the remaining nodes.

Useful troubleshooting commands are:

```bash
sudo cluster-node status
sudo cluster-node doctor
sudo systemctl status cluster-node
sudo journalctl -u cluster-node -n 100 --no-pager
```

## GPU diagnostics

An enabled node advertises `gpu-diagnostics-v1` only after Podman, NVIDIA CDI, the
root-only trust manifest, and the exact image digest all validate. Administrators start
a whole-system or single-GPU test from the workstation page. The platform requires
fresh idle telemetry and a reservation-free safety window; the node repeats process,
identity, digest, and temperature checks immediately before launch.

The workload runs in a dedicated transient systemd service with no network. The node
keeps sending telemetry, stops locally at the selected thermal limit or the absolute
90°C ceiling, and enforces its deadline even if the platform disconnects. Diagnostic
recovery state is stored at `/var/lib/cluster-manager/diagnostics-state.json` so a node
restart monitors only the exact unit it created.

The result is a stress-test signal, not a hardware-health guarantee. A failed or
thermally stopped test should be investigated before the workstation returns to use.

## Uninstall safely

Normal uninstall removes the software, service, active configuration, and credential,
but retains Linux users, same-name private groups, homes, group memberships, subordinate IDs, SSH policy, and
`/var/lib/cluster-manager/managed-state.json`:

```bash
sudo cluster-node uninstall
```

Disable or revoke the workstation separately in the platform. Reinstalling can trust
retained provenance only when enrollment returns the same platform workstation ID. A
different identity treats retained usernames as collisions. Never delete the retained
provenance ledger casually: without it the node cannot prove ownership, so every
existing matching username becomes a collision.

To preview and perform destructive cleanup:

```bash
sudo cluster-node uninstall --dry-run --purge-created-users
sudo cluster-node uninstall --purge-created-users
```

The destructive form lists provenance-confirmed users, IDs, homes, sizes, process and
session activity, and mounts. It refuses busy or identity-mismatched accounts, requires
typing `DELETE <hostname>`, rechecks immediately before deletion, and never terminates
processes. Only accounts proven to have been created by this node are eligible. A
same-name private group is removed only after its recorded user and only when its GID
still exactly matches provenance. Modified
or unrecognized host state is preserved and reported. Platform history is never deleted.

## Optional shared NFS storage

Cluster Manager keeps `/home/<user>` local and does not mount or configure NFS. For an
operator-managed shared project export, enable `root_squash`, restrict the export to
managed client networks, and use the reserved range above on the NAS and clients.
Consistent numeric IDs make normal NFS `AUTH_SYS` file ownership coherent across
nodes; they do not protect the server from a privileged malicious client capable of
presenting another UID. Shared project groups, ACL policy, LDAP/FreeIPA, Kerberos, and
shared homes are not currently managed by Cluster Manager.

For recovery or development, see the [manual procedure](node-installation-manual.md).
