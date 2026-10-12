import { timingSafeEqual, createHash } from 'node:crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { platformMetadata, platformUpdates } from '$lib/server/db/schema';
import { isNewerStableRelease, parseStableRelease } from '$lib/server/nodes/updates';
import { platformVersion } from '$lib/server/version';
import { checkPlatformRelease } from './releases';

export const activeStatuses = ['pending', 'preparing', 'backing_up', 'restarting'];
export class PlatformUpdateError extends Error {}
export const updateDetails = {
  preparing: 'Downloading and checking the release.',
  backing_up: 'Backing up the database and deployment configuration.',
  restarting: 'Restarting the platform. This page will reconnect automatically.',
  succeeded: 'The new platform is running and its database is ready.',
  backup_failed: 'Backup failed. The platform was not replaced.',
  pull_failed: 'Could not download or verify the release image. The platform was not replaced.',
  configuration_invalid:
    'The updater configuration does not match this deployment. The platform was not replaced.',
  release_unavailable:
    'The approved release is no longer available. The platform was not replaced.',
  restart_failed:
    'The restart failed. The backup is retained; inspect the updater logs in Container Manager.',
  health_failed:
    'The new platform did not become ready. The backup is retained; recovery requires administrator review.',
  interrupted:
    'The updater was interrupted. Check the deployment and retained backup before retrying.'
} as const;

export function updaterConfigured() {
  return /^[a-f0-9]{64}$/.test(process.env.PLATFORM_UPDATER_TOKEN ?? '');
}
export function authenticateUpdater(request: Request): boolean {
  if (!updaterConfigured()) return false;
  const supplied = request.headers.get('authorization') ?? '';
  if (supplied.length > 256) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`Bearer ${process.env.PLATFORM_UPDATER_TOKEN}`));
}

export async function updaterHeartbeat(now = new Date()) {
  await getDatabase()
    .insert(platformMetadata)
    .values({ key: 'platform_updater_heartbeat', value: now.toISOString() })
    .onConflictDoUpdate({ target: platformMetadata.key, set: { value: now.toISOString() } });
}
export async function updaterReady(now = new Date()) {
  if (!updaterConfigured()) return false;
  const [row] = await getDatabase()
    .select()
    .from(platformMetadata)
    .where(eq(platformMetadata.key, 'platform_updater_heartbeat'));
  const age = now.getTime() - Date.parse(row?.value ?? '');
  return Number.isFinite(age) && age >= 0 && age < 45_000;
}

export async function expirePendingUpdates(now = new Date()) {
  const database = getDatabase();
  await database.transaction(async (tx) => {
    const rows = await tx
      .update(platformUpdates)
      .set({
        status: 'expired',
        detail: 'The updater did not pick up this request in time. Request the update again.',
        completedAt: now,
        updatedAt: now
      })
      .where(and(eq(platformUpdates.status, 'pending'), lt(platformUpdates.expiresAt, now)))
      .returning();
    for (const row of rows)
      await recordAudit((q) => tx.execute(q), {
        actorUserId: null,
        action: 'platform_update.expired',
        targetType: 'platform_update',
        targetId: row.id
      });
  });
}

export async function requestPlatformUpdate(actorId: string, target: string, confirmation: string) {
  if (
    !parseStableRelease(target) ||
    confirmation !== target ||
    !isNewerStableRelease(platformVersion, target)
  )
    throw new PlatformUpdateError('Confirm an exact newer stable release.');
  const release = await checkPlatformRelease(true);
  if (release.error || release.release?.version !== target)
    throw new PlatformUpdateError('Check for updates again before installing.');
  if (!(await updaterReady()))
    throw new PlatformUpdateError('The updater is offline or has not been set up.');
  await expirePendingUpdates();
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(684239120)`);
    const [active] = await tx
      .select()
      .from(platformUpdates)
      .where(inArray(platformUpdates.status, activeStatuses))
      .limit(1);
    if (active) throw new PlatformUpdateError('A platform update is already in progress.');
    const [row] = await tx
      .insert(platformUpdates)
      .values({
        actorId,
        sourceVersion: platformVersion,
        targetVersion: target,
        expiresAt: new Date(Date.now() + 15 * 60_000)
      })
      .returning();
    await recordAudit((q) => tx.execute(q), {
      actorUserId: actorId,
      action: 'platform_update.requested',
      targetType: 'platform_update',
      targetId: row.id,
      metadata: { sourceVersion: platformVersion, targetVersion: target }
    });
    return row;
  });
}

export async function nextPlatformUpdate() {
  await updaterHeartbeat();
  await expirePendingUpdates();
  // Polling also keeps release checks active when nobody has the Updates page open.
  void checkPlatformRelease();
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(684239120)`);
    const [row] = await tx
      .select()
      .from(platformUpdates)
      .where(inArray(platformUpdates.status, activeStatuses))
      .orderBy(desc(platformUpdates.createdAt))
      .limit(1)
      .for('update');
    if (!row) return null;
    const resume = row.status !== 'pending';
    if (!resume) {
      await tx
        .update(platformUpdates)
        .set({
          status: 'preparing',
          detail: updateDetails.preparing,
          dispatchedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(platformUpdates.id, row.id));
      await recordAudit((q) => tx.execute(q), {
        actorUserId: null,
        action: 'platform_update.dispatched',
        targetType: 'platform_update',
        targetId: row.id
      });
    }
    return {
      id: row.id,
      sourceVersion: row.sourceVersion,
      targetVersion: row.targetVersion,
      expiresAt: row.expiresAt.toISOString(),
      resume
    };
  });
}

export function parseUpdateResult(
  value: unknown
): { id: string; status: string; code: keyof typeof updateDetails } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id) ||
    typeof body.code !== 'string' ||
    !Object.hasOwn(updateDetails, body.code)
  )
    return null;
  const code = body.code as keyof typeof updateDetails;
  const status = ['preparing', 'backing_up', 'restarting', 'succeeded'].includes(code)
    ? code
    : 'failed';
  return body.status === status ? { id: body.id, status, code } : null;
}

export async function reportPlatformUpdate(
  result: NonNullable<ReturnType<typeof parseUpdateResult>>
) {
  return getDatabase().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(platformUpdates)
      .where(eq(platformUpdates.id, result.id))
      .for('update');
    if (!row || row.status === 'pending' || row.status === 'expired') return false;
    if (row.status === result.status && ['succeeded', 'failed'].includes(row.status)) return true;
    if (!activeStatuses.includes(row.status)) return false;
    if (result.status === 'succeeded' && platformVersion !== row.targetVersion) return false;
    const stages = ['preparing', 'backing_up', 'restarting', 'succeeded'];
    if (result.status !== 'failed' && stages.indexOf(result.status) < stages.indexOf(row.status))
      return false;
    const terminal = result.status === 'succeeded' || result.status === 'failed';
    await tx
      .update(platformUpdates)
      .set({
        status: result.status,
        detail: updateDetails[result.code],
        updatedAt: new Date(),
        completedAt: terminal ? new Date() : null
      })
      .where(eq(platformUpdates.id, row.id));
    await recordAudit((q) => tx.execute(q), {
      actorUserId: null,
      action: `platform_update.${result.status}`,
      targetType: 'platform_update',
      targetId: row.id,
      metadata: { code: result.code, targetVersion: row.targetVersion }
    });
    return true;
  });
}
