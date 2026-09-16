# Cluster Manager Implementation Plan

This plan breaks the system into vertical milestones. Each milestone must leave the
repository in a working, testable state and must be completed before work begins on
the next milestone.

The goal is not to build every architectural layer up front. Each milestone should
deliver one coherent slice through the UI, platform, database, and node where those
parts are required.

## Working principles

- Keep the SvelteKit application as the only control-plane service.
- Keep the Go node small and limited to workstation integration.
- Add schema, APIs, UI, tests, and documentation only as a milestone needs them.
- Prefer a complete simple workflow over a partially generalized framework.
- Use simulation mode for routine development, but validate privileged node behavior
  against a disposable Ubuntu machine or VM when the milestone requires it.
- Do not start a later milestone while the current milestone's acceptance checks are
  failing.
- Update this file as decisions are made or scope changes.

## Definition of done for every milestone

- [ ] The milestone's user-visible workflow works from start to finish.
- [ ] Relevant authorization and input validation are enforced by the backend, not
      only by the UI.
- [ ] Database changes have checked-in Drizzle migrations.
- [ ] Important failure paths produce understandable errors and do not corrupt state.
- [ ] Automated tests cover the milestone's important business rules.
- [ ] The development stack starts from documented commands on a clean checkout.
- [ ] No secrets or generated credentials are committed.
- [ ] README/setup documentation reflects the working system.
- [ ] The milestone acceptance checks have been run and recorded as passing.

---

## Milestone 0 — Bootable development system

### Outcome

A developer can clone the repository, create an environment file, start the stack,
and open a minimal Cluster Manager page backed by PostgreSQL. This establishes a
small, reliable foundation without implementing product features prematurely.

### Build

- [x] Create the minimal monorepo layout:
  - [x] `platform/` SvelteKit TypeScript application
  - [x] `node/` Go module with a minimal executable
  - [x] root Compose files, `.env.example`, `Makefile`, and `README.md`
- [x] Configure strict TypeScript, formatting, linting, and unit-test commands.
- [x] Add PostgreSQL and Drizzle ORM to the platform.
- [x] Add the initial migration mechanism and a small platform metadata/health query.
- [x] Add `/health` readiness behavior that verifies database connectivity.
- [x] Add a minimal web page showing that Cluster Manager is running.
- [x] Add development and production-oriented platform Dockerfiles.
- [x] Create `docker-compose.dev.yml` for the platform and PostgreSQL.
- [x] Create the initial production `docker-compose.yml` for the platform and
      PostgreSQL without adding unnecessary services.
- [x] Add health checks and predictable startup ordering.
- [x] Document local commands for startup, migration, tests, logs, and shutdown.

### Tests and acceptance

- [x] `docker compose -f docker-compose.dev.yml up --build` starts successfully from
      a clean checkout after copying `.env.example` to `.env`.
- [x] The browser page loads and identifies the application.
- [x] The health endpoint reports ready when PostgreSQL is reachable.
- [x] The health endpoint reports not ready when PostgreSQL is unavailable.
- [x] Migrations can be applied to an empty database and reapplied safely.
- [x] Platform lint, type-check, unit-test, and Go test commands pass.

### Completion record

Completed on 2026-09-16. Verified from a clean detached worktree with fresh Docker
volumes. The development and production Compose targets both became healthy, the
homepage loaded, migrations ran automatically, and database outage/recovery returned
the expected 503/200 readiness responses. Platform checks, tests, production build,
Go tests/vet/build, Compose validation, and both container-image builds passed.

### Explicitly not included yet

Authentication, real users, workstation connectivity, GPU data, and reservations.

---

## Milestone 1 — Secure login and user administration

### Outcome

An initial administrator can log in and manage platform users. A normal user can log
in and see a limited personal home page. Role enforcement and audit logging work end
to end.

### Build

- [x] Design the minimum user, credential/session, and audit-event tables.
- [x] Add a secure initial-admin bootstrap flow that does not embed credentials in
      source code or images.
- [x] Implement password hashing with a current password-hashing algorithm and safe
      parameters.
- [x] Implement server-side sessions with secure cookie behavior, expiry, logout,
      and session invalidation.
