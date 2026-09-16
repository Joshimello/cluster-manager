import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { auditEvents, users } from '$lib/server/db/schema';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const actors = alias(users, 'actors');

  return {
    events: await getDatabase()
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
        actorUsername: actors.username
      })
      .from(auditEvents)
      .leftJoin(actors, eq(auditEvents.actorUserId, actors.id))
      .orderBy(desc(auditEvents.createdAt))
      .limit(200)
  };
};
