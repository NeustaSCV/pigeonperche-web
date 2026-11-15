// Décor du niveau « Le Phare » : la mer et sa houle, le port (quai, grue à portique, hangars, maisons), la barge de
// ravitaillement sur ses pieux, l'îlot de la plaque de réglage, la tourelle de la passe, les fanions (indices de vent).
// Les grands bâtiments (phare, digue, gare maritime, sanatorium) viennent de la banque : data.buildings.
// Bouées, caboteur et canot sont des porteurs de cibles : ils sont créés avec les cibles (targets.ts).
import { Group, Vector3 } from 'three';
import { mulberry32 } from '../../core/noise';
import { buildFlags } from '../../world/flags';
import { Kit, gable, house, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import { Swell, buildSea, type Sea } from '../../world/sea';
import { nearWay } from '../../world/ways';
import { lotDistance } from '../building-lots';
import type { LevelHost } from '../types';
import { BARGE, BARGE_AXIS, BEACON, BUILDINGS, CRANE, ISLET, QUAY, SEA, SEA_LEVEL, SWELL, bargeAt } from './map';
// (les rochers de l'îlot et de la roche de la passe sont ceux de la végétation commune : map.ROCKS)

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export class Coast {
  group = new Group();
  swell = new Swell(SWELL);
  sea!: Sea;

  async build(h: LevelHost): Promise<void> {
    const { engine, terrain, col, wind } = h;
    const tex = await loadKitTextures(engine.q.anisotropy);
    const k = new Kit();
    const rnd = mulberry32(1883);
    const H = (x: number, z: number): number => terrain.heightAt(x, z);

    // ================= la mer =================
    this.sea = buildSea(engine, this.group, { level: SEA_LEVEL, x: SEA.x, z: SEA.z, w: SEA.w, d: SEA.d, swell: this.swell, cell: SEA.cell });

    // ================= le port : quai, bittes, hangars =================
    const Q = QUAY, qx = (Q.x0 + Q.x1) / 2, qw = Q.x1 - Q.x0;
    rgb(k.stone, 0x9a958a);
    k.stone.box(qx, Q.top / 2 - 3, Q.z - 4.5, qw, Q.top + 6, 9.4, 2.6, 0, true);
    rgb(k.stone, 0xb5afa2);
    k.stone.box(qx, Q.top + 0.06, Q.z - 0.5, qw, 0.14, 1.2, 2.6);
    rgb(k.metal, 0x2b2e31);
    for (let x = Q.x0 + 8; x < Q.x1; x += 19) k.metal.cyl(x, Q.top + 0.1, Q.z - 1.3, 0.2, 0.26, 0.5, 8, 1, true);
    // échelles de quai et défenses
    rgb(k.wood, 0x4a4138);
    for (let x = Q.x0 + 14; x < Q.x1; x += 12) k.wood.box(x, 0.6, Q.z + 0.28, 0.5, 3.2, 0.4, 1);
    // hangars de tôle derrière le quai (la gare maritime est plus au nord)
    const SHED = [0x8f9aa0, 0x9a8f7c, 0x6f7f86];
    [[532, -176, 22, 11, 6.5, 0.02], [668, -172, 26, 12, 7.5, -0.03], [612, -166, 16, 8, 5, 0]].forEach(([x, z, w, d, hh, rot], i) => {
      const y = H(x, z) - 0.3;
      rgb(k.metal, SHED[i % SHED.length]);
      k.metal.box(x, y + hh / 2, z, w, hh, d, 3, rot);
      rgb(k.roof, 0x9aa0a2, 0.7);
      gable(k, k.roof, k.metal, v3(x, y + hh, z), w, d, d * 0.16, rot, 0.4, 0.12);
    });
    // caisses du chargement en attente sur le quai
    const CR = [0x4f6a5a, 0x8d6a3f, 0x56606a, 0x9a8250];
    for (let i = 0; i < 9; i++) {
      rgb(k.wood, CR[i % CR.length]);
      k.wood.box(574 + (i % 5) * 2.3, Q.top + 0.65 + (i > 4 ? 1.3 : 0), Q.z - 4.2 - (i % 2) * 1.5, 2, 1.3, 1.4, 1.5, (i % 3) * 0.06);
    }

    // ================= la grue à portique =================
    {
      const C = CRANE, y0 = Q.top, PH = 7.5;
      rgb(k.metal, 0xc9a227);
      for (const [dx, dz] of [[-3, -2.6], [3, -2.6], [3, 2.6], [-3, 2.6]]) k.metal.box(C.x + dx, y0 + PH / 2, C.z + dz, 0.5, PH, 0.5, 1.2);
      k.metal.box(C.x, y0 + PH, C.z - 2.6, 6.5, 0.5, 0.5, 1.2);
      k.metal.box(C.x, y0 + PH, C.z + 2.6, 6.5, 0.5, 0.5, 1.2);
      for (const dx of [-3, 3]) k.metal.box(C.x + dx, y0 + PH, C.z, 0.5, 0.5, 5.7, 1.2);
      for (const dx of [-3, 3]) k.metal.obox(v3(C.x + dx, y0 + PH / 2, C.z), v3(1, 0, 0), v3(0, PH, 5.2).normalize(), v3(0, -5.2, PH).normalize(), 0.09, Math.hypot(PH, 5.2) / 2, 0.09, 1.2);
      // cabine des machines et flèche, tournée vers l'eau
      rgb(k.metal, 0x56606a);
      k.metal.box(C.x, y0 + PH + 1.75, C.z - 0.6, 4.2, 3, 3.6, 1.2);
      rgb(k.glass, 0x161b22);
      k.glass.box(C.x, y0 + PH + 2.2, C.z + 1.23, 2.6, 1.0, 0.06, 1);
      rgb(k.metal, 0xc9a227);
      const j0 = v3(C.x, y0 + PH + 3.2, C.z + 1), j1 = v3(C.x + 2, y0 + C.height, C.z + 15);
      const jd = j1.clone().sub(j0), jl = jd.length();
      jd.divideScalar(jl);
      const js = new Vector3().crossVectors(UP, jd).normalize(), ju = new Vector3().crossVectors(jd, js);
      for (const s of [-1, 1]) k.metal.obox(j0.clone().add(j1).multiplyScalar(0.5).addScaledVector(js, s * 0.55), js, ju, jd, 0.09, 0.09, jl / 2, 1.2);
      for (let i = 1; i < 9; i++) k.metal.obox(j0.clone().addScaledVector(jd, (jl * i) / 9), js, ju, jd, 0.6, 0.05, 0.05, 1.2);
      // câble et moufle
      rgb(k.metal, 0x1c1f22);
      k.metal.box(j1.x, (j1.y + 5.5) / 2, j1.z, 0.05, j1.y - 5.5, 0.05, 1.2);
      k.metal.box(j1.x, 5.2, j1.z, 0.5, 0.7, 0.3, 1.2);
      // treuil au pied du portique, côté ouest : bâti, tambour ; son boîtier de commande est une cible (targets.ts)
      rgb(k.metal, 0x3f5a4a);
      k.metal.box(C.x - 5.4, y0 + 0.5, C.z + 1.6, 2.2, 1.0, 1.6, 1.2);
      rgb(k.metal, 0x24272a);
      k.metal.cyl(C.x - 5.4, y0 + 1.0, C.z + 1.6, 0.55, 0.55, 0.7, 12, 1, true);
      k.metal.box(C.x - 6.2, y0 + 1.0, C.z + 2.9, 0.09, 2.0, 0.09, 1.2);
      // rails du portique
      rgb(k.metal, 0x4a4138);
      for (const dz of [-2.6, 2.6]) k.metal.box(qx, y0 + 0.05, C.z + dz, qw - 6, 0.1, 0.12, 1.2);
    }

    // ================= maisons du port =================
    const others = BUILDINGS.filter((b) => b.id !== 'phare');
    const placed: [number, number, number][] = [];
    let seed = 11;
    for (let i = 0; i < 60 && placed.length < 16; i++) {
      const x = 380 + rnd() * 400, z = -236 - rnd() * 46;
      const w = 8 + rnd() * 5, d = 6 + rnd() * 2, rot = rnd() < 0.7 ? (rnd() - 0.5) * 0.3 : Math.PI / 2 + (rnd() - 0.5) * 0.3;
      if (others.some((b) => lotDistance(b, x, z) < 26) || nearWay(terrain.meta.ways, x, z, 7 + w / 2)) continue;
      if (terrain.meta.road.some((p) => Math.hypot(p[0] - x, p[1] - z) < 12 + w / 2)) continue;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + w * 0.7)) continue;
      placed.push([x, z, w * 0.7]);
      house(k, terrain, x, z, w, d, 3.4 + (rnd() < 0.5 ? 2.7 : 0) + rnd() * 0.5, rot, seed++);
    }

    // ================= la barge de ravitaillement, sur quatre pieux =================
    {
      const B = BARGE, A = BARGE_AXIS;
      const f = v3(A.fx, 0, A.fz), s = v3(-A.fz, 0, A.fx);
      const at = (ls: number, y: number, lf: number): Vector3 => { const p = bargeAt(ls, lf); return v3(p.x, y, p.z); };
      // ponton : caisson d'acier et platelage
      rgb(k.metal, 0x3a3f44);
      k.metal.obox(at(0, B.deck - 0.5, 0), s, UP, f, 2.6, 0.45, 5.4, 1.2);
      rgb(k.wood, 0x8a7a62);
      k.wood.obox(at(0, B.deck - 0.03, 0), s, UP, f, 2.5, 0.03, 5.3, 1);
      rgb(k.wood, 0x4a4138);
      for (const [ls, lf] of [[-2.85, -4.6], [2.85, -4.6], [-2.85, 4.6], [2.85, 4.6]]) { const p = bargeAt(ls, lf); k.wood.cyl(p.x, -4, p.z, 0.26, 0.22, B.deck + 5.6, 8, 1, true); }
      // abri de tôle : fond et deux côtés, ouvert vers le musoir (f = +0,6)
      rgb(k.metal, 0x8f9aa0);
      k.metal.obox(at(0, B.deck + 1.2, -2.6), s, UP, f, 2.3, 1.2, 0.05, 1.2);
      for (const q of [-1, 1]) k.metal.obox(at(q * 2.25, B.deck + 1.2, -1.0), s, UP, f, 0.05, 1.2, 1.6, 1.2);
      rgb(k.metal, 0x767c78);
      k.metal.obox(at(0, B.deck + 2.45, -1.0), s, v3(0, 1, 0), f, 2.5, 0.04, 1.8, 1.2);
      // bidons en réserve (décor), cuve et pompe
      rgb(k.metal, 0x39566b);
      for (const [ls, lf] of [[0.2, -2.0], [0.95, -1.9], [1.6, -2.05], [1.3, -1.2]]) { const p = bargeAt(ls, lf); k.metal.cyl(p.x, B.deck, p.z, 0.3, 0.3, 0.9, 12, 1, true); }
      rgb(k.metal, 0xb9bcc0);
      k.metal.obox(at(0.6, B.deck + 0.75, 3.0), s, UP, f, 0.7, 0.7, 1.5, 1.2);
      rgb(k.metal, 0xb5412f);
      k.metal.obox(at(2.0, B.deck + 0.5, 1.2), s, UP, f, 0.25, 0.5, 0.25, 1.2);
    }

    // ================= la tourelle de la passe : maçonnerie noire et rouge sur sa roche =================
    {
      const B = BEACON;
      rgb(k.plaster, 0x1d1f22);
      k.plaster.cyl(B.x, -0.5, B.z, 2.3, 2.0, 3.4, 14, 2.4, false);
      rgb(k.plaster, 0xa5281f);
      k.plaster.cyl(B.x, 2.9, B.z, 2.0, 1.75, 2.2, 14, 2.4, false);
      rgb(k.plaster, 0x1d1f22);
      k.plaster.cyl(B.x, 5.1, B.z, 1.75, 1.6, 1.9, 14, 2.4, true);
      // plate-forme et garde-corps bas, pied de la lanterne
      rgb(k.metal, 0x2b2e31);
      k.metal.cyl(B.x, 7.0, B.z, 1.85, 1.85, 0.1, 14, 1, true);
      k.metal.cyl(B.x, 7.1, B.z, 0.16, 0.16, B.height - 0.45 - 7.1, 8, 1, true);
    }

    kitMeshes(engine, k, tex, col, this.group);

    // ================= fanions et manches à air : le vent près de chaque cible =================
    const bg = bargeAt(2.4, -5.0);
    buildFlags(engine, wind, this.group, [
      [ISLET.x + 3.2, H(ISLET.x + 3.2, ISLET.z + 1), ISLET.z + 1, 4.5, 0xc8412f],
      [CRANE.x - 9, Q.top, Q.z - 1.6, 6, 0xc8412f],
      [Q.x1 - 6, Q.top, Q.z - 1.6, 6, 0xd9c26a],
      [bg.x, BARGE.deck, bg.z, 4.6, 0xd9c26a],
      [BEACON.x + 1.7, 7.1, BEACON.z, 3.4, 0xc8412f],
    ]);
  }
}
