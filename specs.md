# Cluster Manager

Build an internal lab infrastructure management platform called **`cluster-manager`**.

The system manages a small number of shared Ubuntu GPU workstations used by researchers and students over SSH.

This is not intended to be an HPC scheduler or Kubernetes-style cluster. Each user is permanently assigned to one workstation, their home directory, source code, environments, and local working data remain on that workstation's local NVMe storage, and they SSH directly into that machine.

The centralized platform provides:

- user and workstation management
- workstation assignment
- local Linux account provisioning
- synchronized platform and workstation password management
- workstation health monitoring
- GPU monitoring
- GPU reservations
- detection of GPU reservation conflicts
- process attribution
- stop requests
- admin-controlled process termination
- audit logging

The initial system should remain intentionally small and easy to understand, develop, deploy, and maintain.

---

## 1. Technology Stack

### Control Platform

Use:

- **SvelteKit**
- TypeScript
- PostgreSQL
- **Drizzle ORM**
- Docker for development and deployment

SvelteKit should contain both:

- frontend/UI
- backend/API/business logic

Do not create a separate backend service.

### Node Service

Each managed workstation runs a small privileged service written in **Go**.

Call this component the **node service** or simply **node**.

Do not call it an "agent".

The node is responsible for interacting with the operating system and NVIDIA hardware.

Production nodes should run directly on Ubuntu as a systemd service rather than inside Docker.

### Containers for researchers

Researchers should use:

- rootless Podman
- Docker-compatible container images
- Compose-compatible workflows where practical

Users should not require sudo access or membership in the Docker group.

---

# 2. Expected Scale

Initial deployment:

- 2 Ubuntu workstations
- 2 × RTX PRO 6000 GPUs per workstation
- approximately 10–30 users

Likely future deployment:

- approximately 5 workstations
- additional RTX 5090 machines
- up to roughly 100 users should remain practical without redesigning the architecture

Do not optimize for large distributed-cluster scale.

Prefer simplicity.

---

# 3. Repository Structure

Use a single monorepo named:

`cluster-manager`

Keep the repository minimal.

Suggested high-level layout:

```text
cluster-manager/
├── platform/
│   ├── src/
│   ├── drizzle/
│   ├── package.json
│   ├── drizzle.config.ts
│   └── Dockerfile
│
├── node/
│   ├── cmd/
│   ├── internal/
│   ├── go.mod
│   └── Dockerfile
│
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── Makefile
└── README.md
```

Do not create unnecessary packages, microservices, abstraction layers, or scripts.

Create additional structure only when the implementation genuinely needs it.

---

# 4. Overall Architecture

The system consists of three primary runtime components:

```text
                Cluster Manager Platform
                     SvelteKit
                        │
                        │
                   PostgreSQL
                        │
                authenticated API
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
      Node WS01                       Node WS02
      Go service                      Go service
        │                               │
        ▼                               ▼
    Ubuntu host                     Ubuntu host
    Linux users                     Linux users
    SSH                             SSH
    NVIDIA GPUs                     NVIDIA GPUs
    Local NVMe                      Local NVMe
    Podman                          Podman
```

The SvelteKit platform is the centralized source of truth.

The node service reconciles and reports workstation state.

---

# 5. Workstation Model

Each workstation is an independent developer workstation.

A workstation contains:

- Ubuntu Server latest LTS
- local NVMe storage
- NVIDIA GPU(s)
- SSH server
- local Linux accounts
- rootless Podman
- cluster-manager node service

Users work directly on their assigned workstation through SSH.

Example:

```text
Alice
  workstation: ws01
  home: /home/alice on ws01

Bob
  workstation: ws01
  home: /home/bob on ws01

Carol
  workstation: ws02
  home: /home/carol on ws02
```

There is no shared home directory.

A user should normally belong to exactly one workstation.

Admins may change or revoke assignments.

---

# 6. NAS Usage

A NAS exists separately from workstation-local storage.

Use the NAS for things such as:

- datasets
- experiment artifacts
- model checkpoints
- shared files
- backups where appropriate

The cluster-manager control platform may also run on the NAS if the NAS supports running Docker workloads.

Do not require researchers' development environments, package caches, container layers, or home directories to live on the NAS.

Those should remain on local NVMe.

---

# 7. User Management

Admins must be able to:

