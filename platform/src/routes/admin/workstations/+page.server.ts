import { asc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { workstations, type WorkstationStatus } from '$lib/server/db/schema';
import {
  isWorkstationId,
  issueEnrollmentToken,
  normalizeWorkstationDisplayName,
  normalizeWorkstationName,
  validateWorkstationDisplayName,
  validateWorkstationName
} from '$lib/server/nodes/credentials';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
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
    workstations: rows.map((row) => {
      return {
        ...presentWorkstation(row),
        connectionState: deriveConnectionState(row.lastHeartbeatAt, now)
      };
    })
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
  },

  issueEnrollment: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const workstationId = formString(await request.formData(), 'workstationId');
    if (!isWorkstationId(workstationId))
      return fail(400, { action: 'issueEnrollment', message: 'Invalid workstation.' });
    const enrollment = issueEnrollmentToken();
    const outcome = await getDatabase().transaction(async (transaction) => {
      const [target] = await transaction
        .select()
        .from(workstations)
        .where(eq(workstations.id, workstationId))
        .for('update')
        .limit(1);
      if (!target) return null;
      await transaction
        .update(workstations)
        .set({
          enrollmentTokenHash: enrollment.tokenHash,
          enrollmentExpiresAt: enrollment.expiresAt,
          enrollmentUsedAt: null,
          credentialHash: null,
          credentialIssuedAt: null,
          updatedAt: new Date()
        })
        .where(eq(workstations.id, target.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'workstation.enrollment_issued',
        targetType: 'workstation',
        targetId: target.id,
        metadata: { name: target.name, previousCredentialRevoked: target.credentialHash !== null }
      });
      return target;
    });
    if (!outcome)
      return fail(404, { action: 'issueEnrollment', message: 'Workstation was not found.' });
    return {
      action: 'issueEnrollment',
      success: true,
      message: `Issued a new enrollment token for ${outcome.name}; any previous credential was revoked.`,
      enrollmentName: outcome.name,
      enrollmentToken: enrollment.token,
      enrollmentExpiresAt: enrollment.expiresAt.toISOString()
    };
  },

  revoke: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const workstationId = formString(await request.formData(), 'workstationId');
    if (!isWorkstationId(workstationId))
      return fail(400, { action: 'revoke', message: 'Invalid workstation.' });
    const [target] = await getDatabase()
      .select()
      .from(workstations)
      .where(eq(workstations.id, workstationId))
      .limit(1);
    if (!target) return fail(404, { action: 'revoke', message: 'Workstation was not found.' });
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .update(workstations)
        .set({ credentialHash: null, credentialIssuedAt: null, updatedAt: new Date() })
        .where(eq(workstations.id, target.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'workstation.credential_revoked',
        targetType: 'workstation',
        targetId: target.id,
        metadata: { name: target.name }
      });
    });
    return { action: 'revoke', success: true, message: `Revoked ${target.name}'s credential.` };
  },

  setStatus: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const workstationId = formString(formData, 'workstationId');
    const value = formString(formData, 'status');
    const status: WorkstationStatus | null =
      value === 'active' || value === 'disabled' ? value : null;
    if (!isWorkstationId(workstationId) || !status)
      return fail(400, { action: 'setStatus', message: 'Invalid workstation status update.' });
    const [target] = await getDatabase()
      .select()
      .from(workstations)
      .where(eq(workstations.id, workstationId))
      .limit(1);
    if (!target) return fail(404, { action: 'setStatus', message: 'Workstation was not found.' });
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .update(workstations)
        .set({ status, updatedAt: new Date() })
        .where(eq(workstations.id, target.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: status === 'active' ? 'workstation.enabled' : 'workstation.disabled',
        targetType: 'workstation',
        targetId: target.id,
        metadata: { name: target.name, previousStatus: target.status, status }
      });
    });
    return { action: 'setStatus', success: true, message: `${target.name} is now ${status}.` };
  }
};
