import { and, asc, eq, gt } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { nodeUpdates } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { expireNodeUpdates, managedUpdateCapability } from '$lib/server/nodes/updates';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });
  if (!workstation.nodeCapabilities.includes(managedUpdateCapability)) {
    return new Response(null, { status: 204 });
  }
  await expireNodeUpdates();
  const now = new Date();

  const instruction = await getDatabase().transaction(async (transaction) => {
    const [target] = await transaction
      .select()
      .from(nodeUpdates)
      .where(
        and(
          eq(nodeUpdates.workstationId, workstation.id),
          eq(nodeUpdates.status, 'pending'),
          gt(nodeUpdates.expiresAt, now)
        )
      )
      .orderBy(asc(nodeUpdates.createdAt))
      .for('update', { skipLocked: true })
      .limit(1);
    if (!target) return null;
    const [claimed] = await transaction
      .update(nodeUpdates)
      .set({ status: 'dispatched', dispatchedAt: now, updatedAt: now })
      .where(and(eq(nodeUpdates.id, target.id), eq(nodeUpdates.status, 'pending')))
      .returning();
    if (!claimed) return null;
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: null,
      action: 'node_update.dispatched',
      targetType: 'workstation',
      targetId: workstation.id,
      metadata: { updateId: claimed.id, targetVersion: claimed.targetVersion }
    });
    return claimed;
  });

  if (!instruction) return new Response(null, { status: 204 });
  return json(
    {
      apiVersion: 'v1',
      instructionId: instruction.id,
      workstation: { id: workstation.id, name: workstation.name },
      targetVersion: instruction.targetVersion,
      expiresAt: instruction.expiresAt
    },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
  );
};
