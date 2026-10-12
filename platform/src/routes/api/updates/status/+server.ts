import { json } from '@sveltejs/kit';
import { platformVersion } from '$lib/server/version';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ locals }) => {
  if (!locals.user || locals.user.role !== 'admin' || locals.user.mustChangePassword)
    return json({ error: 'Unauthorized' }, { status: 401 });
  return json({ version: platformVersion }, { headers: { 'cache-control': 'no-store' } });
};
