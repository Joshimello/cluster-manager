import { describe, expect, it } from 'vitest';
import type { UserUsageSnapshot } from '$lib/server/db/schema';
import { usageDeltas, usageDuration, storageSize, type UsageBooking } from './user-usage';

const snapshot = (
  seconds: number,
  overrides: Partial<UserUsageSnapshot> = {}
): UserUsageSnapshot => ({
  observedAt: new Date(Date.UTC(2026, 9, 5, 0, 0, seconds)).toISOString(),
  bootId: 'boot',
  reportIntervalSeconds: 15,
  gpuKnown: true,
  gpuUuids: ['gpu-a', 'gpu-b'],
  users: [{ userId: 'alice', loggedIn: true, gpuUuids: ['gpu-a', 'gpu-a', 'gpu-b'] }],
  ...overrides
});
const booking = (overrides: Partial<UsageBooking> = {}): UsageBooking => ({
  userId: 'alice',
  gpuUuid: 'gpu-a',
  startAt: new Date(snapshot(5).observedAt),
  endAt: new Date(snapshot(15).observedAt),
  status: 'active',
  cancelledAt: null,
  ...overrides
});

describe('observed user usage', () => {
  it('counts simultaneous sessions once and each occupied GPU once, splitting time at reservation boundaries', () => {
    expect(usageDeltas(snapshot(0), snapshot(20), [booking()]).get('alice')).toEqual({
      loginMilliseconds: 20000,
      gpuMilliseconds: 40000,
      bookedGpuMilliseconds: 10000,
      observedScheduledMilliseconds: 10000
    });
  });
  it('holds the previous observation until the next sample and excludes cancelled portions', () => {
    const current = snapshot(20, { users: [{ userId: 'alice', loggedIn: false, gpuUuids: [] }] });
    const result = usageDeltas(snapshot(0), current, [
      booking({ status: 'cancelled', cancelledAt: new Date(snapshot(10).observedAt) })
    ]);
    expect(result.get('alice')).toEqual({
      loginMilliseconds: 20000,
      gpuMilliseconds: 40000,
      bookedGpuMilliseconds: 5000,
      observedScheduledMilliseconds: 5000
    });
    expect(
      usageDeltas(snapshot(0), snapshot(20), [
        booking({ status: 'cancelled', cancelledAt: new Date(snapshot(0).observedAt) })
      ]).get('alice')?.observedScheduledMilliseconds
    ).toBe(0);
  });
  it('does not extrapolate through missing GPU telemetry, disappearances, reboots, duplicates, or large gaps', () => {
    expect(
      usageDeltas(snapshot(0), snapshot(20, { gpuKnown: false }), [booking()]).get('alice')
    ).toMatchObject({
      loginMilliseconds: 20000,
      gpuMilliseconds: 0,
      observedScheduledMilliseconds: 0
    });
    expect(
      usageDeltas(snapshot(0), snapshot(20, { gpuUuids: [] }), [booking()]).get('alice')
        ?.gpuMilliseconds
    ).toBe(0);
    for (const current of [
      snapshot(0),
      snapshot(-1),
      snapshot(121),
      snapshot(20, { bootId: 'reboot' })
    ])
      expect(usageDeltas(snapshot(0), current, [booking()]).size).toBe(0);
    expect(usageDeltas(null, snapshot(0), []).size).toBe(0);
    expect(
      usageDeltas(
        snapshot(0, { reportIntervalSeconds: 600 }),
        snapshot(600, { reportIntervalSeconds: 600 }),
        []
      ).get('alice')?.loginMilliseconds
    ).toBe(600000);
  });
  it('does not infer newly appearing activity before it was first observed', () => {
    expect(usageDeltas(snapshot(0, { users: [] }), snapshot(20), []).get('alice')).toMatchObject({
      loginMilliseconds: 0,
      gpuMilliseconds: 0
    });
  });
  it('formats durations and allocated storage without confusing unknown values with zero', () => {
    expect(usageDuration(0)).toBe('0m');
    expect(usageDuration(5000)).toBe('<1m');
    expect(usageDuration(5400000)).toBe('1h 30m');
    expect(storageSize(0)).toBe('0 B');
    expect(storageSize(1024 ** 3)).toBe('1.0 GiB');
  });
});
