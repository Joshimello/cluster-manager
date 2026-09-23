import { describe, expect, it } from 'vitest';

import { localDateKey, reservationSegmentsForDay, weekDays } from './reservation-week';

const reservation = (id: string, startAt: string, endAt: string) => ({
  id,
  startAt: new Date(startAt),
  endAt: new Date(endAt)
});

describe('weekDays', () => {
  it('starts on Monday using the user’s local date', () => {
    expect(localDateKey(new Date('2026-09-22T16:30:00Z'), 'Asia/Taipei')).toBe('2026-09-23');
    expect(weekDays('2026-09-23').map((day) => day.key)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27'
    ]);
    expect(weekDays('2026-09-23', 1)[0].key).toBe('2026-09-28');
  });
});

describe('reservationSegmentsForDay', () => {
  it('places overlapping reservations in separate lanes at their local times', () => {
    const segments = reservationSegmentsForDay(
      [
        reservation('a', '2026-09-23T01:30:00Z', '2026-09-23T03:30:00Z'),
        reservation('b', '2026-09-23T02:00:00Z', '2026-09-23T03:00:00Z')
      ],
      '2026-09-23',
      'Asia/Taipei'
    );
    expect(
      segments.map(({ startMinute, endMinute, lane, laneCount }) => ({
        startMinute,
        endMinute,
        lane,
        laneCount
      }))
    ).toEqual([
      { startMinute: 570, endMinute: 690, lane: 0, laneCount: 2 },
      { startMinute: 600, endMinute: 660, lane: 1, laneCount: 2 }
    ]);
  });

  it('splits bookings crossing midnight and omits an empty next-day segment', () => {
    const crossing = reservation('crossing', '2026-09-23T15:30:00Z', '2026-09-23T16:30:00Z');
    const ending = reservation('ending', '2026-09-23T15:00:00Z', '2026-09-23T16:00:00Z');
    const bookings = [crossing, ending];
    expect(
      reservationSegmentsForDay(bookings, '2026-09-23', 'Asia/Taipei').map((segment) => [
        segment.reservation.id,
        segment.startMinute,
        segment.endMinute
      ])
    ).toEqual([
      ['ending', 1380, 1440],
      ['crossing', 1410, 1440]
    ]);
    expect(
      reservationSegmentsForDay(bookings, '2026-09-24', 'Asia/Taipei').map((segment) => [
        segment.reservation.id,
        segment.startMinute,
        segment.endMinute
      ])
    ).toEqual([['crossing', 0, 30]]);
  });
});
