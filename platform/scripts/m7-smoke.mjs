import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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

async function waitUntil(description, check, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function createAndLoginUser(admin, username, workstationId) {
  const created = await actionResult(
    await admin.form('/admin/users?/create', {
      username,
      displayName: `M7 ${username}`,
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
  const password = `M7-intervention-${username}!`;
  result = await actionResult(
    await user.form('/change-password', {
      currentPassword: created.temporaryPassword,
      newPassword: password,
      confirmation: password
    })
  );
  assert.equal(result.redirect, '/dashboard');
  return { id: created.createdUserId, user };
}

const sql = postgres(databaseUrl, { max: 3 });
const userIds = [];
const reservationIds = [];
let fakeWorkstationId;
try {
  const admin = new BrowserSession();
  let result = await actionResult(
    await admin.form('/login', { username: adminUsername, password: adminPassword })
  );
  assert.equal(result.redirect, '/dashboard');

  const target = await waitUntil('ws01 reservation-conflict simulation', async () => {
    const [row] = await sql`
      select w.id as workstation_id, g.id as gpu_id, g.gpu_uuid, p.pid, p.uid,
        p.username, p.command, p.memory_used_bytes, p.process_start_ticks
      from workstations w
      join gpus g on g.workstation_id = w.id and g.active and g.local_index = 0
      join gpu_observations o on o.gpu_id = g.id and o.observed_at = g.last_observed_at
      join gpu_process_observations p on p.observation_id = o.id
      where w.name = 'ws01' and p.username = 'bob'
    `;
    return row ?? null;
  });
  assert.equal(target.pid, 6101);
  assert.ok(target.process_start_ticks);

  for (const username of ['alice', 'm7carol']) {
    const [existing] = await sql`select id from users where username = ${username}`;
    assert.equal(existing, undefined, `development user ${username} must not already exist`);
  }
  const alice = await createAndLoginUser(admin, 'alice', target.workstation_id);
  const carol = await createAndLoginUser(admin, 'm7carol', target.workstation_id);
  userIds.push(alice.id, carol.id);

  const startAt = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000);
  const endAt = new Date(startAt.getTime() + 2 * 1_800_000);
  const [reservation] = await sql`
    insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at)
    values (${target.gpu_id}, ${alice.id}, ${alice.id}, ${startAt}, ${endAt}) returning id
  `;
  reservationIds.push(reservation.id);

  let response = await alice.user.request('/dashboard');
  let html = await response.text();
  assert.match(html, /Conflict/);
  assert.match(html, /Request intervention/);
  assert.doesNotMatch(html, /bob/);
  assert.doesNotMatch(html, /6101/);

  result = await actionResult(
    await carol.user.form('/stop-requests?/create', { gpuId: target.gpu_id })
  );
  assert.equal(result.status, 403);
  response = await carol.user.request('/admin/stop-requests');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/dashboard');

  result = await actionResult(
    await alice.user.form('/stop-requests?/create', { gpuId: target.gpu_id })
  );
  assert.equal(result.success, true);
  const [realRequest] = await sql`
    select * from stop_requests where requester_user_id = ${alice.id}
      and target_pid = ${target.pid} and status = 'pending'
  `;
  assert.ok(realRequest?.id);
  assert.equal(realRequest.target_uid, target.uid);
  assert.equal(Number(realRequest.target_process_start_ticks), Number(target.process_start_ticks));

  result = await actionResult(
    await alice.user.form('/stop-requests?/create', { gpuId: target.gpu_id })
  );
  assert.equal(result.status, 409);

  response = await alice.user.request('/stop-requests');
  html = await response.text();
  assert.match(html, /pending/i);
  assert.doesNotMatch(html, /bob/);
  assert.doesNotMatch(html, /6101/);

  const [exitedFirst] = await sql`
    insert into stop_requests (
      reservation_id, gpu_id, workstation_id, requester_user_id, target_pid, target_uid,
      target_username, target_command, target_memory_used_bytes, target_process_start_ticks
    ) values (
      ${reservation.id}, ${target.gpu_id}, ${target.workstation_id}, ${alice.id},
      999999, 1002, 'gone-user', 'gone', 0, 42
    ) returning id
  `;
  await alice.user.request('/stop-requests');
  const [stale] = await sql`select status from stop_requests where id = ${exitedFirst.id}`;
  assert.equal(stale.status, 'stale');

  const [mismatchRequest] = await sql`
    insert into stop_requests (
      reservation_id, gpu_id, workstation_id, requester_user_id, status, target_pid,
      target_uid, target_username, target_command, target_memory_used_bytes,
      target_process_start_ticks, decision_reason
    ) values (
      ${reservation.id}, ${target.gpu_id}, ${target.workstation_id}, ${alice.id},
      'termination_requested', ${target.pid}, ${target.uid}, ${target.username},
      ${target.command}, ${target.memory_used_bytes}, ${Number(target.process_start_ticks) + 1},
      'M7 identity mismatch test'
    ) returning id
  `;
  const [mismatchInstruction] = await sql`
    insert into termination_instructions (
      stop_request_id, workstation_id, requested_by_user_id, gpu_uuid, target_pid,
      target_uid, target_process_start_ticks, expires_at
    ) values (
      ${mismatchRequest.id}, ${target.workstation_id},
      (select id from users where username = ${adminUsername}), ${target.gpu_uuid},
      ${target.pid}, ${target.uid}, ${Number(target.process_start_ticks) + 1}, now() + interval '60 seconds'
    ) returning id
  `;
  const mismatchResult = await waitUntil('node refusal of changed process identity', async () => {
    const [row] = await sql`
      select status, outcome, term_sent from termination_instructions
      where id = ${mismatchInstruction.id}
    `;
    return row?.status === 'completed' ? row : null;
  });
  assert.equal(mismatchResult.outcome, 'refused_identity');
  assert.equal(mismatchResult.term_sent, false);

  response = await admin.request(`/admin/stop-requests/${realRequest.id}`);
  html = await response.text();
  assert.match(html, /Identity still matches/);
  assert.match(html, /bob/);
  assert.match(html, /6101/);

  result = await actionResult(
    await admin.form(`/admin/stop-requests/${realRequest.id}?/terminate`, {
      reason: 'Confirmed conflicting development process',
      confirmIdentity: 'yes',
      allowSigkill: 'yes'
    })
  );
  assert.equal(result.success, true);
  const completion = await waitUntil('simulated process termination', async () => {
    const [row] = await sql`
      select sr.status, ti.status as instruction_status, ti.outcome, ti.term_sent
      from stop_requests sr
      join termination_instructions ti on ti.stop_request_id = sr.id
      where sr.id = ${realRequest.id}
    `;
    return row?.instruction_status === 'completed' ? row : null;
  });
  assert.equal(completion.status, 'resolved');
  assert.equal(completion.outcome, 'terminated');
  assert.equal(completion.term_sent, true);

  await waitUntil('cleared simulated conflict', async () => {
    const [row] = await sql`
      select count(*)::int as count
      from gpus g
      join gpu_observations o on o.gpu_id = g.id and o.observed_at = g.last_observed_at
      join gpu_process_observations p on p.observation_id = o.id
      where g.id = ${target.gpu_id} and p.pid = ${target.pid}
    `;
    return row.count === 0;
  });
  response = await alice.user.request('/dashboard');
  html = await response.text();
  assert.match(html, /Booked · idle/);
  assert.doesNotMatch(html, /Request intervention/);

  const fakeCredential = `cmnode_${'C'.repeat(43)}`;
  const credentialHash = createHash('sha256').update(fakeCredential).digest('hex');
  const [fakeWorkstation] = await sql`
    insert into workstations (name, display_name, credential_hash, enrolled_at)
    values ('m7-api-node', 'M7 API Node', ${credentialHash}, now()) returning id
  `;
  fakeWorkstationId = fakeWorkstation.id;
  const [fakeGpu] = await sql`
    insert into gpus (
      workstation_id, gpu_uuid, local_index, model, last_observed_at,
      utilization_percent, memory_used_bytes, memory_total_bytes
    ) values (${fakeWorkstation.id}, 'GPU-m7-api', 0, 'API test GPU', now(), 0, 0, 1)
    returning id
  `;
  const [fakeReservation] = await sql`
    insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at)
    values (${fakeGpu.id}, ${alice.id}, ${alice.id}, ${startAt}, ${endAt}) returning id
  `;
  reservationIds.push(fakeReservation.id);
  const [fakeRequest] = await sql`
    insert into stop_requests (
      reservation_id, gpu_id, workstation_id, requester_user_id, status, target_pid,
      target_uid, target_username, target_command, target_memory_used_bytes,
      target_process_start_ticks
    ) values (
      ${fakeReservation.id}, ${fakeGpu.id}, ${fakeWorkstation.id}, ${alice.id},
      'termination_requested', 4242, 1002, 'bob', 'python', 1, 12345
    ) returning id
  `;
  const [fakeInstruction] = await sql`
    insert into termination_instructions (
      stop_request_id, workstation_id, requested_by_user_id, gpu_uuid, target_pid,
      target_uid, target_process_start_ticks, expires_at
    ) values (
      ${fakeRequest.id}, ${fakeWorkstation.id},
      (select id from users where username = ${adminUsername}), 'GPU-m7-api',
      4242, 1002, 12345, now() + interval '60 seconds'
    ) returning id
  `;
  const headers = { authorization: `Bearer ${fakeCredential}` };
  response = await admin.request('/api/node/v1/termination/next', { headers });
  assert.equal(response.status, 200);
  const instruction = await response.json();
  assert.equal(instruction.instructionId, fakeInstruction.id);
  const report = {
    instructionId: instruction.instructionId,
    outcome: 'already_exited',
    detail: 'Target exited before the node action.',
    termSent: false,
    killSent: false
  };
  response = await admin.request('/api/node/v1/termination/result', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(report)
  });
  assert.equal(response.status, 200);
  response = await admin.request('/api/node/v1/termination/result', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(report)
  });
  assert.equal(response.status, 409, 'a completed instruction must not be replayable');

  const [expiredRequest] = await sql`
    insert into stop_requests (
      reservation_id, gpu_id, workstation_id, requester_user_id, status, target_pid,
      target_uid, target_username, target_command, target_memory_used_bytes,
      target_process_start_ticks
    ) values (
      ${fakeReservation.id}, ${fakeGpu.id}, ${fakeWorkstation.id}, ${alice.id},
      'termination_requested', 4343, 1002, 'bob', 'python', 1, 54321
    ) returning id
  `;
  const [expiredInstruction] = await sql`
    insert into termination_instructions (
      stop_request_id, workstation_id, requested_by_user_id, gpu_uuid, target_pid,
      target_uid, target_process_start_ticks, expires_at
    ) values (
      ${expiredRequest.id}, ${fakeWorkstation.id},
      (select id from users where username = ${adminUsername}), 'GPU-m7-api',
      4343, 1002, 54321, now() - interval '1 second'
    ) returning id
  `;
  response = await admin.request('/api/node/v1/termination/next', { headers });
  assert.equal(response.status, 204, 'an expired instruction must not be dispatched');
  const [expiredState] = await sql`
    select ti.status as instruction_status, sr.status as request_status
    from termination_instructions ti
    join stop_requests sr on sr.id = ti.stop_request_id
    where ti.id = ${expiredInstruction.id}
  `;
  assert.equal(expiredState.instruction_status, 'expired');
  assert.equal(expiredState.request_status, 'failed');

  await sql`update workstations set status = 'disabled' where id = ${fakeWorkstation.id}`;
  response = await admin.request('/api/node/v1/termination/next', { headers });
  assert.equal(response.status, 401, 'revoked node credentials must be rejected');

  const [audit] = await sql`
    select count(*) filter (where action = 'stop_request.created')::int as created,
      count(*) filter (where action = 'stop_request.termination_requested')::int as requested,
      count(*) filter (where action = 'termination.dispatched')::int as dispatched,
      count(*) filter (where action = 'termination.completed')::int as completed,
      count(*) filter (where action = 'stop_request.stale')::int as stale
    from audit_events
    where target_id in (${realRequest.id}, ${exitedFirst.id}, ${mismatchRequest.id}, ${fakeRequest.id})
  `;
  assert.ok(
    audit.created >= 1 &&
      audit.requested >= 1 &&
      audit.dispatched >= 2 &&
      audit.completed >= 2 &&
      audit.stale >= 1
  );

  console.log(
    'Milestone 7 request lifecycle, authorization, identity safety, replay protection, simulated termination, and auditing passed.'
  );
} finally {
  if (userIds.length > 0) {
    await sql`
      delete from termination_instructions where stop_request_id in (
        select id from stop_requests where requester_user_id = any(${userIds})
      )
    `;
    await sql`delete from stop_requests where requester_user_id = any(${userIds})`;
  }
  if (reservationIds.length > 0) {
    await sql`delete from reservations where id = any(${reservationIds})`;
  }
  for (const userId of userIds) {
    await sql`delete from audit_events where target_type = 'user' and target_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  if (fakeWorkstationId) {
    await sql`delete from workstations where id = ${fakeWorkstationId}`;
  }
  await sql.end();
}
