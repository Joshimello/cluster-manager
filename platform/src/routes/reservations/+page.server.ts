import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  redirect(307, resolve('/dashboard'));
};
