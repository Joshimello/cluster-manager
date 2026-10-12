import { json } from '@sveltejs/kit';
import {
  authenticateUpdater,
  parseUpdateResult,
  reportPlatformUpdate
} from '$lib/server/platform-updates/service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  if (!authenticateUpdater(request)) return json({ error: 'Unauthorized' }, { status: 401 });
  if (Number(request.headers.get('content-length')) > 4096)
    return json({ error: 'Too large' }, { status: 413 });
  const result = parseUpdateResult(await request.json().catch(() => null));
  if (!result) return json({ error: 'Invalid result' }, { status: 400 });
  const accepted = await reportPlatformUpdate(result);
  return json({ accepted }, { status: accepted ? 200 : 409 });
};
