import { and, asc, eq, inArray } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { parseMonitoringRange } from '$lib/monitoring-history';
import { getDatabase } from '$lib/server/db';
import { workstationAssignments, workstations } from '$lib/server/db/schema';
import { loadMonitoringHistory } from '$lib/server/monitoring/history';

import type { RequestHandler } from './$types';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumRequestedWorkstations = 100;

export const GET: RequestHandler = async ({ locals, url }) => {
  const actor = locals.user;
  if (!actor) return json({ message: 'Authentication is required.' }, { status: 401 });
  if (actor.mustChangePassword) {
    return json({ message: 'Change your password before viewing telemetry.' }, { status: 403 });
  }

  const requested = [
    ...new Set(url.searchParams.getAll('workstationId').filter((value) => value.length > 0))
  ];
  if (
    requested.length > maximumRequestedWorkstations ||
    requested.some((workstationId) => !uuidPattern.test(workstationId))
  ) {
    return json(
      { message: `Request at most ${maximumRequestedWorkstations} valid workstation IDs.` },
      { status: 400 }
    );
  }

  const database = getDatabase();
  const requestedFilter = requested.length > 0 ? inArray(workstations.id, requested) : undefined;
  const rows =
    actor.role === 'admin'
      ? await database
          .select({ id: workstations.id })
          .from(workstations)
          .where(requestedFilter)
          .orderBy(asc(workstations.name))
      : await database
          .select({ id: workstations.id })
          .from(workstationAssignments)
          .innerJoin(workstations, eq(workstationAssignments.workstationId, workstations.id))
          .where(
            and(
              eq(workstationAssignments.userId, actor.id),
              eq(workstationAssignments.status, 'active'),
              requestedFilter
            )
          )
          .orderBy(asc(workstations.name));

  const workstationIds = rows.map((row) => row.id);
  if (requested.length > 0 && workstationIds.length !== requested.length) {
    return json({ message: 'Workstation telemetry was not found.' }, { status: 404 });
  }

  return json(
    await loadMonitoringHistory(workstationIds, parseMonitoringRange(url.searchParams.get('range')))
  );
};
