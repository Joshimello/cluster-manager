import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const client = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  onnotice: () => {}
});

try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log('Database migrations are up to date.');
} finally {
  await client.end();
}
