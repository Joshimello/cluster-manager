import { describe, expect, it } from 'vitest';

import {
  canTransitionNodeUpdate,
  isNewerStableRelease,
  parseNodeUpdateResult,
  parseStableRelease
} from './updates';

describe('managed node updates', () => {
  it('accepts exact stable release tags only', () => {
    expect(parseStableRelease('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseStableRelease('v1.2.3-rc1')).toBeNull();
    expect(parseStableRelease('latest')).toBeNull();
  });

  it('allows upgrades but not same-version installs or downgrades', () => {
    expect(isNewerStableRelease('v0.2.2', 'v0.3.0')).toBe(true);
    expect(isNewerStableRelease('v1.2.3', 'v1.2.3')).toBe(false);
    expect(isNewerStableRelease('v2.0.0', 'v1.9.9')).toBe(false);
    expect(isNewerStableRelease('development', 'v1.0.0')).toBe(false);
  });

  it('validates bounded authenticated node results', () => {
    const result = parseNodeUpdateResult({
      instructionId: '11111111-1111-4111-8111-111111111111',
      status: 'restarting',
      detail: 'Verified and restarting.'
    });
    expect(result?.status).toBe('restarting');
    expect(parseNodeUpdateResult({ ...result, status: 'pending' })).toBeNull();
  });

  it('permits only safe forward state transitions', () => {
    expect(canTransitionNodeUpdate('dispatched', 'restarting')).toBe(true);
    expect(canTransitionNodeUpdate('dispatched', 'succeeded')).toBe(false);
    expect(canTransitionNodeUpdate('restarting', 'rolled_back')).toBe(true);
    expect(canTransitionNodeUpdate('succeeded', 'rolled_back')).toBe(true);
    expect(canTransitionNodeUpdate('succeeded', 'failed')).toBe(false);
  });
});
