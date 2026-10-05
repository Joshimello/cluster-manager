import { isIP } from 'node:net';

// Only a host, never SSH options, a URL, a port, or a shell expression.
export function validSshAddress(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (isIP(value)) return !value.includes('%');
  if (/^[\d.]+$/.test(value)) return false;
  return value
    .replace(/\.$/, '')
    .split('.')
    .every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
}

export function workstationSshAddress(workstation: {
  sshAddressOverride: string | null;
  ipAddresses: string[];
}): string | null {
  return workstation.sshAddressOverride ?? workstation.ipAddresses[0] ?? null;
}
