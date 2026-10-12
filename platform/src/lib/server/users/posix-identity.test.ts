import { describe, expect, it, vi } from 'vitest';

import { allocatePosixIdentity, PosixIdentityPoolExhaustedError } from './posix-identity';

describe('POSIX identity allocation', () => {
  it('uses one platform value for both UID and private GID', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ posixId: 20123 }])
      .mockResolvedValueOnce([]);
    const identity = await allocatePosixIdentity(execute);
    expect(identity).toEqual({ uid: 20_123, gid: 20_123 });
  });

  it('skips reserved IDs before allocating a new identity', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ posixId: 20003 }])
      .mockResolvedValueOnce([{ posixId: 20003 }])
      .mockResolvedValueOnce([{ posixId: 20004 }])
      .mockResolvedValueOnce([]);
    expect(await allocatePosixIdentity(execute)).toEqual({ uid: 20004, gid: 20004 });
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
