import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')(
  'managed user usage database integration',
  () => {
    it('persists totals across telemetry cleanup, attributes identities, clips bookings and protects the admin Users tab', async () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
      const client = postgres(process.env.DATABASE_URL, { max: 4, prepare: false });
      const database = drizzle(client, { schema });
      const suffix = randomUUID().slice(0, 8);
      const [alice, bob] = await client`
      insert into users (username, display_name, role, posix_uid, posix_gid, password_hash)
      select name, name, role::user_role, identity, identity, 'hash'
      from (select ${`a-${suffix}`} as name, 'admin' as role, nextval('user_posix_identity_sequence')::integer as identity
        union all select ${`b-${suffix}`}, 'user', nextval('user_posix_identity_sequence')::integer) seed returning id, username, posix_uid
    `;
      const credential = `cmnode_${randomBytes(32).toString('base64url')}`;
      const hash = createHash('sha256').update(credential).digest('hex');
      const [workstation] =
        await client`insert into workstations (name, display_name, credential_hash) values (${`usage-${suffix}`}, 'Usage test', ${hash}) returning id`;
      await client`insert into workstation_assignments (user_id, workstation_id, provisioning_status) values (${alice.id}, ${workstation.id}, 'applied')`;
      const gpuA = `GPU-a-${suffix}`,
        gpuB = `GPU-b-${suffix}`;
      const gpuRows =
        await client`insert into gpus (workstation_id, gpu_uuid, local_index, model, last_observed_at, utilization_percent, memory_used_bytes, memory_total_bytes)
      values (${workstation.id}, ${gpuA}, 0, 'Test', now(), 0, 0, 1), (${workstation.id}, ${gpuB}, 1, 'Test', now(), 0, 0, 1) returning id, gpu_uuid`;
      const base = Math.floor(Date.now() / 60000) * 60000 - 120000 + 50000;
      await client`insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at, status, cancelled_at)
      values (${gpuRows.find((gpu) => gpu.gpu_uuid === gpuA)!.id}, ${alice.id}, ${alice.id}, ${new Date(base + 10000).toISOString()}, ${new Date(base + 70000).toISOString()}, 'cancelled', ${new Date(base + 15000).toISOString()})`;
      vi.resetModules();
      vi.doMock('$lib/server/db', () => ({ getDatabase: () => database }));
      try {
        const { POST } = await import('../../../routes/api/node/v1/heartbeat/+server');
        const heartbeat = async (
          offset: number,
          options: { bootId?: string; storage?: boolean } = {}
        ) => {
          const observedAt = new Date(base + offset);
          const gpu = (uuid: string, index: number) => ({
            uuid,
            index,
            model: 'Test',
            utilizationPercent: 1,
            memoryUsedBytes: 0,
            memoryTotalBytes: 1
          });
          const process = (
            gpuUuid: string,
            pid: number,
            username = alice.username,
            uid = alice.posix_uid
          ) => ({ gpuUuid, pid, uid, username, command: 'test', memoryUsedBytes: 0 });
          const response = await POST({
            request: new Request('http://localhost/api/node/v1/heartbeat', {
              method: 'POST',
              headers: {
                authorization: `Bearer ${credential}`,
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                observedAt,
                nodeVersion: 'test',
                hostname: 'test',
                bootId: options.bootId ?? 'boot',
                uptimeSeconds: 1,
                reportIntervalSeconds: 15,
                userStorage: options.storage
                  ? [
                      {
                        username: alice.username,
                        uid: alice.posix_uid,
                        bytes: 1024,
                        status: 'measured',
                        observedAt
                      },
                      {
                        username: bob.username,
                        uid: alice.posix_uid,
                        bytes: 9999,
                        status: 'measured',
                        observedAt
                      }
                    ]
                  : [],
                inventory: {
                  operatingSystem: 'Linux',
                  cpu: { logicalCores: 1, model: 'Test', utilizationPercent: 0 },
                  memory: { totalBytes: 1, usedBytes: 0, utilizationPercent: 0 },
                  storage: { path: '/', totalBytes: 1, usedBytes: 0, utilizationPercent: 0 },
                  sessions: [
                    { username: alice.username, uid: alice.posix_uid, terminal: 'pts/0' },
                    { username: alice.username, uid: alice.posix_uid, terminal: 'pts/1' }
                  ],
                  gpuStatus: 'available',
                  gpus: [gpu(gpuA, 0), gpu(gpuB, 1)],
                  gpuProcesses: [
                    process(gpuA, 10),
                    process(gpuA, 11),
                    process(gpuB, 12),
                    process(gpuB, 13, bob.username, alice.posix_uid)
                  ]
                }
              })
            })
          } as Parameters<typeof POST>[0]);
          expect(response.status).toBe(200);
        };
        await heartbeat(0, { storage: true });
        await heartbeat(20000);
        await heartbeat(20000);
        await heartbeat(10000);
        const [usage] =
          await client`select * from workstation_user_usage where workstation_id=${workstation.id} and user_id=${alice.id}`;
        expect(Number(usage.login_milliseconds)).toBe(20000);
        expect(Number(usage.gpu_milliseconds)).toBe(40000);
        expect(Number(usage.booked_gpu_milliseconds)).toBe(5000);
        expect(Number(usage.observed_scheduled_milliseconds)).toBe(5000);
        expect(Number(usage.storage_bytes)).toBe(1024);
        const [bobUsage] =
          await client`select * from workstation_user_usage where workstation_id=${workstation.id} and user_id=${bob.id}`;
        expect(Number(bobUsage.gpu_milliseconds)).toBe(0);
        expect(bobUsage.storage_bytes).toBeNull();
        await heartbeat(40000, { bootId: 'reboot' });
        await heartbeat(200000, { bootId: 'reboot' });
        const [afterGap] =
          await client`select login_milliseconds from workstation_user_usage where workstation_id=${workstation.id} and user_id=${alice.id}`;
        expect(Number(afterGap.login_milliseconds)).toBe(20000);
        await client`delete from gpu_observations where gpu_id in (${gpuRows[0].id}, ${gpuRows[1].id})`;
        const { load } = await import('../../../routes/admin/workstations/[id]/+page.server');
        const event = (role: string) => ({
          locals: { user: { id: alice.id, role, mustChangePassword: false } },
          params: { id: workstation.id },
          url: new URL('http://localhost/admin/workstations')
        });
        await expect(load(event('user') as Parameters<typeof load>[0])).rejects.toMatchObject({
          status: 303,
          location: '/dashboard'
        });
        const view = await load(event('admin') as Parameters<typeof load>[0]);
        expect(
          view?.managedUsers.find((user: { id: string }) => user.id === alice.id)
        ).toMatchObject({
          loginMilliseconds: 20000,
          gpuMilliseconds: 40000,
          storageBytes: 1024,
          scheduledMilliseconds: 5000,
          bookingUsagePercent: 100,
          outsideBookingMilliseconds: 35000
        });
        expect(view?.managedUsers.find((user: { id: string }) => user.id === bob.id)).toMatchObject(
          {
            assignmentStatus: 'unassigned',
            gpuMilliseconds: 0
          }
        );
        expect(view?.userUsageStartedAt).not.toBeNull();
        await client`update workstations set last_heartbeat_at = now(), inventory_observed_at = now() - interval '5 minutes' where id = ${workstation.id}`;
        const staleView = await load(event('admin') as Parameters<typeof load>[0]);
        expect(
          staleView?.managedUsers.find((user: { id: string }) => user.id === alice.id)
        ).toMatchObject({
          currentSessions: null,
          currentGpuCount: null,
          currentProcessCount: null,
          currentVramBytes: null,
          loginMilliseconds: 20000,
          gpuMilliseconds: 40000
        });
      } finally {
        vi.doUnmock('$lib/server/db');
        vi.resetModules();
        await client`delete from reservations where user_id in (${alice.id}, ${bob.id})`;
        await client`delete from workstation_assignments where workstation_id=${workstation.id}`;
        await client`delete from gpus where workstation_id=${workstation.id}`;
        await client`delete from workstations where id=${workstation.id}`;
        await client`delete from users where id in (${alice.id}, ${bob.id})`;
        await client.end();
      }
    });
  }
);
