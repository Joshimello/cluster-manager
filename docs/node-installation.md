# Install and manage a workstation node

The supported operator path installs the latest stable GitHub release and runs
interactive setup:

```bash
curl -fsSL https://raw.githubusercontent.com/Joshimello/cluster-manager/main/install-node.sh | sudo bash
```

Setup supports Debian 12 or newer and Ubuntu 24.04 or newer on `amd64` and `arm64`.
It verifies systemd, HTTPS settings, OpenSSH, `uidmap`, and `nvidia-smi`. It asks once before installing
missing OS packages. Have the platform URL, workstation name, and a fresh one-time
enrollment token ready. The token is read without echo and is not saved in the active
configuration.

## Reserve the managed POSIX range

Before setup, reserve UID/GID range `20000–59999` for Cluster Manager on every node
and on any NAS serving shared files. Cluster Manager assigns each platform user one
immutable UID and same-valued private primary GID, then creates that exact identity on
every assigned workstation. Do not let local account tooling, LDAP, or other
provisioners allocate from this range.

M8.2 does not renumber or adopt development accounts previously created with a
host-selected UID/GID. On a disposable development node, use the destructive uninstall
to purge those provenance-confirmed accounts, then set up the node again. Deleting only
the ledger is unsafe: retained usernames become unowned collisions.

To inspect the installer first:

```bash
curl -fsSL https://raw.githubusercontent.com/Joshimello/cluster-manager/main/install-node.sh \
  -o install-node.sh
less install-node.sh
sudo bash install-node.sh
```

The installer detects the CPU architecture, shows progress while downloading the
matching release binary, retries transient or stalled transfers, verifies it against
`checksums.txt`, and starts `cluster-node setup`. Existing
installations are upgraded with `sudo cluster-node upgrade` instead.

The canonical executable is `/usr/local/sbin/cluster-node`. Setup also creates the
managed command link `/usr/local/bin/cluster-node`, so the CLI remains available to
normal login shells whose PATH does not include the system administration directories.

## Lifecycle commands

```text
cluster-node setup [--platform-url URL] [--name NAME] [--enrollment-token-file PATH]
cluster-node run
cluster-node status
cluster-node doctor
cluster-node re-enroll [--enrollment-token-file PATH]
cluster-node upgrade [--version vX.Y.Z]
cluster-node uninstall [--dry-run] [--purge-created-users]
cluster-node version
cluster-node --version
```

Token files must be root-only. Tokens are unavailable as normal command-line arguments
because process listings and shell history can expose arguments.

`upgrade` selects the latest non-prerelease by default, or installs an exact tag. It
verifies SHA-256 before atomically replacing the executable and restarting the service.
An exact older tag is allowed for rollback. `re-enroll` retains the current credential
unless the platform accepts its replacement.

Useful troubleshooting commands are:

```bash
sudo cluster-node status
sudo cluster-node doctor
sudo systemctl status cluster-node
sudo journalctl -u cluster-node -n 100 --no-pager
```

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
shared homes remain outside this milestone.

For recovery or development, see the [manual procedure](node-installation-manual.md).
