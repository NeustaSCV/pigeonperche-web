// Site de tir du niveau « standard » : la ruine (enceinte, tour à étage, escalier, puits, poutres calcinées, abri du
// râtelier) et ce que le joueur a besoin d'en savoir (zone praticable, nature du sol, passages vers les postes).
import { Mesh, Quaternion, Vector3 } from 'three';
import { buildRoamFence, makeRoam, type Roam } from '../../world/roam';
import type { Surface } from '../../audio/types';
import { GeoBuilder } from '../../core/builder';
import { mulberry32 } from '../../core/noise';
import type { LevelHost, SiteNav } from '../types';
import { Masonry } from '../../world/masonry';
import { ENCLOSURE, LEDGE_A, LEDGE_B, POSTS, RUIN, STAIR, SUMMIT_HEIGHT, TOWER, WALLS } from './map';

const H0 = SUMMIT_HEIGHT;

/** Monte la ruine et pose ses collisions. */
export async function buildRuin(h: LevelHost): Promise<Masonry> {
  const { engine, terrain, col, wind } = h;
  const ruin = new Masonry(H0);
  await ruin.init(engine);
  const gb = new GeoBuilder();
  WALLS.forEach((w, wi) => ruin.wall(gb, w, wi, col));

  // --- tour : dalle de l'étage, escalier ---
  const T = TOWER;
  const fb = new GeoBuilder();
  fb.box((T.x0 + T.x1) / 2 + 0.3, H0 + T.floor - 0.2, (T.z0 + T.z1) / 2, T.x1 - T.x0 - 0.6, 0.4, T.z1 - T.z0 - 1.0, 1.8);
  col.surfaces.push({ x0: T.x0 + 0.5, x1: T.x1 + 0.45, z0: T.z0 + 0.5, z1: T.z1 - 0.5, h: () => H0 + T.floor, kind: 'stone' });
  // garde-corps sud et nord de l'étage : déjà fournis par les murs. Bord est : ouvert.
  const S = STAIR;
  const steps = 14;
  const run = (S.zBottom - S.zTop) / steps;
  for (let i = 0; i < steps; i++) {
    const top = ((i + 1) / steps) * S.rise;
    const zc = S.zBottom - (i + 0.5) * run;
    gb.box((S.x0 + S.x1) / 2, H0 + top / 2 - 0.25, zc, S.x1 - S.x0, top + 0.5, run + 0.01, 2.6);
  }
  // palier
  gb.box((S.x0 + T.x0) / 2 + 0.2, H0 + S.rise / 2 - 0.25, (S.zTop + S.landingZ) / 2, T.x0 - S.x0 + 0.4, S.rise + 0.5, S.zTop - S.landingZ, 2.6);
  col.surfaces.push({ x0: S.x0 - 0.1, x1: S.x1 + 0.2, z0: S.zTop, z1: S.zBottom + 0.3, h: (_x, z) => H0 + Math.min(1, Math.max(0, (S.zBottom - z) / (S.zBottom - S.zTop))) * S.rise, kind: 'stone' });
  col.surfaces.push({ x0: S.x0 - 0.1, x1: T.x0 + 0.9, z0: S.landingZ, z1: S.zTop + 0.05, h: () => H0 + S.rise, kind: 'stone' });
  // flanc extérieur de l'escalier : empêche de monter par le côté
  col.segs.push({ ax: S.x0 - 0.05, az: S.zBottom - 1.6, bx: S.x0 - 0.05, bz: S.landingZ, r: 0.12, y0: H0 - 1, y1: H0 + 1.2 });
  col.segs.push({ ax: S.x0, az: S.landingZ - 0.05, bx: T.x0, bz: S.landingZ - 0.05, r: 0.12, y0: H0 - 1, y1: H0 + S.rise + 0.9 });

  // --- puits ---
  const W = RUIN.well;
  gb.cyl(W.x, H0 - 0.3, W.z, 1.25, 1.2, 1.15, 14, 2.6, false);
  gb.cyl(W.x, H0 - 0.3, W.z, 0.8, 0.82, 1.15, 14, 2.6, false);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    gb.box(W.x + Math.cos(a) * 1.02, H0 + 0.86, W.z + Math.sin(a) * 1.02, 0.5, 0.14, 0.46, 2.6, -a);
  }
  col.segs.push({ ax: W.x, az: W.z, bx: W.x + 0.01, bz: W.z, r: 1.2, y0: H0 - 1, y1: H0 + 0.95 });

  // --- tambours de colonne tombés ---
  const rnd = mulberry32(31);
  for (const [x, z, r] of [[-12, -2, 0.55], [-11.2, -3.6, 0.5], [6, 4, 0.6], [-18, 15, 0.5]] as number[][]) {
    gb.cyl(x, H0 - 0.1, z, r, r * 0.97, 0.55 + rnd() * 0.3, 12, 2.6, true);
    col.segs.push({ ax: x, az: z, bx: x + 0.01, bz: z, r, y0: H0 - 1, y1: H0 + 0.6 });
  }

  const wallMesh = new Mesh(gb.build(), ruin.wallMat);
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  ruin.group.add(wallMesh);
  col.addGeometry(wallMesh.geometry, null, 'stone');


  // --- dallages ---
  ruin.paving(terrain, RUIN.paved);
  const floorMesh = new Mesh(fb.build(), ruin.flagMat);
  floorMesh.castShadow = floorMesh.receiveShadow = true;
  ruin.group.add(floorMesh);
  col.addGeometry(floorMesh.geometry, null, 'stone');

  // --- poutres calcinées, abri du râtelier ---
  const wb = new GeoBuilder();
  const cb = new GeoBuilder();
  // poutres tombées dans la tour et contre la cloison
  const beams: [number, number, number, number, number, number, number][] = [
    // x, y, z, longueur, section, rotY, inclinaison
    [17.5, 0.5, -10.5, 5.2, 0.26, 0.5, 0.16],
    [19.5, 0.25, -12.8, 4.2, 0.24, -0.9, 0.05],
    [16.2, 1.4, -9.0, 5.6, 0.25, 1.35, 0.5],
    [-9.5, 0.3, -12, 4.8, 0.24, 0.3, 0.1],
    [-12.5, 1.1, -15.5, 5.0, 0.26, 1.9, 0.42],
    [-10, 0.2, 13, 3.6, 0.22, 2.4, 0.04],
  ];
  const q = new Quaternion(), e = new Vector3();
  for (const [x, y, z, len, sec, ry, tilt] of beams) {
    const ax = new Vector3(Math.cos(ry) * Math.cos(tilt), Math.sin(tilt), -Math.sin(ry) * Math.cos(tilt));
    const az = new Vector3(Math.sin(ry), 0, Math.cos(ry));
    const ay = new Vector3().crossVectors(az, ax).normalize();
    cb.obox(new Vector3(x, H0 + y, z), ax, ay, az, len / 2, sec / 2, sec / 2, 1.2);
  }
  void q; void e;
  ruin.rackShelter(wb, col, RUIN.rack);
  // terrain libre hors les murs, jusqu'à la rupture de pente du sommet (clôture seulement si un replat dépassait le rayon)
  roam = makeRoam(h.terrain, H0, { radius: RUIN.roam }, core, RUIN.start);
  buildRoamFence(wb, h.terrain, col, roam);
  const woodMesh = new Mesh(wb.build(), ruin.woodMat);
  const charMesh = new Mesh(cb.build(), ruin.charMat);
  for (const m of [woodMesh, charMesh]) {
    m.castShadow = m.receiveShadow = true;
    ruin.group.add(m);
    col.addGeometry(m.geometry, null, 'wood');
  }

  ruin.ivy(engine, wind, col);
  return ruin;
}

