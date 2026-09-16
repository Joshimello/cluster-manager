import assert from 'node:assert/strict';

import { parse } from 'devalue';
import postgres from 'postgres';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';
const databaseUrl = process.env.DATABASE_URL;
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!databaseUrl || !adminUsername || !adminPassword) {
  throw new Error('DATABASE_URL, ADMIN_USERNAME, and ADMIN_PASSWORD are required');
}

class BrowserSession {
  cookie = '';

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await fetch(new URL(path, baseUrl), { ...init, headers, redirect: 'manual' });
    for (const value of response.headers.getSetCookie()) {
      this.cookie = value.includes('Max-Age=0') ? '' : value.split(';', 1)[0];
    }
    return response;
  }

  async form(path, values) {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl },
      body: new URLSearchParams(values)
    });
  }
}

async function actionResult(response) {
  const payload = await response.json();
  if (payload.type === 'redirect') return { redirect: payload.location, status: payload.status };
  return { ...parse(payload.data), status: payload.status };
}

async function createAndLoginUser(admin, username, workstationId) {
  const created = await actionResult(
    await admin.form('/admin/users?/create', {
      username,
      displayName: `M6 ${username}`,
      role: 'user'
    })
  );
  assert.equal(created.success, true);
  const assigned = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', {
      userId: created.createdUserId,
      workstationId
    })
  );
  assert.equal(assigned.success, true);

  const user = new BrowserSession();
  let result = await actionResult(
    await user.form('/login', { username, password: created.temporaryPassword })
  );
  assert.equal(result.redirect, '/change-password');
  const password = `M6-correlation-${username}!`;
  result = await actionResult(
    await user.form('/change-password', {
      currentPassword: created.temporaryPassword,
      newPassword: password,
      confirmation: password
    })
  );
  assert.equal(result.redirect, '/dashboard');
  return { userId: created.createdUserId, user };
}

const sql = postgres(databaseUrl, { max: 2 });
const userIds = [];
const reservationIds = [];
try {
  const anonymous = new BrowserSession();
  let response = await anonymous.request('/admin/monitoring');
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /^\/login/);

  const admin = new BrowserSession();
  let result = await actionResult(
    await admin.form('/login', { username: adminUsername, password: adminPassword })
  );
  assert.equal(result.redirect, '/dashboard');

  const [target] = await sql`
    select w.id as workstation_id, g.id as gpu_id
    from workstations w
    join gpus g on g.workstation_id = w.id and g.active and g.local_index = 0
    where w.name = 'ws02'
      and not exists (
        select 1 from reservations r
        where r.gpu_id = g.id and r.status = 'active'
          and r.start_at <= now() and r.end_at > now()
      )
    limit 1
  `;
  assert.ok(target, 'ws02 GPU 0 must be reporting and currently unreserved');
  const [sample] = await sql`
    select p.username, p.pid
    from gpus g
    join gpu_observations o on o.gpu_id = g.id and o.observed_at = g.last_observed_at
    join gpu_process_observations p on p.observation_id = o.id
    where g.id = ${target.gpu_id} and p.username = 'researcher'
  `;
  assert.equal(sample?.pid, 4102, 'ws02 multi-user simulation must be active');

  for (const username of ['m6alice', 'researcher']) {
    const [existing] = await sql`select id from users where username = ${username}`;
    assert.equal(existing, undefined, `development user ${username} must not already exist`);
  }
  const alice = await createAndLoginUser(admin, 'm6alice', target.workstation_id);
  const researcher = await createAndLoginUser(admin, 'researcher', target.workstation_id);
  userIds.push(alice.userId, researcher.userId);

  response = await alice.user.request('/admin/monitoring');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/dashboard');

  const startAt = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000);
  const endAt = new Date(startAt.getTime() + 2 * 1_800_000);
  let [reservation] = await sql`
    insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at)
    values (${target.gpu_id}, ${alice.userId}, ${alice.userId}, ${startAt}, ${endAt})
    returning id
  `;
  reservationIds.push(reservation.id);

  response = await alice.user.request('/dashboard');
  let html = await response.text();
  assert.match(html, /Conflict/);
  assert.match(html, /non-owner or unresolved process/);
  assert.doesNotMatch(html, /researcher/);
  assert.doesNotMatch(html, /4102/);

  response = await admin.request('/admin/monitoring?state=conflict');
  html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Conflict/);
  assert.match(html, /researcher/);
  assert.match(html, /4102/);

  await sql`delete from reservations where id = ${reservation.id}`;
  response = await admin.request('/admin/monitoring?state=unbooked-use');
  html = await response.text();
  assert.match(html, /Unbooked use/);
  assert.match(html, /4102/);

  [reservation] = await sql`
    insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at)
    values (${target.gpu_id}, ${researcher.userId}, ${researcher.userId}, ${startAt}, ${endAt})
    returning id
  `;
  reservationIds.push(reservation.id);
  response = await researcher.user.request('/dashboard');
  html = await response.text();
  assert.match(html, /Booked · active/);
  assert.match(html, /4102/);
  assert.doesNotMatch(html, /Conflict/);

  console.log('Milestone 6 correlation states, privacy, filters, and authorization passed.');
} finally {
  if (reservationIds.length > 0) {
    await sql`delete from reservations where id = any(${reservationIds})`;
  }
  for (const userId of userIds) {
    await sql`delete from audit_events where target_type = 'user' and target_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  await sql.end();
}
