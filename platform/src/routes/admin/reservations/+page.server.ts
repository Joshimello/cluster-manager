import { and, asc, desc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import {
  gpus,
  reservations,
  users,
  workstationAssignments,
  workstations
} from '$lib/server/db/schema';
import { cancelReservation, createReservation } from '$lib/server/reservations/service';
import {
  formatDateTimeInput,
  nextHalfHour,
  parseZonedDateTime,
  reservationTimeZone
} from '$lib/server/reservations/time';

import type { Actions, PageServerLoad } from './$types';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const now = new Date();
  const [eligibleUsers, availableGpus, rows] = await Promise.all([
    getDatabase()
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        workstationId: workstations.id,
        workstationName: workstations.name
      })
      .from(users)
      .innerJoin(
        workstationAssignments,
        and(
          eq(workstationAssignments.userId, users.id),
          eq(workstationAssignments.status, 'active')
        )
      )
      .innerJoin(workstations, eq(workstationAssignments.workstationId, workstations.id))
      .where(and(eq(users.status, 'active'), eq(workstations.status, 'active')))
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
      .where(and(eq(gpus.active, true), eq(workstations.status, 'active')))
      .orderBy(asc(workstations.name), asc(gpus.localIndex)),
    getDatabase()
      .select({
        id: reservations.id,
        status: reservations.status,
        startAt: reservations.startAt,
        endAt: reservations.endAt,
        isAdminOverride: reservations.isAdminOverride,
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
    availableGpus
      .filter((gpu) => gpu.workstationId === user.workstationId)
      .map((gpu) => ({
        value: `${user.id}:${gpu.id}`,
        userId: user.id,
        gpuId: gpu.id,
        label: `${user.username} — ${gpu.workstationName} GPU ${gpu.index}`
      }))
  );
  const defaultStart = nextHalfHour(now);
  return {
    targets,
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
    timeZone: reservationTimeZone,
    defaultStart: formatDateTimeInput(defaultStart),
    defaultEnd: formatDateTimeInput(new Date(defaultStart.getTime() + 2 * 60 * 60_000))
  };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const target = formString(formData, 'target');
    const [userId = '', gpuId = '', extra] = target.split(':');
    const start = formString(formData, 'startAt');
    const end = formString(formData, 'endAt');
    const startAt = parseZonedDateTime(start);
    const endAt = parseZonedDateTime(end);
    const adminOverride = formData.get('adminOverride') === 'true';
    const overrideReason = formString(formData, 'overrideReason');
    const values = { target, startAt: start, endAt: end, adminOverride, overrideReason };
    if (!userId || !gpuId || extra !== undefined) {
      return fail(400, { action: 'create', message: 'Choose a valid user and GPU.', values });
    }
    if (!startAt || !endAt) {
      return fail(400, {
        action: 'create',
        message: `Enter unambiguous dates and times in ${reservationTimeZone}.`,
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
