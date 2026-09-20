import { and, asc, eq, gt, lte } from 'drizzle-orm';

import { getDatabase } from '$lib/server/db';
import {
  gpuObservations,
  gpuProcessObservations,
  gpus,
  reservations,
  users
} from '$lib/server/db/schema';
import {
  correlateGpu,
  type CoordinationState,
  type CurrentReservation
} from '$lib/server/reservations/correlation';

import { deriveConnectionState, type ConnectionState } from './heartbeat';

export type GpuProcessView = {
  id: string;
  pid: number;
  uid: number;
  username: string;
  command: string;
  memoryUsedBytes: number;
  processStartTicks: number | null;
};

export type GpuMonitoringView = {
  id: string;
  uuid: string;
  index: number;
  model: string;
  observedAt: Date;
  telemetryState: ConnectionState;
  utilizationPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  temperatureC: number | null;
  powerWatts: number | null;
  coordinationState: CoordinationState;
  processCount: number;
  ownerProcessCount: number;
  otherProcessCount: number;
  reservation: null | {
    id: string;
    ownerLabel: string;
    username: string | null;
    startAt: Date;
    endAt: Date;
    isViewer: boolean;
  };
  processes: GpuProcessView[];
};

type Viewer = { id: string; username: string; role: 'user' | 'admin' };

export async function loadWorkstationGpus(
  workstationId: string,
  options: { viewer?: Viewer; now?: Date } = {}
): Promise<GpuMonitoringView[]> {
  const now = options.now ?? new Date();
  const rows = await getDatabase()
    .select({
      id: gpus.id,
      uuid: gpus.gpuUuid,
      index: gpus.localIndex,
      model: gpus.model,
      observedAt: gpus.lastObservedAt,
      utilizationPercent: gpus.utilizationPercent,
      memoryUsedBytes: gpus.memoryUsedBytes,
      memoryTotalBytes: gpus.memoryTotalBytes,
      temperatureC: gpus.temperatureC,
      powerWatts: gpus.powerWatts,
      processId: gpuProcessObservations.id,
      pid: gpuProcessObservations.pid,
      uid: gpuProcessObservations.uid,
      username: gpuProcessObservations.username,
      command: gpuProcessObservations.command,
      processMemoryUsedBytes: gpuProcessObservations.memoryUsedBytes,
      processStartTicks: gpuProcessObservations.processStartTicks,
      reservationId: reservations.id,
      reservationUserId: reservations.userId,
      reservationStartAt: reservations.startAt,
      reservationEndAt: reservations.endAt,
      reservationUsername: users.username,
      reservationDisplayName: users.displayName
    })
    .from(gpus)
    .leftJoin(
      gpuObservations,
      and(eq(gpuObservations.gpuId, gpus.id), eq(gpuObservations.observedAt, gpus.lastObservedAt))
    )
    .leftJoin(gpuProcessObservations, eq(gpuProcessObservations.observationId, gpuObservations.id))
    .leftJoin(
      reservations,
      and(
        eq(reservations.gpuId, gpus.id),
        eq(reservations.status, 'active'),
        lte(reservations.startAt, now),
        gt(reservations.endAt, now)
      )
    )
    .leftJoin(users, eq(reservations.userId, users.id))
    .where(and(eq(gpus.workstationId, workstationId), eq(gpus.active, true)))
    .orderBy(asc(gpus.localIndex), asc(gpuProcessObservations.pid));

  const byId = new Map<
    string,
    {
      id: string;
      uuid: string;
      index: number;
      model: string;
      observedAt: Date;
      telemetryState: ConnectionState;
      utilizationPercent: number;
      memoryUsedBytes: number;
      memoryTotalBytes: number;
      temperatureC: number | null;
      powerWatts: number | null;
      reservation: CurrentReservation | null;
      processes: GpuProcessView[];
    }
  >();

  for (const row of rows) {
    let gpu = byId.get(row.id);
    if (!gpu) {
      gpu = {
        id: row.id,
        uuid: row.uuid,
        index: row.index,
        model: row.model,
        observedAt: row.observedAt,
        telemetryState: deriveConnectionState(row.observedAt, now),
        utilizationPercent: row.utilizationPercent,
        memoryUsedBytes: row.memoryUsedBytes,
        memoryTotalBytes: row.memoryTotalBytes,
        temperatureC: row.temperatureC,
        powerWatts: row.powerWatts,
        reservation:
          row.reservationId &&
          row.reservationUserId &&
          row.reservationStartAt &&
          row.reservationEndAt &&
          row.reservationUsername &&
          row.reservationDisplayName
            ? {
                id: row.reservationId,
                userId: row.reservationUserId,
                username: row.reservationUsername,
                displayName: row.reservationDisplayName,
                startAt: row.reservationStartAt,
                endAt: row.reservationEndAt
              }
            : null,
        processes: []
      };
      byId.set(row.id, gpu);
    }
    if (
      row.processId &&
      row.pid !== null &&
      row.uid !== null &&
      row.username !== null &&
      row.command !== null &&
      row.processMemoryUsedBytes !== null
    ) {
      gpu.processes.push({
        id: row.processId,
        pid: row.pid,
        uid: row.uid,
        username: row.username,
        command: row.command,
        memoryUsedBytes: row.processMemoryUsedBytes,
        processStartTicks: row.processStartTicks
      });
    }
  }

  return [...byId.values()].map((gpu) => {
    const correlation = correlateGpu({
      telemetryState: gpu.telemetryState,
      reservation: gpu.reservation,
      processes: gpu.processes
    });
    const viewer = options.viewer;
    const isAdmin = viewer?.role === 'admin' || viewer === undefined;
    const isViewer = gpu.reservation?.userId === viewer?.id;
    const processes = isAdmin
      ? gpu.processes
      : gpu.processes.filter((process) => process.username === viewer?.username);

    return {
      ...gpu,
      coordinationState: correlation.state,
      processCount: correlation.processCount,
      ownerProcessCount: correlation.ownerProcessCount,
      otherProcessCount: correlation.otherProcessCount,
      reservation: gpu.reservation
        ? {
            id: gpu.reservation.id,
            ownerLabel: isAdmin ? gpu.reservation.displayName : isViewer ? 'You' : 'Reserved user',
            username: isAdmin || isViewer ? gpu.reservation.username : null,
            startAt: gpu.reservation.startAt,
            endAt: gpu.reservation.endAt,
            isViewer
          }
        : null,
      processes
    };
  });
}
