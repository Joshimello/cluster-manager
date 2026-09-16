import { describe, expect, it, vi } from 'vitest';

import { checkDatabase } from './health';

describe('database health', () => {
  it('is ready after a successful probe', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);

    await expect(checkDatabase(probe)).resolves.toEqual({ status: 'ready' });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('is not ready when the probe fails', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(checkDatabase(probe)).resolves.toEqual({ status: 'not_ready' });
  });
});
