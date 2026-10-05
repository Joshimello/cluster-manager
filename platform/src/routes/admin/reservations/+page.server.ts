import { and, asc, desc, eq, isNull, gt, lt } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { gpus, reservations, users, reservationPolicy, workstations } from '$lib/server/db/schema';
import { cancelReservation, createReservation } from '$lib/server/reservations/service';
import { formatDateTimeInput, parseZonedDateTime } from '$lib/server/reservations/time';
import { normalizeTimeZone } from '$lib/time-zone';
import { recordAudit } from '$lib/server/audit';
import { loadReservationPolicy } from '$lib/server/reservations/policy';
import { slotCalendar } from '$lib/server/reservations/calendar';

import type { Actions, PageServerLoad } from './$types';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

export const load: PageServerLoad = async ({ locals }) => {
  const actor = requireAdmin(locals);
  const policy = await loadReservationPolicy();
  const timeZone = policy.timeZone;
  const now = new Date();
  const [eligibleUsers, availableGpus, rows] = await Promise.all([
    getDatabase()
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName
      })
      .from(users)
      .where(eq(users.status, 'active'))
      .orderBy(asc(users.username)),
    getDatabase()
      .select({
        id: gpus.id,
        index: gpus.localIndex,
        model: gpus.model,
        workstationId: workstations.id,
        workstationName: workstations.name
      })
      .from(gpus)
      .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
      .where(
        and(
          eq(gpus.active, true),
          eq(workstations.status, 'active'),
          isNull(workstations.deletedAt)
        )
      )
      .orderBy(asc(workstations.name), asc(gpus.localIndex)),
    getDatabase()
      .select({
        id: reservations.id,
        status: reservations.status,
        startAt: reservations.startAt,
        endAt: reservations.endAt,
        isAdminOverride: reservations.isAdminOverride,
        quotaKind: reservations.quotaKind,
        overnightSlot: reservations.overnightSlot,
        overrideReason: reservations.overrideReason,
        cancellationReason: reservations.cancellationReason,
        cancelledAt: reservations.cancelledAt,
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        gpuIndex: gpus.localIndex,
        gpuModel: gpus.model,
        workstationName: workstations.name
      })
      .from(reservations)
      .innerJoin(users, eq(reservations.userId, users.id))
      .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
      .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
      .orderBy(desc(reservations.startAt))
      .limit(200)
  ]);

  const targets = eligibleUsers.flatMap((user) =>
    availableGpus.map((gpu) => ({
      value: `${user.id}:${gpu.id}`,
      userId: user.id,
      gpuId: gpu.id,
      label: `${user.username} — ${gpu.workstationName} GPU ${gpu.index}`
    }))
  );
  const calendarDays = slotCalendar(now, timeZone);
  const defaultSlot = calendarDays
    .flatMap((day) => day.slots)
    .find((slot) => Date.parse(slot.startAt) > now.getTime())!;
  const defaultStart = new Date(defaultSlot.startAt);
  const schedule = await getDatabase()
    .select({
      id: reservations.id,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      isAdminOverride: reservations.isAdminOverride,
      quotaKind: reservations.quotaKind,
      overnightSlot: reservations.overnightSlot,
      workstationName: workstations.name,
      gpuIndex: gpus.localIndex,
      gpuModel: gpus.model
    })
    .from(reservations)
    .innerJoin(users, eq(reservations.userId, users.id))
    .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
    .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
    .where(
      and(
        eq(reservations.status, 'active'),
        gt(reservations.endAt, new Date(calendarDays[0].slots[0].startAt)),
        lt(reservations.startAt, new Date(calendarDays[6].slots.at(-1)!.endAt))
      )
    )
    .orderBy(asc(reservations.startAt));
  return {
    viewerId: actor.id,
    schedule,
    targets,
    policy,
    calendarDays,
    reservations: rows.map((reservation) => ({
      ...reservation,
      state:
        reservation.status === 'cancelled'
          ? 'cancelled'
          : reservation.endAt <= now
            ? 'completed'
            : reservation.startAt <= now
              ? 'current'
              : 'upcoming',
      cancellable: reservation.status === 'active' && reservation.endAt > now
    })),
    timeZone,
    defaultStart: formatDateTimeInput(defaultStart, timeZone),
    defaultEnd: formatDateTimeInput(new Date(defaultSlot.endAt), timeZone)
  };
};

export const actions: Actions = {
  policy: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const fields = [
      'standardSlotsPerWeek',
      'dynamicSlotsToday',
      'dynamicSlotsTomorrow',
      'dynamicSlotsDayAfter',
      'overnightSlotsPerWeek'
    ] as const;
    const values = Object.fromEntries(
      fields.map((field) => [field, Number(formData.get(field))])
    ) as Record<(typeof fields)[number], number>;
    const timeZone = normalizeTimeZone(formData.get('timeZone'));
    if (
      !timeZone ||
      fields.some(
        (field) =>
          formData.get(field) === null ||
          !/^\d+$/.test(String(formData.get(field))) ||
          !Number.isSafeInteger(values[field]) ||
          values[field] < 0 ||
          values[field] > 1000
      )
    )
      return fail(400, {
        action: 'policy',
        message: 'Use a valid timezone and whole-number limits from 0 to 1000.'
      });
    await getDatabase().transaction(async (transaction) => {
      const previous = await loadReservationPolicy(transaction);
      await transaction
        .insert(reservationPolicy)
        .values({ id: 1, ...values, timeZone })
        .onConflictDoUpdate({
          target: reservationPolicy.id,
          set: { ...values, timeZone, updatedAt: new Date() }
        });
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'reservation.policy_updated',
        targetType: 'reservation_policy',
        targetId: null,
        metadata: { ...values, timeZone, previous: JSON.stringify(previous) }
      });
    });
    return { action: 'policy', success: true, message: 'Booking limits updated.' };
  },

  create: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const policy = await loadReservationPolicy();
    const timeZone = policy.timeZone;
    const formData = await request.formData();
    const target = formString(formData, 'target');
    const [userId = '', gpuId = '', extra] = target.split(':');
    const start = formString(formData, 'startAt');
    const end = formString(formData, 'endAt');
    const startAt = parseZonedDateTime(start, timeZone);
    const endAt = parseZonedDateTime(end, timeZone);
    const adminOverride = formData.get('adminOverride') === 'true';
    const overrideReason = formString(formData, 'overrideReason');
    const values = { target, startAt: start, endAt: end, adminOverride, overrideReason };
    if (!userId || !gpuId || extra !== undefined) {
      return fail(400, { action: 'create', message: 'Choose a valid user and GPU.', values });
    }
    if (!startAt || !endAt) {
      return fail(400, {
        action: 'create',
        message: `Enter unambiguous dates and times in ${timeZone}.`,
        values
      });
    }
    const result = await createReservation({
      actor,
      userId,
      gpuId,
      startAt,
      endAt,
      adminOverride,
      overrideReason
    });
    if (!result.ok)
      return fail(result.status, { action: 'create', message: result.message, values });
    return {
      action: 'create',
      success: true,
      message: adminOverride ? 'Admin override reservation created.' : 'Reservation created.'
    };
  },

  cancel: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const reservationId = formString(formData, 'reservationId');
    const reason = formString(formData, 'reason');
    const result = await cancelReservation({
      actor,
      reservationId,
      adminCancellation: true,
      reason
    });
    if (!result.ok) return fail(result.status, { action: 'cancel', message: result.message });
    return { action: 'cancel', success: true, message: 'Reservation cancelled by administrator.' };
  }
};
