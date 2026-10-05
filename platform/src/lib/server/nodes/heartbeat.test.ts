import { describe, expect, it } from 'vitest';

import { deriveConnectionState, parseHeartbeatReport } from './heartbeat';

const report = {
  observedAt: '2026-09-16T00:00:00.000Z',
  nodeVersion: 'dev',
  capabilities: ['managed-update-v1'],
  hostname: 'ws01',
  bootId: 'simulation-boot',
  uptimeSeconds: 120,
  inventory: {
    operatingSystem: 'Linux',
    cpu: { logicalCores: 8, model: 'Simulated CPU', utilizationPercent: 25 },
    memory: { totalBytes: 1000, usedBytes: 400, utilizationPercent: 40 },
    storage: { path: '/', totalBytes: 2000, usedBytes: 500, utilizationPercent: 25 },
    sessions: [{ username: 'ada', terminal: 'pts/0' }],
    gpuStatus: 'available',
    gpus: [
      {
        uuid: 'GPU-abc',
        index: 0,
        model: 'NVIDIA RTX PRO 6000',
        utilizationPercent: 72,
        memoryUsedBytes: 40_000,
        memoryTotalBytes: 96_000,
        temperatureC: 67
      }
    ],
    gpuProcesses: [
      {
        gpuUuid: 'GPU-abc',
        pid: 4102,
        uid: 1001,
        username: 'ada',
        command: 'python',
        memoryUsedBytes: 40_000,
        processStartTicks: 812345
      }
    ]
  }
};

describe('parseHeartbeatReport', () => {
  it('validates optional per-user storage snapshots, session identities, and heartbeat cadence', () => {
    const storage = {
      username: 'ada',
      uid: 20001,
      bytes: 1000,
      status: 'measured',
      observedAt: report.observedAt
    };
    expect(
      parseHeartbeatReport({ ...report, userStorage: [storage], reportIntervalSeconds: 15 })
        ?.userStorage[0].bytes
    ).toBe(1000);
    expect(
      parseHeartbeatReport({
        ...report,
        userStorage: [{ ...storage, bytes: null, status: 'scan_failed' }]
      })
    ).not.toBeNull();
    for (const entry of [
      { ...storage, bytes: -1 },
      { ...storage, uid: 1000 },
      { ...storage, status: 'scan_failed' },
      { ...storage, observedAt: '2027-01-01T00:00:00Z' }
    ])
      expect(parseHeartbeatReport({ ...report, userStorage: [entry] })).toBeNull();
    expect(parseHeartbeatReport({ ...report, userStorage: [storage, storage] })).toBeNull();
    expect(parseHeartbeatReport({ ...report, reportIntervalSeconds: 601 })).toBeNull();
    expect(
      parseHeartbeatReport({
        ...report,
        inventory: {
          ...report.inventory,
          sessions: [{ username: 'ada', terminal: 'pts/0', uid: 20001 }]
        }
      })?.inventory.sessions[0].uid
    ).toBe(20001);
  });
  it('accepts optional IP detection from new nodes and preserves compatibility with older nodes', () => {
    expect(parseHeartbeatReport(report)?.ipAddresses).toBeNull();
    expect(
      parseHeartbeatReport({ ...report, ipAddresses: ['192.168.1.50', '2001:db8::1'] })?.ipAddresses
    ).toEqual(['192.168.1.50', '2001:db8::1']);
    expect(parseHeartbeatReport({ ...report, ipAddresses: [] })?.ipAddresses).toEqual([]);
    for (const ipAddresses of [
      ['not-an-ip'],
      ['10.0.0.1', '10.0.0.1'],
      '10.0.0.1',
      [1],
      Array.from({ length: 65 }, (_, i) => `10.0.0.${i}`)
    ])
      expect(parseHeartbeatReport({ ...report, ipAddresses })).toBeNull();
  });
  it('accepts a complete bounded report', () => {
    expect(parseHeartbeatReport(report)).toMatchObject({
      hostname: 'ws01',
      uptimeSeconds: 120,
      capabilities: ['managed-update-v1']
    });
  });

  it('accepts legacy reports without capabilities and rejects duplicates', () => {
    const legacy = { ...report, capabilities: undefined };
    expect(parseHeartbeatReport(legacy)?.capabilities).toEqual([]);
    expect(parseHeartbeatReport({ ...report, capabilities: ['x', 'x'] })).toBeNull();
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

  it('rejects processes for an unreported GPU', () => {
    expect(
      parseHeartbeatReport({
        ...report,
        inventory: {
          ...report.inventory,
          gpuProcesses: [{ ...report.inventory.gpuProcesses[0], gpuUuid: 'GPU-other' }]
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
