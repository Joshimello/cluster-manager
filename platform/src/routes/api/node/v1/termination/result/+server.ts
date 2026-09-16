import { and, eq, gt } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { stopRequests, terminationInstructions } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { parseTerminationResult } from '$lib/server/nodes/termination';
import { expireTerminationInstructions } from '$lib/server/stop-requests/service';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });
  const report = parseTerminationResult(await request.json().catch(() => null));
  if (!report) return json({ error: 'Invalid termination result.' }, { status: 400 });
  await expireTerminationInstructions();
  const now = new Date();

  const accepted = await getDatabase().transaction(async (transaction) => {
    const [instruction] = await transaction
      .select()
      .from(terminationInstructions)
      .where(
        and(
          eq(terminationInstructions.id, report.instructionId),
          eq(terminationInstructions.workstationId, workstation.id),
          eq(terminationInstructions.status, 'dispatched'),
          gt(terminationInstructions.expiresAt, now)
        )
      )
      .for('update')
      .limit(1);
    if (!instruction) return null;

    await transaction
      .update(terminationInstructions)
      .set({
        status: 'completed',
        completedAt: now,
        outcome: report.outcome,
        detail: report.detail,
        termSent: report.termSent,
        killSent: report.killSent,
        updatedAt: now
      })
      .where(eq(terminationInstructions.id, instruction.id));
    const resolved = ['terminated', 'killed', 'already_exited'].includes(report.outcome);
    const stale = report.outcome === 'refused_identity' || report.outcome === 'refused_gpu';
    await transaction
      .update(stopRequests)
      .set({
        status: resolved ? 'resolved' : stale ? 'stale' : 'failed',
        resultMessage: report.detail,
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
      action: 'termination.completed',
      targetType: 'stop_request',
      targetId: instruction.stopRequestId,
      metadata: {
        instructionId: instruction.id,
        workstationId: workstation.id,
        outcome: report.outcome,
        termSent: report.termSent,
        killSent: report.killSent
      }
    });
    return instruction;
  });

  if (!accepted) {
    return json(
      { error: 'Instruction is unknown, expired, belongs to another node, or was already used.' },
      { status: 409 }
    );
  }
  return json({ accepted: true });
};
