import { json } from '@sveltejs/kit';
import { authenticateUpdater, nextPlatformUpdate } from '$lib/server/platform-updates/service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  if (!authenticateUpdater(request)) return json({ error: 'Unauthorized' }, { status: 401 });
  return json(
    { operation: await nextPlatformUpdate() },
    { headers: { 'cache-control': 'no-store' } }
  );
};
