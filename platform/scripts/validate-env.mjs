const required = ['DATABASE_URL', 'ORIGIN', 'PLATFORM_VERSION'];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}

const origin = new URL(process.env.ORIGIN);
if (origin.protocol !== 'https:' && process.env.ALLOW_INSECURE_PRODUCTION_ORIGIN !== 'true') {
  throw new Error('ORIGIN must use HTTPS in production');
}
if (origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('ORIGIN must contain only scheme, host, and optional port');
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
    telemetryRetentionHours: Number(retention)
  })
);
