import { describe, expect, it } from 'vitest';

import { generateSessionToken, hashSessionToken } from './session';

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
});
