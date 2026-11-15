// Relief du niveau « Le Phare » : une côte de granit. Au centre le cap du phare (falaise de 9 m, accordée à celle du
// modèle), à l'est une crique dont le fond est une terre basse (digue des marais, quai du port), fermée par une pointe ;
// à l'ouest la côte recule vers le nord-ouest. La mer (niveau 0) couvre tout le sud de la carte ; la lande monte
// doucement vers des collines au nord. Un îlot (plaque de réglage) et une roche à fleur d'eau (tourelle de la passe).
// Lancé par : node tools/gen-terrain.mjs phare   → public/terrain/phare/{height.bin, splat.bin, meta.json}
import * as W from './map.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, lerp, catmull } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;

  const n1 = makeNoise2D(517);
  const n2 = makeNoise2D(613);
  const n3 = makeNoise2D(727);
  const n4 = makeNoise2D(839);

  /**
   * Trait de côte : la terre est au nord de z = coast(x). Droit devant le phare (la falaise du modèle) ; à ses deux
   * bouts le relief avance de 10 m, en éperon : il enveloppe la tranche de la falaise du modèle.
   */
  const COAST = [[-3200, -330], [-1500, -300], [-700, -232], [-420, -150], [-230, -40], [-140, 28], [-91, 31], [-76, 17.5], [96, 17.5], [111, 31], [150, 27], [190, -8], [232, -110], [276, -158], [330, -160], [500, -152], [700, -152], [748, -120], [790, 40], [850, 300], [930, 440], [1100, 470], [1500, 380], [2200, 330], [3200, 300]];
  const coast = (x) => {
    for (let i = 0; i < COAST.length - 1; i++) {
      const [x0, z0] = COAST[i], [x1, z1] = COAST[i + 1];
      if (x <= x1) { const t = Math.max(0, (x - x0) / (x1 - x0)); return z0 + (z1 - z0) * t * t * (3 - 2 * t); }
    }
    return COAST[COAST.length - 1][1];
  };
  /** Hauteur de la côte : falaise du cap (9,7 m), terre basse au fond de la crique (2,4 m), pointe de l'est (16 m). */
  const top = (x) => {
    let h = 9.7 + 5 * ss(-150, -700, x);
    h = lerp(h, 2.4, ss(150, 262, x));
    h = lerp(h, 16, ss(735, 860, x));
    return h;
  };

  log('forme analytique');
  /** distance signée au trait de côte par cellule (> 0 : à terre) et fond de la mer */
  const D = new Float32Array(N * N);
  const seaBed = (d) => -Math.min(26, 2.5 + 0.2 * Math.max(0, -d));
  for (let j = 0; j < N; j++) {
    const z = wx(j);
    for (let i = 0; i < N; i++) {
      const x = wx(i);
      // la côte ondule un peu, sauf devant le phare, au fond de la crique (digue, quai) et le long des lignes de visée
      const straight = Math.max(1 - ss(120, 190, Math.abs(x)), ss(250, 280, x) * (1 - ss(720, 760, x)));
      const wob = (1 - straight) * (26 * n1(x / 310 + 2.3, 0.7) + 9 * n2(x / 90, 4.1));
      const d = coast(x) + wob - z; // > 0 : à terre
      // fond de la mer : il plonge vite (rien ne doit affleurer sous la houle)
      D[idx(i, j)] = d;
      const sea = seaBed(d);
      // terre : rebord, lande en pente douce, collines à partir de 250 m du rivage
      const inl = Math.max(0, d);
      const low = ss(150, 262, x) * (1 - ss(735, 860, x));
      let land = top(x) + (0.022 - 0.012 * low) * Math.min(inl, 600) + 1.2 * fbm2(n3, x / 160, z / 160, 3) * ss(30, 140, inl) * (1 - 0.7 * low);
      land += ss(240, 900, inl) * (22 + 70 * ridged2(n4, x / 1500 + 3, z / 1500, 4, 2.1, 0.5));
      H[idx(i, j)] = lerp(sea, land, ss(-7, 3.5, d));
    }
  }

  log('érosion');
  // légère, et nulle sur le cap, au fond de la crique et en mer
  lib.erode(T, { drops: 120000, seed: 7717, weight: (x, z) => 0.35 * ss(260, 600, Math.hypot(x, z)) * ss(-380, -520, z) });

  log('sites, route, bâtiments, voies');
  const siteHeights = lib.flattenSites(T, W.SITES, { noise: n3 });
  const road = catmull(W.ROAD, 12);
  const roadD = lib.carveRoad(T, road, { width: W.ROAD_WIDTH });
  const buildings = lib.flattenBuildings(T, W.FLATTENED);
  // le phare n'est pas terrassé par la bibliothèque : son modèle fournit lande, falaise et fond de mer sur 200 × 170 m
  buildings.unshift({ id: 'phare', x: W.PHARE.x, z: W.PHARE.z, yaw: 0, groundY: W.PHARE.groundY });
  const G = W.PHARE_GROUND;
  /** distance au bord de l'emprise du modèle du phare, positive dedans */
  const inPhare = (x, z) => Math.min(x - G.x0, G.x1 - x, z - G.z0, G.z1 - z);
  const inLot = (x, z) => W.FLATTENED.some((b) => lib.lotDistance(b, x, z) < 1) || inPhare(x, z) > 0;
  const net = lib.carveWays(T, W.WAYS.map((w) => ({ ...w, endY: w.to ? W.BUILDINGS.find((b) => b.name === w.to).groundY : undefined })), {
    skip: (k) => inLot(wx(k % N), wx(Math.floor(k / N))),
  });
  // sous le décor du phare, le relief s'efface : 4 m sous la lande du modèle, et sous son fond de mer au sud de la
  // falaise. Au bord de l'emprise il garde sa hauteur : il recouvre la lisière de la lande du modèle (pas de tranche).
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = wx(i), z = wx(j);
      const di = inPhare(x, z);
      if (di <= 0) continue;
      const pit = lerp(W.PHARE.groundY - 4, -7, ss(G.cliffZ - 9, G.cliffZ - 2, z));
      const k = idx(i, j);
      H[k] = lerp(H[k], Math.min(H[k], pit), ss(0, 9, di));
    }
  // la mer reprend ce que les terrassements (bande plate des lots, talus des voies) ont comblé au-delà du rivage
  for (let k = 0; k < N * N; k++) {
    const d = D[k];
    if (d < 3.5 && Object.values(W.SITES).every((s) => Math.hypot(wx(k % N) - s.x, wx(Math.floor(k / N)) - s.z) > s.r1)) H[k] = Math.min(H[k], lerp(seaBed(d), Math.max(H[k], 2.2), ss(-7, 3.5, d)));
  }
  // la terre basse du fond de la crique ferme l'étang et le canal de la digue, puis descend au rivage
  // (l'îlot et la roche de la passe portent une cible : ils ne sont pas lissés)
  const keepSites = (x, z) => Object.values(W.SITES).every((s) => Math.hypot(x - s.x, z - s.z) > s.r1 + 8) ? 1 : 0;
  lib.carveSightlines(T, W.SIGHTLINES, W.POSTS, W.BASE_Y, { smooth: 4, reach: 2, protect: keepSites });

  log('matières');
  const lots = lib.buildingClearing(W.FLATTENED);
  const splat = lib.paint(T, {
    rockNoise: n4, forestNoise: n3, roadD, roadWidth: W.ROAD_WIDTH,
    wayEdge: net.edge, wayDirt: net.dirt, wayGravel: net.gravel,
    // pas de roche d'altitude ni de limite des arbres : seule la pente met le granit à nu
    rockAlt: [3000, 3200], forestLow: [5000, 5001], treeLine: [5000, 5001], clearRadius: [130, 200],
    sites: W.SITES, siteCore: () => 0,
    // lande rase au bord de mer (le vent), bosquets à l'abri des collines ; rien dans les lots ni sous le phare
    forestExtra: (x, z) => 0.55 * ss(-250, -520, z) * lots(x, z) * (inPhare(x, z) > -30 ? 0 : 1),
  });
  // galets et roche mouillée sur l'estran, granit sur l'îlot et la roche de la passe
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = idx(i, j), h = H[k];
      if (h < 1.6) {
        const w = 1 - ss(0.4, 1.6, h);
        splat[k * 4 + 1] = Math.max(splat[k * 4 + 1], Math.round(255 * 0.8 * w));
        splat[k * 4 + 2] = Math.round(splat[k * 4 + 2] * (1 - w));
      }
    }

  return { T, splat, meta: { siteHeights, road: lib.roundLine(road), river: [], buildings, ways: net.ways }, sites: W.SITES, sightlines: W.SIGHTLINES, posts: W.POSTS, baseY: W.BASE_Y };
}
