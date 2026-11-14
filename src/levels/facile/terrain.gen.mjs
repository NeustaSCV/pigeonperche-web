// Relief du niveau « facile » : un coteau bocager (plateau au sud, promontoire du Guet), une vallée douce où coule
// une rivière, le versant du bourg au nord et une couronne de collines boisées qui ferme l'horizon.
// Lancé par : node tools/gen-terrain.mjs facile   → public/terrain/facile/{height.bin, splat.bin, meta.json}
import * as W from './map.ts';
import { lotDistance } from '../building-lots.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** Ligne du haut de pente du plateau (cote z) en fonction de x ; le promontoire du château d'eau avance vers le nord. */
function edgeZ(x) {
  return 62 - 206 * Math.exp(-(((x + 430) / 135) ** 2)) + 30 * Math.sin(x / 400) + 0.00004 * x * x;
}
/** Éperon du Guet : une langue de plateau de 30 m de demi-largeur qui s'avance de 70 m dans la vallée. */
const SPUR = { z0: 80, z1: -6, r: 30 };
/** Croupe nord-est : origine au bord de la cour, cap 42°. */
const RIDGE = { x: 12, z: -12, ux: Math.sin((42 * Math.PI) / 180), uz: -Math.cos((42 * Math.PI) / 180) };
/** Distance signée au bord du plateau, éperon compris (> 0 : sur le plateau). */
function plateauD(x, z) {
  const zc = Math.min(SPUR.z0, Math.max(SPUR.z1, z));
  const spur = SPUR.r - Math.hypot(x, z - zc);
  const main = z - edgeZ(x);
  // union adoucie : pas d'arête rentrante au pied de l'éperon
  return 0.5 * (spur + main + Math.sqrt((spur - main) * (spur - main) + 24 * 24)) - 6;
}

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, clamp, lerp, catmull, polyDist, polyVal, mulberry32 } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;

  const n1 = makeNoise2D(101);
  const n2 = makeNoise2D(211);
  const n3 = makeNoise2D(307);
  const n4 = makeNoise2D(401);

  const river = catmull(W.RIVER, 24);
  const road = catmull(W.ROAD, 16);
  const tmp = [0, 0, 0];
  const riverD = new Float32Array(N * N);
  const riverBed = new Float32Array(N * N);
  const TOWER = W.LOTS.chateauEau;
  /** altitude de la butte du château d'eau */
  const TOWER_Y = W.BASE_Y + 22;

  log('forme analytique');
  for (let j = 0; j < N; j++) {
    const z = wx(j);
    for (let i = 0; i < N; i++) {
      const x = wx(i);
      const k = idx(i, j);
      const r = Math.hypot(x, z);
      polyDist(x, z, river, tmp);
      const dr = tmp[0], side = tmp[2];
      const bed = polyVal(river, tmp[1], 2);
      riverD[k] = dr;
      riverBed[k] = bed;

      let h;
      if (side > 0) {
        // rive sud : prés du fond de vallée, puis le coteau et son plateau
        const floor = bed + 1.6 + 0.018 * dr;
        const width = 170 + 34 * n2(x / 330, 3.3);
        const d = plateauD(x, z) + 14 * n2(x / 140 + 7, z / 140) * ss(70, 240, r);
        const t = clamp(1 + d / width, 0, 1);
        // profil de coteau : rebord franc (pente de 25° en haut), pied concave qui se fond dans les prés
        const s = t * t;
        let top = W.BASE_Y + 0.012 * Math.max(0, d) + 3.5 * fbm2(n1, x / 280, z / 280, 3) * ss(60, 260, r);
        // butte du château d'eau
        top += (TOWER_Y - W.BASE_Y) * Math.exp(-(((x - TOWER.x) ** 2 + (z - TOWER.z) ** 2) / (170 * 170)));
        h = lerp(floor, Math.max(top, floor), s);
        // arête nord-est : une croupe descend en pente douce du pas de tir, elle porte la première plaque
        const tx = x - RIDGE.x, tz = z - RIDGE.z;
        const rt = tx * RIDGE.ux + tz * RIDGE.uz;
        if (rt > -20 && rt < 130) {
          const lat = Math.abs(tx * RIDGE.uz - tz * RIDGE.ux);
          const crest = W.BASE_Y - 1.8 - 0.105 * Math.max(0, rt) - (rt > 84 ? (rt - 84) * 0.55 : 0);
          h = lib.smax(h, crest - 0.5 * Math.max(0, lat - 5) - 0.006 * lat * lat, 5);
        }
      } else {
        // rive nord : prés, replat du bourg, puis le versant qui monte vers les collines
        h = bed + 1.6 + 0.034 * dr + 30 * ss(240, 1000, dr) + 12 * ss(260, 700, dr) * (0.5 + 0.5 * fbm2(n3, x / 420, z / 420, 3));
      }
      // modelé doux du bocage, nul sur le site de tir
      const prot = ss(45, 240, r);
      h += prot * (5.5 * fbm2(n1, x / 360 + 11, z / 360, 4) + 1.6 * fbm2(n2, x / 95, z / 95, 3));
      // couronne de collines : ferme l'horizon avant le bord de la carte
      const rim = ss(820, 1480, r);
      h += rim * (26 + 30 * ridged2(n4, x / 900 + 5, z / 900, 4, 2.05, 0.5) + 9 * fbm2(n3, x / 260, z / 260, 3));
      H[k] = h;
    }
  }

  log('érosion');
  lib.erode(T, { drops: 110000, seed: 512, weight: (x, z) => 0.3 * ss(90, 320, Math.hypot(x, z)) });

  log('rivière, sites, lots, route');
  const siteHeights = lib.flattenSites(T, W.SITES, { noise: n3 });
  // terrassement sous chaque bâtiment (altitude = moyenne du relief en place sous le lot) : bande plate étroite pour
  // le moulin, au bord de la rivière, et pour le château d'eau, au bord du coteau
  const buildings = [];
  for (const b of W.BUILDINGS) {
    const tight = b.name === 'moulin' ? { flat: 6, blend: 16 } : b.name === 'chateauEau' ? { flat: 10, blend: 30 } : b.name === 'chateau' ? { flat: 10, blend: 44 } : {};
    buildings.push(...lib.flattenBuildings(T, [b], tight));
  }
  const lotD = (x, z) => Math.min(...W.BUILDINGS.map((b) => lotDistance(b, x, z)));
  const inLot = (x, z, m) => lotD(x, z) < m;
  // la rivière après les replats : elle garde son lit au pied du bourg et du moulin
  lib.carveRiver(T, riverD, riverBed, W.RIVER_WIDTH);
  const roadD = lib.carveRoad(T, road, { width: W.ROAD_WIDTH, skip: (k) => riverD[k] < W.RIVER_WIDTH / 2 + 3 || inLot(wx(k % N), wx(Math.floor(k / N)), 1) });
  // voies secondaires (rue de l'hôpital, chemins du moulin et du château d'eau, allée du château) : après la route et
  // les lots ; elles s'arrêtent au bord des lots et laissent le lit de la rivière sous leurs ponts
  const groundY = (name) => buildings[W.BUILDINGS.findIndex((b) => b.name === name)].groundY;
  const net = lib.carveWays(T, W.WAYS.map((w) => ({ ...w, endY: w.to ? groundY(w.to) : undefined })), {
    skip: (k) => riverD[k] < W.RIVER_WIDTH / 2 + 3 || inLot(wx(k % N), wx(Math.floor(k / N)), 1),
  });
  // lignes vers les cibles accrochées aux bâtiments : hauteur comptée depuis le sol du bâtiment (altitude absolue)
  const groundOf = (name) => buildings[W.BUILDINGS.findIndex((b) => b.name === name)].groundY;
  const lines = W.SIGHTLINES.map((l) => (l.lot ? { post: l.post, x: l.x, z: l.z, y: groundOf(l.lot) + l.y, abs: true } : l));
  lib.carveSightlines(T, lines, W.POSTS, W.BASE_Y);

  log('matières');
  const clearing = lib.buildingClearing(W.BUILDINGS);
  const splat = lib.paint(T, {
    rockNoise: n4, forestNoise: n3, rockAlt: [900, 1000], forestLow: [900, 1000], treeLine: [1900, 2000], clearRadius: [50, 80],
    riverD, riverWidth: W.RIVER_WIDTH, roadD, roadWidth: W.ROAD_WIDTH,
    wayEdge: net.edge, wayDirt: net.dirt, wayGravel: net.gravel,
    sites: W.SITES, skipSite: (name) => name === 'guet', siteCore: (name) => (name === 'quarry' ? 0.85 : name === 'track' ? 0.25 : 0.5),
    // bois sur les hauteurs seulement : la vallée et le plateau restent ouverts (prés et champs)
    forestExtra: (x, z) => clearing(x, z) * (0.1 + 0.9 * ss(W.VALLEY_Y + 24, W.VALLEY_Y + 46, T.sampleH(x, z)) * ss(420, 700, Math.hypot(x, z))),
  });

  log('bocage : haies et champs');
  // parcellaire : grille déformée de ~150 m ; les limites de parcelles portent des haies, certaines parcelles sont labourées
  const CELL = 150;
  const warp = (x, z) => [x + 46 * n2(x / 310 + 2, z / 310), z + 46 * n2(x / 310 - 9, z / 310 + 5)];
  const rnd = (a, b) => { const r = mulberry32(((a * 73856093) ^ (b * 19349663)) >>> 0); return r(); };
  for (let j = 1; j < N - 1; j++) {
    const z = wx(j);
    for (let i = 1; i < N - 1; i++) {
      const x = wx(i);
      const k = idx(i, j);
      const r = Math.hypot(x, z);
      if (r < 62 || r > 1460 || inLot(x, z, 8)) continue;
      if (riverD[k] < W.RIVER_WIDTH / 2 + 5 || roadD[k] < 9 || net.edge[k] < 5) continue;
      const h = H[k];
      const sx = (H[k + 1] - H[k - 1]) / (2 * T.CELL), sz = (H[k + N] - H[k - N]) / (2 * T.CELL);
      if (Math.hypot(sx, sz) > 0.55) continue;
      const [u, v] = warp(x, z);
      const cu = Math.floor(u / CELL), cv = Math.floor(v / CELL);
      const fu = u / CELL - cu, fv = v / CELL - cv;
      // distance aux limites ouest et nord de la parcelle ; une limite sur trois n'a pas de haie
      const dW = fu * CELL, dN = fv * CELL;
      let hedge = 0;
      if (rnd(cu, cv * 2 + 1) < 0.68) hedge = Math.max(hedge, 1 - ss(5, 8, dW));
      if (rnd(cu * 2 + 1, cv) < 0.68) hedge = Math.max(hedge, 1 - ss(5, 8, dN));
      // ripisylve : saules et aulnes par bouquets le long de la rivière
      const bank = (1 - ss(10, 22, riverD[k])) * ss(0.45, 0.6, 0.5 + 0.5 * n1(x / 60, z / 60));
      hedge = Math.max(hedge, bank * 0.9);
      // pas de haie en travers des sites de cibles
      for (const s of Object.values(W.SITES)) if (Math.hypot(x - s.x, z - s.z) < s.r1 + 6) hedge = 0;
      if (hedge > 0) splat[k * 4 + 2] = Math.max(splat[k * 4 + 2], Math.round(255 * hedge));
      // labours : une parcelle sur cinq, sur les terrains peu pentus
      const plough = rnd(cu + 31, cv + 17);
      if (plough < 0.2 && h < 90 && Math.min(dW, dN, CELL - dW, CELL - dN) > 9) {
        // sillons : la teinte varie en bandes
        const furrow = 0.5 + 0.5 * Math.sin((plough < 0.1 ? u : v) * 0.9);
        splat[k * 4 + 3] = Math.max(splat[k * 4 + 3], Math.round(255 * (0.34 + 0.2 * furrow)));
      }
    }
  }
  // chemin de terre de la sablière vers la vallée et aire battue des cibles proches
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const x = wx(i), z = wx(j), k = idx(i, j);
      const q = W.SITES.quarry;
      const d = Math.hypot(x - q.x, z - q.z);
      if (d < q.r1 + 8) {
        splat[k * 4 + 1] = Math.max(splat[k * 4 + 1], Math.round(255 * 0.7 * (1 - ss(q.r0 * 0.6, q.r1 + 8, d))));
        splat[k * 4 + 2] = 0;
      }
    }

  const cut = lib.checkBuildingSightlines(T, buildings, lines, W.POSTS, W.BASE_Y, { height: (b) => (b.id === 'chateau-eau' ? 36 : b.id === 'eglise' ? 34 : 20) });
  // une ligne qui finit dans son propre bâtiment le « traverse » forcément : seules les autres comptent
  const foreign = cut.filter((c) => !W.SIGHTLINES.some((l) => l.lot && Math.round(l.x) === c.x && Math.round(l.z) === c.z && W.LOTS[l.lot].x === W.BUILDINGS.find((b) => b.id === c.building).x));
  if (foreign.length) log('! lignes de visée coupées par un bâtiment : ' + JSON.stringify(foreign));

  return { T, splat, meta: { siteHeights, road: lib.roundLine(road), river: lib.roundLine(river), riverWidth: W.RIVER_WIDTH, buildings, ways: net.ways }, sites: W.SITES, sightlines: lines, posts: W.POSTS, baseY: W.BASE_Y };
}
