import { defaultTimeZone } from '$lib/time-zone';
import { formatDateTimeInput } from './time';

export const normalMaximumDurationMilliseconds = 6 * 60 * 60_000;
export const normalMaximumAdvanceMilliseconds = 7 * 24 * 60 * 60_000;

export function validateReservationWindow(
  startAt: Date,
  endAt: Date,
  options: { now?: Date; adminOverride?: boolean; timeZone?: string } = {}
): string | null {
  const now = options.now ?? new Date();
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return 'Enter a valid start and end time.';
  }
  const timeZone = options.timeZone ?? defaultTimeZone;
  const aligned = (date: Date) =>
    Number(formatDateTimeInput(date, timeZone).slice(-2)) % 30 === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (!aligned(startAt) || !aligned(endAt)) {
    return 'Start and end times must align to 30-minute boundaries.';
  }
  if (endAt <= startAt) return 'End time must be after start time.';
  if (startAt < now) return 'Start time cannot be in the past.';
  if (!options.adminOverride) {
    if (endAt.getTime() - startAt.getTime() > normalMaximumDurationMilliseconds) {
      return 'Reservations may be at most six hours.';
    }
    if (startAt.getTime() - now.getTime() > normalMaximumAdvanceMilliseconds) {
      return 'Reservations may start at most seven days ahead.';
    }
  }
  return null;
}
