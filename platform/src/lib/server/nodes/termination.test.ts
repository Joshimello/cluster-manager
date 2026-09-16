import { describe, expect, it } from 'vitest';

import { parseTerminationResult } from './termination';

const valid = {
  instructionId: '11111111-1111-4111-8111-111111111111',
  outcome: 'terminated',
  detail: 'Process exited after SIGTERM.',
  termSent: true,
  killSent: false
};

describe('termination result validation', () => {
  it('accepts a bounded semantic result', () => {
    expect(parseTerminationResult(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, instructionId: 'nope' },
    { ...valid, outcome: 'shell_ran' },
    { ...valid, detail: '' },
    { ...valid, termSent: false, killSent: true },
    { ...valid, extra: undefined, detail: 'x'.repeat(1001) }
  ])('rejects invalid or contradictory results', (value) => {
    expect(parseTerminationResult(value)).toBeNull();
  });
});
