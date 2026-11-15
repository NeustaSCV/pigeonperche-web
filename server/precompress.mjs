// Compresse une fois pour toutes (Brotli) les fichiers de dist/ qui y gagnent : le serveur (server/server.mjs) envoie
// alors le .br tout prêt, au lieu de recompresser 4 Mo de relief à chaque visite.
//   node server/precompress.mjs [dossier]      (défaut : dist)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { brotliCompressSync, constants as Z } from 'node:zlib';

/** types compressés à l'avance ; un fichier n'est gardé que s'il perd au moins 8 % */
export const PRECOMPRESSED = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.bin', '.gltf', '.glb', '.hdr', '.wasm', '.ttf']);

const root = resolve(process.argv[2] || 'dist');
let before = 0, after = 0, count = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) { walk(file); continue; }
    if (!PRECOMPRESSED.has(extname(name).toLowerCase()) || st.size < 1024) continue;
    const raw = readFileSync(file);
    // qualité maximale pour le texte ; un cran en dessous pour les gros binaires (dix fois plus rapide, 1 à 2 % de plus)
    const br = brotliCompressSync(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: raw.length > 2e6 ? 9 : 11, [Z.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    if (br.length > raw.length * 0.92) continue;
    writeFileSync(file + '.br', br);
    before += raw.length; after += br.length; count++;
  }
};
walk(root);
console.log(`${count} fichiers compressés à l'avance : ${(before / 1e6).toFixed(1)} Mo -> ${(after / 1e6).toFixed(1)} Mo`);
