const required = ['DATABASE_URL', 'ORIGIN', 'PLATFORM_VERSION'];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}

const allowHttpValue = process.env.ALLOW_HTTP?.trim() || 'false';
if (allowHttpValue !== 'true' && allowHttpValue !== 'false') {
  throw new Error('ALLOW_HTTP must be either true or false');
}
const allowHttp = allowHttpValue === 'true';

const origin = new URL(process.env.ORIGIN);
if (origin.protocol !== 'https:' && !(allowHttp && origin.protocol === 'http:')) {
  throw new Error('ORIGIN must use HTTPS unless ALLOW_HTTP=true');
}
if (origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('ORIGIN must contain only scheme, host, and optional port');
}

const csrfTrustedOrigins = [];
for (const entry of (process.env.CSRF_TRUSTED_ORIGINS ?? '').split(',')) {
  const candidate = entry.trim();
  if (!candidate) continue;
  if (candidate === '*') {
    throw new Error('CSRF_TRUSTED_ORIGINS does not allow wildcards');
  }

  const trustedOrigin = new URL(candidate);
  if (
    (trustedOrigin.protocol !== 'http:' && trustedOrigin.protocol !== 'https:') ||
    trustedOrigin.username ||
    trustedOrigin.password ||
    trustedOrigin.pathname !== '/' ||
    trustedOrigin.search ||
    trustedOrigin.hash
  ) {
    throw new Error(
      'CSRF_TRUSTED_ORIGINS entries must contain only scheme, host, and optional port'
    );
  }
  if (trustedOrigin.protocol !== origin.protocol) {
    throw new Error('CSRF_TRUSTED_ORIGINS entries must use the same protocol as ORIGIN');
  }
  csrfTrustedOrigins.push(trustedOrigin.origin);
}

const retention = process.env.TELEMETRY_RETENTION_HOURS ?? '24';
if (!/^\d+$/.test(retention) || Number(retention) < 1 || Number(retention) > 720) {
  throw new Error('TELEMETRY_RETENTION_HOURS must be an integer from 1 to 720');
}

console.log(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'environment.validated',
    platformVersion: process.env.PLATFORM_VERSION,
    origin: origin.origin,
    csrfTrustedOrigins: [...new Set(csrfTrustedOrigins)],
    allowHttp,
    telemetryRetentionHours: Number(retention)
  })
);
