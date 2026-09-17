import { and, asc, desc, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { requireReadyUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { gpus, reservations, workstationAssignments, workstations } from '$lib/server/db/schema';
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
  const user = requireReadyUser(locals);
  const now = new Date();
  const assignments = await getDatabase()
    .select({
      workstationId: workstations.id,
      workstationName: workstations.name,
      workstationDisplayName: workstations.displayName
    })
    .from(workstationAssignments)
    .innerJoin(workstations, eq(workstationAssignments.workstationId, workstations.id))
    .where(
      and(eq(workstationAssignments.userId, user.id), eq(workstationAssignments.status, 'active'))
    );

  const workstationIds = assignments.map((assignment) => assignment.workstationId);
  const availableGpus = workstationIds.length
    ? await getDatabase()
        .select({
          id: gpus.id,
          index: gpus.localIndex,
          model: gpus.model,
          workstationId: workstations.id,
          workstationName: workstations.name,
          workstationDisplayName: workstations.displayName
        })
        .from(gpus)
        .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
        .where(
          and(
            inArray(gpus.workstationId, workstationIds),
            eq(gpus.active, true),
            eq(workstations.status, 'active')
          )
        )
        .orderBy(asc(workstations.name), asc(gpus.localIndex))
    : [];

  const schedule = await getDatabase()
    .select({
      id: reservations.id,
      gpuId: gpus.id,
      gpuIndex: gpus.localIndex,
      gpuModel: gpus.model,
      workstationName: workstations.name,
      userId: reservations.userId,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      isAdminOverride: reservations.isAdminOverride
    })
    .from(reservations)
    .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
    .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
    .where(
      and(
        workstationIds.length
          ? or(inArray(gpus.workstationId, workstationIds), eq(reservations.userId, user.id))
          : eq(reservations.userId, user.id),
        eq(reservations.status, 'active'),
        gt(reservations.endAt, now)
      )
    )
    .orderBy(asc(reservations.startAt), asc(gpus.localIndex));

  const history = await getDatabase()
    .select({
      id: reservations.id,
      status: reservations.status,
      gpuIndex: gpus.localIndex,
      gpuModel: gpus.model,
      workstationName: workstations.name,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      cancelledAt: reservations.cancelledAt,
      cancellationReason: reservations.cancellationReason,
      isAdminOverride: reservations.isAdminOverride
    })
    .from(reservations)
    .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
    .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
    .where(
      and(
        eq(reservations.userId, user.id),
        or(
          eq(reservations.status, 'cancelled'),
          and(eq(reservations.status, 'active'), lt(reservations.endAt, now))
        )
      )
    )
    .orderBy(desc(reservations.startAt))
    .limit(50);

  const defaultStart = nextHalfHour(now);
  return {
    assignments,
    gpus: availableGpus,
    schedule: schedule.map((reservation) => ({
      ...reservation,
      owner: reservation.userId === user.id ? 'You' : 'Reserved',
      mine: reservation.userId === user.id,
      state: reservation.startAt <= now ? 'current' : 'upcoming'
    })),
    history,
    timeZone: reservationTimeZone,
    defaultStart: formatDateTimeInput(defaultStart),
    defaultEnd: formatDateTimeInput(new Date(defaultStart.getTime() + 2 * 60 * 60_000))
  };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const actor = requireReadyUser(locals);
    const formData = await request.formData();
    const gpuId = formString(formData, 'gpuId');
    const start = formString(formData, 'startAt');
    const end = formString(formData, 'endAt');
    const startAt = parseZonedDateTime(start);
    const endAt = parseZonedDateTime(end);
    if (!startAt || !endAt) {
      return fail(400, {
        action: 'create',
        message: `Enter unambiguous dates and times in ${reservationTimeZone}.`,
        values: { gpuId, startAt: start, endAt: end }
      });
    }
    const result = await createReservation({
      actor,
      userId: actor.id,
      gpuId,
      startAt,
      endAt
    });
    if (!result.ok) {
      return fail(result.status, {
        action: 'create',
        message: result.message,
        values: { gpuId, startAt: start, endAt: end }
      });
    }
    return { action: 'create', success: true, message: 'GPU reservation created.' };
  },

  cancel: async ({ locals, request }) => {
    const actor = requireReadyUser(locals);
    const reservationId = formString(await request.formData(), 'reservationId');
    const result = await cancelReservation({ actor, reservationId });
    if (!result.ok) return fail(result.status, { action: 'cancel', message: result.message });
    return { action: 'cancel', success: true, message: 'Reservation cancelled.' };
  }
};
