// Décor du niveau « Le Château d'eau » : rails de la voie ferrée, entrepôts du triage (ils cachent le convoi, sauf
// dans la trouée), collecteur de vannes de l'usine, bourg autour de la médiathèque et du théâtre, fermes, hangars,
// meules, poteaux le long de la voie, fanions et manches à air (le vent près de chaque cible), panaches.
// Les six grands bâtiments viennent de la banque : data.buildings.
import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GeoBuilder } from '../../core/builder';
import { mulberry32 } from '../../core/noise';
import { buildFlags } from '../../world/flags';
import { Kit, gable, house, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import { nearWay } from '../../world/ways';
import { lotDistance } from '../building-lots';
import type { LevelHost } from '../types';
import { BUILDINGS, DECKS, DECK_Y, GAP, PLAIN, POSTS, RAIL_STATION, SHEDS, SIGHTLINES, SIGNAL, SITES, SIZES, TARGETS, localXZ, polar, targetXZ } from './map';

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export class PlainScenery {
  group = new Group();
  /** panaches : torchère et colonnes de l'usine, dépôt de la gare, feux de chaume */
  smokes: { pos: Vector3; kind: 'steam' | 'stack' | 'field' }[] = [];

  async build(h: LevelHost): Promise<void> {
    const { engine, terrain, col, wind } = h;
    const tex = await loadKitTextures(engine.q.anisotropy);
    const k = new Kit();
    const rnd = mulberry32(7717);
    const H = (x: number, z: number): number => terrain.heightAt(x, z);
    const road = terrain.meta.road;
    const ways = terrain.meta.ways;
    const nearRoad = (x: number, z: number, lim: number): boolean => road.some((p) => Math.hypot(p[0] - x, p[1] - z) < lim) || nearWay(ways, x, z, lim);
    const nearSite = (x: number, z: number, pad: number): boolean => Object.values(SITES).some((s) => Math.hypot(x - s.x, z - s.z) < s.r0 + pad);
    const nearLot = (x: number, z: number, pad: number): boolean => BUILDINGS.some((b) => lotDistance(b, x, z) < pad);
    /** hauteur de la ligne de visée la plus basse au-dessus du point (x, z), ou l'infini s'il n'est sous aucune (à `pad` mètres près) */
    const underLine = (x: number, z: number, pad: number): number => {
      let low = Infinity;
      for (const l of SIGHTLINES) {
        const P = POSTS[l.post], dx = l.x - P.x, dz = l.z - P.z, l2 = dx * dx + dz * dz;
        const t = Math.min(1, Math.max(0, ((x - P.x) * dx + (z - P.z) * dz) / l2));
        if (Math.hypot(P.x + dx * t - x, P.z + dz * t - z) > pad + 4 * t) continue;
        low = Math.min(low, DECK_Y + 0.2 + (PLAIN + l.y - DECK_Y - 0.2) * t - PLAIN);
      }
      return low;
    };

    // ================= voie ferrée : deux files de rails sur le ballast du relief, traverses dans le triage =================
    const rail = (ways ?? []).find((w) => w.name === 'voie ferrée');
    const rb = new GeoBuilder();
    const tb = new GeoBuilder();
    if (rail) {
      const L = rail.line;
      const yAt = (x: number, z: number): number => Math.max(H(x, z), terrain.meshHeightAt(x, z));
      const inStation = (x: number, z: number): boolean => x > RAIL_STATION.x0 && x < RAIL_STATION.x1 && Math.abs(z - RAIL_STATION.z) < 30;
      for (let i = 0; i + 1 < L.length; ) {
        // près du triage et du signal : un tronçon par point (4 m) ; ailleurs un sur trois, un sur six au loin
        const near = Math.hypot(L[i][0] - GAP.x, L[i][1] - GAP.z) < 900;
        const far = Math.hypot(L[i][0], L[i][1]) > 3200;
        const j = Math.min(L.length - 1, i + (near ? 1 : far ? 6 : 3));
        const ax = L[i][0], az = L[i][1], bx = L[j][0], bz = L[j][1];
        if (!inStation(ax, az) && !inStation(bx, bz)) {
          const a = v3(ax, yAt(ax, az) + 0.17, az), b = v3(bx, yAt(bx, bz) + 0.17, bz);
          const d = b.clone().sub(a), len = d.length();
          d.divideScalar(len);
          const s = new Vector3().crossVectors(UP, d).normalize(), u = new Vector3().crossVectors(d, s).normalize();
          const mid = a.clone().add(b).multiplyScalar(0.5);
          for (const q of [-0.72, 0.72]) rb.obox(mid.clone().addScaledVector(s, q), s, u, d, 0.045, 0.08, len / 2 + 0.03);
          if (near) for (let t = 0.6; t < len; t += 1.2) tb.obox(a.clone().addScaledVector(d, t).add(v3(0, -0.1, 0)), s, u, d, 1.25, 0.07, 0.13);
        }
        i = j;
      }
    }
    if (rb.pos.length) {
      const m = new Mesh(rb.build(), engine.setupMaterial(new MeshStandardMaterial({ color: 0x6f5a4c, roughness: 0.55, metalness: 0.6 }), undefined, 'plaineRails'));
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (tb.pos.length) {
      const m = new Mesh(tb.build(), engine.setupMaterial(new MeshStandardMaterial({ color: 0x4a3d32, roughness: 0.9 }), undefined, 'plaineTies'));
      m.receiveShadow = true;
      this.group.add(m);
    }

    // ================= triage : deux entrepôts entre la voie et le tireur, une trouée de 22 m, quais, butoirs =================
    const placed: [number, number, number][] = [];
    for (const [zc, len] of SHEDS.list) {
      const x = SHEDS.x, y = H(x, zc) - 0.3;
      rgb(k.metal, zc < GAP.z ? 0x8d979c : 0x9a8f7c);
      k.metal.box(x, y + SHEDS.h / 2, zc, SHEDS.w, SHEDS.h, len, 3);
      rgb(k.roof, 0x9aa0a2, 0.7);
      gable(k, k.roof, k.metal, v3(x, y + SHEDS.h, zc), len, SHEDS.w, 2.1, Math.PI / 2, 0.4, 0.12);
      // portes coulissantes côté tireur, bandeau de quai
      rgb(k.metal, 0x5f6a70);
      for (let u = -len / 2 + 14; u < len / 2 - 8; u += 24) k.metal.box(x - SHEDS.w / 2 - 0.05, y + 2.6, zc + u, 0.1, 4.6, 6, 3);
      rgb(k.plaster, 0xa5a297);
      k.plaster.box(x, y + 0.75, zc, SHEDS.w + 3, 0.9, len + 1, 2.4);
      placed.push([x, zc, len / 2 + 10]);
    }
    // heurtoir au bout de la voie de garage, wagons garés hors de la trouée (décor fixe), grue à portique
    rgb(k.metal, 0x7a4a36);
    k.metal.box(GAP.x + 9, H(GAP.x + 9, GAP.z - 150) + 2.2, GAP.z - 150, 2.8, 3.2, 13, 3);
    rgb(k.metal, 0x4d5a63);
    k.metal.box(GAP.x + 9, H(GAP.x + 9, GAP.z - 166) + 2.2, GAP.z - 166, 2.8, 3.2, 13, 3);
    rgb(k.metal, 0xc9a23a);
    {
      const gx = GAP.x + 16, gz = GAP.z + 210, gy = H(gx, gz);
      for (const s of [-1, 1]) for (const q of [-1, 1]) k.metal.box(gx + s * 7, gy + 7, gz + q * 4, 0.5, 14, 0.5, 2);
      k.metal.box(gx, gy + 14.2, gz, 20, 1.0, 1.2, 2);
      k.metal.box(gx + 3, gy + 12.6, gz, 2.2, 2.2, 2.4, 2);
    }
    placed.push([GAP.x + 16, GAP.z + 210, 16]);

    // ================= collecteur de vannes de l'usine : conduite sur chevalets, trois colonnes =================
    {
      const V = targetXZ('vannes'), T = TARGETS.vannes;
      const los = polar(T.bearing, 1), sd = polar(T.bearing + 90, 1);
      const f = v3(los.x, 0, los.z), s = v3(sd.x, 0, sd.z);
      const gy = H(V.x, V.z);
      const back = v3(V.x, 0, V.z).addScaledVector(f, 0.85);
      const span = SIZES.valve.gap + 2.6;
      // dalle, chevalets de béton
      rgb(k.plaster, 0xa5a297);
      k.plaster.obox(v3(back.x, gy + 0.1, back.z), s, UP, f, span + 1.2, 0.2, 2.2, 2.4);
      for (const q of [-1, 1]) k.plaster.obox(v3(back.x, gy + 1.5, back.z).addScaledVector(s, q * (span - 0.4)), s, UP, f, 0.35, 1.5, 0.6, 2.4);
      // conduite principale (bleue), brides, colonnes montantes jusqu'aux vannes
      rgb(k.metal, 0x2f6f8c);
      k.metal.obox(v3(back.x, gy + 3.2, back.z), s, UP, f, span + 0.6, 0.42, 0.42, 1.2);
      rgb(k.metal, 0x1f4e63);
      for (const q of [-1, 0, 1]) {
        const c = v3(back.x, 0, back.z).addScaledVector(s, q * SIZES.valve.gap);
        k.metal.obox(v3(c.x, gy + (SIZES.valve.y + 3.2) / 2 + 0.2, c.z), s, UP, f, 0.2, (SIZES.valve.y - 3.2) / 2 + 0.55, 0.2, 1.2);
        k.metal.obox(v3(c.x, gy + SIZES.valve.y, c.z).addScaledVector(f, -0.22), s, UP, f, 0.34, 0.34, 0.3, 1.2);
      }
      // conduites qui repartent vers l'usine
      rgb(k.metal, 0x8a8f92);
      for (const q of [-1, 1]) k.metal.obox(v3(back.x, gy + 3.2, back.z).addScaledVector(s, q * (span + 0.2)).addScaledVector(f, 9), s, UP, f, 0.3, 0.3, 9, 1.2);
    }

    // ================= bourg : maisons autour de la médiathèque et du théâtre, le long de l'avenue de la Gare =================
    let seed = 5;
    const tryHouse = (x: number, z: number, w: number, d: number, hh: number, rot: number): boolean => {
      if (nearRoad(x, z, 6 + Math.max(w, d) / 2) || nearSite(x, z, 20) || nearLot(x, z, 12 + Math.max(w, d) / 2)) return false;
      if (underLine(x, z, 10 + Math.max(w, d) / 2) < hh + 9) return false;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + Math.max(w, d) * 0.62)) return false;
      placed.push([x, z, Math.max(w, d) * 0.62]);
      house(k, terrain, x, z, w, d, hh, rot, seed++);
      return true;
    };
    for (const name of ['mediatheque', 'theatre']) {
      const b = BUILDINGS.find((q) => q.name === name)!;
      for (let i = 0; i < 44; i++) {
        const a = rnd() * Math.PI * 2, r = 55 + rnd() * 190;
        tryHouse(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, 8 + rnd() * 6, 6 + rnd() * 2.5, 3.4 + (rnd() < 0.65 ? 2.8 : 0) + rnd() * 0.6, rnd() < 0.5 ? 0.52 : 2.1 + (rnd() - 0.5) * 0.3);
      }
    }
    // maisons de ville le long des rues (un rang de chaque côté, façades sur rue)
    for (const w of ways ?? []) {
      if (w.kind !== 'route' || w.name === 'route de l’usine') continue;
      for (let i = 8; i + 1 < w.line.length - 6; i += 7) {
        const p = w.line[i], q = w.line[i + 1];
        if (Math.hypot(p[0], p[1]) < 520 || rnd() < 0.3) continue;
        const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
        const sd = rnd() < 0.5 ? 1 : -1;
        tryHouse(p[0] + (-dz / l) * sd * 15, p[1] + (dx / l) * sd * 15, 9 + rnd() * 5, 6.5, 3.6 + (rnd() < 0.6 ? 2.8 : 0), Math.atan2(-dz, dx));
      }
    }
    // fermes le long de la route de la plaine
    for (let i = 6; i < road.length - 6; i += 6) {
      const p = road[i], q = road[i + 1];
      if (Math.abs(p[0]) > 3800 || rnd() < 0.4) continue;
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const sd = rnd() < 0.5 ? 1 : -1;
      tryHouse(p[0] + (-dz / l) * sd * 20, p[1] + (dx / l) * sd * 20, 10 + rnd() * 6, 6.5, 3.6 + rnd() * 2.6, Math.atan2(-dz, dx));
    }
    // hangars de tôle : zone d'activité de l'usine, abords du triage et de la gare
    const SHED = [0x8f9aa0, 0x9a8f7c, 0x6f7f86, 0xa39d92, 0x7c6a58];
    const usine = BUILDINGS.find((q) => q.name === 'usine')!, gare = BUILDINGS.find((q) => q.name === 'gare')!;
    const zones: [number, number, number, number][] = [[usine.x - 60, usine.z + 60, 260, 12], [GAP.x + 120, GAP.z, 260, 12], [gare.x + 260, gare.z + 60, 240, 8], [gare.x - 260, gare.z + 40, 220, 6]];
    let si = 0;
    for (const [cx, cz, rad, n] of zones)
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() * 2 - 1) * rad, z = cz + (rnd() * 2 - 1) * rad;
        const w = 24 + rnd() * 26, d = 13 + rnd() * 9, hh = 6 + rnd() * 4, rot = rnd() < 0.6 ? 0.1 : 1.67;
        if (nearRoad(x, z, 9 + w / 2) || nearSite(x, z, 8 + w / 2) || nearLot(x, z, 16 + w / 2) || underLine(x, z, 12 + w / 2) < hh + 10 || placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + w * 0.7)) continue;
        placed.push([x, z, w * 0.7]);
        const y = H(x, z) - 0.4;
        rgb(k.metal, SHED[si++ % SHED.length], 0.9 + rnd() * 0.2);
        k.metal.box(x, y + hh / 2, z, w, hh, d, 3, rot);
        rgb(k.roof, 0x9aa0a2, 0.6 + rnd() * 0.25);
        gable(k, k.roof, k.metal, v3(x, y + hh, z), w, d, d * 0.16, rot, 0.4, 0.12);
      }
    // meules de paille dans les chaumes
    rgb(k.fabric, 0xd2b866);
    for (let i = 0; i < 150; i++) {
      const x = (rnd() * 2 - 1) * 3000, z = (rnd() * 2 - 1) * 3000;
      if (Math.hypot(x, z) < 200 || nearRoad(x, z, 9) || nearSite(x, z, 10) || nearLot(x, z, 20) || terrain.splatAt(x, z, 2) > 0.25 || placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + 4)) continue;
      k.fabric.cyl(x, H(x, z) - 0.1, z, 0.8, 0.8, 1.3, 10, 1.2, true);
    }
    // poteaux télégraphiques le long de la voie, dans le triage (côté opposé au tireur)
    if (rail) {
      rgb(k.wood, 0x4f4338);
      for (let i = 0; i + 1 < rail.line.length; i += 12) {
        const p = rail.line[i], q = rail.line[i + 1];
        if (Math.hypot(p[0] - GAP.x, p[1] - GAP.z) > 1100) continue;
        const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
        // toujours du côté opposé au château d'eau
        const sd = (-dz / l) * p[0] + (dx / l) * p[1] > 0 ? 1 : -1;
        const x = p[0] + (-dz / l) * sd * 6.5, z = p[1] + (dx / l) * sd * 6.5;
        k.wood.box(x, H(x, z) + 3.6, z, 0.2, 7.4, 0.2, 1.5);
        k.wood.box(x, H(x, z) + 6.8, z, 0.12, 0.12, 1.8, 1.5, Math.atan2(dx, dz));
      }
    }
    // passage à niveau de la route de la plaine : deux barrières levées, croix de Saint-André
    {
      const x = GAP.x + 62, z = 850, y = H(x, z);
      rgb(k.metal, 0xd8d2c4);
      for (const s of [-1, 1]) {
        k.metal.box(x + s * 7, y + 1.2, z + s * 6, 0.25, 2.4, 0.25, 1.2);
        k.metal.obox(v3(x + s * 7, y + 4.2, z + s * 6), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 0.07, 3.2, 0.07, 1.2);
      }
    }

    // mât du relais et panneau blanc derrière l'émetteur, sur le toit de la médiathèque. Décor fixe, dans les
    // collisions : une balle qui passe à côté du boîtier s'y arrête (tir manqué), et le télémètre des modes assistés
    // y trouve la bonne distance. Altitude : celle où le jeu pose le bâtiment (sol + marge de src/levels/buildings.ts).
    {
      const D = DECKS.mediatheque, p = localXZ('mediatheque', D.x, D.z);
      const y = PLAIN + 0.03 + Math.min(0.12, Math.hypot(BUILDINGS[1].x, BUILDINGS[1].z) / 9000) + D.y;
      const l = Math.hypot(p.x, p.z), f = v3(-p.x / l, 0, -p.z / l), sd = v3(f.z, 0, -f.x);
      const top = y + SIZES.relay.mast;
      rgb(k.metal, 0x8a8f92);
      k.metal.obox(v3(p.x, (y + top - 0.2) / 2, p.z).addScaledVector(f, -0.42), sd, UP, f, 0.06, (top - 0.2 - y) / 2 + 0.3, 0.06, 1.2);
      rgb(k.plaster, 0xfbf9f2, 1.25);
      k.plaster.obox(v3(p.x, top, p.z).addScaledVector(f, -0.32), sd, UP, f, SIZES.relay.board / 2, SIZES.relay.board / 2, 0.025, 2.4);
    }

    // dépôt des machines, à l'est de la gare : remise de brique et cheminée (sa fumée donne le vent à 2 400 m)
    {
      const d = localXZ('gare', 86, -4), y = H(d.x, d.z);
      rgb(k.plaster, 0x9c6a52);
      k.plaster.box(d.x + 9, y + 3, d.z + 2, 16, 6.4, 9, 3);
      rgb(k.roof, 0x8d8f90, 0.7);
      gable(k, k.roof, k.plaster, v3(d.x + 9, y + 6.2, d.z + 2), 16, 9, 2, 0, 0.4, 0.12);
      rgb(k.stone, 0x9a6a55);
      k.stone.cyl(d.x, y - 0.3, d.z, 1.0, 0.7, 9.6, 10, 2.6, true);
    }

    kitMeshes(engine, k, tex, col, this.group);

    // ================= fanions et manches à air : le vent près de chaque cible =================
    const flagAt = (x: number, z: number, hgt: number, color: number, y?: number): number[] => [x, y ?? H(x, z), z, hgt, color];
    const sideOf = (id: string, off: number, back = 0): { x: number; z: number } => {
      const p = targetXZ(id), s = polar(TARGETS[id].bearing + 90, off), f = polar(TARGETS[id].bearing, back);
      return { x: p.x + s.x + f.x, z: p.z + s.z + f.z };
    };
    const med = localXZ('mediatheque', DECKS.mediatheque.x + 5, DECKS.mediatheque.z);
    const the = localXZ('theatre', 11, DECKS.theatre.z);
    const vn = sideOf('vannes', SIZES.valve.gap + 4.5, 0.85);
    const sg = { x: SIGNAL.x - 3.5, z: SIGNAL.z + 4 };
    const dr = sideOf('drone', 26, -6);
    const ga = localXZ('gare', 30, 20);
    const gw = localXZ('gare', -30, 20);
    buildFlags(engine, wind, this.group, [
      flagAt(med.x, med.z, 4.2, 0xd9541e, PLAIN + DECKS.mediatheque.y),
      flagAt(vn.x, vn.z, 6, 0xc8412f),
      flagAt(sg.x, sg.z, 6, 0xd9c26a),
      flagAt(SHEDS.x, SHEDS.list[0][0] + SHEDS.list[0][1] / 2 - 6, 4.5, 0xc8412f, PLAIN + SHEDS.h + 1.6),
      flagAt(dr.x, dr.z, 9, 0xc8412f),
      flagAt(the.x, the.z, 4.5, 0xd9d2c2, PLAIN + DECKS.theatre.y),
      flagAt(ga.x, ga.z, 10, 0xc8412f), flagAt(gw.x, gw.z, 10, 0xd9c26a),
    ]);

    // ================= panaches =================
    // usine : la torchère (38 m) et une colonne ; dépôt de la gare ; deux feux de chaume
    const us = (lx: number, lz: number): { x: number; z: number } => localXZ('usine', lx, lz);
    const t1 = us(22, -27), t2 = us(-3, -20);
    this.smokes.push({ pos: v3(t1.x, PLAIN + 37.5, t1.z), kind: 'stack' });
    this.smokes.push({ pos: v3(t2.x, PLAIN + 35, t2.z), kind: 'steam' });
    const dep = localXZ('gare', 86, -4);
    this.smokes.push({ pos: v3(dep.x, PLAIN + 9, dep.z), kind: 'stack' });
    for (const [x, z] of [[-1900, -1500], [2300, 1900], [900, -1500]]) this.smokes.push({ pos: v3(x, H(x, z) + 0.4, z), kind: 'field' });
  }
}
