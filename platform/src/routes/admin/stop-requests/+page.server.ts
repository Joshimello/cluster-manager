import { desc, eq } from 'drizzle-orm';

import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { gpus, stopRequests, users, workstations } from '$lib/server/db/schema';
import {
  expireTerminationInstructions,
  refreshPendingStopRequests
} from '$lib/server/stop-requests/service';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  await refreshPendingStopRequests();
  await expireTerminationInstructions();
  const requests = await getDatabase()
    .select({
      id: stopRequests.id,
      status: stopRequests.status,
      requestedAt: stopRequests.requestedAt,
      requesterUsername: users.username,
      requesterDisplayName: users.displayName,
      workstationName: workstations.name,
      workstationDisplayName: workstations.displayName,
      gpuIndex: gpus.localIndex,
      targetPid: stopRequests.targetPid,
      targetUid: stopRequests.targetUid,
      targetUsername: stopRequests.targetUsername,
      targetCommand: stopRequests.targetCommand
    })
    .from(stopRequests)
    .innerJoin(users, eq(stopRequests.requesterUserId, users.id))
    .innerJoin(gpus, eq(stopRequests.gpuId, gpus.id))
    .innerJoin(workstations, eq(stopRequests.workstationId, workstations.id))
    .orderBy(desc(stopRequests.requestedAt))
    .limit(200);
  return {
    requests,
    actionableCount: requests.filter(
      (request) => request.status === 'pending' || request.status === 'termination_requested'
    ).length
  };
};
