import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import {
  gpuDiagnosticRuns,
  gpus,
  nodeUpdates,
  reservations,
  sessions,
  stopRequests,
  terminationInstructions,
  users,
  workstationAssignments,
  workstations
} from '$lib/server/db/schema';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function lockUserAdministration(transaction: Transaction) {
  await transaction.execute(sql`select pg_advisory_xact_lock(48712, 1)`);
}

type DeletionInput = { actorId: string; targetId: string; confirmation: string };
type DeletionResult = { name: string } | { error: string; status: number };

async function cancelReservations(
  transaction: Transaction,
  ids: string[],
  actorId: string,
  reason: string,
  now: Date
) {
  if (ids.length === 0) return;
  const cancelled = await transaction
    .update(reservations)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledByUserId: actorId,
      cancellationReason: reason,
      updatedAt: now
    })
    .where(and(inArray(reservations.id, ids), eq(reservations.status, 'active')))
    .returning({ id: reservations.id });
  for (const reservation of cancelled) {
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: actorId,
      action: 'reservation.cancelled',
      targetType: 'reservation',
      targetId: reservation.id,
      metadata: { reason }
    });
  }
}

async function dismissStopRequests(
  transaction: Transaction,
  ids: string[],
  actorId: string,
  reason: string,
  now: Date
) {
  if (ids.length === 0) return;
  await transaction
    .update(terminationInstructions)
    .set({ status: 'expired', completedAt: now, detail: reason, updatedAt: now })
    .where(
      and(
        inArray(terminationInstructions.stopRequestId, ids),
        eq(terminationInstructions.status, 'pending')
      )
    );
  await transaction
    .update(stopRequests)
    .set({
      status: 'stale',
      decidedByUserId: actorId,
      decidedAt: now,
      decisionReason: reason,
      resultMessage: reason,
      updatedAt: now
    })
    .where(inArray(stopRequests.id, ids));
}

// Retain tombstones: nodes need revoked assignments to lock Linux accounts, and
// audit/history references and POSIX identities must never be reassigned.
export async function deleteUser(
  input: DeletionInput,
  database: Database = getDatabase()
): Promise<DeletionResult> {
  return database.transaction(async (transaction) => {
    await lockUserAdministration(transaction);
    // Serialize against role/status changes and other administrator deletions.
    const activeAdmins = await transaction
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)))
      .orderBy(users.id)
      .for('update');
    const [target] = await transaction
      .select()
      .from(users)
      .where(and(eq(users.id, input.targetId), isNull(users.deletedAt)))
      .for('update')
      .limit(1);
    if (!target) return { error: 'User was not found.', status: 404 };
    if (target.id === input.actorId)
      return { error: 'You cannot delete your own account.', status: 400 };
    if (target.role === 'admin' && target.status === 'active' && activeAdmins.length <= 1)
      return { error: 'The last active administrator cannot be deleted.', status: 400 };
    if (input.confirmation !== target.username)
      return { error: 'Confirm the user you want to delete.', status: 400 };

    const now = new Date();
    const reason = 'User deleted.';
    await transaction
      .update(users)
      .set({ status: 'disabled', deletedAt: now, linuxPasswordHash: null, updatedAt: now })
      .where(eq(users.id, target.id));
    await transaction.delete(sessions).where(eq(sessions.userId, target.id));
    await transaction
      .update(workstationAssignments)
      .set({
        status: 'revoked',
        desiredGeneration: sql`${workstationAssignments.desiredGeneration} + 1`,
        provisioningStatus: 'pending',
        provisioningMessage: null,
        provisioningErrorCode: null,
        revokedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(workstationAssignments.userId, target.id),
          eq(workstationAssignments.status, 'active')
        )
      );
    const bookings = await transaction
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.userId, target.id),
          eq(reservations.status, 'active'),
          gt(reservations.endAt, now)
        )
      );
    await cancelReservations(
      transaction,
      bookings.map((row) => row.id),
      input.actorId,
      reason,
      now
    );
    const requests = await transaction
      .select({ id: stopRequests.id })
      .from(stopRequests)
      .where(
        and(
          or(
            eq(stopRequests.requesterUserId, target.id),
            eq(stopRequests.targetUsername, target.username)
          ),
          inArray(stopRequests.status, ['pending', 'termination_requested'])
        )
      );
    await dismissStopRequests(
      transaction,
      requests.map((row) => row.id),
      input.actorId,
      reason,
      now
    );
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: input.actorId,
      action: 'user.deleted',
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username }
    });
    return { name: target.username };
  });
}

