// Site de tir du niveau « avancé » : un poste d'observation bétonné au bout de l'éperon. Trois dalles de tir au ras
// de la corniche (nord, est, ouest), un mirador de béton à plate-forme couverte (escalier ouest), la station de
// pompage, le pylône et sa manche à air, l'abri du râtelier. Et ce que le joueur a besoin d'en savoir.
import { Mesh, Vector3 } from 'three';
import type { Surface } from '../../audio/types';
import { GeoBuilder } from '../../core/builder';
import { buildFlags } from '../../world/flags';
import { Kit, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import { Masonry } from '../../world/masonry';
import type { LevelHost, SiteNav } from '../types';
import { MIRADOR, POSTS, RIM_HEIGHT, SITE, STAIR } from './map';

const H0 = RIM_HEIGHT;
const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const CONCRETE = 0x9c9a92, CONCRETE_DARK = 0x86847c;

/** Dalles de tir : poste, direction de tir (unitaire, x et z). */
const SLABS: { key: string; fx: number; fz: number }[] = [
  { key: 'nord', fx: 0, fz: -1 },
  { key: 'est', fx: 1, fz: 0 },
  { key: 'ouest', fx: -1, fz: 0 },
];

export interface SiteBuild {
  masonry: Masonry;
  /** emprises sans herbe (murets, local, piliers) */
  footprints: { ax: number; az: number; bx: number; bz: number; r: number }[];
}

export async function buildSite(h: LevelHost): Promise<SiteBuild> {
  const { engine, col, wind } = h;
  const masonry = new Masonry(H0);
  const [tex] = await Promise.all([loadKitTextures(engine.q.anisotropy), masonry.init(engine)]);
  const k = new Kit();
  const footprints: SiteBuild['footprints'] = [];

  // --- dalles de tir : dalle au ras du sol, deux murets latéraux, piquet numéroté ---
  for (const S of SLABS) {
    const P = POSTS[S.key];
    const f = v3(S.fx, 0, S.fz), s = v3(-S.fz, 0, S.fx);
    rgb(k.plaster, CONCRETE);
    k.plaster.obox(v3(P.x, H0 - 0.2, P.z).addScaledVector(f, -1.75), s, UP, f, 1.6, 0.24, 2.05, 2.4);
    rgb(k.plaster, CONCRETE_DARK);
    for (const q of [-1, 1]) {
      const c = v3(P.x, H0 + 0.25, P.z).addScaledVector(f, -2.0).addScaledVector(s, q * 1.78);
      k.plaster.obox(c, s, UP, f, 0.16, 0.35, 1.5, 2.4);
      const a = c.clone().addScaledVector(f, -1.5), b = c.clone().addScaledVector(f, 1.5);
      col.segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 0.18, y0: H0 - 1, y1: H0 + 0.6, box: true });
      footprints.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 0.3 });
    }
    // sacs de lest au pied des murets
    rgb(k.fabric, 0x8d8468);
    for (const q of [-1, 1]) for (let i = 0; i < 3; i++) k.fabric.obox(v3(P.x, H0 + 0.12, P.z).addScaledVector(f, -3.9 + i * 0.05).addScaledVector(s, q * (0.9 + i * 0.5)), s, UP, f, 0.3, 0.12, 0.2, 1.2);
  }

  // --- mirador : quatre piliers, dalle, garde-corps est, sud et ouest, toit de tôle ---
  const T = MIRADOR;
  const cx = (T.x0 + T.x1) / 2, cz = (T.z0 + T.z1) / 2;
  rgb(k.plaster, CONCRETE);
  for (const [px, pz] of [[T.x0 + 0.45, T.z0 + 0.45], [T.x1 - 0.45, T.z0 + 0.45], [T.x1 - 0.45, T.z1 - 0.45], [T.x0 + 0.45, T.z1 - 0.45]]) {
    k.plaster.box(px, H0 + T.floor / 2 - 0.4, pz, 0.6, T.floor + 0.6, 0.6, 2.4);
    col.segs.push({ ax: px, az: pz, bx: px + 0.01, bz: pz, r: 0.38, y0: H0 - 1, y1: H0 + T.floor - 0.4 });
    footprints.push({ ax: px, az: pz, bx: px + 0.01, bz: pz, r: 0.5 });
  }
  // contreventements sous la dalle
  rgb(k.plaster, CONCRETE_DARK);
  k.plaster.box(cx, H0 + T.floor - 0.55, T.z0 + 0.45, T.x1 - T.x0 - 0.9, 0.4, 0.35, 2.4);
  k.plaster.box(cx, H0 + T.floor - 0.55, T.z1 - 0.45, T.x1 - T.x0 - 0.9, 0.4, 0.35, 2.4);
  rgb(k.plaster, CONCRETE);
  k.plaster.box(cx, H0 + T.floor - 0.16, cz, T.x1 - T.x0, 0.32, T.z1 - T.z0, 2.4);
  col.surfaces.push({ x0: T.x0, x1: T.x1, z0: T.z0, z1: T.z1, h: () => H0 + T.floor, kind: 'stone' });
  // garde-corps pleins (0,9 m) : est, sud ; ouest jusqu'à la porte du palier. Le nord reste ouvert sur la plaine.
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    k.plaster.box((ax + bx) / 2, H0 + T.floor + 0.45, (az + bz) / 2, ax === bx ? 0.22 : len, 0.9, ax === bx ? len : 0.22, 2.4);
    col.segs.push({ ax, az, bx, bz, r: 0.13, y0: H0 + T.floor - 0.3, y1: H0 + T.floor + 0.95, box: true });
  };
  rgb(k.plaster, CONCRETE_DARK);
  rail(T.x1 - 0.11, T.z0 + 0.8, T.x1 - 0.11, T.z1);
  rail(T.x0, T.z1 - 0.11, T.x1, T.z1 - 0.11);
  rail(T.x0 + 0.11, T.z0 + 0.8, T.x0 + 0.11, STAIR.landingZ - 0.05);
  // toit de tôle sur quatre montants
  rgb(k.metal, 0x5d6468);
  for (const [px, pz] of [[T.x0 + 0.2, T.z0 + 0.9], [T.x1 - 0.2, T.z0 + 0.9], [T.x1 - 0.2, T.z1 - 0.2], [T.x0 + 0.2, T.z1 - 0.2]]) k.metal.box(px, H0 + T.floor + 1.3, pz, 0.09, 2.6, 0.09, 1.2);
  rgb(k.metal, 0x767c78);
  k.metal.obox(v3(cx, H0 + T.floor + 2.68, cz + 0.3), v3(1, 0, 0), v3(0, 1, 0.06).normalize(), v3(0, -0.06, 1).normalize(), (T.x1 - T.x0) / 2 + 0.35, 0.04, (T.z1 - T.z0) / 2 + 0.1, 1.2);

  // --- escalier ouest et palier ---
  const S = STAIR;
  const steps = 14, run = (S.zBottom - S.zTop) / steps, sx = (S.x0 + S.x1) / 2;
  rgb(k.plaster, CONCRETE);
  for (let i = 0; i < steps; i++) {
    const top = ((i + 1) / steps) * S.rise;
    k.plaster.box(sx, H0 + top / 2 - 0.25, S.zBottom - (i + 0.5) * run, S.x1 - S.x0, top + 0.5, run + 0.01, 2.4);
  }
  k.plaster.box((S.x0 + T.x0) / 2, H0 + S.rise / 2 - 0.25, (S.zTop + S.landingZ) / 2, T.x0 - S.x0, S.rise + 0.5, S.zTop - S.landingZ, 2.4);
  col.surfaces.push({ x0: S.x0 - 0.1, x1: S.x1 + 0.2, z0: S.zTop, z1: S.zBottom + 0.3, h: (_x, z) => H0 + Math.min(1, Math.max(0, (S.zBottom - z) / (S.zBottom - S.zTop))) * S.rise, kind: 'stone' });
  col.surfaces.push({ x0: S.x0 - 0.1, x1: T.x0 + 0.3, z0: S.landingZ, z1: S.zTop + 0.05, h: () => H0 + S.rise, kind: 'stone' });
  // flancs de l'escalier : on ne monte pas par le côté ; main courante d'acier côté vide
  col.segs.push({ ax: S.x0 - 0.05, az: S.zBottom - 1.6, bx: S.x0 - 0.05, bz: S.landingZ, r: 0.12, y0: H0 - 1, y1: H0 + S.rise + 0.9 });
  col.segs.push({ ax: S.x1 + 0.05, az: S.zBottom - 1.6, bx: S.x1 + 0.05, bz: S.zTop, r: 0.12, y0: H0 - 1, y1: H0 + 1.2 });
  col.segs.push({ ax: S.x0, az: S.landingZ - 0.05, bx: T.x0, bz: S.landingZ - 0.05, r: 0.12, y0: H0 - 1, y1: H0 + S.rise + 0.9 });
  col.segs.push({ ax: S.x1 + 0.1, az: S.zTop + 0.1, bx: T.x0 + 0.2, bz: S.zTop + 0.1, r: 0.1, y0: H0 + S.rise - 0.3, y1: H0 + S.rise + 0.9 });
  rgb(k.metal, 0x5d6468);
  k.metal.obox(v3(S.x0 + 0.04, H0 + S.rise / 2 + 0.95, (S.zBottom + S.zTop) / 2), v3(1, 0, 0), v3(0, run * steps, S.rise).normalize(), v3(0, S.rise, -(run * steps)).normalize(), 0.025, 0.025, Math.hypot(S.rise, run * steps) / 2, 1.2);
  k.metal.box(S.x0 + 0.04, H0 + S.rise + 0.95, (S.zTop + S.landingZ) / 2, 0.05, 0.05, S.zTop - S.landingZ, 1.2);
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    k.metal.box(S.x0 + 0.04, H0 + u * S.rise + 0.45, S.zBottom + (S.zTop - S.zBottom) * u, 0.04, 1.0, 0.04, 1.2);
  }
  k.metal.box(S.x0 + 0.04, H0 + S.rise + 0.45, S.landingZ + 0.05, 0.04, 1.0, 0.04, 1.2);
  k.metal.box((S.x0 + T.x0) / 2, H0 + S.rise + 0.95, S.landingZ + 0.04, T.x0 - S.x0, 0.05, 0.05, 1.2);

  // --- station de pompage : local de béton, porte d'acier, conduite forcée qui plonge vers l'est ---
  const Pm = SITE.pump;
  rgb(k.plaster, 0xa5a297);
  k.plaster.box(Pm.x, H0 + Pm.h / 2 - 0.2, Pm.z, Pm.hx * 2, Pm.h + 0.4, Pm.hz * 2, 2.4);
  rgb(k.plaster, CONCRETE_DARK);
  k.plaster.box(Pm.x, H0 + Pm.h + 0.12, Pm.z, Pm.hx * 2 + 0.5, 0.24, Pm.hz * 2 + 0.5, 2.4);
  rgb(k.metal, 0x4f6a5a);
  k.metal.box(Pm.x + Pm.hx + 0.03, H0 + 1.05, Pm.z + 0.4, 0.06, 2.1, 1.1, 1.2);
  rgb(k.glass, 0x161b22);
  k.glass.box(Pm.x - 1.2, H0 + 2.1, Pm.z - Pm.hz - 0.02, 1.4, 0.5, 0.05, 1);
  k.glass.box(Pm.x + 1.2, H0 + 2.1, Pm.z - Pm.hz - 0.02, 1.4, 0.5, 0.05, 1);
  for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
    const seg = { ax: Pm.x + ax * Pm.hx, az: Pm.z + az * Pm.hz, bx: Pm.x + bx * Pm.hx, bz: Pm.z + bz * Pm.hz };
    col.segs.push({ ...seg, r: 0.15, y0: H0 - 1, y1: H0 + Pm.h, box: true });
    footprints.push({ ...seg, r: 0.3 });
  }
  // face sud : porte de service rouillée, grille d'aération, coffret électrique
  rgb(k.metal, 0x6e4b38);
  k.metal.box(Pm.x - 1.6, H0 + 1.0, Pm.z + Pm.hz + 0.03, 1.0, 2.0, 0.06, 1.2);
  rgb(k.metal, 0x55595c);
  k.metal.box(Pm.x + 1.4, H0 + 2.2, Pm.z + Pm.hz + 0.03, 1.2, 0.6, 0.06, 0.4);
  rgb(k.metal, 0x8a8f92);
  k.metal.box(Pm.x + 2.6, H0 + 1.2, Pm.z + Pm.hz + 0.12, 0.6, 0.9, 0.24, 1.2);
  // vannes et tuyaux devant le local
  rgb(k.metal, 0x3f6b78);
  k.metal.box(Pm.x + 0.5, H0 + 0.45, Pm.z - Pm.hz - 1.0, 4.6, 0.36, 0.36, 1.2);
  k.metal.cyl(Pm.x - 1.3, H0, Pm.z - Pm.hz - 1.0, 0.3, 0.3, 1.0, 10, 1.2, true);
  rgb(k.metal, 0xb5412f);
  k.metal.cyl(Pm.x - 1.3, H0 + 1.0, Pm.z - Pm.hz - 1.0, 0.34, 0.34, 0.06, 12, 1.2, true);
  col.segs.push({ ax: Pm.x - 1.8, az: Pm.z - Pm.hz - 1.0, bx: Pm.x + 2.8, bz: Pm.z - Pm.hz - 1.0, r: 0.3, y0: H0 - 1, y1: H0 + 0.7 });

  // --- pylône du relais ---
  const M = SITE.mast, MH = 13;
  rgb(k.metal, 0xb9bcc0);
  for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]]) k.metal.box(M.x + dx, H0 + MH / 2, M.z + dz, 0.08, MH, 0.08, 1.2);
  for (let i = 0; i < 9; i++) {
    const yy = H0 + 0.9 + i * 1.45;
    k.metal.box(M.x, yy, M.z - 0.45, 0.9, 0.05, 0.05, 1.2);
    k.metal.box(M.x, yy, M.z + 0.45, 0.9, 0.05, 0.05, 1.2);
    k.metal.box(M.x - 0.45, yy, M.z, 0.05, 0.05, 0.9, 1.2);
    k.metal.box(M.x + 0.45, yy, M.z, 0.05, 0.05, 0.9, 1.2);
  }
  rgb(k.metal, 0xdadcdc);
  k.metal.obox(v3(M.x, H0 + 10.6, M.z - 0.75), v3(1, 0, 0), UP, v3(0, 0, 1), 0.6, 0.6, 0.06, 1.2);
  col.segs.push({ ax: M.x, az: M.z, bx: M.x + 0.01, bz: M.z, r: 0.7, y0: H0 - 1, y1: H0 + MH });
  footprints.push({ ax: M.x, az: M.z, bx: M.x + 0.01, bz: M.z, r: 0.9 });

  // --- caisses de munitions près du départ ---
  rgb(k.wood, 0x5c6247);
  for (const [dx, dz, r] of [[-3.2, 3.5, 0.2], [-3.5, 4.5, -0.3], [-3.3, 4.0, 0.1]] as number[][]) k.wood.box(SITE.start.x + dx, H0 + (dz === 4.0 ? 0.66 : 0.22), SITE.start.z + dz, 1.0, 0.44, 0.5, 1.5, r);
  col.segs.push({ ax: SITE.start.x - 3.3, az: SITE.start.z + 3.4, bx: SITE.start.x - 3.4, bz: SITE.start.z + 4.6, r: 0.55, y0: H0 - 1, y1: H0 + 0.9 });

  kitMeshes(engine, k, tex, col, masonry.group);

  // --- abri du râtelier (bois) ---
  const wb = new GeoBuilder();
  masonry.rackShelter(wb, col, SITE.rack);
  const wood = new Mesh(wb.build(), masonry.woodMat);
  wood.castShadow = wood.receiveShadow = true;
  masonry.group.add(wood);
  col.addGeometry(wood.geometry, null, 'wood');

  // manche à air du pylône et fanion du mirador : le vent au poste
  buildFlags(engine, wind, masonry.group, [
    [M.x, H0 + MH - 1.2, M.z, 2.6, 0xd9541e],
    [T.x1 - 0.2, H0 + T.floor + 2.6, T.z1 - 0.2, 1.7, 0xd9d2c2],
  ]);
  return { masonry, footprints };
}

