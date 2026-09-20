import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { loadMonitoringHistory } from './history';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('monitoring history database integration', () => {
  it('buckets host and GPU observations in UTC', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    const client = postgres(databaseUrl, { max: 1, prepare: false });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const now = new Date('2026-09-20T12:00:00.000Z');
    let workstationId: string | undefined;

    try {
      const [workstation] = await client`
        insert into workstations (name, display_name)
        values (${`history-${suffix}`}, 'History database test')
        returning id
      `;
      workstationId = workstation.id as string;
      const [gpu] = await client`
        insert into gpus (
          workstation_id, gpu_uuid, local_index, model, last_observed_at,
          utilization_percent, memory_used_bytes, memory_total_bytes
        ) values (
          ${workstationId}, ${`GPU-${suffix}`}, 0, 'Test GPU',
          '2026-09-20T11:59:55Z'::timestamptz, 30, 3000, 10000
        ) returning id
      `;

      for (const [observedAt, cpu, memory, gpuUtilization] of [
        ['2026-09-20T11:59:05Z', 20, 2000, 10],
        ['2026-09-20T11:59:20Z', 40, 4000, 30],
        ['2026-09-20T11:59:55Z', 60, 6000, 50]
      ] as const) {
        await client`
          insert into workstation_observations (
            workstation_id, observed_at, cpu_utilization_percent,
            memory_used_bytes, memory_total_bytes, storage_path,
            storage_used_bytes, storage_total_bytes
          ) values (
            ${workstationId}, ${observedAt}::timestamptz, ${cpu},
            ${memory}, 10000, '/', ${memory}, 20000
          )
        `;
        await client`
          insert into gpu_observations (
            gpu_id, observed_at, utilization_percent,
            memory_used_bytes, memory_total_bytes, temperature_c
          ) values (
            ${gpu.id}, ${observedAt}::timestamptz, ${gpuUtilization},
            ${memory}, 10000, 60
          )
        `;
      }

      const history = await loadMonitoringHistory([workstationId], '1h', now);
      expect(history.bucketSeconds).toBe(30);
      expect(history.workstations).toHaveLength(1);
      expect(history.workstations[0].points).toHaveLength(2);
      expect(history.workstations[0].points[0]).toMatchObject({
        observedAt: '2026-09-20T11:59:00.000Z',
        cpuUtilizationPercent: 30,
        memoryUsedBytes: 3000
      });
      expect(history.workstations[0].gpus[0].points[0]).toMatchObject({
        utilizationPercent: 20,
        memoryUsedBytes: 3000,
        temperatureC: 60
      });
    } finally {
      if (workstationId) await client`delete from workstations where id = ${workstationId}`;
      await client.end();
    }
  });
});
