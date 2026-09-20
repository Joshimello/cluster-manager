import { asc } from 'drizzle-orm';

import { parseMonitoringRange } from '$lib/monitoring-history';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { workstations } from '$lib/server/db/schema';
import { loadWorkstationGpus } from '$lib/server/nodes/gpu-monitoring';
import { deriveConnectionState } from '$lib/server/nodes/heartbeat';
import { coordinationStates, type CoordinationState } from '$lib/server/reservations/correlation';

import type { PageServerLoad } from './$types';

type Filter = CoordinationState | 'all';

function parseFilter(value: string | null): Filter {
  return value && coordinationStates.includes(value as CoordinationState)
    ? (value as CoordinationState)
    : 'all';
}

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  const filter = parseFilter(url.searchParams.get('state'));
  const workstationRows = await getDatabase()
    .select({
      id: workstations.id,
      name: workstations.name,
      displayName: workstations.displayName,
      lastHeartbeatAt: workstations.lastHeartbeatAt,
      inventoryObservedAt: workstations.inventoryObservedAt,
      inventory: workstations.inventory
    })
    .from(workstations)
    .orderBy(asc(workstations.name));

  const complete = await Promise.all(
    workstationRows.map(async (workstation) => ({
      ...workstation,
      gpus: await loadWorkstationGpus(workstation.id)
    }))
  );
  const allGpus = complete.flatMap((workstation) => workstation.gpus);
  const summaries = Object.fromEntries(
    coordinationStates.map((state) => [
      state,
      allGpus.filter((gpu) => gpu.coordinationState === state).length
    ])
  ) as Record<CoordinationState, number>;

  return {
    filter,
    range: parseMonitoringRange(url.searchParams.get('range')),
    total: allGpus.length,
    summaries,
    workstations: complete
      .map((workstation) => ({
        ...workstation,
        connectionState: deriveConnectionState(workstation.lastHeartbeatAt),
        gpus:
          filter === 'all'
            ? workstation.gpus
            : workstation.gpus.filter((gpu) => gpu.coordinationState === filter)
      }))
      .filter((workstation) => workstation.gpus.length > 0)
  };
};
