import { describe, expect, it } from 'vitest';

import type { Workstation } from '$lib/server/db/schema';
import { presentWorkstation } from './presentation';

describe('presentWorkstation', () => {
  it('does not expose stored secret hashes', () => {
    const workstation = {
      credentialHash: 'credential-hash',
      enrollmentTokenHash: 'enrollment-hash'
    } as Workstation;
    const presented = presentWorkstation(workstation);
    expect(presented).not.toHaveProperty('credentialHash');
    expect(presented).not.toHaveProperty('enrollmentTokenHash');
    expect(presented.enrolled).toBe(true);
  });
});
