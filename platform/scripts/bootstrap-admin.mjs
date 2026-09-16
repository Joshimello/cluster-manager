import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const username = readArgument('--username')?.trim().toLowerCase();
const displayName = readArgument('--display-name')?.trim().replace(/\s+/g, ' ');

if (!username || !/^[a-z][a-z0-9_-]{2,31}$/.test(username)) {
  throw new Error('--username must be 3–32 lowercase letters, numbers, _ or -');
}

if (!displayName || displayName.length > 120) {
  throw new Error('--display-name must be between 1 and 120 characters');
}

const temporaryPassword = randomBytes(18).toString('base64url');
const passwordHash = await hash(temporaryPassword, {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32
});

const client = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  onnotice: () => {}
});

try {
  const user = await client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(1735553101)`;

    const existingUsers = await transaction`select id from users limit 1`;
    if (existingUsers.length > 0) {
      throw new Error('Bootstrap refused: at least one platform user already exists');
    }

    const [createdUser] = await transaction`
      insert into users (username, display_name, role, status, password_hash, must_change_password)
      values (${username}, ${displayName}, 'admin', 'active', ${passwordHash}, true)
      returning id, username
    `;

    await transaction`
      insert into audit_events (actor_user_id, action, target_type, target_id, metadata)
      values (
        null,
        'user.bootstrap_admin_created',
        'user',
        ${createdUser.id},
        ${JSON.stringify({ username })}::jsonb
      )
    `;

    return createdUser;
  });

  console.log(
    'Initial administrator created. Save this temporary credential now; it will not be shown again.'
  );
  console.log(`Username: ${user.username}`);
  console.log(`Temporary password: ${temporaryPassword}`);
  console.log('The administrator must change this password after first login.');
} finally {
  await client.end();
}
