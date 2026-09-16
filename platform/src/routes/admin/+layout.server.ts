import { requireAdmin } from '$lib/server/auth/guards';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  user: requireAdmin(locals)
});
