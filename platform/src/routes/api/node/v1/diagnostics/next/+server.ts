import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { gpuDiagnosticRuns } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import { expireDiagnostics, gpuDiagnosticsCapability } from '$lib/server/nodes/diagnostics';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });
  if (!workstation.nodeCapabilities.includes(gpuDiagnosticsCapability)) {
    return new Response(null, { status: 204 });
  }
  await expireDiagnostics();
  const now = new Date();

  const instruction = await getDatabase().transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(gpuDiagnosticRuns)
      .where(
        and(
          eq(gpuDiagnosticRuns.workstationId, workstation.id),
          inArray(gpuDiagnosticRuns.status, ['dispatched', 'running', 'cancel_requested'])
        )
      )
      .orderBy(asc(gpuDiagnosticRuns.createdAt))
      .limit(1);
    if (existing) return existing;

    const [target] = await transaction
      .select()
      .from(gpuDiagnosticRuns)
      .where(
        and(
          eq(gpuDiagnosticRuns.workstationId, workstation.id),
          eq(gpuDiagnosticRuns.status, 'pending'),
          gt(gpuDiagnosticRuns.expiresAt, now)
        )
      )
      .orderBy(asc(gpuDiagnosticRuns.createdAt))
      .for('update', { skipLocked: true })
      .limit(1);
    if (!target) return null;
    const [claimed] = await transaction
      .update(gpuDiagnosticRuns)
      .set({ status: 'dispatched', dispatchedAt: now, updatedAt: now })
      .where(and(eq(gpuDiagnosticRuns.id, target.id), eq(gpuDiagnosticRuns.status, 'pending')))
      .returning();
    if (!claimed) return null;
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: null,
      action: 'gpu_diagnostic.dispatched',
      targetType: 'gpu_diagnostic',
      targetId: claimed.id,
      metadata: { workstationId: workstation.id }
    });
    return claimed;
  });

  if (!instruction) return new Response(null, { status: 204 });
  return json(
    {
      apiVersion: 'v1',
      runId: instruction.id,
      workstation: { id: workstation.id, name: workstation.name },
      targetGpuUuids: instruction.targetGpuUuids,
      durationSeconds: instruction.durationSeconds,
      memoryPercent: instruction.memoryPercent,
      workload: instruction.workload,
      temperatureCutoffC: instruction.temperatureCutoffC,
      imageDigest: instruction.imageDigest,
      expiresAt: instruction.expiresAt,
      cancelRequested: instruction.status === 'cancel_requested'
    },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
  );
};
