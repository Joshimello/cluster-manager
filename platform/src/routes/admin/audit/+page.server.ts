import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { auditEvents, users } from '$lib/server/db/schema';

import type { PageServerLoad } from './$types';

function validDate(value: string, endOfDay = false): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  const actors = alias(users, 'actors');
  const query = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  const actionValue = url.searchParams.get('action')?.trim().slice(0, 100) ?? '';
  const action = actionValue === 'all' ? '' : actionValue;
  const actor = url.searchParams.get('actor')?.trim().slice(0, 32) ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = 100;
  const filters: SQL[] = [];
  if (query) {
    const pattern = `%${query}%`;
    filters.push(
      or(
        ilike(auditEvents.action, pattern),
        ilike(auditEvents.targetType, pattern),
        ilike(auditEvents.targetId, pattern),
        sql`${auditEvents.metadata}::text ilike ${pattern}`
      )!
    );
  }
  if (action) filters.push(eq(auditEvents.action, action));
  if (actor) filters.push(ilike(actors.username, `%${actor}%`));
  const fromDate = validDate(from);
  const toDate = validDate(to, true);
  if (fromDate) filters.push(gte(auditEvents.createdAt, fromDate));
  if (toDate) filters.push(lte(auditEvents.createdAt, toDate));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const database = getDatabase();
  const [events, totals, actions] = await Promise.all([
    database
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
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database
      .select({ count: count() })
      .from(auditEvents)
      .leftJoin(actors, eq(auditEvents.actorUserId, actors.id))
      .where(where),
    database
      .selectDistinct({ action: auditEvents.action })
      .from(auditEvents)
      .orderBy(asc(auditEvents.action))
  ]);

  const total = totals[0]?.count ?? 0;
  const pageUrl = (nextPage: number) => {
    const parameters = new URLSearchParams(url.searchParams);
    parameters.set('page', String(nextPage));
    return `?${parameters.toString()}`;
  };

  return {
    events,
    actions,
    filters: { query, action, actor, from, to },
    pagination: {
      page,
      pageSize,
      total,
      previous: page > 1 ? pageUrl(page - 1) : null,
      next: page * pageSize < total ? pageUrl(page + 1) : null
    }
  };
};
