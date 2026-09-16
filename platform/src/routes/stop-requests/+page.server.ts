import { desc, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';

import { requireReadyUser } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { gpus, stopRequests, workstations } from '$lib/server/db/schema';
import {
  createStopRequestsForConflict,
  refreshPendingStopRequests
} from '$lib/server/stop-requests/service';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireReadyUser(locals);
  await refreshPendingStopRequests({ requesterUserId: user.id });
  const requests = await getDatabase()
    .select({
      id: stopRequests.id,
      status: stopRequests.status,
      requestedAt: stopRequests.requestedAt,
      resultMessage: stopRequests.resultMessage,
      workstationName: workstations.name,
      workstationDisplayName: workstations.displayName,
      gpuIndex: gpus.localIndex,
      gpuModel: gpus.model
    })
    .from(stopRequests)
    .innerJoin(gpus, eq(stopRequests.gpuId, gpus.id))
    .innerJoin(workstations, eq(stopRequests.workstationId, workstations.id))
    .where(eq(stopRequests.requesterUserId, user.id))
    .orderBy(desc(stopRequests.requestedAt))
    .limit(100);
  return { requests };
};

export const actions: Actions = {
  create: async ({ locals, request }) => {
    const actor = requireReadyUser(locals);
    const gpuId = String((await request.formData()).get('gpuId') ?? '');
    const result = await createStopRequestsForConflict({ actor, gpuId });
    if (!result.ok) return fail(result.status, { message: result.message });
    return {
      success: true,
      message: `${result.count} intervention request${result.count === 1 ? '' : 's'} created.`
    };
  }
};
