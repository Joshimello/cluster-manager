import { describe, expect, it } from 'vitest';

import {
  hashNodeSecret,
  isEnrollmentToken,
  isNodeCredential,
  issueEnrollmentToken,
  normalizeWorkstationName,
  readBearerCredential,
  validateWorkstationName
} from './credentials';

describe('node credentials', () => {
  it('issues one-time enrollment tokens with an expiry and stored digest', () => {
    const now = new Date('2026-09-16T00:00:00Z');
    const issued = issueEnrollmentToken(now);

    expect(isEnrollmentToken(issued.token)).toBe(true);
    expect(issued.tokenHash).toBe(hashNodeSecret(issued.token));
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('validates node-owned credentials and bearer headers', () => {
    const credential = `cmnode_${'a'.repeat(43)}`;
    expect(isNodeCredential(credential)).toBe(true);
    expect(readBearerCredential(`Bearer ${credential}`)).toBe(credential);
    expect(readBearerCredential('Basic abc')).toBeNull();
    expect(readBearerCredential('Bearer short')).toBeNull();
  });

  it('normalizes and validates workstation names', () => {
    expect(normalizeWorkstationName(' WS-01 ')).toBe('ws-01');
    expect(validateWorkstationName('ws-01')).toBeNull();
    expect(validateWorkstationName('WS 01')).not.toBeNull();
  });
});
