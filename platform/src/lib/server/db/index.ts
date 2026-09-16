import { env } from '$env/dynamic/private';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false
  });

  return drizzle(client, { schema });
}

export function getDatabase() {
  database ??= createDatabase();
  return database;
}
