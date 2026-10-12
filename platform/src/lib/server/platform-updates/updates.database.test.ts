import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')(
  'platform update authorization and durable workflow',
  () => {
    const client = postgres(process.env.DATABASE_URL ?? 'postgres://unused', {
      prepare: false,
      max: 8
    });
    const database = drizzle(client, { schema });
    let service: typeof import('./service');
    let page: typeof import('../../../routes/admin/updates/+page.server');
    let next: typeof import('../../../routes/api/updater/v1/next/+server');
    let result: typeof import('../../../routes/api/updater/v1/result/+server');
    let actor: string;
    const originalToken = process.env.PLATFORM_UPDATER_TOKEN;
    const token = 'a'.repeat(64);
    const username = `updater-${randomUUID().slice(0, 8)}`;
    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('$lib/server/db', () => ({ getDatabase: () => database }));
      vi.doMock('$lib/server/version', () => ({ platformVersion: 'v0.6.0' }));
      vi.doMock('./releases', () => ({
        checkPlatformRelease: async () => ({ release: { version: 'v0.7.0' }, error: null })
      }));
      process.env.PLATFORM_UPDATER_TOKEN = token;
      service = await import('./service');
      page = await import('../../../routes/admin/updates/+page.server');
      next = await import('../../../routes/api/updater/v1/next/+server');
      result = await import('../../../routes/api/updater/v1/result/+server');
      const [row] =
        await client`insert into users(username,display_name,role,posix_uid,posix_gid,password_hash,must_change_password) select ${username},'Updater Admin','admin',nextval('user_posix_identity_sequence')::integer,currval('user_posix_identity_sequence')::integer,'test',false returning id`;
      actor = row.id;
    });
    afterAll(async () => {
      await client`delete from audit_events where target_id in(select id from platform_updates where actor_id=${actor}) or actor_user_id=${actor}`;
      await client`delete from platform_updates where actor_id=${actor}`;
      await client`delete from users where id=${actor}`;
      await client`delete from platform_metadata where key='platform_updater_heartbeat'`;
      await client.end();
      if (originalToken === undefined) delete process.env.PLATFORM_UPDATER_TOKEN;
      else process.env.PLATFORM_UPDATER_TOKEN = originalToken;
      vi.doUnmock('$lib/server/db');
      vi.doUnmock('$lib/server/version');
      vi.doUnmock('./releases');
      vi.resetModules();
    });
    const request = (body: unknown, credential = token) =>
      new Request('http://localhost/api/updater', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
        body: JSON.stringify(body)
      });
    it('rejects web users and unauthorized updater calls', async () => {
      const install = page.actions.install!;
      for (const user of [
        null,
        { id: actor, role: 'user', mustChangePassword: false },
        { id: actor, role: 'admin', mustChangePassword: true }
      ])
        await expect(
          install({ locals: { user }, request: request({}) } as Parameters<typeof install>[0])
        ).rejects.toHaveProperty('location');
      for (const credential of ['', token + 'x', 'b'.repeat(64)]) {
        expect(
          (await next.POST({ request: request({}, credential) } as Parameters<typeof next.POST>[0]))
            .status
        ).toBe(401);
        expect(
          (
            await result.POST({ request: request({}, credential) } as Parameters<
              typeof result.POST
            >[0])
          ).status
        ).toBe(401);
      }
      expect(
        service.parseUpdateResult({ id: randomUUID(), status: 'failed', code: '__proto__' })
      ).toBeNull();
    });
    it('requires a fresh helper, confirmed published version and serializes simultaneous requests', async () => {
      await expect(service.requestPlatformUpdate(actor, 'v0.7.0', 'v0.7.0')).rejects.toThrow(
        'offline'
      );
      await service.updaterHeartbeat(new Date(Date.now() - 46_000));
      expect(await service.updaterReady()).toBe(false);
      await service.updaterHeartbeat();
      await expect(service.requestPlatformUpdate(actor, 'v0.7.0', 'wrong')).rejects.toThrow(
        'Confirm'
      );
      await expect(service.requestPlatformUpdate(actor, 'v0.8.0', 'v0.8.0')).rejects.toThrow(
        'Check'
      );
      const results = await Promise.allSettled([
        service.requestPlatformUpdate(actor, 'v0.7.0', 'v0.7.0'),
        service.requestPlatformUpdate(actor, 'v0.7.0', 'v0.7.0')
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const instruction = await service.nextPlatformUpdate();
      expect(instruction?.resume).toBe(false);
      expect((await service.nextPlatformUpdate())?.resume).toBe(true);
      expect((await client`select * from platform_updates where actor_id=${actor}`)[0].status).toBe(
        'preparing'
      );
      expect(
        await service.reportPlatformUpdate({
          id: instruction!.id,
          status: 'succeeded',
          code: 'succeeded'
        })
      ).toBe(false);
      expect(
        await service.reportPlatformUpdate({
          id: instruction!.id,
          status: 'restarting',
          code: 'restarting'
        })
      ).toBe(true);
      expect(
        await service.reportPlatformUpdate({
          id: instruction!.id,
          status: 'backing_up',
          code: 'backing_up'
        })
      ).toBe(false);
      expect(
        await service.reportPlatformUpdate({
          id: instruction!.id,
          status: 'failed',
          code: 'interrupted'
        })
      ).toBe(true);
      expect(
        await service.reportPlatformUpdate({
          id: instruction!.id,
          status: 'failed',
          code: 'interrupted'
        })
      ).toBe(true);
      expect(
        await service.reportPlatformUpdate({
          id: instruction!.id,
          status: 'restarting',
          code: 'restarting'
        })
      ).toBe(false);
      expect(await service.nextPlatformUpdate()).toBeNull();
      expect(
        (await client`select * from audit_events where target_id=${instruction!.id}`).length
      ).toBe(4);
    });
    it('expires undelivered requests but preserves dispatched operations for recovery and explicit retry', async () => {
      const row = await service.requestPlatformUpdate(actor, 'v0.7.0', 'v0.7.0');
      await client`update platform_updates set expires_at=now()-interval '1 minute' where id=${row.id}`;
      expect(await service.nextPlatformUpdate()).toBeNull();
      expect((await client`select status from platform_updates where id=${row.id}`)[0].status).toBe(
        'expired'
      );
      const retry = await service.requestPlatformUpdate(actor, 'v0.7.0', 'v0.7.0');
      await service.nextPlatformUpdate();
      await client`update platform_updates set expires_at=now()-interval '1 day' where id=${retry.id}`;
      expect((await service.nextPlatformUpdate())?.id).toBe(retry.id);
      await service.reportPlatformUpdate({ id: retry.id, status: 'failed', code: 'interrupted' });
      const success =
        await client`insert into platform_updates(actor_id,source_version,target_version,status,expires_at) values(${actor},'v0.5.0','v0.6.0','restarting',now()) returning id`;
      expect(
        await service.reportPlatformUpdate({
          id: success[0].id,
          status: 'succeeded',
          code: 'succeeded'
        })
      ).toBe(true);
    });
  }
);
