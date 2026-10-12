import { describe, expect, it, vi } from 'vitest';
import { availableRelease, createReleaseChecker, parseRelease } from './releases';
const release = {
  tag_name: 'v0.6.0',
  draft: false,
  prerelease: false,
  published_at: '2026-10-12T10:00:00Z',
  body: 'Release notes',
  html_url: 'https://malicious.example'
};
describe('stable release checks', () => {
  it('trusts only published stable tags and derives the fixed project URL', () => {
    expect(parseRelease(release)?.url).toBe(
      'https://github.com/Joshimello/cluster-manager/releases/tag/v0.6.0'
    );
    for (const changes of [
      { draft: true },
      { prerelease: true },
      { published_at: null },
      { tag_name: 'latest' },
      { tag_name: 'v0.6.0-rc1' }
    ])
      expect(parseRelease({ ...release, ...changes })).toBeNull();
  });
  it('caches automatic checks for six hours, throttles manual checks, and retains last good data on failure', async () => {
    let now = 0;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(release)));
    const check = createReleaseChecker(fetcher, () => now);
    expect(availableRelease('v0.5.0', await check())).toBe('v0.6.0');
    await check();
    await check(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 61_000;
    fetcher.mockResolvedValue(new Response('', { status: 503 }));
    const failed = await check(true);
    expect(failed.release?.version).toBe('v0.6.0');
    expect(failed.error).toBeTruthy();
    expect(availableRelease('v0.5.0', failed)).toBeNull();
    now += 6 * 60 * 60_000;
    fetcher.mockResolvedValue(new Response(JSON.stringify(release)));
    await check();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
