import assert from 'node:assert/strict';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = postgres(databaseUrl, { max: 12, prepare: false });
const suffix = Date.now().toString(36);
const userIds = [];
const workstationIds = [];

async function expectDatabaseCode(operation, expectedCode) {
  try {
    await operation();
    assert.fail(`expected PostgreSQL error ${expectedCode}`);
  } catch (error) {
    assert.equal(error.code, expectedCode);
  }
}

async function createUser(index) {
  return sql.begin(async (transaction) => {
    const [identity] = await transaction`
      select nextval('user_posix_identity_sequence')::integer as posix_id
    `;
    const [user] = await transaction`
      insert into users (username, display_name, posix_uid, posix_gid, password_hash)
      values (
        ${`m82-${suffix}-${index}`},
        ${`M8.2 database smoke ${index}`},
        ${identity.posix_id},
        ${identity.posix_id},
        'test-only-hash'
      )
      returning id, posix_uid, posix_gid
    `;
    return user;
  });
}

try {
  const created = await Promise.all(Array.from({ length: 12 }, (_, index) => createUser(index)));
  userIds.push(...created.map((user) => user.id));
  const identities = created.map((user) => user.posix_uid).sort((left, right) => left - right);
  assert.equal(new Set(identities).size, created.length);
  assert.ok(identities.every((identity) => identity >= 20_000 && identity <= 59_999));
  assert.ok(created.every((user) => user.posix_uid === user.posix_gid));
  for (let index = 1; index < identities.length; index += 1) {
    assert.ok(identities[index] > identities[index - 1]);
  }

  await expectDatabaseCode(
    () => sql`update users set posix_uid = posix_uid + 1 where id = ${created[0].id}`,
    '23514'
  );
  await expectDatabaseCode(
    () => sql`
      insert into users (username, display_name, posix_uid, posix_gid, password_hash)
      values (${`m82-bad-${suffix}`}, 'Bad identity', 19999, 19999, 'test-only-hash')
    `,
    '23514'
  );
  await expectDatabaseCode(
    () => sql`
      insert into users (username, display_name, posix_uid, posix_gid, password_hash)
      values (${`m82-mismatch-${suffix}`}, 'Mismatched identity', 59000, 59001, 'test-only-hash')
    `,
    '23514'
  );

  const workstations = await sql`
    insert into workstations (name, display_name)
    values (${`m82-a-${suffix}`}, 'M8.2 node A'), (${`m82-b-${suffix}`}, 'M8.2 node B')
    returning id
  `;
  workstationIds.push(...workstations.map((workstation) => workstation.id));
  const assignments = await sql`
    insert into workstation_assignments (user_id, workstation_id)
    values (${created[0].id}, ${workstations[0].id}), (${created[0].id}, ${workstations[1].id})
    returning id
  `;
  assert.equal(assignments.length, 2);
  await expectDatabaseCode(
    () => sql`
      insert into workstation_assignments (user_id, workstation_id)
      values (${created[0].id}, ${workstations[0].id})
    `,
    '23505'
  );
  await sql`
    update workstation_assignments set status = 'revoked', revoked_at = now()
    where id = ${assignments[0].id}
  `;
  const [newPeriod] = await sql`
    insert into workstation_assignments (user_id, workstation_id)
    values (${created[0].id}, ${workstations[0].id}) returning id
  `;
  assert.notEqual(newPeriod.id, assignments[0].id);

  await sql`delete from users where id = ${created[created.length - 1].id}`;
  userIds.pop();
  const replacement = await createUser(99);
  userIds.push(replacement.id);
  assert.ok(replacement.posix_uid > identities.at(-1));

  console.log('M8.2 database identity and multi-assignment smoke test passed.');
} finally {
  if (userIds.length > 0) await sql`delete from users where id = any(${userIds})`;
  if (workstationIds.length > 0) {
    await sql`delete from workstations where id = any(${workstationIds})`;
  }
  await sql.end();
}
