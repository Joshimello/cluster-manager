import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import {
  monitoringRangeConfig,
  type GpuHistoryPoint,
  type MonitoringHistoryResponse,
  type MonitoringRange
} from '$lib/monitoring-history';
import { getDatabase } from '$lib/server/db';
import { gpuObservations, gpus, workstationObservations } from '$lib/server/db/schema';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function loadMonitoringHistory(
  workstationIds: string[],
  range: MonitoringRange,
  now = new Date()
): Promise<MonitoringHistoryResponse> {
  const config = monitoringRangeConfig[range];
  const from = new Date(now.getTime() - config.durationMilliseconds);

  if (workstationIds.length === 0) {
    return {
      range,
      from: from.toISOString(),
      to: now.toISOString(),
      generatedAt: new Date().toISOString(),
      bucketSeconds: config.bucketSeconds,
      workstations: []
    };
  }

  const bucketSeconds = sql.raw(String(config.bucketSeconds));
  const workstationBucket = sql<Date>`to_timestamp(floor(extract(epoch from ${workstationObservations.observedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;
  const gpuBucket = sql<Date>`to_timestamp(floor(extract(epoch from ${gpuObservations.observedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;

  const [hostRows, gpuRows] = await Promise.all([
    getDatabase()
      .select({
        workstationId: workstationObservations.workstationId,
        observedAt: workstationBucket,
        cpuUtilizationPercent: sql<number>`avg(${workstationObservations.cpuUtilizationPercent})::double precision`,
        memoryUsedBytes: sql<number>`avg(${workstationObservations.memoryUsedBytes})::double precision`,
        memoryTotalBytes: sql<number>`avg(${workstationObservations.memoryTotalBytes})::double precision`,
        storagePath: sql<string>`max(${workstationObservations.storagePath})`,
        storageUsedBytes: sql<number>`avg(${workstationObservations.storageUsedBytes})::double precision`,
        storageTotalBytes: sql<number>`avg(${workstationObservations.storageTotalBytes})::double precision`
      })
      .from(workstationObservations)
      .where(
        and(
          inArray(workstationObservations.workstationId, workstationIds),
          gte(workstationObservations.observedAt, from),
          lte(workstationObservations.observedAt, now)
        )
      )
      .groupBy(workstationObservations.workstationId, workstationBucket)
      .orderBy(asc(workstationObservations.workstationId), asc(workstationBucket)),
    getDatabase()
      .select({
        workstationId: gpus.workstationId,
        gpuId: gpus.id,
        observedAt: gpuBucket,
        utilizationPercent: sql<number>`avg(${gpuObservations.utilizationPercent})::double precision`,
        memoryUsedBytes: sql<number>`avg(${gpuObservations.memoryUsedBytes})::double precision`,
        memoryTotalBytes: sql<number>`avg(${gpuObservations.memoryTotalBytes})::double precision`,
        temperatureC: sql<number | null>`avg(${gpuObservations.temperatureC})::double precision`
      })
      .from(gpuObservations)
      .innerJoin(gpus, eq(gpuObservations.gpuId, gpus.id))
      .where(
        and(
          inArray(gpus.workstationId, workstationIds),
          eq(gpus.active, true),
          gte(gpuObservations.observedAt, from),
          lte(gpuObservations.observedAt, now)
        )
      )
      .groupBy(gpus.workstationId, gpus.id, gpuBucket)
      .orderBy(asc(gpus.workstationId), asc(gpus.id), asc(gpuBucket))
  ]);

  const byWorkstation = new Map<string, MonitoringHistoryResponse['workstations'][number]>(
    workstationIds.map((workstationId) => [workstationId, { workstationId, points: [], gpus: [] }])
  );

  for (const row of hostRows) {
    byWorkstation.get(row.workstationId)?.points.push({
      observedAt: iso(row.observedAt),
      cpuUtilizationPercent: row.cpuUtilizationPercent,
      memoryUsedBytes: row.memoryUsedBytes,
      memoryTotalBytes: row.memoryTotalBytes,
      storagePath: row.storagePath,
      storageUsedBytes: row.storageUsedBytes,
      storageTotalBytes: row.storageTotalBytes
    });
  }

  const gpuSeries = new Map<string, { gpuId: string; points: GpuHistoryPoint[] }>();
  for (const row of gpuRows) {
    const key = `${row.workstationId}:${row.gpuId}`;
    let series = gpuSeries.get(key);
    if (!series) {
      series = { gpuId: row.gpuId, points: [] };
      gpuSeries.set(key, series);
      byWorkstation.get(row.workstationId)?.gpus.push(series);
    }
    series.points.push({
      observedAt: iso(row.observedAt),
      utilizationPercent: row.utilizationPercent,
      memoryUsedBytes: row.memoryUsedBytes,
      memoryTotalBytes: row.memoryTotalBytes,
      temperatureC: row.temperatureC
    });
  }

  return {
    range,
    from: from.toISOString(),
    to: now.toISOString(),
    generatedAt: new Date().toISOString(),
    bucketSeconds: config.bucketSeconds,
    workstations: [...byWorkstation.values()]
  };
}
