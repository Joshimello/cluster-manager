import { json, text, type Handle } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';

import {
  deleteSessionCookie,
  sessionCookieName,
  validateSessionToken
} from '$lib/server/auth/session';
import { structuredLog } from '$lib/server/logging';
import { runMaintenanceIfDue } from '$lib/server/maintenance';
import { isAllowedFormSubmission, parseTrustedOrigins } from '$lib/server/security/csrf';

const csrfTrustedOrigins = parseTrustedOrigins(process.env.CSRF_TRUSTED_ORIGINS);

export const handle: Handle = async ({ event, resolve }) => {
  const requestId = event.request.headers.get('x-request-id')?.slice(0, 128) || randomUUID();
  const startedAt = performance.now();
  event.locals.session = null;
  event.locals.user = null;

  if (!isAllowedFormSubmission(event.request, event.url.origin, csrfTrustedOrigins)) {
    const message = `Cross-site ${event.request.method} form submissions are forbidden`;
    const response =
      event.request.headers.get('accept') === 'application/json'
        ? json({ message }, { status: 403 })
        : text(message, { status: 403 });
    response.headers.set('x-request-id', requestId);
    structuredLog('warn', 'http.csrf_rejected', {
      requestId,
      method: event.request.method,
      path: event.url.pathname,
      requestOrigin: event.request.headers.get('origin')
    });
    return response;
  }

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

  const response = await resolve(event);
  response.headers.set('x-request-id', requestId);
  structuredLog('info', 'http.request', {
    requestId,
    method: event.request.method,
    path: event.url.pathname,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    actor: event.locals.user?.username ?? null
  });
  await runMaintenanceIfDue();
  return response;
};
