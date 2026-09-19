import { defaultTimeZone } from '$lib/time-zone';

export const halfHourMilliseconds = 30 * 60_000;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
}

function partsAt(date: Date, timeZone: string): LocalParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute
  };
}

function sameParts(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

export function parseZonedDateTime(value: string, timeZone = defaultTimeZone): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired: LocalParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };
  const naive = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute
  );
  const normalized = new Date(naive);
  if (
    normalized.getUTCFullYear() !== desired.year ||
    normalized.getUTCMonth() + 1 !== desired.month ||
    normalized.getUTCDate() !== desired.day ||
    normalized.getUTCHours() !== desired.hour ||
    normalized.getUTCMinutes() !== desired.minute
  ) {
    return null;
  }

  const candidates: Date[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(naive + offsetMinutes * 60_000);
    if (sameParts(partsAt(candidate, timeZone), desired)) candidates.push(candidate);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function formatDateTimeInput(date: Date, timeZone = defaultTimeZone): string {
  const parts = partsAt(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function nextHalfHour(date = new Date()): Date {
  return new Date(Math.ceil((date.getTime() + 1) / halfHourMilliseconds) * halfHourMilliseconds);
}

export function formatReservationTime(date: Date, timeZone = defaultTimeZone): string {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}
