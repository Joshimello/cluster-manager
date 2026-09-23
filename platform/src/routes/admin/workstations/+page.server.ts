import { asc } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { workstations } from '$lib/server/db/schema';
import {
  issueEnrollmentToken,
  normalizeWorkstationDisplayName,
  normalizeWorkstationName,
  validateWorkstationDisplayName,
  validateWorkstationName
} from '$lib/server/nodes/credentials';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';
import { presentWorkstation } from '$lib/server/nodes/presentation';

import type { Actions, PageServerLoad } from './$types';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

function uniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const rows = await getDatabase().select().from(workstations).orderBy(asc(workstations.name));
  const now = new Date();
  return {
    workstations: await Promise.all(
      rows.map(async (row) => {
        const gpuViews = await loadWorkstationGpus(row.id, { now });
        return {
          ...presentWorkstation(row),
          connectionState: deriveConnectionState(row.lastHeartbeatAt, now),
          gpuCount: gpuViews.length,
          gpus: gpuViews.map((gpu) => ({
            id: gpu.id,
            index: gpu.index,
            model: gpu.model,
            telemetryState: gpu.telemetryState,
            coordinationState: gpu.coordinationState,
            utilizationPercent: gpu.utilizationPercent,
            memoryUsedBytes: gpu.memoryUsedBytes,
            memoryTotalBytes: gpu.memoryTotalBytes,
            processCount: gpu.processCount
          })),
          nodeVersion: row.nodeVersion
        };
      })
    )
  };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const name = normalizeWorkstationName(formString(formData, 'name'));
    const displayName = normalizeWorkstationDisplayName(formString(formData, 'displayName'));
    const validationError =
      validateWorkstationName(name) ?? validateWorkstationDisplayName(displayName);
    if (validationError) {
      return fail(400, {
        action: 'create',
        message: validationError,
        values: { name, displayName }
      });
    }

    const enrollment = issueEnrollmentToken();
    try {
      const [created] = await getDatabase().transaction(async (transaction) => {
        const result = await transaction
          .insert(workstations)
          .values({
            name,
            displayName,
            enrollmentTokenHash: enrollment.tokenHash,
            enrollmentExpiresAt: enrollment.expiresAt
          })
          .returning({ id: workstations.id, name: workstations.name });
        await recordAudit((query) => transaction.execute(query), {
          actorUserId: actor.id,
          action: 'workstation.created',
          targetType: 'workstation',
          targetId: result[0].id,
          metadata: { name }
        });
        return result;
      });
      return {
        action: 'create',
        success: true,
        message: `Created ${created.name}.`,
        enrollmentName: created.name,
        enrollmentToken: enrollment.token,
        enrollmentExpiresAt: enrollment.expiresAt.toISOString()
      };
    } catch (error) {
      if (uniqueViolation(error))
        return fail(409, {
          action: 'create',
          message: 'That workstation name is already in use.',
          values: { name, displayName }
        });
      throw error;
    }
  }
};
