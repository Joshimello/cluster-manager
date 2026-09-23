import { describe, expect, it } from 'vitest';

import { hourlyCalendar, isHourlyWindow } from './calendar';

describe('hourlyCalendar', () => {
  it('shows the full local day while keeping the seven-day booking horizon', () => {
    const now = new Date('2026-09-23T00:12:00.000Z');
    const days = hourlyCalendar(now, 'Asia/Kuala_Lumpur');
    const slots = days.flatMap((day) => day.slots);

    expect(days[0].key).toBe('2026-09-23');
    expect(days[0].slots).toHaveLength(24);
    expect(slots[0]).toMatchObject({
      startAt: '2026-09-22T16:00:00.000Z',
      endAt: '2026-09-22T17:00:00.000Z',
      label: '00:00–01:00'
    });
    expect(slots[9].label).toBe('09:00–10:00');
    expect(
      slots.every((slot) => Date.parse(slot.endAt) - Date.parse(slot.startAt) === 60 * 60_000)
    ).toBe(true);
    expect(Date.parse(slots.at(-1)!.startAt)).toBeLessThanOrEqual(
      now.getTime() + 7 * 24 * 60 * 60_000
    );
  });

  it('keeps repeated daylight-saving hours as separate bookable slots', () => {
    const days = hourlyCalendar(new Date('2026-11-01T04:30:00.000Z'), 'America/New_York');
    expect(days[0].slots).toHaveLength(25);
    expect(days[0].slots[1].startAt).toBe('2026-11-01T05:00:00.000Z');
    expect(days[0].slots[2].startAt).toBe('2026-11-01T06:00:00.000Z');
    expect(
      isHourlyWindow(
        new Date(days[0].slots[1].startAt),
        new Date(days[0].slots[2].endAt),
        'America/New_York'
      )
    ).toBe(true);
  });
});

describe('isHourlyWindow', () => {
  it('accepts local whole-hour slots in a 45-minute-offset time zone', () => {
    expect(
      isHourlyWindow(
        new Date('2026-09-23T06:15:00.000Z'),
        new Date('2026-09-23T07:15:00.000Z'),
        'Asia/Kathmandu'
      )
    ).toBe(true);
    expect(
      isHourlyWindow(
        new Date('2026-09-23T06:30:00.000Z'),
        new Date('2026-09-23T07:30:00.000Z'),
        'Asia/Kathmandu'
      )
    ).toBe(false);
  });
});