- create users
- edit users
- disable users
- assign users to workstations
- revoke workstation access
- reset credentials
- view user storage/resource usage

For v1, use **centrally managed local Linux accounts** rather than LDAP or FreeIPA.

The platform is the source of truth.

The immutable platform username is also the user's Linux username. It must be 3–32
characters, begin with a lowercase letter, and contain only lowercase letters,
numbers, underscores, or hyphens. Admins choose this username when creating a user.

The node service is responsible for reconciling the required local Linux users on each workstation.

If Alice is assigned to `ws01`, the node on `ws01` should ensure her Linux account exists.

If her access is revoked, the node should disable access appropriately without deleting user data unless explicitly requested.

Do not build a generic remote-shell mechanism to accomplish this.

Implement narrowly scoped operations.

---

# 8. Authentication

The web platform and each assigned workstation use the same user-entered password in
v1. Cluster Manager must synchronize password changes to the assigned Linux account
without storing or transmitting plaintext passwords.

### Platform

Users should authenticate to the SvelteKit application.

Use secure password hashing and normal web sessions.

Whenever a password is created, changed, or reset, derive both the platform's strong
application-login verifier and a separately salted Linux/PAM-compatible password
hash from the password while it is present in the request. Store only the one-way
hashes. The platform and Linux hashes represent the same password but must use the
format appropriate to each verifier.

### Workstations

Cluster Manager-managed users authenticate over SSH with their synchronized platform
password. SSH public-key access is not part of v1, and the platform must not provide
SSH-key management.

Changing a platform password or completing an admin-issued password reset must update
the desired workstation password hash. The node applies only the Linux-compatible
hash; it must never receive the plaintext password. The desired-state API must treat
this hash as sensitive credential material and expose it only to the authenticated
node for the user's assigned workstation.

Any SSH daemon policy installed by Cluster Manager should apply specifically to
Cluster Manager-managed researcher accounts so it does not accidentally remove a
separate administrator's recovery access.

Never store plaintext passwords.

Temporary/generated credentials should only be exposed where strictly necessary.

This choice is being made during development before production deployment. No
compatibility migration or backfill for pre-Milestone-3 development credentials is
required; development data may be reset and accounts recreated when the schema
changes.

---

# 9. SSH Access

Users SSH directly into their assigned workstation.

Example:

```bash
ssh alice@ws01
```

They enter the same password used to log into the Cluster Manager platform. Password
authentication is the only supported SSH method for Cluster Manager-managed users in
v1.

A user does not need a GPU reservation to SSH into their workstation.

They may always perform normal userspace work such as:

- editing code
- running Codex CLI
- compiling software
- Python development
- creating virtual environments
- downloading data
- CPU workloads
- using tmux
- running rootless containers

Users should not have sudo access.

---

# 10. GPU Reservation System

Every physical GPU is independently reservable.

Example:

```text
WS01
  GPU 0 - RTX PRO 6000
  GPU 1 - RTX PRO 6000
```

Reservations should support:

- 30-minute increments
- a start time
- an end time/duration
- a user
- a specific physical GPU
- cancellation
- admin override

Normal reservations should have a maximum duration of approximately **6 hours**.

The UI may suggest shorter defaults such as 2 hours.

Users should only be able to reserve GPUs located on their assigned workstation.

Two reservations for the same GPU must never overlap.

Admins may override normal booking rules where necessary.

A reasonable initial advance booking horizon is roughly 7 days.

Do not implement GPU-hour quotas or complicated fairness algorithms in v1.

---

# 11. GPU Reservation Enforcement

**Do not implement GPU ownership enforcement in v1.**

Reservations are initially a coordination mechanism.

The system must not attempt to:

- hide GPUs from users
- manipulate GPU device permissions
- enforce CUDA_VISIBLE_DEVICES
- create GPU cgroups
- automatically terminate workloads at reservation expiry

Users remain technically capable of starting processes on any GPU on their assigned workstation.

Instead, v1 should rely on monitoring, conflict detection, stop requests, and administrator intervention.

The design should not make future enforcement impossible, but do not implement it now.

---

# 12. GPU Monitoring

The node service must discover and report:

- installed NVIDIA GPUs
- stable GPU identifiers/UUIDs
- GPU model
- utilization
- VRAM usage
- temperature where available
- GPU-consuming processes

For GPU processes, report enough information to determine:

