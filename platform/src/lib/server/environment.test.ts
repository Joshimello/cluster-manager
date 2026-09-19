import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const requiredEnvironment = {
  DATABASE_URL: 'postgres://example.invalid/database',
  PLATFORM_VERSION: 'test',
  TELEMETRY_RETENTION_HOURS: '24'
};

function validate(origin: string, allowHttp?: string) {
  return spawnSync(process.execPath, ['scripts/validate-env.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...requiredEnvironment,
      ORIGIN: origin,
      ...(allowHttp === undefined ? { ALLOW_HTTP: '' } : { ALLOW_HTTP: allowHttp })
    }
  });
}

describe('production environment validation', () => {
  it('accepts HTTPS without an override', () => {
    expect(validate('https://manager.example').status).toBe(0);
  });

  it('rejects HTTP by default', () => {
    const result = validate('http://100.64.0.10:3000');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ORIGIN must use HTTPS unless ALLOW_HTTP=true');
  });

  it('accepts HTTP only with an explicit true value', () => {
    expect(validate('http://100.64.0.10:3000', 'true').status).toBe(0);
    expect(validate('http://100.64.0.10:3000', 'false').status).not.toBe(0);
    expect(validate('http://100.64.0.10:3000', 'yes').stderr).toContain(
      'ALLOW_HTTP must be either true or false'
    );
  });
});
