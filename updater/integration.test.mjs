import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerDeployment, command } from "./docker.mjs";
import { Journal, UpdateRunner } from "./runner.mjs";
import { imageRepository } from "./protocol.mjs";

test(
  "real PostgreSQL backup, container replacement, health, data preservation and replay rehearsal",
  { skip: process.env.RUN_UPDATER_DOCKER_TESTS !== "true", timeout: 300_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cm-updater-rehearsal-"));
    const project = `cm-updater-${randomUUID().slice(0, 8)}`;
    const state = join(directory, "state");
    const versions = ["v99.0.0", "v99.0.1"];
    const made = [];
    const compose = `services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: rehearsal
      POSTGRES_USER: rehearsal
      POSTGRES_PASSWORD: disposable-rehearsal-only
    volumes:
      - data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL','pg_isready -U rehearsal -d rehearsal']
      interval: 1s
      retries: 60
  platform:
    image: ${imageRepository}:\${PLATFORM_VERSION}
    environment:
      DATABASE_URL: postgres://rehearsal:disposable-rehearsal-only@postgres:5432/rehearsal
      PLATFORM_VERSION: \${PLATFORM_VERSION}
      ORIGIN: http://localhost:3000
      ALLOW_HTTP: 'true'
    depends_on:
      postgres:
        condition: service_healthy
volumes:
  data:
`;
    await writeFile(join(directory, "compose.yaml"), compose);
    await writeFile(
      join(directory, ".env"),
      `PLATFORM_VERSION=${versions[0]}\nREHEARSAL_VALUE=preserve\n`,
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, "Dockerfile"),
      `FROM ${imageRepository}:v0.5.0\nARG FIXTURE_VERSION\nLABEL org.opencontainers.image.version=$FIXTURE_VERSION\n`,
    );
    const driver = new DockerDeployment({
      directory,
      project,
      stateDirectory: state,
    });
    try {
      for (const version of versions) {
        let present = false;
        try {
          await command(["image", "inspect", `${imageRepository}:${version}`]);
          present = true;
        } catch {
          /* absent */
        }
        assert(!present, "Do not overwrite any existing local image");
        await command(
          [
            "build",
            "--build-arg",
            `FIXTURE_VERSION=${version}`,
            "-t",
            `${imageRepository}:${version}`,
            directory,
          ],
          { timeout: 180_000 },
        );
        made.push(version);
      }
      await driver.compose(["up", "-d"]);
      assert(await driver.waitReady(versions[0]));
      const db = await driver.container("postgres"),
        oldContainer = await driver.container("platform");
      await command([
        "exec",
        db,
        "psql",
        "-U",
        "rehearsal",
        "-d",
        "rehearsal",
        "-c",
        "CREATE TABLE updater_rehearsal (value text); INSERT INTO updater_rehearsal VALUES ('files-and-identities-preserved');",
      ]);
      // Test-only local fixtures substitute registry download; production always
      // verifies the published GitHub release and registry image identity.
      driver.pull = async (version) => {
        driver.downloadedImageId = JSON.parse(
          await command(["image", "inspect", `${imageRepository}:${version}`]),
        )[0].Id;
      };
      const reports = [];
      const journal = new Journal(join(state, "operations"));
      const runner = new UpdateRunner({
        journal,
        driver,
        report: async (r) => reports.push(r),
        release: async () => {},
      });
      const op = {
        id: randomUUID(),
        sourceVersion: versions[0],
        targetVersion: versions[1],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        resume: false,
      };
      await runner.execute(op);
      assert.equal(reports.at(-1).status, "succeeded", JSON.stringify(reports));
      assert(await driver.ready(versions[1]));
      assert.equal(
        await driver.container("postgres"),
        db,
        "Database container must remain running",
      );
      const newContainer = await driver.container("platform");
      assert.notEqual(newContainer, oldContainer);
      assert.equal(
        await command([
          "exec",
          db,
          "psql",
          "-U",
          "rehearsal",
          "-d",
          "rehearsal",
          "-Atc",
          "SELECT value FROM updater_rehearsal",
        ]),
        "files-and-identities-preserved",
      );
      assert(
        (await stat(join(state, "backups", op.id, "database.dump"))).size > 0,
      );
      assert(
        (
          await readFile(join(state, "backups", op.id, ".env"), "utf8")
        ).includes(versions[0]),
      );
      assert(
        (await readFile(join(directory, ".env"), "utf8")).includes(
          "REHEARSAL_VALUE=preserve",
        ),
      );
      await runner.execute({ ...op, resume: true });
      assert.equal(
        await driver.container("platform"),
        newContainer,
        "Replay must not recreate again",
      );
      const failing = new UpdateRunner({
        journal,
        driver,
        report: async () => {},
        release: async () => {},
      });
      const retry = {
        ...op,
        id: randomUUID(),
        sourceVersion: versions[1],
        targetVersion: "v99.0.2",
      };
      driver.pull = async () => {};
      driver.backup = async () => {
        throw new Error("Disk full");
      };
      await failing.execute(retry);
      assert.equal((await journal.read(retry.id)).code, "backup_failed");
      assert.equal(
        await driver.container("platform"),
        newContainer,
        "Backup failure must leave running platform untouched",
      );
    } finally {
      await driver
        .compose(["down", "--volumes", "--remove-orphans"])
        .catch(() => {});
      for (const version of made)
        await command(["image", "rm", `${imageRepository}:${version}`]).catch(
          () => {},
        );
    }
  },
);
