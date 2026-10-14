import { describe, expect, it } from 'vitest';

import type { Workstation } from '$lib/server/db/schema';
import { presentWorkstation } from './presentation';

describe('presentWorkstation', () => {
  it('does not expose stored secret hashes', () => {
    const workstation = {
      ipAddresses: ['192.168.1.50'],
      sshAddressOverride: null,
      sshPortOverride: null,
      credentialHash: 'credential-hash',
      enrollmentTokenHash: 'enrollment-hash'
    } as Workstation;
    const presented = presentWorkstation(workstation);
    expect(presented).not.toHaveProperty('credentialHash');
    expect(presented).not.toHaveProperty('enrollmentTokenHash');
    expect(presented.enrolled).toBe(true);
    expect(presented.sshAddress).toBe('192.168.1.50');
    expect(presented.sshPort).toBe(22);
    expect(presentWorkstation({ ...workstation, sshPortOverride: 33400 }).sshPort).toBe(33400);
  });
});
