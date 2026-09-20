import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';

import { parseMonitoringRange } from '$lib/monitoring-history';
import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import {
  gpuDiagnosticResults,
  gpuDiagnosticRuns,
  gpus,
  nodeUpdates,
  reservations,
  workstations
} from '$lib/server/db/schema';
import { isWorkstationId } from '$lib/server/nodes/credentials';
import {
  activeDiagnosticStatuses,
  diagnosticDispatchLifetimeMilliseconds,
  diagnosticReservationBufferMilliseconds,
  expireDiagnostics,
  gpuDiagnosticsCapability,
  validDiagnosticImageDigest
} from '$lib/server/nodes/diagnostics';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';
import { presentWorkstation } from '$lib/server/nodes/presentation';
import {
  expireNodeUpdates,
  isNewerStableRelease,
  managedUpdateCapability,
  nodeUpdateLifetimeMilliseconds,
  parseStableRelease
} from '$lib/server/nodes/updates';

import type { Actions, PageServerLoad } from './$types';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function uniqueViolation(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505';
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
  requireAdmin(locals);
  if (!isWorkstationId(params.id)) error(404, 'Workstation not found');
  await Promise.all([expireNodeUpdates(), expireDiagnostics()]);
  const [workstation] = await getDatabase()
    .select()
    .from(workstations)
    .where(eq(workstations.id, params.id))
    .limit(1);
  if (!workstation) error(404, 'Workstation not found');
  const [gpuState, updates, diagnostics] = await Promise.all([
    loadWorkstationGpus(workstation.id),
    getDatabase()
      .select()
      .from(nodeUpdates)
      .where(eq(nodeUpdates.workstationId, workstation.id))
      .orderBy(desc(nodeUpdates.createdAt))
      .limit(10),
    getDatabase()
      .select()
      .from(gpuDiagnosticRuns)
      .where(eq(gpuDiagnosticRuns.workstationId, workstation.id))
      .orderBy(desc(gpuDiagnosticRuns.createdAt))
      .limit(10)
  ]);
  const diagnosticIds = diagnostics.map((run) => run.id);
  const diagnosticResults =
    diagnosticIds.length === 0
      ? []
      : await getDatabase()
          .select()
          .from(gpuDiagnosticResults)
          .where(inArray(gpuDiagnosticResults.runId, diagnosticIds));
  return {
    workstation: {
      ...presentWorkstation(workstation),
      connectionState: deriveConnectionState(workstation.lastHeartbeatAt)
    },
    gpus: gpuState,
    updates,
    diagnostics: diagnostics.map((run) => ({
      ...run,
      results: diagnosticResults.filter((result) => result.runId === run.id)
    })),
    range: parseMonitoringRange(url.searchParams.get('range')),
    managedUpdateCapability,
    gpuDiagnosticsCapability
  };
};

