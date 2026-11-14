// Décor lointain du niveau « avancé » : conduite forcée de la station de pompage, ligne à haute tension de la vallée,
// hameaux et hangars de la plaine, meules, cairn de la butte, fanions des cibles, rivière de la plaine (ruban d'eau,
// pont de la route de la rive nord, prise d'eau de la centrale). Les grands bâtiments (aciérie,
// centrale, château d'eau, mine, siège, halte) viennent de la banque : data.buildings.
import { Group, Vector3 } from 'three';
import { hash01, mulberry32 } from '../../core/noise';
import { buildFlags } from '../../world/flags';
import { Kit, gable, house, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import { buildWater } from '../../world/water';
import { buildWayBridges, nearWay } from '../../world/ways';
import type { LevelHost } from '../types';
import { BUILDINGS, DECKS, INTAKE, MOVER, RIVER_WIDTH, SITES, TARGETS, polar, targetXZ } from './map';

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export class Plain {
  group = new Group();
  /** panaches : tour de refroidissement, gueulard du haut fourneau, feux de chaume de la plaine */
  smokes: { pos: Vector3; kind: 'steam' | 'furnace' | 'field' }[] = [];

  async build(h: LevelHost): Promise<void> {
    const { engine, terrain, col, wind } = h;
    const tex = await loadKitTextures(engine.q.anisotropy);
    const k = new Kit();
    const rnd = mulberry32(4410);
    const H = (x: number, z: number): number => terrain.heightAt(x, z);
    const road = terrain.meta.road;
    // route de la plaine et voies secondaires : rien ne se pose sur la chaussée ; ni dans le lit de la rivière
    const river = terrain.meta.river;
    const nearRiver = (x: number, z: number, lim: number): boolean => river.some((p) => Math.hypot(p[0] - x, p[1] - z) < lim + RIVER_WIDTH / 2 + 14);
    const nearRoad = (x: number, z: number, lim: number): boolean => road.some((p) => Math.hypot(p[0] - x, p[1] - z) < lim) || nearWay(terrain.meta.ways, x, z, lim) || nearRiver(x, z, lim);
    const nearSite = (x: number, z: number, pad: number): boolean => Object.values(SITES).some((s) => Math.hypot(x - s.x, z - s.z) < s.r0 + pad);

    // ================= conduite forcée : de la station de pompage au château d'eau =================
    const ch = BUILDINGS.find((b) => b.name === 'chateau')!;
    // enterrée sous le site, elle sort de terre à la chambre des vannes, au bord est de l'éperon
    const pipe: [number, number][] = [[37, 15], [58, 13], [130, 6]];
    for (let i = 1; i <= 44; i++) {
      const u = i / 44;
      pipe.push([130 + (ch.x - 40 - 130) * u, 6 + (ch.z + 30 - 6) * u + Math.sin(u * 9) * 14 * (1 - u)]);
    }
    rgb(k.plaster, 0x9c9a92);
    k.plaster.box(36.5, H(36.5, 15) + 0.5, 15, 2.6, 1.8, 2.6, 2.4);
    col.segs.push({ ax: 36.5, az: 15, bx: 36.51, bz: 15, r: 1.5, y0: H(36.5, 15) - 2, y1: H(36.5, 15) + 1.4 });
    for (let i = 0; i < pipe.length - 1; i++) {
      const [ax, az] = pipe[i], [bx, bz] = pipe[i + 1];
      const a = v3(ax, H(ax, az) + 0.75, az), b = v3(bx, H(bx, bz) + 0.75, bz);
      const d = b.clone().sub(a), len = d.length();
      d.divideScalar(len);
      const side = new Vector3().crossVectors(UP, d).normalize();
      const up = new Vector3().crossVectors(d, side).normalize();
      rgb(k.metal, i % 7 === 3 ? 0x7d4a36 : 0x4b6d63, 0.9 + hash01(i, 7) * 0.2);
      k.metal.obox(a.clone().add(b).multiplyScalar(0.5), side, up, d, 0.42, 0.42, len / 2 + 0.05, 1.2);
      // près du site, la conduite arrête le joueur (on marche maintenant jusqu'au rebord)
      if (Math.hypot(ax, az) < 80) col.segs.push({ ax, az, bx, bz, r: 0.45, y0: Math.min(a.y, b.y) - 2, y1: Math.max(a.y, b.y) + 0.8, box: true });
      // massif d'ancrage en béton à chaque jonction
      rgb(k.plaster, 0x9c9a92);
      k.plaster.box(bx, H(bx, bz) + 0.1, bz, 1.5, 1.3, 1.2, 2.4, Math.atan2(d.x, d.z));
    }

    // ================= ligne à haute tension le long de la vallée =================
    rgb(k.metal, 0x8f9498);
    for (let i = 0; i < 15; i++) {
      // la ligne longe la rive nord de la rivière, 150 m en retrait
      const x = -4200 + i * 600, z = -2860 - 30 * Math.sin(i * 1.3);
      if (nearSite(x, z, 60)) continue;
      const y = H(x, z), PH = 34;
      for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) {
        const a = v3(x + dx, y, z + dz), b = v3(x + dx * 0.25, y + PH, z + dz * 0.25);
        const d = b.clone().sub(a), len = d.length();
        d.divideScalar(len);
        const sx = new Vector3().crossVectors(d, v3(0, 0, 1)).normalize(), sz = new Vector3().crossVectors(sx, d).normalize();
        k.metal.obox(a.add(b).multiplyScalar(0.5), sx, d, sz, 0.14, len / 2, 0.14, 1.2);
      }
      for (let j = 1; j < 6; j++) {
        const w = 6 * (1 - (j / 6) * 0.75);
        k.metal.box(x, y + (j / 6) * PH, z - w / 2, w, 0.12, 0.12, 1.2);
        k.metal.box(x, y + (j / 6) * PH, z + w / 2, w, 0.12, 0.12, 1.2);
        k.metal.box(x - w / 2, y + (j / 6) * PH, z, 0.12, 0.12, w, 1.2);
        k.metal.box(x + w / 2, y + (j / 6) * PH, z, 0.12, 0.12, w, 1.2);
      }
      for (const yy of [PH - 7, PH - 1]) k.metal.box(x, y + yy, z, 0.3, 0.3, 17, 1.2);
    }

    // ================= hameaux de la plaine =================
    const placed: [number, number, number][] = [];
    let seed = 3;
    const tryHouse = (x: number, z: number, w: number, d: number, hh: number, rot: number): void => {
      if (nearRoad(x, z, 7 + Math.max(w, d) / 2) || nearSite(x, z, 26)) return;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + Math.max(w, d) * 0.62)) return;
      placed.push([x, z, Math.max(w, d) * 0.62]);
      house(k, terrain, x, z, w, d, hh, rot, seed++);
    };
    // le bourg, autour du siège de la Compagnie
    const sg = BUILDINGS.find((b) => b.name === 'siege')!;
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, r = 70 + rnd() * 190;
      tryHouse(sg.x + Math.cos(a) * r * 1.25, sg.z + Math.sin(a) * r * 0.8, 8 + rnd() * 6, 6 + rnd() * 2.5, 3.4 + (rnd() < 0.6 ? 2.8 : 0) + rnd() * 0.6, rnd() < 0.5 ? 0 : Math.PI / 2 + (rnd() - 0.5) * 0.3);
    }
    // fermes le long de la route
    for (let i = 6; i < road.length - 6; i += 5) {
      const p = road[i], q = road[i + 1];
      if (Math.abs(p[0]) > 3600 || rnd() < 0.35) continue;
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const side = rnd() < 0.5 ? 1 : -1;
      tryHouse(p[0] + (-dz / l) * side * 19, p[1] + (dx / l) * side * 19, 9 + rnd() * 5, 6.5, 3.6 + rnd() * 2.6, Math.atan2(-dz, dx));
    }
    // hangars de tôle de la zone industrielle, entre l'aciérie et la centrale
    const SHED = [0x8f9aa0, 0x9a8f7c, 0x6f7f86, 0xa39d92, 0x7c6a58];
    for (let i = 0; i < 22; i++) {
      const x = 80 + rnd() * 1100, z = -1650 - rnd() * 950;
      const w = 26 + rnd() * 30, d = 14 + rnd() * 10, hh = 6 + rnd() * 5, rot = rnd() < 0.7 ? 0.14 : 1.71;
      if (nearRoad(x, z, 8 + w / 2) || nearSite(x, z, 40 + w / 2) || placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + w * 0.7)) continue;
      placed.push([x, z, w * 0.7]);
      const y = H(x, z) - 0.4;
      rgb(k.metal, SHED[i % SHED.length], 0.9 + rnd() * 0.2);
      k.metal.box(x, y + hh / 2, z, w, hh, d, 3, rot);
      rgb(k.roof, 0x9aa0a2, 0.6 + rnd() * 0.25);
      gable(k, k.roof, k.metal, v3(x, y + hh, z), w, d, d * 0.16, rot, 0.4, 0.12);
    }
    // meules de paille dans les champs
    rgb(k.fabric, 0xcbb267);
    for (let i = 0; i < 90; i++) {
      const x = -2600 + rnd() * 5200, z = -900 - rnd() * 1900;
      if (nearRoad(x, z, 9) || nearSite(x, z, 30) || terrain.splatAt(x, z, 2) > 0.25 || placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + 4)) continue;
      const y = H(x, z);
      if (y > 612) continue;
      k.fabric.cyl(x, y - 0.1, z, 0.8, 0.8, 1.3, 10, 1.2, true);
    }

    // ================= rivière : pont de la rive nord, fermes au bout de la route, prise d'eau de la centrale =================
    buildWayBridges(k, terrain);
    const north = (terrain.meta.ways ?? []).find((w) => w.bridges?.length);
    if (north) {
      const e = north.line[north.line.length - 1];
      for (const [dx, dz, w, rot] of [[-22, -6, 13, 0.2], [20, -16, 11, 1.5], [-14, 26, 10, 1.7], [26, 18, 12, 0.1]]) tryHouse(e[0] + dx, e[1] + dz, w, 6.5, 3.6 + rnd() * 2.4, rot);
    }
    // station de pompage sur la rive sud : local de béton, deux conduites jusqu'au pied de la tour, crépine dans l'eau
    {
      const I = INTAKE;
      const iy = H(I.x, I.z);
      rgb(k.plaster, 0x9c9a92);
      k.plaster.box(I.x, iy + 2.1, I.z, 9, 4.6, 6, 2.4, 0.12);
      rgb(k.metal, 0x596066);
      k.metal.box(I.x, iy + 4.5, I.z, 9.6, 0.16, 6.6, 1.2, 0.12);
      const d = v3(I.tx - I.x, 0, I.tz - I.z), len = d.length();
      d.divideScalar(len);
      const side = new Vector3().crossVectors(UP, d).normalize();
      const N2 = Math.ceil(len / 12);
      for (const q of [-1.1, 1.1]) {
        for (let i = 0; i < N2; i++) {
          const a = v3(I.x, 0, I.z).addScaledVector(d, (len * i) / N2).addScaledVector(side, q), b = v3(I.x, 0, I.z).addScaledVector(d, (len * (i + 1)) / N2).addScaledVector(side, q);
          a.y = H(a.x, a.z) + 0.7;
          b.y = H(b.x, b.z) + 0.7;
          const dd = b.clone().sub(a), l = dd.length();
          dd.divideScalar(l);
          const up = new Vector3().crossVectors(dd, side).normalize();
          rgb(k.metal, 0x4b6d63, 0.9 + hash01(i, 11) * 0.2);
          k.metal.obox(a.clone().add(b).multiplyScalar(0.5), side, up, dd, 0.45, 0.45, l / 2 + 0.05, 1.2);
        }
        // conduite d'aspiration : du local à l'eau
        const w0 = v3(I.x, iy + 0.9, I.z).addScaledVector(side, q), w1 = v3(I.x, 0, I.z).addScaledVector(d, -24).addScaledVector(side, q);
        w1.y = terrain.waterSurfaceAt(w1.x, w1.z) > -1e8 ? terrain.waterSurfaceAt(w1.x, w1.z) - 0.4 : H(w1.x, w1.z);
        const dd = w1.clone().sub(w0), l = dd.length();
        dd.divideScalar(l);
        k.metal.obox(w0.clone().add(w1).multiplyScalar(0.5), side, new Vector3().crossVectors(dd, side).normalize(), dd, 0.45, 0.45, l / 2, 1.2);
      }
      rgb(k.plaster, 0x9c9a92);
      for (let i = 1; i < N2; i++) { const a = v3(I.x, 0, I.z).addScaledVector(d, (len * i) / N2); k.plaster.box(a.x, H(a.x, a.z) + 0.1, a.z, 3.4, 1.2, 1.2, 2.4, Math.atan2(d.x, d.z) + Math.PI / 2); }
    }

    // ================= cairn et borne de la butte, panneau de la cible mobile =================
    const mile = targetXZ('mile');
    rgb(k.stone, 0xb5ad9c);
    k.stone.cyl(mile.x + 9, H(mile.x + 9, mile.z + 6) - 0.2, mile.z + 6, 1.1, 0.5, 2.2, 9, 2.6, true);
    k.stone.box(mile.x - 8, H(mile.x - 8, mile.z - 5) + 0.5, mile.z - 5, 0.5, 1.4, 0.5, 2.6, 0.4);

    kitMeshes(engine, k, tex, col, this.group);

    // ================= rivière : ruban drapé sur le maillage du relief (elle est à 2 600 m, mailles de 40 m) =================
    const water = buildWater(engine, this.group, { level: 0, lake: null, river: { points: river, width: RIVER_WIDTH, drape: (x, z) => terrain.meshHeightAt(x, z) } });
    // vue du rebord sous 7°, l'eau ne renvoyait que le ciel voilé de l'horizon (un ruban blanc, comme une route) :
    // reflet atténué, eau verte et un peu trouble des rivières de pays calcaire
    water.color.set(0x2a565c);
    water.envMapIntensity = 0.5;
    water.roughness = 0.2;

    // ================= fanions : le vent près de chaque cible au sol =================
    const flag = (id: string, off: number, hgt: number, color: number): number[] => {
      const p = targetXZ(id), s = polar(TARGETS[id].bearing + 90, off);
      const x = p.x + s.x, z = p.z + s.z;
      return [x, H(x, z), z, hgt, color];
    };
    buildFlags(engine, wind, this.group, [
      flag('zero', 3.5, 4.5, 0xc8412f),
      flag('mover', MOVER.length / 2 + 1.2, 6, 0xc8412f), flag('mover', -(MOVER.length / 2 + 1.2), 6, 0xd9c26a),
      flag('mile', 5, 7, 0xc8412f),
      flag('deuxMille', 6, 8, 0xc8412f),
      flag('extreme', 7, 9, 0xc8412f), flag('extreme', -7, 9, 0xd9c26a),
    ]);

    // ================= panaches =================
    const world = (name: string, lx: number, ly: number, lz: number): Vector3 => {
      const b = BUILDINGS.find((s) => s.name === name)!;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      return v3(b.x + lx * c + lz * s, b.groundY + ly, b.z - lx * s + lz * c);
    };
    this.smokes.push({ pos: world('centrale', 59.5, 64, -19.5), kind: 'steam' });
    this.smokes.push({ pos: world('fourneau', DECKS.fourneau.x, 54, DECKS.fourneau.z - 6), kind: 'furnace' });
    for (const [x, z] of [[-1650, -1120], [1500, -1250], [-300, -2500], [2300, -2150]]) this.smokes.push({ pos: v3(x, H(x, z) + 0.4, z), kind: 'field' });
  }
}
