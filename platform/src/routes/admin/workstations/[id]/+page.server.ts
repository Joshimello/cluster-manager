import { and, desc, eq } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { nodeUpdates, workstations } from '$lib/server/db/schema';
import { isWorkstationId } from '$lib/server/nodes/credentials';
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

export const load: PageServerLoad = async ({ locals, params }) => {
  requireAdmin(locals);
  if (!isWorkstationId(params.id)) error(404, 'Workstation not found');
  await expireNodeUpdates();
  const [workstation] = await getDatabase()
    .select()
    .from(workstations)
    .where(eq(workstations.id, params.id))
    .limit(1);
  if (!workstation) error(404, 'Workstation not found');
  const [gpuState, updates] = await Promise.all([
    loadWorkstationGpus(workstation.id),
    getDatabase()
      .select()
      .from(nodeUpdates)
      .where(eq(nodeUpdates.workstationId, workstation.id))
      .orderBy(desc(nodeUpdates.createdAt))
      .limit(10)
  ]);
  return {
    workstation: {
      ...presentWorkstation(workstation),
      connectionState: deriveConnectionState(workstation.lastHeartbeatAt)
    },
    gpus: gpuState,
    updates,
    managedUpdateCapability
  };
};

export const actions: Actions = {
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
