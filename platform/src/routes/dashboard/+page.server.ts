import { requireReadyUser } from '$lib/server/auth/guards';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
  user: requireReadyUser(locals)
});
