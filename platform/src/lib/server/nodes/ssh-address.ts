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

export function validSshPort(value: string): boolean {
  return /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

export function workstationSshCommand(
  username: string,
  workstation: {
    sshAddressOverride: string | null;
    sshPortOverride: number | null;
    ipAddresses: string[];
  }
): string | null {
  const address = workstationSshAddress(workstation);
  if (!address) return null;
  const port = workstation.sshPortOverride ?? 22;
  return `ssh${port === 22 ? '' : ` -p ${port}`} ${username}@${address}`;
}
