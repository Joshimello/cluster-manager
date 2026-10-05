import { describe, expect, it } from 'vitest';
import { slotCalendar, reservationSlot } from './calendar';

describe('fixed slot calendar', () => {
  it('shows exactly seven days including today, with two overnight and eight daytime slots', () => {
    const days = slotCalendar(new Date('2026-10-04T15:12:00Z'), 'UTC');
    expect(days.map((day) => day.key)).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10'
    ]);
    expect(days.every((day) => day.slots.length === 10)).toBe(true);
    expect(days[0].slots.map((slot) => [slot.startHour, slot.endHour])).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
      [10, 12],
      [12, 14],
      [14, 16],
      [16, 18],
      [18, 20],
      [20, 22],
      [22, 24]
    ]);
    expect(days[0].slots[0]).toMatchObject({
      startAt: '2026-10-04T00:00:00.000Z',
      endAt: '2026-10-04T04:00:00.000Z',
      overnight: true
    });
    expect(days[0].slots.at(-1)?.endAt).toBe('2026-10-05T00:00:00.000Z');
    expect(days[0].slots.filter((slot) => slot.overnight)).toHaveLength(2);
  });
  it('supports fractional-offset timezones and local day boundaries', () => {
    const days = slotCalendar(new Date('2026-10-04T20:00:00Z'), 'Asia/Kathmandu');
    expect(days[0].key).toBe('2026-10-05');
    expect(days[0].slots[2].startAt).toBe('2026-10-05T02:15:00.000Z');
    expect(
      reservationSlot(
        new Date(days[0].slots[2].startAt),
        new Date(days[0].slots[2].endAt),
        'Asia/Kathmandu'
      )
    ).not.toBeNull();
  });
  it('keeps wall-clock overnight slots across daylight-saving changes', () => {
    const spring = slotCalendar(new Date('2026-03-08T05:00:00Z'), 'America/New_York')[0].slots[0];
    const autumn = slotCalendar(new Date('2026-11-01T04:00:00Z'), 'America/New_York')[0].slots[0];
    expect(Date.parse(spring.endAt) - Date.parse(spring.startAt)).toBe(3 * 3600_000);
    expect(Date.parse(autumn.endAt) - Date.parse(autumn.startAt)).toBe(5 * 3600_000);
  });
  it('rejects partial and combined slots', () => {
    expect(
      reservationSlot(new Date('2026-10-05T09:00:00Z'), new Date('2026-10-05T11:00:00Z'), 'UTC')
    ).toBeNull();
    expect(
      reservationSlot(new Date('2026-10-05T08:00:00Z'), new Date('2026-10-05T12:00:00Z'), 'UTC')
    ).toBeNull();
  });
});
