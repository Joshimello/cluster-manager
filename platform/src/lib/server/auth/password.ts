import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

export const minimumPasswordLength = 12;
export const maximumPasswordLength = 128;

const argon2Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32
} as const;

export function validatePassword(password: string): string | null {
  if (password.length < minimumPasswordLength) {
    return `Password must be at least ${minimumPasswordLength} characters.`;
  }

  if (password.length > maximumPasswordLength) {
    return `Password must be no more than ${maximumPasswordLength} characters.`;
  }

  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const validationError = validatePassword(password);

  if (validationError) {
    throw new Error(validationError);
  }

  return hash(password, argon2Options);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}
