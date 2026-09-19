import { describe, expect, it } from 'vitest';

import { defaultTimeZone, normalizeTimeZone, supportedTimeZones } from './time-zone';

describe('time-zone preferences', () => {
  it('accepts and canonicalizes IANA time zones', () => {
    expect(normalizeTimeZone(' Asia/Kuala_Lumpur ')).toBe('Asia/Kuala_Lumpur');
    expect(normalizeTimeZone('UTC')).toBe('UTC');
  });

  it('rejects unknown or malformed values', () => {
    expect(normalizeTimeZone('Mars/Olympus_Mons')).toBeNull();
    expect(normalizeTimeZone('')).toBeNull();
    expect(normalizeTimeZone(123)).toBeNull();
  });

  it('includes UTC in the editable options', () => {
    expect(supportedTimeZones()).toContain(defaultTimeZone);
    expect(supportedTimeZones()).toContain('Asia/Kuala_Lumpur');
  });
});
