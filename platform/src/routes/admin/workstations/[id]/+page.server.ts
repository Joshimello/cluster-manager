import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { workstations } from '$lib/server/db/schema';
import { isWorkstationId } from '$lib/server/nodes/credentials';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';
import { presentWorkstation } from '$lib/server/nodes/presentation';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  requireAdmin(locals);
  if (!isWorkstationId(params.id)) error(404, 'Workstation not found');
  const [workstation] = await getDatabase()
    .select()
    .from(workstations)
    .where(eq(workstations.id, params.id))
    .limit(1);
  if (!workstation) error(404, 'Workstation not found');
  const gpuState = await loadWorkstationGpus(workstation.id);
  return {
    workstation: {
      ...presentWorkstation(workstation),
      connectionState: deriveConnectionState(workstation.lastHeartbeatAt)
    },
    gpus: gpuState
  };
};
