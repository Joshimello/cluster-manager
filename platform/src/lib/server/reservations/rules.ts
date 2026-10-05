import { addDays } from '$lib/reservation-limits';
import { localDateKey } from '$lib/reservation-week';
import { defaultTimeZone } from '$lib/time-zone';
import { reservationSlot } from './calendar';

export function validateReservationWindow(
  startAt: Date,
  endAt: Date,
  options: { now?: Date; adminOverride?: boolean; timeZone?: string } = {}
): string | null {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? defaultTimeZone;
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()))
    return 'Enter a valid start and end time.';
  if (endAt <= startAt) return 'End time must be after start time.';
  if (startAt < now) return 'Start time cannot be in the past.';
  if (options.adminOverride) {
    if (
      [startAt, endAt].some((date) => date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0)
    )
      return 'Choose whole-minute times.';
    return null;
  }
  if (!reservationSlot(startAt, endAt, timeZone))
    return 'Choose one fixed slot: four hours from midnight to 08:00, or two hours from 08:00 to midnight.';
  if (localDateKey(startAt, timeZone) > addDays(localDateKey(now, timeZone), 6))
    return 'Choose a slot within the seven days including today.';
  return null;
}
