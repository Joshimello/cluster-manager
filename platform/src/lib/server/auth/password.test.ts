import { describe, expect, it } from 'vitest';

import {
  generateTemporaryPassword,
  hashPassword,
  maximumPasswordLength,
  minimumPasswordLength,
  validatePassword,
  verifyPassword
} from './password';

describe('passwords', () => {
  it('hashes with Argon2id and verifies the correct password', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'incorrect password')).resolves.toBe(false);
  });

  it('enforces password length boundaries', () => {
    expect(validatePassword('a'.repeat(minimumPasswordLength - 1))).toContain('at least');
    expect(validatePassword('a'.repeat(minimumPasswordLength))).toBeNull();
    expect(validatePassword('a'.repeat(maximumPasswordLength + 1))).toContain('no more');
  });

  it('generates temporary passwords that meet the policy', () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();

    expect(validatePassword(first)).toBeNull();
    expect(first).not.toBe(second);
  });
});
