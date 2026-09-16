import type { WorkstationInventory } from '$lib/server/db/schema';

export const onlineAfterMilliseconds = 45_000;
export const offlineAfterMilliseconds = 120_000;

export type ConnectionState = 'never' | 'online' | 'stale' | 'offline';

export type HeartbeatReport = {
  observedAt: Date;
  nodeVersion: string;
  hostname: string;
  bootId: string;
  uptimeSeconds: number;
  inventory: WorkstationInventory;
  gpus: Array<{
    uuid: string;
    index: number;
    model: string;
    utilizationPercent: number;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    temperatureC: number | null;
  }>;
  gpuProcesses: Array<{
    gpuUuid: string;
    pid: number;
    uid: number;
    username: string;
    command: string;
    memoryUsedBytes: number;
    processStartTicks: number | null;
  }>;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function number(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function bytes(value: unknown): number | null {
  const parsed = number(value, 0);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function utilization(value: unknown): number | null {
  return number(value, 0, 100);
}

export function parseHeartbeatReport(value: unknown): HeartbeatReport | null {
  const root = object(value);
  const inventory = object(root?.inventory);
  const cpu = object(inventory?.cpu);
  const memory = object(inventory?.memory);
  const storage = object(inventory?.storage);
  const sessions = inventory?.sessions;
  const gpus = inventory?.gpus;
  const gpuProcesses = inventory?.gpuProcesses;
  const observedAtText = text(root?.observedAt, 64);
  const observedAt = observedAtText ? new Date(observedAtText) : null;

  const nodeVersion = text(root?.nodeVersion, 64);
  const hostname = text(root?.hostname, 255);
  const bootId = text(root?.bootId, 128);
  const uptimeSeconds = number(root?.uptimeSeconds, 0);
  const operatingSystem = text(inventory?.operatingSystem, 255);
  const cpuModel = text(cpu?.model, 255);
  const logicalCores = number(cpu?.logicalCores, 1, 4096);
  const cpuUtilization = utilization(cpu?.utilizationPercent);
  const memoryTotal = bytes(memory?.totalBytes);
  const memoryUsed = bytes(memory?.usedBytes);
  const memoryUtilization = utilization(memory?.utilizationPercent);
  const storagePath = text(storage?.path, 512);
  const storageTotal = bytes(storage?.totalBytes);
  const storageUsed = bytes(storage?.usedBytes);
  const storageUtilization = utilization(storage?.utilizationPercent);
  const gpuStatus = inventory?.gpuStatus;

  if (
    !observedAt ||
    Number.isNaN(observedAt.getTime()) ||
    !nodeVersion ||
    !hostname ||
    !bootId ||
    uptimeSeconds === null ||
    !operatingSystem ||
    !cpuModel ||
    logicalCores === null ||
    cpuUtilization === null ||
    memoryTotal === null ||
    memoryUsed === null ||
    memoryUsed > memoryTotal ||
    memoryUtilization === null ||
    !storagePath ||
    storageTotal === null ||
    storageUsed === null ||
    storageUsed > storageTotal ||
    storageUtilization === null ||
    !Array.isArray(sessions) ||
    sessions.length > 512 ||
    (gpuStatus !== 'available' && gpuStatus !== 'unavailable') ||
    !Array.isArray(gpus) ||
    gpus.length > 32 ||
    !Array.isArray(gpuProcesses) ||
    gpuProcesses.length > 4096
  ) {
    return null;
  }

  const parsedSessions: WorkstationInventory['sessions'] = [];
  for (const candidate of sessions) {
    const session = object(candidate);
    const username = text(session?.username, 64);
    const terminal = text(session?.terminal, 128);
    const remoteHostValue = session?.remoteHost;
    const remoteHost = remoteHostValue === undefined ? undefined : text(remoteHostValue, 255);
    if (!username || !terminal || (remoteHostValue !== undefined && !remoteHost)) return null;
    parsedSessions.push({ username, terminal, ...(remoteHost ? { remoteHost } : {}) });
  }

  const parsedGpus: HeartbeatReport['gpus'] = [];
  const gpuUuids = new Set<string>();
  for (const candidate of gpus) {
    const gpu = object(candidate);
    const uuid = text(gpu?.uuid, 128);
    const index = number(gpu?.index, 0, 31);
    const model = text(gpu?.model, 255);
    const utilizationPercent = utilization(gpu?.utilizationPercent);
    const memoryUsedBytes = bytes(gpu?.memoryUsedBytes);
    const memoryTotalBytes = bytes(gpu?.memoryTotalBytes);
    const temperatureValue = gpu?.temperatureC;
    const temperatureC =
      temperatureValue === undefined || temperatureValue === null
        ? null
        : number(temperatureValue, -100, 250);
    if (
      !uuid ||
      gpuUuids.has(uuid) ||
      index === null ||
      !Number.isInteger(index) ||
      !model ||
      utilizationPercent === null ||
      memoryUsedBytes === null ||
      memoryTotalBytes === null ||
      memoryTotalBytes === 0 ||
      memoryUsedBytes > memoryTotalBytes ||
      (temperatureValue !== undefined && temperatureValue !== null && temperatureC === null)
    ) {
      return null;
    }
    gpuUuids.add(uuid);
    parsedGpus.push({
      uuid,
      index,
      model,
      utilizationPercent,
      memoryUsedBytes,
      memoryTotalBytes,
      temperatureC
    });
  }
  if (gpuStatus === 'unavailable' && parsedGpus.length > 0) return null;

  const parsedProcesses: HeartbeatReport['gpuProcesses'] = [];
  for (const candidate of gpuProcesses) {
    const process = object(candidate);
    const gpuUuid = text(process?.gpuUuid, 128);
    const pid = number(process?.pid, 1, 2_147_483_647);
    const uid = number(process?.uid, 0, 2_147_483_647);
    const username = text(process?.username, 64);
    const command = text(process?.command, 128);
    const memoryUsedBytes = bytes(process?.memoryUsedBytes);
    const startValue = process?.processStartTicks;
    const processStartTicks =
      startValue === undefined || startValue === null ? null : number(startValue, 0);
    if (
      !gpuUuid ||
      !gpuUuids.has(gpuUuid) ||
      pid === null ||
      !Number.isInteger(pid) ||
      uid === null ||
      !Number.isInteger(uid) ||
      !username ||
      !command ||
      memoryUsedBytes === null ||
      (startValue !== undefined && startValue !== null && processStartTicks === null)
    ) {
      return null;
    }
    parsedProcesses.push({
      gpuUuid,
      pid,
      uid,
      username,
      command,
      memoryUsedBytes,
      processStartTicks
    });
  }

  return {
    observedAt,
    nodeVersion,
    hostname,
    bootId,
    uptimeSeconds,
    inventory: {
      operatingSystem,
      cpu: { model: cpuModel, logicalCores, utilizationPercent: cpuUtilization },
      memory: {
        totalBytes: memoryTotal,
        usedBytes: memoryUsed,
        utilizationPercent: memoryUtilization
      },
      storage: {
        path: storagePath,
        totalBytes: storageTotal,
        usedBytes: storageUsed,
        utilizationPercent: storageUtilization
      },
      sessions: parsedSessions,
      gpuStatus
    },
    gpus: parsedGpus,
    gpuProcesses: parsedProcesses
  };
}

export function deriveConnectionState(
  lastHeartbeatAt: Date | null,
  now = new Date()
): ConnectionState {
  if (!lastHeartbeatAt) return 'never';
  const age = Math.max(0, now.getTime() - lastHeartbeatAt.getTime());
  if (age <= onlineAfterMilliseconds) return 'online';
  if (age <= offlineAfterMilliseconds) return 'stale';
  return 'offline';
}
