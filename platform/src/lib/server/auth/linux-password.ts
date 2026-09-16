import { createHash, randomBytes } from 'node:crypto';

const cryptAlphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rounds = 5_000;

function digest(...parts: Buffer[]): Buffer {
  const hash = createHash('sha512');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function repeatToLength(value: Buffer, length: number): Buffer {
  const result = Buffer.alloc(length);
  for (let offset = 0; offset < length; offset += value.length) {
    value.copy(result, offset, 0, Math.min(value.length, length - offset));
  }
  return result;
}

function cryptBase64(output: string[], byte2: number, byte1: number, byte0: number, count: number) {
  let value = (byte2 << 16) | (byte1 << 8) | byte0;
  for (let index = 0; index < count; index += 1) {
    output.push(cryptAlphabet[value & 0x3f]);
    value >>>= 6;
  }
}

function encodeDigest(value: Buffer): string {
  const output: string[] = [];
  const groups = [
    [0, 21, 42],
    [22, 43, 1],
    [44, 2, 23],
    [3, 24, 45],
    [25, 46, 4],
    [47, 5, 26],
    [6, 27, 48],
    [28, 49, 7],
    [50, 8, 29],
    [9, 30, 51],
    [31, 52, 10],
    [53, 11, 32],
    [12, 33, 54],
    [34, 55, 13],
    [56, 14, 35],
    [15, 36, 57],
    [37, 58, 16],
    [59, 17, 38],
    [18, 39, 60],
    [40, 61, 19],
    [62, 20, 41]
  ] as const;

  for (const [byte2, byte1, byte0] of groups) {
    cryptBase64(output, value[byte2], value[byte1], value[byte0], 4);
  }
  cryptBase64(output, 0, 0, value[63], 2);
  return output.join('');
}

function generateSalt(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes, (value) => cryptAlphabet[value & 0x3f]).join('');
}

export function hashLinuxPassword(password: string, salt = generateSalt()): string {
  if (!/^[./0-9A-Za-z]{1,16}$/.test(salt)) {
    throw new Error('Linux password salt must contain 1–16 crypt-base64 characters.');
  }

  const passwordBytes = Buffer.from(password, 'utf8');
  const saltBytes = Buffer.from(salt, 'ascii');
  let alternate = digest(passwordBytes, saltBytes, passwordBytes);

  const initialParts = [passwordBytes, saltBytes, repeatToLength(alternate, passwordBytes.length)];
  for (let count = passwordBytes.length; count > 0; count >>>= 1) {
    initialParts.push(count & 1 ? alternate : passwordBytes);
  }
  alternate = digest(...initialParts);

  const passwordDigest = digest(
    ...Array.from({ length: passwordBytes.length }, () => passwordBytes)
  );
  const repeatedPassword = repeatToLength(passwordDigest, passwordBytes.length);
  const saltDigest = digest(...Array.from({ length: 16 + alternate[0] }, () => saltBytes));
  const repeatedSalt = repeatToLength(saltDigest, saltBytes.length);

  for (let count = 0; count < rounds; count += 1) {
    const parts: Buffer[] = [count & 1 ? repeatedPassword : alternate];
    if (count % 3 !== 0) parts.push(repeatedSalt);
    if (count % 7 !== 0) parts.push(repeatedPassword);
    parts.push(count & 1 ? alternate : repeatedPassword);
    alternate = digest(...parts);
  }

  return `$6$${salt}$${encodeDigest(alternate)}`;
}

export function isLinuxPasswordHash(value: string): boolean {
  return /^\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$/.test(value);
}
