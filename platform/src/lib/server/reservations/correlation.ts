import type { ConnectionState } from '$lib/server/nodes/heartbeat';

export const coordinationStates = [
  'available',
  'booked-idle',
  'booked-active',
  'unbooked-use',
  'conflict',
  'unknown'
] as const;

export type CoordinationState = (typeof coordinationStates)[number];

export type CurrentReservation = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  startAt: Date;
  endAt: Date;
};

export type CorrelationProcess = {
  username: string;
};

export type CorrelationResult = {
  state: CoordinationState;
  ownerProcessCount: number;
  otherProcessCount: number;
  processCount: number;
};

/**
 * Derive coordination state only from fresh process observations and an active reservation.
 * Utilization is intentionally absent: a percentage cannot establish process ownership.
 */
export function correlateGpu(input: {
  telemetryState: ConnectionState;
  reservation: CurrentReservation | null;
  processes: readonly CorrelationProcess[];
}): CorrelationResult {
  const processCount = input.processes.length;
  const ownerProcessCount = input.reservation
    ? input.processes.filter((process) => process.username === input.reservation?.username).length
    : 0;
  const otherProcessCount = processCount - ownerProcessCount;

  if (input.telemetryState !== 'online') {
    return { state: 'unknown', ownerProcessCount, otherProcessCount, processCount };
  }
  if (!input.reservation) {
    return {
      state: processCount === 0 ? 'available' : 'unbooked-use',
      ownerProcessCount,
      otherProcessCount,
      processCount
    };
  }
  if (processCount === 0) {
    return { state: 'booked-idle', ownerProcessCount, otherProcessCount, processCount };
  }
  return {
    state: otherProcessCount === 0 ? 'booked-active' : 'conflict',
    ownerProcessCount,
    otherProcessCount,
    processCount
  };
}

export function reservationIsCurrent(
  reservation: Pick<CurrentReservation, 'startAt' | 'endAt'>,
  now: Date
) {
  return reservation.startAt <= now && now < reservation.endAt;
}
