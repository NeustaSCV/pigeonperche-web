// Site de tir du niveau « facile » : le Guet, cour de ferme close au bord du coteau. Parapet d'appui côté vallée,
// plate-forme de guet en bois (escalier droit), pas de tir à l'angle nord-est, deux portillons vers les talus,
// puits, abri du râtelier. Et ce que le joueur a besoin d'en savoir (zone praticable, sol, passages vers les postes).
import { Mesh, Vector3 } from 'three';
import { buildRoamFence, makeRoam, type Roam } from '../../world/roam';
import type { Surface } from '../../audio/types';
import { GeoBuilder } from '../../core/builder';
import type { LevelHost, SiteNav } from '../types';
import { Masonry } from '../../world/masonry';
import { BASE_Y, DECK, FARM, OUTSIDE, POSTS, STAIR, WALLS, YARD } from './map';

const H0 = BASE_Y;

/** Monte la cour et pose ses collisions. */
export async function buildFarm(h: LevelHost): Promise<Masonry> {
  const { engine, terrain, col, wind } = h;
  const farm = new Masonry(H0);
  await farm.init(engine);
  const gb = new GeoBuilder();
  WALLS.forEach((w, wi) => farm.wall(gb, w, wi, col));

  // --- puits ---
  const W = FARM.well;
  gb.cyl(W.x, H0 - 0.3, W.z, 1.05, 1.0, 1.1, 14, 2.6, false);
  gb.cyl(W.x, H0 - 0.3, W.z, 0.68, 0.7, 1.1, 14, 2.6, false);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    gb.box(W.x + Math.cos(a) * 0.86, H0 + 0.82, W.z + Math.sin(a) * 0.86, 0.46, 0.13, 0.42, 2.6, -a);
  }
  col.segs.push({ ax: W.x, az: W.z, bx: W.x + 0.01, bz: W.z, r: 1.05, y0: H0 - 1, y1: H0 + 0.95 });
  // auge de pierre contre le mur ouest, bornes du portail
  gb.box(-15.6, H0 + 0.2, 3.2, 0.9, 0.75, 2.6, 2.6);
  col.segs.push({ ax: -15.6, az: 2.1, bx: -15.6, bz: 4.3, r: 0.5, y0: H0 - 1, y1: H0 + 0.6, box: true });

  const wallMesh = new Mesh(gb.build(), farm.wallMat);
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  farm.group.add(wallMesh);
  col.addGeometry(wallMesh.geometry, null, 'stone');

  farm.paving(terrain, FARM.paved);

  // --- bois : plate-forme de guet, escalier, abri du râtelier, banc du pas de tir ---
  const wb = new GeoBuilder();
  const D = DECK, S = STAIR;
  const cx = (D.x0 + D.x1) / 2, cz = (D.z0 + D.z1) / 2, dw = D.x1 - D.x0, dd = D.z1 - D.z0;
  const top = H0 + D.floor;
  // quatre poteaux d'angle qui dépassent le plancher, soubassement bardé de planches
  for (const [px, pz] of [[D.x0, D.z0], [D.x1, D.z0], [D.x1, D.z1], [D.x0, D.z1]]) wb.box(px, H0 + (D.floor + 1.05) / 2 - 0.2, pz, 0.2, D.floor + 1.45, 0.2, 1.1);
  const board = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 0.24);
    for (let i = 0; i < n; i++) {
      if (i % 7 === 3) continue; // planches manquantes : on devine la charpente
      const u = (i + 0.5) / n;
      const hgt = D.floor - 0.25 - ((i * 37) % 5) * 0.03;
      wb.box(ax + (bx - ax) * u, H0 + hgt / 2 - 0.1, az + (bz - az) * u, Math.abs(bx - ax) > 0.1 ? 0.21 : 0.03, hgt, Math.abs(bz - az) > 0.1 ? 0.21 : 0.03, 1.1);
    }
    col.segs.push({ ax, az, bx, bz, r: 0.1, y0: H0 - 1, y1: top - 0.1, box: true });
  };
  board(D.x0, D.z0, D.x1, D.z0);
  board(D.x1, D.z0, D.x1, D.z1);
  board(D.x1, D.z1, D.x0, D.z1);
  board(D.x0, D.z1, D.x0, D.z0);
  // solives et plancher
  for (let i = 0; i < 5; i++) wb.box(D.x0 + (i / 4) * dw, top - 0.2, cz, 0.1, 0.18, dd + 0.2, 1.1);
  const planks = Math.round(dd / 0.3);
  for (let i = 0; i < planks; i++) wb.box(cx, top - 0.05 + (i % 2) * 0.006, D.z0 + (i + 0.5) * (dd / planks), dw + 0.3, 0.07, dd / planks - 0.015, 1.1);
  col.surfaces.push({ x0: D.x0 - 0.1, x1: D.x1 + 0.1, z0: D.z0 - 0.1, z1: D.z1 + 0.1, h: () => top, kind: 'wood' });
  // garde-corps : lisse haute à l'ouest, à l'est et au sud (sauf l'arrivée de l'escalier) ; simple plinthe au nord, côté tir
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    wb.box((ax + bx) / 2, top + 1.0, (az + bz) / 2, Math.abs(bx - ax) + 0.08, 0.07, Math.abs(bz - az) + 0.08, 1.1);
    col.segs.push({ ax, az, bx, bz, r: 0.08, y0: top - 0.2, y1: top + 1.1, box: true });
  };
  rail(D.x0, D.z0, D.x0, D.z1);
  rail(D.x1, D.z0, D.x1, D.z1);
  rail(D.x0, D.z1, S.x0 - 0.1, D.z1);
  rail(S.x1 + 0.1, D.z1, D.x1, D.z1);
  for (const px of [S.x0 - 0.1, S.x1 + 0.1]) wb.box(px, top + 0.5, D.z1, 0.09, 1.0, 0.09, 1.1);
  wb.box(cx, top + 0.045, D.z0, dw, 0.09, 0.06, 1.1);
  col.segs.push({ ax: D.x0, az: D.z0, bx: D.x1, bz: D.z0, r: 0.06, y0: top - 0.2, y1: top + 0.45, box: true });
  // escalier : deux limons, douze marches, deux mains courantes
  const run = S.zBottom - S.zTop, steps = 12, sx = (S.x0 + S.x1) / 2;
  const slope = Math.atan2(S.rise, run);
  const along = new Vector3(0, Math.sin(slope), -Math.cos(slope)), upv = new Vector3(0, Math.cos(slope), Math.sin(slope)), side = new Vector3(1, 0, 0);
  const mid = new Vector3(sx, H0 + S.rise / 2, (S.zBottom + S.zTop) / 2);
  const half = Math.hypot(run, S.rise) / 2;
  for (const px of [S.x0, S.x1]) {
    wb.obox(mid.clone().setX(px).addScaledVector(upv, -0.16), side, upv, along, 0.04, 0.11, half + 0.1, 1.1);
    wb.obox(mid.clone().setX(px).addScaledVector(upv, 0.92), side, upv, along, 0.035, 0.035, half + 0.1, 1.1);
    for (let i = 0; i <= 3; i++) {
      const u = i / 3;
      wb.box(px, H0 + u * S.rise + 0.45, S.zBottom - u * run, 0.07, 1.0, 0.07, 1.1);
    }
    // flanc : on ne monte ni ne descend par le côté
    col.segs.push({ ax: px + (px < sx ? -0.05 : 0.05), az: S.zBottom + 0.15, bx: px + (px < sx ? -0.05 : 0.05), bz: S.zTop, r: 0.09, y0: H0 - 1, y1: top + 1.1, box: true });
  }
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    wb.box(sx, H0 + u * S.rise - 0.02, S.zBottom - u * run, S.x1 - S.x0, 0.05, run / steps + 0.03, 1.1);
  }
  col.surfaces.push({
    x0: S.x0 - 0.1, x1: S.x1 + 0.1, z0: S.zTop - 0.05, z1: S.zBottom + 0.3,
    h: (_x, z) => H0 + Math.min(1, Math.max(0, (S.zBottom - z) / run)) * S.rise, kind: 'wood',
  });
  // abri du râtelier, banc et piquets du pas de tir
  farm.rackShelter(wb, col, FARM.rack);
  // terrain libre hors les murs, jusqu'au rebord du coteau ; clôture de pâture au sud, sur le plateau
  roam = makeRoam(h.terrain, H0, { radius: FARM.roam }, core, FARM.start);
  buildRoamFence(wb, h.terrain, col, roam);
  wb.box(11.6, H0 + 0.42, -16.6, 0.4, 0.06, 1.7, 1.1);
  for (const dz of [-0.7, 0.7]) wb.box(11.6, H0 + 0.2, -16.6 + dz, 0.34, 0.4, 0.08, 1.1);
  col.segs.push({ ax: 11.6, az: -17.4, bx: 11.6, bz: -15.8, r: 0.22, y0: H0 - 1, y1: H0 + 0.5, box: true });
  // vantail du portail, resté entrouvert
  wb.box(-10.6, H0 + 1.1, 24.9, 0.08, 2.2, 1.5, 1.1, 0.5);
  // tronc du pin de la cour
  col.segs.push({ ax: -12.5, az: 16.5, bx: -12.49, bz: 16.5, r: 0.3, y0: H0 - 1, y1: H0 + 6 });

  const woodMesh = new Mesh(wb.build(), farm.woodMat);
  woodMesh.castShadow = woodMesh.receiveShadow = true;
  farm.group.add(woodMesh);
  col.addGeometry(woodMesh.geometry, null, 'wood');

  farm.ivy(engine, wind, col);
  return farm;
}

