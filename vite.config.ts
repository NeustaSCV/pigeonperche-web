import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

/**
 * Empreinte du contenu de public/ (textures, modèles, ciel, reliefs, sons), ajoutée à leurs adresses (?v=…) : le
 * serveur peut alors les marquer « à garder un an », et une mise à jour qui change un seul de ces fichiers change
 * l'empreinte, donc les adresses. Une mise à jour du code seul la laisse intacte : rien n'est retéléchargé.
 */
function assetsVersion(): string {
  const h = createHash('sha1');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const f = join(dir, name);
      if (statSync(f).isDirectory()) walk(f);
      else { h.update(f); h.update(readFileSync(f)); }
    }
  };
  try { walk('public'); } catch { return ''; }
  return h.digest('hex').slice(0, 12);
}

export default defineConfig({
  base: './',
  define: { __ASSETS_VERSION__: JSON.stringify(assetsVersion()) },
  plugins: [deviceLog(), scoresApi()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