// ---------------------------------------------------------------------------------------------
// Ce que le joueur sait du site.
// ---------------------------------------------------------------------------------------------
/** Zone praticable : le bout de l'éperon, jusqu'au bord des dalles. */
function allowed(x: number, z: number): boolean {
  return Math.hypot(x, z) < SITE.radius - 3.2;
}

export const nav: SiteNav = {
  allowed,
  surfaceAt(x: number, z: number): Surface {
    return SITE.paved.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr * 0.85) ? 'stone' : 'gravel';
  },
  /** Le pied puis le haut de l'escalier pour le mirador. */
  waypoint(key: string, pos: Vector3): { x: number; z: number; hint: string } | null {
    if (key !== 'mirador') return null;
    const up = pos.y - H0;
    const sx = (STAIR.x0 + STAIR.x1) / 2;
    if (up < STAIR.rise - 0.5) {
      const onStair = Math.abs(pos.x - sx) < 1 && ((up > 0.25 && pos.z < STAIR.zBottom) || pos.z < STAIR.zBottom + 1.6) && pos.z > STAIR.landingZ - 0.5;
      return { x: sx, z: onStair ? STAIR.zTop - 1.0 : STAIR.zBottom + 0.9, hint: onStair ? 'plate-forme' : 'escalier' };
    }
    // sur le palier : finir de monter, puis passer la porte de la plate-forme avant de viser le poste
    if (pos.x < MIRADOR.x0 + 0.55) return { x: pos.z > STAIR.zTop - 0.5 ? sx : MIRADOR.x0 + 1.1, z: STAIR.zTop - 1.0, hint: 'plate-forme' };
    return null;
  },
};

/** Pas d'herbe sous le mirador, l'escalier ni le local. */
export function grassBlocked(x: number, z: number): boolean {
  if (x > STAIR.x0 - 0.3 && x < MIRADOR.x1 + 0.3 && z > MIRADOR.z0 - 0.3 && z < STAIR.zBottom + 0.5) return true;
  const P = SITE.pump;
  return Math.abs(x - P.x) < P.hx + 0.4 && Math.abs(z - P.z) < P.hz + 1.6;
}
