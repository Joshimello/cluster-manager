import { describe, expect, it } from 'vitest';

import { formatDateTimeInput, nextHalfHour, parseZonedDateTime } from './time';

describe('reservation time conversion', () => {
  it('round-trips Kuala Lumpur local time to UTC', () => {
    const parsed = parseZonedDateTime('2026-09-20T14:30');
    expect(parsed?.toISOString()).toBe('2026-09-20T06:30:00.000Z');
    expect(formatDateTimeInput(parsed!)).toBe('2026-09-20T14:30');
  });

  it('rejects nonexistent and ambiguous daylight-saving local times', () => {
    expect(parseZonedDateTime('2026-03-08T02:30', 'America/New_York')).toBeNull();
    expect(parseZonedDateTime('2026-11-01T01:30', 'America/New_York')).toBeNull();
  });

  it('accepts real times on both sides of a daylight-saving transition', () => {
    expect(parseZonedDateTime('2026-03-08T01:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T06:30:00.000Z'
    );
    expect(parseZonedDateTime('2026-03-08T03:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z'
    );
  });

  it('rounds defaults up to the next boundary', () => {
    expect(nextHalfHour(new Date('2026-09-20T06:12:00Z')).toISOString()).toBe(
      '2026-09-20T06:30:00.000Z'
    );
    expect(nextHalfHour(new Date('2026-09-20T06:30:00Z')).toISOString()).toBe(
      '2026-09-20T07:00:00.000Z'
    );
  });
});
