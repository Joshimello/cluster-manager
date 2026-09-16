import { describe, expect, it } from 'vitest';

import {
  normalizeDisplayName,
  normalizeUsername,
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
});
