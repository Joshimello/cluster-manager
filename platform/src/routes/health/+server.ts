import { json } from '@sveltejs/kit';

import { checkDatabase } from '$lib/server/health';

export async function GET() {
  const health = await checkDatabase();

  return json(health, {
    status: health.status === 'ready' ? 200 : 503,
    headers: {
      'cache-control': 'no-store'
    }
  });
}