- [x] Add CSRF protection or an equivalent same-origin strategy for mutations.
- [x] Add login, logout, and authenticated layouts.
- [x] Add two roles: `user` and `admin`.
- [x] Enforce roles in server-side handlers and actions.
- [x] Add admin workflows to:
  - [x] list and inspect users
  - [x] create a user
  - [x] edit basic user details
  - [x] enable or disable a user
  - [x] reset a platform password using a temporary/generated credential flow
- [x] Ensure disabled users cannot start new sessions and existing sessions are
      invalidated.
- [x] Add a basic user home page showing identity, role, and account state.
- [x] Record audit events for user creation, editing, enable/disable, and credential
      reset.
- [x] Add a basic admin audit-history page.

### Tests and acceptance

- [x] A fresh installation can bootstrap exactly one initial admin safely.
- [x] An admin can log in, create a user, and give the temporary credential to that
      user without plaintext passwords being stored.
- [x] The new user can log in and cannot open or call admin functionality.
- [x] Disabling the user blocks subsequent authenticated access.
- [x] Each privileged user-management action is visible in audit history with actor,
      action, target, and time.
- [x] Authentication, session, role, and audit integration tests pass.

### Completion record

Completed on 2026-09-16. Verified with unit/static tests and an automated HTTP smoke
test against a fresh production Compose database. The test covered initial bootstrap,
Argon2id password storage, forced password replacement, user creation, normal-user
role denial, disable/session revocation, re-enable, credential reset, old-password
rejection, and audit visibility. Production checks also verified same-origin CSRF
rejection and `HttpOnly; Secure; SameSite=Lax` session cookies.

### Explicitly not included yet

Workstation assignments and Linux account provisioning.

---

## Milestone 2 — Connected simulated workstations

### Outcome

Two instances of the normal Go node run in simulation mode, authenticate independently,
send heartbeats and inventory, and appear in the platform as online workstations.
Stopping one makes it become stale/offline without affecting the rest of the system.

### Build

- [x] Design the minimum workstation, node-credential, heartbeat, and inventory data
      model.
- [x] Implement an admin workflow to create/approve a workstation identity and issue
      a revocable credential.
- [x] Store node credential verifiers securely and show raw credentials only when
      necessary.
- [x] Authenticate every node request and prevent one node from reporting for another.
- [x] Implement the Go node configuration loader with environment/file-based secrets.
- [x] Implement node registration/activation as narrowly as the chosen credential
      bootstrap flow requires.
- [x] Implement periodic heartbeat and inventory reporting for:
  - [x] hostname and node version
  - [x] uptime
  - [x] CPU inventory and utilization
  - [x] RAM inventory and utilization
  - [x] local filesystem capacity and utilization
  - [x] logged-in users/sessions
- [x] Add retry/backoff behavior for temporary control-plane outages.
- [x] Implement `NODE_SIMULATE=true` in the normal node binary.
- [x] Add configurable simulation scenarios for normal load, high CPU, high disk,
      multiple logged-in users, and paused/offline reporting.
- [x] Run simulated `ws01` and `ws02` from `docker-compose.dev.yml` using separate
      credentials.
- [x] Add the admin workstation list/detail UI.
- [x] Derive online/stale/offline presentation from heartbeat age.
- [x] Make duplicate or out-of-order reports safe.
- [x] Add credential revocation and rotation support.

### Tests and acceptance

- [x] Starting the development stack shows `ws01` and `ws02` with useful simulated
      inventory and recent heartbeats.
- [x] Stopping one node causes only that workstation to become stale/offline after the
      configured interval.
- [x] Restarting it restores online status without creating a duplicate workstation.
- [x] A missing, invalid, revoked, or wrong-workstation credential is rejected.
- [x] Platform downtime does not crash the node; it resumes reporting after recovery.
- [x] Node API, authentication, heartbeat, stale-state, and simulation tests pass.

### Explicitly not included yet

Linux user and password reconciliation, GPU telemetry, and reservations.

---

## Milestone 2.1 — shadcn-svelte styling foundation

### Outcome

The working Milestone 2 application keeps all existing behavior while its handwritten
UI is replaced with a consistent, responsive component system based on
shadcn-svelte. Developers can build later workflows from checked-in components and
shared theme tokens instead of recreating controls and page styling route by route.

### Library fit and decisions

- Use the current shadcn-svelte CLI and its Svelte 5/Tailwind CSS v4 output.
- Use the current default `vega` preset and default neutral color treatment. Do not
  introduce a custom Cluster Manager visual theme during this pass.
