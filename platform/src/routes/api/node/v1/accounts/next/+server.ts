import { and, asc, eq, inArray } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { getDatabase } from '$lib/server/db';
import {
  accountOperations,
  users,
  workstationAssignments,
  workstations
} from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { accountsFresh, expireAccountOperations, lockAccounts } from '$lib/server/nodes/accounts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ request }) => {
  const node = await authenticateNode(request.headers.get('authorization'));
  if (!node) return json({ error: 'Node authentication failed.' }, { status: 401 });
  const instruction = await getDatabase().transaction(async (tx) => {
    await lockAccounts(tx);
    await expireAccountOperations(tx);
    const [ws] = await tx
      .select()
      .from(workstations)
      .where(eq(workstations.id, node.id))
      .for('update');
    const [op] = await tx
      .select()
      .from(accountOperations)
      .where(
        and(
          eq(accountOperations.workstationId, node.id),
          inArray(accountOperations.status, ['pending', 'dispatched'])
        )
      )
      .orderBy(asc(accountOperations.createdAt))
      .for('update')
      .limit(1);
    if (!op) return null;
    const [a] = await tx
      .select()
      .from(workstationAssignments)
      .where(eq(workstationAssignments.id, op.assignmentId));
    const [u] = await tx.select().from(users).where(eq(users.id, op.userId));
    if (
      !ws ||
      !accountsFresh(ws) ||
      !a ||
      !u ||
      (op.kind === 'adopt'
        ? a.accountState !== 'adopting' ||
          a.status !== 'active' ||
          u.status !== 'active' ||
          !!u.deletedAt
        : a.accountState !== 'removing' || a.desiredGeneration !== op.generation)
    ) {
      await tx
        .update(accountOperations)
        .set({
          status: 'blocked',
          detail: 'Account or node changed; explicit retry required.',
          updatedAt: new Date()
        })
        .where(eq(accountOperations.id, op.id));
      return null;
    }
    await tx
      .update(accountOperations)
      .set({ status: 'dispatched', updatedAt: new Date() })
      .where(eq(accountOperations.id, op.id));
    return {
      apiVersion: 'v1',
      id: op.id,
      workstationId: ws.id,
      workstationName: ws.name,
      assignmentId: op.assignmentId,
      generation: op.generation,
      kind: op.kind,
      account: op.account,
      deleteHome: op.deleteHome,
      expiresAt: op.expiresAt
    };
  });
  return instruction
    ? json(instruction, { headers: { 'cache-control': 'no-store' } })
    : new Response(null, { status: 204 });
};
