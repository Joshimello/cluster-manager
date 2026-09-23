import { redirect } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
  if (!locals.user) {
    redirect(303, '/login');
  }

  redirect(303, locals.user.mustChangePassword ? '/change-password' : '/dashboard');
};
