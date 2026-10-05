import { and, eq, gt, lt } from 'drizzle-orm';
import {
  defaultReservationPolicy,
  reservationUsage,
  type ReservationPolicy
} from '$lib/reservation-limits';
import { getDatabase } from '$lib/server/db';
import { reservationPolicy, reservations } from '$lib/server/db/schema';

export type ReservationDatabase = ReturnType<typeof getDatabase>;
export type ReservationTransaction = Parameters<
  Parameters<ReservationDatabase['transaction']>[0]
>[0];

export async function loadReservationPolicy(
  database: ReservationDatabase | ReservationTransaction = getDatabase()
): Promise<ReservationPolicy> {
  const [policy] = await database
    .select()
    .from(reservationPolicy)
    .where(eq(reservationPolicy.id, 1));
  return policy ?? { ...defaultReservationPolicy };
}

export async function loadReservationUsage(
  userId: string,
  now: Date,
  policy: ReservationPolicy,
  database: ReservationDatabase | ReservationTransaction = getDatabase()
) {
  const bookings = await database
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.userId, userId),
        gt(reservations.endAt, new Date(now.getTime() - 8 * 86400_000)),
        lt(reservations.startAt, new Date(now.getTime() + 14 * 86400_000))
      )
    );
  return reservationUsage(bookings, policy.timeZone);
}
