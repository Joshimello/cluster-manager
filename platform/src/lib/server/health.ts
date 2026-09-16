import { sql } from 'drizzle-orm';

import { getDatabase } from './db';

export type DatabaseHealth = Readonly<{
  status: 'ready' | 'not_ready';
}>;

type DatabaseProbe = () => Promise<unknown>;

async function probeDatabase() {
  return getDatabase().execute(sql`select key from platform_metadata limit 1`);
}

export async function checkDatabase(probe: DatabaseProbe = probeDatabase): Promise<DatabaseHealth> {
  try {
    await probe();
    return { status: 'ready' };
  } catch {
    return { status: 'not_ready' };
  }
}
