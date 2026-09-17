import { and, asc, eq, gt } from 'drizzle-orm';

import { requireReadyUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { gpus, reservations, workstationAssignments, workstations } from '$lib/server/db/schema';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireReadyUser(locals);
  const [assignment] = await getDatabase()
    .select({
      id: workstationAssignments.id,
      workstationId: workstations.id,
      name: workstations.name,
      displayName: workstations.displayName,
      hostname: workstations.hostname,
      inventory: workstations.inventory,
      provisioningStatus: workstationAssignments.provisioningStatus,
      provisioningMessage: workstationAssignments.provisioningMessage,
      provisioningErrorCode: workstationAssignments.provisioningErrorCode,
      desiredGeneration: workstationAssignments.desiredGeneration,
      appliedGeneration: workstationAssignments.appliedGeneration,
      reconciledAt: workstationAssignments.reconciledAt
    })
    .from(workstationAssignments)
    .innerJoin(workstations, eq(workstationAssignments.workstationId, workstations.id))
    .where(
      and(eq(workstationAssignments.userId, user.id), eq(workstationAssignments.status, 'active'))
    )
    .limit(1);

  const upcomingReservations = await getDatabase()
    .select({
      id: reservations.id,
      gpuIndex: gpus.localIndex,
      gpuModel: gpus.model,
      startAt: reservations.startAt,
      endAt: reservations.endAt
    })
    .from(reservations)
    .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
    .where(
      and(
        eq(reservations.userId, user.id),
        eq(reservations.status, 'active'),
        gt(reservations.endAt, new Date())
      )
    )
    .orderBy(asc(reservations.startAt))
    .limit(5);

  return {
    user,
    assignment: assignment
      ? {
          ...assignment,
          inventory: assignment.inventory
            ? {
                ...assignment.inventory,
                sessions: assignment.inventory.sessions.filter(
                  (session) => session.username === user.username
                )
              }
            : null
        }
      : null,
    gpus: assignment ? await loadWorkstationGpus(assignment.workstationId, { viewer: user }) : [],
    reservations: upcomingReservations
  };
};