// ---------------------------------------------------------------------------------------------
// Ce que le joueur sait de la ruine.
// ---------------------------------------------------------------------------------------------
function insidePoly(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ENCLOSURE.length - 1; i < ENCLOSURE.length; j = i++) {
    const [xi, zi] = ENCLOSURE[i], [xj, zj] = ENCLOSURE[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
let roam: Roam | null = null;
/** Le cœur du site : l'enceinte, le couloir du rebord d'éboulis, le seuil des brèches est et ouest. */
function core(x: number, z: number): boolean {
  if (insidePoly(x, z)) return true;
  const dx = LEDGE_B.x - LEDGE_A.x, dz = LEDGE_B.z - LEDGE_A.z;
  let t = ((x - LEDGE_A.x) * dx + (z - LEDGE_A.z) * dz) / (dx * dx + dz * dz);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (Math.hypot(x - LEDGE_A.x - dx * t, z - LEDGE_A.z - dz * t) < 3.4 + t * 1.6) return true;
  for (const k of ['est', 'ouest'] as const) if (Math.hypot(x - POSTS[k].x, z - POSTS[k].z) < 1.7) return true;
  return false;
}
/** Zone praticable : le cœur, et hors les murs tout le replat du sommet jusqu'à la rupture de pente. */
function allowed(x: number, z: number): boolean {
  if (roam === null) return core(x, z);
  // (le cœur lui-même s'arrête à l'à-pic : on ne descend pas dans le vide au bout d'un poste)
  return roam.allowed(x, z) || (core(x, z) && !roam.cliff(x, z));
}

export const nav: SiteNav = {
  allowed,
  limit: (x, z) => roam?.limit(x, z) ?? null,
  surfaceAt(x: number, z: number): Surface {
    const r = Math.hypot(x, z);
    return RUIN.paved.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr * 0.85) ? 'stone' : r > 31 ? 'gravel' : 'grass';
  },
  /** Le pied puis le haut de l'escalier pour la tour, l'angle effondré pour le rebord d'éboulis. */
  waypoint(key: string, pos: Vector3): { x: number; z: number; hint: string } | null {
    const up = pos.y - SUMMIT_HEIGHT;
    if (key === 'tour' && up < STAIR.rise - 0.5) {
      const sx = (STAIR.x0 + STAIR.x1) / 2;
      // sur l'escalier, ou arrivé à son pied : on vise le haut
      const onStair = Math.abs(pos.x - sx) < 1 && ((up > 0.25 && pos.z < STAIR.zBottom) || pos.z < STAIR.zBottom + 1.6);
      return { x: sx, z: onStair ? STAIR.zTop - 0.8 : STAIR.zBottom + 0.9, hint: onStair ? 'porte de l’étage' : 'escalier' };
    }
    if (key === 'tour' && pos.x < TOWER.x0 + 0.55) {
      // sur le palier : finir de longer le mur, puis passer la porte de l'étage avant de viser le poste
      return { x: pos.z > STAIR.zTop - 0.45 ? (STAIR.x0 + STAIR.x1) / 2 : TOWER.x0 + 1.0, z: STAIR.zTop - 0.8, hint: 'porte de l’étage' };
    }
    if (key === 'eboulis' && insidePoly(pos.x, pos.z) && Math.hypot(pos.x - LEDGE_A.x, pos.z - LEDGE_A.z) > 1.5) return { x: LEDGE_A.x, z: LEDGE_A.z, hint: 'angle effondré' };
    return null;
  },
};

/** Pas d'herbe sous la tour ni sous l'escalier. */
export function grassBlocked(x: number, z: number): boolean {
  if (x > TOWER.x0 && x < TOWER.x1 && z > TOWER.z0 && z < TOWER.z1) return true;
  if (x > STAIR.x0 - 0.2 && x < TOWER.x0 && z > STAIR.landingZ && z < STAIR.zBottom) return true;
  return false;
}
