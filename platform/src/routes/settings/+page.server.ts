import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import { requireReadyUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { defaultTimeZone, normalizeTimeZone, supportedTimeZones } from '$lib/time-zone';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const user = requireReadyUser(locals);
  return { user, timeZones: supportedTimeZones() };
};

export const actions: Actions = {
  default: async ({ locals, request }) => {
    const user = requireReadyUser(locals);
    const formData = await request.formData();
    const timeZone = normalizeTimeZone(formData.get('timeZone'));
    if (!timeZone) {
      return fail(400, {
        message: 'Choose a valid IANA time zone.',
        timeZone: String(formData.get('timeZone') ?? defaultTimeZone)
      });
    }

    const database = getDatabase();
    await database.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ timeZone, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: user.id,
        action: 'user.time_zone_changed',
        targetType: 'user',
        targetId: user.id,
        metadata: { previousTimeZone: user.timeZone, timeZone }
      });
    });

    return { success: true, message: `Time zone changed to ${timeZone}.`, timeZone };
  }
};
