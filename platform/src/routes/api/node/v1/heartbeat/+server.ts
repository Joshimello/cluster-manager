import { and, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { getDatabase } from '$lib/server/db';
import { workstations } from '$lib/server/db/schema';
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
              hostname: report.hostname,
              bootId: report.bootId,
              uptimeSeconds: Math.floor(report.uptimeSeconds),
              inventory: report.inventory
            }
          : {})
      })
      .where(eq(workstations.id, workstation.id));

    return { inventoryAccepted };
  });

  if (!outcome) return unauthorized();
  return json({
    accepted: true,
    inventoryAccepted: outcome.inventoryAccepted,
    serverTime: receivedAt
  });
};
