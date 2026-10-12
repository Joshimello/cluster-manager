import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  chmod,
  chown,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";
import { imageRepository } from "./protocol.mjs";
import { atomicWrite } from "./runner.mjs";

// Never use a shell for commands or copy CLI error output to the platform: Docker
// configuration and errors can contain deployment credentials.
export function command(
  args,
  { env = process.env, timeout = 120_000, outputFile } = {},
) {
  return new Promise((resolve, reject) => {
    let stdout = "",
      oversized = false;
    const child = spawn("docker", args, {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeout);
    const output = outputFile
      ? pipeline(
          child.stdout,
          createWriteStream(outputFile, { flags: "wx", mode: 0o600 }),
        ).then(async () => {
          const file = await open(outputFile, "r");
          try {
            await file.sync();
          } finally {
            await file.close();
          }
        })
      : null;
    if (!output)
      child.stdout.on("data", (chunk) => {
        if (stdout.length + chunk.length > 2_000_000) {
          oversized = true;
          child.kill("SIGKILL");
        } else stdout += chunk;
      });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Docker command failed"));
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      try {
        if (output) await output;
        if (code !== 0 || oversized) throw new Error("Docker command failed");
        resolve(stdout.trim());
      } catch {
        reject(new Error("Docker command failed"));
      }
    });
    // Attach a handler immediately; a failed stream must not become an unhandled rejection.
    output?.catch(() => {
      child.kill("SIGKILL");
    });
  });
}

