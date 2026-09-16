import { and, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { getDatabase } from '$lib/server/db';
import { workstationAssignments } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { isWorkstationId } from '$lib/server/nodes/credentials';

import type { RequestHandler } from './$types';

type ReconciliationResult = {
  assignmentId: string;
  generation: number;
  status: 'applied' | 'error';
  message: string;
};

function parseResults(value: unknown): ReconciliationResult[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const results = (value as Record<string, unknown>).results;
  if (!Array.isArray(results) || results.length > 256) return null;

  const parsed: ReconciliationResult[] = [];
  for (const candidate of results) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
      return null;
    const item = candidate as Record<string, unknown>;
    const message = item.message === undefined ? '' : item.message;
    if (
      typeof item.assignmentId !== 'string' ||
      !isWorkstationId(item.assignmentId) ||
      typeof item.generation !== 'number' ||
      !Number.isSafeInteger(item.generation) ||
      item.generation < 1 ||
      (item.status !== 'applied' && item.status !== 'error') ||
      typeof message !== 'string' ||
      message.length > 1_000
    ) {
      return null;
    }
    parsed.push({
      assignmentId: item.assignmentId,
      generation: item.generation,
      status: item.status,
      message
    });
  }
  return parsed;
}

export const POST: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON reconciliation report.' }, { status: 400 });
  }
  const results = parseResults(body);
  if (!results) return json({ error: 'Invalid reconciliation report.' }, { status: 400 });

  const reconciledAt = new Date();
  let accepted = 0;
  await getDatabase().transaction(async (transaction) => {
    for (const result of results) {
      const updated = await transaction
        .update(workstationAssignments)
        .set({
          appliedGeneration: result.generation,
          provisioningStatus: result.status,
          provisioningMessage: result.message || null,
          reconciledAt,
          updatedAt: reconciledAt
        })
        .where(
          and(
            eq(workstationAssignments.id, result.assignmentId),
            eq(workstationAssignments.workstationId, workstation.id),
            eq(workstationAssignments.desiredGeneration, result.generation)
          )
        )
        .returning({ id: workstationAssignments.id });
      accepted += updated.length;
    }
  });

  return json({ accepted, serverTime: reconciledAt });
};
