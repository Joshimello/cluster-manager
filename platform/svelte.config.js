import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // The built-in list is generated at build time, but deployment-specific trusted
    // origins are runtime configuration. hooks.server.ts applies the equivalent check.
    csrf: { trustedOrigins: ['*'] }
  }
};

export default config;
