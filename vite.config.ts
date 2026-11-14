import { defineConfig, type Plugin } from 'vite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScoresApi } from './server/scores-api.mjs';

/** Reçoit les messages de src/core/diag.ts (téléphone en cours d'essai) et les écrit dans e2e/out/device.log. */
const deviceLog = (): Plugin => ({
  name: 'hr-device-log',
  configureServer(server) {
    server.middlewares.use('/__hr_log', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          mkdirSync('e2e/out', { recursive: true });
          appendFileSync('e2e/out/device.log', `${new Date().toISOString()} ${req.socket.remoteAddress} ${body}\n`);
        } catch { /* sans importance */ }
        res.statusCode = 204;
        res.end();
      });
    });
  },
});

/**
 * Classement partagé en développement (`npm run dev`) et en prévisualisation (`npm run preview`) : la même API que le
 * serveur de production (server/server.mjs), avec le même code. Fichier : SCORES_FILE, ou data/scores.json (ignoré par git).
 */
const scoresApi = (): Plugin => {
  let api: ReturnType<typeof createScoresApi> | null = null;
  const use = (middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void }): void => {
    api ??= createScoresApi({ file: resolve(process.env.SCORES_FILE || 'data/scores.json') });
    middlewares.use((req, res, next) => { api!.handle(req, res).then((done) => { if (!done) next(); }, () => next()); });
  };
  return { name: 'hr-scores-api', configureServer: (server) => use(server.middlewares), configurePreviewServer: (server) => use(server.middlewares) };
};

export default defineConfig({
  base: './',
  plugins: [deviceLog(), scoresApi()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
