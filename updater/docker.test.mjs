import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerDeployment } from "./docker.mjs";
import { imageRepository } from "./protocol.mjs";

test("preflight validates version interpolation and refuses unrelated configuration changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-docker-"));
  await writeFile(
    join(directory, "compose.yaml"),
    "image: ${PLATFORM_VERSION}",
  );
  await writeFile(
    join(directory, ".env"),
    "PLATFORM_VERSION=v0.5.0\nSECRET=keep-me\n",
  );
  const calls = [];
  const run = async (args, options) => {
    calls.push(args);
    const version = options.env.PLATFORM_VERSION;
    return JSON.stringify({
      services: {
        platform: {
          image: `${imageRepository}:${version}`,
          environment: { PLATFORM_VERSION: version },
          ports: version === "v0.7.0" ? ["80:3000"] : ["127.0.0.1:3000:3000"],
        },
        postgres: { image: "postgres:18-alpine" },
      },
    });
  };
  const driver = new DockerDeployment({
    directory,
    project: "fixture",
    stateDirectory: directory,
    run,
  });
  driver.ready = async () => true;
  await driver.preflight({ sourceVersion: "v0.5.0", targetVersion: "v0.6.0" });
  await assert.rejects(
    driver.preflight({ sourceVersion: "v0.5.0", targetVersion: "v0.7.0" }),
    /unrelated/,
  );
  await writeFile(join(directory, ".env"), "PLATFORM_VERSION=v0.6.0\n");
  await assert.rejects(
    driver.preflight({ sourceVersion: "v0.5.0", targetVersion: "v0.7.0" }),
    /source/,
  );
  assert.equal(calls.filter((a) => a.includes("up")).length, 0);
});
test("refuses dangerous project and configuration paths", () => {
  for (const value of [
    { project: "--privileged" },
    { directory: "relative" },
    { composeFile: "../compose.yaml" },
  ])
    assert.throws(
      () =>
        new DockerDeployment({
          directory: "/deployment",
          project: "fixture",
          stateDirectory: "/state",
          ...value,
        }),
    );
});
test("persisted version preserves other environment values and only replaces the platform", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-docker-"));
  await writeFile(
    join(directory, ".env"),
    "PLATFORM_VERSION=v0.5.0\nSECRET=keep-me\n",
    { mode: 0o600 },
  );
  const calls = [];
  const driver = new DockerDeployment({
    directory,
    project: "fixture",
    stateDirectory: directory,
    run: async (args) => {
      calls.push(args);
      if (args.includes("ps")) return "a".repeat(64);
      if (args[0] === "inspect")
        return JSON.stringify([{ Image: "sha256:verified" }]);
      return "";
    },
  });
  driver.downloadedImageId = "sha256:verified";
  await driver.restart({ targetVersion: "v0.6.0" });
  assert.equal(
    await readFile(join(directory, ".env"), "utf8"),
    "PLATFORM_VERSION=v0.6.0\nSECRET=keep-me\n",
  );
  assert(
    calls.some(
      (args) =>
        args.slice(-6).join(" ") === "-d --no-deps --pull never platform" ||
        args.includes("--no-deps"),
    ),
  );
  assert(!calls.some((args) => args.includes("down")));
});
