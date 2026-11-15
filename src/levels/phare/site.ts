// Site de tir du niveau « Le Phare » : la galerie de la lanterne (plancher, garde-corps et lanterne sont ceux du
// modèle du phare ; la carte y ajoute le râtelier, la trappe, le fanion et les collisions de marche) et, au fond de la
// crique, le musoir de pierre qui prolonge la digue des marais (second poste, au ras de l'eau).
// Et ce que le joueur a besoin d'en savoir : zone praticable, passages, trappe.
import { CylinderGeometry, Group, Matrix4, Vector3 } from 'three';
import type { Surface } from '../../audio/types';
import { buildFlags } from '../../world/flags';
import { Kit, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import type { LevelHost, SiteNav } from '../types';
import { BASE_Y, DIGUE_TOP, GALLERY, HATCH, MOLE, POSTS, RETURN, RING_R, SITE, bearingOf, ring } from './map';

const H0 = BASE_Y;
const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface SiteBuild {
  group: Group;
  /** fanions proches des postes : le plan proche de la lunette ne doit pas les couper */
  soft: { x: number; y: number; z: number; r: number }[];
}

export async function buildSite(h: LevelHost): Promise<SiteBuild> {
  const { engine, col, wind } = h;
  const tex = await loadKitTextures(engine.q.anisotropy);
  const k = new Kit();
  const group = new Group();
  const soft: SiteBuild['soft'] = [];

  // ================= la galerie =================
  // plancher : celui du modèle (dessus à 25,8 m du sol du phare) ; on marche dessus
  const F = GALLERY.rFloor + 0.05;
  col.surfaces.push({ x0: -F, x1: F, z0: -F, z1: F, h: () => H0, kind: 'stone' });
  // garde-corps (24 pans, comme les montants du modèle) et soubassement de la lanterne (10 pans) : on ne tombe jamais
  const poly = (r: number, n: number, thick: number, y1: number): void => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      col.segs.push({ ax: Math.cos(a) * r, az: Math.sin(a) * r, bx: Math.cos(b) * r, bz: Math.sin(b) * r, r: thick, y0: H0 - 0.4, y1: H0 + y1 });
    }
  };
  poly(GALLERY.rRail, 24, 0.06, 1.1);
  poly(GALLERY.rIn, 10, 0.06, GALLERY.lanternH);
  // la lanterne est vitrée (les vitres du modèle laissent passer balles et regards) : un fût plein, invisible, arrête
  // les balles et empêche la caméra à la troisième personne d'y entrer quand le tireur s'y adosse
  col.addGeometry(new CylinderGeometry(GALLERY.rIn - 0.1, GALLERY.rIn - 0.1, GALLERY.lanternH, 10, 1, true).toNonIndexed(), new Matrix4().makeTranslation(0, H0 + GALLERY.lanternH / 2, 0), 'metal');

  // râtelier adossé au soubassement de la lanterne, côté terre : montants, tablette (dessus à 0,28 m), lisse haute
  const R = SITE.rack, hw = SITE.rackHalf;
  rgb(k.wood, 0x6b5a48);
  for (const s of [-1, 1]) k.wood.box(R.x + s * hw, H0 + 0.75, R.z + 1.15, 0.08, 1.5, 0.3, 1);
  k.wood.box(R.x, H0 + 0.25, R.z + 1.1, hw * 2 + 0.1, 0.06, 0.34, 1);
  k.wood.box(R.x, H0 + 1.25, R.z + 1.22, hw * 2 + 0.1, 0.1, 0.06, 1);
  col.segs.push({ ax: R.x - hw, az: R.z + 1.14, bx: R.x + hw, bz: R.z + 1.14, r: 0.2, y0: H0 - 0.4, y1: H0 + 1.5 });
  // caisse de munitions, glissée entre le râtelier et la lanterne
  rgb(k.wood, 0x5c6247);
  k.wood.box(R.x + hw + 0.42, H0 + 0.17, R.z + 1.5, 0.62, 0.34, 0.36, 1, 0.5);

  // trappe de la galerie : panneau de bois cerclé de fer, anneau, et l'amorce de l'échelle contre la lanterne
  {
    const a = Math.atan2(HATCH.x, -HATCH.z);
    const rad = v3(Math.sin(a), 0, -Math.cos(a)), tan = v3(Math.cos(a), 0, Math.sin(a));
    const c = v3(HATCH.x, H0 + 0.025, HATCH.z);
    rgb(k.wood, 0x7a6248);
    k.wood.obox(c, tan, UP, rad, 0.42, 0.025, 0.4, 1);
    rgb(k.metal, 0x2f3533);
    for (const s of [-1, 1]) k.metal.obox(c.clone().addScaledVector(tan, s * 0.3).setY(H0 + 0.055), tan, UP, rad, 0.03, 0.008, 0.4, 1);
    k.metal.obox(c.clone().addScaledVector(rad, 0.22).setY(H0 + 0.075), tan, UP, rad, 0.07, 0.02, 0.02, 1);
    // deux crosses d'échelle, fixées au soubassement
    for (const s of [-1, 1]) {
      const p = v3(0, 0, 0).addScaledVector(rad, GALLERY.rIn + 0.1).addScaledVector(tan, s * 0.24);
      k.metal.box(p.x, H0 + 0.55, p.z, 0.04, 1.1, 0.04, 1);
    }
  }

  // ================= le musoir de la digue =================
  const M = MOLE, T = DIGUE_TOP;
  const len = M.z1 - M.z0, mz = (M.z0 + M.z1) / 2;
  // massif de pierre, du bord du lot de la digue jusqu'à sa tête, fondé sous l'eau
  rgb(k.stone, 0x9a958a);
  k.stone.box(M.x, T / 2 - 2.5, mz, M.half * 2 + 0.6, T + 5, len, 2.6, 0, true);
  // talus d'enrochement au pied, côté large
  rgb(k.stone, 0x7d786f);
  k.stone.box(M.x, -1.2, M.z1 + 0.9, M.half * 2 + 2.4, 2.6, 1.8, 2.6, 0, true);
  for (const s of [-1, 1]) k.stone.box(M.x + s * (M.half + 0.9), -1.4, mz + 4, 1.4, 2.2, len - 8, 2.6, 0, true);
  col.surfaces.push({ x0: M.x - M.half - 0.4, x1: M.x + M.half + 0.4, z0: M.gateZ - 1, z1: M.z1 + 0.05, h: () => T, kind: 'stone' });
  // parapets bas (0,55 m) : on s'y appuie, accroupi. Deux côtés et la tête.
  rgb(k.stone, 0xa9a397);
  const parapet = (ax: number, az: number, bx: number, bz: number): void => {
    const L = Math.hypot(bx - ax, bz - az);
    k.stone.box((ax + bx) / 2, T + 0.27, (az + bz) / 2, ax === bx ? 0.4 : L + 0.4, 0.55, ax === bx ? L : 0.4, 2.6);
    col.segs.push({ ax, az, bx, bz, r: 0.2, y0: T - 1, y1: T + 0.6, box: true });
  };
  parapet(M.x - M.half, M.z0 + 1, M.x - M.half, M.z1 - 0.2);
  parapet(M.x + M.half, M.z0 + 1, M.x + M.half, M.z1 - 0.2);
  parapet(M.x - M.half, M.z1 - 0.2, M.x + M.half, M.z1 - 0.2);
  // sur la crête de la digue, du musoir à la barrière : lisses de bois
  rgb(k.wood, 0x6b5a48);
  for (const s of [-1, 1]) {
    const x = M.x + s * M.half;
    k.wood.box(x, T + 0.85, (M.gateZ + M.z0 + 1) / 2, 0.07, 0.09, M.z0 + 1 - M.gateZ, 1);
    for (const z of [M.gateZ, M.gateZ + 2.2, M.z0 + 0.9]) k.wood.box(x, T + 0.45, z, 0.1, 0.95, 0.1, 1);
    col.segs.push({ ax: x, az: M.gateZ, bx: x, bz: M.z0 + 1, r: 0.2, y0: T - 1, y1: T + 1.0, box: true });
  }
  // barrière en travers de la crête : on ne remonte pas la digue
  k.wood.box(M.x, T + 0.95, M.gateZ, M.half * 2 + 0.3, 0.12, 0.1, 1);
  k.wood.box(M.x, T + 0.5, M.gateZ, M.half * 2 + 0.3, 0.1, 0.08, 1);
  rgb(k.wood, 0xb8b0a0);
  k.wood.obox(v3(M.x, T + 0.72, M.gateZ), v3(0.93, 0.36, 0).normalize(), v3(-0.36, 0.93, 0).normalize(), v3(0, 0, 1), M.half + 0.1, 0.05, 0.04, 1);
  col.segs.push({ ax: M.x - M.half - 0.2, az: M.gateZ, bx: M.x + M.half + 0.2, bz: M.gateZ, r: 0.14, y0: T - 1, y1: T + 1.1, box: true });
  // poteau de retour : caillebotis au sol, poteau et flèche de bois tournée vers le phare
  rgb(k.wood, 0x8a7458);
  for (let i = 0; i < 6; i++) k.wood.box(RETURN.x, T + 0.03, RETURN.z - 0.9 + i * 0.36, 2.0, 0.05, 0.3, 1);
  rgb(k.wood, 0x6b5a48);
  k.wood.box(RETURN.x - 1.75, T + 1.3, RETURN.z, 0.12, 2.6, 0.12, 1);
  rgb(k.plaster, 0xe9e3d2);
  k.plaster.box(RETURN.x - 1.75, T + 2.25, RETURN.z + 0.02, 0.06, 0.34, 1.3, 2);
  rgb(k.plaster, 0xb3261e);
  k.plaster.box(RETURN.x - 1.75, T + 2.25, RETURN.z + 0.8, 0.07, 0.2, 0.3, 2);
  col.segs.push({ ax: RETURN.x - 1.75, az: RETURN.z, bx: RETURN.x - 1.74, bz: RETURN.z, r: 0.12, y0: T - 1, y1: T + 2.6 });
  // deux bittes d'amarrage et un anneau sur la tête
  rgb(k.metal, 0x2b2e31);
  for (const s of [-1, 1]) k.metal.cyl(M.x + s * 1.5, T, M.z1 - 1.3, 0.16, 0.2, 0.42, 8, 1, true);

  kitMeshes(engine, k, tex, col, group);

  // fanions : sur le garde-corps de la galerie (côté ouest, hors des secteurs de tir) et en tête du musoir
  const fg = ring(232, GALLERY.rRail);
  const flags = [
    [fg.x, H0 + 0.2, fg.z, 2.6, 0xd9541e],
    [M.x - M.half + 0.1, T + 0.5, M.z1 - 0.3, 3.4, 0xd9541e],
  ];
  buildFlags(engine, wind, group, flags);
  for (const [x, y, z, hh] of flags) {
    const s = { x, y: y + hh - 0.4, z, r: 1.6 };
    soft.push(s);
    col.soft.push(s);
  }
  return { group, soft };
}

