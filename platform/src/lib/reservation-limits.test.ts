import { describe, expect, it } from 'vitest';
import {
  allocateReservationSlot,
  defaultReservationPolicy as policy,
  dynamicAllowance,
  quotaWeek,
  reservationUsage,
  type QuotaBooking,
  type QuotaUsage
} from './reservation-limits';
const empty = (): QuotaUsage => ({ standardByWeek: {}, dynamicByDate: {}, overnightByWeek: {} });
const today = '2026-10-04';
const booking = (overrides: Partial<QuotaBooking> = {}): QuotaBooking => ({
  id: 'a',
  startAt: new Date('2026-10-04T08:00:00Z'),
  endAt: new Date('2026-10-04T10:00:00Z'),
  status: 'active',
  cancelledAt: null,
  quotaKind: 'standard',
  overnightSlot: false,
  isAdminOverride: false,
  ...overrides
});
describe('slot allowances', () => {
  it('uses dynamic first, falling back to standard after the date allowance is exhausted', () => {
    const usage = empty();
    expect(allocateReservationSlot(today, false, today, usage, policy)).toEqual({
      kind: 'dynamic'
    });
    usage.dynamicByDate[today] = 3;
    expect(allocateReservationSlot(today, false, today, usage, policy)).toEqual({
      kind: 'standard'
    });
    usage.standardByWeek[quotaWeek(today)] = 6;
    expect(allocateReservationSlot(today, false, today, usage, policy)).toHaveProperty('error');
    expect(allocateReservationSlot('2026-10-05', false, today, usage, policy)).toEqual({
      kind: 'dynamic'
    });
  });
  it('provides 3/2/1 allowances and carries earlier allocations forward for that date', () => {
    expect(
      [0, 1, 2, 3].map((offset) => dynamicAllowance(`2026-10-0${4 + offset}`, today, policy))
    ).toEqual([3, 2, 1, 0]);
    const usage = empty();
    usage.dynamicByDate['2026-10-05'] = 2;
    expect(allocateReservationSlot('2026-10-05', false, today, usage, policy)).toEqual({
      kind: 'standard'
    });
    expect(allocateReservationSlot('2026-10-05', false, '2026-10-05', usage, policy)).toEqual({
      kind: 'dynamic'
    });
    usage.dynamicByDate['2026-10-05'] = 3;
    expect(allocateReservationSlot('2026-10-05', false, '2026-10-05', usage, policy)).toEqual({
      kind: 'standard'
    });
  });
  it('enforces the overnight cap even when dynamic slots remain', () => {
    const usage = empty();
    usage.overnightByWeek['2026-09-28'] = 2;
    expect(allocateReservationSlot(today, true, today, usage, policy)).toHaveProperty('error');
    expect(allocateReservationSlot(today, false, today, usage, policy)).toEqual({
      kind: 'dynamic'
    });
  });
  it('handles Monday boundaries and configurable zero/custom caps', () => {
    expect(quotaWeek('2026-10-04')).toBe('2026-09-28');
    expect(quotaWeek('2026-10-05')).toBe('2026-10-05');
    expect(
      allocateReservationSlot(today, false, today, empty(), {
        ...policy,
        standardSlotsPerWeek: 0,
        dynamicSlotsToday: 0
      })
    ).toHaveProperty('error');
    expect(
      allocateReservationSlot(today, true, today, empty(), { ...policy, overnightSlotsPerWeek: 0 })
    ).toHaveProperty('error');
  });
});
describe('quota accounting', () => {
  it('counts used slots and refunds only cancellations before their start', () => {
    const usage = reservationUsage(
      [
        booking(),
        booking({ id: 'used', status: 'cancelled', cancelledAt: new Date('2026-10-04T09:00:00Z') }),
        booking({
          id: 'refund',
          status: 'cancelled',
          cancelledAt: new Date('2026-10-04T07:00:00Z')
        }),
        booking({ id: 'dynamic', quotaKind: 'dynamic', overnightSlot: true }),
        booking({ id: 'override', quotaKind: 'override', isAdminOverride: true })
      ],
      'UTC'
    );
    expect(usage).toEqual({
      standardByWeek: { '2026-09-28': 2 },
      dynamicByDate: { '2026-10-04': 1 },
      overnightByWeek: { '2026-09-28': 1 }
    });
  });
  it('charges existing reservations by occupied fixed slots across midnight and week boundaries', () => {
    const usage = reservationUsage(
      [
        booking({
          quotaKind: 'legacy',
          startAt: new Date('2026-10-04T21:00:00Z'),
          endAt: new Date('2026-10-05T05:00:00Z')
        })
      ],
      'UTC'
    );
    expect(usage.standardByWeek).toEqual({ '2026-09-28': 2, '2026-10-05': 2 });
    expect(usage.overnightByWeek).toEqual({ '2026-10-05': 2 });
  });
});
