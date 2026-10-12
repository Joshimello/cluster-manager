import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import type { LocalAccount } from '$lib/account-management';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== 'true')(
  'account management database integration',
  () => {
    const client = postgres(process.env.DATABASE_URL ?? 'postgres://unused', {
      max: 8,
      prepare: false
    });
    const database = drizzle(client, { schema });
    let service: typeof import('./accounts');
    let next: typeof import('../../../routes/api/node/v1/accounts/next/+server');
    let result: typeof import('../../../routes/api/node/v1/accounts/result/+server');
    let desired: typeof import('../../../routes/api/node/v1/desired-state/+server');
    let reconciliation: typeof import('../../../routes/api/node/v1/reconciliation/+server');
    let actor: string, workstation: string, prefix: string, credential: string;
    let ids = 31000;
    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('$lib/server/db', () => ({ getDatabase: () => database }));
      service = await import('./accounts');
      next = await import('../../../routes/api/node/v1/accounts/next/+server');
      result = await import('../../../routes/api/node/v1/accounts/result/+server');
      desired = await import('../../../routes/api/node/v1/desired-state/+server');
      reconciliation = await import('../../../routes/api/node/v1/reconciliation/+server');
    });
    beforeEach(async () => {
      prefix = `ac${randomUUID().slice(0, 8)}`;
      credential = `cmnode_${randomBytes(32).toString('base64url')}`;
      const [u] =
        await client`insert into users (username,display_name,role,posix_uid,posix_gid,password_hash,linux_password_hash,must_change_password)
      select ${prefix + 'admin'}, 'Admin', 'admin', id, id, 'web-hash', ${linuxHash}, false
      from (select nextval('user_posix_identity_sequence')::integer as id) n returning id`;
      actor = u.id;
      const [ws] =
        await client`insert into workstations (name,display_name,credential_hash,node_capabilities,last_heartbeat_at)
      values (${prefix},'Import fixture',${createHash('sha256').update(credential).digest('hex')},'["account-management-v1"]'::jsonb,now()) returning id`;
      workstation = ws.id;
    });
    afterEach(async () => {
      const matches = prefix + '%';
      await client`delete from audit_events where actor_user_id in (select id from users where username like ${matches}) or target_id in (select id from account_operations where actor_id=${actor})`;
      await client`delete from account_operations where actor_id=${actor}`;
      await client`delete from workstation_assignments where user_id in (select id from users where username like ${matches})`;
      await client`delete from sessions where user_id in (select id from users where username like ${matches})`;
      await client`delete from users where username like ${matches}`;
      await client`delete from workstations where name like ${matches}`;
      await client`delete from posix_identity_reservations where username like ${matches}`;
    });
    afterAll(async () => {
      vi.doUnmock('$lib/server/db');
      await client.end();
    });
    const linuxHash = '$6$fixture$' + 'a'.repeat(86);
    const account = (suffix = 'user', uid = ++ids): LocalAccount => ({
      username: prefix + suffix,
      uid,
      gid: uid,
      home: `/home/${prefix + suffix}`,
      primaryGroup: prefix + suffix,
      fingerprint: 'a'.repeat(64),
      eligible: true,
      reason: '',
      ownerWorkstationId: '',
      exists: true
    });
    async function scan(accounts: LocalAccount[], age = 0, complete = true) {
      const snapshot = { observedAt: new Date(Date.now() - age).toISOString(), complete, accounts };
      await client`update workstations set account_snapshot=${JSON.stringify(snapshot)}::jsonb,last_heartbeat_at=now() where id=${workstation}`;
      await database.transaction((tx) => service.reserveSnapshotIds(tx, snapshot));
    }
    const event = (body?: unknown, token = credential) => ({
      request: new Request('http://localhost/api/node/v1/accounts', {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
    });
    const importLocal = (a: LocalAccount) =>
      service.importAccount(
        {
          actorId: actor,
          workstationId: workstation,
          username: a.username,
          fingerprint: a.fingerprint,
          confirmation: a.username
        },
        database
      );
    async function managed(a: LocalAccount) {
      const imported = await importLocal(a);
      const command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      expect(command.id).toBe(imported.operationId);
      expect(command.account).toEqual(a);
      expect(
        (
          await result.POST(
            event({ id: command.id, status: 'completed', detail: 'Adopted' }) as Parameters<
              typeof result.POST
            >[0]
          )
        ).status
      ).toBe(200);
      const [u] = await client`select id from users where username=${a.username}`;
      return { ...imported, userId: u.id, command };
    }
    it('imports onto a new registration, omits pending adoption from desired state, and waits for password synchronization', async () => {
      const a = { ...account(), ownerWorkstationId: randomUUID() };
      await scan([a]);
      const imported = await importLocal(a);
      expect(imported.temporaryPassword).toBeTruthy();
      let wire = await (await desired.GET(event() as Parameters<typeof desired.GET>[0])).json();
      expect(wire.users).toEqual([]);
      const [u] = await client`select * from users where username=${a.username}`;
      expect(u).toMatchObject({
        posix_uid: a.uid,
        posix_gid: a.gid,
        role: 'user',
        display_name: a.username,
        must_change_password: true
      });
      expect(u.password_hash).not.toBe(imported.temporaryPassword);
      const command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      expect(
        (
          await result.POST(
            event({ id: command.id, status: 'completed', detail: 'Adopted' }) as Parameters<
              typeof result.POST
            >[0]
          )
        ).status
      ).toBe(200);
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('adopted');
      wire = await (await desired.GET(event() as Parameters<typeof desired.GET>[0])).json();
      expect(wire.users[0]).toMatchObject({
        uid: a.uid,
        gid: a.gid,
        enabled: true,
        passwordHash: u.linux_password_hash
      });
      expect(Object.keys(wire.users[0]).sort()).toEqual([
        'assignmentId',
        'enabled',
        'generation',
        'gid',
        'passwordHash',
        'uid',
        'username'
      ]);
      await reconciliation.POST(
        event({
          results: [
            {
              assignmentId: command.assignmentId,
              generation: command.generation,
              status: 'applied',
              message: 'Synced'
            }
          ]
        }) as Parameters<typeof reconciliation.POST>[0]
      );
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('completed');
      expect(
        (
          await result.POST(
            event({ id: command.id, status: 'completed', detail: 'Duplicate' }) as Parameters<
              typeof result.POST
            >[0]
          )
        ).status
      ).toBe(200);
      const audit = await client`select metadata from audit_events where target_id=${command.id}`;
      expect(JSON.stringify(audit)).not.toContain(imported.temporaryPassword);
      expect(JSON.stringify(audit)).not.toContain(u.linux_password_hash);
    });
    it('links an exact active identity without changing any passwords or other workstation assignments', async () => {
      const a = account();
      await scan([a]);
      const [u] =
        await client`insert into users(username,display_name,posix_uid,posix_gid,password_hash,linux_password_hash,must_change_password) values(${a.username},'Existing',${a.uid},${a.gid},'existing-web',${linuxHash},false) returning id`;
      const [other] =
        await client`insert into workstations(name,display_name) values(${prefix + 'other'},'Other') returning id`;
      await client`insert into workstation_assignments(user_id,workstation_id,desired_generation) values(${u.id},${other.id},7)`;
      const imported = await managed(a);
      expect(imported.temporaryPassword).toBeUndefined();
      expect(
        (await client`select password_hash,linux_password_hash from users where id=${u.id}`)[0]
      ).toEqual({ password_hash: 'existing-web', linux_password_hash: linuxHash });
      expect(
        (
          await client`select desired_generation from workstation_assignments where workstation_id=${other.id}`
        )[0].desired_generation
      ).toBe(7);
    });
    it('blocks stale/incomplete scans, changed approvals, incompatible and conflicting identities, and deleted identities', async () => {
      const a = account();
      await scan([a], 46000);
      await expect(importLocal(a)).rejects.toThrow('fresh complete');
      await scan([a], 0, false);
      await expect(importLocal(a)).rejects.toThrow('fresh complete');
      await scan([{ ...a, fingerprint: 'b'.repeat(64) }]);
      await expect(importLocal(a)).rejects.toThrow('latest scan');
      await scan([{ ...a, eligible: false }]);
      await expect(importLocal(a)).rejects.toThrow('eligible');
      await scan([a]);
      const [u] =
        await client`insert into users(username,display_name,posix_uid,posix_gid,password_hash,linux_password_hash) values(${a.username},'Conflict',${a.uid + 100},${a.gid + 100},'web',${linuxHash}) returning id`;
      await expect(importLocal(a)).rejects.toThrow('conflicts');
      await client`delete from users where id=${u.id}`;
      await client`insert into users(id,username,display_name,posix_uid,posix_gid,password_hash,deleted_at,status) values(${u.id},${a.username},'Deleted',${a.uid},${a.gid},'web',now(),'disabled')`;
      await expect(importLocal(a)).rejects.toThrow('conflicts');
      await client`delete from users where id=${u.id}`;
      await scan([{ ...a, username: prefix + 'another' }]);
      await scan([a]);
      await expect(importLocal(a)).rejects.toThrow('discovered account');
    });
    it('serializes import and allocation and permanently reserves discovered numeric identities', async () => {
      const [{ id }] = await client`select nextval('user_posix_identity_sequence')::integer as id`;
      const a = account('reserved', id + 1);
      await scan([a]);
      const { allocatePosixIdentity } = await import('../users/posix-identity');
      const allocated = database.transaction((tx) => allocatePosixIdentity((q) => tx.execute(q)));
      const [identity, imported] = await Promise.all([allocated, importLocal(a)]);
      expect(identity.uid).not.toBe(a.uid);
      expect(imported.operationId).toBeTruthy();
      expect(
        (await client`select posix_id from posix_identity_reservations where posix_id=${a.uid}`)[0]
          .posix_id
      ).toBe(a.uid);
      const duplicates = await Promise.allSettled([importLocal(a), importLocal(a)]);
      expect(duplicates.every((r) => r.status === 'rejected')).toBe(true);
    });
    it('keeps workstation removal scoped and requires explicit retry after offline, busy, and expired cleanup', async () => {
      const a = account();
      await scan([a]);
      const imported = await managed(a);
      await scan([{ ...a, ownerWorkstationId: workstation }], 46000);
      const blocked = await service.removeAccount(
        {
          actorId: actor,
          userId: imported.userId,
          workstationId: workstation,
          confirmation: a.username,
          deleteHome: false
        },
        database
      );
      expect(blocked.status).toBe('blocked');
      await scan([{ ...a, ownerWorkstationId: workstation }]);
      expect((await next.GET(event() as Parameters<typeof next.GET>[0])).status).toBe(204);
      await service.retryAccount(
        { actorId: actor, operationId: blocked.id, confirmation: a.username },
        database
      );
      let command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      expect(command.deleteHome).toBe(false);
      await result.POST(
        event({ id: command.id, status: 'blocked', detail: 'Running processes' }) as Parameters<
          typeof result.POST
        >[0]
      );
      expect((await next.GET(event() as Parameters<typeof next.GET>[0])).status).toBe(204);
      await service.retryAccount(
        { actorId: actor, operationId: command.id, confirmation: a.username },
        database
      );
      const [pending] =
        await client`update account_operations set expires_at=now()-interval '1 second' where assignment_id=${command.assignmentId} and status='pending' returning id`;
      expect((await next.GET(event() as Parameters<typeof next.GET>[0])).status).toBe(204);
      expect(
        (await client`select status from account_operations where id=${pending.id}`)[0].status
      ).toBe('expired');
      await service.retryAccount(
        { actorId: actor, operationId: pending.id, confirmation: a.username },
        database
      );
      command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      await result.POST(
        event({ id: command.id, status: 'completed', detail: 'Removed, files kept' }) as Parameters<
          typeof result.POST
        >[0]
      );
      expect((await desired.GET(event() as Parameters<typeof desired.GET>[0])).status).toBe(200);
      expect(
        (await (await desired.GET(event() as Parameters<typeof desired.GET>[0])).json()).users
      ).toEqual([]);
      expect(
        (await client`select status,deleted_at from users where id=${imported.userId}`)[0]
      ).toEqual({ status: 'active', deleted_at: null });
      expect(
        (
          await client`select account_state from workstation_assignments where id=${command.assignmentId}`
        )[0].account_state
      ).toBe('removed');
    });
    it('global deletion includes previously revoked assignments, disables web access immediately, and exposes cleanup for deleted users', async () => {
      const a = account();
      await scan([a]);
      const imported = await managed(a);
      await scan([{ ...a, ownerWorkstationId: workstation }]);
      await client`update workstation_assignments set status='revoked' where user_id=${imported.userId}`;
      const [other] =
        await client`insert into workstations(name,display_name) values(${prefix + 'offline'},'Offline') returning id`;
      await client`insert into workstation_assignments(user_id,workstation_id,status) values(${imported.userId},${other.id},'revoked')`;
      const { deleteUser } = await import('../deletion');
      await deleteUser(
        { actorId: actor, targetId: imported.userId, confirmation: a.username, deleteHome: true },
        database
      );
      const [u] =
        await client`select status,deleted_at,linux_password_hash from users where id=${imported.userId}`;
      expect(u.status).toBe('disabled');
      expect(u.deleted_at).toBeTruthy();
      expect(u.linux_password_hash).toBeNull();
      const ops =
        await client`select * from account_operations where user_id=${imported.userId} and kind='remove' order by status`;
      expect(ops).toHaveLength(2);
      expect(ops.map((o) => o.status).sort()).toEqual(['blocked', 'pending']);
      expect(ops.every((o) => o.delete_home)).toBe(true);
      const ws = await database.select().from(schema.workstations);
      const view = await service.loadAccountManagement(ws.find((w) => w.id === workstation)!);
      expect(view.operations.some((o) => o.userId === imported.userId && o.kind === 'remove')).toBe(
        true
      );
    });
    it('accepts a durable cleanup receipt after expiry without dispatching another removal', async () => {
      const a = account();
      await scan([a]);
      const imported = await managed(a);
      await scan([{ ...a, ownerWorkstationId: workstation }]);
      const removal = await service.removeAccount(
        {
          actorId: actor,
          userId: imported.userId,
          workstationId: workstation,
          confirmation: a.username,
          deleteHome: false
        },
        database
      );
      const command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      expect(command.id).toBe(removal.id);
      await client`update account_operations set expires_at=now()-interval '1 second' where id=${removal.id}`;
      await scan([]);
      expect((await next.GET(event() as Parameters<typeof next.GET>[0])).status).toBe(204);
      await expect(
        service.retryAccount(
          { actorId: actor, operationId: removal.id, confirmation: a.username },
          database
        )
      ).rejects.toThrow('Await the node');
      expect(
        (
          await result.POST(
            event({
              id: removal.id,
              status: 'completed',
              detail: 'Removed; home preserved'
            }) as Parameters<typeof result.POST>[0]
          )
        ).status
      ).toBe(200);
      expect(
        (
          await client`select account_state from workstation_assignments where id=${command.assignmentId}`
        )[0].account_state
      ).toBe('removed');
      expect(
        (await client`select status from account_operations where id=${removal.id}`)[0].status
      ).toBe('completed');
    });
    it('uses the latest platform password if it changes while adoption is pending', async () => {
      const a = account();
      await scan([a]);
      await importLocal(a);
      const command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      await client`update users set linux_password_hash=${linuxHash} where username=${a.username}`;
      await client`update workstation_assignments set desired_generation=desired_generation+1 where id=${command.assignmentId}`;
      await result.POST(
        event({ id: command.id, status: 'completed', detail: 'Adopted' }) as Parameters<
          typeof result.POST
        >[0]
      );
      const wire = await (await desired.GET(event() as Parameters<typeof desired.GET>[0])).json();
      expect(wire.users[0].passwordHash).toBe(linuxHash);
      await reconciliation.POST(
        event({
          results: [
            {
              assignmentId: command.assignmentId,
              generation: command.generation,
              status: 'applied'
            }
          ]
        }) as Parameters<typeof reconciliation.POST>[0]
      );
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('adopted');
      await reconciliation.POST(
        event({
          results: [
            {
              assignmentId: command.assignmentId,
              generation: wire.users[0].generation,
              status: 'applied'
            }
          ]
        }) as Parameters<typeof reconciliation.POST>[0]
      );
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('completed');
    });
    it('reserves shared primary groups without treating group membership as a competing identity', async () => {
      const a = account();
      const other = {
        ...account('shared', a.uid + 600),
        gid: a.gid,
        primaryGroup: a.username,
        eligible: false,
        reason: 'Requires matching UID/GID'
      };
      await scan([a, other]);
      expect((await importLocal(a)).operationId).toBeTruthy();
      const [reservation] =
        await client`select username,conflicted from posix_identity_reservations where posix_id=${a.uid}`;
      expect(reservation).toEqual({ username: a.username, conflicted: false });
    });
    it('locks a late adoption after revocation and keeps the cancelled import closed', async () => {
      const a = account();
      await scan([a]);
      await importLocal(a);
      const command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      const { actions } = await import('../../../routes/admin/users/+page.server');
      const revoke = actions.revokeWorkstation!;
      expect(
        await revoke({
          locals: { user: { id: actor, role: 'admin', mustChangePassword: false } },
          request: new Request('http://localhost/admin/users', {
            method: 'POST',
            body: new URLSearchParams({ assignmentId: command.assignmentId })
          })
        } as Parameters<typeof revoke>[0])
      ).toMatchObject({ success: true });
      expect(
        (
          await result.POST(
            event({
              id: command.id,
              status: 'completed',
              detail: 'Ownership transferred'
            }) as Parameters<typeof result.POST>[0]
          )
        ).status
      ).toBe(200);
      const [assignment] =
        await client`select account_state,status from workstation_assignments where id=${command.assignmentId}`;
      expect(assignment).toEqual({ account_state: 'managed', status: 'revoked' });
      const wire = await (await desired.GET(event() as Parameters<typeof desired.GET>[0])).json();
      expect(wire.users[0].enabled).toBe(false);
      await reconciliation.POST(
        event({
          results: [
            {
              assignmentId: command.assignmentId,
              generation: wire.users[0].generation,
              status: 'applied'
            }
          ]
        }) as Parameters<typeof reconciliation.POST>[0]
      );
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('blocked');
    });
    it('waits for an enabled password application when the platform user is disabled during adoption', async () => {
      const a = account();
      await scan([a]);
      await importLocal(a);
      const command = await (await next.GET(event() as Parameters<typeof next.GET>[0])).json();
      await client`update users set status='disabled' where username=${a.username}`;
      expect(
        (
          await result.POST(
            event({ id: command.id, status: 'completed', detail: 'Adopted' }) as Parameters<
              typeof result.POST
            >[0]
          )
        ).status
      ).toBe(200);
      await reconciliation.POST(
        event({
          results: [
            {
              assignmentId: command.assignmentId,
              generation: command.generation,
              status: 'applied'
            }
          ]
        }) as Parameters<typeof reconciliation.POST>[0]
      );
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('adopted');
      await client`update users set status='active' where username=${a.username}`;
      await client`update workstation_assignments set desired_generation=desired_generation+1 where id=${command.assignmentId}`;
      await reconciliation.POST(
        event({
          results: [
            {
              assignmentId: command.assignmentId,
              generation: command.generation + 1,
              status: 'applied'
            }
          ]
        }) as Parameters<typeof reconciliation.POST>[0]
      );
      expect(
        (await client`select status from account_operations where id=${command.id}`)[0].status
      ).toBe('completed');
    });
    it('authenticates both account endpoints and rejects foreign receipts', async () => {
      expect(
        (await next.GET(event(undefined, 'wrong') as Parameters<typeof next.GET>[0])).status
      ).toBe(401);
      expect(
        (
          await result.POST(
            event({ id: randomUUID(), status: 'completed', detail: '' }, 'wrong') as Parameters<
              typeof result.POST
            >[0]
          )
        ).status
      ).toBe(401);
      expect(
        (
          await result.POST(
            event({ id: randomUUID(), status: 'completed', detail: '' }) as Parameters<
              typeof result.POST
            >[0]
          )
        ).status
      ).toBe(409);
    });
  }
);
