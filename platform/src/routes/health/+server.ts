import { json } from '@sveltejs/kit';

import { checkDatabase } from '$lib/server/health';
import { platformVersion } from '$lib/server/version';

export async function GET() {
  const health = await checkDatabase();

  return json(
    { ...health, version: platformVersion },
    {
      status: health.status === 'ready' ? 200 : 503,
      headers: {
        'cache-control': 'no-store'
      }
    }
  );
}
