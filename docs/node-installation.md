# Ubuntu node installation

These instructions install the privileged Cluster Manager node directly on a supported
Ubuntu LTS workstation. The node uses narrowly scoped reconciliation; it does not expose
an arbitrary command API and never deletes Linux accounts, home directories, or user data.

## Before installation

The workstation needs:

- Ubuntu 24.04 LTS or a later supported LTS release
- OpenSSH server
- HTTPS connectivity to the Cluster Manager platform
- a workstation record and one-time enrollment token created by an administrator

Install the operating-system prerequisites:

```bash
sudo apt update
sudo apt install openssh-server uidmap
```

Rootless Podman is recommended for researchers and may be installed now or later:

```bash
sudo apt install podman
```

## Install the binary and configuration

Build the Linux node binary from a trusted checkout or CI artifact:

```bash
cd node
CGO_ENABLED=0 go build -trimpath -o cluster-manager-node ./cmd/cluster-manager-node
sudo install -o root -g root -m 0755 cluster-manager-node /usr/local/sbin/cluster-manager-node
cd ..
```

Create its private state and configuration directories:

```bash
sudo install -d -o root -g root -m 0700 /etc/cluster-manager /var/lib/cluster-manager
sudo install -o root -g root -m 0600 \
  node/deploy/config.example.json /etc/cluster-manager/node.json
sudoedit /etc/cluster-manager/node.json
```

Set `platformUrl`, `workstationName`, and the one-time `enrollmentToken`. Production
platform URLs must use HTTPS. The HTTP override is only for isolated local development.

Install and start the checked-in systemd unit:

```bash
sudo install -o root -g root -m 0644 \
  node/deploy/cluster-manager-node.service /etc/systemd/system/cluster-manager-node.service
sudo systemctl daemon-reload
sudo systemctl enable --now cluster-manager-node
sudo journalctl -u cluster-manager-node -f
```

After the first successful enrollment, remove `enrollmentToken` from
`/etc/cluster-manager/node.json` and restart the service. The generated node credential
in `/var/lib/cluster-manager/node-credential` is reused and must remain mode `0600`.

## Account and SSH behavior

The immutable platform username is also the Linux username. The platform validates a
conservative POSIX-safe form: 3–32 lowercase letters, numbers, `_`, or `-`, beginning
with a letter.

For an active assignment, the node:

- creates the local account and home directory when absent;
- preserves existing home contents and changes ownership only on the home root;
- adds the account to the `cluster-manager-users` group;
- ensures subordinate UID/GID ranges for rootless Podman;
- applies the Linux SHA-512 crypt hash received through authenticated desired state;
- enables password-only SSH for the managed group and disables public-key login for it.

The platform password and SSH password are the same input, but plaintext is never
stored or sent to the node. The platform keeps an Argon2id verifier for web login and a
separately salted Linux-compatible verifier for the assigned node.

Revocation locks the Linux password while preserving the account, home directory, and
files. Existing processes and SSH sessions are not terminated. If desired state is
unavailable or invalid, the node makes no account changes.

## Verification and troubleshooting

Check status and recent logs:

```bash
sudo systemctl status cluster-manager-node
sudo journalctl -u cluster-manager-node -n 100 --no-pager
sudo sshd -T -C user=example,host=localhost,addr=127.0.0.1 | \
  grep -E 'passwordauthentication|pubkeyauthentication|authenticationmethods'
```

The platform shows each assignment as pending, applied, or errored. Node errors are
reported without password hashes. Correct the underlying Ubuntu configuration and let
the next reconciliation retry; unchanged desired state is safe to reapply.

Run the disposable Ubuntu 24.04 acceptance test from the repository root:

```bash
docker build -f node/integration/ubuntu.Dockerfile \
  -t cluster-manager-ubuntu-reconcile-test node
docker run --rm cluster-manager-ubuntu-reconcile-test
```

It verifies account and home creation, idempotency, real sshd password login, password
replacement, public-key rejection, revocation, and home-data preservation.
