import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import type { AuthUser } from '$lib/server/auth/session';
import { getDatabase } from '$lib/server/db';
import {
  gpuObservations,
  gpuProcessObservations,
  gpus,
  reservations,
  stopRequests,
  terminationInstructions,
  users,
  workstations
} from '$lib/server/db/schema';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';

export type StopRequestResult =
  | { ok: true; count: number; stopRequestId?: string }
  | { ok: false; status: number; message: string };

export function isStopRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateDecisionReason(value: string): string | null {
  const reason = value.trim();
  return reason.length >= 3 && reason.length <= 500
    ? null
    : 'A reason between 3 and 500 characters is required.';
}

export async function createStopRequestsForConflict(input: {
  actor: AuthUser;
  gpuId: string;
}): Promise<StopRequestResult> {
  const now = new Date();
  const rows = await getDatabase()
    .select({
      gpuId: gpus.id,
      gpuUuid: gpus.gpuUuid,
      gpuIndex: gpus.localIndex,
      workstationId: workstations.id,
      workstationName: workstations.name,
      observedAt: gpus.lastObservedAt,
      reservationId: reservations.id,
      ownerUsername: users.username,
      processId: gpuProcessObservations.id,
      pid: gpuProcessObservations.pid,
      uid: gpuProcessObservations.uid,
      username: gpuProcessObservations.username,
      command: gpuProcessObservations.command,
      memoryUsedBytes: gpuProcessObservations.memoryUsedBytes,
      processStartTicks: gpuProcessObservations.processStartTicks
    })
    .from(gpus)
    .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
    .innerJoin(
      reservations,
      and(
        eq(reservations.gpuId, gpus.id),
        eq(reservations.userId, input.actor.id),
        eq(reservations.status, 'active'),
        lte(reservations.startAt, now),
        gt(reservations.endAt, now)
      )
    )
    .innerJoin(users, eq(reservations.userId, users.id))
    .leftJoin(
      gpuObservations,
      and(eq(gpuObservations.gpuId, gpus.id), eq(gpuObservations.observedAt, gpus.lastObservedAt))
    )
    .leftJoin(gpuProcessObservations, eq(gpuProcessObservations.observationId, gpuObservations.id))
    .where(and(eq(gpus.id, input.gpuId), eq(gpus.active, true), eq(workstations.status, 'active')))
    .orderBy(asc(gpuProcessObservations.pid));

  const first = rows[0];
  if (!first) {
    return {
      ok: false,
      status: 403,
      message: 'You do not own a current reservation for that active GPU.'
    };
  }
  if (deriveConnectionState(first.observedAt, now) !== 'online') {
    return { ok: false, status: 409, message: 'Fresh GPU telemetry is required.' };
  }
  const conflicts = rows.filter(
    (row) => row.processId && row.username !== first.ownerUsername && row.processStartTicks !== null
  );
  if (conflicts.length === 0) {
    const unsafe = rows.some(
      (row) =>
        row.processId && row.username !== first.ownerUsername && row.processStartTicks === null
    );
    return {
      ok: false,
      status: 409,
      message: unsafe
        ? 'The conflicting process has no safe start identity and cannot be requested.'
        : 'No current conflicting process was found.'
    };
  }

  return getDatabase().transaction(async (transaction) => {
    let count = 0;
    let stopRequestId: string | undefined;
    for (const conflict of conflicts) {
      const [created] = await transaction
        .insert(stopRequests)
        .values({
          reservationId: first.reservationId,
          gpuId: first.gpuId,
          workstationId: first.workstationId,
          requesterUserId: input.actor.id,
          targetPid: conflict.pid!,
          targetUid: conflict.uid!,
          targetUsername: conflict.username!,
          targetCommand: conflict.command!,
          targetMemoryUsedBytes: conflict.memoryUsedBytes!,
          targetProcessStartTicks: conflict.processStartTicks!
        })
        .onConflictDoNothing()
        .returning({ id: stopRequests.id });
      if (!created) continue;
      count += 1;
      stopRequestId ??= created.id;
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: input.actor.id,
        action: 'stop_request.created',
        targetType: 'stop_request',
        targetId: created.id,
        metadata: {
          reservationId: first.reservationId,
          workstationId: first.workstationId,
          workstationName: first.workstationName,
          gpuId: first.gpuId,
          gpuIndex: first.gpuIndex,
          pid: conflict.pid,
          uid: conflict.uid,
          processStartTicks: conflict.processStartTicks
        }
      });
    }
    if (count === 0) {
      return {
        ok: false,
        status: 409,
        message: 'An actionable request already exists for every conflicting process.'
      };
    }
    return { ok: true, count, stopRequestId };
  });
}

