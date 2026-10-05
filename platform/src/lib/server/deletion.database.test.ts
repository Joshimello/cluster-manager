import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import * as schema from './db/schema';
import { deleteUser, deleteWorkstation } from './deletion';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!runDatabaseTests)('administrative deletion database integration', () => {
  async function fixture() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const client = postgres(process.env.DATABASE_URL, { max: 4, prepare: false });
    const database = drizzle(client, { schema });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const [actor, user] = await client`
      insert into users (username, display_name, role, posix_uid, posix_gid, password_hash, linux_password_hash)
      select username, username, role::user_role, identity, identity, 'test-hash', 'test-linux-hash'
      from (
        select ${`actor-${suffix}`} as username, 'admin' as role,
          nextval('user_posix_identity_sequence')::integer as identity
        union all
        select ${`user-${suffix}`}, 'user', nextval('user_posix_identity_sequence')::integer
      ) seed
      returning id, username, posix_uid
    `;
    const credential = `cmnode_${randomBytes(32).toString('base64url')}`;
    const credentialHash = createHash('sha256').update(credential).digest('hex');
    const [workstation] = await client`
      insert into workstations (name, display_name, credential_hash, enrollment_token_hash)
      values (${`ws-${suffix}`}, 'Deletion test', ${credentialHash}, ${credentialHash})
      returning id, name
    `;
    const [gpu] = await client`
      insert into gpus (workstation_id, gpu_uuid, local_index, model, last_observed_at, utilization_percent, memory_used_bytes, memory_total_bytes)
      values (${workstation.id}, ${`GPU-${suffix}`}, 0, 'Test GPU', now(), 0, 0, 1) returning id
    `;
    const [assignment] = await client`
      insert into workstation_assignments (user_id, workstation_id)
      values (${user.id}, ${workstation.id}) returning id
    `;
    await client`
      insert into sessions (token_hash, user_id, expires_at)
      values (${credentialHash}, ${user.id}, now() + interval '1 day')
    `;
    const start = new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000);
    const [reservation] = await client`
      insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at)
      values (${gpu.id}, ${user.id}, ${actor.id}, ${start.toISOString()},
        ${new Date(start.getTime() + 3_600_000).toISOString()}) returning id
    `;
    const [request] = await client`
      insert into stop_requests (
        reservation_id, gpu_id, workstation_id, requester_user_id,
        target_pid, target_uid, target_username, target_command, target_memory_used_bytes,
        target_process_start_ticks, status
      ) values (
        ${reservation.id}, ${gpu.id}, ${workstation.id}, ${user.id},
        123, ${user.posix_uid}, ${user.username}, 'test', 1, 1, 'termination_requested'
      ) returning id
    `;
    await client`
      insert into termination_instructions (
        stop_request_id, workstation_id, requested_by_user_id, gpu_uuid,
        target_pid, target_uid, target_process_start_ticks, expires_at
      ) values (${request.id}, ${workstation.id}, ${actor.id}, ${`GPU-${suffix}`},
        123, ${user.posix_uid}, 1, now() + interval '1 hour')
    `;
    const input = {
      actorId: actor.id as string,
      targetId: user.id as string,
      confirmation: user.username as string
    };
    const workstationInput = {
      ...input,
      targetId: workstation.id as string,
      confirmation: workstation.name as string
    };
    return {
      client,
      database,
      actor,
      user,
      workstation,
      gpu,
      assignment,
      reservation,
      input,
      workstationInput,
      credential,
      async cleanup() {
        await client`delete from audit_events where actor_user_id = ${actor.id}`;
        await client`delete from gpu_diagnostic_runs where workstation_id = ${workstation.id}`;
        await client`delete from node_updates where workstation_id = ${workstation.id}`;
        await client`delete from termination_instructions where workstation_id = ${workstation.id}`;
        await client`delete from stop_requests where workstation_id = ${workstation.id}`;
        await client`delete from reservations where gpu_id = ${gpu.id}`;
        await client`delete from workstation_assignments where workstation_id = ${workstation.id}`;
        await client`delete from gpus where workstation_id = ${workstation.id}`;
        await client`delete from workstations where id = ${workstation.id}`;
        await client`delete from users where id in (${actor.id}, ${user.id})`;
        await client.end();
      }
    };
  }

  it('requires confirmation, prevents self-deletion, and atomically revokes user access while retaining history', async () => {
    const f = await fixture();
    try {
      expect(
        await deleteUser(
          { ...f.input, targetId: f.actor.id, confirmation: f.actor.username },
          f.database
        )
      ).toMatchObject({ status: 400, error: 'You cannot delete your own account.' });
      expect(await deleteUser({ ...f.input, confirmation: '' }, f.database)).toMatchObject({
        status: 400
      });
      expect(await deleteUser(f.input, f.database)).toEqual({ name: f.user.username });
      const [user] = await f.client`select * from users where id = ${f.user.id}`;
      expect(user.status).toBe('disabled');
      expect(user.deleted_at).not.toBeNull();
      expect(user.linux_password_hash).toBeNull();
      expect(user.posix_uid).toBe(f.user.posix_uid);
      expect(await f.client`select id from sessions where user_id = ${f.user.id}`).toHaveLength(0);
      const [assignment] =
        await f.client`select * from workstation_assignments where id = ${f.assignment.id}`;
      expect(assignment).toMatchObject({
        status: 'revoked',
        desired_generation: 2,
        provisioning_status: 'pending'
      });
      const [reservation] =
        await f.client`select * from reservations where id = ${f.reservation.id}`;
      expect(reservation).toMatchObject({
        status: 'cancelled',
        cancellation_reason: 'User deleted.',
        cancelled_by_user_id: f.actor.id
      });
      const [request] =
        await f.client`select status from stop_requests where workstation_id = ${f.workstation.id}`;
      expect(request.status).toBe('stale');
      const [instruction] =
        await f.client`select status from termination_instructions where workstation_id = ${f.workstation.id}`;
      expect(instruction.status).toBe('expired');
      const [audit] =
        await f.client`select action from audit_events where target_id = ${f.user.id}`;
      expect(audit.action).toBe('user.deleted');
      // The retained assignment/user join is what supplies a disabled account to the node.
      const desired = await f.client`
        select u.username, u.status, a.status as assignment_status from users u
        join workstation_assignments a on a.user_id = u.id where a.workstation_id = ${f.workstation.id}
      `;
      expect(desired).toEqual([
        { username: f.user.username, status: 'disabled', assignment_status: 'revoked' }
      ]);
      expect(await deleteUser(f.input, f.database)).toMatchObject({ status: 404 });
      // Deleted identities cannot be claimed by a new user.
      await expect(f.client`
        insert into users (username, display_name, posix_uid, posix_gid, password_hash)
        values (${f.user.username}, 'Reuse', 59998, 59998, 'hash')
      `).rejects.toMatchObject({ code: '23505' });
    } finally {
      await f.cleanup();
    }
  });

  it('disconnects a workstation, cancels queued work, and preserves history and user accounts', async () => {
    const f = await fixture();
    try {
      await f.client`
        insert into node_updates (workstation_id, requested_by_user_id, source_version, target_version, expires_at)
        values (${f.workstation.id}, ${f.actor.id}, 'v0.1.0', 'v0.2.0', now() + interval '1 hour')
      `;
      await f.client`
        insert into gpu_diagnostic_runs (
          workstation_id, requested_by_user_id, target_gpu_uuids, scope,
          duration_seconds, memory_percent, temperature_cutoff_c, image_digest, reserved_until, expires_at
        ) values (${f.workstation.id}, ${f.actor.id}, '[]', 'all', 10, 50, 80, 'test-digest',
          now() + interval '1 hour', now() + interval '1 hour')
      `;
      expect(
        await deleteWorkstation({ ...f.workstationInput, confirmation: '' }, f.database)
      ).toMatchObject({ status: 400 });
      expect(await deleteWorkstation(f.workstationInput, f.database)).toEqual({
        name: f.workstation.name
      });
      const [workstation] =
        await f.client`select * from workstations where id = ${f.workstation.id}`;
      expect(workstation.deleted_at).not.toBeNull();
      expect(workstation).toMatchObject({
        status: 'disabled',
        credential_hash: null,
        enrollment_token_hash: null
      });
      const [gpu] = await f.client`select active from gpus where id = ${f.gpu.id}`;
      expect(gpu.active).toBe(false);
      const [assignment] =
        await f.client`select status from workstation_assignments where id = ${f.assignment.id}`;
      expect(assignment.status).toBe('revoked');
      const [reservation] =
        await f.client`select status, cancellation_reason from reservations where id = ${f.reservation.id}`;
      expect(reservation).toMatchObject({
        status: 'cancelled',
        cancellation_reason: 'Workstation deleted.'
      });
      const [update] =
        await f.client`select status from node_updates where workstation_id = ${f.workstation.id}`;
      const [diagnostic] =
        await f.client`select status from gpu_diagnostic_runs where workstation_id = ${f.workstation.id}`;
      expect(update.status).toBe('cancelled');
      expect(diagnostic.status).toBe('cancelled');
      const [user] = await f.client`select status, deleted_at from users where id = ${f.user.id}`;
      expect(user).toMatchObject({ status: 'active', deleted_at: null });
      expect(await deleteWorkstation(f.workstationInput, f.database)).toMatchObject({
        status: 404
      });
    } finally {
      await f.cleanup();
    }
  });

  it('refuses workstation deletion during dispatched updates or diagnostics without partial changes', async () => {
    const f = await fixture();
    try {
      await f.client`
        insert into node_updates (workstation_id, requested_by_user_id, source_version, target_version, status, expires_at)
        values (${f.workstation.id}, ${f.actor.id}, 'v0.1.0', 'v0.2.0', 'dispatched', now() + interval '1 hour')
      `;
      expect(await deleteWorkstation(f.workstationInput, f.database)).toMatchObject({
        status: 409
      });
      await f.client`delete from node_updates where workstation_id = ${f.workstation.id}`;
      await f.client`
        insert into gpu_diagnostic_runs (
          workstation_id, requested_by_user_id, target_gpu_uuids, scope, status,
          duration_seconds, memory_percent, temperature_cutoff_c, image_digest, reserved_until, expires_at
        ) values (${f.workstation.id}, ${f.actor.id}, '[]', 'all', 'running', 10, 50, 80, 'test-digest',
          now() + interval '1 hour', now() + interval '1 hour')
      `;
      expect(await deleteWorkstation(f.workstationInput, f.database)).toMatchObject({
        status: 409
      });
      const [workstation] =
        await f.client`select status, deleted_at from workstations where id = ${f.workstation.id}`;
      expect(workstation).toMatchObject({ status: 'active', deleted_at: null });
      const [reservation] =
        await f.client`select status from reservations where id = ${f.reservation.id}`;
      expect(reservation.status).toBe('active');
    } finally {
      await f.cleanup();
    }
  });

  it('enforces admin authorization and refuses edits that would revive deleted entries', async () => {
    const f = await fixture();
    vi.doMock('$lib/server/db', () => ({ getDatabase: () => f.database }));
    try {
      const { actions, load } = await import('../../routes/admin/users/+page.server');
      const { actions: workstationActions, load: workstationLoad } =
        await import('../../routes/admin/workstations/+page.server');
      const actor = { id: f.actor.id, role: 'admin', mustChangePassword: false };
      const event = (values: Record<string, string>, user: unknown = actor) => ({
        locals: { user },
        request: new Request('http://localhost/admin/users', {
          method: 'POST',
          body: new URLSearchParams(values)
        })
      });
      const deleteAction = actions.delete!;
      await expect(
        deleteAction(
          event({ userId: f.user.id }, { role: 'user', mustChangePassword: false }) as Parameters<
            typeof deleteAction
          >[0]
        )
      ).rejects.toMatchObject({ status: 303, location: '/dashboard' });
      await deleteUser(f.input, f.database);
      const statusAction = actions.setStatus!;
      expect(
        await statusAction(
          event({ userId: f.user.id, status: 'active' }) as Parameters<typeof statusAction>[0]
        )
      ).toMatchObject({ status: 400 });
      const result = await load(event({}) as Parameters<typeof load>[0]);
      expect(result?.users.some((user: { id: string }) => user.id === f.user.id)).toBe(false);
      const deleteWorkstationAction = workstationActions.delete!;
      expect(
        await deleteWorkstationAction(
          event({
            workstationId: f.workstation.id,
            confirmation: f.workstation.name
          }) as Parameters<typeof deleteWorkstationAction>[0]
        )
      ).toMatchObject({ success: true });
      const workstations = await workstationLoad(
        event({}) as Parameters<typeof workstationLoad>[0]
      );
      expect(
        workstations?.workstations.some(
          (workstation: { id: string }) => workstation.id === f.workstation.id
        )
      ).toBe(false);
      const { actions: detailActions } =
        await import('../../routes/admin/workstations/[id]/+page.server');
      const workstationStatusAction = detailActions.setStatus!;
      expect(
        await workstationStatusAction({
          ...event({ status: 'active' }),
          params: { id: f.workstation.id }
        } as Parameters<typeof workstationStatusAction>[0])
      ).toMatchObject({ status: 404 });
      const { authenticateNode } = await import('./nodes/authentication');
      expect(await authenticateNode(`Bearer ${f.credential}`)).toBeNull();
    } finally {
      vi.doUnmock('$lib/server/db');
      await f.cleanup();
    }
  });
});
