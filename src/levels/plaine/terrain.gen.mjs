// Relief du niveau « Le Château d'eau » : une plaine de grande culture à 180 m, à peine ondulée, une butte de seize
// mètres au centre (elle porte le château d'eau), des collines basses aux quatre bords pour fermer l'horizon.
// La route de la plaine, la voie ferrée (plate-forme nivelée, ballast) et les voies secondaires y sont tracées ;
// les lots des six bâtiments, la gare de triage et les abords des cibles sont mis à plat.
// Lancé par : node tools/gen-terrain.mjs plaine   → public/terrain/plaine/{height.bin, splat.bin, meta.json}
import * as W from './map.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, catmull } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;

  const n1 = makeNoise2D(1801);
  const n2 = makeNoise2D(2203);
  const n3 = makeNoise2D(3307);
  const n4 = makeNoise2D(4409);

  const road = catmull(W.ROAD, 12);
  const rail = catmull(W.RAIL, 6);
  const tmp = [0, 0, 0];
  /** distance à la route ou à la voie ferrée : elles sortent de la carte par des trouées dans les collines */
  const corridor = (x, z) => {
    lib.polyDist(x, z, rail, tmp);
    const d = tmp[0];
    lib.polyDist(x, z, road, tmp);
    return Math.min(d, tmp[0]);
  };

  log('forme analytique');
  for (let j = 0; j < N; j++) {
    const z = wx(j);
    for (let i = 0; i < N; i++) {
      const x = wx(i);
      const r = Math.hypot(x, z);
      // plaine : ondulations de deux à trois mètres sur un kilomètre, nulles près des cibles (au-delà : champs)
      let h = W.PLAIN + ss(2600, 3600, r) * 2.6 * fbm2(n1, x / 1100, z / 1100, 3) + 0.5 * fbm2(n2, x / 260 + 3, z / 260, 2) * ss(300, 900, r);
      // la butte du château d'eau : replat de 60 m, puis une pente douce de 6 %
      h += (W.KNOLL - W.PLAIN) * (1 - ss(56, 340, r * (1 + 0.1 * n2(x / 160, z / 160))));
      // collines des bords : elles ferment l'horizon sans rien cacher (au-delà de 3 600 m)
      let edge = ss(3700, 5000, r);
      if (edge > 0) edge *= ss(120, 900, corridor(x, z));
      h += edge * (25 + 120 * ridged2(n4, x / 1500 + 5, z / 1500, 4, 2.1, 0.5));
      H[idx(i, j)] = h;
    }
  }

  log('sites, route, bâtiments');
  const siteHeights = lib.flattenSites(T, W.SITES, { noise: n3 });
  const roadD = lib.carveRoad(T, road, { width: W.ROAD_WIDTH });
  const buildings = lib.flattenBuildings(T, W.BUILDINGS, { keep: (k) => ss(5, 15, roadD[k]) });

  log('voies');
  const inLot = (x, z) => W.BUILDINGS.some((b) => lib.lotDistance(b, x, z) < 1);
  const net = lib.carveWays(T, W.WAYS.map((w) => ({ ...w, endY: w.to ? W.BUILDINGS.find((b) => b.name === w.to).groundY : undefined })), {
    skip: (k) => inLot(wx(k % N), wx(Math.floor(k / N))),
  });

  const lots = lib.buildingClearing(W.BUILDINGS);
  const flat = (x, z) => {
    let f = lots(x, z);
    for (const st of Object.values(W.SITES)) f *= ss(st.r0 + 4, st.r0 + 34, Math.hypot(x - st.x, z - st.z));
    return f;
  };
  lib.carveSightlines(T, W.SIGHTLINES, W.POSTS, W.DECK_Y, { smooth: 8, reach: 4, protect: flat });

  log('matières');
  const splat = lib.paint(T, {
    rockNoise: n4, forestNoise: n3, roadD, roadWidth: W.ROAD_WIDTH,
    wayEdge: net.edge, wayDirt: net.dirt, wayGravel: net.gravel,
    // ni roche ni limite des arbres ; pas de forêt d'altitude : des bosquets et des haies, par taches
    rockAlt: [3000, 3200], forestLow: [5000, 5001], treeLine: [5000, 5001], clearRadius: [150, 260],
    sites: W.SITES, skipSite: (name) => name === 'tour', siteCore: (name) => (name === 'gare' ? 0.3 : name === 'triage' ? 0.45 : 0.5),
    // plaine cultivée : peu d'arbres au cœur de la carte (ils masqueraient les cibles), davantage vers les collines
    forestExtra: (x, z) => 0.75 * ss(3300, 4600, Math.hypot(x, z)) * lots(x, z),
  });

  // parcellaire : la plaine est un damier de champs (trame de 260 × 170 m, tournée de 14°). Un champ sur trois est
  // labouré (terre battue, à peine plus pâle qu'une route), les autres en chaume ; une limite sur trois
  // porte une haie (canal de la forêt : les arbres du jeu y sont semés en ligne). Rien dans les lots, les sites,
  // sur les voies, ni à moins de 330 m du château d'eau.
  {
    const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const PW = 260, PH = 170, cr = Math.cos(0.245), sr = Math.sin(0.245);
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const x = wx(i), z = wx(j), r = Math.hypot(x, z);
        if (r > 4300) continue;
        const k = idx(i, j);
        const open = flat(x, z) * ss(4, 16, net.edge[k]) * ss(8, 22, roadD[k]) * (1 - ss(3500, 4300, r));
        if (open <= 0) continue;
        const v = (-x * sr + z * cr) / PH, iv = Math.floor(v);
        const u = (x * cr + z * sr) / PW + 0.41 * iv, iu = Math.floor(u);
        const fu = u - iu, fv = v - iv;
        const bu = Math.min(fu, 1 - fu) * PW, bv = Math.min(fv, 1 - fv) * PH, bd = Math.min(bu, bv);
        const kind = hash(iu, iv, 1);
        if (kind < 0.36 && r > 330) {
          const d = (0.7 + 0.25 * hash(iu, iv, 2)) * ss(2, 9, bd) * open;
          splat[k * 4 + 3] = Math.max(splat[k * 4 + 3], Math.round(255 * d));
        }
        // haie sur le bord nord (fv proche de 0) ou ouest (fu proche de 0) de la parcelle
        const hedge = (fv * PH < 13 && hash(iu, iv, 3) < 0.36) || (fu * PW < 13 && hash(iu, iv, 4) < 0.26);
        if (hedge && r > 330) splat[k * 4 + 2] = Math.max(splat[k * 4 + 2], Math.round(255 * open));
      }
  }

  const cut = lib.checkBuildingSightlines(T, buildings, W.SIGHTLINES, W.POSTS, W.DECK_Y, { height: (s) => (s.id === 'chateau-eau' ? 0 : 26) });
  // (une ligne qui finit sur un bâtiment passe forcément au-dessus de son lot : seuls les autres comptent)
  for (let i = cut.length - 1; i >= 0; i--) if (lib.lotDistance(buildings.find((b) => b.id === cut[i].building), cut[i].x, cut[i].z) < 40) cut.splice(i, 1);
  if (cut.length) log('! lignes de visée coupées par un lot : ' + JSON.stringify(cut));

  return { T, splat, meta: { siteHeights, road: lib.roundLine(road), river: [], buildings, ways: net.ways }, sites: W.SITES, sightlines: W.SIGHTLINES, posts: W.POSTS, baseY: W.DECK_Y };
}