- GPU
- PID
- Linux UID
- Linux username
- process/command information
- GPU memory consumption
- process start identity where practical

Prefer stable NVIDIA/Linux APIs where practical rather than brittle parsing.

Exact implementation is left to Codex.

---

# 13. Reservation vs Observed Usage

The system must treat these as separate concepts:

```text
Reservation state
= who is supposed to use the GPU

Observed state
= who is actually using the GPU
```

The backend should correlate them.

The UI should be able to represent conditions such as:

### Available

```text
GPU has no reservation
GPU has no meaningful active process
```

### Booked and idle

```text
Alice has booked GPU0
No active GPU workload yet
```

### Booked and active

```text
Alice booked GPU0
Alice is currently using GPU0
```

### Unbooked use

```text
Nobody booked GPU0
Bob is using GPU0
```

### Reservation conflict

```text
Alice booked GPU0
Bob is using GPU0
```

Do not assume GPU utilization determines ownership.

---

# 14. Stop Request Workflow

If a user has reserved a GPU but another user's process is occupying it, the reservation owner should be able to submit a **stop request**.

Example workflow:

```text
Alice booked GPU0
        ↓
Bob is currently using GPU0
        ↓
Cluster Manager detects conflict
        ↓
Alice clicks "Request stop"
        ↓
Admin sees pending request
        ↓
Admin reviews process details
        ↓
Admin may terminate Bob's process
```

Users must not directly terminate processes belonging to other users.

Only authorized admins may perform termination.

The system should handle the case where the target process exits before the admin responds.

---

# 15. Process Termination

The node service should support a narrowly defined privileged operation for terminating a process.

Do not implement:

```text
execute arbitrary shell command
```

or any generic remote command API.

Instead implement a semantic operation such as:

```text
terminate this specific process
```

Before termination, the node must verify that the process still corresponds to the expected identity.

Account for PID reuse.

Use information such as:

- PID
- expected UID
- process start identity/time where practical

Prefer graceful termination first.

If appropriate, escalation may be:

```text
SIGTERM
↓
short grace period
↓
SIGKILL if necessary
```

All admin termination actions must be audit logged.

---

# 16. Node Responsibilities

Keep the Go node intentionally narrow.

It should handle approximately:

1. workstation registration
2. periodic heartbeat
3. basic workstation inventory
4. CPU/RAM/storage information
5. GPU discovery
6. GPU telemetry
7. GPU process discovery
8. logged-in user/session information
9. local Linux user reconciliation
10. synchronized Linux password reconciliation
11. per-user disk usage where practical
12. narrowly scoped process termination

It should not contain:

- job scheduling
- GPU allocation logic
- reservation decision logic
- arbitrary command execution
- complex policy logic
- container orchestration

Those belong either in the central platform or are outside scope.

---

# 17. Desired-State Approach

The platform should act as the source of truth for workstation configuration.

The node should periodically obtain the desired state and reconcile the workstation toward it.

Examples of desired state include:

- users who should exist
- whether a user is active
- the current Linux-compatible password hash for each assigned user

The exact API and data model are implementation details.

Prefer this pattern over a design where the platform continuously pushes arbitrary commands to nodes.

The system should tolerate short control-plane outages.

---

# 18. Node Communication

Communication between nodes and the platform must be authenticated.

The precise authentication mechanism is left to Codex.

Requirements:

- nodes must identify themselves securely
- one node must not impersonate another
- communication should occur over HTTPS in production
- node credentials should be revocable
- secrets should not be hard-coded in source

For a trusted LAN deployment, keep the solution practical rather than building excessive PKI infrastructure.

---

# 19. Failure Behavior

The cluster should remain usable when the control platform is temporarily unavailable.

If the central platform goes down:

- existing SSH sessions continue
- Linux accounts remain usable
- users retain access to their workstation
- running workloads continue
- Podman workloads continue
- no destructive reconciliation occurs
- new reservations may temporarily be unavailable

If a node service goes offline:

- SSH should continue functioning
- existing user processes should continue functioning
- the platform should mark the node as offline/stale

The management system must never become a hard dependency for already-running user workloads.

---

# 20. Monitoring Scope

The admin dashboard should expose at least:

### Per workstation

- online/offline
- heartbeat age
- uptime
- CPU utilization
- RAM utilization
- local disk utilization
- logged-in users
- installed GPUs

### Per GPU

