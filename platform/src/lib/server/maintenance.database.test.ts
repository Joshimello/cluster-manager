import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import * as schema from './db/schema';
import { runMaintenance } from './maintenance';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('maintenance database integration', () => {
  it('deletes expired sessions and telemetry while retaining current rows', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    vi.stubEnv('TELEMETRY_RETENTION_HOURS', '24');
    const client = postgres(databaseUrl, { max: 4, prepare: false });
    const database = drizzle(client, { schema });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const username = `maint-${suffix}`;
    const workstationName = `maint-${suffix}`;
    const now = new Date('2026-09-19T00:00:00.000Z');
    let userId: string | undefined;
    let workstationId: string | undefined;

    try {
      const [identity] = await client`
        select nextval('user_posix_identity_sequence')::integer as posix_id
      `;
      const [user] = await client`
        insert into users (username, display_name, posix_uid, posix_gid, password_hash)
        values (
          ${username},
          'Maintenance database test',
          ${identity.posix_id},
          ${identity.posix_id},
          'test-only-hash'
        )
        returning id
      `;
      const createdUserId = user.id as string;
      userId = createdUserId;

      const expiredTokenHash = createHash('sha256').update(`expired-${suffix}`).digest('hex');
      const currentTokenHash = createHash('sha256').update(`current-${suffix}`).digest('hex');
      const sessions = await client`
        insert into sessions (token_hash, user_id, expires_at)
        values
          (${expiredTokenHash}, ${createdUserId}, ${new Date(now.getTime() - 60_000)}),
          (${currentTokenHash}, ${createdUserId}, ${new Date(now.getTime() + 60_000)})
        returning id, token_hash
      `;

      const [workstation] = await client`
        insert into workstations (name, display_name)
        values (${workstationName}, 'Maintenance database test')
        returning id
      `;
      const createdWorkstationId = workstation.id as string;
      workstationId = createdWorkstationId;
      const [gpu] = await client`
        insert into gpus (
          workstation_id, gpu_uuid, local_index, model, last_observed_at,
          utilization_percent, memory_used_bytes, memory_total_bytes
        )
        values (
          ${createdWorkstationId}, ${`GPU-${suffix}`}, 0, 'Test GPU', ${now},
          0, 0, 1
        )
        returning id
      `;
      const observations = await client`
        insert into gpu_observations (
          gpu_id, observed_at, utilization_percent, memory_used_bytes, memory_total_bytes
        )
        values
          (${gpu.id}, ${new Date(now.getTime() - 25 * 60 * 60_000)}, 0, 0, 1),
          (${gpu.id}, ${new Date(now.getTime() - 23 * 60 * 60_000)}, 0, 0, 1)
        returning id, observed_at
      `;

      await runMaintenance(now, database);

      const retainedSessions = await client`
        select id from sessions where id = any(${sessions.map((session) => session.id)})
      `;
      expect(retainedSessions.map((session) => session.id)).toEqual([sessions[1].id]);

      const retainedObservations = await client`
        select id from gpu_observations
        where id = any(${observations.map((observation) => observation.id)})
      `;
      expect(retainedObservations.map((observation) => observation.id)).toEqual([
        observations[1].id
      ]);
    } finally {
      if (userId) await client`delete from users where id = ${userId}`;
      if (workstationId) await client`delete from workstations where id = ${workstationId}`;
      await client.end();
      vi.unstubAllEnvs();
    }
  });
});
