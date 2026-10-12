import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import {
  accountManagementCapability,
  type AccountSnapshot,
  type LocalAccount
} from '$lib/account-management';
import { isWorkstationId } from '$lib/server/nodes/credentials';
import { isLinuxPasswordHash } from '$lib/server/auth/linux-password';
import { recordAudit } from '$lib/server/audit';
import { generateTemporaryPassword, hashPasswordPair } from '$lib/server/auth/password';
import { getDatabase } from '$lib/server/db';
import {
  accountOperations,
  gpus,
  reservations,
  posixIdentityReservations,
  users,
  workstationAssignments,
  workstations,
  type Workstation
} from '$lib/server/db/schema';

type DB = ReturnType<typeof getDatabase>;
export type AccountTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];
export const accountOperationLifetime = 15 * 60_000;
export class AccountManagementError extends Error {}
export function accountOperationError(error: unknown): string {
  return error instanceof AccountManagementError
    ? error.message
    : 'Account operation could not be saved. Please try again.';
}
const activeOperations = ['pending', 'dispatched', 'adopted'];
export async function lockAccounts(tx: AccountTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(48712, 1)`);
}
export function accountsFresh(
  ws: Pick<Workstation, 'accountSnapshot' | 'lastHeartbeatAt' | 'nodeCapabilities' | 'status'>,
  now = new Date()
): boolean {
  return (
    ws.status === 'active' &&
    ws.nodeCapabilities.includes(accountManagementCapability) &&
    !!ws.accountSnapshot?.complete &&
    !!ws.lastHeartbeatAt &&
    now.getTime() - ws.lastHeartbeatAt.getTime() <= 45000 &&
    now.getTime() - Date.parse(ws.accountSnapshot.observedAt) <= 45000 &&
    Date.parse(ws.accountSnapshot.observedAt) <= now.getTime() + 5000
  );
}
export async function reserveSnapshotIds(tx: AccountTransaction, snapshot: AccountSnapshot) {
  if (!snapshot.complete) return;
  for (const a of snapshot.accounts) {
    // Even incompatible accounts must not have their numeric identity allocated to someone else.
    for (const id of new Set([a.uid, a.gid])) {
      if (id < 20000 || id > 59999) continue;
      // Shared primary-group membership is not a conflicting claim to the group's identity.
      const owner = id === a.uid ? a.username : a.primaryGroup || a.username;
      await tx
        .insert(posixIdentityReservations)
        .values({ posixId: id, username: owner })
        .onConflictDoUpdate({
          target: posixIdentityReservations.posixId,
          set: {
            conflicted: sql`${posixIdentityReservations.conflicted} or ${posixIdentityReservations.username} <> ${owner}`
          }
        });
    }
  }
}
export async function expireAccountOperations(tx: AccountTransaction) {
  await tx
    .update(accountOperations)
    .set({
      status: 'expired',
      detail: 'Operation expired; explicit retry required.',
      updatedAt: new Date()
    })
    .where(
      and(
        inArray(accountOperations.status, ['pending', 'dispatched']),
        lt(accountOperations.expiresAt, new Date())
      )
    );
}
export async function loadAccountManagement(ws: Workstation) {
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await lockAccounts(tx);
    await expireAccountOperations(tx);
  });
  const allUsers = await db.select().from(users);
  const reservations = await db.select().from(posixIdentityReservations);
  const operations = await db
    .select({ operation: accountOperations, workstationName: workstations.name })
    .from(accountOperations)
    .innerJoin(workstations, eq(workstations.id, accountOperations.workstationId))
    .where(eq(accountOperations.workstationId, ws.id))
    .orderBy(desc(accountOperations.createdAt));
  const accounts = (ws.accountSnapshot?.accounts ?? []).map((a) => {
    const sameName = allUsers.find((u) => u.username === a.username);
    const sameId = allUsers.find((u) => u.posixUid === a.uid || u.posixGid === a.gid);
    let conflict = a.reason;
    if (sameName && (sameName.deletedAt || sameName.status !== 'active'))
      conflict = 'That platform identity is deleted or disabled.';
    else if (sameName && (sameName.posixUid !== a.uid || sameName.posixGid !== a.gid))
      conflict = 'Username has a different platform UID/GID.';
    else if (
      sameName &&
      (!sameName.linuxPasswordHash || !isLinuxPasswordHash(sameName.linuxPasswordHash))
    )
      conflict = 'Set this platform user’s workstation password before linking.';
    else if (sameId && sameId.username !== a.username)
      conflict = 'UID/GID belongs to another platform user.';
    else if (
      reservations.some(
        (r) =>
          (r.posixId === a.uid || r.posixId === a.gid) &&
          (r.conflicted || r.username !== a.username)
      )
    )
      conflict = 'Numeric identity conflicts with another discovered account.';
    const managed = a.ownerWorkstationId === ws.id;
    const busy = operations.some(
      ({ operation: o }) => o.account.username === a.username && activeOperations.includes(o.status)
    );
    return {
      ...a,
      userId: sameName?.id ?? null,
      managed,
      conflict,
      canImport: a.eligible && !conflict && !managed && !busy && accountsFresh(ws)
    };
  });
  return {
    accounts,
    workstationName: ws.name,
    operations: operations.map((r) => ({ ...r.operation, workstationName: r.workstationName })),
    fresh: accountsFresh(ws),
    supported: ws.nodeCapabilities.includes(accountManagementCapability)
  };
}
export async function importAccount(
  input: {
    actorId: string;
    workstationId: string;
    username: string;
    fingerprint: string;
    confirmation: string;
  },
  db: DB = getDatabase()
) {
  if (!isWorkstationId(input.workstationId))
    throw new AccountManagementError('Invalid workstation.');
  const temporaryPassword = generateTemporaryPassword();
  const hashes = await hashPasswordPair(temporaryPassword);
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    await expireAccountOperations(tx);
    const [ws] = await tx
      .select()
      .from(workstations)
      .where(eq(workstations.id, input.workstationId))
      .for('update');
    if (!ws || !accountsFresh(ws))
      throw new AccountManagementError(
        'A fresh complete account scan from an updated online node is required.'
      );
    const a = ws.accountSnapshot!.accounts.find(
      (a) => a.username === input.username && a.fingerprint === input.fingerprint
    );
    if (!a?.eligible || input.confirmation !== a.username)
      throw new AccountManagementError(
        'Confirm an eligible unmanaged account from the latest scan.'
      );
    const reserved = await tx
      .select()
      .from(posixIdentityReservations)
      .where(inArray(posixIdentityReservations.posixId, [a.uid, a.gid]));
    if (reserved.some((r) => r.conflicted || r.username !== a.username))
      throw new AccountManagementError('UID/GID conflicts with another discovered account.');
    const identities = await tx
      .select()
      .from(users)
      .where(
        or(eq(users.username, a.username), eq(users.posixUid, a.uid), eq(users.posixGid, a.gid))
      )
      .for('update');
    let user = identities.find((u) => u.username === a.username);
    if (
      identities.some((u) => u.username !== a.username) ||
      (user &&
        (user.posixUid !== a.uid ||
          user.posixGid !== a.gid ||
          user.deletedAt ||
          user.status !== 'active' ||
          !user.linuxPasswordHash ||
          !isLinuxPasswordHash(user.linuxPasswordHash)))
    )
      throw new AccountManagementError('Platform username or UID/GID conflicts with this account.');
    const created = !user;
    if (!user)
      [user] = await tx
        .insert(users)
        .values({
          username: a.username,
          displayName: a.username,
          posixUid: a.uid,
          posixGid: a.gid,
          role: 'user',
          ...hashes,
          mustChangePassword: true
        })
        .returning();
    await reserveSnapshotIds(tx, {
      observedAt: new Date().toISOString(),
      complete: true,
      accounts: [a]
    });
    const assignments = await tx
      .select()
      .from(workstationAssignments)
      .where(
        and(
          eq(workstationAssignments.userId, user.id),
          eq(workstationAssignments.workstationId, ws.id)
        )
      )
      .orderBy(desc(workstationAssignments.assignedAt))
      .for('update');
    let assignment = assignments[0];
    if (a.ownerWorkstationId === ws.id && assignment?.accountState !== 'adopting')
      throw new AccountManagementError('Account is already managed.');
    if (assignment) {
      const pending = await tx
        .select()
        .from(accountOperations)
        .where(
          and(
            eq(accountOperations.assignmentId, assignment.id),
            inArray(accountOperations.status, activeOperations)
          )
        );
      if (pending.length)
        throw new AccountManagementError('An account operation is already in progress.');
      [assignment] = await tx
        .update(workstationAssignments)
        .set({
          status: 'active',
          revokedAt: null,
          accountState: 'adopting',
          desiredGeneration: sql`${workstationAssignments.desiredGeneration}+1`,
          provisioningStatus: 'pending',
          provisioningMessage: 'Awaiting account adoption',
          updatedAt: new Date()
        })
        .where(eq(workstationAssignments.id, assignment.id))
        .returning();
    } else
      [assignment] = await tx
        .insert(workstationAssignments)
        .values({ userId: user.id, workstationId: ws.id, accountState: 'adopting' })
        .returning();
    const [op] = await tx
      .insert(accountOperations)
      .values({
        workstationId: ws.id,
        userId: user.id,
        assignmentId: assignment.id,
        actorId: input.actorId,
        kind: 'adopt',
        account: a,
        generation: assignment.desiredGeneration,
        expiresAt: new Date(Date.now() + accountOperationLifetime)
      })
      .returning();
    await auditOperation(tx, op, 'account.import_requested');
    return { username: a.username, ...(created ? { temporaryPassword } : {}), operationId: op.id };
  });
}
async function auditOperation(
  tx: AccountTransaction,
  op: typeof accountOperations.$inferSelect,
  action: string
) {
  await recordAudit((q) => tx.execute(q), {
    actorUserId: op.actorId,
    action,
    targetType: 'account_operation',
    targetId: op.id,
    metadata: {
      workstationId: op.workstationId,
      username: op.account.username,
      deleteHome: op.deleteHome,
      status: op.status
    }
  });
}
// Called inside the global deletion transaction as well as workstation-specific removal.
export async function queueAccountRemoval(
  tx: AccountTransaction,
  input: {
    actorId: string;
    userId: string;
    workstationId: string;
    deleteHome: boolean;
    cancelFutureReservations?: boolean;
  }
) {
  const [ws] = await tx
    .select()
    .from(workstations)
    .where(eq(workstations.id, input.workstationId))
    .for('update');
  const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
  if (!ws || !user) throw new AccountManagementError('Account or workstation not found.');
  const assignments = await tx
    .select()
    .from(workstationAssignments)
    .where(
      and(
        eq(workstationAssignments.userId, user.id),
        eq(workstationAssignments.workstationId, ws.id)
      )
    )
    .orderBy(desc(workstationAssignments.assignedAt))
    .for('update');
  const assignment = assignments[0];
  if (!assignment) throw new AccountManagementError('Account has no workstation assignment.');
  const active = await tx
    .select()
    .from(accountOperations)
    .where(
      and(
        eq(accountOperations.assignmentId, assignment.id),
        inArray(accountOperations.status, activeOperations)
      )
    );
  const existingRemoval = active.find((o) => o.kind === 'remove');
  if (existingRemoval) return existingRemoval;
  await tx
    .update(accountOperations)
    .set({ status: 'blocked', detail: 'Cancelled by account removal', updatedAt: new Date() })
    .where(
      and(
        eq(accountOperations.assignmentId, assignment.id),
        inArray(accountOperations.status, activeOperations)
      )
    );
  const a = ws.accountSnapshot?.accounts.find(
    (a) => a.username === user.username && a.uid === user.posixUid && a.gid === user.posixGid
  );
  if (!a && accountsFresh(ws)) {
    const [awaitingReceipt] = await tx
      .select()
      .from(accountOperations)
      .where(
        and(
          eq(accountOperations.assignmentId, assignment.id),
          eq(accountOperations.kind, 'remove'),
          eq(accountOperations.status, 'expired')
        )
      )
      .orderBy(desc(accountOperations.createdAt))
      .limit(1);
    if (awaitingReceipt) return awaitingReceipt;
  }
  const identity: LocalAccount = a ?? {
    username: user.username,
    uid: user.posixUid,
    gid: user.posixGid,
    home: `/home/${user.username}`,
    primaryGroup: user.username,
    fingerprint: '',
    eligible: false,
    reason: 'Awaiting a fresh account scan',
    ownerWorkstationId: '',
    exists: true
  };
  let detail = '';
  if (!ws.nodeCapabilities.includes(accountManagementCapability))
    detail = 'Node update required; explicit retry required.';
  else if (!accountsFresh(ws))
    detail = 'Workstation is offline or scan is stale; explicit retry required.';
  else if (!a || a.ownerWorkstationId !== ws.id)
    detail = 'Local account ownership could not be verified; explicit retry required.';
  const [changed] = await tx
    .update(workstationAssignments)
    .set({
      status: 'revoked',
      revokedAt: new Date(),
      accountState: 'removing',
      desiredGeneration: sql`${workstationAssignments.desiredGeneration}+1`,
      provisioningStatus: 'pending',
      updatedAt: new Date()
    })
    .where(eq(workstationAssignments.id, assignment.id))
    .returning();
  if (input.cancelFutureReservations !== false) {
    const cancelled = await tx
      .update(reservations)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledByUserId: input.actorId,
        cancellationReason: 'Workstation account removed.',
        updatedAt: new Date()
      })
      .where(
        and(
          eq(reservations.userId, user.id),
          eq(reservations.status, 'active'),
          gt(reservations.startAt, new Date()),
          inArray(
            reservations.gpuId,
            tx.select({ id: gpus.id }).from(gpus).where(eq(gpus.workstationId, ws.id))
          )
        )
      )
      .returning({ id: reservations.id });
    for (const r of cancelled)
      await recordAudit((q) => tx.execute(q), {
        actorUserId: input.actorId,
        action: 'reservation.cancelled_for_assignment_revocation',
        targetType: 'reservation',
        targetId: r.id,
        metadata: { workstationId: ws.id, reason: 'Workstation account removed.' }
      });
  }
  const [op] = await tx
    .insert(accountOperations)
    .values({
      workstationId: ws.id,
      userId: user.id,
      assignmentId: assignment.id,
      actorId: input.actorId,
      kind: 'remove',
      account: identity,
      generation: changed.desiredGeneration,
      deleteHome: input.deleteHome,
      status: detail ? 'blocked' : 'pending',
      detail,
      expiresAt: new Date(Date.now() + accountOperationLifetime)
    })
    .returning();
  await auditOperation(tx, op, 'account.removal_requested');
  return op;
}
export async function removeAccount(
  input: {
    actorId: string;
    userId: string;
    workstationId: string;
    confirmation: string;
    deleteHome: boolean;
  },
  db: DB = getDatabase()
) {
  if (!isWorkstationId(input.workstationId) || !isWorkstationId(input.userId))
    throw new AccountManagementError('Invalid workstation account.');
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    await expireAccountOperations(tx);
    const [u] = await tx.select().from(users).where(eq(users.id, input.userId));
    if (!u || u.username !== input.confirmation)
      throw new AccountManagementError('Type the account username to confirm removal.');
    return queueAccountRemoval(tx, input);
  });
}
export async function retryAccount(
  input: { actorId: string; operationId: string; confirmation: string; workstationId?: string },
  db: DB = getDatabase()
) {
  if (!isWorkstationId(input.operationId))
    throw new AccountManagementError('Invalid account operation.');
  const [op] = await db
    .select()
    .from(accountOperations)
    .where(eq(accountOperations.id, input.operationId));
  if (
    !op ||
    (input.workstationId && op.workstationId !== input.workstationId) ||
    activeOperations.includes(op.status) ||
    op.status === 'completed' ||
    input.confirmation !== op.account.username
  )
    throw new AccountManagementError('Confirm a blocked or expired operation.');
  const [newer] = await db
    .select({ id: accountOperations.id })
    .from(accountOperations)
    .where(
      and(
        eq(accountOperations.assignmentId, op.assignmentId),
        gt(
          accountOperations.createdAt,
          sql`(select created_at from account_operations where id=${op.id})`
        )
      )
    )
    .limit(1);
  if (newer)
    throw new AccountManagementError('This operation was superseded. Use the latest operation.');
  if (op.kind === 'remove') {
    const [node] = await db
      .select()
      .from(workstations)
      .where(eq(workstations.id, op.workstationId));
    if (
      node &&
      accountsFresh(node) &&
      !node.accountSnapshot?.accounts.some((a) => a.username === op.account.username)
    )
      throw new AccountManagementError(
        'Account is absent from the fresh scan. Await the node’s durable cleanup receipt; no new removal was queued.'
      );
    return removeAccount(
      {
        actorId: input.actorId,
        userId: op.userId,
        workstationId: op.workstationId,
        confirmation: input.confirmation,
        deleteHome: op.deleteHome
      },
      db
    );
  }
  const [ws] = await db.select().from(workstations).where(eq(workstations.id, op.workstationId));
  const a = ws?.accountSnapshot?.accounts.find((a) => a.username === op.account.username);
  if (!a) throw new AccountManagementError('A fresh account scan is required.');
  // Ownership may already have transferred before a lost acknowledgement; import must validate it again.
  return importAccount(
    {
      actorId: input.actorId,
      workstationId: op.workstationId,
      username: a.username,
      fingerprint: a.fingerprint,
      confirmation: input.confirmation
    },
    db
  );
}
