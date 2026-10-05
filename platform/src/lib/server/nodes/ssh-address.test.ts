import { describe, expect, it } from 'vitest';
import { validSshAddress, workstationSshAddress } from './ssh-address';

describe('SSH instruction addresses', () => {
  it('prefers an admin override and returns no command host until detection is available', () => {
    expect(workstationSshAddress({ sshAddressOverride: null, ipAddresses: [] })).toBeNull();
    expect(
      workstationSshAddress({ sshAddressOverride: null, ipAddresses: ['192.168.1.50', '10.0.0.2'] })
    ).toBe('192.168.1.50');
    expect(
      workstationSshAddress({
        sshAddressOverride: 'gpu.example.org',
        ipAddresses: ['192.168.1.50']
      })
    ).toBe('gpu.example.org');
  });
  it('accepts IPs and DNS hosts while rejecting command injection and malformed hosts', () => {
    for (const value of [
      '192.168.1.50',
      '2001:db8::1',
      'gpu.example.org',
      'gpu-1',
      'gpu.example.org.'
    ])
      expect(validSshAddress(value)).toBe(true);
    for (const value of [
      '',
      '999.1.1.1',
      '-oProxyCommand=sh',
      'gpu;whoami',
      '$(whoami)',
      'gpu host',
      'user@host',
      'https://host',
      'host:22',
      'fe80::1%eth0',
      'a'.repeat(254)
    ])
      expect(validSshAddress(value)).toBe(false);
  });
});