export async function refreshPendingStopRequests(
  filter: {
    requesterUserId?: string;
    stopRequestId?: string;
  } = {}
): Promise<void> {
  const database = getDatabase();
  const conditions = [eq(stopRequests.status, 'pending')];
  if (filter.requesterUserId)
    conditions.push(eq(stopRequests.requesterUserId, filter.requesterUserId));
  if (filter.stopRequestId) conditions.push(eq(stopRequests.id, filter.stopRequestId));
  const candidates = await database
    .select({
      id: stopRequests.id,
      reservationId: stopRequests.reservationId,
      pid: stopRequests.targetPid,
      uid: stopRequests.targetUid,
      processStartTicks: stopRequests.targetProcessStartTicks,
      ownerUsername: users.username,
      reservationStatus: reservations.status,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      observedAt: gpus.lastObservedAt,
      observationId: gpuObservations.id
    })
    .from(stopRequests)
    .innerJoin(reservations, eq(stopRequests.reservationId, reservations.id))
    .innerJoin(users, eq(reservations.userId, users.id))
    .innerJoin(gpus, eq(stopRequests.gpuId, gpus.id))
    .leftJoin(
      gpuObservations,
      and(eq(gpuObservations.gpuId, gpus.id), eq(gpuObservations.observedAt, gpus.lastObservedAt))
    )
    .where(and(...conditions));
  const now = new Date();

  for (const candidate of candidates) {
    let reason: string | null = null;
    if (
      candidate.reservationStatus !== 'active' ||
      candidate.startAt > now ||
      candidate.endAt <= now
    ) {
      reason = 'The reservation is no longer current.';
    } else if (deriveConnectionState(candidate.observedAt, now) !== 'online') {
      reason = 'GPU telemetry is no longer fresh.';
    } else if (!candidate.observationId) {
      reason = 'The target process is no longer observed.';
    } else {
      const [process] = await database
        .select({ username: gpuProcessObservations.username })
        .from(gpuProcessObservations)
        .where(
          and(
            eq(gpuProcessObservations.observationId, candidate.observationId),
            eq(gpuProcessObservations.pid, candidate.pid),
            eq(gpuProcessObservations.uid, candidate.uid),
            eq(gpuProcessObservations.processStartTicks, candidate.processStartTicks)
          )
        )
        .limit(1);
      if (!process || process.username === candidate.ownerUsername) {
        reason = 'The captured conflict has cleared or the process identity changed.';
      }
    }
    if (!reason) continue;

    await database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(stopRequests)
        .set({ status: 'stale', resultMessage: reason, updatedAt: now })
        .where(and(eq(stopRequests.id, candidate.id), eq(stopRequests.status, 'pending')))
        .returning({ id: stopRequests.id });
      if (!updated) return;
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: null,
        action: 'stop_request.stale',
        targetType: 'stop_request',
        targetId: candidate.id,
        metadata: { reason }
      });
    });
  }
}

