// Relief du niveau « avancé » : le Rebord. Haut plateau calcaire au sud (900 m), dont un éperon étroit porte le site
// de tir ; corniche de 70 m, grand talus raviné, puis plaine industrielle à 590 m et vallée rectiligne d'ouest en est ;
// butte témoin à l'est (la plaque du mile), collines lointaines au nord. Ni lac ni rivière : pays sec.
// Lancé par : node tools/gen-terrain.mjs avance   → public/terrain/avance/{height.bin, splat.bin, meta.json}
import * as W from './map.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, clamp, catmull, smax } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;
  const smin = (a, b, k) => -smax(-a, -b, k);

  const n1 = makeNoise2D(101);
  const n2 = makeNoise2D(211);
  const n3 = makeNoise2D(307);
  const n4 = makeNoise2D(401);

  const road = catmull(W.ROAD, 12);
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
    rockNoise: n4, forestNoise: n3, roadD, roadWidth: W.ROAD_WIDTH,
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

  return { T, splat, meta: { siteHeights, road: lib.roundLine(road), river: [], buildings }, sites: W.SITES, sightlines: W.SIGHTLINES, posts: W.POSTS, baseY: W.RIM_HEIGHT };
}
