import { createHash, randomBytes } from 'node:crypto';

import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const secret = (prefix) => `${prefix}${randomBytes(32).toString('base64url')}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const name = `smoke-${randomBytes(4).toString('hex')}`;
const enrollmentToken = secret('cmenroll_');
const credential = secret('cmnode_');
const wrongCredential = secret('cmnode_');
const sql = postgres(databaseUrl, { max: 1 });
let workstationId;

function report(observedAt, cpu) {
  return {
    observedAt,
    nodeVersion: 'smoke-test',
    hostname: name,
    bootId: 'smoke-boot',
    uptimeSeconds: 120,
    inventory: {
      operatingSystem: 'Smoke Linux',
      cpu: { logicalCores: 8, model: 'Smoke CPU', utilizationPercent: cpu },
      memory: { totalBytes: 1000, usedBytes: 400, utilizationPercent: 40 },
      storage: { path: '/', totalBytes: 2000, usedBytes: 500, utilizationPercent: 25 },
      sessions: [{ username: 'smoke', terminal: 'pts/0' }]
    }
  };
}

async function post(path, body, bearer) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function expectStatus(response, expected, label) {
  if (response.status !== expected)
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
}

try {
  const [created] = await sql`
    insert into workstations (name, display_name, enrollment_token_hash, enrollment_expires_at)
    values (${name}, ${'Node smoke test'}, ${hash(enrollmentToken)}, now() + interval '10 minutes')
    returning id
  `;
  workstationId = created.id;

  expectStatus(
    await post('/api/node/v1/enroll', {
      name: `${name}-wrong`,
      token: enrollmentToken,
      credential
    }),
    401,
    'wrong-workstation enrollment'
  );
  expectStatus(
    await post('/api/node/v1/enroll', { name, token: enrollmentToken, credential }),
    200,
    'enrollment'
  );
  expectStatus(
    await post('/api/node/v1/enroll', { name, token: enrollmentToken, credential }),
    200,
    'duplicate enrollment'
  );
  expectStatus(
    await post('/api/node/v1/heartbeat', report(new Date().toISOString(), 77), wrongCredential),
    401,
    'wrong credential'
  );

  const newest = new Date();
  expectStatus(
    await post('/api/node/v1/heartbeat', report(newest.toISOString(), 77), credential),
    200,
    'heartbeat'
  );
  expectStatus(
    await post(
      '/api/node/v1/heartbeat',
      report(new Date(newest.getTime() - 60_000).toISOString(), 5),
      credential
    ),
    200,
    'out-of-order heartbeat'
  );
  const [stored] =
    await sql`select inventory, last_heartbeat_at from workstations where id = ${workstationId}`;
  if (stored.inventory.cpu.utilizationPercent !== 77 || !stored.last_heartbeat_at)
    throw new Error('out-of-order report replaced newer inventory or heartbeat was not recorded');

  await sql`update workstations set credential_hash = null where id = ${workstationId}`;
  expectStatus(
    await post('/api/node/v1/heartbeat', report(new Date().toISOString(), 10), credential),
    401,
    'revoked credential'
  );
  console.log('Node enrollment, authentication, ordering, and revocation smoke test passed.');
} finally {
  if (workstationId) {
    await sql`delete from audit_events where target_type = 'workstation' and target_id = ${workstationId}`;
    await sql`delete from workstations where id = ${workstationId}`;
  }
  await sql.end();
}
