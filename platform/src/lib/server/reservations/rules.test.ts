import { describe, expect, it } from 'vitest';

import { validateReservationWindow } from './rules';

const now = new Date('2026-09-16T04:00:00.000Z');

describe('validateReservationWindow', () => {
  it('accepts adjacent half-hour windows', () => {
    expect(
      validateReservationWindow(
        new Date('2026-09-16T04:30:00.000Z'),
        new Date('2026-09-16T06:30:00.000Z'),
        { now }
      )
    ).toBeNull();
  });

  it('enforces boundaries, direction, duration, horizon, and past starts', () => {
    expect(
      validateReservationWindow(
        new Date('2026-09-16T04:15:00.000Z'),
        new Date('2026-09-16T05:00:00.000Z'),
        { now }
      )
    ).toMatch(/30-minute/);
    expect(
      validateReservationWindow(
        new Date('2026-09-16T05:00:00.000Z'),
        new Date('2026-09-16T04:30:00.000Z'),
        { now }
      )
    ).toMatch(/after/);
    expect(
      validateReservationWindow(
        new Date('2026-09-16T04:30:00.000Z'),
        new Date('2026-09-16T11:00:00.000Z'),
        { now }
      )
    ).toMatch(/six hours/);
    expect(
      validateReservationWindow(
        new Date('2026-09-24T04:00:00.000Z'),
        new Date('2026-09-24T04:30:00.000Z'),
        { now }
      )
    ).toMatch(/seven days/);
    expect(
      validateReservationWindow(
        new Date('2026-09-16T03:30:00.000Z'),
        new Date('2026-09-16T04:30:00.000Z'),
        { now }
      )
    ).toMatch(/past/);
  });

  it('lets an explicit admin override exceed duration and horizon only', () => {
    expect(
      validateReservationWindow(
        new Date('2026-09-24T04:00:00.000Z'),
        new Date('2026-09-25T04:00:00.000Z'),
        { now, adminOverride: true }
      )
    ).toBeNull();
  });

  it('checks half-hour boundaries in the actor time zone', () => {
    expect(
      validateReservationWindow(
        new Date('2026-09-23T06:15:00.000Z'),
        new Date('2026-09-23T07:15:00.000Z'),
        { now: new Date('2026-09-23T06:00:00.000Z'), timeZone: 'Asia/Kathmandu' }
      )
    ).toBeNull();
  });
});