- model
- utilization
- VRAM usage
- temperature where available
- reservation owner
- active processes
- owning Linux users
- detected conflicts

### Per user

- assigned workstation
- active/inactive state
- disk usage where available
- current GPU processes
- current/upcoming reservations

Do not build an overly elaborate observability stack for v1.

The architecture should allow Prometheus/Grafana to be added later without a rewrite.

---

# 21. Audit Logging

Important privileged actions should generate audit events.

At minimum audit:

- user creation
- user disable/enable
- workstation assignment
- workstation access revocation
- synchronized password changes and resets
- admin credential resets
- reservation creation/cancellation where useful
- admin reservation overrides
- stop request creation
- stop request resolution
- process termination

An audit event should make it possible to determine:

```text
who
did what
to what
when
```

Do not overengineer this into a separate logging service.

---

# 22. Roles

At minimum support two roles:

### User

Can:

- log into platform
- view assigned workstation
- change the password used by both the platform and assigned workstation
- view own usage
- see relevant GPU availability
- create/cancel own GPU reservations
- request intervention when another process conflicts with their reservation

### Admin

Can additionally:

- manage users
- assign users to workstations
- revoke access
- view all workstation state
- view all reservations
- override reservations
- view GPU processes
- review stop requests
- terminate processes
- inspect audit history

Leave room for additional roles later but do not build a complex RBAC system in v1.

---

# 23. Containers

Support rootless **Podman** as the recommended researcher container runtime.

The expected workflow should accommodate:

```bash
podman run ...
podman compose up
```

and running Docker-compatible container images.

Researchers must not need privileged containers or sudo for normal workflows.

GPU process monitoring should still correctly attribute GPU workloads launched from Podman to the corresponding Linux user whenever possible.

---

# 24. Development Environment

Local development should require as little setup as possible.

The desired workflow is approximately:

```bash
git clone ...
cd cluster-manager
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

This should start enough infrastructure to develop the full product without requiring real GPUs.

At minimum:

```text
platform
PostgreSQL
simulated node ws01
simulated node ws02
```

Do not create a separate simulator application.

The normal Go node binary should support a **simulation mode**.

Example conceptually:

```text
NODE_SIMULATE=true
NODE_NAME=ws01
```

Simulation mode should fake:

- hardware inventory
- CPU/RAM/storage utilization
- GPUs
- GPU utilization
- GPU processes
- online/offline state
- users where needed

The simulated node should exercise the same node/platform API as a production node.

---

# 25. Development Simulation

Provide a simple way to generate useful development scenarios.

Examples:

```text
WS01 has two RTX PRO 6000 GPUs

Alice and Bob belong to WS01

Alice reserves GPU0

simulation reports:
Bob / python train.py / GPU0

