import { createServer } from 'node:http';
import { handler } from '../build/handler.js';
import { oidcMiddleware } from './oidc.mjs';
const server = createServer((req, res) => {
  void oidcMiddleware(req, res, () => handler(req, res));
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