export class DockerDeployment {
  constructor({
    directory,
    project,
    stateDirectory,
    composeFile = "compose.yaml",
    run = command,
  }) {
    if (
      !isAbsolute(directory) ||
      !isAbsolute(stateDirectory) ||
      !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project) ||
      !/^[a-zA-Z0-9_.-]+\.ya?ml$/.test(composeFile)
    )
      throw new Error("Invalid deployment configuration");
    Object.assign(this, {
      directory,
      project,
      stateDirectory,
      composeFile,
      run,
    });
  }
  compose(args, version, options = {}) {
    return this.run(
      [
        "compose",
        "--project-directory",
        this.directory,
        "-p",
        this.project,
        "-f",
        join(this.directory, this.composeFile),
        ...args,
      ],
      {
        ...options,
        env: {
          ...process.env,
          ...(version ? { PLATFORM_VERSION: version } : {}),
        },
      },
    );
  }
  async configuration(version) {
    return JSON.parse(
      await this.compose(["config", "--format", "json"], version),
    );
  }
  async container(service) {
    const id = await this.compose(["ps", "-q", service]);
    if (!/^[a-f0-9]{12,64}$/.test(id))
      throw new Error("Missing or ambiguous service");
    return id;
  }
  async preflight(operation) {
    if (this.operationId !== operation.id) this.configurationFingerprint = null;
    this.operationId = operation.id;
    for (const name of [this.composeFile, ".env"]) {
      const stat = await lstat(join(this.directory, name));
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Configuration must be ordinary files");
    }
    const base = await readFile(join(this.directory, this.composeFile), "utf8");
    if (!base.includes("${PLATFORM_VERSION"))
      throw new Error("Version interpolation is required");
    const envText = await readFile(join(this.directory, ".env"), "utf8");
    const fingerprint = createHash("sha256")
      .update(base)
      .update("\0")
      .update(envText)
      .digest("hex");
    if (
      this.configurationFingerprint &&
      this.configurationFingerprint !== fingerprint
    )
      throw new Error("Deployment source changed after approval");
    const entries = envText.match(/^PLATFORM_VERSION=.*$/gm);
    if (
      entries?.length !== 1 ||
      entries[0] !== `PLATFORM_VERSION=${operation.sourceVersion}`
    )
      throw new Error("Version file does not match approved source");
    const before = await this.configuration(operation.sourceVersion),
      after = await this.configuration(operation.targetVersion);
    for (const [config, version] of [
      [before, operation.sourceVersion],
      [after, operation.targetVersion],
    ]) {
      if (
        !config.services?.postgres ||
        config.services?.platform?.image !== `${imageRepository}:${version}` ||
        config.services.platform.environment?.PLATFORM_VERSION !== version
      )
        throw new Error("Unsupported deployment");
    }
    const normalized = structuredClone(after);
    normalized.services.platform.image = before.services.platform.image;
    normalized.services.platform.environment.PLATFORM_VERSION =
      before.services.platform.environment.PLATFORM_VERSION;
    if (JSON.stringify(normalized) !== JSON.stringify(before))
      throw new Error("Version changes unrelated configuration");
    if (!(await this.ready(operation.sourceVersion)))
      throw new Error("Running platform version changed");
    this.approvedConfiguration = JSON.stringify(before);
    this.configurationFingerprint = fingerprint;
  }
  async pull(version) {
    await this.run(["pull", `${imageRepository}:${version}`], {
      timeout: 15 * 60_000,
    });
    const image = JSON.parse(
      await this.run(["image", "inspect", `${imageRepository}:${version}`]),
    )[0];
    if (
      image.Config?.Labels?.["org.opencontainers.image.version"] !== version ||
      !image.RepoDigests?.some((digest) =>
        digest.startsWith(`${imageRepository}@sha256:`),
      )
    )
      throw new Error("Release image identity mismatch");
    this.downloadedImageId = image.Id;
  }
  async backup(operation) {
    const directory = join(this.stateDirectory, "backups", operation.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const path of [
      this.stateDirectory,
      join(this.stateDirectory, "backups"),
    ]) {
      const parent = await open(path, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
    for (const name of [this.composeFile, ".env"]) {
      await copyFile(
        join(this.directory, name),
        join(directory, name),
        constants.COPYFILE_EXCL,
      );
      await chmod(join(directory, name), 0o600);
    }
    await writeFile(
      join(directory, "resolved-compose.json"),
      this.approvedConfiguration,
      { flag: "wx", mode: 0o600 },
    );
    const platform = await this.container("platform");
    await writeFile(
      join(directory, "previous-image-id.txt"),
      await this.run(["inspect", "--format", "{{.Image}}", platform]),
      { flag: "wx", mode: 0o600 },
    );
    const container = await this.container("postgres");
    const dump = join(directory, "database.dump");
    await this.run(
      [
        "exec",
        container,
        "sh",
        "-c",
        'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --create --clean --if-exists',
      ],
      { outputFile: dump, timeout: 15 * 60_000 },
    );
    // Verify in the database container without exposing a host backup path to Docker.
    const input = await open(dump, "r");
    const check = spawn(
      "docker",
      ["exec", "-i", container, "pg_restore", "--list"],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    const timer = setTimeout(() => check.kill("SIGKILL"), 120_000);
    const exit = new Promise((resolve, reject) => {
      check.on("error", reject);
      check.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error("Invalid backup")),
      );
    });
    const stream = pipeline(input.createReadStream(), check.stdin);
    try {
      await Promise.all([stream, exit]);
    } finally {
      clearTimeout(timer);
    }
    for (const name of [
      this.composeFile,
      ".env",
      "resolved-compose.json",
      "previous-image-id.txt",
      "database.dump",
    ]) {
      const file = await open(join(directory, name), "r");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    }
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async restart(operation) {
    const path = join(this.directory, ".env");
    const stat = await lstat(path);
    const contents = await readFile(path, "utf8");
    await atomicWrite(
      path,
      contents.replace(
        /^PLATFORM_VERSION=.*$/m,
        `PLATFORM_VERSION=${operation.targetVersion}`,
      ),
      stat.mode & 0o777,
    );
    await chown(path, stat.uid, stat.gid);
    this.configurationFingerprint = null;
    await this.compose(
      ["up", "-d", "--no-deps", "--pull", "never", "platform"],
      operation.targetVersion,
    );
    const id = await this.container("platform");
    const [container] = JSON.parse(await this.run(["inspect", id]));
    if (container.Image !== this.downloadedImageId)
      throw new Error("Running image mismatch");
  }
  async ready(version) {
    try {
      const id = await this.container("platform");
      const [container] = JSON.parse(await this.run(["inspect", id]));
      if (container.Config?.Image !== `${imageRepository}:${version}`)
        return false;
      const [image] = JSON.parse(
        await this.run(["image", "inspect", container.Image]),
      );
      if (
        image.Config?.Labels?.["org.opencontainers.image.version"] !== version
      )
        return false;
      const text = await this.run(
        [
          "exec",
          id,
          "node",
          "-e",
          'fetch("http://127.0.0.1:3000/health").then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))',
        ],
        { timeout: 10_000 },
      );
      const result = JSON.parse(text);
      return result.status === "ready" && result.version === version;
    } catch {
      return false;
    }
  }
  async waitReady(version) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (await this.ready(version)) return true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return false;
  }
}
