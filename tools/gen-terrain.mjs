// Générateur de relief hors ligne, par niveau.
// Usage : node tools/gen-terrain.mjs <niveau> [--out <dossier>]      (npm run gen:terrain -- <niveau>)
//   <niveau>  dossier de src/levels/ (standard par défaut) ; son générateur est src/levels/<niveau>/terrain.gen.mjs
//   --out     dossier de sortie (par défaut public/terrain/<niveau>/), pour comparer sans écraser
// Sorties : height.bin (Float32, res × res), splat.bin (RGBA8), meta.json { res, size, min, max, siteHeights, road, river,
// buildings? } (buildings : altitude où poser chaque bâtiment terrassé par lib.flattenBuildings).
// Les étapes communes (érosion, sites, route, couloirs de visée, matières) sont dans tools/terrain-lib.mjs.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as lib from './terrain-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outArg = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const id = args.find((a) => !a.startsWith('-')) ?? 'standard';
const genFile = path.join(root, 'src/levels', id, 'terrain.gen.mjs');
if (!existsSync(genFile)) {
  console.error(`Niveau « ${id} » : ${path.relative(root, genFile)} introuvable.`);
  process.exit(1);
}
const outDir = outArg ? path.resolve(outArg) : path.join(root, 'public/terrain', id);

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const gen = await import(pathToFileURL(genFile).href);
log(`niveau ${id} : ${gen.size} m, ${gen.res} × ${gen.res}`);
const out = await gen.default(lib, log);
const { T, splat } = out;
if (T.S !== gen.size || T.N !== gen.res) throw new Error('la grille rendue ne correspond pas à size / res exportés');

let mn = 1e9, mx = -1e9;
for (let k = 0; k < T.N * T.N; k++) {
  mn = Math.min(mn, T.H[k]);
  mx = Math.max(mx, T.H[k]);
}
mkdirSync(outDir, { recursive: true });
const hBuf = Buffer.from(T.H.buffer), sBuf = Buffer.from(splat.buffer);
writeFileSync(path.join(outDir, 'height.bin'), hBuf);
writeFileSync(path.join(outDir, 'splat.bin'), sBuf);
const m = out.meta ?? {};
writeFileSync(
  path.join(outDir, 'meta.json'),
  JSON.stringify({ res: T.N, size: T.S, min: mn, max: mx, siteHeights: m.siteHeights ?? {}, road: m.road ?? [], river: m.river ?? [], ...(m.buildings?.length ? { buildings: m.buildings } : {}) }),
);
log(`terminé : altitude ${mn.toFixed(1)} à ${mx.toFixed(1)} m → ${path.relative(root, outDir) || outDir}`);
for (const [n, s] of Object.entries(out.sites ?? {})) console.log('  ', n, Math.round(s.x), Math.round(s.z), 'h=', T.sampleH(s.x, s.z).toFixed(1));
// contrôle des lignes de visée sur le relief fini (le décor et les arbres sont vérifiés en jeu : e2e/matrix.mjs)
if (out.sightlines?.length) {
  const bad = lib.checkSightlines(T, out.sightlines, out.posts, out.baseY);
  console.log(bad.length ? `! ${bad.length} ligne(s) de visée coupée(s) par le relief : ${JSON.stringify(bad)}` : `lignes de visée : ${out.sightlines.length} sur ${out.sightlines.length} dégagées`);
}
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
console.log(`sha256 height.bin ${sha(hBuf)}… splat.bin ${sha(sBuf)}…`);
