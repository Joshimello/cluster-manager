import { requireAdmin } from '$lib/server/auth/guards';
import { availableRelease, checkPlatformRelease } from '$lib/server/platform-updates/releases';
import { platformVersion } from '$lib/server/version';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = requireAdmin(locals);
  return {
    user,
    platformUpdateAvailable: availableRelease(platformVersion, await checkPlatformRelease())
  };
};
