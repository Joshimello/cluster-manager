export const defaultTimeZone = 'UTC';

export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 64) return null;

  try {
    return new Intl.DateTimeFormat('en', { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function supportedTimeZones(): string[] {
  const values = Intl.supportedValuesOf('timeZone');
  return [defaultTimeZone, ...values.filter((value) => value !== defaultTimeZone)];
}
