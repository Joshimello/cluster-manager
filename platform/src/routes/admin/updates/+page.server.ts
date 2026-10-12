import { fail } from '@sveltejs/kit';
import { and, desc, isNull, eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth/guards';
import { getDatabase } from '$lib/server/db';
import { platformUpdates, workstations, nodeUpdates } from '$lib/server/db/schema';
import { platformVersion } from '$lib/server/version';
import { availableRelease, checkPlatformRelease } from '$lib/server/platform-updates/releases';
import {
  expirePendingUpdates,
  PlatformUpdateError,
  requestPlatformUpdate,
  updaterConfigured,
  updaterReady
} from '$lib/server/platform-updates/service';
import {
  managedUpdateCapability,
  isNewerStableRelease,
  parseStableRelease
} from '$lib/server/nodes/updates';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  await expirePendingUpdates();
  const [check, ready, history, nodes, updates] = await Promise.all([
    checkPlatformRelease(),
    updaterReady(),
    getDatabase().select().from(platformUpdates).orderBy(desc(platformUpdates.createdAt)).limit(20),
    getDatabase()
      .select({
        id: workstations.id,
        name: workstations.displayName,
        version: workstations.nodeVersion,
        capabilities: workstations.nodeCapabilities,
        lastHeartbeatAt: workstations.lastHeartbeatAt
      })
      .from(workstations)
      .where(and(isNull(workstations.deletedAt), eq(workstations.status, 'active'))),
    getDatabase().select().from(nodeUpdates).orderBy(desc(nodeUpdates.createdAt)).limit(100)
  ]);
  return {
    installed: platformVersion,
    recognizedVersion: !!parseStableRelease(platformVersion),
    check,
    available: availableRelease(platformVersion, check),
    ready,
    configured: updaterConfigured(),
    history,
    nodes: nodes.map((node) => ({
      ...node,
      supported: node.capabilities.includes(managedUpdateCapability),
      available:
        check.release &&
        !check.error &&
        node.version &&
        isNewerStableRelease(node.version, check.release.version)
          ? check.release.version
          : null,
      latestUpdate: updates.find((update) => update.workstationId === node.id)?.status ?? null
    }))
  };
};

export const actions: Actions = {
  check: async ({ locals }) => {
    requireAdmin(locals);
    const check = await checkPlatformRelease(true);
    return {
      action: 'check',
      success: !check.error,
      message: check.error ?? 'Release information is up to date.'
    };
  },
  install: async ({ locals, request }) => {
    const actor = requireAdmin(locals);
    const form = await request.formData();
    try {
      await requestPlatformUpdate(
        actor.id,
        String(form.get('version') ?? ''),
        String(form.get('confirmation') ?? '')
      );
      return {
        action: 'install',
        success: true,
        message: 'Update requested. You can follow its progress below.'
      };
    } catch (cause) {
      const message =
        cause instanceof PlatformUpdateError
          ? cause.message
          : 'Could not request the update. Try again.';
      return fail(400, { action: 'install', success: false, message });
    }
  }
};
