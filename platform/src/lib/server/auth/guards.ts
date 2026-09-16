import { redirect } from '@sveltejs/kit';

import type { AuthUser } from './session';

export function requireUser(locals: App.Locals): AuthUser {
  if (!locals.user) {
    redirect(303, '/login');
  }

  return locals.user;
}

export function requireReadyUser(locals: App.Locals): AuthUser {
  const user = requireUser(locals);

  if (user.mustChangePassword) {
    redirect(303, '/change-password');
  }

  return user;
}

export function requireAdmin(locals: App.Locals): AuthUser {
  const user = requireReadyUser(locals);

  if (user.role !== 'admin') {
    redirect(303, '/dashboard');
  }

  return user;
}