- Treat generated components as repository-owned source under
  `platform/src/lib/components/ui/`; shadcn-svelte is a scaffolding workflow, not a
  runtime component package or opaque design-system dependency.
- Keep theme values in CSS variables so a later styling pass can change color,
  radius, typography, dark mode, and chart colors without rewriting page markup.
- Add only components used by the current application. Do not install the entire
  registry or introduce abstractions for hypothetical future screens.
- Reserve shadcn-svelte charts for a monitoring milestone with historical data.
  Charts use LayerChart, and the current official integration depends on pre-release
  LayerChart v2, so this milestone must not add dummy charts or make it a core UI
  dependency yet.

### Build

- [x] Initialize shadcn-svelte in the existing SvelteKit project without overwriting
      application behavior or losing required global styles.
- [x] Add Tailwind CSS v4 through the Vite integration and check in
      `components.json`, theme variables, the `cn` utility, and dependency changes.
- [x] Add the smallest useful component set for existing screens, expected to include:
  - [x] Button
  - [x] Card
  - [x] Input and Label
  - [x] Select
  - [x] Badge
  - [x] Alert
  - [x] Table
  - [x] Separator
- [x] Replace the root header and administration navigation with responsive,
      accessible composition using the shared primitives.
- [x] Restyle the home, login, password-change, and user dashboard pages using the
      default component language.
- [x] Restyle user administration, audit history, workstation list, and workstation
      detail pages without changing their forms, actions, or server data contracts.
- [x] Map online, stale, offline, active, disabled, and enrollment states to a
      consistent badge/status treatment that does not rely on color alone.
- [x] Replace one-off success, warning, error, and one-time credential panels with
      consistent alert/card patterns.
- [x] Remove superseded global and route-local CSS while retaining only layout rules
      or utilities that the component primitives do not cover cleanly.
- [x] Keep loading, empty, overflow, long-token, and narrow-screen states usable.
- [x] Preserve semantic labels, keyboard navigation, visible focus states, contrast,
      and destructive-action distinction.
- [x] Document how to add or update a shadcn-svelte component and require reviewing
      generated diffs before committing CLI overwrites.
- [x] Record shadcn-svelte Chart/LayerChart as the preferred starting point for future
      CPU, RAM, disk, GPU, and utilization-history visualizations, subject to a fresh
      stability review when monitoring history is implemented.

### Tests and acceptance

- [x] A clean installation and production build succeed with the checked-in component
      source and pinned dependencies; no globally installed CLI is required at
      runtime.
- [x] Login, forced password change, logout, user administration, audit history,
      workstation administration, credential display, and workstation detail
      workflows still pass their existing automated checks.
- [x] Every existing route renders without console errors or missing styles in the
      development stack.
- [x] Anonymous, normal-user, and administrator navigation remain role-appropriate
      and usable at desktop and mobile widths.
- [x] Forms have associated labels, validation feedback remains understandable, and
      all interactive controls can be reached and operated by keyboard.
- [x] Long usernames, workstation names, enrollment tokens, and temporary credentials
      wrap or scroll without breaking their containers.
- [x] The two simulated workstations still appear online with readable inventory and
      status presentation after the UI migration.
- [x] Platform tests, authentication and node smoke tests, type-checking, linting, and
      production build pass.

### Explicitly not included yet

Custom branding, dark-mode controls, chart rendering, historical telemetry storage,
backend/API changes, node changes, Linux account reconciliation, GPU telemetry, and
reservations.

---

## Milestone 3 — Workstation assignment and SSH access

### Outcome

An admin assigns a platform user to one workstation. The platform password is also the
user's workstation SSH password, and a node reconciles the corresponding local Linux
account and one-way Linux password hash. Revoking access disables login without
deleting the user's data.

### Build

- [x] Add workstation assignment, provisioning-state, and Linux password-hash fields
      and constraints. Development data may be reset; no pre-M3 migration/backfill is
      required.
- [x] Enforce that a user normally has at most one active workstation assignment.
- [x] Add admin assign, move, and revoke workflows.
- [x] Add the user's assigned-workstation view and SSH connection instructions.
- [x] Derive both the existing platform-login verifier and a separately salted
      Linux/PAM-compatible password hash whenever a password is created, changed, or
      reset; store only the one-way hashes and update them atomically.
