export const monitoringRanges = ['15m', '1h', '6h', '24h'] as const;

export type MonitoringRange = (typeof monitoringRanges)[number];

export const monitoringRangeConfig: Record<
  MonitoringRange,
  { label: string; durationMilliseconds: number; bucketSeconds: number }
> = {
  '15m': { label: '15m', durationMilliseconds: 15 * 60_000, bucketSeconds: 15 },
  '1h': { label: '1h', durationMilliseconds: 60 * 60_000, bucketSeconds: 30 },
  '6h': { label: '6h', durationMilliseconds: 6 * 60 * 60_000, bucketSeconds: 120 },
  '24h': { label: '24h', durationMilliseconds: 24 * 60 * 60_000, bucketSeconds: 300 }
};

export function parseMonitoringRange(value: string | null | undefined): MonitoringRange {
  return monitoringRanges.includes(value as MonitoringRange) ? (value as MonitoringRange) : '1h';
}

export type WorkstationHistoryPoint = {
  observedAt: string;
  cpuUtilizationPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  storagePath: string;
  storageUsedBytes: number;
  storageTotalBytes: number;
};

export type GpuHistoryPoint = {
  observedAt: string;
  utilizationPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  temperatureC: number | null;
};

export type MonitoringHistoryResponse = {
  range: MonitoringRange;
  from: string;
  to: string;
  generatedAt: string;
  bucketSeconds: number;
  workstations: Array<{
    workstationId: string;
    points: WorkstationHistoryPoint[];
    gpus: Array<{ gpuId: string; points: GpuHistoryPoint[] }>;
  }>;
};
