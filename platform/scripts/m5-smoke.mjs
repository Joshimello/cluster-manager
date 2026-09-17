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

function localInput(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60_000);
  return local.toISOString().slice(0, 16);
}

async function createReadyUser(admin, username, workstationId) {
  let result = await actionResult(
    await admin.form('/admin/users?/create', {
      username,
      displayName: `M5 ${username}`,
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
  const permanentPassword = `M5-reservation-${username}!`;
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
let inactiveGpuId;
try {
  const admin = new BrowserSession();
  let result = await actionResult(
    await admin.form('/login', { username: adminUsername, password: adminPassword })
  );
  assert.equal(result.redirect, '/dashboard');

  const [ws01] = await sql`select id from workstations where name = 'ws01'`;
  const [ws02] = await sql`select id from workstations where name = 'ws02'`;
  assert.ok(ws01?.id && ws02?.id);
  const ws01Gpus = await sql`
    select id, local_index from gpus where workstation_id = ${ws01.id} and active order by local_index
  `;
  const [ws02Gpu] = await sql`
    select id from gpus where workstation_id = ${ws02.id} and active order by local_index limit 1
  `;
  assert.equal(ws01Gpus.length, 2);
  assert.ok(ws02Gpu?.id);

  const suffix = Date.now().toString(36).slice(-7);
  const firstUsername = `m5a-${suffix}`;
  const secondUsername = `m5b-${suffix}`;
  const disabledUsername = `m5d-${suffix}`;
  const first = await createReadyUser(admin, firstUsername, ws01.id);
  const second = await createReadyUser(admin, secondUsername, ws01.id);
  userIds.push(first.userId, second.userId);

  result = await actionResult(
    await admin.form('/admin/users?/create', {
      username: disabledUsername,
      displayName: `M5 ${disabledUsername}`,
      role: 'user'
    })
  );
  assert.equal(result.success, true);
  const disabledUserId = result.createdUserId;
  userIds.push(disabledUserId);
  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', {
      userId: disabledUserId,
      workstationId: ws01.id
    })
  );
  assert.equal(result.success, true);
  await sql`update users set status = 'disabled' where id = ${disabledUserId}`;

  const start = new Date(Math.ceil((Date.now() + 60 * 60_000) / 1_800_000) * 1_800_000);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  const request = {
    gpuId: ws01Gpus[0].id,
    startAt: localInput(start),
    endAt: localInput(end)
  };
  const attempts = await Promise.all([
    actionResult(await first.user.form('/reservations?/create', request)),
    actionResult(await second.user.form('/reservations?/create', request))
  ]);
  assert.equal(attempts.filter((attempt) => attempt.success === true).length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 409).length, 1);
  const [winner] = await sql`
    select id, user_id from reservations
    where gpu_id = ${ws01Gpus[0].id} and start_at = ${start} and status = 'active'
  `;
  assert.ok(winner?.id);
  reservationIds.push(winner.id);

  const winnerUsername = winner.user_id === first.userId ? firstUsername : secondUsername;
  const loser = winner.user_id === first.userId ? second : first;
  const loserPage = await loser.user.request('/reservations');
  const loserHTML = await loserPage.text();
  assert.match(loserHTML, /Reserved/);
  assert.doesNotMatch(loserHTML, new RegExp(winnerUsername));

  result = await actionResult(
    await loser.user.form('/reservations?/create', {
      gpuId: ws01Gpus[0].id,
      startAt: localInput(end),
      endAt: localInput(new Date(end.getTime() + 30 * 60_000))
    })
  );
  assert.equal(result.success, true, 'adjacent reservation should be allowed');
  const [adjacent] = await sql`
    select id from reservations
    where gpu_id = ${ws01Gpus[0].id} and start_at = ${end} and status = 'active'
  `;
  reservationIds.push(adjacent.id);

  for (const invalid of [
    {
      values: {
        gpuId: ws01Gpus[1].id,
        startAt: localInput(new Date(start.getTime() + 15 * 60_000)),
        endAt: localInput(new Date(start.getTime() + 60 * 60_000))
      },
      message: /30-minute/
    },
    {
      values: {
        gpuId: ws01Gpus[1].id,
        startAt: localInput(start),
        endAt: localInput(new Date(start.getTime() + 6.5 * 60 * 60_000))
      },
      message: /six hours/
    },
    {
      values: {
        gpuId: ws01Gpus[1].id,
        startAt: localInput(new Date(start.getTime() + 8 * 24 * 60 * 60_000)),
        endAt: localInput(new Date(start.getTime() + 8 * 24 * 60 * 60_000 + 30 * 60_000))
      },
      message: /seven days/
    },
    {
      values: {
        gpuId: ws02Gpu.id,
        startAt: localInput(start),
        endAt: localInput(new Date(start.getTime() + 30 * 60_000))
      },
      message: /not eligible/
    }
  ]) {
    result = await actionResult(await first.user.form('/reservations?/create', invalid.values));
    assert.match(result.message, invalid.message);
  }

  [inactiveGpuId] = await sql`
    insert into gpus (
      workstation_id, gpu_uuid, local_index, model, active, last_observed_at,
      utilization_percent, memory_used_bytes, memory_total_bytes
    ) values (${ws01.id}, ${`GPU-inactive-${suffix}`}, 31, 'Inactive test GPU', false, now(), 0, 0, 1)
    returning id
  `;
  result = await actionResult(
    await first.user.form('/reservations?/create', {
      gpuId: inactiveGpuId.id,
      startAt: localInput(start),
      endAt: localInput(new Date(start.getTime() + 30 * 60_000))
    })
  );
  assert.match(result.message, /not eligible/);

  result = await actionResult(
    await admin.form('/admin/reservations?/create', {
      target: `${disabledUserId}:${ws01Gpus[1].id}`,
      startAt: localInput(start),
      endAt: localInput(new Date(start.getTime() + 30 * 60_000)),
      adminOverride: 'false',
      overrideReason: ''
    })
  );
  assert.match(result.message, /not eligible/);

  const overrideStart = new Date(start.getTime() + 8 * 24 * 60 * 60_000);
  const overrideEnd = new Date(overrideStart.getTime() + 8 * 60 * 60_000);
  result = await actionResult(
    await admin.form('/admin/reservations?/create', {
      target: `${first.userId}:${ws01Gpus[1].id}`,
      startAt: localInput(overrideStart),
      endAt: localInput(overrideEnd),
      adminOverride: 'true',
      overrideReason: 'Approved extended research run'
    })
  );
  assert.equal(result.success, true);
  const [override] = await sql`
    select id, is_admin_override, override_reason from reservations
    where user_id = ${first.userId} and start_at = ${overrideStart}
  `;
  assert.equal(override.is_admin_override, true);
  assert.equal(override.override_reason, 'Approved extended research run');
  reservationIds.push(override.id);

  result = await actionResult(
    await admin.form('/admin/reservations?/cancel', {
      reservationId: override.id,
      reason: 'Schedule changed after review'
    })
  );
  assert.equal(result.success, true);
  const [cancelledOverride] = await sql`
    select status, cancellation_reason from reservations where id = ${override.id}
  `;
  assert.equal(cancelledOverride.status, 'cancelled');
  assert.equal(cancelledOverride.cancellation_reason, 'Schedule changed after review');

  const winnerSession = winner.user_id === first.userId ? first : second;
  result = await actionResult(
    await winnerSession.user.form('/reservations?/cancel', { reservationId: winner.id })
  );
  assert.equal(result.success, true);
  const [cancelledWinner] = await sql`select status from reservations where id = ${winner.id}`;
  assert.equal(cancelledWinner.status, 'cancelled');

  result = await actionResult(
    await admin.form('/admin/users?/assignWorkstation', {
      userId: first.userId,
      workstationId: ws02.id
    })
  );
  assert.equal(result.success, true);
  const [ws01Assignment] = await sql`
    select id from workstation_assignments
    where user_id = ${first.userId} and workstation_id = ${ws01.id} and status = 'active'
  `;

  const revocationFutureStart = new Date(start.getTime() + 4 * 60 * 60_000);
  const revocationFutureEnd = new Date(revocationFutureStart.getTime() + 30 * 60_000);
  result = await actionResult(
    await first.user.form('/reservations?/create', {
      gpuId: ws01Gpus[1].id,
      startAt: localInput(revocationFutureStart),
      endAt: localInput(revocationFutureEnd)
    })
  );
  assert.equal(result.success, true);
  result = await actionResult(
    await first.user.form('/reservations?/create', {
      gpuId: ws02Gpu.id,
      startAt: localInput(revocationFutureStart),
      endAt: localInput(revocationFutureEnd)
    })
  );
  assert.equal(result.success, true);
  const [ws01Future] = await sql`
    select id from reservations
    where user_id = ${first.userId} and gpu_id = ${ws01Gpus[1].id}
      and start_at = ${revocationFutureStart}
  `;
  const [ws02Future] = await sql`
    select id from reservations
    where user_id = ${first.userId} and gpu_id = ${ws02Gpu.id}
      and start_at = ${revocationFutureStart}
  `;
  reservationIds.push(ws01Future.id, ws02Future.id);

  const currentStart = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000);
  const currentEnd = new Date(currentStart.getTime() + 30 * 60_000);
  const [currentReservation] = await sql`
    insert into reservations (gpu_id, user_id, created_by_user_id, start_at, end_at)
    values (${ws01Gpus[1].id}, ${first.userId}, ${first.userId}, ${currentStart}, ${currentEnd})
    returning id
  `;
  reservationIds.push(currentReservation.id);

  result = await actionResult(
    await admin.form('/admin/users?/revokeWorkstation', {
      assignmentId: ws01Assignment.id
    })
  );
  assert.equal(result.success, true);
  assert.match(result.message, /Cancelled 1 future reservation/);
  const revocationReservations = await sql`
    select id, status, cancellation_reason from reservations
    where id in (${ws01Future.id}, ${ws02Future.id}, ${currentReservation.id})
  `;
  assert.deepEqual(
    revocationReservations.find((reservation) => reservation.id === ws01Future.id),
    {
      id: ws01Future.id,
      status: 'cancelled',
      cancellation_reason: 'Workstation access revoked.'
    }
  );
  assert.equal(
    revocationReservations.find((reservation) => reservation.id === ws02Future.id)?.status,
    'active'
  );
  assert.equal(
    revocationReservations.find((reservation) => reservation.id === currentReservation.id)?.status,
    'active'
  );

  const [auditSummary] = await sql`
    select count(*) filter (where action = 'reservation.override_created')::int as overrides,
      count(*) filter (where action = 'reservation.admin_cancelled')::int as admin_cancellations,
      count(*) filter (where action = 'reservation.cancelled')::int as owner_cancellations,
      count(*) filter (where action = 'reservation.cancelled_for_assignment_revocation')::int
        as assignment_cancellations
    from audit_events where target_id = any(${reservationIds})
  `;
  assert.equal(auditSummary.overrides, 1);
  assert.equal(auditSummary.admin_cancellations, 1);
  assert.equal(auditSummary.owner_cancellations, 1);
  assert.equal(auditSummary.assignment_cancellations, 1);

  console.log(
    'Milestone 5 and M8.2 reservation eligibility, targeted revocation cancellation, audit, and current-session retention passed.'
  );
} finally {
  if (reservationIds.length > 0) {
    await sql`delete from audit_events where target_type = 'reservation' and target_id = any(${reservationIds})`;
  }
  if (userIds.length > 0) {
    await sql`delete from reservations where user_id = any(${userIds}) or created_by_user_id = any(${userIds})`;
    await sql`delete from audit_events where target_type = 'user' and target_id = any(${userIds})`;
    await sql`delete from users where id = any(${userIds})`;
  }
  if (inactiveGpuId?.id) await sql`delete from gpus where id = ${inactiveGpuId.id}`;
  await sql.end();
}
