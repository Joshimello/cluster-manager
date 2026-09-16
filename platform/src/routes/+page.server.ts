import { checkDatabase } from '$lib/server/health';

export async function load() {
  return {
    database: await checkDatabase()
  };
}
