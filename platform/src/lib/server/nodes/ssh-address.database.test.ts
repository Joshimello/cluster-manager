import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')(
  'SSH instructions database integration',
  () => {
    it('detects addresses, preserves admin overrides across heartbeats, and changes only displayed instructions', async () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      const client = postgres(process.env.DATABASE_URL, { max: 4, prepare: false });
      const database = drizzle(client, { schema });
      const suffix = randomUUID().slice(0, 8);
      const credential = `cmnode_${randomBytes(32).toString('base64url')}`;
      const hash = createHash('sha256').update(credential).digest('hex');
      const [actor] = await client`
      insert into users (username, display_name, role, posix_uid, posix_gid, password_hash)
      select ${`ssh-${suffix}`}, 'SSH test', 'admin', identity, identity, 'test-hash'
      from (select nextval('user_posix_identity_sequence')::integer as identity) seed
      returning id
    `;
      const [workstation] = await client`
      insert into workstations (name, display_name, credential_hash)
      values (${`ssh-${suffix}`}, 'SSH test', ${hash}) returning id, name
    `;
      await client`insert into workstation_assignments (user_id, workstation_id, provisioning_status)
      values (${actor.id}, ${workstation.id}, 'applied')`;
      vi.resetModules();
      vi.doMock('$lib/server/db', () => ({ getDatabase: () => database }));
      try {
        const { POST } = await import('../../../routes/api/node/v1/heartbeat/+server');
        const { GET } = await import('../../../routes/api/node/v1/desired-state/+server');
        const { actions } = await import('../../../routes/admin/workstations/[id]/+page.server');
        const { load } = await import('../../../routes/dashboard/+page.server');
        const admin = { id: actor.id, role: 'admin', mustChangePassword: false };
        const setAddress = actions.setSshAddress!;
        const event = (address: string, user: unknown = admin) => ({
          locals: { user },
          params: { id: workstation.id },
          request: new Request('http://localhost/admin/workstations', {
            method: 'POST',
            body: new URLSearchParams({ sshAddress: address })
          })
        });
        const heartbeat = async (ipAddresses: string[] | undefined, observedAt: Date) => {
          const response = await POST({
            request: new Request('http://localhost/api/node/v1/heartbeat', {
              method: 'POST',
              headers: {
                authorization: `Bearer ${credential}`,
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                observedAt,
                nodeVersion: 'dev',
                hostname: 'test-host',
                ipAddresses,
                bootId: 'test-boot',
                uptimeSeconds: 1,
                inventory: {
                  operatingSystem: 'Linux',
                  cpu: { logicalCores: 1, model: 'Test', utilizationPercent: 0 },
                  memory: { totalBytes: 1, usedBytes: 0, utilizationPercent: 0 },
                  storage: { path: '/', totalBytes: 1, usedBytes: 0, utilizationPercent: 0 },
                  sessions: [],
                  gpuStatus: 'available',
                  gpus: [],
                  gpuProcesses: []
                }
              })
            })
          } as Parameters<typeof POST>[0]);
          expect(response.status).toBe(200);
        };
        const shownAddress = async () => {
          const data = await load({ locals: { user: admin } } as Parameters<typeof load>[0]);
          return data!.assignments[0].sshAddress;
        };
        const now = Date.now();
        await heartbeat(['192.168.1.50'], new Date(now));
        expect(await shownAddress()).toBe('192.168.1.50');
        await expect(
          setAddress(
            event('10.0.0.5', { ...admin, role: 'user' }) as Parameters<typeof setAddress>[0]
          )
        ).rejects.toMatchObject({ status: 303, location: '/dashboard' });
        expect(
          await setAddress(event('host; whoami') as Parameters<typeof setAddress>[0])
        ).toMatchObject({ status: 400 });
        expect(
          await setAddress(event('10.0.0.5') as Parameters<typeof setAddress>[0])
        ).toMatchObject({ success: true });
        await heartbeat(['192.168.1.51'], new Date(now + 1000));
        expect(await shownAddress()).toBe('10.0.0.5');
        await heartbeat(['192.168.1.49'], new Date(now - 1000));
        await heartbeat(undefined, new Date(now + 2000));
        const [stored] =
          await client`select ip_addresses, ssh_address_override, credential_hash, status from workstations where id = ${workstation.id}`;
        expect(stored).toMatchObject({
          ip_addresses: ['192.168.1.51'],
          ssh_address_override: '10.0.0.5',
          credential_hash: hash,
          status: 'active'
        });
        const desired = await GET({
          request: new Request('http://localhost/api/node/v1/desired-state', {
            headers: { authorization: `Bearer ${credential}` }
          })
        } as Parameters<typeof GET>[0]);
        expect((await desired.json()).workstation).toEqual({
          id: workstation.id,
          name: workstation.name
        });
        expect(await setAddress(event('') as Parameters<typeof setAddress>[0])).toMatchObject({
          success: true
        });
        expect(await shownAddress()).toBe('192.168.1.51');
        await heartbeat([], new Date(now + 3000));
        expect(await shownAddress()).toBeNull();
        const audits =
          await client`select action from audit_events where target_id = ${workstation.id}`;
        expect(audits).toEqual([
          { action: 'workstation.ssh_address_updated' },
          { action: 'workstation.ssh_address_updated' }
        ]);
        await client`update workstations set deleted_at = now() where id = ${workstation.id}`;
        expect(
          await setAddress(event('10.0.0.6') as Parameters<typeof setAddress>[0])
        ).toMatchObject({ status: 404 });
      } finally {
        vi.doUnmock('$lib/server/db');
        vi.resetModules();
        await client`delete from audit_events where actor_user_id = ${actor.id}`;
        await client`delete from workstation_assignments where workstation_id = ${workstation.id}`;
        await client`delete from workstations where id = ${workstation.id}`;
        await client`delete from users where id = ${actor.id}`;
        await client.end();
      }
    });
  }
);
