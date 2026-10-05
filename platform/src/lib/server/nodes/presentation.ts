import { workstationSshAddress } from './ssh-address';
import type { Workstation } from '$lib/server/db/schema';

export function presentWorkstation(workstation: Workstation) {
  return {
    id: workstation.id,
    name: workstation.name,
    displayName: workstation.displayName,
    status: workstation.status,
    enrollmentExpiresAt: workstation.enrollmentExpiresAt,
    enrollmentUsedAt: workstation.enrollmentUsedAt,
    credentialIssuedAt: workstation.credentialIssuedAt,
    enrolledAt: workstation.enrolledAt,
    enrolled: workstation.credentialHash !== null,
    lastHeartbeatAt: workstation.lastHeartbeatAt,
    inventoryObservedAt: workstation.inventoryObservedAt,
    nodeVersion: workstation.nodeVersion,
    nodeCapabilities: workstation.nodeCapabilities,
    hostname: workstation.hostname,
    ipAddresses: workstation.ipAddresses,
    sshAddressOverride: workstation.sshAddressOverride,
    sshAddress: workstationSshAddress(workstation),
    bootId: workstation.bootId,
    uptimeSeconds: workstation.uptimeSeconds,
    inventory: workstation.inventory,
    createdAt: workstation.createdAt,
    updatedAt: workstation.updatedAt
  };
}
