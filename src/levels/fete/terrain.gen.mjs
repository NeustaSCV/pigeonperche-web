// Relief du niveau « fete » : un front de mer plat. La côte file droit du sud au nord (la mer à l'ouest), l'estran
// plonge vite sous l'eau, l'esplanade monte à peine vers l'intérieur ; au-delà, des dunes boisées de pins puis une
// couronne de collines basses ferment l'horizon côté terre.
// Lancé par : node tools/gen-terrain.mjs fete   → public/terrain/fete/{height.bin, splat.bin, meta.json}
import * as W from './map.ts';
import { lotDistance } from '../building-lots.ts';

export const size = W.TERRAIN_SIZE;
export const res = W.TERRAIN_RES;

/** @param {typeof import('../../../tools/terrain-lib.mjs')} lib @param {(m: string) => void} log */
export default function generate(lib, log) {
  const { makeNoise2D, fbm2, ridged2, ss, clamp } = lib;
  const T = lib.createGrid(size, res);
  const { N, H, wx, idx } = T;
  const n1 = makeNoise2D(1903);
  const n2 = makeNoise2D(1907);
  const n3 = makeNoise2D(2026);
  const n4 = makeNoise2D(52);
  const A = W.HOTEL_AREA, P = W.HOTEL_POOL;

  log('forme analytique');
  for (let j = 0; j < N; j++) {
    const z = wx(j);
    for (let i = 0; i < N; i++) {
      const x = wx(i);
      const k = idx(i, j);
      let h;
      if (x < W.SHORE_X + 4) {
        // estran et fond : le sable passe sous l'eau en quatre mètres, puis plonge
        const d = W.SHORE_X + 4 - x;
        h = d < 4 ? W.LAND_Y - (W.LAND_Y + 0.35) * (d / 4) : Math.max(-9, -0.35 - 0.3 * (d - 4));
      } else {
        // esplanade : presque plate, elle monte de 1,2 % vers l'intérieur
        const e = x - (W.SHORE_X + 4);
        h = W.LAND_Y + 0.012 * e;
        // dunes de l'arrière-pays, au-delà des lots, puis collines basses qui ferment l'horizon
        const inland = ss(130, 420, x);
        h += inland * (5 + 7 * fbm2(n1, x / 260, z / 260, 4) + 2.2 * fbm2(n2, x / 70, z / 70, 3));
        const rim = ss(560, 1300, x);
        h += rim * (22 + 26 * ridged2(n4, x / 800 + 3, z / 800, 4, 2.05, 0.5) + 6 * fbm2(n3, x / 220, z / 220, 3));
        // le long de la côte, loin au nord et au sud, un cordon de dunes basses
        const far = ss(520, 900, Math.abs(z)) * (1 - ss(60, 200, x));
        h += far * (1.5 + 2.5 * (0.5 + 0.5 * fbm2(n2, x / 60 + 9, z / 90, 3)));
      }
      // sous tout ce que dessine le modèle du Grand Hôtel (plage, rue, maisons, mer), le relief passe dessous
      const din = Math.min(x - A.x0, A.x1 - x, z - A.z0, A.z1 - z);
      if (din > 0) h = Math.min(h, lib.lerp(h, W.HOTEL_GROUND - 0.3, ss(1, 7, din)));
      // sa piscine est creusée de 2,9 m
      const dp = Math.min(x - P.x0, P.x1 - x, z - P.z0, P.z1 - z);
      if (dp > -5) h = Math.min(h, lib.lerp(h, W.HOTEL_GROUND - 3.6, ss(-5, -1, dp)));
      H[k] = h;
    }
  }

  log('sites, lots, voies');
  const siteHeights = lib.flattenSites(T, W.SITES, { noise: n3 });
  // terrassement des lots (le Grand Hôtel est traité ci-dessus : son altitude est imposée)
  const others = W.BUILDINGS.filter((b) => b.name !== 'hotel');
  const buildings = lib.flattenBuildings(T, others, { flat: 12, blend: 24 });
  const lotD = (x, z) => Math.min(...others.map((b) => lotDistance(b, x, z)));
  const inHotel = (x, z) => x > A.x0 && x < A.x1 && z > A.z0 && z < A.z1;
  const groundY = (name) => (name === 'hotel' ? W.LAND_Y + 0.75 : buildings[others.findIndex((b) => b.name === name)].groundY);
  const net = lib.carveWays(T, W.WAYS.map((w) => ({ ...w, endY: w.to ? groundY(w.to) : undefined })), {
    skip: (k) => { const x = wx(k % N), z = wx(Math.floor(k / N)); return lotD(x, z) < 1 || inHotel(x, z); },
  });
  lib.carveSightlines(T, W.SIGHTLINES, W.POSTS, W.BASE_Y);

  log('matières');
  const clearing = lib.buildingClearing(others);
  const splat = lib.paint(T, {
    rockNoise: n4, forestNoise: n3, rockAlt: [900, 1000], forestLow: [900, 1000], treeLine: [1900, 2000], clearRadius: [50, 80],
    wayEdge: net.edge, wayDirt: net.dirt, wayGravel: net.gravel,
    sites: W.SITES, siteCore: () => 0.35,
    // pinèdes de l'arrière-pays seulement : le front de mer reste nu
    forestExtra: (x, z) => clearing(x, z) * ss(150, 330, x) * (inHotel(x, z) ? 0 : 1),
  });
  // sable : la plage jusqu'à la digue, le fond, et des plaques de sable dans l'herbe rase de l'esplanade
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const x = wx(i), z = wx(j), k = idx(i, j);
      const beach = 1 - ss(W.PROMENADE.x0 - 1, W.PROMENADE.x1 + 5, x);
      const patches = (1 - ss(40, 150, x)) * ss(0.5, 0.78, 0.5 + 0.5 * fbm2(n2, x / 120, z / 120, 2)) * 0.5;
      // cordon de dunes : sable nu sur les crêtes
      const sand = clamp(Math.max(beach, patches), 0, 1);
      splat[k * 4 + 3] = Math.max(splat[k * 4 + 3], Math.round(255 * sand));
      if (x < 120) { splat[k * 4] = 0; splat[k * 4 + 1] = Math.min(splat[k * 4 + 1], 40); }
      if (x < W.PROMENADE.x1 + 2) splat[k * 4 + 2] = 0;
    }

  return { T, splat, meta: { siteHeights, road: [], river: [], buildings, ways: net.ways }, sites: W.SITES, sightlines: W.SIGHTLINES, posts: W.POSTS, baseY: W.BASE_Y };
}
