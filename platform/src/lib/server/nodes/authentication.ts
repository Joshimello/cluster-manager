import { and, eq } from 'drizzle-orm';

import { getDatabase } from '$lib/server/db';
import { workstations } from '$lib/server/db/schema';

import { hashNodeSecret, readBearerCredential } from './credentials';

export async function authenticateNode(authorization: string | null) {
  const credential = readBearerCredential(authorization);
  if (!credential) return null;

  const [workstation] = await getDatabase()
    .select()
    .from(workstations)
    .where(
      and(
        eq(workstations.credentialHash, hashNodeSecret(credential)),
        eq(workstations.status, 'active')
      )
    )
    .limit(1);
  return workstation ?? null;
}
