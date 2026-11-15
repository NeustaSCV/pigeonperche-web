// Décor du niveau « fete » : la mer et son liseré d'écume, la digue-promenade et ses cabines de plage, l'esplanade
// de la fête (baraques, grande roue des cibles, manège des silhouettes, mâts de la guirlande, portique), le bourg
// derrière les lots, les fanions. Les grands édifices (Grand Hôtel, parc d'attractions, piscine, faubourg) viennent
// de la banque de bâtiments : ils sont déclarés dans data.buildings et posés par le jeu.
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Engine } from '../../core/engine';
import { hash01, mulberry32 } from '../../core/noise';
import { FairCarousel, FairWheel, StepRotation } from '../../game/extra/fair';
import type { Colliders } from '../../world/colliders';
import { buildFlags } from '../../world/flags';
import { Kit, gable, house, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import { buildSea, type Sea } from '../../world/sea';
import type { Terrain } from '../../world/terrain';
import { nearWay } from '../../world/ways';
import type { Wind } from '../../world/wind';
import { lotDistance } from '../building-lots';
import { BASE_Y, BOULEVARD_X, BUILDINGS, CAROUSEL, DECK, GARLAND, HOTEL_AREA, PLATES, PROMENADE, SEA, SHORE_X, STALLS, STRIKER, WHEEL } from './map';

const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface Anchors {
  plate1: Vector3;
  plate2: Vector3;
  /** points d'accroche des six ballons, de gauche à droite */
  balloons: Vector3[];
  striker: Vector3;
  /** globes de la guirlande, de gauche à droite */
  bulbs: Vector3[];
}

/** Bord de l'eau : où finit le liseré et où commence la nappe de mer. */
const SEA_X = SHORE_X - 9;

/** Cap (lacet Three.js) qui tourne l'axe +z local vers le site de tir, à l'origine. */
const faceSite = (x: number, z: number): number => Math.atan2(-x, -z);

export class Seafront {
  group = new Group();
  anchors!: Anchors;
  wheel!: FairWheel;
  carousel!: FairCarousel;
  private seas: Sea[] = [];

  /** Temps de jeu : houle et clapot de la mer, rotation de la grande roue. */
  setTime(t: number): void {
    for (const s of this.seas) s.setTime(t);
    this.wheel.setTime(t);
    this.carousel.setTime(t);
  }

  async build(engine: Engine, terrain: Terrain, col: Colliders, wind: Wind): Promise<void> {
    const tex = await loadKitTextures(engine.q.anisotropy);
    const k = new Kit();
    const rnd = mulberry32(1903);
    const H = (x: number, z: number): number => terrain.heightAt(x, z);
    const inLot = (x: number, z: number, m: number): boolean => BUILDINGS.some((b) => (b.name === 'hotel' ? x > HOTEL_AREA.x0 - m && x < HOTEL_AREA.x1 + m && z > HOTEL_AREA.z0 - m && z < HOTEL_AREA.z1 + m : lotDistance(b, x, z) < m));

    // ================= la mer =================
    // nappe plane (houle nulle) du liseré jusqu'à l'horizon, à l'ouest ; elle recouvre le rectangle de mer du modèle
    this.seas.push(buildSea(engine, this.group, { level: SEA, x: (SEA_X - 14000) / 2, z: 0, w: 14000 + SEA_X, d: 28000, swell: null, horizon: 0, color: 0x1f5562 }));
    // au-delà du disque du relief (2 200 m), la côte tourne : un plan d'eau un peu plus bas ferme l'horizon au nord et au sud
    const far = buildSea(engine, this.group, { level: SEA - 0.6, x: 0, z: 0, w: 3000, d: 3000, swell: null, horizon: 14000, color: 0x1f5562 });
    far.mesh.visible = false;
    this.seas.push(far);
    // la mer peinte du modèle de l'hôtel est quelques centimètres sous la nappe : celle-ci gagne toujours en profondeur
    for (const s of this.seas) { s.material.polygonOffset = true; s.material.polygonOffsetFactor = -2; s.material.polygonOffsetUnits = -6; }
    this.buildShore(engine);

    // ================= la digue : dalle, muret côté plage, réverbères, bancs =================
    const P = PROMENADE;
    const py = (z: number): number => H((P.x0 + P.x1) / 2, z) + 0.06;
    rgb(k.stone, 0xb9b3a6);
    for (let z = P.z1; z > P.z0; z -= 30) {
      const z0 = Math.max(P.z0, z - 30), y = Math.max(py(z), py(z0));
      k.stone.box((P.x0 + P.x1) / 2, y - 0.2, (z + z0) / 2, P.x1 - P.x0, 0.5, z - z0, 2.6);
      // muret blanc côté mer, avec un passage vers la plage tous les 30 m
      rgb(k.stone, 0xe6dfcf);
      k.stone.box(P.x0 + 0.15, y + 0.42, (z + z0) / 2 - 1.6, 0.34, 0.8, z - z0 - 3.2, 2.6);
      rgb(k.stone, 0xb9b3a6);
    }
    rgb(k.metal, 0x3c4a4a);
    for (let z = P.z1 - 12; z > P.z0; z -= 36) {
      const y = py(z);
      k.metal.box(P.x1 - 0.3, y + 2.3, z, 0.1, 4.6, 0.1, 1.2);
      k.metal.box(P.x1 - 0.7, y + 4.55, z, 0.9, 0.07, 0.09, 1.2);
      rgb(k.glass, 0xe8e2c8);
      k.glass.box(P.x1 - 1.1, y + 4.4, z, 0.24, 0.3, 0.24, 1);
    }
    rgb(k.wood, 0x3f6f6a);
    for (let z = P.z1 - 30; z > P.z0; z -= 36) {
      const y = py(z);
      k.wood.box(P.x1 - 0.45, y + 0.45, z, 0.45, 0.06, 1.8, 1.5);
      k.wood.box(P.x1 - 0.25, y + 0.75, z, 0.06, 0.5, 1.8, 1.5);
      for (const dz of [-0.8, 0.8]) k.wood.box(P.x1 - 0.45, y + 0.22, z + dz, 0.4, 0.44, 0.07, 1.5);
    }
    // ================= cabines de plage rayées, en rang au pied de la digue =================
    const CAB = [0xc8412f, 0x2f6f9a, 0xd6a12c, 0x3f8f6a, 0xe9e4d6];
    for (let i = 0; i < 26; i++) {
      const z = -66 - i * 3.1 - Math.floor(i / 6) * 9;
      if (i % 9 === 7) continue;
      const x = P.x0 - 3.4, y = H(x, z);
      rgb(k.plaster, i % 2 ? 0xe9e4d6 : CAB[i % CAB.length]);
      k.plaster.box(x, y + 1.05, z, 2.0, 2.1, 2.2, 1.5);
      rgb(k.wood, CAB[(i * 3) % CAB.length]);
      k.wood.box(x - 1.01, y + 0.95, z, 0.04, 1.75, 0.8, 1.5);
      rgb(k.roof, i % 2 ? CAB[i % CAB.length] : 0xe9e4d6, 0.9);
      gable(k, k.roof, k.plaster, v3(x, y + 2.1, z), 2.2, 2.3, 0.7, 0, 0.18, 0.06);
    }

    // ================= plaques de réglage : pieux et talus de sable =================
    const P2 = PLATES.p2;
    rgb(k.fabric, 0xd9c79a);
    k.fabric.cyl(P2.x + 0.4, H(P2.x, P2.z - 2.6) - 0.1, P2.z - 2.6, 2.2, 0.5, 1.5, 9, 2, true);

    // ================= les baraques : trois stands en rang, auvents rayés =================
    const S = STALLS;
    const balloons: Vector3[] = [];
    S.xs.forEach((sx, si) => {
      const y = H(sx, S.z), c = S.colors[si];
      // caisse de bois ouverte au sud : fond, côtés, comptoir
      rgb(k.plaster, 0xe9e4d6);
      k.plaster.box(sx, y + S.h / 2, S.z - S.d / 2, S.w, S.h, 0.1, 1.5);
      for (const q of [-1, 1]) k.plaster.box(sx + (q * S.w) / 2, y + S.h / 2, S.z, 0.1, S.h, S.d, 1.5);
      rgb(k.plaster, c);
      k.plaster.box(sx, y + 0.5, S.z + S.d / 2, S.w, 1.0, 0.12, 1.5);
      k.plaster.box(sx, y + 1.03, S.z + S.d / 2 + 0.1, S.w + 0.1, 0.06, 0.5, 1.5);
      // fronton peint et toit de toile rayée, en pente vers l'avant
      k.plaster.box(sx, y + S.h + 0.45, S.z + S.d / 2 + 0.55, S.w + 0.5, 0.9, 0.08, 1.5);
      const stripes = 8;
      for (let i = 0; i < stripes; i++) {
        rgb(k.fabric, i % 2 ? c : 0xf0e9d8);
        const px = sx - S.w / 2 - 0.25 + ((i + 0.5) * (S.w + 0.5)) / stripes;
        k.fabric.obox(v3(px, y + S.h + 0.12, S.z + 0.25), v3(1, 0, 0), v3(0, 0.99, 0.12).normalize(), v3(0, -0.12, 0.99).normalize(), (S.w + 0.5) / stripes / 2, 0.03, S.d / 2 + 0.75, 1.5);
      }
      // lots sur les étagères du fond
      for (let i = 0; i < 9; i++) {
        rgb(k.wood, [0xd6a12c, 0xc8412f, 0x2f6f9a, 0xecebe6][i % 4]);
        k.wood.box(sx - S.w / 2 + 0.5 + (i % 5) * 0.8, y + 1.25 + Math.floor(i / 5) * 0.7, S.z - S.d / 2 + 0.28, 0.34, 0.34, 0.3, 1.5);
      }
      // la barre des ballons, au-dessus du fronton
      rgb(k.metal, 0x3a3d40);
      const by = y + S.balloonY;
      k.metal.box(sx, by - 0.02, S.z + S.d / 2 + 0.55, S.w + 0.3, 0.05, 0.05, 1.2);
      for (const q of [-1, 1]) {
        k.metal.box(sx + q * (S.w / 2 + 0.1), by - 0.4, S.z + S.d / 2 + 0.55, 0.05, 0.8, 0.05, 1.2);
        balloons.push(v3(sx + q * 1.15, by, S.z + S.d / 2 + 0.55));
      }
    });
    balloons.sort((a, b) => a.x - b.x);
    // guirlandes de fanions entre les stands et deux mâts
    this.bunting(k, v3(S.xs[0] - 6, H(S.xs[0] - 6, S.z) + 6, S.z + 2), v3(S.xs[2] + 6, H(S.xs[2] + 6, S.z) + 6, S.z + 2), 26, true);

    // ================= portique de la fête, au bord de l'esplanade =================
    {
      const gx = 2, gz = -90, y = H(gx, gz);
      rgb(k.plaster, 0xc8412f);
      for (const q of [-1, 1]) k.plaster.box(gx + q * 5, y + 3, gz, 0.5, 6, 0.5, 1.5);
      rgb(k.plaster, 0xf0e9d8);
      k.plaster.box(gx, y + 6.3, gz, 11.4, 1.3, 0.3, 1.5);
      rgb(k.plaster, 0xd6a12c);
      for (let i = 0; i < 9; i++) k.plaster.box(gx - 4.4 + i * 1.1, y + 6.3, gz + 0.17, 0.6, 0.6, 0.06, 1.5);
      this.bunting(k, v3(gx - 5, y + 5.6, gz), v3(P.x1, py(gz) + 4.5, gz), 14, false);
      this.bunting(k, v3(gx + 5, y + 5.6, gz), v3(BOULEVARD_X - 4, H(BOULEVARD_X - 4, gz) + 4.5, gz), 12, true);
      rgb(k.metal, 0x3c4a4a);
      k.metal.box(BOULEVARD_X - 4, H(BOULEVARD_X - 4, gz) + 2.25, gz, 0.1, 4.5, 0.1, 1.2);
    }

    // ================= clôture basse et caisse de la grande roue, du manège =================
    {
      const W = WHEEL, y = H(W.x, W.z);
      rgb(k.wood, 0xe9e4d6);
      const fence = (ax: number, az: number, bx: number, bz: number): void => {
        const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2);
        const rot = Math.atan2(-(bz - az), bx - ax);
        for (let i = 0; i <= n; i++) k.wood.box(ax + ((bx - ax) * i) / n, y + 0.5, az + ((bz - az) * i) / n, 0.08, 1.0, 0.08, 1.5);
        for (const hy of [0.45, 0.9]) k.wood.box((ax + bx) / 2, y + hy, (az + bz) / 2, len, 0.06, 0.04, 1.5, rot);
      };
      fence(W.x - 13, W.z + 5, W.x - 13, W.z - 5);
      fence(W.x + 13, W.z + 5, W.x + 13, W.z - 5);
      fence(W.x - 13, W.z - 5, W.x + 13, W.z - 5);
      // guérite du forain
      rgb(k.wood, 0x2f6f9a);
      k.wood.box(W.x + 14.6, y + 1.2, W.z + 3.4, 1.6, 2.4, 1.6, 1.5);
      rgb(k.roof, 0xc8412f, 0.9);
      gable(k, k.roof, k.wood, v3(W.x + 14.6, y + 2.4, W.z + 3.4), 1.9, 1.9, 0.6, 0, 0.15, 0.06);
    }
    this.wheel = new FairWheel(engine, {
      base: v3(WHEEL.x, H(WHEEL.x, WHEEL.z), WHEEL.z), hub: WHEEL.hub, radius: WHEEL.r, cabins: WHEEL.cabins,
      yaw: faceSite(WHEEL.x, WHEEL.z), rotation: new StepRotation(WHEEL.cabins, WHEEL.move, WHEEL.hold),
    });
    this.group.add(this.wheel.group);
    this.carousel = new FairCarousel(engine, { base: v3(CAROUSEL.x, H(CAROUSEL.x, CAROUSEL.z), CAROUSEL.z), radius: CAROUSEL.r, yaw: faceSite(CAROUSEL.x, CAROUSEL.z) });
    this.group.add(this.carousel.group);
    // collisions : les chevalets de la roue et le fût du manège arrêtent les balles
    this.wheel.group.updateMatrixWorld(true);
    this.wheel.group.children[0] && col.addMesh(this.wheel.group.children[0] as Mesh, 'metal');
    this.carousel.group.updateMatrixWorld(true);
    this.carousel.group.traverse((o) => { if ((o as Mesh).isMesh) col.addMesh(o as Mesh, 'wood'); });

    // ================= mâts et fil de la guirlande =================
    const G = GARLAND;
    const gy = H((G.mastX[0] + G.mastX[1]) / 2, G.z);
    rgb(k.metal, 0x3c4a4a);
    for (const mx of G.mastX) {
      k.metal.box(mx, gy + (G.y + 1.2) / 2, G.z, 0.14, G.y + 1.2, 0.14, 1.2);
      k.metal.box(mx, gy + 0.2, G.z, 0.7, 0.4, 0.7, 1.2);
    }
    const bulbs: Vector3[] = [];
    {
      // le fil pend un peu entre les mâts : les globes suivent sa flèche
      const x0 = G.mastX[0], x1 = G.mastX[1], top = gy + G.y + 0.95;
      const sag = (x: number): number => { const u = (x - x0) / (x1 - x0); return top - 2.2 * 4 * u * (1 - u) * 0.3; };
      const n = 14;
      for (let i = 0; i < n; i++) {
        const ax = x0 + ((x1 - x0) * i) / n, bx = x0 + ((x1 - x0) * (i + 1)) / n;
        const a = v3(ax, sag(ax), G.z), b = v3(bx, sag(bx), G.z);
        const dir = b.clone().sub(a);
        const len = dir.length();
        dir.normalize();
        k.metal.obox(a.clone().add(b).multiplyScalar(0.5), dir, new Vector3().crossVectors(v3(0, 0, 1), dir).normalize(), v3(0, 0, 1), len / 2, 0.012, 0.012, 1.2);
      }
      for (const bx of G.xs) bulbs.push(v3(bx, sag(bx) - G.r * 1.6, G.z));
    }

    // ================= le bourg, derrière les lots : maisons basses à pignon =================
    let seed = 7;
    const placed: [number, number, number][] = [];
    const tryHouse = (x: number, z: number, w: number, d: number, hgt: number, rot: number): void => {
      const rad = Math.max(w, d) * 0.62;
      if (inLot(x, z, rad + 3) || nearWay(terrain.meta.ways, x, z, 4 + Math.min(w, d) / 2)) return;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + rad)) return;
      placed.push([x, z, rad]);
      house(k, terrain, x, z, w, d, hgt, rot, seed++);
    };
    // une rue parallèle au boulevard, 85 m plus à l'est, et quelques maisons au nord
    for (let z = -500; z < 150; z += 13) {
      for (const sx of [112, 132]) {
        if (rnd() < 0.25) continue;
        tryHouse(sx + rnd() * 5, z + rnd() * 3, 8 + rnd() * 4, 6 + rnd() * 2, rnd() < 0.4 ? 6.2 : 3.8, Math.PI / 2 + (rnd() - 0.5) * 0.1);
      }
    }
    for (let i = 0; i < 46; i++) tryHouse(60 + rnd() * 190, -640 + rnd() * 170, 8 + rnd() * 5, 6 + rnd() * 2, rnd() < 0.45 ? 6.2 : 3.8, rnd() * 3.1);
    for (let i = 0; i < 30; i++) tryHouse(150 + rnd() * 120, -460 + rnd() * 560, 8 + rnd() * 5, 6 + rnd() * 2, rnd() < 0.3 ? 6.2 : 3.8, rnd() * 3.1);
    void hash01;

    kitMeshes(engine, k, tex, col, this.group);

    // ================= fanions : le peu de vent qu'il y a se lit ici =================
    const P1 = PLATES.p1;
    buildFlags(engine, wind, this.group, [
      [P1.x + 2.2, H(P1.x + 2.2, P1.z), P1.z + 0.6, 2.6, 0xc8412f],
      [P2.x + 2.6, H(P2.x + 2.6, P2.z), P2.z + 0.6, 3, 0xc8412f],
      [S.xs[0] - 6, H(S.xs[0] - 6, S.z), S.z + 2, 6.4, 0xd6a12c],
      [S.xs[2] + 6, H(S.xs[2] + 6, S.z), S.z + 2, 6.4, 0xd6a12c],
      [STRIKER.x + 3, H(STRIKER.x + 3, STRIKER.z), STRIKER.z, 4, 0xc8412f],
      [G.mastX[0], gy + G.y + 1.2, G.z, 1.6, 0x2f6f9a], [G.mastX[1], gy + G.y + 1.2, G.z, 1.6, 0x2f6f9a],
      // manche à air de la terrasse
      [DECK.x0, BASE_Y + 2.6, DECK.z0, 1.2, 0xd6a12c],
    ]);

    this.anchors = {
      plate1: v3(P1.x, H(P1.x, P1.z), P1.z),
      plate2: v3(P2.x, H(P2.x, P2.z), P2.z),
      balloons,
      striker: v3(STRIKER.x, H(STRIKER.x, STRIKER.z), STRIKER.z),
      bulbs,
    };
  }

  /** Corde de fanions triangulaires entre deux points (toile de couleur). */
  private bunting(k: Kit, a: Vector3, b: Vector3, n: number, alt: boolean): void {
    const COL = [0xc8412f, 0xf0e9d8, 0x2f6f9a, 0xd6a12c];
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const side = new Vector3().crossVectors(v3(0, 1, 0), dir).normalize();
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const p = a.clone().lerp(b, u);
      p.y -= 4 * u * (1 - u) * len * 0.06;
      rgb(k.fabric, COL[(i + (alt ? 1 : 0)) % COL.length]);
      const w = (len / n) * 0.36;
      k.fabric.quad(p.clone().addScaledVector(dir, -w), p.clone().addScaledVector(dir, w), p.clone().add(v3(0, -w * 2.2, 0)), p.clone().add(v3(0, -w * 2.2, 0)), side, [0, 0, 1, 0, 0.5, 1, 0.5, 1]);
    }
  }

  /**
   * Liseré du rivage : l'eau claire sur le sable, la ligne d'écume, puis l'eau qui fonce jusqu'à la nappe de mer.
   * Mêmes bandes et mêmes teintes que la mer peinte du Grand Hôtel, qu'il recouvre : le rivage est le même tout le
   * long de la côte, sans couture au bord du modèle.
   */
  private buildShore(engine: Engine): void {
    const bands: [number, number, number, number][] = [
      // x côté terre, x côté large, teinte côté terre, teinte côté large
      [SHORE_X, SHORE_X - 1.5, 0xa9d6c4, 0x8fcbbd],
      [SHORE_X - 1.5, SHORE_X - 3.2, 0x8fcbbd, 0x5ba7a6],
      [SHORE_X - 3.2, SHORE_X - 3.8, 0xe6efe9, 0xe6efe9],
      [SHORE_X - 3.8, SHORE_X - 5.4, 0x3d7c84, 0x2f6874],
      [SHORE_X - 5.4, SEA_X, 0x2f6874, 0x1f5562],
    ];
    const pos: number[] = [], colr: number[] = [], nrm: number[] = [];
    const L = 2400, STEP = 400;
    const c = (hex: number): [number, number, number] => { const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255; return [r ** 2.2, g ** 2.2, b ** 2.2]; };
    for (const [xa, xb, ca, cb] of bands) {
      const A = c(ca), B = c(cb);
      for (let z = -L; z < L; z += STEP) {
        const q: [number, number, [number, number, number]][] = [[xa, z, A], [xb, z, B], [xa, z + STEP, A], [xa, z + STEP, A], [xb, z, B], [xb, z + STEP, B]];
        for (const [x, zz, cc] of q) { pos.push(x, 0, zz); colr.push(...cc); nrm.push(0, 1, 0); }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(colr), 3));
    const mat = engine.setupMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }), undefined, 'feteshore');
    const m = new Mesh(g, mat);
    m.position.y = SEA + 0.005;
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.group.add(m);
  }
}
