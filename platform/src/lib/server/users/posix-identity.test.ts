import { describe, expect, it } from 'vitest';

import { allocatePosixIdentity, PosixIdentityPoolExhaustedError } from './posix-identity';

describe('POSIX identity allocation', () => {
  it('uses one platform value for both UID and private GID', async () => {
    const identity = await allocatePosixIdentity(async () => [{ posixId: 20_123 }]);
    expect(identity).toEqual({ uid: 20_123, gid: 20_123 });
  });

  it('maps sequence exhaustion to an operator-facing error', async () => {
    await expect(
      allocatePosixIdentity(async () => {
        throw Object.assign(new Error('reached maximum value'), { code: '2200H' });
      })
    ).rejects.toBeInstanceOf(PosixIdentityPoolExhaustedError);
  });

  it('rejects allocator values outside the reserved range', async () => {
    await expect(allocatePosixIdentity(async () => [{ posixId: 60_000 }])).rejects.toThrow(
      'invalid value'
    );
  });
});
