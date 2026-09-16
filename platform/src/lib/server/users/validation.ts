import type { UserRole } from '$lib/server/db/schema';

const usernamePattern = /^[a-z][a-z0-9_-]{2,31}$/;

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