- [x] Make self-service platform password changes update the desired workstation
      password hash for the user's assignment.
- [x] Make the existing admin password-reset flow reset the single shared platform/SSH
      password and require normal first-login replacement.
- [x] Audit assignment, revocation, and synchronized password resets/changes without
      recording password material or hashes.
- [x] Add a versioned, authenticated desired-state endpoint for each node containing
      only that workstation's required users, account state, and Linux-compatible
      password hashes.
- [x] Treat desired-state password hashes as sensitive verifiers: return them only to
      the authenticated assigned node over production HTTPS and never log them.
- [x] Implement idempotent node reconciliation for:
  - [x] safe Linux username/UID policy
  - [x] local account creation
  - [x] home directory creation and ownership
  - [x] active/disabled login state
  - [x] synchronized `/etc/shadow`-compatible password hash application without
        passing plaintext through command arguments or logs
  - [x] SSH password authentication policy scoped to Cluster Manager-managed users
  - [x] rootless Podman prerequisites that are safe to configure automatically
- [x] Ensure reconciliation never deletes a home directory or user data.
- [x] Ensure unavailable or invalid desired state causes no destructive changes.
- [x] Report reconciliation status/errors to the platform.
- [x] Show provisioning state and actionable errors to admins and the affected user.
- [x] Provide Ubuntu installation/configuration instructions for the node.
- [x] Provide an initial systemd unit and hardened service configuration.

### Tests and acceptance

- [x] In simulation mode, assignment and password changes produce the expected desired
      state and reported reconciliation status without exposing plaintext credentials.
- [x] On a disposable Ubuntu machine/VM, assigning a user creates a usable account and
      permits SSH login with the same password used by the platform.
- [x] Changing or resetting the platform password rejects the old SSH password and
      accepts the replacement after reconciliation.
- [x] SSH public-key authentication is unavailable to Cluster Manager-managed users.
- [x] Revoking access disables new login while preserving the account's home directory
      and files.
- [x] Reapplying unchanged desired state is harmless.
- [x] Platform or network outage leaves existing accounts and sessions usable.
- [x] Assignment authorization, password synchronization, desired-state credential
      isolation, and node reconciliation tests pass.

### Explicitly not included yet

GPU monitoring and reservations.

### Completion record

Completed on 2026-09-16. The simulation smoke test covered assignment, movement between
both simulated workstations, password replacement, per-node reconciliation reporting,
user SSH instructions, and revocation. A disposable Ubuntu 24.04 image verified real
account/home creation, idempotent reapplication, password-only sshd login, password
replacement, public-key rejection, account locking, rootless subordinate IDs, and
home-data preservation. Unit/static checks cover invalid desired state and ensure it is
rejected before any local changes.

---

## Milestone 4 — GPU and process monitoring

### Outcome

Admins and users can see current GPU state for their permitted workstations, including
stable GPU identity, telemetry, and attributed GPU processes. The same UI works with
simulated nodes and real NVIDIA hardware.

### Build

- [x] Add GPU inventory, current telemetry, and GPU-process observation data models.
- [x] Choose bounded retention behavior for high-frequency observations so the
      database does not grow indefinitely.
- [x] Implement real NVIDIA discovery using stable NVIDIA/Linux interfaces where
      practical.
- [x] Report for each GPU:
  - [x] NVIDIA UUID and local index
  - [x] model
  - [x] utilization
  - [x] used and total VRAM
  - [x] temperature when available
- [x] Discover GPU-consuming processes and report:
  - [x] GPU UUID
  - [x] PID
  - [x] UID and resolved Linux username
  - [x] command/process information with an explicit privacy boundary
  - [x] GPU memory usage
  - [x] process start identity/time where practical
- [x] Attribute rootless Podman GPU processes to the host Linux user where possible.
- [x] Make process collection resilient to races where processes exit during sampling.
- [x] Extend simulation scenarios for free GPUs, busy GPUs, and multiple processes.
- [x] Add workstation and GPU status views.
- [x] Add per-user views for current GPU processes and available storage usage where
      reported.
- [x] Restrict normal users to relevant state for their assigned workstation and avoid
      exposing unnecessary process details.

### Tests and acceptance

- [x] Simulated `ws01` and `ws02` display their GPUs and changing telemetry.
- [x] Simulation can switch between free, busy, and multi-process states without
      changing platform code or APIs.
