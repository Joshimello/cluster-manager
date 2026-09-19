import { and, eq, gt } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { nodeUpdates } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import {
  canTransitionNodeUpdate,
  expireNodeUpdates,
  nodeUpdateCompletion,
  parseNodeUpdateResult
} from '$lib/server/nodes/updates';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });
  const report = parseNodeUpdateResult(await request.json().catch(() => null));
  if (!report) return json({ error: 'Invalid node update result.' }, { status: 400 });
  await expireNodeUpdates();
  const now = new Date();

  const accepted = await getDatabase().transaction(async (transaction) => {
    const [instruction] = await transaction
      .select()
      .from(nodeUpdates)
      .where(
        and(
          eq(nodeUpdates.id, report.instructionId),
          eq(nodeUpdates.workstationId, workstation.id),
          gt(nodeUpdates.expiresAt, now)
        )
      )
      .for('update')
      .limit(1);
    if (!instruction) return null;

    if (instruction.status === report.status && nodeUpdateCompletion(report.status)) {
      return { instruction, duplicate: true };
    }
    if (!canTransitionNodeUpdate(instruction.status, report.status)) return null;

    const complete = nodeUpdateCompletion(report.status);
    await transaction
      .update(nodeUpdates)
      .set({
        status: report.status,
        detail: report.detail,
        completedAt: complete ? now : null,
        updatedAt: now
      })
      .where(eq(nodeUpdates.id, instruction.id));
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: null,
      action: `node_update.${report.status}`,
      targetType: 'workstation',
      targetId: workstation.id,
      metadata: {
        updateId: instruction.id,
        sourceVersion: instruction.sourceVersion,
        targetVersion: instruction.targetVersion,
        detail: report.detail
      }
    });
    return { instruction, duplicate: false };
  });

  if (!accepted) {
    return json(
      { error: 'Update is unknown, expired, belongs to another node, or has an invalid state.' },
      { status: 409 }
    );
  }
  return json({ accepted: true });
};
