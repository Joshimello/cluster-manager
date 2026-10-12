import { isNewerStableRelease, parseStableRelease } from '$lib/server/nodes/updates';

export type StableRelease = { version: string; url: string; notes: string; publishedAt: string };
export type ReleaseCheck = {
  release: StableRelease | null;
  checkedAt: string | null;
  error: string | null;
};

export function parseRelease(value: unknown): StableRelease | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    !parseStableRelease(item.tag_name) ||
    item.draft !== false ||
    item.prerelease !== false ||
    typeof item.published_at !== 'string' ||
    !Number.isFinite(Date.parse(item.published_at))
  )
    return null;
  const version = item.tag_name as string;
  return {
    version,
    url: `https://github.com/Joshimello/cluster-manager/releases/tag/${version}`,
    notes: typeof item.body === 'string' ? item.body.slice(0, 20_000) : '',
    publishedAt: item.published_at
  };
}

export function createReleaseChecker(fetcher: typeof fetch = fetch, now = () => Date.now()) {
  let cached: ReleaseCheck = { release: null, checkedAt: null, error: null };
  let nextCheck = 0;
  let lastAttempt = -Infinity;
  let running: Promise<ReleaseCheck> | null = null;
  return async (force = false): Promise<ReleaseCheck> => {
    if (running) return running;
    if (now() < nextCheck && (!force || now() - lastAttempt < 60_000)) return cached;
    lastAttempt = now();
    running = (async () => {
      try {
        const response = await fetcher(
          'https://api.github.com/repos/Joshimello/cluster-manager/releases/latest',
          {
            headers: {
              accept: 'application/vnd.github+json',
              'user-agent': 'cluster-manager-update-checker'
            },
            signal: AbortSignal.timeout(10_000),
            redirect: 'error'
          }
        );
        if (!response.ok) throw new Error('Release check unavailable.');
        const source = await response.text();
        if (source.length > 512_000) throw new Error('Release response too large.');
        const release = parseRelease(JSON.parse(source));
        if (!release) throw new Error('No published stable release found.');
        cached = { release, checkedAt: new Date(now()).toISOString(), error: null };
        nextCheck = now() + 6 * 60 * 60_000;
      } catch {
        cached = {
          ...cached,
          error: 'Could not check GitHub. Check the network connection and try again.'
        };
        nextCheck = now() + 5 * 60_000;
      } finally {
        running = null;
      }
      return cached;
    })();
    return running;
  };
}

export const checkPlatformRelease = createReleaseChecker();
export function availableRelease(current: string, check: ReleaseCheck): string | null {
  return check.release && !check.error && isNewerStableRelease(current, check.release.version)
    ? check.release.version
    : null;
}
