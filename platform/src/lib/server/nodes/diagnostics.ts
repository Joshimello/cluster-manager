import { and, inArray, lt } from 'drizzle-orm';

import { recordAudit } from '$lib/server/audit';
import { getDatabase } from '$lib/server/db';
import { gpuDiagnosticRuns } from '$lib/server/db/schema';

export const gpuDiagnosticsCapability = 'gpu-diagnostics-v1';
export const diagnosticDispatchLifetimeMilliseconds = 10 * 60_000;
export const diagnosticReservationBufferMilliseconds = 5 * 60_000;
export const diagnosticManifestPath = '/var/lib/cluster-manager/diagnostics-manifest.json';
export const activeDiagnosticStatuses = [
  'pending',
  'dispatched',
  'running',
  'cancel_requested'
] as const;
export const terminalDiagnosticStatuses = [
  'passed',
  'faulty',
  'failed',
  'refused',
  'cancelled'
] as const;

export type DiagnosticResultStatus =
  'running' | 'passed' | 'faulty' | 'failed' | 'refused' | 'cancelled';

export type DiagnosticGpuResult = {
  gpuUuid: string;
  localIndex: number;
  model: string;
  outcome: 'passed' | 'faulty' | 'failed' | 'cancelled';
  maxTemperatureC: number | null;
  peakUtilizationPercent: number | null;
  peakMemoryBytes: number | null;
  averageGflops: number | null;
  maximumGflops: number | null;
  errorCount: number;
  detail: string | null;
};

export type DiagnosticReport = {
  runId: string;
  status: DiagnosticResultStatus;
  detail: string;
  outputLog: string;
  results: DiagnosticGpuResult[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function nullableNumber(
  value: unknown,
  minimum: number,
  maximum: number
): number | null | undefined {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, minimum, maximum) ?? undefined;
}

export function validDiagnosticImageDigest(value: unknown): value is string {
  return typeof value === 'string' && digestPattern.test(value);
}

export function parseDiagnosticReport(value: unknown): DiagnosticReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const rootKeys = new Set(['runId', 'status', 'detail', 'outputLog', 'results']);
  if (
    Object.keys(body).some((key) => !rootKeys.has(key)) ||
    typeof body.runId !== 'string' ||
    !uuidPattern.test(body.runId) ||
    typeof body.status !== 'string' ||
    !['running', 'passed', 'faulty', 'failed', 'refused', 'cancelled'].includes(body.status) ||
    typeof body.detail !== 'string' ||
    body.detail.length < 1 ||
    body.detail.length > 2000 ||
    typeof body.outputLog !== 'string' ||
    body.outputLog.length > 65_536 ||
    !Array.isArray(body.results) ||
    body.results.length > 32
  ) {
    return null;
  }

  const results: DiagnosticGpuResult[] = [];
  const uuids = new Set<string>();
  for (const candidate of body.results) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const result = candidate as Record<string, unknown>;
    const resultKeys = new Set([
      'gpuUuid',
      'localIndex',
      'model',
      'outcome',
      'maxTemperatureC',
      'peakUtilizationPercent',
      'peakMemoryBytes',
      'averageGflops',
      'maximumGflops',
      'errorCount',
      'detail'
    ]);
    const maxTemperatureC = nullableNumber(result.maxTemperatureC, -100, 250);
    const peakUtilizationPercent = nullableNumber(result.peakUtilizationPercent, 0, 100);
    const peakMemoryBytes = nullableNumber(result.peakMemoryBytes, 0, Number.MAX_SAFE_INTEGER);
    const averageGflops = nullableNumber(result.averageGflops, 0, Number.MAX_SAFE_INTEGER);
    const maximumGflops = nullableNumber(result.maximumGflops, 0, Number.MAX_SAFE_INTEGER);
    if (
      Object.keys(result).some((key) => !resultKeys.has(key)) ||
      typeof result.gpuUuid !== 'string' ||
      result.gpuUuid.length < 1 ||
      result.gpuUuid.length > 128 ||
      uuids.has(result.gpuUuid) ||
      typeof result.localIndex !== 'number' ||
      !Number.isInteger(result.localIndex) ||
      result.localIndex < 0 ||
      result.localIndex > 31 ||
      typeof result.model !== 'string' ||
      result.model.length < 1 ||
      result.model.length > 255 ||
      typeof result.outcome !== 'string' ||
      !['passed', 'faulty', 'failed', 'cancelled'].includes(result.outcome) ||
      maxTemperatureC === undefined ||
      peakUtilizationPercent === undefined ||
      peakMemoryBytes === undefined ||
      averageGflops === undefined ||
      maximumGflops === undefined ||
      typeof result.errorCount !== 'number' ||
      !Number.isInteger(result.errorCount) ||
      result.errorCount < 0 ||
      result.errorCount > 2_147_483_647 ||
      (result.detail !== null &&
        result.detail !== undefined &&
        (typeof result.detail !== 'string' || result.detail.length > 1000))
    ) {
      return null;
    }
    uuids.add(result.gpuUuid);
    results.push({
      gpuUuid: result.gpuUuid,
      localIndex: result.localIndex,
      model: result.model,
      outcome: result.outcome as DiagnosticGpuResult['outcome'],
      maxTemperatureC,
      peakUtilizationPercent,
      peakMemoryBytes,
      averageGflops,
      maximumGflops,
      errorCount: result.errorCount,
      detail: typeof result.detail === 'string' ? result.detail : null
    });
  }

  if (body.status === 'running' && results.length > 0) return null;
  return {
    runId: body.runId,
    status: body.status as DiagnosticResultStatus,
    detail: body.detail,
    outputLog: body.outputLog,
    results
  };
}

