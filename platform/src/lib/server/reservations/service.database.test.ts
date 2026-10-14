import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { defaultReservationPolicy } from '$lib/reservation-limits';
import type { AuthUser } from '$lib/server/auth/session';
import * as schema from '$lib/server/db/schema';
import { slotCalendar } from './calendar';
import { createReservation, createReservations } from './service';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
describe.skipIf(!runDatabaseTests)('fixed-slot reservations database integration', () => {
  async function fixture() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const client = postgres(process.env.DATABASE_URL, { max: 10, prepare: false });
    const database = drizzle(client, { schema });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const previousPolicy = await database.select().from(schema.reservationPolicy);
    await database
      .insert(schema.reservationPolicy)
      .values({ id: 1, ...defaultReservationPolicy })
      .onConflictDoUpdate({ target: schema.reservationPolicy.id, set: defaultReservationPolicy });
    const actors: AuthUser[] = [];
    for (const role of ['admin', 'user'] as const) {
      const [identity] =
        await client`select nextval('user_posix_identity_sequence')::integer as id`;
      const [actor] = await database
        .insert(schema.users)
        .values({
          username: `${role}-${suffix}`,
          displayName: `${role} ${suffix}`,
          role,
          posixUid: identity.id,
          posixGid: identity.id,
          passwordHash: 'test-hash',
          mustChangePassword: false,
          timeZone: 'UTC'
        })
        .returning();
      actors.push(actor);
    }
    const [admin, user] = actors;
    const [workstation] = await database
      .insert(schema.workstations)
      .values({ name: `ws-${suffix}`, displayName: 'Slot test workstation' })
      .returning();
    const gpus: schema.Gpu[] = [];
    for (let index = 0; index < 2; index++) {
      const [gpu] = await database
        .insert(schema.gpus)
        .values({
          workstationId: workstation.id,
          gpuUuid: `GPU-${suffix}-${index}`,
          localIndex: index,
          model: 'Test GPU',
          lastObservedAt: new Date(),
          utilizationPercent: 0,
          memoryUsedBytes: 0,
          memoryTotalBytes: 1
        })
        .returning();
      gpus.push(gpu);
    }
    await database
      .insert(schema.workstationAssignments)
      .values({ userId: user.id, workstationId: workstation.id });
    const days = slotCalendar(new Date(), 'UTC');
    const input = (day: number, slot: number, gpu = 0, actor = user) => ({
      actor,
      userId: actor.id,
      gpuId: gpus[gpu].id,
      startAt: new Date(days[day].slots[slot].startAt),
      endAt: new Date(days[day].slots[slot].endAt)
    });
    return {
      database,
      client,
      admin,
      user,
      workstation,
      gpus,
      days,
      input,
      batch(windows: Array<[number, number]>, gpu = 0, actor = user) {
        return {
          actor,
          userId: actor.id,
          gpuId: gpus[gpu].id,
          slots: windows.map(([day, slot]) => ({
            startAt: new Date(days[day].slots[slot].startAt),
            endAt: new Date(days[day].slots[slot].endAt)
          }))
        };
      },
      async cleanup() {
        await client`delete from audit_events where actor_user_id in (${admin.id}, ${user.id})`;
        await client`delete from reservations where gpu_id in (${gpus[0].id}, ${gpus[1].id})`;
        await client`delete from workstation_assignments where workstation_id = ${workstation.id}`;
        await client`delete from gpu_diagnostic_runs where workstation_id = ${workstation.id}`;
        await client`delete from gpus where workstation_id = ${workstation.id}`;
        await client`delete from workstations where id = ${workstation.id}`;
        await client`delete from users where id in (${admin.id}, ${user.id})`;
        await client`delete from reservation_policy where id = 1`;
        if (previousPolicy[0])
          await database.insert(schema.reservationPolicy).values(previousPolicy[0]);
        await client.end();
      }
    };
  }

  it('reserves adjacent and separate slots together, consuming dynamic first in chronological order', async () => {
    const f = await fixture();
    try {
      const result = await createReservations(
        f.batch([
          [1, 5],
          [1, 3],
          [1, 2]
        ]),
        f.database
      );
      expect(result).toMatchObject({ ok: true, reservationIds: expect.any(Array) });
      if (!result.ok) throw new Error(result.message);
      expect(result.reservationIds).toHaveLength(3);
      const rows =
        await f.client`select id, quota_kind, start_at, end_at from reservations where user_id = ${f.user.id} order by start_at`;
      expect(rows.map((row) => row.quota_kind)).toEqual(['dynamic', 'dynamic', 'standard']);
      expect(rows.map((row) => row.id)).toEqual(result.reservationIds);
      expect(new Date(rows[0].end_at).getTime()).toBe(new Date(rows[1].start_at).getTime());
      const audits =
        await f.client`select target_id, metadata from audit_events where actor_user_id = ${f.user.id}`;
      expect(audits).toHaveLength(3);
      expect(
        audits.every(
          (row) => row.metadata.batchSize === 3 && result.reservationIds.includes(row.target_id)
        )
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it('handles multi-date batches in the shared timezone with independent dynamic allowances', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set time_zone = 'Asia/Taipei'`;
      const days = slotCalendar(new Date(), 'Asia/Taipei');
      const batch = f.batch([[1, 2]]);
      batch.slots = [
        [2, 3],
        [1, 3],
        [2, 2],
        [1, 2]
      ].map(([day, slot]) => ({
        startAt: new Date(days[day].slots[slot].startAt),
        endAt: new Date(days[day].slots[slot].endAt)
      }));
      expect(await createReservations(batch, f.database)).toHaveProperty('ok', true);
      const rows =
        await f.client`select quota_kind from reservations where user_id = ${f.user.id} order by start_at`;
      expect(rows.map((row) => row.quota_kind)).toEqual([
        'dynamic',
        'dynamic',
        'dynamic',
        'standard'
      ]);
    } finally {
      await f.cleanup();
    }
  });

  it('rejects the entire batch when combined standard or overnight allowances run out', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set standard_slots_per_week = 1, dynamic_slots_tomorrow = 1`;
      expect(
        await createReservations(
          f.batch([
            [1, 2],
            [1, 3],
            [1, 4]
          ]),
          f.database
        )
      ).toMatchObject({ ok: false, status: 409 });
      await f.client`update reservation_policy set overnight_slots_per_week = 1`;
      expect(
        await createReservations(
          f.batch([
            [1, 0],
            [1, 1]
          ]),
          f.database
        )
      ).toMatchObject({
        ok: false,
        status: 409,
        message: expect.stringMatching(/overnight limit/)
      });
      expect(await f.client`select id from reservations where user_id = ${f.user.id}`).toHaveLength(
        0
      );
      expect(
        await f.client`select id from audit_events where actor_user_id = ${f.user.id}`
      ).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it('rolls back earlier inserts and audit events if a later selected slot conflicts', async () => {
    const f = await fixture();
    try {
      expect(await createReservation(f.input(1, 4), f.database)).toHaveProperty('ok', true);
      expect(
        await createReservations(
          f.batch([
            [1, 2],
            [1, 4]
          ]),
          f.database
        )
      ).toMatchObject({
        ok: false,
        status: 409,
        message: expect.stringMatching(/already reserved/)
      });
      expect(await f.client`select id from reservations where user_id = ${f.user.id}`).toHaveLength(
        1
      );
      expect(
        await f.client`select id from audit_events where actor_user_id = ${f.user.id}`
      ).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });

  it('serializes batch quota consumption with concurrent bookings on different GPUs', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set standard_slots_per_week = 3, dynamic_slots_today = 0, dynamic_slots_tomorrow = 0, dynamic_slots_day_after = 0`;
      const results = await Promise.all([
        createReservations(
          f.batch(
            [
              [1, 2],
              [1, 3]
            ],
            0
          ),
          f.database
        ),
        createReservations(
          f.batch(
            [
              [1, 4],
              [1, 5]
            ],
            1
          ),
          f.database
        )
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok && result.status === 409)).toHaveLength(1);
      expect(await f.client`select id from reservations where user_id = ${f.user.id}`).toHaveLength(
        2
      );
    } finally {
      await f.cleanup();
    }
  });

  it('rejects empty, oversized, duplicate and past batches without saving any slots', async () => {
    const f = await fixture();
    try {
      const batch = f.batch([[1, 2]]);
      expect(await createReservations({ ...batch, gpuId: 'invalid' }, f.database)).toMatchObject({
        ok: false,
        status: 400
      });
      for (const slots of [
        [],
        Array(71).fill(batch.slots[0]),
        [batch.slots[0], batch.slots[0]],
        [
          { startAt: new Date('2000-01-01T08:00:00Z'), endAt: new Date('2000-01-01T10:00:00Z') },
          batch.slots[0]
        ]
      ]) {
        expect(await createReservations({ ...batch, slots }, f.database)).toMatchObject({
          ok: false,
          status: 400
        });
      }
      expect(await createReservations({ ...batch, userId: f.admin.id }, f.database)).toMatchObject({
        ok: false,
        status: 403
      });
      expect(await f.client`select id from reservations where user_id = ${f.user.id}`).toHaveLength(
        0
      );
    } finally {
      await f.cleanup();
    }
  });

  it('supports admin batches without assignments while preserving overlap and diagnostic protection', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set standard_slots_per_week = 0, dynamic_slots_today = 0, dynamic_slots_tomorrow = 0, dynamic_slots_day_after = 0, overnight_slots_per_week = 0`;
      const override = {
        ...f.batch(
          [
            [1, 0],
            [1, 2]
          ],
          0,
          f.admin
        ),
        adminOverride: true,
        overrideReason: 'Approved batch'
      };
      expect(await createReservations(override, f.database)).toHaveProperty('ok', true);
      expect(await createReservations(override, f.database)).toMatchObject({
        ok: false,
        status: 409
      });
      const rows =
        await f.client`select quota_kind, is_admin_override from reservations where user_id = ${f.admin.id}`;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.quota_kind === 'override' && row.is_admin_override)).toBe(
        true
      );
      expect(
        await createReservations({ ...f.batch([[1, 3]], 1), adminOverride: true }, f.database)
      ).toMatchObject({ ok: false, status: 409 });
      await f.database.insert(schema.gpuDiagnosticRuns).values({
        workstationId: f.workstation.id,
        requestedByUserId: f.admin.id,
        targetGpuUuids: [f.gpus[1].gpuUuid],
        targetGpuId: f.gpus[1].id,
        scope: 'gpu',
        durationSeconds: 10,
        memoryPercent: 50,
        temperatureCutoffC: 80,
        imageDigest: 'test-digest',
        reservedUntil: new Date(f.days[1].slots[5].endAt),
        expiresAt: new Date(f.days[1].slots[5].endAt)
      });
      expect(
        await createReservations(
          {
            ...f.batch(
              [
                [1, 3],
                [1, 4]
              ],
              1,
              f.admin
            ),
            adminOverride: true,
            overrideReason: 'Approved test'
          },
          f.database
        )
      ).toMatchObject({ ok: false, status: 409, message: expect.stringMatching(/diagnostic/) });
      expect(
        await f.client`select id from reservations where gpu_id = ${f.gpus[1].id}`
      ).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it('uses tomorrow’s dynamic allowance before standard slots and refunds unstarted cancellations', async () => {
    const f = await fixture();
    try {
      for (const slot of [2, 3, 4])
        expect(await createReservation(f.input(1, slot), f.database)).toHaveProperty('ok', true);
      const rows =
        await f.client`select id, quota_kind from reservations where user_id = ${f.user.id} order by start_at`;
      expect(rows.map((row) => row.quota_kind)).toEqual(['dynamic', 'dynamic', 'standard']);
      await f.client`update reservations set status = 'cancelled', cancelled_at = now() where id = ${rows[0].id}`;
      expect(await createReservation(f.input(1, 5), f.database)).toHaveProperty('ok', true);
      const [last] =
        await f.client`select quota_kind from reservations where user_id = ${f.user.id} order by start_at desc limit 1`;
      expect(last.quota_kind).toBe('dynamic');
    } finally {
      await f.cleanup();
    }
  });

  it('enforces one standard slot across concurrent requests on different GPUs', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set standard_slots_per_week = 1, dynamic_slots_today = 0, dynamic_slots_tomorrow = 0, dynamic_slots_day_after = 0`;
      const results = await Promise.all([
        createReservation(f.input(1, 2, 0), f.database),
        createReservation(f.input(1, 3, 1), f.database)
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok && result.status === 409)).toHaveLength(1);
      expect(await f.client`select id from reservations where user_id = ${f.user.id}`).toHaveLength(
        1
      );
    } finally {
      await f.cleanup();
    }
  });

  it('caps overnight bookings across GPUs even when dynamic or standard quota remains', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set overnight_slots_per_week = 1`;
      expect(await createReservation(f.input(1, 0), f.database)).toHaveProperty('ok', true);
      expect(await createReservation(f.input(1, 1, 1), f.database)).toMatchObject({
        ok: false,
        status: 409,
        message: expect.stringMatching(/overnight limit/)
      });
      expect(await createReservation(f.input(1, 2), f.database)).toHaveProperty('ok', true);
    } finally {
      await f.cleanup();
    }
  });

  it('allows unassigned admins to bypass quota but never overlaps or diagnostic safety checks', async () => {
    const f = await fixture();
    try {
      await f.client`update reservation_policy set standard_slots_per_week = 0, dynamic_slots_today = 0, dynamic_slots_tomorrow = 0, dynamic_slots_day_after = 0, overnight_slots_per_week = 0`;
      expect(await createReservation(f.input(1, 2, 0, f.admin), f.database)).toMatchObject({
        ok: false,
        status: 409
      });
      const override = {
        ...f.input(1, 2, 0, f.admin),
        adminOverride: true,
        overrideReason: 'Approved maintenance'
      };
      expect(await createReservation(override, f.database)).toHaveProperty('ok', true);
      expect(await createReservation(override, f.database)).toMatchObject({
        ok: false,
        status: 409
      });
      const [row] =
        await f.client`select quota_kind, is_admin_override from reservations where user_id = ${f.admin.id}`;
      expect(row).toMatchObject({ quota_kind: 'override', is_admin_override: true });
      await f.database.insert(schema.gpuDiagnosticRuns).values({
        workstationId: f.workstation.id,
        requestedByUserId: f.admin.id,
        targetGpuUuids: [f.gpus[1].gpuUuid],
        targetGpuId: f.gpus[1].id,
        scope: 'gpu',
        durationSeconds: 10,
        memoryPercent: 50,
        temperatureCutoffC: 80,
        imageDigest: 'test-digest',
        reservedUntil: new Date(f.days[1].slots[3].endAt),
        expiresAt: new Date(f.days[1].slots[3].endAt)
      });
      expect(
        await createReservation(
          { ...f.input(1, 3, 1, f.admin), adminOverride: true, overrideReason: 'Approved test' },
          f.database
        )
      ).toMatchObject({ ok: false, status: 409, message: expect.stringMatching(/diagnostic/) });
      expect(
        await createReservation({ ...f.input(1, 4), adminOverride: true }, f.database)
      ).toMatchObject({ ok: false, status: 409 });
      await f.client`update workstation_assignments set status = 'revoked' where user_id = ${f.user.id}`;
      expect(await createReservation(f.input(1, 4), f.database)).toMatchObject({
        ok: false,
        status: 403
      });
    } finally {
      await f.cleanup();
    }
  });

  it('requires admin rights for changing limits and persists audited policy updates', async () => {
    const f = await fixture();
    vi.doMock('$lib/server/db', () => ({ getDatabase: () => f.database }));
    try {
      const { actions, load } = await import('../../../routes/admin/reservations/+page.server');
      const action = actions.policy!;
      const fields = {
        standardSlotsPerWeek: '4',
        dynamicSlotsToday: '2',
        dynamicSlotsTomorrow: '1',
        dynamicSlotsDayAfter: '0',
        overnightSlotsPerWeek: '1',
        timeZone: 'UTC'
      };
      const event = (actor: AuthUser, values = fields) => ({
        locals: { user: actor },
        request: new Request('http://localhost/admin/reservations', {
          method: 'POST',
          body: new URLSearchParams(values)
        })
      });
      await expect(action(event(f.user) as Parameters<typeof action>[0])).rejects.toMatchObject({
        status: 303,
        location: '/dashboard'
      });
      expect(
        await action(
          event(f.admin, { ...fields, standardSlotsPerWeek: '-1' }) as Parameters<typeof action>[0]
        )
      ).toMatchObject({ status: 400 });
      expect(await action(event(f.admin) as Parameters<typeof action>[0])).toMatchObject({
        success: true
      });
      const [policy] =
        await f.client`select standard_slots_per_week, dynamic_slots_day_after from reservation_policy`;
      expect(policy).toMatchObject({ standard_slots_per_week: 4, dynamic_slots_day_after: 0 });
      const result = await load(event(f.admin) as Parameters<typeof load>[0]);
      expect(
        result?.targets.some(
          (target: { value: string }) => target.value === `${f.admin.id}:${f.gpus[0].id}`
        )
      ).toBe(true);
      const audits =
        await f.client`select action from audit_events where actor_user_id = ${f.admin.id}`;
      expect(audits).toContainEqual({ action: 'reservation.policy_updated' });
    } finally {
      vi.doUnmock('$lib/server/db');
      await f.cleanup();
    }
  });

  it('accepts multiple dialog fields and returns every selection on a failed submission', async () => {
    const f = await fixture();
    vi.resetModules();
    vi.doMock('$lib/server/db', () => ({ getDatabase: () => f.database }));
    try {
      const { actions } = await import('../../../routes/dashboard/+page.server');
      const action = actions.create!;
      const batch = f.batch([
        [1, 2],
        [1, 3],
        [1, 5]
      ]);
      const fields = new URLSearchParams({
        gpuId: batch.gpuId,
        dayKey: f.days[1].key,
        userId: f.admin.id
      });
      for (const slot of batch.slots) {
        fields.append('startAt', slot.startAt.toISOString());
        fields.append('endAt', slot.endAt.toISOString());
      }
      const event = (body: URLSearchParams) => ({
        locals: { user: f.user },
        request: new Request('http://localhost/dashboard?/create', { method: 'POST', body })
      });
      expect(await action(event(fields) as Parameters<typeof action>[0])).toMatchObject({
        success: true,
        message: '3 GPU slots reserved.'
      });
      const rows = await f.client`select user_id from reservations where gpu_id = ${batch.gpuId}`;
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.user_id === f.user.id)).toBe(true);
      expect(await action(event(fields) as Parameters<typeof action>[0])).toMatchObject({
        status: 409,
        data: {
          values: {
            startAts: fields.getAll('startAt'),
            endAts: fields.getAll('endAt'),
            dayKey: f.days[1].key
          },
          message: expect.stringMatching(/No slots were reserved/)
        }
      });
      const mismatched = new URLSearchParams(fields);
      mismatched.delete('endAt');
      expect(await action(event(mismatched) as Parameters<typeof action>[0])).toMatchObject({
        status: 400
      });
      expect(
        await action(
          event(new URLSearchParams({ gpuId: batch.gpuId })) as Parameters<typeof action>[0]
        )
      ).toMatchObject({ status: 400 });
      expect(
        await f.client`select id from reservations where gpu_id = ${batch.gpuId}`
      ).toHaveLength(3);
    } finally {
      vi.doUnmock('$lib/server/db');
      vi.resetModules();
      await f.cleanup();
    }
  });
});
