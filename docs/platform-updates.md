# Platform updates from the app

**Admin → Updates** checks the project's latest published stable GitHub release every
six hours, with a manual **Check for updates** button. Prereleases and drafts are
excluded. Installation is always an explicit administrator action with the exact
target release typed into a confirmation dialog. Regular users cannot check privileged
status, request updates, or access update history. Node updates remain available from
each workstation's Software updates tab; the Updates page links to these machines.

## One-time setup

Deploy a release containing the Updates page and updater image manually first. This
feature is not present in v0.5.0. Use the same release tag for this initial platform and
helper setup. Future platform installations can be requested entirely from the app.

The helper uses the existing public platform image package with an `updater-` tag
(for example `ghcr.io/joshimello/cluster-manager-platform:updater-v0.6.0`). No new
registry credentials or package visibility changes are needed.

The optional updater is a separate container with Docker control and access to the
deployment directory. This gives the helper administrative control of its Docker host.
The platform container retains its existing unprivileged configuration and never
receives the Docker socket. The helper has no published ports. Only install this on a
trusted management host, keep the deployment files administrator-only, and keep its
64-character random token private. The token grants only the updater protocol endpoints,
not web administrator access; the helper accepts only exact newer stable tags from
`Joshimello/cluster-manager` and runs a fixed update procedure.

For repository Compose deployments:

1. Use the production `docker-compose.yml`, with a pinned stable `PLATFORM_VERSION`
   in `.env`. The platform image and its `PLATFORM_VERSION` environment value must both
   interpolate `${PLATFORM_VERSION}`. The `postgres` and `platform` service names are
   required. Updates modify only the `PLATFORM_VERSION` line in `.env`.
2. Generate a fresh token locally (for example `openssl rand -hex 32`) and add it as
   `PLATFORM_UPDATER_TOKEN` to `.env`. Never paste the token into chat or logs. Protect
   `.env` with mode 600. Add `UPDATER_VERSION` (an exact release containing this feature),
   `DEPLOYMENT_DIRECTORY` (the absolute host checkout path), and `COMPOSE_PROJECT_NAME`.
3. Add `PLATFORM_UPDATER_TOKEN: ${PLATFORM_UPDATER_TOKEN}` to the platform environment
   in the **base** Compose file. This is essential: future replacements use the base
   file, so it must contain all platform settings, mounts, and secrets.
4. Start the helper and refresh the platform once:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.updater.yml up -d
   ```

   The helper mounts the deployment directory at the **same absolute host path** so
   Compose bind mounts still resolve to the correct host files. Keep the helper version
   separately pinned. Platform updates intentionally leave PostgreSQL and the helper
   container running. Use the two-file command above for any later full-stack rebuild.

5. Open **Admin → Updates** and verify **Updater: Online**. The helper polls every
   ten seconds. Requests expire after fifteen minutes if they have not been picked up.

## Synology Container Manager

For the existing `/volume1/docker/gpu-manager/compose.yaml` deployment, include the
helper service directly in that project's YAML instead of using an override file:

- Change the platform image to
  `ghcr.io/joshimello/cluster-manager-platform:${PLATFORM_VERSION}` and its environment
  value to `PLATFORM_VERSION: ${PLATFORM_VERSION}`.
- Add `PLATFORM_UPDATER_TOKEN: ${PLATFORM_UPDATER_TOKEN}` to the platform environment.
- Create an administrator-only `.env` beside `compose.yaml`, containing the current
  pinned `PLATFORM_VERSION`, a newly generated token, and a separately pinned
  `UPDATER_VERSION`. Preserve existing database credentials and all other settings.
- Copy the helper service from `docker-compose.updater.yml`, using
  `DEPLOYMENT_DIRECTORY: /volume1/docker/gpu-manager`,
  `DEPLOYMENT_PROJECT: gpu-manager`, and `DEPLOYMENT_COMPOSE_FILE: compose.yaml`.
  Mount `/volume1/docker/gpu-manager` at that same path inside the helper. Include the
  `platform-updater-state` volume declaration. Use the existing Compose project name
  from the running platform's `com.docker.compose.project` label if it differs.
- Rebuild this project once to apply the setup, retaining the existing PostgreSQL bind
  mount and permissions. Do not select any option that removes project data/volumes.
  The helper persists future version changes in `.env`; Container Manager rebuilds then
  use the same pinned version.

No shared-folder permissions, PostgreSQL ownership, reverse-proxy settings, workstation
accounts, or node configuration need to change for this setup.

## Update procedure and recovery

The helper validates the published GitHub release, current deployment and requested
source version, downloads the official versioned image, checks its release label and
registry digest, and takes a PostgreSQL custom-format dump. It verifies the dump with
`pg_restore --file=/dev/null` to read the complete archive without executing SQL,
saves the Compose file, `.env`, resolved configuration and old
image ID, then durably records the restart intent. It pins `.env` to the target release,
recreates only the platform service using the downloaded image, and checks that the
new container is using that image and `/health` reports the requested version and a
ready database. The page keeps polling and reconnects after the brief interruption.

Backups are retained in the helper's `/state/backups/<update-id>/` directory (the
`platform-updater-state` Docker volume), accessible only to the helper/root. Update
history shows the reference ID. Copies contain database credentials and user data:
protect and copy these backups off-host using your normal backup procedure. There is
no automatic backup deletion. An early validation failure can have no backup yet;
use helper logs and the referenced directory to determine how far it got.

For a failed update, inspect **Container Manager → updater → Log** and the platform
logs. Do not automatically restore an older image onto a migrated database. Choose
either a forward repair, or restore the verified dump and saved configuration with
the matching old image during a maintenance window. Rehearse database restoration
using the existing operations runbook. Restore the old `PLATFORM_VERSION` line before
retrying if a failed replacement left `.env` pinned to the target.

Operation journals in `/state/operations/` are permanent receipts. Duplicate deliveries
only report the saved result. If the helper restarts during an operation, it checks
whether the requested release is ready and reports success or interruption; it never
repeats backup/replacement automatically. If the platform cannot start, progress remains
in the helper's durable journal until the platform is recovered. Preserve this state
volume and backups when rebuilding containers. Do not run multiple helpers for the
same deployment; an OS file lock protects the shared state volume.

## Validation

```sh
cd updater
node --test *.test.mjs
RUN_UPDATER_DOCKER_TESTS=true node --test integration.test.mjs
```

The Docker rehearsal uses a disposable project, real PostgreSQL, database backups and
real container replacement. It never touches the user's development or NAS deployment.
