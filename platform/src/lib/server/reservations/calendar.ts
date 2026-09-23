const hourMilliseconds = 60 * 60_000;

export type CalendarSlot = {
  startAt: string;
  endAt: string;
  label: string;
};

export type CalendarDay = {
  key: string;
  label: string;
  slots: CalendarSlot[];
};

export function hourlyCalendar(now: Date, timeZone: string): CalendarDay[] {
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const dayLabel = new Intl.DateTimeFormat('en-MY', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  const hourLabel = new Intl.DateTimeFormat('en-MY', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    localParts.formatToParts(now).map((part) => [part.type, part.value])
  );
  const minute = Number(parts.minute);
  const firstSlot =
    now.getTime() + (60 - minute) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  const lastStart = now.getTime() + 7 * 24 * hourMilliseconds;
  const days: CalendarDay[] = [];

  for (let start = firstSlot; start <= lastStart; start += hourMilliseconds) {
    const startAt = new Date(start);
    const endAt = new Date(start + hourMilliseconds);
    const slotParts = Object.fromEntries(
      localParts.formatToParts(startAt).map((part) => [part.type, part.value])
    );
    const key = `${slotParts.year}-${slotParts.month}-${slotParts.day}`;
    let day = days[days.length - 1];
    if (day?.key !== key) {
      day = { key, label: dayLabel.format(startAt), slots: [] };
      days.push(day);
    }
    day.slots.push({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      label: `${hourLabel.format(startAt)}–${hourLabel.format(endAt)}`
    });
  }

  return days;
}

export function isHourlyWindow(startAt: Date, endAt: Date, timeZone: string): boolean {
  const localMinute = (date: Date) =>
    Number(
      new Intl.DateTimeFormat('en-GB', { timeZone, minute: '2-digit' })
        .formatToParts(date)
        .find((part) => part.type === 'minute')?.value
    );
  return (
    endAt > startAt &&
    (endAt.getTime() - startAt.getTime()) % hourMilliseconds === 0 &&
    startAt.getUTCSeconds() === 0 &&
    endAt.getUTCSeconds() === 0 &&
    startAt.getUTCMilliseconds() === 0 &&
    endAt.getUTCMilliseconds() === 0 &&
    localMinute(startAt) === 0 &&
    localMinute(endAt) === 0
  );
}
