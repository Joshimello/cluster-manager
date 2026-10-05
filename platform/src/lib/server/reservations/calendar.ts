import { addDays, slotBoundaries } from '$lib/reservation-limits';
import { localDateKey } from '$lib/reservation-week';
import { formatDateTimeInput, parseZonedDateTime } from './time';

export type CalendarSlot = {
  startAt: string;
  endAt: string;
  label: string;
  overnight: boolean;
  startHour: number;
  endHour: number;
};
export type CalendarDay = { key: string; label: string; slots: CalendarSlot[] };

export function slotCalendar(now: Date, timeZone: string, days = 7): CalendarDay[] {
  const today = localDateKey(now, timeZone);
  const label = new Intl.DateTimeFormat('en-MY', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  return Array.from({ length: days }, (_, offset) => {
    const key = addDays(today, offset);
    const slots = slotBoundaries.slice(0, -1).flatMap((hour, index) => {
      const endHour = slotBoundaries[index + 1];
      const startAt = parseZonedDateTime(`${key}T${String(hour).padStart(2, '0')}:00`, timeZone);
      const endAt = parseZonedDateTime(
        `${endHour === 24 ? addDays(key, 1) : key}T${String(endHour % 24).padStart(2, '0')}:00`,
        timeZone
      );
      if (!startAt || !endAt || endAt <= startAt) return [];
      return [
        {
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          overnight: hour < 8,
          startHour: hour,
          endHour,
          label: `${String(hour).padStart(2, '0')}:00–${endHour === 24 ? '24:00' : `${String(endHour).padStart(2, '0')}:00`}`
        }
      ];
    });
    return { key, label: label.format(new Date(`${key}T12:00:00Z`)), slots };
  });
}

export function reservationSlot(startAt: Date, endAt: Date, timeZone: string): CalendarSlot | null {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) return null;
  const start = formatDateTimeInput(startAt, timeZone);
  const hour = Number(start.slice(11, 13));
  if (!slotBoundaries.slice(0, -1).includes(hour)) return null;
  return (
    slotCalendar(startAt, timeZone, 1)[0].slots.find(
      (slot) =>
        Date.parse(slot.startAt) === startAt.getTime() && Date.parse(slot.endAt) === endAt.getTime()
    ) ?? null
  );
}
