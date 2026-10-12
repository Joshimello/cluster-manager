import { DockerDeployment } from "./docker.mjs";
import { Journal, UpdateRunner } from "./runner.mjs";

const token = process.env.PLATFORM_UPDATER_TOKEN ?? "";
if (!/^[a-f0-9]{64}$/.test(token))
  throw new Error(
    "PLATFORM_UPDATER_TOKEN must be 64 random hexadecimal characters",
  );
const url = new URL(process.env.PLATFORM_URL ?? "http://platform:3000");
if (
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash ||
  !["https:", "http:"].includes(url.protocol)
)
  throw new Error("Invalid platform URL");
if (url.protocol === "http:" && url.hostname !== "platform")
  throw new Error(
    "Plain HTTP is only supported on the private Docker platform network",
  );
const stateDirectory = process.env.UPDATER_STATE_DIR ?? "/state";
const driver = new DockerDeployment({
  directory: process.env.DEPLOYMENT_DIRECTORY,
  project: process.env.DEPLOYMENT_PROJECT,
  composeFile: process.env.DEPLOYMENT_COMPOSE_FILE ?? "compose.yaml",
  stateDirectory,
});
const journal = new Journal(`${stateDirectory}/operations`);
async function api(route, body = {}) {
  const response = await fetch(new URL(`/api/updater/v1/${route}`, url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Platform unavailable");
  return response.json();
}
const runner = new UpdateRunner({
  journal,
  driver,
  report: (result) => api("result", result),
});
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
console.log(JSON.stringify({ event: "updater.started" }));
while (!stopped) {
  try {
    const { operation } = await api("next");
    if (operation) {
      await runner.execute(operation);
      console.log(
        JSON.stringify({
          event: "updater.operation_checked",
          id: operation.id,
        }),
      );
    }
  } catch {
    console.log(JSON.stringify({ event: "updater.waiting_for_platform" }));
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