export async function deleteWorkstation(
  input: DeletionInput,
  database: Database = getDatabase()
): Promise<DeletionResult> {
  return database.transaction(async (transaction) => {
    const [target] = await transaction
      .select()
      .from(workstations)
      .where(and(eq(workstations.id, input.targetId), isNull(workstations.deletedAt)))
      .for('update')
      .limit(1);
    if (!target) return { error: 'Workstation was not found.', status: 404 };
    if (input.confirmation !== target.name)
      return { error: 'Confirm the workstation you want to delete.', status: 400 };

    const [diagnostic] = await transaction
      .select({ id: gpuDiagnosticRuns.id, status: gpuDiagnosticRuns.status })
      .from(gpuDiagnosticRuns)
      .where(
        and(
          eq(gpuDiagnosticRuns.workstationId, target.id),
          inArray(gpuDiagnosticRuns.status, [
            'pending',
            'dispatched',
            'running',
            'cancel_requested'
          ])
        )
      )
      .for('update')
      .limit(1);
    const [update] = await transaction
      .select({ id: nodeUpdates.id, status: nodeUpdates.status })
      .from(nodeUpdates)
      .where(
        and(
          eq(nodeUpdates.workstationId, target.id),
          inArray(nodeUpdates.status, ['pending', 'dispatched', 'restarting'])
        )
      )
      .for('update')
      .limit(1);
    if ((diagnostic && diagnostic.status !== 'pending') || (update && update.status !== 'pending'))
      return {
        error:
          'Wait for the running GPU diagnostic or node update to finish before deleting this workstation.',
        status: 409
      };

    const now = new Date();
    const reason = 'Workstation deleted.';
    await transaction
      .update(workstations)
      .set({
        status: 'disabled',
        deletedAt: now,
        credentialHash: null,
        credentialIssuedAt: null,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
        updatedAt: now
      })
      .where(eq(workstations.id, target.id));
    await transaction
      .update(workstationAssignments)
      .set({
        status: 'revoked',
        desiredGeneration: sql`${workstationAssignments.desiredGeneration} + 1`,
        provisioningStatus: 'pending',
        provisioningMessage: null,
        provisioningErrorCode: null,
        revokedAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(workstationAssignments.workstationId, target.id),
          eq(workstationAssignments.status, 'active')
        )
      );
    const bookings = await transaction
      .select({ id: reservations.id })
      .from(reservations)
      .innerJoin(gpus, eq(reservations.gpuId, gpus.id))
      .where(
        and(
          eq(gpus.workstationId, target.id),
          eq(reservations.status, 'active'),
          gt(reservations.endAt, now)
        )
      );
    await cancelReservations(
      transaction,
      bookings.map((row) => row.id),
      input.actorId,
      reason,
      now
    );
    const requests = await transaction
      .select({ id: stopRequests.id })
      .from(stopRequests)
      .where(
        and(
          eq(stopRequests.workstationId, target.id),
          inArray(stopRequests.status, ['pending', 'termination_requested'])
        )
      );
    await dismissStopRequests(
      transaction,
      requests.map((row) => row.id),
      input.actorId,
      reason,
      now
    );
    await transaction.update(gpus).set({ active: false }).where(eq(gpus.workstationId, target.id));
    await transaction
      .update(nodeUpdates)
      .set({ status: 'cancelled', detail: reason, completedAt: now, updatedAt: now })
      .where(and(eq(nodeUpdates.workstationId, target.id), eq(nodeUpdates.status, 'pending')));
    await transaction
      .update(gpuDiagnosticRuns)
      .set({ status: 'cancelled', detail: reason, completedAt: now, updatedAt: now })
      .where(
        and(eq(gpuDiagnosticRuns.workstationId, target.id), eq(gpuDiagnosticRuns.status, 'pending'))
      );
    await recordAudit((query) => transaction.execute(query), {
      actorUserId: input.actorId,
      action: 'workstation.deleted',
      targetType: 'workstation',
      targetId: target.id,
      metadata: { name: target.name }
    });
    return { name: target.name };
  });
}