// ---------------------------------------------------------------------------------------------
// Ce que le joueur sait de la cour.
// ---------------------------------------------------------------------------------------------
const inYard = (x: number, z: number): boolean => x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1;

let roam: Roam | null = null;
/** Le cœur du site : la cour, le pas de tir de l'angle nord-est et les deux talus hors les murs. */
function core(x: number, z: number): boolean {
  if (inYard(x, z)) return true;
  for (const [x0, x1, z0, z1] of OUTSIDE) if (x > x0 && x < x1 && z > z0 && z < z1) return true;
  return false;
}
function allowed(x: number, z: number): boolean {
  // hors les murs : tout le terrain que le relief porte, jusqu'au rebord du coteau ou à la clôture
  if (roam === null) return core(x, z);
  // (le cœur lui-même s'arrête à l'à-pic : on ne descend pas dans le vide au bout d'un poste)
  return roam.allowed(x, z) || (core(x, z) && !roam.cliff(x, z));
}

export const nav: SiteNav = {
  allowed,
  limit: (x, z) => roam?.limit(x, z) ?? null,
  surfaceAt(x: number, z: number): Surface {
    return FARM.paved.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr * 0.85) ? 'stone' : 'grass';
  },
  /** L'escalier pour la plate-forme, les portillons pour les talus, le bout du parapet pour le pas de tir. */
  waypoint(key: string, pos: Vector3): { x: number; z: number; hint: string } | null {
    const up = pos.y - H0;
    if (key === 'guet' && up < STAIR.rise - 0.5) {
      const sx = (STAIR.x0 + STAIR.x1) / 2;
      // dans la volée (les flancs sont fermés), ou arrivé à son pied : on vise le haut
      const onStair = Math.abs(pos.x - sx) < 0.75 && pos.z < STAIR.zBottom + 1.2;
      return { x: sx, z: onStair ? STAIR.zTop - 0.9 : STAIR.zBottom + 0.8, hint: onStair ? 'haut des marches' : 'escalier' };
    }
    // descendu de la plate-forme ou venu d'ailleurs : rien de spécial pour le parapet
    if (key === 'talus' && pos.x < 17.4 && Math.hypot(pos.x - 16.6, pos.z + 6) > 0.9) return { x: 16.6, z: -6, hint: 'portillon' };
    if (key === 'terrasse' && pos.x > -17.4 && up < 0.5) {
      // l'escalier de la plate-forme barre le chemin : on le contourne par son pied, au sud
      if (pos.x > -12.4 && pos.z > STAIR.zTop - 1) return { x: -14.2, z: -0.2, hint: 'portillon' };
      if (Math.hypot(pos.x + 16.6, pos.z + 6) > 0.9) return { x: -16.6, z: -6, hint: 'portillon' };
    }
    if (key === 'est' && pos.z > -13.4) {
      // seulement si la ligne droite vers le pas de tir bute sur le parapet (il s'arrête à x = 10,4)
      const P = POSTS.est;
      const xa = pos.x + ((P.x - pos.x) * (pos.z + 14)) / (pos.z - P.z);
      if (xa < 11.6 && Math.hypot(pos.x - 13.6, pos.z + 13.0) > 0.9) return { x: 13.6, z: -13.0, hint: 'l’angle' };
    }
    return null;
  },
};

/** Pas d'herbe sous la plate-forme ni sous l'escalier. */
export function grassBlocked(x: number, z: number): boolean {
  if (x > DECK.x0 - 0.2 && x < DECK.x1 + 0.2 && z > DECK.z0 - 0.2 && z < DECK.z1 + 0.2) return true;
  if (x > STAIR.x0 - 0.2 && x < STAIR.x1 + 0.2 && z > STAIR.zTop && z < STAIR.zBottom + 0.5) return true;
  return false;
}
