# V1 security review

Reviewed for the first deployment on 2026-09-16. This is a focused review of the v1
trust boundaries, not a third-party penetration test.

| Area | Control and review result | Remaining operator responsibility |
| --- | --- | --- |
| Web authentication | Argon2id password verifiers, random hashed server sessions, secure/HTTP-only/SameSite cookies, forced temporary-password change, session revocation on reset/disable. Last-admin safeguards are enforced. | Terminate TLS at the documented proxy; restrict administrator accounts and protect backups. |
| Authorization | Server-side user/admin guards cover pages and actions. Node APIs use separate workstation credentials and bind records/instructions to that workstation. | Review audit events and promptly disable departed users. |
| Credential exposure | Temporary, enrollment, and recovery credentials are shown once. Node secrets are stored hashed centrally and mode 0600 locally. Logs omit passwords, hashes, tokens, arguments, and environments. | Deliver one-time secrets out of band; keep `.env`, node state, and terminal scrollback private. |
| Desired-state reconciliation | Versioned, authenticated, workstation-scoped state; Linux username validation; idempotent changes; missing/invalid state fails closed; revocation locks access but preserves homes and running work. | Review node provisioning errors before manual changes. |
| Node privilege | Root is required for `/proc`, account/password/SSH management, and signals. systemd isolates temporary/kernel/namespace surfaces while deliberately leaving host account files, homes, devices, and processes visible. No arbitrary-command API exists. | Limit root access and install only signed/trusted binaries and configs. |
| Telemetry/privacy | Process executable name, PID identity, UID/username, and GPU memory only. User views filter other users' process detail and reservation identity. High-frequency rows have bounded retention. | Choose the shortest useful retention and control database access. |
| Reservations | PostgreSQL exclusion constraint prevents overlap under concurrency; admin overrides require explicit reasons and do not bypass overlap. History is retained. | Reservations coordinate use but do not enforce device access. |
| Process termination | User requests require their live conflicting reservation. Admin-only, narrowly scoped instructions expire quickly and are claimed once. Node revalidates workstation, PID, UID, and start ticks before SIGTERM and any explicit SIGKILL escalation. | Review captured/current identity and reason before acting; automatic expiry termination is intentionally absent. |
| Availability/recovery | Readiness probes include PostgreSQL, services restart, nodes back off, state reconciliation is idempotent, and backup restoration is rehearsed. Control-plane loss does not terminate SSH/workloads. | Maintain off-host backups, monitor capacity, and rehearse recovery after upgrades. |

Accepted v1 limitations: local password authentication is used for managed accounts;
there is no MFA, external identity provider, job isolation, GPU device enforcement, or
separate observability stack. These are explicit scope choices. Expose the platform
only to the intended institutional network/VPN and revisit the threat model before
internet exposure, multi-tenant use, or adding remote-control capabilities.
