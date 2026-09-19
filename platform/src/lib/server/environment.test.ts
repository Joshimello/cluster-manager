import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const requiredEnvironment = {
  DATABASE_URL: 'postgres://example.invalid/database',
  PLATFORM_VERSION: 'test',
  TELEMETRY_RETENTION_HOURS: '24'
};

function validate(origin: string, allowHttp?: string, csrfTrustedOrigins?: string) {
  return spawnSync(process.execPath, ['scripts/validate-env.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...requiredEnvironment,
      ORIGIN: origin,
      ...(allowHttp === undefined ? { ALLOW_HTTP: '' } : { ALLOW_HTTP: allowHttp }),
      CSRF_TRUSTED_ORIGINS: csrfTrustedOrigins ?? ''
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

  it('accepts explicit same-protocol trusted origins', () => {
    expect(
      validate(
        'http://manager.example:3000',
        'true',
        'http://192.168.50.141:3000,http://localhost:3000'
      ).status
    ).toBe(0);
  });

  it('rejects wildcard, path-bearing, and mixed-protocol trusted origins', () => {
    expect(validate('https://manager.example', undefined, '*').stderr).toContain(
      'does not allow wildcards'
    );
    expect(
      validate('https://manager.example', undefined, 'https://other.example/login').stderr
    ).toContain('only scheme, host, and optional port');
    expect(
      validate('https://manager.example', undefined, 'http://localhost:3000').stderr
    ).toContain('must use the same protocol as ORIGIN');
  });
});
