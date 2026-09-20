import { and, eq, gt, inArray } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { gpuDiagnosticResults, gpuDiagnosticRuns, gpus } from '$lib/server/db/schema';
import { authenticateNode } from '$lib/server/nodes/authentication';
import {
  canTransitionDiagnostic,
  expireDiagnostics,
  parseDiagnosticReport
} from '$lib/server/nodes/diagnostics';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const workstation = await authenticateNode(request.headers.get('authorization'));
  if (!workstation) return json({ error: 'Node authentication failed.' }, { status: 401 });
  const report = parseDiagnosticReport(await request.json().catch(() => null));
  if (!report) return json({ error: 'Invalid diagnostic result.' }, { status: 400 });
  await expireDiagnostics();
  const now = new Date();

  const accepted = await getDatabase().transaction(async (transaction) => {
    const [run] = await transaction
      .select()
      .from(gpuDiagnosticRuns)
      .where(
        and(
          eq(gpuDiagnosticRuns.id, report.runId),
          eq(gpuDiagnosticRuns.workstationId, workstation.id),
          report.status === 'running'
            ? gt(gpuDiagnosticRuns.expiresAt, now)
            : inArray(gpuDiagnosticRuns.status, ['dispatched', 'running', 'cancel_requested'])
        )
      )
      .for('update')
      .limit(1);
    if (!run || !canTransitionDiagnostic(run.status, report.status)) return null;
    if (report.results.some((result) => !run.targetGpuUuids.includes(result.gpuUuid))) return null;
    if (
      ['passed', 'faulty'].includes(report.status) &&
      (report.results.length !== run.targetGpuUuids.length ||
        report.results.some((result) => !run.targetGpuUuids.includes(result.gpuUuid)))
    ) {
      return null;
    }
    if (
      (report.status === 'passed' &&
        report.results.some((result) => result.outcome !== 'passed')) ||
      (report.status === 'faulty' && !report.results.some((result) => result.outcome === 'faulty'))
    ) {
      return null;
    }

    const complete = report.status !== 'running';
    await transaction
      .update(gpuDiagnosticRuns)
      .set({
        status: report.status,
        detail: report.detail,
        outputLog: report.outputLog || null,
        startedAt: report.status === 'running' ? now : run.startedAt,
        completedAt: complete ? now : null,
        updatedAt: now
      })
      .where(eq(gpuDiagnosticRuns.id, run.id));

    if (complete && report.results.length > 0) {
      const storedGpus = await transaction
        .select({ id: gpus.id, uuid: gpus.gpuUuid })
        .from(gpus)
        .where(
          and(
            eq(gpus.workstationId, workstation.id),
            inArray(
              gpus.gpuUuid,
              report.results.map((result) => result.gpuUuid)
            )
          )
        );
      const gpuIds = new Map(storedGpus.map((gpu) => [gpu.uuid, gpu.id]));
      await transaction
        .insert(gpuDiagnosticResults)
        .values(
          report.results.map((result) => ({
            runId: run.id,
            gpuId: gpuIds.get(result.gpuUuid) ?? null,
            gpuUuid: result.gpuUuid,
            localIndex: result.localIndex,
            model: result.model,
            outcome: result.outcome,
            maxTemperatureC: result.maxTemperatureC,
            peakUtilizationPercent: result.peakUtilizationPercent,
            peakMemoryBytes: result.peakMemoryBytes,
            averageGflops: result.averageGflops,
            maximumGflops: result.maximumGflops,
            errorCount: result.errorCount,
            detail: result.detail
          }))
        )
        .onConflictDoNothing();
    }

    await recordAudit((query) => transaction.execute(query), {
      actorUserId: null,
      action: `gpu_diagnostic.${report.status}`,
      targetType: 'gpu_diagnostic',
      targetId: run.id,
      metadata: { workstationId: workstation.id, detail: report.detail }
    });
    return run;
  });

  if (!accepted)
    return json(
      {
        error: 'Diagnostic is unknown, expired, belongs to another node, or has an invalid state.'
      },
      { status: 409 }
    );
  return json({ accepted: true });
};
