import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseOperation, verifyRelease } from "./protocol.mjs";

export async function atomicWrite(path, value, mode = 0o600) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", mode);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
  const directory = await open(join(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export class Journal {
  constructor(directory) {
    this.directory = directory;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const parent = await open(join(this.directory, ".."), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
  async read(id) {
    try {
      return JSON.parse(
        await readFile(join(this.directory, `${id}.json`), "utf8"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async write(record) {
    await atomicWrite(
      join(this.directory, `${record.id}.json`),
      JSON.stringify(record),
    );
  }
}

export class UpdateRunner {
  #running = false;
  constructor({
    journal,
    driver,
    report,
    release = verifyRelease,
    now = () => Date.now(),
  }) {
    Object.assign(this, { journal, driver, report, release, now });
  }
  async execute(raw) {
    if (this.#running) return;
    const operation = parseOperation(raw);
    if (!operation) return;
    this.#running = true;
    let record;
    const publish = async (status, code) => {
      record = {
        ...record,
        status,
        code,
        updatedAt: new Date(this.now()).toISOString(),
      };
      await this.journal.write(record);
      // The platform is expected to be unreachable during replacement. The receipt
      // remains durable and is delivered on the next poll after it returns.
      try {
        await this.report({ id: record.id, status, code });
      } catch {
        /* retry from journal */
      }
    };
    try {
      await this.journal.init();
      record = await this.journal.read(operation.id);
      if (
        record &&
        (record.sourceVersion !== operation.sourceVersion ||
          record.targetVersion !== operation.targetVersion)
      )
        throw new Error("Journal identity conflict");
      if (record && ["succeeded", "failed"].includes(record.status)) {
        await this.report({
          id: record.id,
          status: record.status,
          code: record.code,
        });
        return;
      }
      if (record || operation.resume) {
        record ??= { ...operation };
        // Never repeat mutations after interruption, even if the acknowledgement
        // was lost before the local intent was written.
        const ready = await this.driver
          .ready(operation.targetVersion)
          .catch(() => false);
        await publish(
          ready ? "succeeded" : "failed",
          ready ? "succeeded" : "interrupted",
        );
        return;
      }
      record = { ...operation, status: "preparing", code: "preparing" };
      await this.journal.write(record);
      if (Date.parse(operation.expiresAt) <= this.now()) {
        await publish("failed", "interrupted");
        return;
      }
      let phase = "release_unavailable";
      try {
        await this.release(operation.targetVersion);
        phase = "configuration_invalid";
        await this.driver.preflight(operation);
        phase = "pull_failed";
        await this.driver.pull(operation.targetVersion);
        await publish("backing_up", "backing_up");
        phase = "backup_failed";
        await this.driver.backup(operation);
        // Revalidate after the potentially long download and backup.
        phase = "configuration_invalid";
        await this.driver.preflight(operation);
        await publish("restarting", "restarting");
        phase = "restart_failed";
        await this.driver.restart(operation);
        phase = "health_failed";
        if (!(await this.driver.waitReady(operation.targetVersion)))
          throw new Error("Not ready");
        await publish("succeeded", "succeeded");
      } catch {
        await publish("failed", phase);
      }
    } finally {
      this.#running = false;
    }
  }
}