// ---------------------------------------------------------------------------------------------
// Ce que le joueur sait du site.
// ---------------------------------------------------------------------------------------------
/** Sur la galerie ? (sinon : sur la digue) */
export const onGallery = (y: number): boolean => y > H0 - 3;

/**
 * Zone praticable : l'anneau de la galerie, entre le soubassement de la lanterne et le garde-corps, et le musoir de la
 * digue jusqu'à la barrière. Partout les collisions (garde-corps, parapets, barrière) arrêtent avant la limite.
 */
function allowed(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < 8) return r > GALLERY.rIn + 0.1 && r < GALLERY.rRail - 0.12;
  return Math.abs(x - MOLE.x) < MOLE.half - 0.12 && z > MOLE.gateZ + 0.2 && z < MOLE.z1 - 0.3;
}

const wrap = (a: number): number => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

export const nav: SiteNav = {
  allowed,
  limit: () => null,
  surfaceAt(): Surface {
    return 'stone';
  },
  /**
   * Sur la galerie on tourne autour de la lanterne : point de passage sur l'anneau tant que la cible est à plus de
   * 43° ; le musoir se rejoint par la trappe, la galerie par le poteau de retour.
   */
  waypoint(key: string, pos: Vector3): { x: number; z: number; hint: string } | null {
    const up = onGallery(pos.y);
    const low = key === 'digue';
    if (!up) return low ? null : { x: RETURN.x, z: RETURN.z, hint: 'poteau du phare' };
    const P = POSTS[key];
    const tx = low ? HATCH.x : P.x, tz = low ? HATCH.z : P.z;
    const a = Math.atan2(pos.x, -pos.z), b = Math.atan2(tx, -tz);
    const d = wrap(b - a);
    if (Math.abs(d) < 0.75) return low ? { x: tx, z: tz, hint: 'trappe' } : null;
    const w = ring(((a + Math.sign(d) * 0.6) * 180) / Math.PI, RING_R);
    return { x: w.x, z: w.z, hint: low ? 'trappe' : 'galerie' };
  },
};
void bearingOf;
