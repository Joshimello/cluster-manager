import { and, eq, isNull } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { requireUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { normalizeTimeZone } from '$lib/time-zone';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireUser(locals);
  const body = await request.json().catch(() => null);
  const timeZone = normalizeTimeZone(body?.timeZone);
  if (!timeZone) return json({ message: 'Choose a valid IANA time zone.' }, { status: 400 });

  await getDatabase()
    .update(users)
    .set({ timeZone, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), isNull(users.timeZone)));

  return json({ timeZone });
};
