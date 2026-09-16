import assert from 'node:assert/strict';

import { parse } from 'devalue';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';
const adminUsername = process.env.ADMIN_USERNAME;
const adminTemporaryPassword = process.env.ADMIN_TEMPORARY_PASSWORD;
const adminNewPassword = process.env.ADMIN_NEW_PASSWORD;

if (!adminUsername || !adminTemporaryPassword || !adminNewPassword) {
  throw new Error('ADMIN_USERNAME, ADMIN_TEMPORARY_PASSWORD, and ADMIN_NEW_PASSWORD are required');
}

class BrowserSession {
  cookie = '';

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);

    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
      redirect: 'manual'
    });

    for (const value of response.headers.getSetCookie()) {
      const cookie = value.split(';', 1)[0];
      this.cookie = value.includes('Max-Age=0') ? '' : cookie;
    }

    return response;
  }

  async form(path, values) {
    return this.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
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

const admin = new BrowserSession();
let result = await actionResult(
  await admin.form('/login', { username: adminUsername, password: adminTemporaryPassword })
);
assert.equal(result.redirect, '/change-password');

result = await actionResult(
  await admin.form('/change-password', {
    currentPassword: adminTemporaryPassword,
    newPassword: adminNewPassword,
    confirmation: adminNewPassword
  })
);
assert.equal(result.redirect, '/dashboard');

let response = await admin.request('/admin/users');
assert.equal(response.status, 200);

const suffix = Date.now().toString(36);
const username = `smoke-${suffix}`;
const displayName = `Smoke User ${suffix}`;
const permanentPassword = `Smoke-permanent-${suffix}!`;

result = await actionResult(
  await admin.form('/admin/users?/create', { username, displayName, role: 'user' })
);
assert.equal(result.success, true);
assert.equal(result.credentialUsername, username);
assert.equal(typeof result.temporaryPassword, 'string');
const userId = result.createdUserId;
const initialTemporaryPassword = result.temporaryPassword;

const user = new BrowserSession();
result = await actionResult(
  await user.form('/login', { username, password: initialTemporaryPassword })
);
assert.equal(result.redirect, '/change-password');
result = await actionResult(
  await user.form('/change-password', {
    currentPassword: initialTemporaryPassword,
    newPassword: permanentPassword,
    confirmation: permanentPassword
  })
);
assert.equal(result.redirect, '/dashboard');

response = await user.request('/dashboard');
assert.equal(response.status, 200);
assert.match(await response.text(), new RegExp(`Welcome, ${displayName}`));

response = await user.request('/admin/users');
assert.equal(response.status, 303);
assert.equal(response.headers.get('location'), '/dashboard');

result = await actionResult(
  await admin.form('/admin/users?/setStatus', { userId, status: 'disabled' })
);
assert.equal(result.success, true);

response = await user.request('/dashboard');
assert.equal(response.status, 303);
assert.equal(response.headers.get('location'), '/login');

result = await actionResult(await user.form('/login', { username, password: permanentPassword }));
assert.equal(result.status, 400);

result = await actionResult(
  await admin.form('/admin/users?/setStatus', { userId, status: 'active' })
);
assert.equal(result.success, true);

result = await actionResult(await admin.form('/admin/users?/resetPassword', { userId }));
assert.equal(result.success, true);
const resetTemporaryPassword = result.temporaryPassword;

result = await actionResult(await user.form('/login', { username, password: permanentPassword }));
assert.equal(result.status, 400);

result = await actionResult(
  await user.form('/login', { username, password: resetTemporaryPassword })
);
assert.equal(result.redirect, '/change-password');

response = await admin.request('/admin/audit');
assert.equal(response.status, 200);
const auditPage = await response.text();
for (const action of ['user.created', 'user.credentials_reset', 'user.disabled', 'user.enabled']) {
  assert.match(auditPage, new RegExp(action.replace('.', '\\.')));
}

console.log(`Authentication smoke test passed for ${username}.`);
