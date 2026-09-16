import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { defineConfig } from 'drizzle-kit';

const rootEnvironmentFile = '../.env';

if (!process.env.DATABASE_URL && existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run Drizzle commands');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL
  },
  strict: true,
  verbose: true
});
