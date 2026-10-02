import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './api.js';
import { loadSecret } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db, { secret = loadSecret(db), clientDir = path.resolve(__dirname, '../../client/dist') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use('/api', apiRouter(db, secret));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built client in production.
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