- [x] Process observations are attributed to expected Linux users.
- [x] Stale node telemetry is clearly marked and is not presented as current.
- [x] The node handles systems with no NVIDIA driver or no GPU without crashing.
- [ ] Real discovery is smoke-tested on an NVIDIA Ubuntu workstation when one is
      available.
- [x] Telemetry ingestion, attribution, visibility, staleness, and simulation tests
      pass.

### Explicitly not included yet

Reservations, conflict decisions, stop requests, and termination.

### Completion record

Implementation completed on 2026-09-16. Both simulated workstations report two stable
GPUs; scenarios cover free, changing busy, and multi-process states. The authenticated
heartbeat validates and stores current GPU state plus 24 hours of observation history,
with process rows deleted by cascade during retention cleanup. Admin views show all
attributed executable names, while the user dashboard fetches only that user's process
rows and also shows workstation storage availability. Unit tests cover NVIDIA CSV
parsing, missing drivers, and process-exit races; the M4 smoke test covers ingestion,
changing telemetry, attribution, visibility isolation, and retention. The real-hardware
smoke remains intentionally pending until an NVIDIA Ubuntu workstation is available.

---

## Milestone 5 — Reliable GPU reservations

### Outcome

A user can view a schedule and reserve a specific GPU on their assigned workstation.
Concurrent attempts can never produce overlapping reservations. Users can cancel their
own reservations, and admins can inspect and override them.

### Build

- [ ] Add reservation data, status, indexes, and database-level overlap protection.
- [ ] Store times in UTC and render them in the user's/displayed local timezone.
- [ ] Implement backend reservation rules:
  - [ ] user is active and assigned to the GPU's workstation
  - [ ] start/end align to 30-minute boundaries
  - [ ] end is after start
  - [ ] normal duration is no more than six hours
  - [ ] normal start is no more than seven days ahead
  - [ ] the physical GPU exists and is active
  - [ ] no overlapping active reservation exists for that GPU
- [ ] Use a transaction/database constraint strategy that remains correct under
      concurrent booking attempts.
- [ ] Add user schedule, create, upcoming/current, and cancellation workflows.
- [ ] Use a helpful default duration such as two hours.
- [ ] Add admin all-reservations view and explicit override behavior.
- [ ] Decide and implement override semantics without silently corrupting or hiding
      existing bookings.
- [ ] Audit reservation creation/cancellation and admin overrides.
- [ ] Keep expired/cancelled history available for audit and troubleshooting.

### Tests and acceptance

- [ ] A user can book and cancel a GPU on their assigned workstation.
- [ ] A user cannot book a GPU on another workstation.
- [ ] Boundary, duration, horizon, disabled-user, and inactive-GPU rules are enforced
      by the server.
- [ ] Two simultaneous attempts for the same GPU/time result in exactly one booking.
- [ ] Adjacent non-overlapping reservations are allowed.
- [ ] The schedule behaves correctly across timezone and daylight-saving boundaries.
- [ ] Admin override behavior is explicit in the UI and audit history.
- [ ] Reservation rule and concurrency integration tests pass against PostgreSQL.

### Explicitly not included yet

Reservations do not enforce GPU access, stop workloads, or manipulate device
permissions.

---

## Milestone 6 — Reservation/usage correlation and conflicts

### Outcome

The platform combines reservations with observed GPU processes and clearly reports
available, booked-idle, booked-active, unbooked-use, and conflicting-use states.

### Build

- [ ] Define the correlation rules for the current instant, including how to treat:
  - [ ] multiple processes from the reservation owner
  - [ ] mixed owner and non-owner processes
  - [ ] system/unknown UIDs
  - [ ] stale node telemetry
  - [ ] the exact start and end boundaries of a reservation
- [ ] Correlate platform users with local Linux account identities safely.
- [ ] Compute a stable status for each GPU from reservation and observed state.
- [ ] Do not infer ownership from utilization percentage alone.
- [ ] Add clear visual states for:
  - [ ] available
  - [ ] booked and idle
  - [ ] booked and active by the owner
  - [ ] unbooked use
  - [ ] reservation conflict
  - [ ] unknown because telemetry is stale
- [ ] Show relevant owner/process context without exposing unnecessary information to
      normal users.
- [ ] Add filters and summaries to the admin dashboard for active conflicts and
      unbooked use.