platform displays:
reservation conflict
```

There should be an easy way during development to simulate:

- free GPU
- busy GPU
- reservation conflict
- workstation offline
- high CPU
- high disk usage
- multiple GPU processes

This may be implemented through a small development-only UI or another simple mechanism.

Avoid building a large simulator framework.

---

# 26. Production Deployment

Keep deployment straightforward.

### Control plane

Run through Docker Compose on the management host/NAS.

Initially this likely consists of:

```text
platform
postgres
```

Avoid unnecessary supporting services.

The target operational experience should be approximately:

```bash
docker compose up -d
```

### Node

Build a Go binary.

Install it on each Ubuntu workstation.

Run it through systemd.

Do not require Docker to run the production node service.

Provide simple installation/configuration instructions.

---

# 27. Database and Internal API Design

Codex should determine:

- exact database schema
- Drizzle table definitions
- indexes and constraints
- migrations
- internal module organization
- endpoint structure
- request/response types
- reservation transaction strategy
- authentication implementation

However, the implementation must preserve the behavioral requirements in this document.

In particular, reservation conflicts must be prevented reliably even when two users attempt to book the same GPU concurrently.

Do not rely solely on frontend validation.

---

# 28. Code Quality Philosophy

This is a small internal research-lab tool.

Prefer:

- readable code
- simple abstractions
- few dependencies
- boring architecture
- obvious execution flow
- secure privileged operations
- easy local development
- easy deployment

Avoid:

- microservices
- event buses
- Kubernetes
- unnecessary Redis
- complex domain frameworks
- repository/service/controller layers for their own sake
- premature generic abstractions
- separate services when a SvelteKit module is sufficient
- huge collections of scripts

Start simple and refactor only when the codebase proves it needs additional structure.

---

# 29. Suggested Implementation Order

Implement in vertical increments.

## Milestone 1 — Platform skeleton

Create:

- SvelteKit platform
- PostgreSQL
- Drizzle setup/migrations
- authentication
- basic user/admin roles
- Docker development environment

The application should boot through Docker Compose.

## Milestone 2 — Node connection

Implement:

- Go node
- node registration/authentication
- heartbeat
- workstation inventory
- online/offline status
- simulation mode

The UI should show simulated workstations.

## Milestone 3 — User provisioning

Implement:

- user creation
- workstation assignment
- desired-state retrieval
- local Linux account reconciliation
- synchronized SSH password reconciliation

Validate against an actual disposable Ubuntu machine/VM in addition to simulated mode.

## Milestone 4 — GPU monitoring

Implement:

- GPU inventory
- GPU telemetry
- GPU process discovery
- PID/UID/user attribution

Simulation mode must support the same information.

## Milestone 5 — Reservations

Implement:

- GPU reservation UI
- 30-minute increments
- maximum normal duration
- no overlapping reservations
- workstation ownership rules
- upcoming/current reservation views

## Milestone 6 — Conflict detection

Correlate:

```text
reservation owner
vs
observed process owner
```

Show clear states in the UI.

## Milestone 7 — Stop requests

Implement:

- user stop request
- admin request queue
- stale request handling
- narrowly scoped process termination
- auditing

## Milestone 8 — Operational polish

Add:

- useful dashboard
- storage usage
- node status
- audit browsing
- basic deployment documentation
- systemd unit for node service
- production Docker Compose configuration

---

# 30. Important Out-of-Scope Items for V1

Do not implement unless necessary for the requirements above:

- Slurm
- Kubernetes
- LDAP
- FreeIPA
- shared home directories
- job queues
- batch scheduling
- GPU partitioning
- MIG
- GPU permission enforcement
- automatic GPU process termination on reservation expiry
- GPU-hour accounting quotas
- advanced fair-share scheduling
- distributed storage
- automatic driver management
- workstation reboot controls
- arbitrary remote shell execution
- container orchestration
- complex notification infrastructure

The architecture may leave room for some of these later, but v1 should remain small.

---

# 31. Primary User Flows

The finished v1 should support these flows cleanly.

## User onboarding

```text
Admin creates Alice
→ assigns Alice to WS01
→ WS01 node provisions Alice
→ Alice completes the platform password setup
→ WS01 applies the matching Linux password hash
→ Alice SSHs into WS01 with the same password
→ Alice develops normally
```

## Normal GPU use

```text
Alice logs into Cluster Manager
→ views WS01 GPUs
→ reserves GPU0 from 14:00–17:00
→ SSHs into WS01
→ runs workload
→ node detects Alice's process
→ dashboard shows reservation matched with Alice's usage
```

## GPU conflict

```text
Alice owns reservation for GPU0
→ Bob is currently running a workload on GPU0
→ node reports Bob's process
→ platform detects reservation conflict
→ Alice clicks Request Stop
→ admin reviews request
→ admin terminates Bob's process
→ node confirms process gone
→ action is audit logged
```

## Platform outage

```text
Cluster Manager temporarily goes offline
→ Alice remains SSHed into WS01
→ her workload keeps running
→ Linux accounts remain usable
→ platform returns later
→ node reconnects and resumes reporting
```

These flows should guide implementation decisions more strongly than theoretical abstractions.

---

# 32. Definition of Success

The first release is successful when the lab can use Cluster Manager to:

1. centrally create and assign researcher accounts,
2. provision those accounts onto the appropriate Ubuntu workstation,
3. manage SSH access,
4. see which workstations are online,
5. inspect CPU, memory, disk, GPU, and user activity,
6. reserve individual GPUs in 30-minute increments,
7. see which user/process is currently using each GPU,
8. detect when actual GPU usage conflicts with reservations,
9. allow the reservation owner to request intervention,
10. allow admins to safely terminate the conflicting process,
11. audit privileged actions,
12. run the control plane through a simple Docker Compose deployment,
13. run each workstation node as a simple Go/systemd service,
14. reproduce most of the system locally using simulated nodes and Docker Compose.

Prioritize getting these workflows correct, secure, and maintainable over building additional features.
