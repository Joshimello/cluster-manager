import { describe, expect, it } from 'vitest';

import { deriveConnectionState, parseHeartbeatReport } from './heartbeat';

const report = {
  observedAt: '2026-09-16T00:00:00.000Z',
  nodeVersion: 'dev',
  hostname: 'ws01',
  bootId: 'simulation-boot',
  uptimeSeconds: 120,
  inventory: {
    operatingSystem: 'Linux',
    cpu: { logicalCores: 8, model: 'Simulated CPU', utilizationPercent: 25 },
    memory: { totalBytes: 1000, usedBytes: 400, utilizationPercent: 40 },
    storage: { path: '/', totalBytes: 2000, usedBytes: 500, utilizationPercent: 25 },
    sessions: [{ username: 'ada', terminal: 'pts/0' }]
  }
};

describe('parseHeartbeatReport', () => {
  it('accepts a complete bounded report', () => {
    expect(parseHeartbeatReport(report)).toMatchObject({ hostname: 'ws01', uptimeSeconds: 120 });
  });

  it('rejects impossible or incomplete inventory', () => {
    expect(
      parseHeartbeatReport({
        ...report,
        inventory: {
          ...report.inventory,
          memory: { totalBytes: 10, usedBytes: 20, utilizationPercent: 200 }
        }
      })
    ).toBeNull();
  });
});

describe('deriveConnectionState', () => {
  const now = new Date('2026-09-16T00:03:00.000Z');
  it.each([
    [null, 'never'],
    [new Date('2026-09-16T00:02:20.000Z'), 'online'],
    [new Date('2026-09-16T00:02:00.000Z'), 'stale'],
    [new Date('2026-09-16T00:00:59.000Z'), 'offline']
  ] as const)('maps %s to %s', (heartbeat, state) => {
    expect(deriveConnectionState(heartbeat, now)).toBe(state);
  });
});
