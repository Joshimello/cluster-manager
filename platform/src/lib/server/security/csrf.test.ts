import { describe, expect, it } from 'vitest';

import { isAllowedFormSubmission, parseTrustedOrigins } from './csrf';

function formRequest(
  origin?: string,
  method = 'POST',
  contentType = 'application/x-www-form-urlencoded'
) {
  const headers = new Headers({ 'content-type': contentType });
  if (origin) headers.set('origin', origin);
  const body = method === 'GET' || method === 'HEAD' ? undefined : 'username=test';
  return new Request('https://manager.example/login', { method, headers, body });
}

describe('runtime CSRF origins', () => {
  it('normalizes an explicit comma-separated origin list', () => {
    expect([
      ...parseTrustedOrigins(' http://192.168.50.141:3000/, http://localhost:3000 ')
    ]).toEqual(['http://192.168.50.141:3000', 'http://localhost:3000']);
  });

  it('rejects wildcards and URLs containing paths', () => {
    expect(() => parseTrustedOrigins('*')).toThrow(/without wildcards/);
    expect(() => parseTrustedOrigins('https://manager.example/login')).toThrow(
      /only scheme, host, and optional port/
    );
  });

  it('allows the canonical and explicitly trusted form origins', () => {
    const trusted = parseTrustedOrigins('http://192.168.50.141:3000');

    expect(
      isAllowedFormSubmission(
        formRequest('https://manager.example'),
        'https://manager.example',
        trusted
      )
    ).toBe(true);
    expect(
      isAllowedFormSubmission(
        formRequest('http://192.168.50.141:3000'),
        'https://manager.example',
        trusted
      )
    ).toBe(true);
  });

  it('rejects untrusted or missing origins on state-changing form requests', () => {
    const trusted = parseTrustedOrigins('http://192.168.50.141:3000');

    expect(
      isAllowedFormSubmission(
        formRequest('http://attacker.example'),
        'https://manager.example',
        trusted
      )
    ).toBe(false);
    expect(isAllowedFormSubmission(formRequest(), 'https://manager.example', trusted)).toBe(false);
  });

  it('does not apply the form-origin check to safe methods or JSON APIs', () => {
    const trusted = parseTrustedOrigins(undefined);

    expect(
      isAllowedFormSubmission(formRequest(undefined, 'GET'), 'https://manager.example', trusted)
    ).toBe(true);
    expect(
      isAllowedFormSubmission(
        formRequest('http://attacker.example', 'POST', 'application/json'),
        'https://manager.example',
        trusted
      )
    ).toBe(true);
  });
});
