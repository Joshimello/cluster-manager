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

async function waitUntil(description, check) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const sql = postgres(databaseUrl, { max: 1 });
let userId;
try {
  const admin = new BrowserSession();
  let result = await actionResult(
    await admin.form('/login', { username: adminUsername, password: adminPassword })
  );
  assert.equal(result.redirect, '/dashboard');

  const workstations = await waitUntil('both simulated GPU inventories', async () => {
    const rows = await sql`
      select w.id, w.name, count(g.id)::int as gpu_count
      from workstations w
      left join gpus g on g.workstation_id = w.id and g.active
      where w.name in ('ws01', 'ws02')
      group by w.id, w.name
      order by w.name
    `;
    return rows.length === 2 && rows.every((row) => row.gpu_count === 2) ? rows : null;
  });
  const ws01 = workstations.find((workstation) => workstation.name === 'ws01');
  const ws02 = workstations.find((workstation) => workstation.name === 'ws02');

  await waitUntil('changing ws01 telemetry', async () => {
    const [row] = await sql`
      select count(distinct o.utilization_percent)::int as states
      from gpu_observations o
      join gpus g on g.id = o.gpu_id
      where g.workstation_id = ${ws01.id}
        and g.local_index = 0
        and o.observed_at > now() - interval '2 minutes'
    `;
    return row.states >= 2;
  });

  const [processSummary] = await sql`
    select count(*)::int as process_count,
      count(*) filter (where p.username = 'analyst')::int as analyst_count
    from gpu_process_observations p
    join gpu_observations o on o.id = p.observation_id
    join gpus g on g.id = o.gpu_id and g.last_observed_at = o.observed_at
    where g.workstation_id = ${ws02.id}
  `;
  assert.equal(processSummary.process_count, 3);
  assert.equal(processSummary.analyst_count, 2);

  const [existing] = await sql`select id from users where username = 'analyst'`;
  assert.equal(existing, undefined, 'The M4 smoke test requires the development username analyst');
  result = await actionResult(
    await admin.form('/admin/users?/create', {
      username: 'analyst',
      displayName: 'M4 Test Analyst',
      role: 'user'
    })
  );
  assert.equal(result.success, true);
  userId = result.createdUserId;
  const temporaryPassword = result.temporaryPassword;

  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', { userId, workstationId: ws02.id })
  );
  assert.equal(result.success, true);
  await waitUntil('analyst account reconciliation', async () => {
    const [assignment] = await sql`
      select provisioning_status, desired_generation, applied_generation
      from workstation_assignments where user_id = ${userId} and status = 'active'
    `;
    return (
      assignment?.provisioning_status === 'applied' &&
      assignment.applied_generation === assignment.desired_generation
    );
  });

  const user = new BrowserSession();
  result = await actionResult(
    await user.form('/login', { username: 'analyst', password: temporaryPassword })
  );
  assert.equal(result.redirect, '/change-password');
  const permanentPassword = `M4-monitoring-${Date.now()}!`;
  result = await actionResult(
    await user.form('/change-password', {
      currentPassword: temporaryPassword,
      newPassword: permanentPassword,
      confirmation: permanentPassword
    })
  );
  assert.equal(result.redirect, '/dashboard');

  const dashboard = await user.request('/dashboard');
  assert.equal(dashboard.status, 200);
  const dashboardHTML = await dashboard.text();
  assert.match(dashboardHTML, /Your GPU processes/);
  assert.match(dashboardHTML, /Storage availability/);
  assert.match(dashboardHTML, /5210/);
  assert.match(dashboardHTML, /5277/);
  assert.doesNotMatch(dashboardHTML, /4102/);

  const adminMonitoring = await admin.request(`/admin/workstations/${ws02.id}`);
  assert.equal(adminMonitoring.status, 200);
  const adminHTML = await adminMonitoring.text();
  assert.match(adminHTML, /arguments and environment variables are never collected/i);
  assert.match(adminHTML, /4102/);
  assert.match(adminHTML, /5210/);

  const [gpu] = await sql`select id from gpus where workstation_id = ${ws02.id} limit 1`;
  const [oldObservation] = await sql`
    insert into gpu_observations (
      gpu_id, observed_at, utilization_percent, memory_used_bytes, memory_total_bytes
    ) values (${gpu.id}, now() - interval '25 hours', 0, 0, 1)
    returning id
  `;
  await waitUntil('24-hour observation retention', async () => {
    const [remaining] = await sql`select id from gpu_observations where id = ${oldObservation.id}`;
    return remaining === undefined;
  });

  console.log(
    'Milestone 4 GPU inventory, changing telemetry, process attribution, visibility, and retention passed.'
  );
} finally {
  if (userId) {
    await sql`delete from audit_events where target_type = 'user' and target_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  await sql.end();
}
