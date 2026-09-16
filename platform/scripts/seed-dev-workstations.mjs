import { createHash } from 'node:crypto';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (process.env.NODE_DEV_SEED_WORKSTATIONS !== 'true') {
  throw new Error('Refusing to seed unless NODE_DEV_SEED_WORKSTATIONS=true.');
}

const tokenPattern = /^cmenroll_[A-Za-z0-9_-]{43}$/;
const definitions = [
  ['ws01', 'Simulated Workstation 01', process.env.NODE_WS01_ENROLLMENT_TOKEN],
  ['ws02', 'Simulated Workstation 02', process.env.NODE_WS02_ENROLLMENT_TOKEN]
];
const sql = postgres(databaseUrl, { max: 1 });

try {
  for (const [name, displayName, token] of definitions) {
    if (!token || !tokenPattern.test(token))
      throw new Error(`A valid development token is required for ${name}.`);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await sql`
      insert into workstations (name, display_name, enrollment_token_hash, enrollment_expires_at)
      values (${name}, ${displayName}, ${tokenHash}, now() + interval '24 hours')
      on conflict (name) do nothing
    `;
  }
  console.log('Development workstation identities are ready.');
} finally {
  await sql.end();
}
