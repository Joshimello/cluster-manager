import { redirect } from '@sveltejs/kit';

import { deleteSessionCookie, invalidateSession } from '$lib/server/auth/session';

export async function POST({ cookies, locals }) {
  if (locals.session) {
    await invalidateSession(locals.session.id);
  }

  deleteSessionCookie(cookies);
  redirect(303, '/login');
}
