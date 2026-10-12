import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Journal, UpdateRunner } from "./runner.mjs";
import { newer, parseOperation } from "./protocol.mjs";

const operation = () => ({
  id: randomUUID(),
  sourceVersion: "v0.5.0",
  targetVersion: "v0.6.0",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  resume: false,
});
async function fixture(failAt) {
  const directory = await mkdtemp(join(tmpdir(), "cm-updater-"));
  const journal = new Journal(directory),
    calls = [],
    reports = [];
  const driver = Object.fromEntries(
    ["preflight", "pull", "backup", "restart", "waitReady", "ready"].map(
      (name) => [
        name,
        async () => {
          calls.push(name);
          if (name === failAt) throw new Error("secret credential from driver");
          return name !== "ready";
        },
      ],
    ),
  );
  const runner = new UpdateRunner({
    journal,
    driver,
    report: async (r) => reports.push(r),
    release: async () => calls.push("release"),
  });
  return { journal, driver, calls, reports, runner, directory };
}
test("only accepts exact newer tags, UUID operations, and bounded identities", () => {
  assert(newer("v0.9.0", "v0.10.0"));
  for (const tag of [
    "main",
    "latest",
    "v0.5.0",
    "v0.4.0",
    "v0.6.0-beta",
    "v0.6.0; reboot",
  ])
    assert.equal(parseOperation({ ...operation(), targetVersion: tag }), null);
  assert.equal(
    parseOperation({ ...operation(), id: "../../etc/passwd" }),
    null,
  );
});
test("backs up before replacing, verifies health, journals success and never executes duplicate delivery", async () => {
  const f = await fixture(),
    op = operation();
  await f.runner.execute(op);
  assert.deepEqual(f.calls, [
    "release",
    "preflight",
    "pull",
    "backup",
    "preflight",
    "restart",
    "waitReady",
  ]);
  assert.equal((await f.journal.read(op.id)).status, "succeeded");
  await f.runner.execute({ ...op, resume: true });
  assert.equal(f.calls.filter((x) => x === "restart").length, 1);
  assert.equal(f.reports.at(-1).status, "succeeded");
});
for (const [failure, code] of [
  ["preflight", "configuration_invalid"],
  ["pull", "pull_failed"],
  ["backup", "backup_failed"],
  ["restart", "restart_failed"],
  ["waitReady", "health_failed"],
])
  test(`safe ${failure} failure, no credential leakage and no automatic retry`, async () => {
    const f = await fixture(failure),
      op = operation();
    await f.runner.execute(op);
    assert.equal(f.reports.at(-1).code, code);
    if (["preflight", "pull", "backup"].includes(failure))
      assert(!f.calls.includes("restart"));
    const count = f.calls.length;
    await f.runner.execute({ ...op, resume: true });
    assert.equal(f.calls.length, count);
    assert(
      !(await readFile(join(f.directory, `${op.id}.json`), "utf8")).includes(
        "secret",
      ),
    );
  });
test("lost acknowledgement is replayed without rerunning the update", async () => {
  const f = await fixture(),
    op = operation();
  f.runner.report = async () => {
    throw new Error("offline");
  };
  await f.runner.execute(op);
  const restarted = new UpdateRunner({
    journal: f.journal,
    driver: f.driver,
    report: async (r) => f.reports.push(r),
  });
  await restarted.execute({ ...op, resume: true });
  assert.equal(f.calls.filter((x) => x === "restart").length, 1);
  assert.equal(f.reports.at(-1).status, "succeeded");
});
for (const ready of [true, false])
  test(`interrupted journal recovery with ready=${ready} never repeats mutations`, async () => {
    const f = await fixture(),
      op = operation();
    await f.journal.init();
    await f.journal.write({ ...op, status: "restarting" });
    f.driver.ready = async () => ready;
    await f.runner.execute({ ...op, resume: true });
    assert.deepEqual(f.calls, []);
    assert.equal(f.reports.at(-1).code, ready ? "succeeded" : "interrupted");
  });
test("missing journal after dispatch and expired requests cannot execute", async () => {
  for (const op of [
    { ...operation(), resume: true },
    { ...operation(), expiresAt: new Date(0).toISOString() },
  ]) {
    const f = await fixture();
    await f.runner.execute(op);
    assert(!f.calls.includes("restart"));
    assert.equal(f.reports.at(-1).code, "interrupted");
  }
});
test("serializes concurrent deliveries", async () => {
  const f = await fixture(),
    op = operation();
  await Promise.all([f.runner.execute(op), f.runner.execute(op)]);
  assert.equal(f.calls.filter((x) => x === "restart").length, 1);
});
