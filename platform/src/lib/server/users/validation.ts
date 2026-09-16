import type { UserRole } from '$lib/server/db/schema';

const usernamePattern = /^[a-z][a-z0-9_-]{2,31}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  if (!usernamePattern.test(username)) {
    return 'Username must be 3–32 characters and use lowercase letters, numbers, _ or -.';
  }

  return null;
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/g, ' ');
}

export function validateDisplayName(displayName: string): string | null {
  if (displayName.length < 1 || displayName.length > 120) {
    return 'Display name must be between 1 and 120 characters.';
  }

  return null;
}

export function parseUserRole(value: string): UserRole | null {
  return value === 'user' || value === 'admin' ? value : null;
}

export function isUserId(value: string): boolean {
  return uuidPattern.test(value);
}
