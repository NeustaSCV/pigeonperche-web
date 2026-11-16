// Kit de construction du décor : bâtisseurs de géométrie par matière, maisons, toits, tentes.
// Commun à tous les niveaux ; chaque décor (src/levels/<id>/scenery.ts) remplit un Kit puis appelle kitMeshes().
import { Color, DoubleSide, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GeoBuilder } from '../core/builder';
import { loadTexSet, type TexSet } from '../core/assets';
import type { Engine } from '../core/engine';
import { hash01 } from '../core/noise';
import type { Colliders } from './colliders';
import type { Terrain } from './terrain';

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export class Kit {
  plaster = new GeoBuilder();
  roof = new GeoBuilder();
  stone = new GeoBuilder();
  wood = new GeoBuilder();
  metal = new GeoBuilder();
  fabric = new GeoBuilder();
  glass = new GeoBuilder();
  constructor() {
    for (const b of [this.plaster, this.roof, this.stone, this.wood, this.metal, this.fabric, this.glass]) b.useColor = true;
  }
}

export function rgb(b: GeoBuilder, hex: number, k = 1): void {
  const c = new Color(hex);
  b.color = [c.r * k, c.g * k, c.b * k];
}

/** Toit à deux pans : faîtage le long de l'axe X local. */
export function gable(k: Kit, roofB: GeoBuilder, wallB: GeoBuilder | null, c: Vector3, w: number, d: number, rise: number, rot: number, over = 0.35, thick = 0.1): void {
  const ax = v3(Math.cos(rot), 0, -Math.sin(rot));
  const fz = v3(Math.sin(rot), 0, Math.cos(rot));
  for (const s of [-1, 1]) {
    const down = fz.clone().multiplyScalar(s * (d / 2)).add(v3(0, -rise, 0)).normalize();
    const ay = new Vector3().crossVectors(down, ax).multiplyScalar(s).normalize();
    if (ay.y < 0) ay.negate();
    const L = Math.hypot(d / 2, rise) / 2 + over / 2;
    const mid = c.clone().addScaledVector(fz, (s * d) / 4).add(v3(0, rise / 2, 0)).addScaledVector(down, over / 2);
    roofB.obox(mid, ax, ay, down, w / 2 + over, thick / 2, L, 1.6);
  }
  if (wallB) {
    for (const s of [-1, 1]) {
      const e = c.clone().addScaledVector(ax, (s * w) / 2);
      const a = e.clone().addScaledVector(fz, -d / 2), b = e.clone().addScaledVector(fz, d / 2), t = e.clone().add(v3(0, rise, 0));
      const n = ax.clone().multiplyScalar(s);
      if (s > 0) wallB.quad(b, a, t, t, n, [d / 3, 0, 0, 0, d / 6, rise / 3, d / 6, rise / 3]);
      else wallB.quad(a, b, t, t, n, [0, 0, d / 3, 0, d / 6, rise / 3, d / 6, rise / 3]);
    }
  }
  void k;
}

const PLASTER = [0xd9cdb4, 0xcfc0a2, 0xe3d9c6, 0xc9b79a, 0xd6c3a6, 0xbfae95];
const SHUTTER = [0x55705a, 0x6d4b3a, 0x3f5873, 0x7a3b33, 0x4e5a3c];

