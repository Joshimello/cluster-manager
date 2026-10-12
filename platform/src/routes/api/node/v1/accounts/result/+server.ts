import { and, eq, gt, sql } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { accountOperations, workstationAssignments, users } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { lockAccounts } from '$lib/server/nodes/accounts';
import { isWorkstationId } from '$lib/server/nodes/credentials';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
  const node = await authenticateNode(request.headers.get('authorization'));
  if (!node) return json({ error: 'Node authentication failed.' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid account result.' }, { status: 400 });
  }
  if (
    !body ||
    !isWorkstationId(body.id) ||
    !['completed', 'blocked', 'failed'].includes(body.status) ||
    typeof body.detail !== 'string' ||
    body.detail.length > 1000
  )
    return json({ error: 'Invalid account result.' }, { status: 400 });
  const accepted = await getDatabase().transaction(async (tx) => {
    await lockAccounts(tx);
    const [op] = await tx
      .select()
      .from(accountOperations)
      .where(and(eq(accountOperations.id, body.id), eq(accountOperations.workstationId, node.id)))
      .for('update');
    if (!op) return false;
    const revokedImport =
      op.kind === 'adopt' &&
      op.status === 'blocked' &&
      op.detail === 'Import cancelled because access was revoked.' &&
      body.status === 'completed';
    if (['completed', 'adopted', 'blocked', 'failed'].includes(op.status) && !revokedImport)
      return true;
    if (!['dispatched', 'expired'].includes(op.status) && !revokedImport) return false;
    const [newer] = await tx
      .select({ id: accountOperations.id })
      .from(accountOperations)
      .where(
        and(
          eq(accountOperations.assignmentId, op.assignmentId),
          gt(
            accountOperations.createdAt,
            sql`(select created_at from account_operations where id = ${op.id})`
          )
        )
      )
      .limit(1);
    // A late receipt cannot complete or undo a replacement operation authorized by an admin.
    if (newer) return true;
    const [assignment] = await tx
      .select()
      .from(workstationAssignments)
      .where(eq(workstationAssignments.id, op.assignmentId))
      .for('update');
    const [user] = await tx.select().from(users).where(eq(users.id, op.userId));
    const status = revokedImport
      ? 'blocked'
      : body.status === 'completed' && op.kind === 'adopt'
        ? 'adopted'
        : body.status;
    if (body.status === 'completed') {
      if (
        !assignment ||
        (op.kind === 'adopt'
          ? assignment.accountState !== 'adopting' || !user || !!user.deletedAt
          : assignment.accountState !== 'removing' ||
            assignment.desiredGeneration !== op.generation)
      )
        return false;
      await tx
        .update(workstationAssignments)
        .set({
          accountState: op.kind === 'adopt' ? 'managed' : 'removed',
          provisioningStatus: op.kind === 'adopt' ? 'pending' : 'applied',
          provisioningMessage: body.detail,
          updatedAt: new Date()
        })
        .where(eq(workstationAssignments.id, op.assignmentId));
    }
    await tx
      .update(accountOperations)
      .set({
        status,
        detail: revokedImport ? 'Import cancelled because access was revoked.' : body.detail,
        updatedAt: new Date()
      })
      .where(eq(accountOperations.id, op.id));
    await recordAudit((q) => tx.execute(q), {
      actorUserId: null,
      action: 'account.operation_result',
      targetType: 'account_operation',
      targetId: op.id,
      metadata: { workstationId: node.id, username: op.account.username, status }
    });
    return true;
  });
  return json({ accepted }, { status: accepted ? 200 : 409 });
};
