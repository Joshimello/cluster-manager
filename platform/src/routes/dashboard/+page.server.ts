import { and, eq } from 'drizzle-orm';

import { requireReadyUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { workstationAssignments, workstations } from '$lib/server/db/schema';

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
      provisioningStatus: workstationAssignments.provisioningStatus,
      provisioningMessage: workstationAssignments.provisioningMessage,
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

  return { user, assignment: assignment ?? null };
};
