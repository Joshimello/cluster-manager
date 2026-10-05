import { localDateKey, reservationSegmentsForDay } from '$lib/reservation-week';

export const defaultReservationPolicy = {
  standardSlotsPerWeek: 6,
  dynamicSlotsToday: 3,
  dynamicSlotsTomorrow: 2,
  dynamicSlotsDayAfter: 1,
  overnightSlotsPerWeek: 2,
  timeZone: 'UTC'
};
export type ReservationPolicy = typeof defaultReservationPolicy;
export const slotBoundaries = [0, 4, 8, 10, 12, 14, 16, 18, 20, 22, 24];

export function addDays(key: string, count: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function quotaWeek(key: string): string {
  const date = new Date(`${key}T12:00:00Z`);
  return addDays(key, -((date.getUTCDay() + 6) % 7));
}

export type QuotaBooking = {
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  cancelledAt: Date | null;
  quotaKind: string;
  overnightSlot: boolean;
  isAdminOverride: boolean;
};
export type QuotaUsage = {
  standardByWeek: Record<string, number>;
  dynamicByDate: Record<string, number>;
  overnightByWeek: Record<string, number>;
};

export function reservationUsage(bookings: QuotaBooking[], timeZone: string): QuotaUsage {
  const usage: QuotaUsage = { standardByWeek: {}, dynamicByDate: {}, overnightByWeek: {} };
  const increment = (counts: Record<string, number>, key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  for (const booking of bookings) {
    if (booking.isAdminOverride || booking.quotaKind === 'override') continue;
    // Refund cancellations before the start; already-used slots still count.
    if (
      booking.status === 'cancelled' &&
      (!booking.cancelledAt || booking.cancelledAt <= booking.startAt)
    )
      continue;
    const date = localDateKey(booking.startAt, timeZone);
    if (booking.quotaKind !== 'legacy') {
      if (booking.quotaKind === 'dynamic') increment(usage.dynamicByDate, date);
      else increment(usage.standardByWeek, quotaWeek(date));
      if (booking.overnightSlot) increment(usage.overnightByWeek, quotaWeek(date));
      continue;
    }
    // Existing bookings keep their times; each occupied new slot counts.
    const lastDate = localDateKey(booking.endAt, timeZone);
    for (let key = date; key <= lastDate; key = addDays(key, 1)) {
      const segment = reservationSegmentsForDay([booking], key, timeZone)[0];
      if (!segment) continue;
      for (let index = 0; index < slotBoundaries.length - 1; index++) {
        if (
          segment.startMinute < slotBoundaries[index + 1] * 60 &&
          segment.endMinute > slotBoundaries[index] * 60
        ) {
          increment(usage.standardByWeek, quotaWeek(key));
          if (slotBoundaries[index] < 8) increment(usage.overnightByWeek, quotaWeek(key));
        }
      }
    }
  }
  return usage;
}

export function dynamicAllowance(date: string, today: string, policy: ReservationPolicy): number {
  if (date === today) return policy.dynamicSlotsToday;
  if (date === addDays(today, 1)) return policy.dynamicSlotsTomorrow;
  if (date === addDays(today, 2)) return policy.dynamicSlotsDayAfter;
  return 0;
}

export function allocateReservationSlot(
  date: string,
  overnight: boolean,
  today: string,
  usage: QuotaUsage,
  policy: ReservationPolicy
): { kind: 'dynamic' | 'standard' } | { error: string } {
  const week = quotaWeek(date);
  if (overnight && (usage.overnightByWeek[week] ?? 0) >= policy.overnightSlotsPerWeek)
    return {
      error: `The overnight limit of ${policy.overnightSlotsPerWeek} slots for this week has been reached.`
    };
  if ((usage.dynamicByDate[date] ?? 0) < dynamicAllowance(date, today, policy))
    return { kind: 'dynamic' };
  if ((usage.standardByWeek[week] ?? 0) < policy.standardSlotsPerWeek) return { kind: 'standard' };
  return {
    error: `The standard limit of ${policy.standardSlotsPerWeek} slots for this week has been reached, and no dynamic slots remain for this date.`
  };
}
