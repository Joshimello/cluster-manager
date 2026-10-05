import { and, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import { usageDeltas } from '$lib/user-usage';
import {
  gpus,
  reservations,
  users,
  workstationAssignments,
  workstationUserUsage,
  workstations,
  type Workstation,
  type UserUsageSnapshot
} from '$lib/server/db/schema';
import type { ReservationTransaction } from '$lib/server/reservations/policy';
import type { HeartbeatReport } from './heartbeat';

export async function recordUserUsage(
  transaction: ReservationTransaction,
  workstation: Workstation,
  report: HeartbeatReport
) {
  const usernames = [
    ...new Set([
      ...report.inventory.sessions.map((entry) => entry.username),
      ...report.gpuProcesses.map((entry) => entry.username),
      ...report.userStorage.map((entry) => entry.username)
    ])
  ];
  const identities = await transaction
    .select({
      id: users.id,
      username: users.username,
      uid: users.posixUid,
      provisioningStatus: workstationAssignments.provisioningStatus
    })
    .from(users)
    .leftJoin(
      workstationAssignments,
      and(
        eq(workstationAssignments.userId, users.id),
        eq(workstationAssignments.workstationId, workstation.id)
      )
    )
    .where(
      or(
        eq(workstationAssignments.workstationId, workstation.id),
        usernames.length ? inArray(users.username, usernames) : sql`false`
      )
    );
  const byName = new Map<string, { id: string; uid: number; applied: boolean }>();
  for (const identity of identities) {
    const old = byName.get(identity.username);
    byName.set(identity.username, {
      id: identity.id,
      uid: identity.uid,
      applied: old?.applied === true || identity.provisioningStatus === 'applied'
    });
  }
  const current: UserUsageSnapshot = {
    observedAt: report.observedAt.toISOString(),
    bootId: report.bootId,
    reportIntervalSeconds: report.reportIntervalSeconds,
    gpuKnown: report.inventory.gpuStatus === 'available',
    gpuUuids: report.gpus.map((gpu) => gpu.uuid),
    users: [...byName.entries()].map(([username, identity]) => ({
      userId: identity.id,
      loggedIn: report.inventory.sessions.some(
        (session) =>
          session.username === username &&
          (session.uid === undefined ? identity.applied : session.uid === identity.uid)
      ),
      gpuUuids: [
        ...new Set(
          report.gpuProcesses
            .filter((process) => process.username === username && process.uid === identity.uid)
            .map((process) => process.gpuUuid)
        )
      ]
    }))
  };
  const previous = workstation.userUsageSnapshot;
  const bookings = previous
    ? await transaction
        .select({
          userId: reservations.userId,
          gpuUuid: gpus.gpuUuid,
          startAt: reservations.startAt,
          endAt: reservations.endAt,
          cancelledAt: reservations.cancelledAt,
          status: reservations.status
        })
        .from(reservations)
        .innerJoin(gpus, eq(gpus.id, reservations.gpuId))
        .where(
          and(
            eq(gpus.workstationId, workstation.id),
            lt(reservations.startAt, report.observedAt),
            gt(reservations.endAt, new Date(previous.observedAt))
          )
        )
    : [];
  const deltas = usageDeltas(previous, current, bookings);
  const storageById = new Map(
    report.userStorage.flatMap((storage) => {
      const identity = byName.get(storage.username);
      return identity?.uid === storage.uid ? [[identity.id, storage] as const] : [];
    })
  );
  const currentById = new Map(current.users.map((entry) => [entry.userId, entry]));
  const storageDates = storageById.size
    ? await transaction
        .select({
          userId: workstationUserUsage.userId,
          storageObservedAt: workstationUserUsage.storageObservedAt
        })
        .from(workstationUserUsage)
        .where(
          and(
            eq(workstationUserUsage.workstationId, workstation.id),
            inArray(workstationUserUsage.userId, [...storageById.keys()])
          )
        )
    : [];
  const storageDateById = new Map(
    storageDates.map((entry) => [entry.userId, entry.storageObservedAt])
  );
  const rows = [...new Set([...currentById.keys(), ...deltas.keys(), ...storageById.keys()])].map(
    (userId) => {
      const delta = deltas.get(userId) ?? {
        loginMilliseconds: 0,
        gpuMilliseconds: 0,
        bookedGpuMilliseconds: 0,
        observedScheduledMilliseconds: 0
      };
      const activity = currentById.get(userId);
      const storage = storageById.get(userId);
      const oldStorageDate = storageDateById.get(userId);
      const storageValues =
        storage && (!oldStorageDate || storage.observedAt > oldStorageDate)
          ? {
              storageBytes: storage.bytes,
              storageObservedAt: storage.observedAt,
              storageStatus: storage.status
            }
          : {};
      return {
        workstationId: workstation.id,
        userId,
        ...delta,
        firstObservedAt: report.observedAt,
        lastObservedAt: report.observedAt,
        lastLoginAt: activity?.loggedIn ? report.observedAt : null,
        lastGpuAt: activity?.gpuUuids.length ? report.observedAt : null,
        ...storageValues
      };
    }
  );
  if (rows.length)
    await transaction
      .insert(workstationUserUsage)
      .values(rows)
      .onConflictDoUpdate({
        target: [workstationUserUsage.workstationId, workstationUserUsage.userId],
        set: {
          loginMilliseconds: sql`${workstationUserUsage.loginMilliseconds} + excluded.login_milliseconds`,
          gpuMilliseconds: sql`${workstationUserUsage.gpuMilliseconds} + excluded.gpu_milliseconds`,
          bookedGpuMilliseconds: sql`${workstationUserUsage.bookedGpuMilliseconds} + excluded.booked_gpu_milliseconds`,
          observedScheduledMilliseconds: sql`${workstationUserUsage.observedScheduledMilliseconds} + excluded.observed_scheduled_milliseconds`,
          lastObservedAt: report.observedAt,
          lastLoginAt: sql`coalesce(excluded.last_login_at, ${workstationUserUsage.lastLoginAt})`,
          lastGpuAt: sql`coalesce(excluded.last_gpu_at, ${workstationUserUsage.lastGpuAt})`,
          storageBytes: sql`case when excluded.storage_observed_at is not null then excluded.storage_bytes else ${workstationUserUsage.storageBytes} end`,
          storageObservedAt: sql`coalesce(excluded.storage_observed_at, ${workstationUserUsage.storageObservedAt})`,
          storageStatus: sql`case when excluded.storage_observed_at is not null then excluded.storage_status else ${workstationUserUsage.storageStatus} end`
        }
      });
  await transaction
    .update(workstations)
    .set({
      userUsageStartedAt: workstation.userUsageStartedAt ?? report.observedAt,
      userUsageSnapshot: current
    })
    .where(eq(workstations.id, workstation.id));
}
