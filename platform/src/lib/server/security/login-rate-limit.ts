const attempts = new Map<string, { count: number; until: number }>();
export function allowLoginAttempt(address: string, username: string, now = Date.now()): boolean {
  const keys = [
    [`ip:${address}`, 600],
    [`user:${address}:${username.slice(0, 64)}`, 10]
  ] as const;
  let allowed = true;
  for (const [key, limit] of keys) {
    let bucket = attempts.get(key);
    if (!bucket || bucket.until <= now) {
      bucket = { count: 0, until: now + 60_000 };
      attempts.set(key, bucket);
    }
    if (++bucket.count > limit) allowed = false;
  }
  if (attempts.size > 10_000)
    for (const [key, bucket] of attempts) if (bucket.until <= now) attempts.delete(key);
  return allowed;
}
