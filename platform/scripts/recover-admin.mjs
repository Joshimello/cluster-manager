import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const argument = process.argv.indexOf('--username');
const username = argument === -1 ? '' : process.argv[argument + 1]?.trim().toLowerCase();
if (!username || !/^[a-z][a-z0-9_-]{2,31}$/.test(username)) {
  throw new Error('--username must identify an existing platform user');
}

const temporaryPassword = randomBytes(18).toString('base64url');
const passwordHash = await hash(temporaryPassword, {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32
});
const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

try {
  const recovered = await client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(1735553101)`;
    const [user] = await transaction`
      update users
      set role = 'admin', status = 'active', password_hash = ${passwordHash},
          linux_password_hash = null, must_change_password = true, updated_at = now()
      where username = ${username}
      returning id, username
    `;
    if (!user) throw new Error(`No platform user named ${username}`);
    await transaction`delete from sessions where user_id = ${user.id}`;
    await transaction`
      insert into audit_events (actor_user_id, action, target_type, target_id, metadata)
      values (null, 'user.admin_recovered', 'user', ${user.id}, ${JSON.stringify({ username })}::jsonb)
    `;
    return user;
  });
  console.log('Administrator access recovered. Save this temporary credential now.');
  console.log(`Username: ${recovered.username}`);
  console.log(`Temporary password: ${temporaryPassword}`);
  console.log('Log in and change the password before normal operation.');
} finally {
  await client.end();
}
