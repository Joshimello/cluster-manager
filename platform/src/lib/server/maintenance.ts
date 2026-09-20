import { sql } from 'drizzle-orm';

import { getDatabase } from '$lib/server/db';
import { structuredLog } from '$lib/server/logging';

const defaultTelemetryRetentionHours = 24;
const maintenanceIntervalMilliseconds = 15 * 60_000;
let lastRun = 0;
let activeRun: Promise<void> | null = null;

export function telemetryRetentionHours(value = process.env.TELEMETRY_RETENTION_HOURS): number {
  if (!value) return defaultTelemetryRetentionHours;
  if (!/^\d+$/.test(value)) {
    throw new Error('TELEMETRY_RETENTION_HOURS must be an integer from 1 to 720');
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 720) {
    throw new Error('TELEMETRY_RETENTION_HOURS must be an integer from 1 to 720');
  }
  return parsed;
}

export async function runMaintenance(now = new Date(), database = getDatabase()): Promise<void> {
  const retentionHours = telemetryRetentionHours();
  const cutoff = new Date(now.getTime() - retentionHours * 60 * 60_000);
  const nowTimestamp = now.toISOString();
  const cutoffTimestamp = cutoff.toISOString();
  const [sessionsResult, gpuObservationsResult, workstationObservationsResult] = await Promise.all([
    database.execute(sql`
      with expired as (
        select id from sessions
        where expires_at <= ${nowTimestamp}::timestamptz
        order by expires_at
        limit 10000
      )
      delete from sessions where id in (select id from expired)
    `),
    database.execute(sql`
      with expired as (
        select id from gpu_observations
        where observed_at < ${cutoffTimestamp}::timestamptz
        order by observed_at
        limit 50000
      )
      delete from gpu_observations where id in (select id from expired)
    `),
    database.execute(sql`
      with expired as (
        select id from workstation_observations
        where observed_at < ${cutoffTimestamp}::timestamptz
        order by observed_at
        limit 50000
      )
      delete from workstation_observations where id in (select id from expired)
    `)
  ]);
  structuredLog('info', 'maintenance.completed', {
    expiredSessions: sessionsResult.count,
    expiredGpuTelemetry: gpuObservationsResult.count,
    expiredWorkstationTelemetry: workstationObservationsResult.count,
    telemetryRetentionHours: retentionHours
  });
}

export async function runMaintenanceIfDue(now = new Date()): Promise<void> {
  if (now.getTime() - lastRun < maintenanceIntervalMilliseconds) return;
  if (activeRun) return activeRun;
  activeRun = runMaintenance(now)
    .then(() => {
      lastRun = now.getTime();
    })
    .catch((error: unknown) => {
      structuredLog('error', 'maintenance.failed', {
        message: error instanceof Error ? error.message : 'unknown error'
      });
    })
    .finally(() => {
      activeRun = null;
    });
  return activeRun;
}
