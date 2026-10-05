import type { UserUsageSnapshot } from '$lib/server/db/schema';

export type UsageBooking = {
  userId: string;
  gpuUuid: string;
  startAt: Date;
  endAt: Date;
  cancelledAt: Date | null;
  status: string;
};
export type UsageDelta = {
  loginMilliseconds: number;
  gpuMilliseconds: number;
  bookedGpuMilliseconds: number;
  observedScheduledMilliseconds: number;
};

export function usageDeltas(
  previous: UserUsageSnapshot | null,
  current: UserUsageSnapshot,
  bookings: UsageBooking[]
) {
  const result = new Map<string, UsageDelta>();
  if (!previous || previous.bootId !== current.bootId) return result;
  const start = Date.parse(previous.observedAt),
    end = Date.parse(current.observedAt);
  const duration = end - start;
  const maximumGap =
    Math.max(120, Math.max(previous.reportIntervalSeconds, current.reportIntervalSeconds) * 3) *
    1000;
  if (!Number.isFinite(duration) || duration <= 0 || duration > maximumGap) return result;
  const oldUsers = new Map(previous.users.map((user) => [user.userId, user]));
  const deltaFor = (userId: string) => {
    let delta = result.get(userId);
    if (!delta) {
      delta = {
        loginMilliseconds: 0,
        gpuMilliseconds: 0,
        bookedGpuMilliseconds: 0,
        observedScheduledMilliseconds: 0
      };
      result.set(userId, delta);
    }
    return delta;
  };
  const gpuKnown = previous.gpuKnown && current.gpuKnown;
  const available = new Set(current.gpuUuids.filter((uuid) => previous.gpuUuids.includes(uuid)));
  const overlap = (booking: UsageBooking) => {
    const effectiveEnd =
      booking.status === 'cancelled'
        ? (booking.cancelledAt?.getTime() ?? booking.startAt.getTime())
        : booking.endAt.getTime();
    return Math.max(
      0,
      Math.min(end, booking.endAt.getTime(), effectiveEnd) -
        Math.max(start, booking.startAt.getTime())
    );
  };
  for (const userId of new Set([...oldUsers.keys(), ...current.users.map((user) => user.userId)])) {
    const old = oldUsers.get(userId);
    const delta = deltaFor(userId);
    if (old?.loggedIn) delta.loginMilliseconds = duration;
    if (!gpuKnown) continue;
    const occupied = new Set((old?.gpuUuids ?? []).filter((uuid) => available.has(uuid)));
    delta.gpuMilliseconds = occupied.size * duration;
    for (const booking of bookings) {
      if (booking.userId === userId && occupied.has(booking.gpuUuid))
        delta.bookedGpuMilliseconds += overlap(booking);
    }
  }
  if (gpuKnown)
    for (const booking of bookings) {
      if (available.has(booking.gpuUuid))
        deltaFor(booking.userId).observedScheduledMilliseconds += overlap(booking);
    }
  return result;
}

export function usageDuration(milliseconds: number): string {
  if (milliseconds <= 0) return '0m';
  if (milliseconds < 60000) return '<1m';
  const minutes = Math.floor(milliseconds / 60000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function storageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
