import { and, eq } from 'drizzle-orm';
import { json } from '@sveltejs/kit';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { workstations } from '$lib/server/db/schema';
import {
  hashNodeSecret,
  isEnrollmentToken,
  isNodeCredential,
  normalizeWorkstationName,
  validateWorkstationName
} from '$lib/server/nodes/credentials';

import type { RequestHandler } from './$types';

type EnrollmentBody = { name?: unknown; token?: unknown; credential?: unknown };

function unauthorized() {
  return json({ error: 'Enrollment was rejected.' }, { status: 401 });
}

export const POST: RequestHandler = async ({ request }) => {
  let body: EnrollmentBody;
  try {
    body = (await request.json()) as EnrollmentBody;
  } catch {
    return json({ error: 'Expected a JSON enrollment request.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? normalizeWorkstationName(body.name) : '';
  const token = typeof body.token === 'string' ? body.token : '';
  const credential = typeof body.credential === 'string' ? body.credential : '';
  if (validateWorkstationName(name) || !isEnrollmentToken(token) || !isNodeCredential(credential)) {
    return unauthorized();
  }

  const tokenHash = hashNodeSecret(token);
  const credentialHash = hashNodeSecret(credential);
  const now = new Date();
  const outcome = await getDatabase().transaction(async (transaction) => {
    const [workstation] = await transaction
      .select()
      .from(workstations)
      .where(
        and(
          eq(workstations.name, name),
          eq(workstations.enrollmentTokenHash, tokenHash),
          eq(workstations.status, 'active')
        )
      )
      .for('update')
      .limit(1);

    if (!workstation) return null;

    if (workstation.enrollmentUsedAt) {
      return workstation.credentialHash === credentialHash ? workstation : null;
    }

    if (!workstation.enrollmentExpiresAt || workstation.enrollmentExpiresAt < now) return null;

    const [enrolled] = await transaction
      .update(workstations)
      .set({
        credentialHash,
        credentialIssuedAt: now,
        enrollmentUsedAt: now,
        enrolledAt: workstation.enrolledAt ?? now,
        updatedAt: now
      })
      .where(eq(workstations.id, workstation.id))
      .returning();

    await recordAudit((query) => transaction.execute(query), {
      actorUserId: null,
      action: 'workstation.enrolled',
      targetType: 'workstation',
      targetId: workstation.id,
      metadata: { name: workstation.name }
    });
    return enrolled;
  });

  if (!outcome) return unauthorized();
  return json({ workstationId: outcome.id, name: outcome.name, enrolled: true });
};