export function canTransitionDiagnostic(current: string, next: DiagnosticResultStatus): boolean {
  if (current === 'dispatched')
    return next === 'running' || next === 'failed' || next === 'refused';
  if (current === 'running') return ['passed', 'faulty', 'failed', 'cancelled'].includes(next);
  // Completion can race with an administrator's cancellation request. Preserve
  // the node's actual terminal result when gpu-burn ended before the request
  // reached it.
  if (current === 'cancel_requested')
    return ['passed', 'faulty', 'cancelled', 'failed'].includes(next);
  return false;
}

export async function expireDiagnostics(now = new Date()): Promise<void> {
  const expiredBeforeStart = await getDatabase()
    .update(gpuDiagnosticRuns)
    .set({
      status: 'expired',
      detail: 'The node did not start or finish the diagnostic before its safety deadline.',
      completedAt: now,
      updatedAt: now
    })
    .where(
      and(
        inArray(gpuDiagnosticRuns.status, ['pending', 'dispatched']),
        lt(gpuDiagnosticRuns.expiresAt, now)
      )
    )
    .returning({ id: gpuDiagnosticRuns.id, workstationId: gpuDiagnosticRuns.workstationId });

  const expiredDuringRun = await getDatabase()
    .update(gpuDiagnosticRuns)
    .set({
      status: 'failed',
      detail: 'The node did not report a final result before the diagnostic safety window ended.',
      completedAt: now,
      updatedAt: now
    })
    .where(
      and(
        inArray(gpuDiagnosticRuns.status, ['running', 'cancel_requested']),
        lt(gpuDiagnosticRuns.reservedUntil, now)
      )
    )
    .returning({ id: gpuDiagnosticRuns.id, workstationId: gpuDiagnosticRuns.workstationId });

  for (const run of [...expiredBeforeStart, ...expiredDuringRun]) {
    await recordAudit((query) => getDatabase().execute(query), {
      actorUserId: null,
      action: expiredDuringRun.some((candidate) => candidate.id === run.id)
        ? 'gpu_diagnostic.failed'
        : 'gpu_diagnostic.expired',
      targetType: 'gpu_diagnostic',
      targetId: run.id,
      metadata: { workstationId: run.workstationId }
    });
  }
}
