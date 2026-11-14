// Relief du niveau « standard » : forme analytique (pic, éperon, crête, piton, vallée) + bruit + érosion + sites.
// Lancé par : node tools/gen-terrain.mjs standard   → public/terrain/standard/{height.bin, splat.bin, meta.json}
// Toute retouche change le relief : il doit rester identique au bit près tant que la carte n'est pas refaite exprès.
// Refait le 2026-11-14 : terrassement des quatre bâtiments de la vallée (W.BUILDINGS) ; rien d'autre n'a bougé.
import * as W from './map.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, clamp, catmull, polyDist, polyVal, smax } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;

  const n1 = makeNoise2D(11);
  const n2 = makeNoise2D(23);
  const n3 = makeNoise2D(37);
  const n4 = makeNoise2D(53);

  const river = catmull(W.RIVER, 24);
  const road = catmull(W.ROAD, 16);

  // ---------- forme analytique ----------
  const spurB = (W.SPUR_BEARING * Math.PI) / 180;
  const spurU = [Math.sin(spurB), -Math.cos(spurB)];
  const ridgeB = (196 * Math.PI) / 180;
  const ridgeU = [Math.sin(ridgeB), -Math.cos(ridgeB)];
  const peakG = (s) => 0.3 * s + 30 * (1 - Math.exp(-s / 25));

  /** Massif du sommet seul (sans bruit) : pic, éperon est, crête sud, piton du relais. */
  function summitMassif(x, z) {
    const r = Math.hypot(x, z);
    let h = W.SUMMIT_HEIGHT - peakG(Math.max(0, r - 32));
    // éperon est
    const t = x * spurU[0] + z * spurU[1];
    const d = Math.abs(x * spurU[1] - z * spurU[0]);
    if (t > 0) {
      const end = t > 350 ? (t - 350) * 0.85 : 0;
      const hs = W.spurCrest(t) - 0.62 * d - 0.0016 * d * d - end;
      h = smax(h, hs, 10);
    }
    // crête sud qui rattache le sommet au massif
    const tr = x * ridgeU[0] + z * ridgeU[1];
    const dr = Math.abs(x * ridgeU[1] - z * ridgeU[0]);
    if (tr > 0) {
      const hr = 236 + 0.1 * tr - 14 * Math.exp(-((tr - 150) * (tr - 150)) / 9000) - 0.5 * dr;
      h = smax(h, hr, 14);
    }
    // piton du relais
    const rx = x - W.SITES.relay.x, rz = z - W.SITES.relay.z;
    const r2 = Math.hypot(rx, rz);
    const hp = W.SITES.relay.h - 0.74 * Math.max(0, r2 - 12) - 0.0004 * r2 * r2;
    h = smax(h, hp, 12);
    return h;
  }

  const tmp = [0, 0, 0];
  const riverD = new Float32Array(N * N);
  const riverBed = new Float32Array(N * N);
  const lakeQ = new Float32Array(N * N);

  function lakeMetric(x, z) {
    let q = 1e9;
    const wob = 1 + 0.16 * n3(x / 310, z / 310) + 0.07 * n3(x / 90 + 5, z / 90);
    for (const [cx, cz, rx, rz] of W.LAKE_BLOBS) {
      const a = (x - cx) / rx, b = (z - cz) / rz;
      q = Math.min(q, Math.sqrt(a * a + b * b));
    }
    return q / wob;
  }

  log('forme analytique');
  for (let j = 0; j < N; j++) {
    const z = wx(j);
    for (let i = 0; i < N; i++) {
      const x = wx(i);
      // déformation de domaine pour casser la régularité
      const wxo = 90 * n1(x / 900 + 3.1, z / 900) + 30 * n2(x / 260, z / 260 + 8);
      const wzo = 90 * n1(x / 900 - 7.7, z / 900 + 4) + 30 * n2(x / 260 + 2, z / 260 - 5);
      const r = Math.hypot(x, z);
      const warpK = ss(60, 320, r); // pas de déformation près du sommet : les lignes de visée sont calculées
      polyDist(x + wxo * 0.6, z + wzo * 0.6, river, tmp);
      const d = tmp[0], side = tmp[2];
      const bed = polyVal(river, tmp[1], 2);
      polyDist(x, z, river, tmp);
      riverD[idx(i, j)] = tmp[0];
      riverBed[idx(i, j)] = polyVal(river, tmp[1], 2);
      lakeQ[idx(i, j)] = lakeMetric(x, z);

      let wall;
      if (side > 0) {
        // rive sud : le massif du joueur
        wall = bed + 30 * ss(60, 300, d) + 0.2 * Math.max(0, d - 250) + 0.00003 * Math.max(0, d - 900) ** 2;
      } else {
        // rive nord : pente douce du village puis grandes montagnes
        wall = bed + 20 * ss(40, 330, d) + 0.05 * Math.max(0, d - 200) + 0.42 * Math.max(0, d - 520) ** 0.985;
      }
      wall = Math.min(wall, 760 + 0.05 * (wall - 760));
      const m = summitMassif(x + wxo * warpK, z + wzo * warpK);
      let h = smax(wall, m, 22);

      // bruit de montagne : amplitude liée à la hauteur au-dessus du fond de vallée
      const above = clamp((h - bed - 18) / 220, 0, 1);
      const rid = ridged2(n2, x / 820, z / 820, 4, 2.05, 0.42);
      const fb = fbm2(n1, x / 340, z / 340, 5);
      const prot = ss(45, 260, r); // protège le sommet
      h += prot * above * (rid - 0.45) * 70 + prot * above * fb * 30;
      // lointains spectaculaires
      const far = ss(1300, 2700, r);
      h += far * (ridged2(n4, x / 1500 + 9, z / 1500, 5, 2.1, 0.52) * 330 - 60) * (0.35 + 0.65 * above);
      // ondulations du fond de vallée
      h += (1 - above) * 2.2 * fbm2(n3, x / 120, z / 120, 3);
      H[idx(i, j)] = h;
    }
  }

  log('érosion');
  // érosion douce, nulle sur le massif du sommet
  lib.erode(T, { drops: 260000, seed: 2024, weight: (x, z) => 0.55 * ss(70, 300, Math.hypot(x, z)) });

  log('lac, rivière, sites, route');
  lib.carveLake(T, lakeQ, W.LAKE_LEVEL);
  lib.carveRiver(T, riverD, riverBed, W.RIVER_WIDTH, (k) => !(lakeQ[k] > 1.0));
  // les plaques reposent sur la crête analytique de l'éperon
  const siteHeights = lib.flattenSites(T, W.SITES, { noise: n3, target: (name, s) => (name === 'plate1' || name === 'plate2' ? summitMassif(s.x, s.z) : undefined) });
  const roadD = lib.carveRoad(T, road, { width: W.ROAD_WIDTH, bridge: W.BRIDGE, skip: (k) => riverD[k] < W.RIVER_WIDTH / 2 + 3 });
  // bâtiments de la vallée : lot à plat, bande de 20 m, raccord de 36 m (après la route, avant les couloirs de visée)
  // (la rivière et la route restent intactes : le moulin est à 6 m de l'eau)
  const buildings = lib.flattenBuildings(T, W.BUILDINGS, {
    keep: (k) => ss(W.RIVER_WIDTH / 2 + 2, W.RIVER_WIDTH / 2 + 12, riverD[k]) * ss(W.ROAD_WIDTH / 2 + 2, W.ROAD_WIDTH / 2 + 12, roadD[k]),
  });
  for (const b of buildings) log(`bâtiment ${b.id} : sol à ${b.groundY} m`);
  lib.carveSightlines(T, W.SIGHTLINES, W.POSTS, W.SUMMIT_HEIGHT);
  const cut = lib.checkBuildingSightlines(T, buildings, W.SIGHTLINES, W.POSTS, W.SUMMIT_HEIGHT);
  if (cut.length) throw new Error('un bâtiment coupe une ligne de visée : ' + JSON.stringify(cut));

  log('matières');
  const lotClear = lib.buildingClearing(W.BUILDINGS);
  const splat = lib.paint(T, {
    rockNoise: n4, forestNoise: n3, riverD, riverWidth: W.RIVER_WIDTH, lakeQ, roadD, roadWidth: W.ROAD_WIDTH,
    sites: W.SITES, skipSite: (name) => name === 'summit', siteCore: (name) => (name === 'village' ? 0.55 : name === 'camp' ? 0.75 : 0.5),
    // couloir dégagé sur l'éperon (plaques, ballon) ; pas d'arbres dans les lots des bâtiments
    forestExtra: (x, z) => {
      const t = x * spurU[0] + z * spurU[1];
      const d = Math.abs(x * spurU[1] - z * spurU[0]);
      return (t > 0 && t < 380 ? ss(26, 60, d - Math.max(0, (120 - Math.abs(t - 224)) * 0.9)) : 1) * lotClear(x, z);
    },
  });

  return { T, splat, meta: { siteHeights, road: lib.roundLine(road), river: lib.roundLine(river), buildings }, sites: W.SITES, sightlines: W.SIGHTLINES, posts: W.POSTS, baseY: W.SUMMIT_HEIGHT };
}
