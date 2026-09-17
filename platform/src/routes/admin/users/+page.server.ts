import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { generateTemporaryPassword, hashPasswordPair } from '$lib/server/auth/password';
import { getDatabase } from '$lib/server/db';
import {
  sessions,
  gpus,
  reservations,
  users,
  workstations,
  workstationAssignments,
  type UserStatus
} from '$lib/server/db/schema';
import { isWorkstationId } from '$lib/server/nodes/credentials';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';
import {
  isUserId,
  normalizeDisplayName,
  normalizeUsername,
  parseUserRole,
  validateDisplayName,
  validateUsername
} from '$lib/server/users/validation';
import {
  allocatePosixIdentity,
  PosixIdentityPoolExhaustedError
} from '$lib/server/users/posix-identity';

import type { Actions, PageServerLoad } from './$types';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);

  const database = getDatabase();
  const [platformUsers, availableWorkstations, activeAssignments] = await Promise.all([
    database
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        posixUid: users.posixUid,
        posixGid: users.posixGid,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .orderBy(asc(users.username)),
    database
      .select({
        id: workstations.id,
        name: workstations.name,
        displayName: workstations.displayName
      })
      .from(workstations)
      .where(eq(workstations.status, 'active'))
      .orderBy(asc(workstations.name)),
    database
      .select({
        id: workstationAssignments.id,
        userId: workstationAssignments.userId,
        workstationId: workstationAssignments.workstationId,
        workstationName: workstations.name,
        workstationDisplayName: workstations.displayName,
        desiredGeneration: workstationAssignments.desiredGeneration,
        appliedGeneration: workstationAssignments.appliedGeneration,
        provisioningStatus: workstationAssignments.provisioningStatus,
        provisioningMessage: workstationAssignments.provisioningMessage,
        provisioningErrorCode: workstationAssignments.provisioningErrorCode,
        reconciledAt: workstationAssignments.reconciledAt,
        inventory: workstations.inventory,
        lastHeartbeatAt: workstations.lastHeartbeatAt,
        nodeVersion: workstations.nodeVersion
      })
      .from(workstationAssignments)
      .innerJoin(workstations, eq(workstationAssignments.workstationId, workstations.id))
      .where(eq(workstationAssignments.status, 'active'))
  ]);

  const now = new Date();
  const [reservationRows, gpuViews] = await Promise.all([
    database
      .select({
        id: reservations.id,
        userId: reservations.userId,
        workstationName: workstations.name,
        gpuIndex: gpus.localIndex,
        startAt: reservations.startAt,
        endAt: reservations.endAt
      })
      .from(reservations)
      .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
      .innerJoin(workstations, eq(gpus.workstationId, workstations.id))
      .where(and(eq(reservations.status, 'active'), gt(reservations.endAt, now)))
      .orderBy(asc(reservations.startAt)),
    Promise.all(
      activeAssignments.map(async (assignment) => ({
        workstationId: assignment.workstationId,
        gpus: await loadWorkstationGpus(assignment.workstationId)
      }))
    )
  ]);

  const processCounts = new Map<string, number>();
  for (const view of gpuViews) {
    for (const gpu of view.gpus) {
      for (const process of gpu.processes) {
        processCounts.set(process.username, (processCounts.get(process.username) ?? 0) + 1);
      }
    }
  }

  return {
    users: platformUsers.map((user) => ({
      ...user,
      gpuProcessCount: processCounts.get(user.username) ?? 0,
      reservations: reservationRows
        .filter((reservation) => reservation.userId === user.id)
        .map((reservation) => ({
          ...reservation,
          state: reservation.startAt <= now ? 'current' : 'upcoming'
        }))
    })),
    workstations: availableWorkstations,
    assignments: activeAssignments.map((assignment) => ({
      ...assignment,
      connectionState: deriveConnectionState(assignment.lastHeartbeatAt, now)
    }))
  };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const username = normalizeUsername(formString(formData, 'username'));
    const displayName = normalizeDisplayName(formString(formData, 'displayName'));
    const role = parseUserRole(formString(formData, 'role'));
    const validationError = validateUsername(username) ?? validateDisplayName(displayName);

    if (validationError || !role) {
      return fail(400, {
        action: 'create',
        message: validationError ?? 'Choose a valid role.',
        values: { username, displayName, role: role ?? 'user' }
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    const { passwordHash, linuxPasswordHash } = await hashPasswordPair(temporaryPassword);

    try {
      const [createdUser] = await getDatabase().transaction(async (transaction) => {
        const posixIdentity = await allocatePosixIdentity((query) => transaction.execute(query));
        const created = await transaction
          .insert(users)
          .values({
            username,
            displayName,
            role,
            posixUid: posixIdentity.uid,
            posixGid: posixIdentity.gid,
            passwordHash,
            linuxPasswordHash
          })
          .returning({ id: users.id, username: users.username });

        await recordAudit((query) => transaction.execute(query), {
          actorUserId: actor.id,
          action: 'user.created',
          targetType: 'user',
          targetId: created[0].id,
          metadata: { username, role }
        });

        return created;
      });

      return {
        action: 'create',
        success: true,
        message: `Created ${createdUser.username}.`,
        createdUserId: createdUser.id,
        credentialUsername: createdUser.username,
        temporaryPassword
      };
    } catch (error) {
      if (error instanceof PosixIdentityPoolExhaustedError) {
        return fail(503, {
          action: 'create',
          message: error.message,
          values: { username, displayName, role }
        });
      }
      if (isUniqueViolation(error)) {
        return fail(409, {
          action: 'create',
          message: 'That username is already in use.',
          values: { username, displayName, role }
        });
      }

      throw error;
    }
  },

  edit: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const userId = formString(formData, 'userId');
    const displayName = normalizeDisplayName(formString(formData, 'displayName'));
    const role = parseUserRole(formString(formData, 'role'));
    const validationError = validateDisplayName(displayName);

    if (!isUserId(userId) || validationError || !role) {
      return fail(400, {
        action: 'edit',
        message: validationError ?? 'Invalid user update.'
      });
    }

    const outcome = await getDatabase().transaction(async (transaction) => {
      const [target] = await transaction.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!target) {
        return { error: 'User was not found.' } as const;
      }

      if (target.id === actor.id && target.role !== role) {
        return { error: 'Use another administrator to change your own role.' } as const;
      }

      if (target.role === 'admin' && role !== 'admin' && target.status === 'active') {
        const activeAdmins = await transaction
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
          .for('update');

        if (activeAdmins.length <= 1) {
          return { error: 'The last active administrator cannot be demoted.' } as const;
        }
      }

      await transaction
        .update(users)
        .set({ displayName, role, updatedAt: new Date() })
        .where(eq(users.id, target.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'user.updated',
        targetType: 'user',
        targetId: target.id,
        metadata: {
          username: target.username,
          previousDisplayName: target.displayName,
          displayName,
          previousRole: target.role,
          role
        }
      });

      return { username: target.username } as const;
    });

    if ('error' in outcome) {
      return fail(400, { action: 'edit', message: outcome.error });
    }

    return { action: 'edit', success: true, message: `Updated ${outcome.username}.` };
  },

  setStatus: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const userId = formString(formData, 'userId');
    const nextStatusValue = formString(formData, 'status');
    const nextStatus: UserStatus | null =
      nextStatusValue === 'active' || nextStatusValue === 'disabled' ? nextStatusValue : null;

    if (!isUserId(userId) || !nextStatus) {
      return fail(400, { action: 'setStatus', message: 'Invalid account status update.' });
    }

    const outcome = await getDatabase().transaction(async (transaction) => {
      const [target] = await transaction.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!target) {
        return { error: 'User was not found.' } as const;
      }

      if (target.id === actor.id && nextStatus === 'disabled') {
        return { error: 'You cannot disable your own account.' } as const;
      }

      if (target.role === 'admin' && target.status === 'active' && nextStatus === 'disabled') {
        const activeAdmins = await transaction
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
          .for('update');

        if (activeAdmins.length <= 1) {
          return { error: 'The last active administrator cannot be disabled.' } as const;
        }
      }

      await transaction
        .update(users)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(users.id, target.id));

      await transaction
        .update(workstationAssignments)
        .set({
          desiredGeneration: sql`${workstationAssignments.desiredGeneration} + 1`,
          provisioningStatus: 'pending',
          provisioningMessage: null,
          provisioningErrorCode: null,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(workstationAssignments.userId, target.id),
            eq(workstationAssignments.status, 'active')
          )
        );

      if (nextStatus === 'disabled') {
        await transaction.delete(sessions).where(eq(sessions.userId, target.id));
      }

      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: nextStatus === 'active' ? 'user.enabled' : 'user.disabled',
        targetType: 'user',
        targetId: target.id,
        metadata: { username: target.username, previousStatus: target.status, status: nextStatus }
      });

      return { username: target.username } as const;
    });

    if ('error' in outcome) {
      return fail(400, { action: 'setStatus', message: outcome.error });
    }

    return {
      action: 'setStatus',
      success: true,
      message: `${outcome.username} is now ${nextStatus}.`
    };
  },

  resetPassword: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const userId = formString(formData, 'userId');

    if (!isUserId(userId)) {
      return fail(400, { action: 'resetPassword', message: 'Invalid user.' });
    }

    if (userId === actor.id) {
      return fail(400, {
        action: 'resetPassword',
        message: 'Change your own password from the account menu.'
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    const { passwordHash, linuxPasswordHash } = await hashPasswordPair(temporaryPassword);
    const outcome = await getDatabase().transaction(async (transaction) => {
      const [target] = await transaction.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!target) {
        return { error: 'User was not found.' } as const;
      }

      await transaction
        .update(users)
        .set({ passwordHash, linuxPasswordHash, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, target.id));
      await transaction
        .update(workstationAssignments)
        .set({
          desiredGeneration: sql`${workstationAssignments.desiredGeneration} + 1`,
          provisioningStatus: 'pending',
          provisioningMessage: null,
          provisioningErrorCode: null,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(workstationAssignments.userId, target.id),
            eq(workstationAssignments.status, 'active')
          )
        );
      await transaction.delete(sessions).where(eq(sessions.userId, target.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'user.credentials_reset',
        targetType: 'user',
        targetId: target.id,
        metadata: { username: target.username }
      });

      return { username: target.username } as const;
    });

    if ('error' in outcome) {
      return fail(404, { action: 'resetPassword', message: outcome.error });
    }

    return {
      action: 'resetPassword',
      success: true,
      message: `Reset credentials for ${outcome.username}. Existing sessions were closed.`,
      credentialUsername: outcome.username,
      temporaryPassword
    };
  },

  assignWorkstation: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const userId = formString(formData, 'userId');
    const workstationId = formString(formData, 'workstationId');

    if (!isUserId(userId) || !isWorkstationId(workstationId)) {
      return fail(400, { action: 'assignWorkstation', message: 'Choose a valid workstation.' });
    }

    const outcome = await getDatabase().transaction(async (transaction) => {
      const [targetUser] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
      const [targetWorkstation] = await transaction
        .select()
        .from(workstations)
        .where(eq(workstations.id, workstationId))
        .limit(1);

      if (!targetUser) return { error: 'User was not found.' } as const;
      if (!targetWorkstation || targetWorkstation.status !== 'active') {
        return { error: 'Workstation is unavailable.' } as const;
      }

      const [current] = await transaction
        .select()
        .from(workstationAssignments)
        .where(
          and(
            eq(workstationAssignments.userId, userId),
            eq(workstationAssignments.status, 'active')
          )
        )
        .for('update')
        .limit(1);

      if (current?.workstationId === workstationId) {
        return {
          error: `${targetUser.username} is already assigned to ${targetWorkstation.name}.`
        } as const;
      }

      const changedAt = new Date();
      if (current) {
        await transaction
          .update(workstationAssignments)
          .set({
            status: 'revoked',
            desiredGeneration: sql`${workstationAssignments.desiredGeneration} + 1`,
            provisioningStatus: 'pending',
            provisioningMessage: null,
            provisioningErrorCode: null,
            revokedAt: changedAt,
            updatedAt: changedAt
          })
          .where(eq(workstationAssignments.id, current.id));
      }

      const [created] = await transaction
        .insert(workstationAssignments)
        .values({ userId, workstationId, assignedAt: changedAt, updatedAt: changedAt })
        .returning({ id: workstationAssignments.id });

      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: current ? 'workstation.assignment_moved' : 'workstation.assignment_created',
        targetType: 'user',
        targetId: targetUser.id,
        metadata: {
          username: targetUser.username,
          assignmentId: created.id,
          previousWorkstationId: current?.workstationId ?? null,
          workstationId,
          workstationName: targetWorkstation.name
        }
      });

      return { username: targetUser.username, workstationName: targetWorkstation.name } as const;
    });

    if ('error' in outcome) {
      return fail(400, { action: 'assignWorkstation', message: outcome.error });
    }

    return {
      action: 'assignWorkstation',
      success: true,
      message: `Assigned ${outcome.username} to ${outcome.workstationName}.`
    };
  },

  revokeWorkstation: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const formData = await request.formData();
    const userId = formString(formData, 'userId');
    if (!isUserId(userId)) {
      return fail(400, { action: 'revokeWorkstation', message: 'Invalid user.' });
    }

    const outcome = await getDatabase().transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          id: workstationAssignments.id,
          userId: workstationAssignments.userId,
          workstationId: workstationAssignments.workstationId,
          username: users.username,
          workstationName: workstations.name
        })
        .from(workstationAssignments)
        .innerJoin(users, eq(workstationAssignments.userId, users.id))
        .innerJoin(workstations, eq(workstationAssignments.workstationId, workstations.id))
        .where(
          and(
            eq(workstationAssignments.userId, userId),
            eq(workstationAssignments.status, 'active')
          )
        )
        .for('update')
        .limit(1);

      if (!current) return { error: 'User has no active workstation assignment.' } as const;

      const revokedAt = new Date();
      await transaction
        .update(workstationAssignments)
        .set({
          status: 'revoked',
          desiredGeneration: sql`${workstationAssignments.desiredGeneration} + 1`,
          provisioningStatus: 'pending',
          provisioningMessage: null,
          provisioningErrorCode: null,
          revokedAt,
          updatedAt: revokedAt
        })
        .where(eq(workstationAssignments.id, current.id));

      await recordAudit((query) => transaction.execute(query), {
        actorUserId: actor.id,
        action: 'workstation.assignment_revoked',
        targetType: 'user',
        targetId: current.userId,
        metadata: {
          username: current.username,
          assignmentId: current.id,
          workstationId: current.workstationId,
          workstationName: current.workstationName
        }
      });

      return { username: current.username, workstationName: current.workstationName } as const;
    });

    if ('error' in outcome) {
      return fail(400, { action: 'revokeWorkstation', message: outcome.error });
    }

    return {
      action: 'revokeWorkstation',
      success: true,
      message: `Revoked ${outcome.username}'s access to ${outcome.workstationName}.`
    };
  }
};
