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

async function waitForApplied(sql, assignmentId, minimumGeneration) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const [assignment] = await sql`
      select status, desired_generation, applied_generation, provisioning_status
      from workstation_assignments where id = ${assignmentId}
    `;
    if (
      assignment?.desired_generation >= minimumGeneration &&
      assignment.applied_generation === assignment.desired_generation &&
      assignment.provisioning_status === 'applied'
    ) {
      return assignment;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`assignment ${assignmentId} was not reconciled`);
}

const sql = postgres(databaseUrl, { max: 1 });
let userId;
try {
  const admin = new BrowserSession();
  let result = await actionResult(
    await admin.form('/login', { username: adminUsername, password: adminPassword })
  );
  assert.equal(result.redirect, '/dashboard');

  const suffix = Date.now().toString(36);
  const username = `assignment-${suffix}`;
  const displayName = `Assignment Smoke ${suffix}`;
  const permanentPassword = `Assignment-shared-password-${suffix}!`;
  result = await actionResult(
    await admin.form('/admin/users?/create', { username, displayName, role: 'user' })
  );
  assert.equal(result.success, true);
  userId = result.createdUserId;
  const temporaryPassword = result.temporaryPassword;

  const workstations = await sql`select id, name from workstations where name in ('ws01', 'ws02')`;
  const ws01 = workstations.find((workstation) => workstation.name === 'ws01');
  const ws02 = workstations.find((workstation) => workstation.name === 'ws02');
  assert.ok(ws01?.id);
  assert.ok(ws02?.id);
  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', {
      userId,
      workstationId: ws01.id
    })
  );
  assert.equal(result.success, true);
  const [ws01Assignment] = await sql`
    select id from workstation_assignments
    where user_id = ${userId} and workstation_id = ${ws01.id} and status = 'active'
  `;
  await waitForApplied(sql, ws01Assignment.id, 1);

  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', {
      userId,
      workstationId: ws02.id
    })
  );
  assert.equal(result.success, true);
  const [ws02Assignment] = await sql`
    select id from workstation_assignments
    where user_id = ${userId} and workstation_id = ${ws02.id} and status = 'active'
  `;
  await Promise.all([
    waitForApplied(sql, ws01Assignment.id, 1),
    waitForApplied(sql, ws02Assignment.id, 1)
  ]);

  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', {
      userId,
      workstationId: ws01.id
    })
  );
  assert.equal(result.status, 400);
  assert.match(result.message, /already assigned/i);

  const user = new BrowserSession();
  result = await actionResult(await user.form('/login', { username, password: temporaryPassword }));
  assert.equal(result.redirect, '/change-password');
  result = await actionResult(
    await user.form('/change-password', {
      currentPassword: temporaryPassword,
      newPassword: permanentPassword,
      confirmation: permanentPassword
    })
  );
  assert.equal(result.redirect, '/dashboard');
  await Promise.all([
    waitForApplied(sql, ws01Assignment.id, 2),
    waitForApplied(sql, ws02Assignment.id, 2)
  ]);

  const dashboard = await user.request('/dashboard');
  assert.equal(dashboard.status, 200);
  const dashboardHTML = await dashboard.text();
  assert.match(dashboardHTML, new RegExp(`ssh ${username}@ws01`));
  assert.match(dashboardHTML, new RegExp(`ssh ${username}@ws02`));
  assert.match(dashboardHTML, /same password as this platform account/i);

  result = await actionResult(
    await admin.form('/admin/users?/revokeWorkstation', { assignmentId: ws01Assignment.id })
  );
  assert.equal(result.success, true);
  const revoked = await waitForApplied(sql, ws01Assignment.id, 3);
  assert.equal(revoked.status, 'revoked');
  const [stillActive] = await sql`
    select status, desired_generation, applied_generation, provisioning_status
    from workstation_assignments where id = ${ws02Assignment.id}
  `;
  assert.equal(stillActive.status, 'active');
  assert.equal(stillActive.desired_generation, 2);
  assert.equal(stillActive.applied_generation, 2);
  assert.equal(stillActive.provisioning_status, 'applied');

  console.log(
    `Multi-assignment, password synchronization, duplicate rejection, and targeted revocation passed for ${username}.`
  );
} finally {
  if (userId) {
    await sql`delete from audit_events where target_type = 'user' and target_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  await sql.end();
}
