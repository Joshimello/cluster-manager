import { sql, type SQL } from 'drizzle-orm';

import { posixIdentityMaximum, posixIdentityMinimum } from '$lib/server/db/schema';

type PosixIdentityRow = { posixId: number };
type PosixIdentityExecutor = (query: SQL<PosixIdentityRow>) => Promise<readonly PosixIdentityRow[]>;

export type PosixIdentity = Readonly<{ uid: number; gid: number }>;

export class PosixIdentityPoolExhaustedError extends Error {
  constructor() {
    super(`The POSIX identity pool ${posixIdentityMinimum}–${posixIdentityMaximum} is exhausted.`);
    this.name = 'PosixIdentityPoolExhaustedError';
  }
}

function databaseErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export async function allocatePosixIdentity(
  execute: PosixIdentityExecutor
): Promise<PosixIdentity> {
  try {
    const rows = await execute(sql<PosixIdentityRow>`
      select nextval('user_posix_identity_sequence')::integer as "posixId"
    `);
    const value = rows[0]?.posixId;
    if (!Number.isInteger(value) || value < posixIdentityMinimum || value > posixIdentityMaximum) {
      throw new Error('The POSIX identity allocator returned an invalid value.');
    }
    return { uid: value, gid: value };
  } catch (error) {
    if (databaseErrorCode(error) === '2200H') {
      throw new PosixIdentityPoolExhaustedError();
    }
    throw error;
  }
}
