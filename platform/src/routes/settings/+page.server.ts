import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import { requireReadyUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { normalizeDisplayName, validateDisplayName } from '$lib/server/users/validation';
import { defaultTimeZone, normalizeTimeZone, supportedTimeZones } from '$lib/time-zone';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  const user = requireReadyUser(locals);
  return { user, timeZones: supportedTimeZones() };
};

export const actions: Actions = {
  displayName: async ({ locals, request }) => {
    const user = requireReadyUser(locals);
    const data = await request.formData();
    const displayName = normalizeDisplayName(String(data.get('displayName') ?? ''));
    const validation = validateDisplayName(displayName);
    if (validation) return fail(400, { action: 'displayName', message: validation, displayName });
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ displayName, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await recordAudit((query) => transaction.execute(query), {
        actorUserId: user.id,
        action: 'user.display_name_changed',
        targetType: 'user',
        targetId: user.id,
        metadata: { previousDisplayName: user.displayName, displayName }
      });
    });
    locals.user = { ...user, displayName };
    return { action: 'displayName', success: true, message: 'Display name updated.', displayName };
  },
  timeZone: async ({ locals, request }) => {
    const user = requireReadyUser(locals);
    const formData = await request.formData();
    const timeZone = normalizeTimeZone(formData.get('timeZone'));
    if (!timeZone) {
      return fail(400, {
        action: 'timeZone',
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

    return {
      action: 'timeZone',
      success: true,
      message: `Time zone changed to ${timeZone}.`,
      timeZone
    };
  }
};
