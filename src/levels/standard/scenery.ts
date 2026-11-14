// Décor lointain du niveau « standard » : village et place du marché, campement, pont, relais radio, mirador,
// lac et rivière, fanions. Renvoie les points d'ancrage des cibles.
import { Group, Vector3, type MeshStandardMaterial } from 'three';
import type { Engine } from '../../core/engine';
import { hash01, mulberry32 } from '../../core/noise';
import type { Colliders } from '../../world/colliders';
import { buildFlags } from '../../world/flags';
import { Kit, gable, house, kitMeshes, loadKitTextures, rgb, tent } from '../../world/kit';
import type { Terrain } from '../../world/terrain';
import { buildWater } from '../../world/water';
import { nearWay } from '../../world/ways';
import type { Wind } from '../../world/wind';
import { lotDistance } from '../building-lots';
import { BELL, BRIDGE, BUILDINGS, LAKE_LEVEL, RIVER_WIDTH, SITES, polar } from './map';

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface Anchors {
  plate1: Vector3;
  plate2: Vector3;
  balloon: Vector3;
  relayFeed: Vector3;
  searchlight: Vector3;
  drum: Vector3;
  padlock: Vector3;
  padlockYaw: number;
  gatePivot: Vector3;
  gateYaw: number;
  drone: Vector3;
  mirador: Vector3;
  miradorYaw: number;
  market: Vector3;
  /** obstacles du marché (x, z, rayon) */
  stalls: [number, number, number][];
  chimneys: Vector3[];
  campfire: Vector3;
  camp: Vector3;
  church: Vector3;
}

export class Valley {
  group = new Group();
  anchors!: Anchors;
  water!: MeshStandardMaterial;

