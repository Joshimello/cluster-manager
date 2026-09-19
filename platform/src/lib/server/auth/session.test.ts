import { describe, expect, it } from 'vitest';

import { generateSessionToken, hashSessionToken, shouldUseSecureSessionCookie } from './session';

describe('session tokens', () => {
  it('generates high-entropy opaque tokens', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
  });

  it('stores only a deterministic SHA-256 digest', () => {
    const token = 'test-session-token';
    const digest = hashSessionToken(token);

    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
    expect(hashSessionToken(token)).toBe(digest);
  });

  it('uses secure cookies for production HTTPS and only relaxes them for HTTP origins', () => {
    expect(shouldUseSecureSessionCookie(false, 'https://manager.example')).toBe(true);
    expect(shouldUseSecureSessionCookie(false, 'http://100.64.0.10:3000')).toBe(false);
    expect(shouldUseSecureSessionCookie(true, undefined)).toBe(false);
    expect(shouldUseSecureSessionCookie(false, undefined)).toBe(true);
    expect(shouldUseSecureSessionCookie(false, 'not a URL')).toBe(true);
  });
});