export async function decideStopRequest(input: {
  actor: AuthUser;
  stopRequestId: string;
  decision: 'dismiss' | 'resolve' | 'terminate';
  reason: string;
  allowSigkill?: boolean;
}): Promise<StopRequestResult> {
  if (input.actor.role !== 'admin') {
    return { ok: false, status: 403, message: 'Administrator access is required.' };
  }
  if (!isStopRequestId(input.stopRequestId)) {
    return { ok: false, status: 400, message: 'Invalid stop request.' };
  }
  const reasonError = validateDecisionReason(input.reason);
  if (reasonError) return { ok: false, status: 400, message: reasonError };
  await refreshPendingStopRequests({ stopRequestId: input.stopRequestId });
  const now = new Date();

  return getDatabase().transaction(async (transaction) => {
    const [target] = await transaction
      .select({
        id: stopRequests.id,
        status: stopRequests.status,
        workstationId: stopRequests.workstationId,
        gpuUuid: gpus.gpuUuid,
        pid: stopRequests.targetPid,
        uid: stopRequests.targetUid,
        processStartTicks: stopRequests.targetProcessStartTicks
      })
      .from(stopRequests)
      .innerJoin(gpus, eq(stopRequests.gpuId, gpus.id))
      .where(eq(stopRequests.id, input.stopRequestId))
      .for('update')
      .limit(1);
    if (!target) return { ok: false, status: 404, message: 'Stop request not found.' };
    if (target.status !== 'pending') {
      return { ok: false, status: 409, message: 'That stop request is no longer pending.' };
    }

    const status =
      input.decision === 'dismiss'
        ? 'dismissed'
        : input.decision === 'resolve'
          ? 'resolved'
          : 'termination_requested';
    await transaction
      .update(stopRequests)
      .set({
        status,
        decidedByUserId: input.actor.id,
        decidedAt: now,
        decisionReason: input.reason.trim(),
        updatedAt: now
      })
      .where(eq(stopRequests.id, target.id));

    if (input.decision === 'terminate') {
      await transaction.insert(terminationInstructions).values({
        stopRequestId: target.id,
        workstationId: target.workstationId,
        requestedByUserId: input.actor.id,
        gpuUuid: target.gpuUuid,
        targetPid: target.pid,
        targetUid: target.uid,
        targetProcessStartTicks: target.processStartTicks,
        allowSigkill: input.allowSigkill === true,
        expiresAt: new Date(now.getTime() + 60_000)
      });
    }
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: input.actor.id,
      action:
        input.decision === 'terminate'
          ? 'stop_request.termination_requested'
          : `stop_request.${status}`,
      targetType: 'stop_request',
      targetId: target.id,
      metadata: {
        reason: input.reason.trim(),
        ...(input.decision === 'terminate'
          ? { allowSigkill: input.allowSigkill === true, pid: target.pid, uid: target.uid }
          : {})
      }
    });
    return { ok: true, count: 1, stopRequestId: target.id };
  });
}

export async function expireTerminationInstructions(): Promise<void> {
  const now = new Date();
  const expired = await getDatabase()
    .select({
      id: terminationInstructions.id,
      stopRequestId: terminationInstructions.stopRequestId
    })
    .from(terminationInstructions)
    .where(
      and(
        inArray(terminationInstructions.status, ['pending', 'dispatched']),
        lte(terminationInstructions.expiresAt, now)
      )
    );
  for (const instruction of expired) {
    await getDatabase().transaction(async (transaction) => {
      const [updated] = await transaction
        .update(terminationInstructions)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(terminationInstructions.id, instruction.id),
            inArray(terminationInstructions.status, ['pending', 'dispatched'])
          )
        )
        .returning({ id: terminationInstructions.id });
      if (!updated) return;
      await transaction
        .update(stopRequests)
        .set({
          status: 'failed',
          resultMessage: 'The node did not complete the instruction before it expired.',
          updatedAt: now
        })
        .where(
          and(
            eq(stopRequests.id, instruction.stopRequestId),
            eq(stopRequests.status, 'termination_requested')
          )
        );
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: null,
        action: 'termination.expired',
        targetType: 'stop_request',
        targetId: instruction.stopRequestId,
        metadata: { instructionId: instruction.id }
      });
    });
  }
}
