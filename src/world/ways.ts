// Voies secondaires d'une carte (rue, route industrielle, chemin de terre, allée). Le tracé, la plate-forme et la
// matière viennent du relief (tools/terrain-lib.mjs, carveWays → meta.json `ways`) : ici, seulement ce que le relief
// ne sait pas faire — les ponts — et de quoi écarter le décor de la chaussée.
import { Vector3 } from 'three';
import { Kit, rgb } from './kit';
import type { Terrain, WayMeta } from './terrain';

const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** Le point (x, z) est-il à moins de `lim` mètres de l'axe d'une voie secondaire ? */
export function nearWay(ways: WayMeta[] | undefined, x: number, z: number, lim: number): boolean {
  if (!ways) return false;
  for (const w of ways) {
    const L = w.line, r = lim + w.width / 2;
    for (let i = 0; i < L.length; i++) if (Math.abs(L[i][0] - x) < r && Math.abs(L[i][1] - z) < r && Math.hypot(L[i][0] - x, L[i][1] - z) < r) return true;
  }
  return false;
}

/**
 * Ponts des voies secondaires, dans le Kit du décor (aucun appel de dessin de plus : mêmes maillages que les maisons).
 * 'pierre' : tablier maçonné, parapets, deux piles ; 'bois' : platelage sur longerons, lisses et pilotis ;
 * 'beton' : dalle, piles et glissières d'acier.
 */
export function buildWayBridges(k: Kit, terrain: Terrain): void {
  for (const w of terrain.meta.ways ?? [])
    for (const b of w.bridges ?? []) {
      const ax = v3(b.dir[0], 0, b.dir[1]), az = v3(-b.dir[1], 0, b.dir[0]);
      const c = v3(b.x, b.deck, b.z);
      const L = b.length / 2, W = b.width / 2;
      const kind = b.kind ?? 'pierre';
      // le lit sous le pont : les piles descendent jusqu'au fond
      const bed = Math.min(terrain.heightAt(b.x, b.z), b.deck - 1.5) - 0.8;
      const pierH = (b.deck - bed) / 2;
      if (kind === 'bois') {
        rgb(k.wood, 0x6b5a45);
        k.wood.obox(c.clone().add(v3(0, -0.09, 0)), ax, UP, az, L, 0.07, W, 1.5);
        for (const s of [-1, 1]) {
          k.wood.obox(c.clone().add(v3(0, -0.34, 0)).addScaledVector(az, s * (W - 0.35)), ax, UP, az, L, 0.18, 0.12, 1.5);
          k.wood.obox(c.clone().add(v3(0, 0.95, 0)).addScaledVector(az, s * (W - 0.08)), ax, UP, az, L, 0.05, 0.05, 1.5);
          const n = Math.max(2, Math.round(b.length / 2.4));
          for (let i = 0; i <= n; i++) k.wood.obox(c.clone().add(v3(0, 0.45, 0)).addScaledVector(ax, -L + (2 * L * i) / n).addScaledVector(az, s * (W - 0.08)), ax, UP, az, 0.06, 0.52, 0.06, 1.5);
          for (const t of [-0.45, 0.45]) k.wood.obox(c.clone().add(v3(0, -pierH - 0.1, 0)).addScaledVector(ax, t * b.length).addScaledVector(az, s * (W - 0.4)), ax, UP, az, 0.13, pierH, 0.13, 1.5);
        }
      } else if (kind === 'beton') {
        rgb(k.plaster, 0x9c9a92);
        k.plaster.obox(c.clone().add(v3(0, -0.4, 0)), ax, UP, az, L, 0.4, W, 2.4);
        for (const t of [-0.28, 0.28]) k.plaster.obox(c.clone().add(v3(0, -0.8 - pierH, 0)).addScaledVector(ax, t * b.length), ax, UP, az, 0.7, pierH, W - 0.6, 2.4);
        rgb(k.metal, 0x8f9498);
        for (const s of [-1, 1]) {
          k.metal.obox(c.clone().add(v3(0, 0.75, 0)).addScaledVector(az, s * (W - 0.15)), ax, UP, az, L, 0.14, 0.05, 1.2);
          const n = Math.max(2, Math.round(b.length / 4));
          for (let i = 0; i <= n; i++) k.metal.obox(c.clone().add(v3(0, 0.4, 0)).addScaledVector(ax, -L + (2 * L * i) / n).addScaledVector(az, s * (W - 0.15)), ax, UP, az, 0.06, 0.4, 0.06, 1.2);
        }
      } else {
        rgb(k.stone, 0xaaa398);
        k.stone.obox(c.clone().add(v3(0, -0.45, 0)), ax, UP, az, L, 0.45, W, 2.6);
        for (const s of [-1, 1]) {
          k.stone.obox(c.clone().add(v3(0, 0.4, 0)).addScaledVector(az, s * (W - 0.2)), ax, UP, az, L, 0.4, 0.2, 2.6);
          for (const t of [-0.3, 0.3]) k.stone.obox(c.clone().add(v3(0, -0.9 - pierH, 0)).addScaledVector(ax, t * b.length).addScaledVector(az, s * W * 0.4), ax, UP, az, 0.9, pierH, W * 0.45, 2.6);
        }
      }
    }
}
