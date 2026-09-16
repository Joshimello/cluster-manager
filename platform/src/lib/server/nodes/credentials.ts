import { createHash, randomBytes } from 'node:crypto';

export const enrollmentTokenLifetimeMilliseconds = 30 * 60 * 1000;

const enrollmentTokenPattern = /^cmenroll_[A-Za-z0-9_-]{43}$/;
const nodeCredentialPattern = /^cmnode_[A-Za-z0-9_-]{43}$/;
const workstationNamePattern = /^[a-z][a-z0-9-]{1,31}$/;

export function hashNodeSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function issueEnrollmentToken(now = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = `cmenroll_${randomBytes(32).toString('base64url')}`;
  return {
    token,
    tokenHash: hashNodeSecret(token),
    expiresAt: new Date(now.getTime() + enrollmentTokenLifetimeMilliseconds)
  };
}

export function isEnrollmentToken(value: string): boolean {
  return enrollmentTokenPattern.test(value);
}

export function isNodeCredential(value: string): boolean {
  return nodeCredentialPattern.test(value);
}

export function normalizeWorkstationName(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeWorkstationDisplayName(value: string): string {
  return value.trim();
}

export function validateWorkstationName(value: string): string | null {
  if (!workstationNamePattern.test(value)) {
    return 'Name must be 2–32 characters using lowercase letters, numbers, and hyphens.';
  }
  return null;
}

export function validateWorkstationDisplayName(value: string): string | null {
  if (value.length < 1 || value.length > 120) {
    return 'Display name must be between 1 and 120 characters.';
  }
  return null;
}

export function readBearerCredential(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const credential = authorization.slice('Bearer '.length);
  return isNodeCredential(credential) ? credential : null;
}

export function isWorkstationId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
