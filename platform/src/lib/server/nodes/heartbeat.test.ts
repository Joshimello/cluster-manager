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
