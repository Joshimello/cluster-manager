import { and, eq, gt, inArray, lt, or } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import type { AuthUser } from '$lib/server/auth/session';
import { getDatabase } from '$lib/server/db';
import {
  gpus,
  gpuDiagnosticRuns,
  reservations,
  users,
  workstationAssignments,
  workstations
} from '$lib/server/db/schema';

import { validateReservationWindow } from './rules';

export type ReservationResult =
  { ok: true; reservationId: string } | { ok: false; status: number; message: string };

export function isReservationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function exclusionViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ('code' in current && current.code === '23P01') return true;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}

export async function createReservation(input: {
  actor: AuthUser;
  userId: string;
  gpuId: string;
  startAt: Date;
  endAt: Date;
  adminOverride?: boolean;
  overrideReason?: string;
}): Promise<ReservationResult> {
  const isAdmin = input.actor.role === 'admin';
  const targetUserId = isAdmin ? input.userId : input.actor.id;
  if (!isAdmin && input.userId !== input.actor.id) {
    return { ok: false, status: 403, message: 'You can reserve GPUs only for yourself.' };
  }
  const adminOverride = isAdmin && input.adminOverride === true;
  const overrideReason = input.overrideReason?.trim() ?? '';
  if (adminOverride && (overrideReason.length < 3 || overrideReason.length > 500)) {
    return {
      ok: false,
      status: 400,
      message: 'An admin override requires a reason between 3 and 500 characters.'
    };
  }
  if (!adminOverride && overrideReason) {
    return { ok: false, status: 400, message: 'A reason is valid only for an admin override.' };
  }
  const windowError = validateReservationWindow(input.startAt, input.endAt, { adminOverride });
  if (windowError) return { ok: false, status: 400, message: windowError };

  const [eligible] = await getDatabase()
    .select({
      gpuId: gpus.id,
      gpuIndex: gpus.localIndex,
      gpuUuid: gpus.gpuUuid,
      workstationId: workstations.id,
      workstationName: workstations.name,
      username: users.username
    })
    .from(gpus)
    .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
    .innerJoin(
      workstationAssignments,
      and(
        eq(workstationAssignments.workstationId, gpus.workstationId),
        eq(workstationAssignments.userId, targetUserId),
        eq(workstationAssignments.status, 'active')
      )
    )
    .innerJoin(users, eq(users.id, targetUserId))
    .where(
      and(
        eq(gpus.id, input.gpuId),
        eq(gpus.active, true),
        eq(workstations.status, 'active'),
        eq(users.status, 'active')
      )
    )
    .limit(1);
  if (!eligible) {
    return {
      ok: false,
      status: 403,
      message: 'The user is not eligible to reserve that active GPU on their assigned workstation.'
    };
  }

  try {
    const reservationId = await getDatabase().transaction(async (transaction) => {
      await transaction
        .select({ id: gpus.id })
        .from(gpus)
        .where(eq(gpus.id, eligible.gpuId))
        .for('update');
      const [diagnostic] = await transaction
        .select({ id: gpuDiagnosticRuns.id })
        .from(gpuDiagnosticRuns)
        .where(
          and(
            eq(gpuDiagnosticRuns.workstationId, eligible.workstationId),
            inArray(gpuDiagnosticRuns.status, [
              'pending',
              'dispatched',
              'running',
              'cancel_requested'
            ]),
            or(
              eq(gpuDiagnosticRuns.scope, 'all'),
              eq(gpuDiagnosticRuns.targetGpuId, eligible.gpuId)
            ),
            lt(gpuDiagnosticRuns.createdAt, input.endAt),
            gt(gpuDiagnosticRuns.reservedUntil, input.startAt)
          )
        )
        .limit(1);
      if (diagnostic) {
        throw new DiagnosticConflictError();
      }
      const [created] = await transaction
        .insert(reservations)
        .values({
          gpuId: input.gpuId,
          userId: targetUserId,
          createdByUserId: input.actor.id,
          startAt: input.startAt,
          endAt: input.endAt,
          isAdminOverride: adminOverride,
          overrideReason: adminOverride ? overrideReason : null
        })
        .returning({ id: reservations.id });
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: input.actor.id,
        action: adminOverride ? 'reservation.override_created' : 'reservation.created',
        targetType: 'reservation',
        targetId: created.id,
        metadata: {
          userId: targetUserId,
          username: eligible.username,
          gpuId: eligible.gpuId,
          gpuIndex: eligible.gpuIndex,
          workstationId: eligible.workstationId,
          workstationName: eligible.workstationName,
          startAt: input.startAt.toISOString(),
          endAt: input.endAt.toISOString(),
          adminOverride
        }
      });
      return created.id;
    });
    return { ok: true, reservationId };
  } catch (error) {
    if (error instanceof DiagnosticConflictError) {
      return {
        ok: false,
        status: 409,
        message: 'That GPU has a pending or running diagnostic during the requested time.'
      };
    }
    if (exclusionViolation(error)) {
      return {
        ok: false,
        status: 409,
        message: 'That GPU is already reserved during part of the requested time.'
      };
    }
    throw error;
  }
}

class DiagnosticConflictError extends Error {}

export async function cancelReservation(input: {
  actor: AuthUser;
  reservationId: string;
  adminCancellation?: boolean;
  reason?: string;
}): Promise<ReservationResult> {
  if (!isReservationId(input.reservationId)) {
    return { ok: false, status: 400, message: 'Invalid reservation.' };
  }
  const adminCancellation = input.adminCancellation === true;
  if (adminCancellation && input.actor.role !== 'admin') {
    return { ok: false, status: 403, message: 'Administrator access is required.' };
  }
  const reason = input.reason?.trim() ?? '';
  if (adminCancellation && (reason.length < 3 || reason.length > 500)) {
    return {
      ok: false,
      status: 400,
      message: 'Admin cancellation requires a reason between 3 and 500 characters.'
    };
  }

  const now = new Date();
  return getDatabase().transaction(async (transaction) => {
    const [target] = await transaction
      .select({
        id: reservations.id,
        userId: reservations.userId,
        status: reservations.status,
        endAt: reservations.endAt,
        gpuId: reservations.gpuId
      })
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .for('update')
      .limit(1);
    if (!target) return { ok: false, status: 404, message: 'Reservation not found.' };
    if (!adminCancellation && target.userId !== input.actor.id) {
      return { ok: false, status: 403, message: 'You can cancel only your own reservation.' };
    }
    if (target.status !== 'active' || target.endAt <= now) {
      return { ok: false, status: 409, message: 'That reservation is no longer cancellable.' };
    }
    await transaction
      .update(reservations)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledByUserId: input.actor.id,
        cancellationReason: adminCancellation ? reason : 'Cancelled by reservation owner',
        updatedAt: now
      })
      .where(and(eq(reservations.id, target.id), eq(reservations.status, 'active')));
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: input.actor.id,
      action: adminCancellation ? 'reservation.admin_cancelled' : 'reservation.cancelled',
      targetType: 'reservation',
      targetId: target.id,
      metadata: {
        userId: target.userId,
        gpuId: target.gpuId,
        adminCancellation,
        ...(adminCancellation ? { reason } : {})
      }
    });
    return { ok: true, reservationId: target.id };
  });
}
