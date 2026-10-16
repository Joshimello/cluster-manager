import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { Provider, interactionPolicy, errors } from 'oidc-provider';
import postgres from 'postgres';

const lifetime = 30 * 86400;
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export function encryptionKey(value = process.env.AUTH_ENCRYPTION_KEY) {
  const key = Buffer.from(value || '', 'base64');
  if (key.length !== 32) throw new Error('AUTH_ENCRYPTION_KEY must encode 32 random bytes');
  return key;
}
export function encrypt(value, key = encryptionKey()) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function decrypt(value, key = encryptionKey()) {
  const b = Buffer.from(value, 'base64'),
    cipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString());
}
export function validateClient(name, uris) {
  name = String(name).trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new Error('Enter an application name of 1–120 characters.');
  const redirectUris = [...new Set(String(uris).split(/\s+/).filter(Boolean))];
  if (!redirectUris.length || redirectUris.length > 10)
    throw new Error('Enter 1–10 exact callback URLs, one per line.');
  for (const uri of redirectUris) {
    const url = new URL(uri);
    if (
      (url.protocol !== 'https:' &&
        !(
          process.env.NODE_ENV !== 'production' &&
          ['localhost', '127.0.0.1'].includes(url.hostname) &&
          url.protocol === 'http:'
        )) ||
      url.username ||
      url.password ||
      url.hash ||
      uri.includes('*')
    )
      throw new Error(
        'Callback URLs must use HTTPS, with no credentials, fragments, or wildcards.'
      );
  }
  return { name, redirectUris };
}

export function database() {
  return postgres(process.env.DATABASE_URL, { max: 5, prepare: false, onnotice: () => {} });
}
export async function platformUser(sql, req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('cluster_manager_session='));
  if (!cookie) return null;
  const token = cookie.slice('cluster_manager_session='.length);
  const [user] =
    await sql`select u.id, u.username, u.display_name, u.must_change_password, u.security_version from sessions s join users u on u.id=s.user_id where s.token_hash=${createHash('sha256').update(token).digest('hex')} and s.expires_at>now() and u.status='active' and u.deleted_at is null`;
  return user ? { ...user, cookie: token } : null;
}

export function adapterFor(sql, key) {
  return class Adapter {
    constructor(model) {
      this.model = model;
    }
    async upsert(id, payload, expiresIn) {
      const userId = payload.accountId || null,
        clientId = payload.clientId || null;
      const [user] = userId ? await sql`select security_version from users where id=${userId}` : [];
      await sql`insert into oidc_objects (model,id,payload,grant_id,user_id,security_version,client_id,uid,expires_at) values (${this.model},${id},${encrypt(payload, key)},${payload.grantId || (this.model === 'Grant' ? id : null)},${userId},${user?.security_version || null},${clientId},${payload.uid || null},${new Date(Date.now() + Math.min(expiresIn || lifetime, lifetime) * 1000)}) on conflict(model,id) do update set payload=excluded.payload,expires_at=least(oidc_objects.expires_at,excluded.expires_at)`;
    }
    async find(id) {
      if (this.model === 'Client') {
        const [client] = await sql`select * from oidc_clients where id::text=${id} and enabled`;
        return (
          client && {
            client_id: client.id,
            client_name: client.name,
            client_secret: decrypt(client.secret, key),
            redirect_uris: client.redirect_uris,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic'
          }
        );
      }
      const [row] =
        await sql`select o.* from oidc_objects o left join users u on u.id=o.user_id left join oidc_clients c on c.id=o.client_id where o.model=${this.model} and o.id=${id} and o.expires_at>now() and (o.user_id is null or (u.status='active' and u.deleted_at is null and not u.must_change_password and u.security_version=o.security_version)) and (o.client_id is null or c.enabled)`;
      if (!row) return undefined;
      const payload = decrypt(row.payload, key);
      if (row.consumed_at) payload.consumed = Math.floor(row.consumed_at.getTime() / 1000);
      return payload;
    }
    async findByUid(uid) {
      const [row] =
        await sql`select id from oidc_objects where model=${this.model} and uid=${uid} and expires_at>now()`;
      return row && this.find(row.id);
    }
    async findByUserCode() {
      return undefined;
    }
    async consume(id) {
      const rows =
        await sql`update oidc_objects set consumed_at=now() where model=${this.model} and id=${id} and consumed_at is null and expires_at>now() returning grant_id`;
      if (!rows.length) {
        const [row] =
          await sql`select grant_id from oidc_objects where model=${this.model} and id=${id}`;
        if (row?.grant_id) await this.revokeByGrantId(row.grant_id);
        throw new errors.InvalidGrant('Authorization has already been used');
      }
    }
    async destroy(id) {
      await sql`delete from oidc_objects where model=${this.model} and id=${id}`;
    }
    async revokeByGrantId(id) {
      await sql`delete from oidc_objects where grant_id=${id} or (model='Grant' and id=${id})`;
    }
  };
}

