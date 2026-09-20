import { and, eq } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';

import { parseMonitoringRange } from '$lib/monitoring-history';
import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import {
  gpuDiagnosticResults,
  gpuDiagnosticRuns,
  users,
  workstations
} from '$lib/server/db/schema';
import { isWorkstationId } from '$lib/server/nodes/credentials';
import { expireDiagnostics } from '$lib/server/nodes/diagnostics';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';
import { presentWorkstation } from '$lib/server/nodes/presentation';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  requireAdmin(locals);
  if (!isWorkstationId(params.id) || !isWorkstationId(params.runId))
    error(404, 'Diagnostic not found');
  await expireDiagnostics();
  const [row] = await getDatabase()
    .select({
      run: gpuDiagnosticRuns,
      workstation: workstations,
      requester: { username: users.username, displayName: users.displayName }
    })
    .from(gpuDiagnosticRuns)
    .innerJoin(workstations, eq(gpuDiagnosticRuns.workstationId, workstations.id))
    .innerJoin(users, eq(gpuDiagnosticRuns.requestedByUserId, users.id))
    .where(
      and(eq(gpuDiagnosticRuns.id, params.runId), eq(gpuDiagnosticRuns.workstationId, params.id))
    )
    .limit(1);
  if (!row) error(404, 'Diagnostic not found');
  const [allGpus, results] = await Promise.all([
    loadWorkstationGpus(row.workstation.id),
    getDatabase()
      .select()
      .from(gpuDiagnosticResults)
      .where(eq(gpuDiagnosticResults.runId, row.run.id))
  ]);
  return {
    run: row.run,
    requester: row.requester,
    results,
    workstation: {
      ...presentWorkstation(row.workstation),
      connectionState: deriveConnectionState(row.workstation.lastHeartbeatAt)
    },
    gpus: allGpus.filter((gpu) => row.run.targetGpuUuids.includes(gpu.uuid)),
    range: parseMonitoringRange(url.searchParams.get('range') ?? '15m')
  };
};

export const actions: Actions = {
  cancel: async ({ locals, params }) => {
    const actor = requireAdmin(locals);
    if (!isWorkstationId(params.id) || !isWorkstationId(params.runId))
      return fail(404, { message: 'Diagnostic not found.' });
    const now = new Date();
    const [updated] = await getDatabase()
      .update(gpuDiagnosticRuns)
      .set({
        status: 'cancel_requested',
        detail: 'Cancellation requested by an administrator.',
        cancelRequestedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(gpuDiagnosticRuns.id, params.runId),
          eq(gpuDiagnosticRuns.workstationId, params.id),
          eq(gpuDiagnosticRuns.status, 'running')
        )
      )
      .returning({ id: gpuDiagnosticRuns.id });
    if (!updated) return fail(409, { message: 'Only a running diagnostic can be cancelled here.' });
    await recordAudit((query) => getDatabase().execute(query), {
      actorUserId: actor.id,
      action: 'gpu_diagnostic.cancel_requested',
      targetType: 'gpu_diagnostic',
      targetId: updated.id,
      metadata: { workstationId: params.id }
    });
    return { success: true, message: 'The node was asked to stop the diagnostic.' };
  }
};
