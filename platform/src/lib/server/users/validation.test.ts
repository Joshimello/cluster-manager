import { describe, expect, it } from 'vitest';

import {
  normalizeDisplayName,
  normalizeUsername,
  isUserId,
  parseUserRole,
  validateDisplayName,
  validateUsername
} from './validation';

describe('user validation', () => {
  it('normalizes and validates usernames', () => {
    expect(normalizeUsername(' Alice-Smith ')).toBe('alice-smith');
    expect(validateUsername('alice-smith')).toBeNull();
    expect(validateUsername('Alice')).not.toBeNull();
    expect(validateUsername('a')).not.toBeNull();
  });

  it('normalizes and validates display names', () => {
    expect(normalizeDisplayName('  Alice   Smith ')).toBe('Alice Smith');
    expect(validateDisplayName('Alice Smith')).toBeNull();
    expect(validateDisplayName('')).not.toBeNull();
  });

  it('accepts only known roles', () => {
    expect(parseUserRole('user')).toBe('user');
    expect(parseUserRole('admin')).toBe('admin');
    expect(parseUserRole('owner')).toBeNull();
  });

  it('recognizes UUID user identifiers', () => {
    expect(isUserId('2c44baca-8f98-4b2d-9d15-c332e8fb0f55')).toBe(true);
    expect(isUserId('not-a-user-id')).toBe(false);
  });
});