  async build(engine: Engine, terrain: Terrain, col: Colliders, wind: Wind): Promise<void> {
    const tex = await loadKitTextures(engine.q.anisotropy);
    const k = new Kit();
    const rnd = mulberry32(2025);
    const H = (x: number, z: number): number => terrain.heightAt(x, z);
    const road = terrain.meta.road;
    // la route, et les voies secondaires (ruelle, chemins) avec une marge moindre : les maisons les bordent
    const ways = terrain.meta.ways;
    const nearRoad = (x: number, z: number, lim: number): boolean => road.some((p) => Math.hypot(p[0] - x, p[1] - z) < lim) || nearWay(ways, x, z, lim - 6);
    /** dans le lot d'un bâtiment de la vallée, ou à moins de `margin` mètres */
    const inLot = (x: number, z: number, margin: number): boolean => BUILDINGS.some((b) => lotDistance(b, x, z) < margin);

    // ================= village =================
    const V = SITES.village;
    const market = v3(V.x, H(V.x, V.z), V.z);
    const chimneys: Vector3[] = [];
    const placed: [number, number, number][] = [];
    const tryHouse = (x: number, z: number, w: number, d: number, h: number, rot: number, seed: number): void => {
      if (nearRoad(x, z, 8.5 + Math.max(w, d) / 2)) return;
      // l'église du bourg et son cimetière prennent la place des maisons au nord de la place
      if (inLot(x, z, 3 + Math.max(w, d) * 0.62)) return;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + Math.max(w, d) * 0.62)) return;
      placed.push([x, z, Math.max(w, d) * 0.62]);
      const ch = house(k, terrain, x, z, w, d, h, rot, seed);
      if (chimneys.length < 4 && seed % 5 === 0) chimneys.push(ch);
    };
    // deux couronnes autour de la place, côté sud laissé ouvert vers la route (et vers le tireur)
    let seed = 1;
    for (let ring = 0; ring < 3; ring++) {
      const n = 12 + ring * 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.21;
        const south = Math.cos(a - Math.PI) ; // 1 = plein sud (z plus grand)
        if (ring === 0 && Math.sin(a) > 0.25) continue; // sud dégagé
        void south;
        const rx = 36 + ring * 21 + rnd() * 6, rz = 30 + ring * 19 + rnd() * 6;
        const x = V.x + Math.cos(a) * rx, z = V.z + Math.sin(a) * rz;
        const w = 8 + rnd() * 5, d = 6 + rnd() * 2.5, h = 3.4 + (rnd() < 0.55 ? 2.7 : 0) + rnd() * 0.6;
        tryHouse(x, z, w, d, h, -a + Math.PI / 2 + (rnd() - 0.5) * 0.5, seed++);
      }
    }
    // fermes le long de la route
    for (let i = 20; i < road.length - 30; i += 9) {
      const p = road[i], q = road[i + 1];
      if (Math.hypot(p[0] - V.x, p[1] - V.z) < 150 || Math.hypot(p[0] - SITES.camp.x, p[1] - SITES.camp.z) < 160 || Math.hypot(p[0] - BRIDGE.x, p[1] - BRIDGE.z) < 90) continue;
      if (rnd() < 0.45) continue;
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const side = rnd() < 0.5 ? 1 : -1;
      const x = p[0] + (-dz / l) * side * 17, z = p[1] + (dx / l) * side * 17;
      if (H(x, z) < 12 || terrain.splatAt(x, z, 0) > 0.3) continue;
      // (les tirages sont faits avant le test du lot : la suite du décor ne dépend pas des bâtiments posés)
      const fw = 9 + rnd() * 4, fh = 3.6 + rnd() * 2.6, fs = seed++;
      if (inLot(x, z, 12) || nearWay(ways, x, z, 10)) continue;
      placed.push([x, z, 8]);
      house(k, terrain, x, z, fw, 6.5, fh, Math.atan2(-dz, dx), fs);
    }
    // l'église est celle de la banque de bâtiments (map.ts, BUILDINGS) ; la cloche sonne dans son clocher
    const church = v3(BELL.x, BELL.y, BELL.z);
    // place : fontaine, étals en rangées nord-sud (les allées restent visibles depuis le sommet)
    const stalls: [number, number, number][] = [];
    rgb(k.stone, 0xb8b2a6);
    k.stone.cyl(V.x, market.y - 0.2, V.z + 2, 2.2, 2.1, 0.75, 16, 2.6, false);
    k.stone.cyl(V.x, market.y - 0.2, V.z + 2, 0.35, 0.3, 1.9, 8, 2.6, true);
    stalls.push([V.x, V.z + 2, 2.7]);
    const AWN = [0xb5463c, 0xd9c9a3, 0x3f6a8c, 0xc79a3a, 0x5d7d4e, 0xb5463c, 0xe6e0d0, 0x8c4a6b];
    let si = 0;
    for (const col of [-17, -8.5, 8.5, 17])
      for (const row of [-11, -3, 9]) {
        if (rnd() < 0.12) continue;
        const sx = V.x + col + (rnd() - 0.5) * 1.5, sz = V.z + row + (rnd() - 0.5) * 2;
        const sy = H(sx, sz);
        const rot = Math.PI / 2 + (rnd() - 0.5) * 0.15;
        rgb(k.wood, 0x7a6248);
        for (const [dx, dz] of [[-1.1, -1.9], [1.1, -1.9], [-1.1, 1.9], [1.1, 1.9]]) k.wood.box(sx + dx, sy + 1.15, sz + dz, 0.08, 2.3, 0.08, 1.5);
        k.wood.box(sx, sy + 0.82, sz, 1.7, 0.08, 3.5, 1.5);
        rgb(k.fabric, AWN[si++ % AWN.length]);
        gable(k, k.fabric, null, v3(sx, sy + 2.3, sz), 4.2, 2.8, 0.55, rot, 0.25, 0.04);
        // marchandises : caisses de couleurs
        for (let i = 0; i < 5; i++) {
          rgb(k.wood, [0xc97b3a, 0x9bab4a, 0xb8463a, 0xd9c26a, 0x8a6a4a][i]);
          k.wood.box(sx + (hash01(i, si) - 0.5) * 1.0, sy + 0.98, sz - 1.4 + i * 0.7, 0.5, 0.24, 0.5, 1.5, hash01(i, si + 1));
        }
        stalls.push([sx, sz, 2.3]);
      }
    // murets de pierre autour de la place
    rgb(k.stone, 0xa9a297);
    k.stone.box(V.x - 26, market.y + 0.35, V.z + 15, 0.5, 0.9, 12, 2.6);
    k.stone.box(V.x + 26.5, market.y + 0.35, V.z + 14, 0.5, 0.9, 14, 2.6);

    // ================= campement =================
    const C = SITES.camp;
    const campY = H(C.x, C.z);
    const camp = v3(C.x, campY, C.z);
    const tcol = [0x3f4232, 0x474a38, 0x3a3d2c];
    [[-14, -12, 0.2], [-4, -15, 0.1], [7, -14, -0.15], [-17, 2, 1.5], [-15, 13, 1.4], [-3, 16, 0.05]].forEach(([dx, dz, r], i) => tent(k, terrain, C.x + dx, C.z + dz, 6.5, 4.6, r, tcol[i % 3]));
    // conteneurs
    rgb(k.metal, 0x5e7a86);
    k.metal.box(C.x + 6, H(C.x + 6, C.z + 18) + 1.3, C.z + 18, 6.1, 2.6, 2.45, 1.2, 0.2);
    rgb(k.metal, 0x8a5a44);
    k.metal.box(C.x + 16, H(C.x + 16, C.z - 13) + 1.3, C.z - 13, 6.1, 2.6, 2.45, 1.2, -0.5);
    // camion bâché à l'arrêt
    const tx = C.x + 14, tz = C.z + 7;
    const ty = H(tx, tz);
    rgb(k.metal, 0x4b5240);
    k.metal.box(tx, ty + 1.25, tz, 2.3, 1.1, 6.4, 1.2, 0.5);
    k.metal.box(tx + Math.sin(0.5) * 2.4, ty + 1.9, tz + Math.cos(0.5) * 2.4, 2.2, 1.5, 1.7, 1.2, 0.5);
    rgb(k.fabric, 0x6a6a4e);
    k.fabric.box(tx - Math.sin(0.5) * 0.9, ty + 2.55, tz - Math.cos(0.5) * 0.9, 2.3, 1.5, 4.2, 1.2, 0.5);
    rgb(k.metal, 0x121212);
    for (const [a, b] of [[-1.05, 2.2], [1.05, 2.2], [-1.05, -2.0], [1.05, -2.0]]) {
      const wx = tx + Math.cos(0.5) * a + Math.sin(0.5) * b, wz = tz - Math.sin(0.5) * a + Math.cos(0.5) * b;
      k.metal.box(wx, ty + 0.45, wz, 0.3, 0.9, 0.9, 1.2, 0.5);
    }
    // fûts ordinaires, caisses, mât du projecteur, clôture
    const drum = v3(C.x + 20.5, 0, C.z + 13.5);
    drum.y = H(drum.x, drum.z);
    rgb(k.metal, 0x39505a);
    for (const [dx, dz] of [[-1.1, 0.7], [-1.9, -0.2], [-1.0, -1.0]]) k.metal.cyl(drum.x + dx, H(drum.x + dx, drum.z + dz), drum.z + dz, 0.29, 0.29, 0.88, 12, 1.2, true);
    rgb(k.wood, 0x7b6a50);
    for (let i = 0; i < 9; i++) k.wood.box(C.x - 6 + hash01(i, 3) * 9, campY + 0.35 + (i % 3 === 0 ? 0.7 : 0), C.z + 3 + hash01(i, 4) * 6, 1.1, 0.7, 0.8, 1.5, hash01(i, 5) * 3);
    const sl = v3(C.x + 23, 0, C.z - 4);
    sl.y = H(sl.x, sl.z);
    rgb(k.metal, 0x3a3d40);
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) k.metal.box(sl.x + dx, sl.y + 3.2, sl.z + dz, 0.1, 6.4, 0.1, 1.2);
    for (let i = 0; i < 4; i++) k.metal.box(sl.x, sl.y + 1.2 + i * 1.6, sl.z, 1.1, 0.07, 1.1, 1.2);
    rgb(k.wood, 0x6a5a44);
    k.wood.box(sl.x, sl.y + 6.45, sl.z, 1.7, 0.1, 1.7, 1.5);
    const searchlight = v3(sl.x - 0.3, sl.y + 7.05, sl.z + 0.2);
    rgb(k.wood, 0x5d5040);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const fx = C.x + Math.cos(a) * 34, fz = C.z + Math.sin(a) * 30;
      if (nearRoad(fx, fz, 6)) continue;
      k.wood.box(fx, H(fx, fz) + 0.7, fz, 0.1, 1.5, 0.1, 1.5);
    }
    const campfire = v3(C.x - 6, campY + 0.2, C.z - 2);
    rgb(k.stone, 0x6a665f);
    for (let i = 0; i < 8; i++) k.stone.box(campfire.x + Math.cos(i * 0.785) * 0.6, campY + 0.1, campfire.z + Math.sin(i * 0.785) * 0.6, 0.3, 0.25, 0.25, 2.6, i);

    // ================= pont et treuil =================
    const B = BRIDGE;
    const ri = road.reduce((best, p, i) => (Math.hypot(p[0] - B.x, p[1] - B.z) < Math.hypot(road[best][0] - B.x, road[best][1] - B.z) ? i : best), 0);
    const rd = v3(road[ri + 2][0] - road[ri - 2][0], 0, road[ri + 2][1] - road[ri - 2][1]).normalize();
    const brot = Math.atan2(-rd.z, rd.x);
    const bax = rd.clone(), baz = v3(-rd.z, 0, rd.x);
    rgb(k.stone, 0xaaa398);
    k.stone.obox(v3(B.x, B.deck - 0.45, B.z), bax, UP, baz, B.length / 2, 0.45, B.width / 2, 2.6);
    for (const s of [-1, 1]) {
      k.stone.obox(v3(B.x, B.deck + 0.45, B.z).addScaledVector(baz, s * (B.width / 2 - 0.2)), bax, UP, baz, B.length / 2, 0.45, 0.2, 2.6);
      for (const t of [-0.3, 0.3]) k.stone.obox(v3(B.x, B.deck - 4, B.z).addScaledVector(bax, t * B.length).addScaledVector(baz, s * 1.2), bax, UP, baz, 1.1, 4, 1.4, 2.6);
    }
    void brot;
    // portique du treuil à l'entrée sud (côté tireur) : deux poteaux, traverse, tambour, barrière levante
    const toSummit = v3(-B.x, 0, -B.z).normalize();
    const southEnd = rd.dot(toSummit) > 0 ? 1 : -1;
    const gate = v3(B.x, B.deck, B.z).addScaledVector(bax, southEnd * (B.length / 2 + 2.5));
    gate.y = Math.max(H(gate.x, gate.z), B.deck - 0.2);
    rgb(k.wood, 0x5f5140);
    for (const s of [-1, 1]) k.wood.obox(gate.clone().addScaledVector(baz, s * 3.4).add(v3(0, 1.6, 0)), bax, UP, baz, 0.13, 1.7, 0.13, 1.5);
    k.wood.obox(gate.clone().add(v3(0, 3.25, 0)), bax, UP, baz, 0.13, 0.12, 3.6, 1.5);
    rgb(k.metal, 0x4a4f52);
    const winch = gate.clone().addScaledVector(baz, 3.9).add(v3(0, 0.75, 0));
    k.metal.obox(winch, bax, UP, baz, 0.4, 0.45, 0.35, 1.2);
    k.metal.obox(winch.clone().add(v3(0, -0.55, 0)), bax, UP, baz, 0.5, 0.12, 0.5, 1.2);
    // le cadenas pend sur la face tournée vers le sommet
    const padlock = winch.clone().addScaledVector(toSummit, 0.52).add(v3(0, 0.05, 0));
    const padlockYaw = Math.atan2(toSummit.x, toSummit.z);
    const gatePivot = gate.clone().addScaledVector(baz, 3.3).add(v3(0, 1.05, 0));
    const gateYaw = Math.atan2(-baz.x, -baz.z);

    // ================= relais radio =================
    const R = SITES.relay;
    const ry = H(R.x, R.z);
    rgb(k.metal, 0xb9bcc0);
    const MH = 19;
    for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) k.metal.box(R.x + dx * 0.9, ry + MH / 2, R.z + dz * 0.9, 0.09, MH, 0.09, 1.2);
    for (let i = 0; i < 12; i++) {
      const yy = ry + 0.8 + i * 1.55;
      const s = 0.65;
      k.metal.box(R.x, yy, R.z - s, 1.3, 0.05, 0.05, 1.2);
      k.metal.box(R.x, yy, R.z + s, 1.3, 0.05, 0.05, 1.2);
      k.metal.box(R.x - s, yy, R.z, 0.05, 0.05, 1.3, 1.2);
      k.metal.box(R.x + s, yy, R.z, 0.05, 0.05, 1.3, 1.2);
    }
    rgb(k.metal, 0xb03a30);
    k.metal.box(R.x, ry + MH + 0.9, R.z, 0.05, 1.8, 0.05, 1.2);
    const toS = v3(-R.x, 0, -R.z).normalize();
    // paraboles
    rgb(k.metal, 0xdadcdc);
    for (const [hh, a] of [[15.5, 2.2], [12.2, -1.2]] as number[][]) {
      const dir = v3(Math.sin(a), 0, Math.cos(a));
      const side = v3(dir.z, 0, -dir.x);
      k.metal.obox(v3(R.x, ry + hh, R.z).addScaledVector(dir, 0.95), side, UP, dir, 0.75, 0.75, 0.06, 1.2);
    }
    // local technique, clôture
    rgb(k.plaster, 0xbdb8ad);
    k.plaster.box(R.x + 4.5, H(R.x + 4.5, R.z + 3) + 1.2, R.z + 3, 3.6, 2.6, 2.8, 3, 0.4);
    rgb(k.metal, 0x596066);
    k.metal.box(R.x + 4.5, H(R.x + 4.5, R.z + 3) + 2.56, R.z + 3, 3.9, 0.1, 3.1, 1.2, 0.4);
    const relayFeed = v3(R.x, ry + 13.6, R.z).addScaledVector(toS, 0.95);

    // ================= mirador et ponton =================
    const M = SITES.mirador;
    const my = H(M.x, M.z);
    rgb(k.wood, 0x6b5a45);
    const PH = 6.2;
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) k.wood.box(M.x + dx, my + PH / 2 + 1.2, M.z + dz, 0.2, PH + 2.6, 0.2, 1.5);
    k.wood.box(M.x, my + PH, M.z, 3.6, 0.14, 3.6, 1.5);
    for (let i = 0; i < 3; i++) {
      k.wood.box(M.x, my + 1.3 + i * 1.9, M.z - 1.5, 3.2, 0.1, 0.1, 1.5);
      k.wood.box(M.x - 1.5, my + 1.3 + i * 1.9, M.z, 0.1, 0.1, 3.2, 1.5);
      k.wood.box(M.x + 1.5, my + 1.3 + i * 1.9, M.z, 0.1, 0.1, 3.2, 1.5);
    }
    // garde-corps bas (laisse le buste visible), toit
    for (const [dx, dz, sx, sz] of [[0, -1.7, 3.6, 0.08], [0, 1.7, 3.6, 0.08], [-1.7, 0, 0.08, 3.6], [1.7, 0, 0.08, 3.6]]) k.wood.box(M.x + dx, my + PH + 0.95, M.z + dz, sx, 0.1, sz, 1.5);
    rgb(k.roof, 0x6e6a5c);
    gable(k, k.roof, null, v3(M.x, my + PH + 2.5, M.z), 4.2, 4.2, 0.9, 0.3, 0.3, 0.07);
    // échelle
    for (let i = 0; i < 12; i++) k.wood.box(M.x + 1.85, my + 0.5 + i * 0.5, M.z + 0.8, 0.06, 0.05, 0.5, 1.5);
    const mirador = v3(M.x, my + PH + 0.07, M.z);
    const miradorYaw = Math.atan2(-M.x, M.z); // face au sommet
    // ponton et barque
    const lakeDir = v3(1180 - M.x, 0, -840 - M.z).normalize();
    for (let i = 1; i < 14; i++) {
      const p = v3(M.x, 0, M.z).addScaledVector(lakeDir, 8 + i * 1.6);
      if (H(p.x, p.z) > LAKE_LEVEL + 1.2) continue;
      k.wood.obox(v3(p.x, LAKE_LEVEL + 0.55, p.z), lakeDir, UP, v3(-lakeDir.z, 0, lakeDir.x), 0.75, 0.05, 1.0, 1.5);
      if (i % 2 === 0) for (const s of [-1, 1]) k.wood.box(p.x - lakeDir.z * s, LAKE_LEVEL - 0.3, p.z + lakeDir.x * s, 0.12, 1.8, 0.12, 1.5);
    }

    // ================= meules de foin, piquets =================
    rgb(k.fabric, 0xc9b06a);
    for (let i = 0; i < 46; i++) {
      const x = -700 + rnd() * 1500, z = -1150 + rnd() * 380;
      const y = H(x, z);
      if (y < 12 || y > 45 || nearRoad(x, z, 9) || terrain.splatAt(x, z, 2) > 0.25 || placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + 4) || Math.hypot(x - V.x, z - V.z) < 60 || inLot(x, z, 8)) continue;
      k.fabric.cyl(x, y - 0.1, z, 0.75, 0.75, 1.25, 10, 1.2, true);
    }

    // ================= matériaux et maillages =================
    kitMeshes(engine, k, tex, col, this.group);

    this.anchors = {
      plate1: v3(SITES.plate1.x, H(SITES.plate1.x, SITES.plate1.z), SITES.plate1.z),
      plate2: v3(SITES.plate2.x, H(SITES.plate2.x, SITES.plate2.z), SITES.plate2.z),
      balloon: v3(SITES.balloon.x, H(SITES.balloon.x, SITES.balloon.z), SITES.balloon.z),
      relayFeed, searchlight, drum, padlock, padlockYaw, gatePivot, gateYaw,
      drone: v3(SITES.drone.x, H(SITES.drone.x, SITES.drone.z) + 62, SITES.drone.z),
      mirador, miradorYaw, market, stalls, chimneys, campfire, camp, church,
    };

    // lac (grand quad) et rivière (ruban)
    this.water = buildWater(engine, this.group, { level: LAKE_LEVEL, lake: { x: 1750, z: -980, w: 2600, d: 1700 }, river: { points: terrain.meta.river, width: RIVER_WIDTH, drape: (x, z) => terrain.meshHeightAt(x, z) } });
    const fl = polar(100, 104);
    buildFlags(engine, wind, this.group, [
      [fl.x + 2.5, H(fl.x + 2.5, fl.z + 1), fl.z + 1, 2.6, 0xc8412f],
      [SITES.plate2.x + 3, H(SITES.plate2.x + 3, SITES.plate2.z + 1), SITES.plate2.z + 1, 3, 0xc8412f],
      [SITES.balloon.x - 3, H(SITES.balloon.x - 3, SITES.balloon.z), SITES.balloon.z, 3, 0xd6a12c],
      [R.x - 5, H(R.x - 5, R.z + 2), R.z + 2, 5, 0xd9d2c2],
      [C.x + 2, campY, C.z + 1, 7, 0x3c5c7a],
      [gate.x + baz.x * -3.4, gate.y + 3.2, gate.z + baz.z * -3.4, 1.4, 0xc8412f],
      [V.x - 22, market.y, V.z - 16, 6, 0xb5463c], [V.x + 23, market.y, V.z - 14, 6, 0x3f6a8c], [V.x + 2, market.y, V.z + 17, 5.5, 0xd9c26a],
      [M.x + 1.9, my + PH + 2.9, M.z - 1.9, 1.8, 0xd9d2c2],
    ]);
  }
}
