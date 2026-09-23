type TimedReservation = {
  id: string;
  startAt: Date;
  endAt: Date;
};

export type WeekDay = { key: string; label: string };

export type ReservationSegment<T extends TimedReservation> = {
  reservation: T;
  startMinute: number;
  endMinute: number;
  lane: number;
  laneCount: number;
};

function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function localDateKey(date: Date, timeZone: string): string {
  return localParts(date, timeZone).key;
}

export function weekDays(todayKey: string, weekOffset = 0): WeekDay[] {
  const today = new Date(`${todayKey}T12:00:00.000Z`);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - daysSinceMonday + weekOffset * 7);
  const label = new Intl.DateTimeFormat('en-MY', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return { key: date.toISOString().slice(0, 10), label: label.format(date) };
  });
}

export function reservationSegmentsForDay<T extends TimedReservation>(
  reservations: T[],
  dayKey: string,
  timeZone: string
): ReservationSegment<T>[] {
  const segments = reservations.flatMap((reservation) => {
    const start = localParts(reservation.startAt, timeZone);
    const end = localParts(reservation.endAt, timeZone);
    if (start.key > dayKey || end.key < dayKey) return [];
    const startMinute = start.key === dayKey ? start.minute : 0;
    let endMinute = end.key === dayKey ? end.minute : 24 * 60;
    if (endMinute <= startMinute && start.key === end.key) {
      endMinute = Math.min(
        24 * 60,
        startMinute + (reservation.endAt.getTime() - reservation.startAt.getTime()) / 60_000
      );
    }
    if (endMinute <= startMinute) return [];
    return [{ reservation, startMinute, endMinute, lane: 0, laneCount: 1 }];
  });

  segments.sort((left, right) => left.startMinute - right.startMinute);
  const laneEnds: number[] = [];
  for (const segment of segments) {
    let lane = laneEnds.findIndex((endMinute) => endMinute <= segment.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = segment.endMinute;
    segment.lane = lane;
  }
  return segments.map((segment) => ({ ...segment, laneCount: laneEnds.length }));
}