- [ ] Add easy development controls or configuration for switching simulation
      scenarios, including the Alice-reserves/Bob-runs conflict example.

### Tests and acceptance

- [ ] Each defined state can be produced deterministically in simulation mode.
- [ ] Alice reserving a GPU while Alice's process uses it is shown as booked-active,
      not a conflict.
- [ ] Alice reserving a GPU while Bob's process uses it is shown as a conflict.
- [ ] A busy GPU without a reservation is shown as unbooked use.
- [ ] Mixed-owner and unknown-owner process cases are represented accurately.
- [ ] Stale telemetry produces an unknown/stale state rather than a false conflict or
      false availability result.
- [ ] Correlation and authorization tests pass.

### Explicitly not included yet

No process is stopped and no GPU permissions are changed.

---

## Milestone 7 — Stop requests and safe admin termination

### Outcome

A reservation owner can request intervention for a real detected conflict. An admin
can review the request and, after identity revalidation by the node, gracefully
terminate the exact conflicting process. Every step is auditable.

### Build

- [ ] Add stop-request records and a small explicit status lifecycle.
- [ ] Allow a reservation owner to create a request only for a current conflict
      affecting their reservation.
- [ ] Capture immutable target identity sufficient to review and later revalidate the
      process, including GPU, PID, expected UID, and process start identity.
- [ ] Prevent duplicate actionable requests for the same target/conflict.
- [ ] Add the user's request-status view.
- [ ] Add an admin queue and request-detail view with current and captured process
      context.
- [ ] Detect and mark requests stale when the reservation ends, the conflict clears,
      or the target process exits/changes.
- [ ] Add admin actions to dismiss, resolve without termination, or request
      termination.
- [ ] Add a narrowly scoped authenticated platform-to-node termination instruction;
      do not add a generic command endpoint.
- [ ] Before signaling, make the node verify:
  - [ ] target PID still exists
  - [ ] UID still matches
  - [ ] process start identity still matches
  - [ ] the instruction belongs to this workstation
  - [ ] the instruction is authorized, fresh, and cannot be replayed unsafely
- [ ] Implement graceful `SIGTERM`, a short bounded wait, and optional `SIGKILL`
      escalation with reported results.
- [ ] Handle the process exiting before or during the action as a safe outcome.
- [ ] Restrict termination to admins at every layer.
- [ ] Audit stop-request creation, decisions, termination attempts, escalation, and
      results.
- [ ] Implement safe simulated termination behavior for full development testing.

### Tests and acceptance

- [ ] The reservation owner can open a stop request from a simulated conflict.
- [ ] Unrelated users cannot create or act on that request.
- [ ] An admin can review and terminate the simulated target, after which the conflict
      clears and the request resolves.
- [ ] If the target exits first, the request becomes stale/resolved without signaling
      another process.
- [ ] PID reuse or any UID/start-identity mismatch causes termination to be refused.
- [ ] Revoked node credentials and replayed/expired instructions are rejected.
- [ ] On a disposable Ubuntu machine/VM, `SIGTERM` and required `SIGKILL` escalation
      are verified against controlled test processes.
- [ ] Stop-request lifecycle, authorization, identity verification, and audit tests
      pass.

### Explicitly not included

Users never terminate other users' processes directly. Workloads are not terminated
automatically at reservation expiry.

---

## Milestone 8 — Operational readiness for the first deployment

### Outcome

The system is documented, deployable on the management host/NAS, installable on the
initial Ubuntu workstations, and usable for day-to-day administration without special
developer knowledge.

### Build

- [ ] Review and polish the user and admin dashboards around real operational tasks.
- [ ] Show per-user assignment, active state, disk usage, GPU processes, and current/
      upcoming reservations.
- [ ] Complete audit browsing with useful filtering and retention guidance.
- [ ] Add platform and node version visibility for troubleshooting.
- [ ] Finalize production Compose configuration, persistent volumes, health checks,
      restart behavior, and environment validation.
- [ ] Document HTTPS/reverse-proxy expectations for production.
- [ ] Finalize node binary build, configuration file, credential provisioning,
      rotation/revocation, installation, upgrade, and systemd instructions.
- [ ] Apply practical systemd hardening without blocking required host inspection and
      account-management operations.
