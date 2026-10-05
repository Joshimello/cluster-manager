import { describe, expect, it } from 'vitest';
import { validateReservationWindow } from './rules';
const now = new Date('2026-10-04T07:00:00Z');
const check = (start: string, end: string, adminOverride = false) =>
  validateReservationWindow(new Date(start), new Date(end), {
    now,
    timeZone: 'UTC',
    adminOverride
  });
describe('reservation windows', () => {
  it('accepts daytime slots, overnight slots, and a slot ending at midnight', () => {
    expect(check('2026-10-04T08:00:00Z', '2026-10-04T10:00:00Z')).toBeNull();
    expect(check('2026-10-05T00:00:00Z', '2026-10-05T04:00:00Z')).toBeNull();
    expect(check('2026-10-05T04:00:00Z', '2026-10-05T08:00:00Z')).toBeNull();
    expect(check('2026-10-04T22:00:00Z', '2026-10-05T00:00:00Z')).toBeNull();
  });
  it('enforces one exact slot and seven calendar days including today', () => {
    expect(check('2026-10-04T08:30:00Z', '2026-10-04T10:30:00Z')).toMatch(/fixed slot/);
    expect(check('2026-10-04T08:00:00Z', '2026-10-04T12:00:00Z')).toMatch(/fixed slot/);
    expect(check('2026-10-10T22:00:00Z', '2026-10-11T00:00:00Z')).toBeNull();
    expect(check('2026-10-11T08:00:00Z', '2026-10-11T10:00:00Z')).toMatch(/seven days/);
    expect(check('2026-10-04T04:00:00Z', '2026-10-04T08:00:00Z')).toMatch(/past/);
    expect(check('2026-10-04T10:00:00Z', '2026-10-04T08:00:00Z')).toMatch(/after/);
  });
  it('allows explicit admin bypasses without permitting invalid or past times', () => {
    expect(check('2026-10-14T09:15:00Z', '2026-10-15T11:00:00Z', true)).toBeNull();
    expect(check('2026-10-04T04:00:00Z', '2026-10-04T08:00:00Z', true)).toMatch(/past/);
    expect(check('invalid', '2026-10-05T08:00:00Z', true)).toMatch(/valid/);
  });
});
