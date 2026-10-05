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
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        origin: baseUrl
      },
      body: new URLSearchParams(values)
    });
  }
}

async function actionResult(response) {
  const payload = await response.json();
  if (payload.type === 'redirect') return { redirect: payload.location, status: payload.status };
  return { ...parse(payload.data), status: payload.status };
}

async function createReadyUser(admin, username, workstationId) {
  let result = await actionResult(
    await admin.form('/admin/users?/create', {
      username,
      displayName: `Reservation ${username}`,
      role: 'user'
    })
  );
  assert.equal(result.success, true);
  const userId = result.createdUserId;
  const temporaryPassword = result.temporaryPassword;
  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', { userId, workstationId })
  );
  assert.equal(result.success, true);
  const user = new BrowserSession();
  result = await actionResult(await user.form('/login', { username, password: temporaryPassword }));
  assert.equal(result.redirect, '/change-password');
  const permanentPassword = `Reservation-${username}!`;
  result = await actionResult(
    await user.form('/change-password', {
      currentPassword: temporaryPassword,
      newPassword: permanentPassword,
      confirmation: permanentPassword
    })
  );
  assert.equal(result.redirect, '/dashboard');
  return { userId, user };
}

const sql = postgres(databaseUrl, { max: 5 });
const userIds = [];
const reservationIds = [];
try {
  const admin = new BrowserSession();
  let result = await actionResult(
    await admin.form('/login', { username: adminUsername, password: adminPassword })
  );
  assert.equal(result.redirect, '/dashboard');
  const [policy] = await sql`select * from reservation_policy where id = 1`;
  if (policy && policy.time_zone !== 'UTC')
    throw new Error('This smoke test requires UTC scheduling.');
  const [workstation] =
    await sql`select id from workstations where status = 'active' and deleted_at is null order by name limit 1`;
  assert.ok(workstation?.id, 'An active workstation is required.');
  const gpus =
    await sql`select id from gpus where workstation_id = ${workstation.id} and active order by local_index`;
  assert.ok(gpus.length >= 2, 'At least two active GPUs are required.');
  const suffix = Date.now().toString(36).slice(-8);
  const first = await createReadyUser(admin, `slot-a-${suffix}`, workstation.id);
  const second = await createReadyUser(admin, `slot-b-${suffix}`, workstation.id);
  userIds.push(first.userId, second.userId);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600_000);
  const request = { gpuId: gpus[0].id, startAt: start.toISOString(), endAt: end.toISOString() };
  const attempts = await Promise.all([
    first.user.form('/dashboard?/create', request).then(actionResult),
    second.user.form('/dashboard?/create', request).then(actionResult)
  ]);
  assert.equal(attempts.filter((attempt) => attempt.success).length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 409).length, 1);
  const [winner] =
    await sql`select id, user_id, quota_kind from reservations where gpu_id = ${gpus[0].id} and start_at = ${start} and status = 'active'`;
  reservationIds.push(winner.id);
  assert.equal(
    winner.quota_kind,
    (policy?.dynamic_slots_tomorrow ?? 2) > 0 ? 'dynamic' : 'standard'
  );
  const loser = winner.user_id === first.userId ? second : first;
  const page = await loser.user.request('/dashboard');
  const html = await page.text();
  assert.match(html, /Seven-day schedule/);
  assert.match(html, /Seven-day reservation timeline/);
  assert.match(html, /slot-[ab]-/);
  result = await actionResult(
    await loser.user.form('/dashboard?/create', {
      ...request,
      startAt: end.toISOString(),
      endAt: new Date(end.getTime() + 2 * 3600_000).toISOString()
    })
  );
  assert.equal(result.success, true, 'Adjacent fixed slots should be allowed.');
  result = await actionResult(
    await first.user.form('/dashboard?/create', {
      ...request,
      gpuId: gpus[1].id,
      startAt: new Date(start.getTime() + 1800_000).toISOString()
    })
  );
  assert.match(result.message, /fixed slot/);
  const far = new Date(start);
  far.setUTCDate(far.getUTCDate() + 8);
  result = await actionResult(
    await first.user.form('/dashboard?/create', {
      ...request,
      gpuId: gpus[1].id,
      startAt: far.toISOString(),
      endAt: new Date(far.getTime() + 2 * 3600_000).toISOString()
    })
  );
  assert.match(result.message, /seven days/);
  const [actor] = await sql`select id from users where username = ${adminUsername}`;
  const adminInput = {
    target: `${actor.id}:${gpus[1].id}`,
    startAt: start.toISOString().slice(0, 16),
    endAt: end.toISOString().slice(0, 16),
    adminOverride: 'true',
    overrideReason: 'Fixed-slot smoke test'
  };
  result = await actionResult(await admin.form('/admin/reservations?/create', adminInput));
  assert.equal(result.success, true, 'Unassigned administrators can book active GPUs.');
  const [override] =
    await sql`select id from reservations where user_id = ${actor.id} and gpu_id = ${gpus[1].id} and start_at = ${start}`;
  reservationIds.push(override.id);
  result = await actionResult(await admin.form('/admin/reservations?/create', adminInput));
  assert.equal(result.status, 409, 'Admin bypass must still prevent overlaps.');
  result = await actionResult(
    await admin.form('/admin/reservations?/cancel', {
      reservationId: override.id,
      reason: 'Smoke test completed'
    })
  );
  assert.equal(result.success, true);
  const winnerSession = winner.user_id === first.userId ? first : second;
  result = await actionResult(
    await winnerSession.user.form('/dashboard?/cancel', { reservationId: winner.id })
  );
  assert.equal(result.success, true);
  console.log(
    'Fixed-slot booking, timeline, conflict, assignment bypass, and cancellation smoke checks passed.'
  );
} finally {
  if (reservationIds.length) {
    await sql`delete from audit_events where target_id = any(${reservationIds})`;
    await sql`delete from reservations where id = any(${reservationIds})`;
  }
  if (userIds.length) {
    await sql`delete from audit_events where actor_user_id = any(${userIds}) or target_id = any(${userIds})`;
    await sql`delete from reservations where user_id = any(${userIds}) or created_by_user_id = any(${userIds})`;
    await sql`delete from workstation_assignments where user_id = any(${userIds})`;
    await sql`delete from users where id = any(${userIds})`;
  }
  await sql.end();
}
