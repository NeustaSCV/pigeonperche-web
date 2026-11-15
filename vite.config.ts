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

/** Fichiers communs aux trois cartes (textures, modèles), que le menu précharge en arrière-plan : src/core/preload.ts. */
function commonAssets(): string[] {
  // textures présentes dans public/ mais qu'aucune carte ne demande (relevé : e2e/menu.mjs le revérifie)
  const unused = new Set(['bark_arm', 'bark_diff', 'bark_nor', 'dirt_arm', 'forest_arm', 'grass_arm', 'rock_arm', 'scree_arm', 'wall_disp'].map((n) => `assets/tex/${n}.jpg`));
  const out: string[] = [];
  for (const dir of ['assets/models', 'assets/tex']) {
    try { for (const f of readdirSync(join('public', dir)).sort()) if (/\.(glb|jpg)$/.test(f) && !unused.has(`${dir}/${f}`)) out.push(`${dir}/${f}`); } catch { /* dossier absent */ }
  }
  return out;
}

/** Images de fond du menu (src/ui/backdrop.ts) : tous les .jpg de public/assets/menu/, dans l'ordre des noms. */
function menuImages(): string[] {
  try { return readdirSync(join('public', 'assets/menu')).filter((f) => f.endsWith('.jpg')).sort().map((f) => `assets/menu/${f}`); } catch { return []; }
}

export default defineConfig({
  base: './',
  define: { __ASSETS_VERSION__: JSON.stringify(assetsVersion()), __COMMON_ASSETS__: JSON.stringify(commonAssets()), __MENU_IMAGES__: JSON.stringify(menuImages()) },
  plugins: [deviceLog(), scoresApi()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
