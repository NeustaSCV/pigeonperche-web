// Relief du niveau « avancé » : le Rebord. Haut plateau calcaire au sud (900 m), dont un éperon étroit porte le site
// de tir ; corniche de 70 m, grand talus raviné, puis plaine industrielle à 590 m et vallée rectiligne d'ouest en est ;
// butte témoin à l'est (la plaque du mile), collines lointaines au nord. Une rivière encaissée dans l'axe de la
// vallée (elle refroidit la centrale) ; des voies secondaires relient chaque bâtiment à la route de la plaine.
// Lancé par : node tools/gen-terrain.mjs avance   → public/terrain/avance/{height.bin, splat.bin, meta.json}
import * as W from './map.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, clamp, lerp, catmull, smax, polyDist, polyVal } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;
  const smin = (a, b, k) => -smax(-a, -b, k);

  const n1 = makeNoise2D(101);
  const n2 = makeNoise2D(211);
  const n3 = makeNoise2D(307);
  const n4 = makeNoise2D(401);

  const road = catmull(W.ROAD, 12);
  const river = catmull(W.RIVER, 24);
  const TOP = W.RIM_HEIGHT;

  /** Distance au plateau (négative dessus, positive en contrebas) : éperon du site + isthme + plateau principal. */
  function rimDist(x, z) {
    const dA = Math.hypot(x, z) - 48;
    // isthme qui s'élargit vers le sud
    const dB = z > 0 ? (Math.abs(x) - (48 + 0.5 * z)) / 1.118 : 1e6;
    // plateau principal : rebord sinueux vers z = 400, qui recule en deux cirques de part et d'autre de l'éperon
    const dC = 400 + 90 * n1(x / 620 + 5, 1.7) + 60 * n2(x / 240, 3.1) - z;
    return smin(smin(dA, dB, 30), dC, 60);
  }

  /** Plaine : très plate, vallée à peine marquée vers z = −2 600, collines au nord et aux deux bouts. */
  function plain(x, z) {
    let h = W.PLAIN + 4 * fbm2(n3, x / 800, z / 800, 3) - 7 * Math.exp(-(((z + 2600) / 520) ** 2));
    const north = ss(3300, 4500, -z);
    h += north * (60 + 300 * ridged2(n4, x / 1700 + 3, z / 1700, 5, 2.1, 0.5));
    const ends = ss(3900, 5000, Math.abs(x)) * (1 - north);
    h += ends * 150 * ridged2(n4, x / 1300, z / 1300 + 7, 4, 2.1, 0.5);
    return h;
  }

  log('forme analytique');
  const dist = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = wx(j);
    for (let i = 0; i < N; i++) {
      const x = wx(i);
      const r = Math.hypot(x, z);
      // déformation de domaine, nulle près du site (les lignes de visée y sont calculées)
      const wk = ss(70, 320, r);
      const xw = x + wk * (70 * n1(x / 800 + 3.1, z / 800) + 22 * n2(x / 210, z / 210 + 8));
      const zw = z + wk * (70 * n1(x / 800 - 7.7, z / 800 + 4) + 22 * n2(x / 210 + 2, z / 210 - 5));
      const d = rimDist(xw, zw);
      dist[idx(i, j)] = d;
      let h;
      if (d <= 0) {
        // plateau : causse faiblement ondulé, qui monte doucement vers le sud
        const inl = ss(0, 260, -d);
        h = TOP + inl * (10 * fbm2(n3, x / 420, z / 420, 4) + 0.012 * Math.min(-d, 2500)) + ss(1500, 4200, z) * 140 * ridged2(n4, x / 1500 + 11, z / 1500, 4, 2.1, 0.5);
      } else {
        // corniche (hauteur variable), puis talus raviné
        const cliffH = 70 + wk * 22 * n1(x / 330 + 9, z / 330);
        const cliff = cliffH * ss(0, 62, d);
        const talus = 0.26 * Math.max(0, d - 35) * (1 + wk * 0.12 * n2(x / 500, z / 500 + 3));
        const gully = wk * ss(70, 260, d) * (1 - ss(650, 1000, d)) * 20 * (ridged2(n2, x / 260, z / 260, 3, 2.1, 0.5) - 0.5);
        h = smax(TOP - cliff - talus + gully, plain(x, z), 55);
      }
      // butte témoin de l'est
      const rb = Math.hypot(x - W.BUTTE.x, z - W.BUTTE.z) * (1 + 0.14 * n2(x / 130 + 2, z / 130));
      const hb = W.BUTTE.top - 0.03 * Math.max(0, rb - 40) - 62 * ss(95, 150, rb) - 0.33 * Math.max(0, rb - 130);
      h = smax(h, hb, 18);
      H[idx(i, j)] = h;
    }
  }

  log('érosion');
  // nulle sur le site, modérée ailleurs : creuse les ravines du talus
  lib.erode(T, { drops: 320000, seed: 4410, weight: (x, z) => 0.6 * ss(80, 320, Math.hypot(x, z)) });

  log('sites, route, lignes de visée');
  const siteHeights = lib.flattenSites(T, W.SITES, { noise: n3 });
  const roadD = lib.carveRoad(T, road, { width: W.ROAD_WIDTH });
  const buildings = lib.flattenBuildings(T, W.BUILDINGS);

  // rivière de la plaine : distance et niveau par cellule (seulement dans sa bande, au nord de la carte)
  log('rivière, voies');
  const RW = W.RIVER_WIDTH;
  const riverD = new Float32Array(N * N).fill(1e9), riverBed = new Float32Array(N * N);
  {
    const tmp = [0, 0, 0];
    let z0 = 1e9, z1 = -1e9;
    for (const p of river) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let j = 0; j < N; j++) {
      const z = wx(j);
      if (z < z0 - 760 || z > z1 + 760) continue;
      for (let i = 0; i < N; i++) {
        polyDist(wx(i), z, river, tmp);
        riverD[idx(i, j)] = tmp[0];
        riverBed[idx(i, j)] = polyVal(river, tmp[1], 2);
      }
    }
  }
  // cluse : aux deux bouts de la carte, la rivière traverse les collines par une vallée en V (pente de 30 %)
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = idx(i, j), d = riverD[k];
      const w = ss(3300, 3900, Math.abs(wx(i)));
      if (d > 700 || w <= 0) continue;
      H[k] = lerp(H[k], Math.min(H[k], riverBed[k] + 4 + 0.3 * Math.max(0, d - RW / 2 - 34)), w);
    }
  // lit majeur : les abords descendent vers l'eau en pente douce (7 %). Vue du rebord, la plaine est sous un angle de
  // 7° (12 %) : derrière une berge plus raide, l'eau serait cachée. Les lots des bâtiments ne sont pas entamés.
  const lotD = (x, z) => Math.min(...W.BUILDINGS.map((b) => lib.lotDistance(b, x, z)));
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = idx(i, j), d = riverD[k];
      if (d > 260) continue;
      const tgt = riverBed[k] + 0.4 + 0.07 * Math.max(0, d - RW / 2 - 2);
      // (dans la plaine seulement : aux deux bouts, c'est la cluse)
      if (H[k] > tgt) H[k] = lerp(H[k], tgt, ss(22, 44, lotD(wx(i), wx(j))) * (1 - ss(3300, 3900, Math.abs(wx(i)))));
    }
  lib.carveRiver(T, riverD, riverBed, RW);
  // voies secondaires : après la route, les sites et les lots ; elles s'arrêtent au bord des lots et laissent le lit
  // de la rivière sous le pont
  const inLot = (x, z) => W.BUILDINGS.some((b) => lib.lotDistance(b, x, z) < 1);
  const net = lib.carveWays(T, W.WAYS.map((w) => ({ ...w, endY: w.to ? W.BUILDINGS.find((b) => b.name === w.to).groundY : undefined })), {
    skip: (k) => riverD[k] < RW / 2 + 3 || inLot(wx(k % N), wx(Math.floor(k / N))),
  });
  // rabotage adouci : sans lissage, la maille de 10 m laissait des gradins dans le talus, visibles à la lunette
  // (les terrasses des sites et les lots des bâtiments ne sont pas retouchés)
  const lots = lib.buildingClearing(W.BUILDINGS);
  const flat = (x, z) => {
    let f = lots(x, z);
    for (const st of Object.values(W.SITES)) f *= ss(st.r0 + 4, st.r0 + 34, Math.hypot(x - st.x, z - st.z));
    return f;
  };
  lib.carveSightlines(T, W.SIGHTLINES, W.POSTS, W.RIM_HEIGHT, { smooth: 10, reach: 5, protect: flat });

  log('matières');
  const lotClear = lots;
  const splat = lib.paint(T, {
    rockNoise: n4, forestNoise: n3, roadD, roadWidth: W.ROAD_WIDTH, riverD, riverWidth: RW,
    wayEdge: net.edge, wayDirt: net.dirt, wayGravel: net.gravel,
    // pas de roche d'altitude ni de limite des arbres : seule la pente met la roche à nu
    rockAlt: [3000, 3200], forestLow: [5000, 5001], treeLine: [5000, 5001], clearRadius: [52, 95],
    sites: W.SITES, skipSite: (name) => name === 'rim', siteCore: (name) => (name === 'halte' || name === 'centrale' ? 0.35 : 0.6),
    // pays sec : pinèdes claires sur le plateau, bosquets sur le talus, haies rares dans la plaine
    forestExtra: (x, z) => {
      const k = Math.round((x / size + 0.5) * (N - 1)) + Math.round((z / size + 0.5) * (N - 1)) * N;
      const d = dist[clamp(k, 0, N * N - 1)];
      return (d <= 0 ? 0.8 : d < 900 ? 0.4 : 0.12) * lotClear(x, z);
    },
  });

  // ripisylve discrète : bouquets de saules et de peupliers sur les berges, par taches, hors des sites et des voies
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = idx(i, j), d = riverD[k];
      if (d > RW / 2 + 34 || d < RW / 2 + 3 || net.edge[k] < 12) continue;
      const x = wx(i), z = wx(j);
      const bank = (1 - ss(RW / 2 + 10, RW / 2 + 34, d)) * ss(0.5, 0.68, 0.5 + 0.5 * n2(x / 90 + 3, z / 90)) * flat(x, z);
      if (bank > 0) splat[k * 4 + 2] = Math.max(splat[k * 4 + 2], Math.round(255 * 0.55 * bank));
    }

  return { T, splat, meta: { siteHeights, road: lib.roundLine(road), river: lib.roundLine(river), riverWidth: RW, buildings, ways: net.ways }, sites: W.SITES, sightlines: W.SIGHTLINES, posts: W.POSTS, baseY: W.RIM_HEIGHT };
}
