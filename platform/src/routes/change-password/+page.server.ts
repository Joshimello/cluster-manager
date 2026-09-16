import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import { requireUser } from '$lib/server/auth/guards';
import { hashPassword, validatePassword, verifyPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { getDatabase } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  return {
    user: requireUser(locals)
  };
};

export const actions: Actions = {
  default: async ({ cookies, locals, request }) => {
    const user = requireUser(locals);
    const formData = await request.formData();
    const currentPassword = String(formData.get('currentPassword') ?? '');
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmation = String(formData.get('confirmation') ?? '');
    const validationError = validatePassword(newPassword);

    if (validationError) {
      return fail(400, { message: validationError });
    }

    if (newPassword !== confirmation) {
      return fail(400, { message: 'New password and confirmation do not match.' });
    }

    const database = getDatabase();
    const [freshUser] = await database
      .select({ passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!freshUser || freshUser.status !== 'active') {
      return fail(403, { message: 'This account is no longer active.' });
    }

    if (!(await verifyPassword(freshUser.passwordHash, currentPassword))) {
      return fail(400, { message: 'Current password is incorrect.' });
    }

    if (await verifyPassword(freshUser.passwordHash, newPassword)) {
      return fail(400, { message: 'New password must be different from the current password.' });
    }

    const newPasswordHash = await hashPassword(newPassword);

    await database.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          updatedAt: new Date()
        })
        .where(eq(users.id, user.id));
      await transaction.delete(sessions).where(eq(sessions.userId, user.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: user.id,
        action: 'user.password_changed',
        targetType: 'user',
        targetId: user.id,
        metadata: { username: user.username }
      });
    });

    const { session, token } = await createSession(user.id);
    setSessionCookie(cookies, token, session.expiresAt);
    redirect(303, '/dashboard');
  }
};
