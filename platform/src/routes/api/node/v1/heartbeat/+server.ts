import { and, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { getDatabase } from '$lib/server/db';
import {
  gpuObservations,
  gpuProcessObservations,
  gpus,
  workstationObservations,
  workstations
} from '$lib/server/db/schema';
import { hashNodeSecret, readBearerCredential } from '$lib/server/nodes/credentials';
import { parseHeartbeatReport } from '$lib/server/nodes/heartbeat';

import type { RequestHandler } from './$types';

function unauthorized() {
  return json({ error: 'Node authentication failed.' }, { status: 401 });
}

export const POST: RequestHandler = async ({ request }) => {
  const credential = readBearerCredential(request.headers.get('authorization'));
  if (!credential) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON heartbeat report.' }, { status: 400 });
  }

  const report = parseHeartbeatReport(body);
  const receivedAt = new Date();
  if (!report || report.observedAt.getTime() > receivedAt.getTime() + 5 * 60_000) {
    return json({ error: 'Invalid heartbeat report.' }, { status: 400 });
  }

  const credentialHash = hashNodeSecret(credential);
  const outcome = await getDatabase().transaction(async (transaction) => {
    const [workstation] = await transaction
      .select()
      .from(workstations)
      .where(
        and(eq(workstations.credentialHash, credentialHash), eq(workstations.status, 'active'))
      )
      .for('update')
      .limit(1);
    if (!workstation) return null;

    const inventoryAccepted =
      !workstation.inventoryObservedAt || report.observedAt >= workstation.inventoryObservedAt;
    await transaction
      .update(workstations)
      .set({
        lastHeartbeatAt: receivedAt,
        updatedAt: receivedAt,
        ...(inventoryAccepted
          ? {
              inventoryObservedAt: report.observedAt,
              nodeVersion: report.nodeVersion,
              nodeCapabilities: report.capabilities,
              hostname: report.hostname,
              bootId: report.bootId,
              uptimeSeconds: Math.floor(report.uptimeSeconds),
              inventory: report.inventory
            }
          : {})
      })
      .where(eq(workstations.id, workstation.id));

    if (inventoryAccepted) {
      await transaction
        .insert(workstationObservations)
        .values({
          workstationId: workstation.id,
          observedAt: report.observedAt,
          cpuUtilizationPercent: report.inventory.cpu.utilizationPercent,
          memoryUsedBytes: report.inventory.memory.usedBytes,
          memoryTotalBytes: report.inventory.memory.totalBytes,
          storagePath: report.inventory.storage.path,
          storageUsedBytes: report.inventory.storage.usedBytes,
          storageTotalBytes: report.inventory.storage.totalBytes
        })
        .onConflictDoNothing();

      if (report.inventory.gpuStatus === 'available') {
        await transaction
          .update(gpus)
          .set({ active: false, updatedAt: receivedAt })
          .where(eq(gpus.workstationId, workstation.id));
      }

      for (const gpu of report.gpus) {
        const [storedGpu] = await transaction
          .insert(gpus)
          .values({
            workstationId: workstation.id,
            gpuUuid: gpu.uuid,
            localIndex: gpu.index,
            model: gpu.model,
            active: true,
            lastObservedAt: report.observedAt,
            utilizationPercent: gpu.utilizationPercent,
            memoryUsedBytes: gpu.memoryUsedBytes,
            memoryTotalBytes: gpu.memoryTotalBytes,
            temperatureC: gpu.temperatureC,
            updatedAt: receivedAt
          })
          .onConflictDoUpdate({
            target: [gpus.workstationId, gpus.gpuUuid],
            set: {
              localIndex: gpu.index,
              model: gpu.model,
              active: true,
              lastObservedAt: report.observedAt,
              utilizationPercent: gpu.utilizationPercent,
              memoryUsedBytes: gpu.memoryUsedBytes,
              memoryTotalBytes: gpu.memoryTotalBytes,
              temperatureC: gpu.temperatureC,
              updatedAt: receivedAt
            }
          })
          .returning({ id: gpus.id });

        const [observation] = await transaction
          .insert(gpuObservations)
          .values({
            gpuId: storedGpu.id,
            observedAt: report.observedAt,
            utilizationPercent: gpu.utilizationPercent,
            memoryUsedBytes: gpu.memoryUsedBytes,
            memoryTotalBytes: gpu.memoryTotalBytes,
            temperatureC: gpu.temperatureC
          })
          .onConflictDoNothing()
          .returning({ id: gpuObservations.id });

        if (observation) {
          const processes = report.gpuProcesses
            .filter((process) => process.gpuUuid === gpu.uuid)
            .map((process) => ({
              observationId: observation.id,
              pid: process.pid,
              uid: process.uid,
              username: process.username,
              command: process.command,
              memoryUsedBytes: process.memoryUsedBytes,
              processStartTicks: process.processStartTicks
            }));
          if (processes.length > 0)
            await transaction.insert(gpuProcessObservations).values(processes);
        }
      }
    }

    return { inventoryAccepted };
  });

  if (!outcome) return unauthorized();
  return json({
    accepted: true,
    inventoryAccepted: outcome.inventoryAccepted,
    serverTime: receivedAt
  });
};
