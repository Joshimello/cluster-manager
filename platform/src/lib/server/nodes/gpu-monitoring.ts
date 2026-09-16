import { and, asc, eq } from 'drizzle-orm';

import { getDatabase } from '$lib/server/db';
import { gpuObservations, gpuProcessObservations, gpus } from '$lib/server/db/schema';

import { deriveConnectionState } from './heartbeat';

export async function loadWorkstationGpus(workstationId: string, visibleUsername?: string) {
  const rows = await getDatabase()
    .select({
      id: gpus.id,
      uuid: gpus.gpuUuid,
      index: gpus.localIndex,
      model: gpus.model,
      observedAt: gpus.lastObservedAt,
      utilizationPercent: gpus.utilizationPercent,
      memoryUsedBytes: gpus.memoryUsedBytes,
      memoryTotalBytes: gpus.memoryTotalBytes,
      temperatureC: gpus.temperatureC,
      processId: gpuProcessObservations.id,
      pid: gpuProcessObservations.pid,
      uid: gpuProcessObservations.uid,
      username: gpuProcessObservations.username,
      command: gpuProcessObservations.command,
      processMemoryUsedBytes: gpuProcessObservations.memoryUsedBytes,
      processStartTicks: gpuProcessObservations.processStartTicks
    })
    .from(gpus)
    .leftJoin(
      gpuObservations,
      and(eq(gpuObservations.gpuId, gpus.id), eq(gpuObservations.observedAt, gpus.lastObservedAt))
    )
    .leftJoin(
      gpuProcessObservations,
      visibleUsername
        ? and(
            eq(gpuProcessObservations.observationId, gpuObservations.id),
            eq(gpuProcessObservations.username, visibleUsername)
          )
        : eq(gpuProcessObservations.observationId, gpuObservations.id)
    )
    .where(and(eq(gpus.workstationId, workstationId), eq(gpus.active, true)))
    .orderBy(asc(gpus.localIndex), asc(gpuProcessObservations.pid));

  const byId = new Map<
    string,
    {
      id: string;
      uuid: string;
      index: number;
      model: string;
      observedAt: Date;
      telemetryState: ReturnType<typeof deriveConnectionState>;
      utilizationPercent: number;
      memoryUsedBytes: number;
      memoryTotalBytes: number;
      temperatureC: number | null;
      processes: Array<{
        id: string;
        pid: number;
        uid: number;
        username: string;
        command: string;
        memoryUsedBytes: number;
        processStartTicks: number | null;
      }>;
    }
  >();

  for (const row of rows) {
    let gpu = byId.get(row.id);
    if (!gpu) {
      gpu = {
        id: row.id,
        uuid: row.uuid,
        index: row.index,
        model: row.model,
        observedAt: row.observedAt,
        telemetryState: deriveConnectionState(row.observedAt),
        utilizationPercent: row.utilizationPercent,
        memoryUsedBytes: row.memoryUsedBytes,
        memoryTotalBytes: row.memoryTotalBytes,
        temperatureC: row.temperatureC,
        processes: []
      };
      byId.set(row.id, gpu);
    }
    if (
      row.processId &&
      row.pid !== null &&
      row.uid !== null &&
      row.username !== null &&
      row.command !== null &&
      row.processMemoryUsedBytes !== null
    ) {
      gpu.processes.push({
        id: row.processId,
        pid: row.pid,
        uid: row.uid,
        username: row.username,
        command: row.command,
        memoryUsedBytes: row.processMemoryUsedBytes,
        processStartTicks: row.processStartTicks
      });
    }
  }

  return [...byId.values()];
}
