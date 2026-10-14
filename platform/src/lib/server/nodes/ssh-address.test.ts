import { describe, expect, it } from 'vitest';
import {
  validSshAddress,
  validSshPort,
  workstationSshAddress,
  workstationSshCommand
} from './ssh-address';

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
  it('accepts only integer ports in the TCP port range', () => {
    for (const value of ['1', '22', '33400', '65535']) expect(validSshPort(value)).toBe(true);
    for (const value of ['', '0', '-1', '65536', '22.5', '2e2', '+22', '22;sh', ' 22', '22 '])
      expect(validSshPort(value)).toBe(false);
  });
  it('uses independent address and port overrides in SSH commands', () => {
    const workstation = {
      sshAddressOverride: null,
      sshPortOverride: null,
      ipAddresses: ['192.168.1.50']
    };
    expect(workstationSshCommand('alice', workstation)).toBe('ssh alice@192.168.1.50');
    expect(workstationSshCommand('alice', { ...workstation, sshPortOverride: 22 })).toBe(
      'ssh alice@192.168.1.50'
    );
    expect(workstationSshCommand('alice', { ...workstation, sshPortOverride: 33400 })).toBe(
      'ssh -p 33400 alice@192.168.1.50'
    );
    expect(
      workstationSshCommand('alice', {
        ...workstation,
        sshAddressOverride: 'gpu.example.org',
        sshPortOverride: 65535
      })
    ).toBe('ssh -p 65535 alice@gpu.example.org');
    expect(
      workstationSshCommand('alice', {
        ...workstation,
        sshAddressOverride: '2001:db8::1',
        sshPortOverride: 2222
      })
    ).toBe('ssh -p 2222 alice@2001:db8::1');
    expect(
      workstationSshCommand('alice', { ...workstation, sshPortOverride: 2222, ipAddresses: [] })
    ).toBeNull();
  });
});
