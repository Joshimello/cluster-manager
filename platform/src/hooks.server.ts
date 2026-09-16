import type { Handle } from '@sveltejs/kit';

import {
  deleteSessionCookie,
  sessionCookieName,
  validateSessionToken
} from '$lib/server/auth/session';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.session = null;
  event.locals.user = null;

  const token = event.cookies.get(sessionCookieName);

  if (token) {
    try {
      const validation = await validateSessionToken(token);

      if (validation) {
        event.locals.session = validation.session;
        event.locals.user = validation.user;
      } else {
        deleteSessionCookie(event.cookies);
      }
    } catch {
      // A temporary database outage must not turn public and health routes into 500s.
      // Keep the cookie intact so the session can be recovered when PostgreSQL returns.
    }
  }

  return resolve(event);
};
