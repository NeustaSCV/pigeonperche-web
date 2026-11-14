// Décor du niveau « facile » : bâtiments de la ferme derrière la cour, bourg autour de l'église, hameaux, voie de la
// cible mobile, sablière, rivière, fanions. Les grands édifices (moulin, église, hôpital, château d'eau, château)
// viennent de la banque de bâtiments : ils sont déclarés dans data.buildings et posés par le jeu.
// Renvoie les points d'ancrage des cibles posées au sol ; celles des bâtiments sont accrochées dans targets.ts.
import { Group, Vector3 } from 'three';
import type { Engine } from '../../core/engine';
import { hash01, mulberry32 } from '../../core/noise';
import type { Colliders } from '../../world/colliders';
import { buildFlags } from '../../world/flags';
import { Kit, gable, house, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import type { Terrain } from '../../world/terrain';
import { buildWater } from '../../world/water';
import type { Wind } from '../../world/wind';
import { lotDistance } from '../building-lots';
import { BASE_Y, BUILDINGS, DECK, HOOKS, LOTS, RIVER_WIDTH, SITES, TRACK, lotPoint } from './map';

const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface Anchors {
  plate1: Vector3;
  plate2: Vector3;
  balloon: Vector3;
  drum: Vector3;
  /** bouts de la voie de la cible mobile (dessus du rail) */
  trackA: Vector3;
  trackB: Vector3;
  chimneys: Vector3[];
}

/** Le point (x, z) est-il dans un lot de bâtiment, à `m` mètres près ? */
const inLot = (x: number, z: number, m: number): boolean => BUILDINGS.some((b) => lotDistance(b, x, z) < m);

/** Distance du point (x, z) au segment a→b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

export class Vale {
  group = new Group();
  anchors!: Anchors;

  async build(engine: Engine, terrain: Terrain, col: Colliders, wind: Wind): Promise<void> {
    const tex = await loadKitTextures(engine.q.anisotropy);
    const k = new Kit();
    const rnd = mulberry32(4117);
    const H = (x: number, z: number): number => terrain.heightAt(x, z);
    const road = terrain.meta.road;
    const nearRoad = (x: number, z: number, lim: number): boolean => road.some((p) => Math.hypot(p[0] - x, p[1] - z) < lim);

    // points visés dans les bâtiments (en plan) : aucune maison du décor ne doit se glisser devant
    const hookXZ = (key: keyof typeof HOOKS): [number, number] => {
      const hk = HOOKS[key], p = lotPoint(LOTS[hk.lot as keyof typeof LOTS], hk.x, hk.z);
      return [p.x, p.z];
    };
    const guard: [number, number][] = [
      hookXZ('mill'), hookXZ('bell'), hookXZ('tower'), hookXZ('roof'),
      [SITES.plate1.x, SITES.plate1.z], [SITES.plate2.x, SITES.plate2.z], [SITES.balloon.x, SITES.balloon.z], [TRACK.ax, TRACK.az], [TRACK.bx, TRACK.bz],
      [LOTS.eglise.x, LOTS.eglise.z + 22], [LOTS.hopital.x - 20, LOTS.hopital.z + 13], [LOTS.hopital.x + 20, LOTS.hopital.z + 13],
    ];
    const inView = (x: number, z: number, m: number): boolean => guard.some(([gx, gz]) => segDist(x, z, 0, -10, gx, gz) < m);

    const chimneys: Vector3[] = [];
    const placed: [number, number, number][] = [];
    const tryHouse = (x: number, z: number, w: number, d: number, h: number, rot: number, seed: number, viewMargin = 13): boolean => {
      const rad = Math.max(w, d) * 0.62;
      if (inLot(x, z, rad + 1) || nearRoad(x, z, 3.2 + Math.min(w, d) / 2) || inView(x, z, viewMargin)) return false;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + rad)) return false;
      if (terrain.splatAt(x, z, 1) > 0.3) return false; // berge
      placed.push([x, z, rad]);
      const ch = house(k, terrain, x, z, w, d, h, rot, seed);
      if (chimneys.length < 3 && seed % 4 === 0) chimneys.push(ch);
      return true;
    };

    // ================= la ferme du Guet, derrière le mur sud =================
    let seed = 3;
    placed.push([5, 32, 9]);
    house(k, terrain, 5, 32, 15, 6.6, 3.5, 0, 1);
    placed.push([-25, 30, 7]);
    house(k, terrain, -25, 30, 9.5, 7.2, 5.6, 1.35, 2);
    // appentis à bois contre la longère
    rgb(k.wood, 0x6b5a45);
    for (const dx of [-1.6, 1.6]) k.wood.box(18 + dx, H(18, 30) + 1.0, 29.6, 0.14, 2.2, 0.14, 1.5);
    rgb(k.roof, 0x8a8478, 0.8);
    gable(k, k.roof, null, v3(18, H(18, 30) + 2.1, 31), 4.2, 3.4, 0.5, 0, 0.2, 0.06);
    rgb(k.wood, 0x8a7458);
    for (let i = 0; i < 14; i++) k.wood.box(16.6 + (i % 7) * 0.42, H(18, 30) + 0.2 + Math.floor(i / 7) * 0.34, 31.2, 0.36, 0.3, 1.0, 1.5, hash01(i, 3) * 0.2);

    // ================= le bourg : une rue le long de la route, au pied de l'église =================
    const E = LOTS.eglise;
    for (let i = 4; i < road.length - 5; i += 3) {
      const p = road[i], q = road[i + 1];
      const dc = Math.hypot(p[0] - E.x, p[1] - E.z);
      if (dc > 235) continue;
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      for (const side of [1, -1]) {
        if (rnd() < 0.22) continue;
        const w = 8 + rnd() * 5, d = 6 + rnd() * 2, off = 3.6 + d / 2 + rnd() * 2.5;
        const x = p[0] + (-dz / l) * side * off, z = p[1] + (dx / l) * side * off;
        const tall = rnd() < 0.45 && !inView(x, z, 22);
        tryHouse(x, z, w, d, tall ? 6.2 + rnd() * 0.5 : 3.5 + rnd() * 0.5, Math.atan2(-dz, dx) + (rnd() - 0.5) * 0.12, seed++);
      }
    }
    // maisons en retrait, derrière l'église et vers le versant
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = 55 + rnd() * 95;
      const x = E.x + Math.cos(a) * r * 1.15, z = E.z - 22 + Math.sin(a) * r * 0.75;
      if (z > E.z + 6) continue; // le pré devant le bourg reste ouvert
      tryHouse(x, z, 8 + rnd() * 4, 6 + rnd() * 2, rnd() < 0.5 ? 6.3 : 3.7, rnd() * 0.6 - 0.3, seed++);
    }
    // ================= hameaux et fermes isolées =================
    const hamlets: [number, number, number][] = [[330, -640, 5], [-330, -690, 4], [-560, -470, 3], [640, -430, 4], [-250, 250, 3], [330, 260, 4], [760, -120, 3], [-760, -40, 3], [60, 420, 3]];
    for (const [hx, hz, n] of hamlets)
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.28, r = 8 + rnd() * 26;
        tryHouse(hx + Math.cos(a) * r, hz + Math.sin(a) * r, 9 + rnd() * 5, 6.2 + rnd() * 2, rnd() < 0.4 ? 6.2 : 3.8, rnd() * 3.1, seed++, 16);
      }

    // ================= voie de la cible mobile : rails, traverses, heurtoirs, cabane du treuil =================
    const ty = H((TRACK.ax + TRACK.bx) / 2, TRACK.az);
    const tl = TRACK.bx - TRACK.ax;
    rgb(k.metal, 0x5a5048);
    for (const dz of [-0.45, 0.45]) k.metal.box((TRACK.ax + TRACK.bx) / 2, ty + 0.14, TRACK.az + dz, tl + 3, 0.09, 0.07, 1.2);
    rgb(k.wood, 0x54483a);
    for (let x = TRACK.ax - 1.2; x <= TRACK.bx + 1.2; x += 1.1) k.wood.box(x, ty + 0.05, TRACK.az, 0.2, 0.1, 1.5, 1.5);
    rgb(k.wood, 0x8a2f26);
    for (const ex of [TRACK.ax - 1.8, TRACK.bx + 1.8]) {
      k.wood.box(ex, ty + 0.45, TRACK.az, 0.25, 0.9, 1.4, 1.5);
      rgb(k.wood, 0xd9d2c2);
      k.wood.box(ex, ty + 0.75, TRACK.az + 0.01, 0.27, 0.16, 1.42, 1.5);
      rgb(k.wood, 0x8a2f26);
    }
    // cabane du treuil, au bout est, en retrait de la voie
    rgb(k.wood, 0x6e5d48);
    k.wood.box(TRACK.bx + 6, ty + 1.1, TRACK.az - 4.5, 2.6, 2.2, 2.2, 1.5, 0.2);
    rgb(k.metal, 0x767a78);
    k.metal.box(TRACK.bx + 6, ty + 2.28, TRACK.az - 4.5, 3.0, 0.08, 2.6, 1.2, 0.2);
    // clôture du pré : piquets et deux lisses
    rgb(k.wood, 0x6a5a44);
    const fence = (ax: number, az: number, bx: number, bz: number): void => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 3);
      const rot = Math.atan2(-(bz - az), bx - ax);
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
        k.wood.box(x, H(x, z) + 0.55, z, 0.1, 1.2, 0.1, 1.5);
        if (i < n && hash01(i, Math.round(ax)) > 0.12) {
          const mx = x + (bx - ax) / n / 2, mz = z + (bz - az) / n / 2;
          for (const hy of [0.45, 0.95]) k.wood.box(mx, H(mx, mz) + hy, mz, len / n, 0.07, 0.04, 1.5, rot);
        }
      }
    };
    fence(TRACK.ax - 14, TRACK.az - 14, TRACK.bx + 16, TRACK.az - 14);
    fence(TRACK.ax - 14, TRACK.az - 14, TRACK.ax - 14, TRACK.az + 9);
    fence(TRACK.bx + 16, TRACK.az - 14, TRACK.bx + 16, TRACK.az + 9);

    // ================= sablière : trémie rouillée, baraque de tôle, fûts, tas de sable =================
    const Q = SITES.quarry;
    const qy = H(Q.x, Q.z);
    rgb(k.metal, 0x7a5a44);
    k.metal.box(Q.x + 7, qy + 2.6, Q.z - 6, 3.2, 1.6, 3.2, 1.2, 0.3);
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]]) k.metal.box(Q.x + 7 + dx, qy + 0.9, Q.z - 6 + dz, 0.14, 1.9, 0.14, 1.2, 0.3);
    k.metal.obox(v3(Q.x + 2.6, qy + 2.0, Q.z - 8.2), v3(0.94, 0.33, -0.1).normalize(), v3(-0.33, 0.94, 0).normalize(), v3(0.1, 0, 1).normalize(), 3.6, 0.1, 0.5, 1.2);
    rgb(k.metal, 0x6f7672);
    k.metal.box(Q.x - 9, qy + 1.15, Q.z - 9, 4.4, 2.3, 3.0, 1.2, -0.4);
    rgb(k.metal, 0x4d5450);
    k.metal.box(Q.x - 9, qy + 2.36, Q.z - 9, 4.8, 0.08, 3.4, 1.2, -0.4);
    const drum = v3(Q.x - 4, 0, Q.z + 2);
    drum.y = H(drum.x, drum.z);
    rgb(k.metal, 0x3c5560);
    for (const [dx, dz] of [[1.1, 0.9], [1.9, -0.1], [1.0, -0.9], [2.6, 1.0]]) k.metal.cyl(drum.x + dx, H(drum.x + dx, drum.z + dz), drum.z + dz, 0.29, 0.29, 0.88, 12, 1.2, true);
    rgb(k.stone, 0xc2b594);
    for (const [dx, dz, r] of [[9, 7, 3.4], [3, 11, 2.6], [-11, 5, 2.2]]) k.stone.cyl(Q.x + dx, H(Q.x + dx, Q.z + dz) - 0.2, Q.z + dz, r, 0.25, r * 0.55, 10, 2.6, true);

    // ================= meules de foin dans les prés =================
    rgb(k.fabric, 0xcdb46c);
    for (let i = 0; i < 70; i++) {
      const x = -900 + rnd() * 1800, z = -760 + rnd() * 1300;
      const y = H(x, z);
      if (Math.hypot(x, z) < 90 || y > 96 || nearRoad(x, z, 8) || inLot(x, z, 8) || terrain.splatAt(x, z, 2) > 0.2 || terrain.splatAt(x, z, 1) > 0.2 || terrain.splatAt(x, z, 3) > 0.2) continue;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + 4) || inView(x, z, 5)) continue;
      if (terrain.normalAt(x, z, new Vector3(), 2).y < 0.97) continue;
      k.fabric.cyl(x, y - 0.1, z, 0.75, 0.75, 1.25, 10, 1.2, true);
    }

    kitMeshes(engine, k, tex, col, this.group);

    // ================= rivière (ruban), fanions =================
    buildWater(engine, this.group, { level: 0, lake: null, river: { points: terrain.meta.river, width: RIVER_WIDTH } });
    const P1 = SITES.plate1, P2 = SITES.plate2, B = SITES.balloon;
    const deckTop = BASE_Y + DECK.floor;
    const Hsp = LOTS.hopital;
    buildFlags(engine, wind, this.group, [
      [P1.x + 2.2, H(P1.x + 2.2, P1.z + 0.8), P1.z + 0.8, 2.6, 0xc8412f],
      [P2.x + 3, H(P2.x + 3, P2.z + 1), P2.z + 1, 3, 0xc8412f],
      [B.x - 3, H(B.x - 3, B.z), B.z, 3, 0xd6a12c],
      [drum.x + 3.5, H(drum.x + 3.5, drum.z + 2), drum.z + 2, 3, 0xd6a12c],
      [TRACK.ax - 3.4, ty, TRACK.az + 1.5, 3, 0xc8412f], [TRACK.bx + 3.4, ty, TRACK.az + 1.5, 3, 0xc8412f],
      [LOTS.moulin.x + 24, H(LOTS.moulin.x + 24, LOTS.moulin.z + 30), LOTS.moulin.z + 30, 5, 0xd9d2c2],
      [E.x + 22, H(E.x + 22, E.z + 30), E.z + 30, 6, 0x3f6a8c],
      [Hsp.x - 34, H(Hsp.x - 34, Hsp.z + 20), Hsp.z + 20, 6, 0xd9d2c2],
      [LOTS.chateauEau.x + 30, H(LOTS.chateauEau.x + 30, LOTS.chateauEau.z + 26), LOTS.chateauEau.z + 26, 6, 0xc8412f],
      // manche à air de la plate-forme : le vent se lit d'abord chez soi
      [DECK.x0, deckTop + 1.0, DECK.z0, 2.2, 0xd6a12c],
    ]);

    this.anchors = {
      plate1: v3(P1.x, H(P1.x, P1.z), P1.z),
      plate2: v3(P2.x, H(P2.x, P2.z), P2.z),
      balloon: v3(B.x, H(B.x, B.z), B.z),
      drum,
      trackA: v3(TRACK.ax, ty + 0.19, TRACK.az),
      trackB: v3(TRACK.bx, ty + 0.19, TRACK.bz),
      chimneys,
    };
  }
}
