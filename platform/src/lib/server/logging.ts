export type LogLevel = 'info' | 'warn' | 'error';

export function structuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, boolean | number | string | null> = {}
): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
