import { and, eq } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/auth/guards';
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
import {
  decideStopRequest,
  expireTerminationInstructions,
  isStopRequestId,
  refreshPendingStopRequests
} from '$lib/server/stop-requests/service';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  requireAdmin(locals);
  if (!isStopRequestId(params.id)) error(404, 'Stop request not found');
  await refreshPendingStopRequests({ stopRequestId: params.id });
  await expireTerminationInstructions();

  const [item] = await getDatabase()
    .select({
      id: stopRequests.id,
      status: stopRequests.status,
      requestedAt: stopRequests.requestedAt,
      decidedAt: stopRequests.decidedAt,
      decisionReason: stopRequests.decisionReason,
      resultMessage: stopRequests.resultMessage,
      requesterUsername: users.username,
      requesterDisplayName: users.displayName,
      reservationId: reservations.id,
      reservationStartAt: reservations.startAt,
      reservationEndAt: reservations.endAt,
      gpuId: stopRequests.gpuId,
      gpuUuid: gpus.gpuUuid,
      gpuIndex: gpus.localIndex,
      gpuModel: gpus.model,
      workstationId: workstations.id,
      workstationName: workstations.name,
      workstationDisplayName: workstations.displayName,
      targetPid: stopRequests.targetPid,
      targetUid: stopRequests.targetUid,
      targetUsername: stopRequests.targetUsername,
      targetCommand: stopRequests.targetCommand,
      targetMemoryUsedBytes: stopRequests.targetMemoryUsedBytes,
      targetProcessStartTicks: stopRequests.targetProcessStartTicks,
      instructionId: terminationInstructions.id,
      instructionStatus: terminationInstructions.status,
      instructionExpiresAt: terminationInstructions.expiresAt,
      instructionOutcome: terminationInstructions.outcome,
      instructionDetail: terminationInstructions.detail,
      termSent: terminationInstructions.termSent,
      killSent: terminationInstructions.killSent
    })
    .from(stopRequests)
    .innerJoin(users, eq(stopRequests.requesterUserId, users.id))
    .innerJoin(reservations, eq(stopRequests.reservationId, reservations.id))
    .innerJoin(gpus, eq(stopRequests.gpuId, gpus.id))
    .innerJoin(workstations, eq(stopRequests.workstationId, workstations.id))
    .leftJoin(terminationInstructions, eq(terminationInstructions.stopRequestId, stopRequests.id))
    .where(eq(stopRequests.id, params.id))
    .limit(1);
  if (!item) error(404, 'Stop request not found');

  const [current] = await getDatabase()
    .select({
      observedAt: gpuObservations.observedAt,
      pid: gpuProcessObservations.pid,
      uid: gpuProcessObservations.uid,
      username: gpuProcessObservations.username,
      command: gpuProcessObservations.command,
      memoryUsedBytes: gpuProcessObservations.memoryUsedBytes,
      processStartTicks: gpuProcessObservations.processStartTicks
    })
    .from(gpuObservations)
    .innerJoin(gpus, eq(gpuObservations.gpuId, gpus.id))
    .leftJoin(
      gpuProcessObservations,
      and(
        eq(gpuProcessObservations.observationId, gpuObservations.id),
        eq(gpuProcessObservations.pid, item.targetPid)
      )
    )
    .where(
      and(
        eq(gpuObservations.gpuId, item.gpuId),
        eq(gpuObservations.observedAt, gpus.lastObservedAt)
      )
    )
    .limit(1);

  return {
    item,
    current: current ?? null,
    identityMatches:
      current?.pid === item.targetPid &&
      current.uid === item.targetUid &&
      current.processStartTicks === item.targetProcessStartTicks
  };
};

async function decision(
  locals: App.Locals,
  request: Request,
  stopRequestId: string,
  kind: 'dismiss' | 'resolve' | 'terminate'
) {
  const actor = requireAdmin(locals);
  const formData = await request.formData();
  if (kind === 'terminate' && formData.get('confirmIdentity') !== 'yes') {
    return fail(400, { message: 'Confirm the captured process identity before termination.' });
  }
  const result = await decideStopRequest({
    actor,
    stopRequestId,
    decision: kind,
    reason: String(formData.get('reason') ?? ''),
    allowSigkill: formData.get('allowSigkill') === 'yes'
  });
  if (!result.ok) return fail(result.status, { message: result.message });
  return {
    success: true,
    message:
      kind === 'terminate'
        ? 'Termination instruction queued for the node.'
        : kind === 'dismiss'
          ? 'Stop request dismissed.'
          : 'Stop request resolved without termination.'
  };
}

export const actions: Actions = {
  dismiss: ({ locals, request, params }) => decision(locals, request, params.id, 'dismiss'),
  resolve: ({ locals, request, params }) => decision(locals, request, params.id, 'resolve'),
  terminate: ({ locals, request, params }) => decision(locals, request, params.id, 'terminate')
};
