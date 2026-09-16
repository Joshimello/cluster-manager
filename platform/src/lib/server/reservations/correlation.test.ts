import { describe, expect, it } from 'vitest';

import { correlateGpu, reservationIsCurrent, type CurrentReservation } from './correlation';

const reservation: CurrentReservation = {
  id: 'reservation-1',
  userId: 'user-alice',
  username: 'alice',
  displayName: 'Alice',
  startAt: new Date('2026-09-16T01:00:00Z'),
  endAt: new Date('2026-09-16T02:00:00Z')
};

const process = (username: string) => ({ username });

describe('GPU reservation correlation', () => {
  it.each([
    ['available', null, []],
    ['booked-idle', reservation, []],
    ['booked-active', reservation, [process('alice')]],
    ['booked-active', reservation, [process('alice'), process('alice')]],
    ['unbooked-use', null, [process('bob')]],
    ['conflict', reservation, [process('bob')]],
    ['conflict', reservation, [process('alice'), process('bob')]],
    ['conflict', reservation, [process('unknown')]],
    ['conflict', reservation, [process('root')]]
  ] as const)('returns %s for a fresh sample', (state, current, processes) => {
    expect(correlateGpu({ telemetryState: 'online', reservation: current, processes }).state).toBe(
      state
    );
  });

  it.each(['stale', 'offline', 'never'] as const)(
    'returns unknown when telemetry is %s',
    (telemetryState) => {
      expect(correlateGpu({ telemetryState, reservation, processes: [process('bob')] }).state).toBe(
        'unknown'
      );
    }
  );

  it('reports owner and non-owner process counts for privacy-safe summaries', () => {
    expect(
      correlateGpu({
        telemetryState: 'online',
        reservation,
        processes: [process('alice'), process('alice'), process('bob'), process('unknown')]
      })
    ).toEqual({
      state: 'conflict',
      ownerProcessCount: 2,
      otherProcessCount: 2,
      processCount: 4
    });
  });

  it('uses half-open reservation boundaries', () => {
    expect(reservationIsCurrent(reservation, reservation.startAt)).toBe(true);
    expect(reservationIsCurrent(reservation, new Date('2026-09-16T01:59:59.999Z'))).toBe(true);
    expect(reservationIsCurrent(reservation, reservation.endAt)).toBe(false);
  });
});