export async function createOidc({
  sql = database(),
  origin = process.env.ORIGIN,
  key = encryptionKey()
} = {}) {
  const issuer = `${origin}/oidc`;
  const jwks = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(74210931)`;
    const [row] = await tx`select payload from oidc_keys where id='signing'`;
    if (row) return decrypt(row.payload, key);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = {
      keys: [
        {
          ...privateKey.export({ format: 'jwk' }),
          kid: randomBytes(12).toString('hex'),
          use: 'sig',
          alg: 'RS256'
        }
      ]
    };
    await tx`insert into oidc_keys(id,payload) values ('signing',${encrypt(keys, key)})`;
    return keys;
  });
  const policy = interactionPolicy.base();
  policy.get('login').checks.add(
    new interactionPolicy.Check('platform_session', 'Platform sign-in required', async (ctx) => {
      const user = await platformUser(sql, ctx.req);
      return Boolean(
        !user ||
        user.must_change_password ||
        (ctx.oidc.session.accountId && ctx.oidc.session.accountId !== user.id)
      );
    })
  );
  const provider = new Provider(issuer, {
    adapter: adapterFor(sql, key),
    jwks,
    cookies: {
      keys: [createHmac('sha256', key).update('oidc cookies').digest('base64')],
      long: { secure: origin.startsWith('https:'), sameSite: 'lax' },
      short: { secure: origin.startsWith('https:'), sameSite: 'lax' }
    },
    claims: { openid: ['sub'], profile: ['preferred_username', 'name'] },
    scopes: ['openid', 'profile', 'offline_access'],
    clientAuthMethods: ['client_secret_basic'],
    responseTypes: ['code'],
    pkce: { required: () => true, methods: ['S256'] },
    features: {
      pushedAuthorizationRequests: { enabled: false },
      dPoP: { enabled: false },
      devInteractions: { enabled: false },
      introspection: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) => token.clientId === client.clientId
      },
      revocation: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) => token.clientId === client.clientId
      },
      registration: { enabled: false }
    },
    ttl: {
      AccessToken: 300,
      IdToken: 300,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 7 * 86400,
      Grant: lifetime,
      RefreshToken: (_ctx, token) =>
        Math.max(0, token.iiat + lifetime - Math.floor(Date.now() / 1000))
    },
    rotateRefreshToken: true,
    interactions: { policy, url: (_ctx, interaction) => `/oidc/interaction/${interaction.uid}` },
    async findAccount(_ctx, id) {
      const [u] =
        await sql`select id,username,display_name from users where id=${id} and status='active' and not must_change_password and deleted_at is null`;
      return (
        u && {
          accountId: u.id,
          claims: () => ({ sub: u.id, preferred_username: u.username, name: u.display_name })
        }
      );
    },
    async loadExistingGrant(ctx) {
      const id = ctx.oidc.result?.consent?.grantId;
      return id ? provider.Grant.find(id) : undefined;
    },
    async renderError(ctx) {
      ctx.type = 'html';
      ctx.body =
        '<h1>Sign-in could not be completed</h1><p>Return to the application and try signing in again.</p>';
    }
  });
  provider.proxy = true;
  // Do not let oidc-provider's client cache hide administrator changes.
  provider.Client.find = async function (id) {
    const payload = await new (adapterFor(sql, key))('Client').find(id);
    return payload ? new provider.Client(payload) : undefined;
  };
  const audit = async (user, action, target) =>
    sql`insert into audit_events(actor_user_id,action,target_type,target_id,metadata) values (${user},${action},'connected_application',${target},'{}'::jsonb)`;
  provider.on('grant.success', (ctx) => {
    const uid = ctx.oidc.entities.Account?.accountId;
    if (uid)
      void audit(uid, 'identity.authorization_succeeded', ctx.oidc.client.clientId).catch(() => {});
  });
  for (const event of ['authorization.error', 'grant.error'])
    provider.on(event, (ctx) => {
      const client = ctx.oidc?.client?.clientId;
      if (client) void audit(null, 'identity.authorization_failed', client).catch(() => {});
    });
  provider.on('server_error', () =>
    console.error(JSON.stringify({ event: 'identity.server_error' }))
  );
  const buckets = new Map();
  let lastCleanup = 0;
  async function interaction(req, res, url) {
    const user = await platformUser(sql, req);
    if (!user || user.must_change_password) {
      const next = encodeURIComponent(url.pathname);
      res.writeHead(303, { Location: `/${user ? 'change-password' : 'login'}?next=${next}` });
      res.end();
      return;
    }
    const details = await provider.interactionDetails(req, res);
    const client = await provider.Client.find(details.params.client_id);
    if (!client) {
      res.writeHead(400);
      res.end('Application unavailable');
      return;
    }
    const csrf = createHmac('sha256', key).update(`${details.uid}:${user.cookie}`).digest('hex');
    if (req.method === 'POST') {
      if (req.headers.origin !== origin) {
        console.log(
          JSON.stringify({
            event: 'identity.consent_rejected',
            reason: 'origin',
            origin: req.headers.origin ?? null,
            site: req.headers['sec-fetch-site'] ?? null
          })
        );
        res.writeHead(403);
        res.end('Invalid request origin');
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      const form = new URLSearchParams(body),
        supplied = Buffer.from(form.get('csrf') || '');
      if (supplied.length !== csrf.length || !timingSafeEqual(supplied, Buffer.from(csrf))) {
        res.writeHead(403);
        console.log(JSON.stringify({ event: 'identity.consent_rejected', reason: 'csrf' }));
        res.end('Invalid request');
        return;
      }
      if (form.get('decision') !== 'allow') {
        await audit(user.id, 'identity.authorization_denied', client.clientId);
        return provider.interactionFinished(
          req,
          res,
          { error: 'access_denied' },
          { mergeWithLastSubmission: false }
        );
      }
      // One fresh, bounded grant per authorization, including personal-token authorizations.
      const grant = new provider.Grant({ accountId: user.id, clientId: client.clientId });
      grant.addOIDCScope(String(details.params.scope));
      const grantId = await grant.save();
      // Bind approval to the session observed above, even if a password reset races this request.
      await sql`update oidc_objects set security_version=${user.security_version} where model='Grant' and id=${grantId}`;
      await audit(user.id, 'identity.authorization_approved', client.clientId);
      return provider.interactionFinished(
        req,
        res,
        { login: { accountId: user.id, remember: false }, consent: { grantId } },
        { mergeWithLastSubmission: false }
      );
    }
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${client.redirectUris.map((uri) => new URL(uri).origin).join(' ')}; frame-ancestors 'none'`,
      'Referrer-Policy': 'same-origin'
    });
    res.end(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect application</title><style>body{font:16px system-ui;max-width:32rem;margin:10vh auto;padding:24px}button{padding:12px 20px;margin:12px 8px 0 0}p{line-height:1.6}</style></head><body><h1>Connect ${escapeHtml(client.clientName)}</h1><p>Signed in as <strong>${escapeHtml(user.display_name)}</strong> (${escapeHtml(user.username)}).</p><p>This application will receive your username, display name, and unique account ID. It may maintain access for up to 30 days, unless you or an administrator revoke it.</p><form method="post" action="${escapeHtml(origin)}/oidc/interaction/${details.uid}"><input type="hidden" name="csrf" value="${csrf}"><button type="submit" name="decision" value="allow">Allow access</button><button type="submit" name="decision" value="deny">Cancel</button></form></body></html>`
    );
  }
  async function handle(req, res, next) {
    const url = new URL(req.url, origin);
    if (url.pathname !== '/oidc' && !url.pathname.startsWith('/oidc/')) return next();
    res.once('finish', () =>
      console.log(
        JSON.stringify({
          event: 'identity.request',
          method: req.method,
          route: url.pathname.startsWith('/oidc/interaction/')
            ? 'interaction'
            : url.pathname.startsWith('/oidc/auth/')
              ? 'authorization_resume'
              : [
                    '/oidc/auth',
                    '/oidc/token',
                    '/oidc/me',
                    '/oidc/jwks',
                    '/oidc/.well-known/openid-configuration',
                    '/oidc/token/introspection',
                    '/oidc/token/revocation'
                  ].includes(url.pathname)
                ? url.pathname
                : 'unknown',
          status: res.statusCode
        })
      )
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (Date.now() - lastCleanup > 3600000) {
      lastCleanup = Date.now();
      void sql`delete from oidc_objects where expires_at<now()`.catch(() => {});
    }
    const bucketKey = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.until < now) {
      bucket = { count: 0, until: now + 60000 };
      buckets.set(bucketKey, bucket);
    }
    if (++bucket.count > 600) {
      res.writeHead(429, { 'Retry-After': '60' });
      res.end('Too many sign-in requests');
      return;
    }
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    try {
      if (/^\/oidc\/interaction\/[A-Za-z0-9_-]+$/.test(url.pathname))
        return await interaction(req, res, url);
      // Mount at the issuer path, retaining the original URL for provider calculations.
      req.headers.host = new URL(origin).host;
      req.headers['x-forwarded-host'] = new URL(origin).host;
      req.headers['x-forwarded-proto'] = new URL(origin).protocol.slice(0, -1);
      const original = req.url;
      req.originalUrl = original;
      req.baseUrl = '/oidc';
      req.url = req.url.slice('/oidc'.length) || '/';
      try {
        await provider.callback()(req, res);
      } finally {
        req.url = original;
      }
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain' });
      if (!res.writableEnded)
        res.end('Sign-in is temporarily unavailable. Return to the application and retry.');
    }
  }
  return { provider, handle, sql };
}
let runtime;
export async function oidcMiddleware(req, res, next) {
  if (!req.url?.startsWith('/oidc')) return next();
  if (!process.env.AUTH_ENCRYPTION_KEY) {
    res.writeHead(503);
    res.end('Connected sign-in is not configured.');
    return;
  }
  try {
    runtime ??= createOidc();
    return await (await runtime).handle(req, res, next);
  } catch {
    runtime = undefined;
    res.writeHead(503);
    res.end('Connected sign-in is unavailable.');
  }
}
