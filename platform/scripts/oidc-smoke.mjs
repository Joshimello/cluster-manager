import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createOidc, encrypt, database } from '../runtime/oidc.mjs';
if (process.env.OIDC_TEST_DATABASE !== 'true')
  throw new Error(
    'OIDC_TEST_DATABASE=true is required; this test resets isolated identity-provider state'
  );
if (!process.env.DATABASE_URL) throw new Error('Use an isolated DATABASE_URL');
const key = randomBytes(32),
  sql = database();
const origin = 'http://127.0.0.1:5189';
const userId = randomUUID(),
  clientId = randomUUID(),
  otherClientId = randomUUID(),
  secret = randomBytes(32).toString('base64url'),
  session = 'test-' + randomUUID();
await sql`delete from oidc_keys`; // Isolated smoke database: exercise encrypted key initialization.
await sql`insert into users(id,username,display_name,posix_uid,posix_gid,password_hash,must_change_password) values (${userId},${'oidc_' + randomBytes(4).toString('hex')},'OIDC Test',59990,59990,'test-hash',false)`;
await sql`insert into sessions(token_hash,user_id,expires_at) values (${createHash('sha256').update(session).digest('hex')},${userId},now()+interval '1 day')`;
await sql`insert into oidc_clients(id,name,secret,redirect_uris) values (${clientId},'Test App',${encrypt(secret, key)},${sql.json(['http://127.0.0.1:5190/auth/callback'])}),(${otherClientId},'Other App',${encrypt(secret, key)},${sql.json(['http://127.0.0.1:5190/auth/callback'])})`;
let runtime = await createOidc({ sql, origin, key });
runtime.provider.on('server_error', (_ctx, error) => console.error(error.stack));
const server = createServer((req, res) => {
  void runtime.handle(req, res, () => {
    res.writeHead(404);
    res.end();
  });
});
await new Promise((r) => server.listen(5189, '127.0.0.1', r));
const jar = new Map([['cluster_manager_session', session]]);
async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  const r = await fetch(new URL(url, origin), { ...options, headers, redirect: 'manual' });
  for (const c of r.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return r;
}
async function authorize({
  pkce = true,
  callback = 'http://127.0.0.1:5190/auth/callback',
  consent = true
} = {}) {
  const discovery = await (await fetch(origin + '/oidc/.well-known/openid-configuration')).json();
  const verifier = randomBytes(32).toString('base64url');
  const u = new URL(discovery.authorization_endpoint);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: 'code',
    scope: 'openid profile offline_access',
    prompt: 'consent',
    state: 'teststate',
    nonce: 'testnonce',
    ...(pkce
      ? {
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256'
        }
      : {})
  });
  let r = await request(u);
  for (let i = 0; i < 10; i++) {
    if (r.status === 200) {
      const body = await r.text();
      const csrf = body.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
      assert.ok(csrf, body);
      r = await request(r.url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf, decision: consent ? 'allow' : 'deny' })
      });
    }
    const location = r.headers.get('location');
    if (!location) return { r, discovery };
    const next = new URL(location, origin);
    if (next.origin !== origin) return { callback: next, discovery, verifier };
    if (next.pathname === '/login' || next.pathname === '/change-password')
      return { login: next, discovery };
    r = await request(next);
  }
  throw new Error('Too many sign-in redirects');
}
async function token(discovery, values, client = clientId) {
  const r = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${client}:${secret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(values)
  });
  return { status: r.status, body: await r.json() };
}
try {
  const flow = await authorize();
  assert.ok(flow.callback?.searchParams.get('code'), JSON.stringify(flow));
  const values = {
    grant_type: 'authorization_code',
    code: flow.callback.searchParams.get('code'),
    redirect_uri: 'http://127.0.0.1:5190/auth/callback',
    code_verifier: flow.verifier
  };
  const result = await token(flow.discovery, values);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.ok(result.body.refresh_token);
  // Replace the provider process state; persisted cookies, grants and signing keys must survive.
  runtime = await createOidc({ sql, origin, key });
  const profileResponse = await fetch(flow.discovery.userinfo_endpoint, {
    headers: { authorization: 'Bearer ' + result.body.access_token }
  });
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();
  assert.equal(profile.sub, userId);
  assert.equal(profile.preferred_username.startsWith('oidc_'), true);
  assert.equal(profile.posixUid, undefined);
  const reused = await token(flow.discovery, values);
  assert.equal(reused.status, 400);
  // Reusing a code revokes its grant; establish an independent authorization.
  const f2 = await authorize();
  const initial = await token(f2.discovery, {
    grant_type: 'authorization_code',
    code: f2.callback.searchParams.get('code'),
    redirect_uri: 'http://127.0.0.1:5190/auth/callback',
    code_verifier: f2.verifier
  });
  assert.equal(initial.status, 200, JSON.stringify(initial));
  const refreshed = await token(f2.discovery, {
    grant_type: 'refresh_token',
    refresh_token: initial.body.refresh_token
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed));
  assert.notEqual(refreshed.body.refresh_token, initial.body.refresh_token);
  const intr = await fetch(f2.discovery.introspection_endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${otherClientId}:${secret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ token: refreshed.body.access_token })
  });
  assert.equal((await intr.json()).active, false);
  const badCallback = await authorize({ callback: 'https://unregistered.invalid/callback' });
  assert.equal(badCallback.r?.status, 400);
  const unsupported = await token(f2.discovery, { grant_type: 'client_credentials' });
  assert.equal(unsupported.status, 400);
  const wrongVerifier = await authorize();
  assert.equal(
    (
      await token(wrongVerifier.discovery, {
        grant_type: 'authorization_code',
        code: wrongVerifier.callback.searchParams.get('code'),
        redirect_uri: 'http://127.0.0.1:5190/auth/callback',
        code_verifier: 'x'.repeat(43)
      })
    ).status,
    400
  );
  const concurrent = await authorize();
  const concurrentValues = {
    grant_type: 'authorization_code',
    code: concurrent.callback.searchParams.get('code'),
    redirect_uri: 'http://127.0.0.1:5190/auth/callback',
    code_verifier: concurrent.verifier
  };
  const concurrentResults = await Promise.all([
    token(concurrent.discovery, concurrentValues),
    token(concurrent.discovery, concurrentValues)
  ]);
  assert.equal(concurrentResults.filter((r) => r.status === 200).length, 1);
  const noPkce = await authorize({ pkce: false });
  assert.equal(noPkce.callback?.searchParams.get('error'), 'invalid_request');
  const denied = await authorize({ consent: false });
  assert.equal(denied.callback?.searchParams.get('error'), 'access_denied');
  await sql`update users set must_change_password=true where id=${userId}`;
  assert.equal((await authorize()).login?.pathname, '/change-password');
  await sql`update users set must_change_password=false where id=${userId}`;
  // Create a grant after the forced-password-change test so later assertions target a valid authorization.
  const postChange = await authorize();
  const postTokens = await token(postChange.discovery, {
    grant_type: 'authorization_code',
    code: postChange.callback.searchParams.get('code'),
    redirect_uri: 'http://127.0.0.1:5190/auth/callback',
    code_verifier: postChange.verifier
  });
  assert.equal(postTokens.status, 200);
  refreshed.body = postTokens.body;
  jar.delete('cluster_manager_session');
  assert.ok((await authorize()).login);
  jar.set('cluster_manager_session', session);
  await sql`update users set display_name='Changed' where id=${userId}`;
  assert.equal(
    (
      await fetch(f2.discovery.userinfo_endpoint, {
        headers: { authorization: 'Bearer ' + refreshed.body.access_token }
      })
    ).status,
    200
  );
  await sql`update users set password_hash='new-hash' where id=${userId}`;
  assert.equal(
    (
      await fetch(f2.discovery.userinfo_endpoint, {
        headers: { authorization: 'Bearer ' + refreshed.body.access_token }
      })
    ).status,
    401
  );
  await sql`update users set status='disabled' where id=${userId}`;
  await sql`update users set status='active' where id=${userId}`;
  assert.equal(
    (
      await token(f2.discovery, {
        grant_type: 'refresh_token',
        refresh_token: refreshed.body.refresh_token
      })
    ).status,
    400
  );
  console.log(
    'OIDC protocol smoke passed: sign-in, profile, PKCE, consent, replay, rotation, client isolation, platform logout, security revocation.'
  );
} finally {
  await new Promise((r) => server.close(r));
  await sql`delete from oidc_objects`;
  await sql`delete from oidc_keys`;
  await sql`delete from oidc_clients where id in (${clientId},${otherClientId})`;
  await sql`delete from audit_events where actor_user_id=${userId}`;
  await sql`delete from sessions where user_id=${userId}`;
  await sql`delete from users where id=${userId}`;
  await sql.end();
}