export const actions: Actions = {
  queueDiagnostic: async ({ locals, params, request }) => {
    const actor = requireAdmin(locals);
    if (!isWorkstationId(params.id))
      return fail(404, { action: 'queueDiagnostic', message: 'Workstation not found.' });
    await expireDiagnostics();

    const formData = await request.formData();
    const target = formString(formData, 'target');
    const workload = formString(formData, 'workload');
    const confirmation = formString(formData, 'confirmation');
    const durationSeconds = Number(formString(formData, 'durationSeconds'));
    const memoryPercent = Number(formString(formData, 'memoryPercent'));
    const temperatureCutoffC = Number(formString(formData, 'temperatureCutoffC'));
    const values = {
      target,
      workload,
      confirmation,
      durationSeconds,
      memoryPercent,
      temperatureCutoffC
    };
    if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 1800)
      return fail(400, {
        action: 'queueDiagnostic',
        message: 'Duration must be 10–1800 seconds.',
        values
      });
    if (!Number.isInteger(memoryPercent) || memoryPercent < 50 || memoryPercent > 90)
      return fail(400, { action: 'queueDiagnostic', message: 'Memory must be 50–90%.', values });
    if (!Number.isInteger(temperatureCutoffC) || temperatureCutoffC < 70 || temperatureCutoffC > 90)
      return fail(400, {
        action: 'queueDiagnostic',
        message: 'Temperature cutoff must be 70–90°C.',
        values
      });
    if (!['fp32', 'fp64', 'tensor'].includes(workload))
      return fail(400, { action: 'queueDiagnostic', message: 'Choose a valid workload.', values });

    const gpuState = await loadWorkstationGpus(params.id);
    const targetGpus = target === 'all' ? gpuState : gpuState.filter((gpu) => gpu.id === target);
    if (targetGpus.length === 0)
      return fail(400, {
        action: 'queueDiagnostic',
        message: 'Choose an active GPU target.',
        values
      });
    if (targetGpus.some((gpu) => gpu.telemetryState !== 'online'))
      return fail(409, {
        action: 'queueDiagnostic',
        message: 'Fresh telemetry is required for every target GPU.',
        values
      });
    if (targetGpus.some((gpu) => gpu.processCount > 0))
      return fail(409, {
        action: 'queueDiagnostic',
        message: 'A targeted GPU currently has an observed process.',
        values
      });

    try {
      const outcome = await getDatabase().transaction(async (transaction) => {
        const [workstation] = await transaction
          .select()
          .from(workstations)
          .where(eq(workstations.id, params.id))
          .for('update')
          .limit(1);
        if (!workstation) return { error: 'Workstation not found.', status: 404 } as const;
        if (confirmation !== workstation.name)
          return {
            error: `Type ${workstation.name} exactly to confirm the stress test.`,
            status: 400
          } as const;
        if (workstation.status !== 'active' || workstation.credentialHash === null)
          return { error: 'The workstation must be active and enrolled.', status: 409 } as const;
        if (deriveConnectionState(workstation.lastHeartbeatAt) !== 'online')
          return { error: 'The workstation must be online.', status: 409 } as const;
        if (!workstation.nodeCapabilities.includes(gpuDiagnosticsCapability))
          return {
            error: 'GPU diagnostics are not configured on this node.',
            status: 409
          } as const;
        if (!validDiagnosticImageDigest(workstation.diagnosticsImageDigest))
          return {
            error: 'The node did not report a trusted diagnostic image digest.',
            status: 409
          } as const;

        const [activeUpdate] = await transaction
          .select({ id: nodeUpdates.id })
          .from(nodeUpdates)
          .where(
            and(
              eq(nodeUpdates.workstationId, workstation.id),
              inArray(nodeUpdates.status, ['pending', 'dispatched', 'restarting'])
            )
          )
          .limit(1);
        if (activeUpdate)
          return {
            error: 'Wait for the managed node update to finish first.',
            status: 409
          } as const;

        const targetIds = targetGpus.map((gpu) => gpu.id);
        const storedTargets = await transaction
          .select({ id: gpus.id, uuid: gpus.gpuUuid })
          .from(gpus)
          .where(
            and(
              eq(gpus.workstationId, workstation.id),
              eq(gpus.active, true),
              inArray(gpus.id, targetIds)
            )
          )
          .orderBy(asc(gpus.localIndex))
          .for('update');
        if (storedTargets.length !== targetIds.length)
          return { error: 'GPU inventory changed; refresh and try again.', status: 409 } as const;

        const now = new Date();
        const reservedUntil = new Date(
          now.getTime() +
            diagnosticDispatchLifetimeMilliseconds +
            durationSeconds * 1000 +
            diagnosticReservationBufferMilliseconds
        );
        const [reservation] = await transaction
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              inArray(reservations.gpuId, targetIds),
              eq(reservations.status, 'active'),
              lt(reservations.startAt, reservedUntil),
              gt(reservations.endAt, now)
            )
          )
          .limit(1);
        if (reservation)
          return {
            error: 'A targeted GPU has a reservation during the diagnostic safety window.',
            status: 409
          } as const;

        const [created] = await transaction
          .insert(gpuDiagnosticRuns)
          .values({
            workstationId: workstation.id,
            requestedByUserId: actor.id,
            targetGpuId: target === 'all' ? null : target,
            targetGpuUuids: storedTargets.map((gpu) => gpu.uuid),
            scope: target === 'all' ? 'all' : 'gpu',
            workload: workload as 'fp32' | 'fp64' | 'tensor',
            durationSeconds,
            memoryPercent,
            temperatureCutoffC,
            imageDigest: workstation.diagnosticsImageDigest,
            reservedUntil,
            expiresAt: new Date(now.getTime() + diagnosticDispatchLifetimeMilliseconds)
          })
          .returning({ id: gpuDiagnosticRuns.id });
        await recordAudit((query) => transaction.execute(query), {
          actorUserId: actor.id,
          action: 'gpu_diagnostic.queued',
          targetType: 'gpu_diagnostic',
          targetId: created.id,
          metadata: {
            workstationId: workstation.id,
            scope: target === 'all' ? 'all' : 'gpu',
            targetGpuUuids: storedTargets.map((gpu) => gpu.uuid).join(','),
            workload,
            durationSeconds,
            memoryPercent,
            temperatureCutoffC
          }
        });
        return { workstation } as const;
      });
      if ('error' in outcome)
        return fail(outcome.status ?? 409, {
          action: 'queueDiagnostic',
          message: outcome.error,
          values
        });
      return {
        action: 'queueDiagnostic',
        success: true,
        message: `GPU diagnostic queued for ${outcome.workstation.name}.`
      };
    } catch (cause) {
      if (uniqueViolation(cause))
        return fail(409, {
          action: 'queueDiagnostic',
          message: 'This workstation already has a diagnostic in progress.',
          values
        });
      throw cause;
    }
  },

  cancelDiagnostic: async ({ locals, params, request }) => {
    const actor = requireAdmin(locals);
    if (!isWorkstationId(params.id))
      return fail(404, { action: 'cancelDiagnostic', message: 'Workstation not found.' });
    const runId = formString(await request.formData(), 'runId');
    const now = new Date();
    const cancelled = await getDatabase().transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(gpuDiagnosticRuns)
        .where(
          and(
            eq(gpuDiagnosticRuns.id, runId),
            eq(gpuDiagnosticRuns.workstationId, params.id),
            inArray(gpuDiagnosticRuns.status, [...activeDiagnosticStatuses])
          )
        )
        .for('update')
        .limit(1);
      if (!run) return null;
      const immediate = run.status === 'pending';
      await transaction
        .update(gpuDiagnosticRuns)
        .set({
          status: immediate ? 'cancelled' : 'cancel_requested',
          detail: immediate
            ? 'Cancelled by an administrator before node dispatch.'
            : 'Cancellation requested by an administrator.',
          cancelRequestedAt: now,
          completedAt: immediate ? now : null,
          updatedAt: now
        })
        .where(eq(gpuDiagnosticRuns.id, run.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: immediate ? 'gpu_diagnostic.cancelled' : 'gpu_diagnostic.cancel_requested',
        targetType: 'gpu_diagnostic',
        targetId: run.id,
        metadata: { workstationId: params.id }
      });
      return immediate;
    });
    if (cancelled === null)
      return fail(409, {
        action: 'cancelDiagnostic',
        message: 'That diagnostic is no longer cancellable.'
      });
    return {
      action: 'cancelDiagnostic',
      success: true,
      message: cancelled
        ? 'The pending diagnostic was cancelled.'
        : 'The node was asked to stop the diagnostic.'
    };
  },

  queueUpdate: async ({ locals, params, request }) => {
    const actor = requireAdmin(locals);
    if (!isWorkstationId(params.id))
      return fail(404, { action: 'queueUpdate', message: 'Workstation not found.' });
    await expireNodeUpdates();

    const formData = await request.formData();
    const targetVersion = formString(formData, 'targetVersion');
    const confirmation = formString(formData, 'confirmation');
    if (!parseStableRelease(targetVersion)) {
      return fail(400, {
        action: 'queueUpdate',
        message: 'Enter an exact stable release such as v0.3.0.',
        values: { targetVersion, confirmation }
      });
    }

    try {
      const outcome = await getDatabase().transaction(async (transaction) => {
        const [workstation] = await transaction
          .select()
          .from(workstations)
          .where(eq(workstations.id, params.id))
          .for('update')
          .limit(1);
        if (!workstation) return { error: 'Workstation not found.', status: 404 } as const;
        if (confirmation !== workstation.name)
          return {
            error: `Type ${workstation.name} exactly to confirm the update.`,
            status: 400
          } as const;
        if (workstation.status !== 'active' || workstation.credentialHash === null)
          return { error: 'The workstation must be active and enrolled.', status: 409 } as const;
        if (deriveConnectionState(workstation.lastHeartbeatAt) !== 'online')
          return {
            error: 'The workstation must be online before an update can be sent.',
            status: 409
          } as const;
        if (!workstation.nodeCapabilities.includes(managedUpdateCapability))
          return {
            error:
              'This node does not support managed updates yet. Upgrade it manually once, then future releases can be installed here.',
            status: 409
          } as const;
        if (
          !workstation.nodeVersion ||
          !isNewerStableRelease(workstation.nodeVersion, targetVersion)
        )
          return {
            error: `The target must be newer than the current stable version (${workstation.nodeVersion ?? 'unknown'}).`,
            status: 409
          } as const;

        const [activeDiagnostic] = await transaction
          .select({ id: gpuDiagnosticRuns.id })
          .from(gpuDiagnosticRuns)
          .where(
            and(
              eq(gpuDiagnosticRuns.workstationId, workstation.id),
              inArray(gpuDiagnosticRuns.status, [...activeDiagnosticStatuses])
            )
          )
          .limit(1);
        if (activeDiagnostic)
          return {
            error: 'Wait for the GPU diagnostic to finish before updating the node.',
            status: 409
          } as const;

        const now = new Date();
        const expiresAt = new Date(now.getTime() + nodeUpdateLifetimeMilliseconds);
        const [created] = await transaction
          .insert(nodeUpdates)
          .values({
            workstationId: workstation.id,
            requestedByUserId: actor.id,
            sourceVersion: workstation.nodeVersion,
            targetVersion,
            expiresAt
          })
          .returning({ id: nodeUpdates.id });
        await recordAudit((query) => transaction.execute(query), {
          actorUserId: actor.id,
          action: 'node_update.queued',
          targetType: 'workstation',
          targetId: workstation.id,
          metadata: {
            updateId: created.id,
            sourceVersion: workstation.nodeVersion,
            targetVersion
          }
        });
        return { workstation, created } as const;
      });

      if ('error' in outcome)
        return fail(outcome.status ?? 409, {
          action: 'queueUpdate',
          message: outcome.error,
          values: { targetVersion, confirmation }
        });
      return {
        action: 'queueUpdate',
        success: true,
        message: `${outcome.workstation.name} will update to ${targetVersion} on its next heartbeat.`
      };
    } catch (cause) {
      if (uniqueViolation(cause))
        return fail(409, {
          action: 'queueUpdate',
          message: 'This workstation already has an update in progress.',
          values: { targetVersion, confirmation }
        });
      throw cause;
    }
  },

  cancelUpdate: async ({ locals, params, request }) => {
    const actor = requireAdmin(locals);
    if (!isWorkstationId(params.id))
      return fail(404, { action: 'cancelUpdate', message: 'Workstation not found.' });
    const updateId = formString(await request.formData(), 'updateId');
    const now = new Date();
    const cancelled = await getDatabase().transaction(async (transaction) => {
      const [updated] = await transaction
        .update(nodeUpdates)
        .set({
          status: 'cancelled',
          detail: 'Cancelled by an administrator before node dispatch.',
          completedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(nodeUpdates.id, updateId),
            eq(nodeUpdates.workstationId, params.id),
            eq(nodeUpdates.status, 'pending')
          )
        )
        .returning({ id: nodeUpdates.id });
      if (!updated) return false;
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'node_update.cancelled',
        targetType: 'workstation',
        targetId: params.id,
        metadata: { updateId }
      });
      return true;
    });
    if (!cancelled)
      return fail(409, {
        action: 'cancelUpdate',
        message: 'Only an update that has not reached the node can be cancelled.'
      });
    return { action: 'cancelUpdate', success: true, message: 'The pending update was cancelled.' };
  }
};
