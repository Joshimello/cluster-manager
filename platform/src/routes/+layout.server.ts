import { platformVersion } from '$lib/server/version';

export function load({ locals }) {
  return {
    user: locals.user,
    platformVersion
  };
}
