import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { hashPassword, verifyPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { getDatabase } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { normalizeUsername } from '$lib/server/users/validation';

import type { Actions, PageServerLoad } from './$types';

const dummyPasswordHash = hashPassword('this password is never accepted');

export const load: PageServerLoad = ({ locals }) => {
  if (locals.user) {
    redirect(303, locals.user.mustChangePassword ? '/change-password' : '/dashboard');
  }
};

export const actions: Actions = {
  default: async ({ cookies, request }) => {
    const formData = await request.formData();
    const username = normalizeUsername(String(formData.get('username') ?? ''));
    const password = String(formData.get('password') ?? '');

    if (!username || !password || password.length > 128) {
      return fail(400, {
        message: 'Enter a valid username and password.',
        username
      });
    }

    const [user] = await getDatabase()
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? (await dummyPasswordHash),
      password
    );

    if (!user || user.status !== 'active' || !passwordMatches) {
      return fail(400, {
        message: 'The username or password is incorrect.',
        username
      });
    }

    const { session, token } = await createSession(user.id);
    setSessionCookie(cookies, token, session.expiresAt);

    redirect(303, user.mustChangePassword ? '/change-password' : '/dashboard');
  }
};
