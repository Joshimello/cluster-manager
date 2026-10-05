import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDatabase } from '$lib/server/db';
import {
  gpus,
  reservations,
  users,
  workstationAssignments,
  workstationUserUsage,
  type Workstation
} from '$lib/server/db/schema';
import type { GpuMonitoringView } from './gpu-monitoring';

export async function loadWorkstationUsers(
  workstation: Workstation,
  gpuState: GpuMonitoringView[],
  now = new Date()
) {
  const database = getDatabase();
  const effectiveEnd = sql`least(${reservations.endAt}, case when ${reservations.status} = 'cancelled' then coalesce(${reservations.cancelledAt}, ${reservations.startAt}) else ${reservations.endAt} end)`;
  const [accounts, assignments, schedules] = await Promise.all([
    database
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
        deletedAt: users.deletedAt,
        uid: users.posixUid,
        loginMilliseconds: workstationUserUsage.loginMilliseconds,
        gpuMilliseconds: workstationUserUsage.gpuMilliseconds,
        bookedGpuMilliseconds: workstationUserUsage.bookedGpuMilliseconds,
        observedScheduledMilliseconds: workstationUserUsage.observedScheduledMilliseconds,
        firstObservedAt: workstationUserUsage.firstObservedAt,
        lastObservedAt: workstationUserUsage.lastObservedAt,
        lastLoginAt: workstationUserUsage.lastLoginAt,
        lastGpuAt: workstationUserUsage.lastGpuAt,
        storageBytes: workstationUserUsage.storageBytes,
        storageObservedAt: workstationUserUsage.storageObservedAt,
        storageStatus: workstationUserUsage.storageStatus
      })
      .from(users)
      .leftJoin(
        workstationUserUsage,
        and(
          eq(workstationUserUsage.userId, users.id),
          eq(workstationUserUsage.workstationId, workstation.id)
        )
      )
      .where(sql`${users.deletedAt} is null or ${workstationUserUsage.userId} is not null`)
      .orderBy(asc(users.username)),
    database
      .select()
      .from(workstationAssignments)
      .where(eq(workstationAssignments.workstationId, workstation.id))
      .orderBy(desc(workstationAssignments.assignedAt)),
    database
      .select({
        userId: reservations.userId,
        scheduledMilliseconds: sql<number>`coalesce(sum(greatest(0, extract(epoch from (least(${effectiveEnd}, ${now.toISOString()}::timestamptz) - ${reservations.startAt})) * 1000)), 0)::double precision`,
        upcomingMilliseconds: sql<number>`coalesce(sum(case when ${reservations.status} = 'active' then greatest(0, extract(epoch from (${reservations.endAt} - greatest(${reservations.startAt}, ${now.toISOString()}::timestamptz))) * 1000) else 0 end), 0)::double precision`,
        bookingCount: sql<number>`count(*)::integer`,
        cancelledBookingCount: sql<number>`count(*) filter (where ${reservations.status} = 'cancelled')::integer`
      })
      .from(reservations)
      .innerJoin(gpus, eq(gpus.id, reservations.gpuId))
      .where(eq(gpus.workstationId, workstation.id))
      .groupBy(reservations.userId)
  ]);
  const scheduleByUser = new Map(schedules.map((entry) => [entry.userId, entry]));
  const fresh =
    workstation.lastHeartbeatAt !== null &&
    workstation.inventoryObservedAt !== null &&
    now.getTime() - workstation.lastHeartbeatAt.getTime() <= 45000 &&
    now.getTime() - workstation.inventoryObservedAt.getTime() <= 45000;
  return accounts.map((account) => {
    const assignment =
      assignments.find((entry) => entry.userId === account.id && entry.status === 'active') ??
      assignments.find((entry) => entry.userId === account.id);
    const liveGpus = gpuState.filter((gpu) => gpu.telemetryState === 'online');
    const currentProcesses = liveGpus.flatMap((gpu) =>
      gpu.processes.filter(
        (process) => process.username === account.username && process.uid === account.uid
      )
    );
    const currentGpuCount = liveGpus.filter((gpu) =>
      gpu.processes.some(
        (process) => process.username === account.username && process.uid === account.uid
      )
    ).length;
    const currentSessions = fresh
      ? (workstation.inventory?.sessions.filter(
          (session) =>
            session.username === account.username &&
            (session.uid === undefined
              ? assignment?.provisioningStatus === 'applied'
              : session.uid === account.uid)
        ).length ?? 0)
      : null;
    const schedule = scheduleByUser.get(account.id);
    const lastActivityAt =
      [account.lastLoginAt, account.lastGpuAt]
        .filter((value): value is Date => value !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      ...account,
      assignmentStatus: assignment?.status ?? 'unassigned',
      provisioningStatus: assignment?.provisioningStatus ?? null,
      currentSessions,
      currentGpuCount:
        fresh && workstation.inventory?.gpuStatus === 'available' ? currentGpuCount : null,
      currentProcessCount:
        fresh && workstation.inventory?.gpuStatus === 'available' ? currentProcesses.length : null,
      currentVramBytes:
        fresh && workstation.inventory?.gpuStatus === 'available'
          ? currentProcesses.reduce((total, process) => total + process.memoryUsedBytes, 0)
          : null,
      scheduledMilliseconds: schedule?.scheduledMilliseconds ?? 0,
      upcomingMilliseconds: schedule?.upcomingMilliseconds ?? 0,
      bookingCount: schedule?.bookingCount ?? 0,
      cancelledBookingCount: schedule?.cancelledBookingCount ?? 0,
      bookingUsagePercent: account.observedScheduledMilliseconds
        ? Math.min(
            100,
            ((account.bookedGpuMilliseconds ?? 0) / account.observedScheduledMilliseconds) * 100
          )
        : null,
      outsideBookingMilliseconds:
        account.gpuMilliseconds === null
          ? null
          : Math.max(0, account.gpuMilliseconds - (account.bookedGpuMilliseconds ?? 0)),
      lastActivityAt,
      storageStale:
        account.storageObservedAt !== null &&
        now.getTime() - account.storageObservedAt.getTime() > 15 * 60000
    };
  });
}