- [ ] Document PostgreSQL backup and restore procedures and test a restore.
- [ ] Document recovery for lost platform-admin credentials and lost node credentials.
- [ ] Add bounded cleanup/retention for sessions and telemetry while preserving audit
      and reservation history as required.
- [ ] Add basic structured logs and troubleshooting guidance without introducing a
      separate observability stack.
- [ ] Document expected behavior during platform, database, network, and node outages.
- [ ] Perform a security review of authentication, authorization, credential exposure,
      desired-state reconciliation, node APIs, and process termination.
- [ ] Perform an end-to-end deployment rehearsal using the intended production-style
      topology.

### Tests and acceptance

- [ ] A fresh management host can start the control plane with the documented
      `docker compose up -d` workflow.
- [ ] A fresh supported Ubuntu workstation can install and run the node using the
      documented systemd workflow.
- [ ] The complete user journey works: admin creates user, assigns workstation, user
      completes password setup, node provisions matching password access, user
      reserves GPU, conflict is detected, user requests a stop, and admin safely
      resolves it.
- [ ] Existing SSH sessions and workloads continue during a control-plane outage.
- [ ] A node outage marks telemetry stale without disrupting SSH or running work.
- [ ] Database backup restoration produces a usable control plane.
- [ ] All automated test suites, migration checks, container health checks, and manual
      deployment checks pass.

---

## Deferred beyond v1

Do not pull these into a milestone unless the requirements change:

- [ ] Slurm, Kubernetes, job queues, or batch scheduling
- [ ] LDAP or FreeIPA
- [ ] Shared home directories or distributed storage
- [ ] GPU device permission enforcement, CUDA environment injection, cgroups, MIG, or
      partitioning
- [ ] Automatic termination at reservation expiry
- [ ] GPU-hour quotas or advanced fairness algorithms
- [ ] Container orchestration or privileged researcher containers
- [ ] Automatic NVIDIA driver management
- [ ] Workstation reboot controls
- [ ] Arbitrary remote shell/command execution
- [ ] Redis, event buses, or a separate observability platform
- [ ] Complex notification infrastructure
- [ ] Complex RBAC beyond user/admin

---

## Product decisions to confirm before the relevant milestone

These do not block Milestone 0. The provisional defaults keep implementation planning
concrete while leaving room to make a deliberate choice before the feature is built.

- [x] **Before Milestone 1 — account onboarding:** use an admin-issued generated
      temporary password and force replacement on first login.
- [x] **Before Milestone 2 — node bootstrap:** confirm how operators prefer to create
      and deliver node credentials. Provisional default: an admin creates the
      workstation in the UI and copies a one-time enrollment token to the machine.
- [x] **Before Milestone 3 — Linux usernames:** the immutable platform username is the
      Linux username. Admins choose it when creating the user, and validation enforces
      the conservative POSIX-safe format used by node reconciliation.
- [x] **Before Milestone 3 — SSH passwords:** use password-only SSH authentication for
      Cluster Manager-managed users. The workstation password must match the platform
      password; derive and store separate one-way platform and Linux-compatible hashes
      from the same input, and never store or send plaintext. SSH keys are out of scope.
- [x] **Before Milestone 4 — process privacy:** collect executable names only, never
      command arguments or environment variables. Normal users see only processes
      attributed to their own Linux username; admins see all attributed processes.
- [ ] **Before Milestone 5 — timezone:** confirm the default display timezone.
      Provisional default: store UTC and display in `Asia/Kuala_Lumpur`, with the zone
      stated explicitly in reservation views.
- [ ] **Before Milestone 5 — admin override:** choose whether an override may cancel an
      existing reservation or only exceed normal duration/horizon rules. Provisional
      default: both are possible, but cancellation requires an explicit confirmation,
      reason, and audit event.
- [ ] **Before Milestone 7 — forced termination:** confirm whether `SIGKILL` escalation
      is enabled by default or requires a second admin action. Provisional default:
      require an explicit second action after `SIGTERM` fails.

## Progress

- [x] Milestone 0 complete
- [x] Milestone 1 complete
- [x] Milestone 2 complete
- [x] Milestone 2.1 complete
- [x] Milestone 3 complete
- [x] Milestone 4 complete (real NVIDIA hardware smoke pending availability)
- [ ] Milestone 5 complete
- [ ] Milestone 6 complete
- [ ] Milestone 7 complete
- [ ] Milestone 8 complete
