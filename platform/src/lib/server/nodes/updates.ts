import { and, inArray, lt } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { nodeUpdates } from '$lib/server/db/schema';

export const managedUpdateCapability = 'managed-update-v1';
export const nodeUpdateLifetimeMilliseconds = 30 * 60_000;
export const activeNodeUpdateStatuses = ['pending', 'dispatched', 'restarting'] as const;
export const nodeUpdateResultStatuses = [
  'restarting',
  'succeeded',
  'failed',
  'rolled_back'
] as const;

export type NodeUpdateResultStatus = (typeof nodeUpdateResultStatuses)[number];

const stableReleasePattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseStableRelease(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = stableReleasePattern.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerStableRelease(current: string, target: string): boolean {
  const left = parseStableRelease(current);
  const right = parseStableRelease(target);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] !== left[index]) return right[index] > left[index];
  }
  return false;
}

export function parseNodeUpdateResult(value: unknown): {
  instructionId: string;
  status: NodeUpdateResultStatus;
  detail: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.instructionId !== 'string' ||
    !uuidPattern.test(body.instructionId) ||
    typeof body.status !== 'string' ||
    !nodeUpdateResultStatuses.includes(body.status as NodeUpdateResultStatus) ||
    typeof body.detail !== 'string' ||
    body.detail.length < 1 ||
    body.detail.length > 1000
  ) {
    return null;
  }
  return {
    instructionId: body.instructionId,
    status: body.status as NodeUpdateResultStatus,
    detail: body.detail
  };
}

export async function expireNodeUpdates(now = new Date()): Promise<void> {
  const expired = await getDatabase()
    .update(nodeUpdates)
    .set({
      status: 'expired',
      detail: 'The node did not complete the update before the instruction expired.',
      completedAt: now,
      updatedAt: now
    })
    .where(
      and(
        inArray(nodeUpdates.status, [...activeNodeUpdateStatuses]),
        lt(nodeUpdates.expiresAt, now)
      )
    )
    .returning({ id: nodeUpdates.id, workstationId: nodeUpdates.workstationId });

  for (const update of expired) {
    await recordAudit((query) => getDatabase().execute(query), {
      actorUserId: null,
      action: 'node_update.expired',
      targetType: 'workstation',
      targetId: update.workstationId,
      metadata: { updateId: update.id }
    });
  }
}

export function canTransitionNodeUpdate(current: string, next: NodeUpdateResultStatus): boolean {
  if (current === 'dispatched') return next === 'restarting' || next === 'failed';
  if (current === 'restarting')
    return next === 'succeeded' || next === 'failed' || next === 'rolled_back';
  if (current === 'succeeded') return next === 'rolled_back';
  return false;
}

export function nodeUpdateCompletion(status: NodeUpdateResultStatus): boolean {
  return status !== 'restarting';
}
