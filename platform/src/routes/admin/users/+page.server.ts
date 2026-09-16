import { and, asc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/auth/guards';
import { generateTemporaryPassword, hashPassword } from '$lib/server/auth/password';
import { getDatabase } from '$lib/server/db';
import { sessions, users, type UserStatus } from '$lib/server/db/schema';
import {
  isUserId,
  normalizeDisplayName,
  normalizeUsername,
  parseUserRole,
  validateDisplayName,
  validateUsername
} from '$lib/server/users/validation';

import type { Actions, PageServerLoad } from './$types';

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);

  return {
    users: await getDatabase()
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .orderBy(asc(users.username))
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
    const passwordHash = await hashPassword(temporaryPassword);

    try {
      const [createdUser] = await getDatabase().transaction(async (transaction) => {
        const created = await transaction
          .insert(users)
          .values({ username, displayName, role, passwordHash })
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
    const passwordHash = await hashPassword(temporaryPassword);
    const outcome = await getDatabase().transaction(async (transaction) => {
      const [target] = await transaction.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!target) {
        return { error: 'User was not found.' } as const;
      }

      await transaction
        .update(users)
        .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, target.id));
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
  }
};
