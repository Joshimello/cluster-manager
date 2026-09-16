import { and, asc, eq, gt } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { terminationInstructions } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { expireTerminationInstructions } from '$lib/server/stop-requests/service';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });
  await expireTerminationInstructions();
  const now = new Date();

  const instruction = await getDatabase().transaction(async (transaction) => {
    const [target] = await transaction
      .select()
      .from(terminationInstructions)
      .where(
        and(
          eq(terminationInstructions.workstationId, workstation.id),
          eq(terminationInstructions.status, 'pending'),
          gt(terminationInstructions.expiresAt, now)
        )
      )
      .orderBy(asc(terminationInstructions.createdAt))
      .for('update', { skipLocked: true })
      .limit(1);
    if (!target) return null;
    const [claimed] = await transaction
      .update(terminationInstructions)
      .set({ status: 'dispatched', dispatchedAt: now, updatedAt: now })
      .where(
        and(
          eq(terminationInstructions.id, target.id),
          eq(terminationInstructions.status, 'pending')
        )
      )
      .returning();
    if (!claimed) return null;
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: null,
      action: 'termination.dispatched',
      targetType: 'stop_request',
      targetId: target.stopRequestId,
      metadata: { instructionId: target.id, workstationId: workstation.id }
    });
    return claimed;
  });

  if (!instruction) return new Response(null, { status: 204 });
  return json(
    {
      apiVersion: 'v1',
      instructionId: instruction.id,
      workstation: { id: workstation.id, name: workstation.name },
      expiresAt: instruction.expiresAt,
      gpuUuid: instruction.gpuUuid,
      pid: instruction.targetPid,
      uid: instruction.targetUid,
      processStartTicks: instruction.targetProcessStartTicks,
      allowSigkill: instruction.allowSigkill
    },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
  );
};