export function house(k: Kit, terrain: Terrain, x: number, z: number, w: number, d: number, h: number, rot: number, seed: number): Vector3 {
  const y = terrain.heightAt(x, z) - 0.4;
  const hh = h + 0.4;
  rgb(k.plaster, PLASTER[seed % PLASTER.length], 0.9 + hash01(seed, 1) * 0.15);
  k.plaster.box(x, y + hh / 2, z, w, hh, d, 3, rot);
  // soubassement de pierre
  rgb(k.stone, 0xb0aaa0);
  k.stone.box(x, y + 0.45, z, w + 0.12, 0.9, d + 0.12, 2.6, rot);
  const rise = d * (0.32 + hash01(seed, 2) * 0.12);
  rgb(k.roof, 0xc9b8a8, 0.55 + hash01(seed, 3) * 0.3);
  gable(k, k.roof, k.plaster, v3(x, y + hh, z), w, d, rise, rot);
  const ax = v3(Math.cos(rot), 0, -Math.sin(rot));
  const fz = v3(Math.sin(rot), 0, Math.cos(rot));
  // cheminée
  const ch = v3(x, y + hh + rise * 0.75, z).addScaledVector(ax, w * 0.28).addScaledVector(fz, d * 0.12);
  rgb(k.stone, 0xa59c90);
  k.stone.obox(ch, ax, UP, fz, 0.3, rise * 0.55, 0.3, 2.6);
  // ouvertures sur les deux façades longues
  const sh = SHUTTER[(seed * 7) % SHUTTER.length];
  for (const s of [-1, 1]) {
    const nWin = Math.max(2, Math.floor(w / 2.6));
    for (let i = 0; i < nWin; i++) {
      const u = (i + 0.5) / nWin - 0.5;
      for (let fl = 0; fl < (h > 5 ? 2 : 1); fl++) {
        const isDoor = fl === 0 && i === Math.floor(nWin / 2) && s === 1;
        const cy = y + 0.4 + (isDoor ? 1.0 : 1.5 + fl * 2.7);
        const c = v3(x, cy, z).addScaledVector(ax, u * w).addScaledVector(fz, s * (d / 2 + 0.02));
        if (isDoor) {
          rgb(k.wood, 0x5a4636);
          k.wood.obox(c, ax, UP, fz, 0.5, 1.0, 0.05, 1.5);
        } else {
          rgb(k.glass, 0x1b222a);
          k.glass.obox(c, ax, UP, fz, 0.42, 0.6, 0.03, 1);
          rgb(k.wood, sh);
          for (const q of [-1, 1]) k.wood.obox(c.clone().addScaledVector(ax, q * 0.66), ax, UP, fz, 0.2, 0.62, 0.035, 1.5);
        }
      }
    }
  }
  return ch.add(v3(0, rise * 0.6, 0));
}

export function tent(k: Kit, terrain: Terrain, x: number, z: number, w: number, d: number, rot: number, color: number): void {
  const y = terrain.heightAt(x, z);
  rgb(k.fabric, color);
  gable(k, k.fabric, k.fabric, v3(x, y + 0.02, z).add(v3(0, 0, 0)), w, d, d * 0.62, rot, 0.0, 0.04);
}

export interface KitTextures {
  plaster: TexSet; roof: TexSet; wall: TexSet; wood: TexSet; metal: TexSet; fabric: TexSet;
}
export async function loadKitTextures(anisotropy: number): Promise<KitTextures> {
  const [plaster, roof, wall, wood, metal, fabric] = await Promise.all(['plaster', 'roof', 'wall', 'wood', 'metal', 'fabric'].map((n) => loadTexSet(n, anisotropy)));
  return { plaster, roof, wall, wood, metal, fabric };
}

/** Un maillage par matière, ajouté à `group` ; pierre, bois et métal entrent dans les collisions (balles, lignes de visée). */
export function kitMeshes(engine: Engine, k: Kit, tex: KitTextures, col: Colliders, group: Group): void {
  const mk = (b: GeoBuilder, set: { map: any; normalMap: any; arm: any }, key: string, tag: 'stone' | 'wood' | 'metal' | null, opts: Partial<MeshStandardMaterial> = {}): void => {
    if (!b.pos.length) return;
    const mat = engine.setupMaterial(new MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.arm, roughness: 1, metalness: 0, vertexColors: true, ...(opts as any) }), undefined, 'valley' + key);
    const m = new Mesh(b.build(), mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    if (tag) col.addGeometry(m.geometry, null, tag);
  };
  mk(k.plaster, tex.plaster, 'pl', 'stone');
  mk(k.roof, tex.roof, 'rf', 'stone');
  mk(k.stone, tex.wall, 'st', 'stone');
  mk(k.wood, tex.wood, 'wd', 'wood');
  mk(k.metal, tex.metal, 'mt', 'metal', { metalness: 0.3 } as any);
  mk(k.fabric, tex.fabric, 'fb', null, { side: DoubleSide } as any);
  {
    const mat = engine.setupMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.2, vertexColors: true }), undefined, 'glass');
    const m = new Mesh(k.glass.build(), mat);
    group.add(m);
    // la balle traverse la fenêtre (le mur derrière l'arrête) et la brise
    col.glass.add(m.geometry, null);
  }
}
