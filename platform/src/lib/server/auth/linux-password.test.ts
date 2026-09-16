import { describe, expect, it } from 'vitest';

import { hashLinuxPassword, isLinuxPasswordHash } from './linux-password';

describe('Linux password hashing', () => {
  it.each([
    [
      'password',
      'saltstring',
      '$6$saltstring$adDbXsJjcDlq2662QPgd.tkSOVmnG9Tt3oXl4HR60SusC3AGjirnDenVZp3DGwLwqy6iYKCzannhaX9DR72nN1'
    ],
    [
      'Hello world!',
      'saltstring',
      '$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1'
    ]
  ])('matches the SHA-512 crypt vector for %j', (password, salt, expected) => {
    expect(hashLinuxPassword(password, salt)).toBe(expected);
  });

  it('generates independently salted hashes in the Linux shadow format', () => {
    const first = hashLinuxPassword('long-enough-password');
    const second = hashLinuxPassword('long-enough-password');
    expect(first).not.toBe(second);
    expect(isLinuxPasswordHash(first)).toBe(true);
    expect(isLinuxPasswordHash(second)).toBe(true);
  });

  it('rejects invalid salts and hashes', () => {
    expect(() => hashLinuxPassword('password', 'not valid')).toThrow();
    expect(isLinuxPasswordHash('$6$invalid')).toBe(false);
  });
});
