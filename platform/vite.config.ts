import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { oidcMiddleware } from './runtime/oidc.mjs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    {
      name: 'identity-provider',
      configureServer(server) {
        Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''));
        server.middlewares.use((req, res, next) => {
          void oidcMiddleware(req, res, next);
        });
      }
    }
  ],
  server: {
    allowedHosts: ['platform']
  },
  test: {
    include: ['src/**/*.test.ts']
  }
});
