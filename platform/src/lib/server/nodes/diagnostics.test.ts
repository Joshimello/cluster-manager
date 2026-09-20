import { describe, expect, it } from 'vitest';

import {
  canTransitionDiagnostic,
  parseDiagnosticReport,
  validDiagnosticImageDigest
} from './diagnostics';

const runId = '123e4567-e89b-42d3-a456-426614174000';

describe('GPU diagnostic protocol validation', () => {
  it('accepts bounded terminal results', () => {
    expect(
      parseDiagnosticReport({
        runId,
        status: 'passed',
        detail: 'Completed.',
        outputLog: 'GPU 0: OK',
        results: [
          {
            gpuUuid: 'GPU-abc',
            localIndex: 0,
            model: 'RTX',
            outcome: 'passed',
            maxTemperatureC: 81,
            peakUtilizationPercent: 100,
            peakMemoryBytes: 10_000,
            averageGflops: 100,
            maximumGflops: 110,
            errorCount: 0,
            detail: null
          }
        ]
      })
    ).not.toBeNull();
  });

  it('rejects duplicate GPUs and oversized logs', () => {
    const result = {
      gpuUuid: 'GPU-abc',
      localIndex: 0,
      model: 'RTX',
      outcome: 'passed',
      maxTemperatureC: null,
      peakUtilizationPercent: null,
      peakMemoryBytes: null,
      averageGflops: null,
      maximumGflops: null,
      errorCount: 0,
      detail: null
    };
    expect(
      parseDiagnosticReport({
        runId,
        status: 'passed',
        detail: 'Completed.',
        outputLog: '',
        results: [result, result]
      })
    ).toBeNull();
    expect(
      parseDiagnosticReport({
        runId,
        status: 'failed',
        detail: 'Failed.',
        outputLog: 'x'.repeat(65_537),
        results: []
      })
    ).toBeNull();
  });

  it('allows only explicit state transitions and SHA-256 digests', () => {
    expect(canTransitionDiagnostic('dispatched', 'running')).toBe(true);
    expect(canTransitionDiagnostic('pending', 'running')).toBe(false);
    expect(canTransitionDiagnostic('cancel_requested', 'passed')).toBe(true);
    expect(canTransitionDiagnostic('cancel_requested', 'refused')).toBe(false);
    expect(validDiagnosticImageDigest(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(validDiagnosticImageDigest('latest')).toBe(false);
  });
});
