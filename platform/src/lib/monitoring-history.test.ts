import { describe, expect, it } from 'vitest';

import { monitoringRangeConfig, parseMonitoringRange } from './monitoring-history';

describe('monitoring ranges', () => {
  it('defaults invalid and missing ranges to one hour', () => {
    expect(parseMonitoringRange(undefined)).toBe('1h');
    expect(parseMonitoringRange(null)).toBe('1h');
    expect(parseMonitoringRange('week')).toBe('1h');
  });

  it.each(['15m', '1h', '6h', '24h'] as const)('accepts %s', (range) => {
    expect(parseMonitoringRange(range)).toBe(range);
    expect(monitoringRangeConfig[range].bucketSeconds).toBeGreaterThan(0);
  });

  it('keeps every response comfortably below 300 points per series', () => {
    for (const config of Object.values(monitoringRangeConfig)) {
      expect(config.durationMilliseconds / 1000 / config.bucketSeconds).toBeLessThanOrEqual(288);
    }
  });
});
