import { describe, expect, it } from 'vitest';

import { telemetryRetentionHours } from './maintenance';

describe('telemetry retention configuration', () => {
  it('defaults to 24 hours', () => {
    expect(telemetryRetentionHours(undefined)).toBe(24);
  });

  it('accepts bounded integer hours', () => {
    expect(telemetryRetentionHours('1')).toBe(1);
    expect(telemetryRetentionHours('720')).toBe(720);
  });

  it.each(['0', '721', '1.5', 'tomorrow'])('rejects invalid value %s', (value) => {
    expect(() => telemetryRetentionHours(value)).toThrow(/integer from 1 to 720/);
  });
});
