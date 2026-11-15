// Site de tir du niveau « Le Château d'eau » : une plate-forme de caillebotis et de madriers posée sur le toit de la
// cuve, autour du lanterneau — trente mètres au-dessus de la butte, vue à 360°. Garde-corps tout autour (on ne tombe
// jamais), abri du râtelier, manche à air. Le château d'eau lui-même vient de la banque (data.buildings).
import { Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Surface } from '../../audio/types';
import { GeoBuilder } from '../../core/builder';
import { buildFlags } from '../../world/flags';
import { Kit, kitMeshes, loadKitTextures, rgb } from '../../world/kit';
import { Masonry } from '../../world/masonry';
import type { LevelHost, SiteNav } from '../types';
import { DECK, DECK_H, DECK_Y, POSTS, SITE, polar } from './map';

const H0 = DECK_Y;
const UP = new Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface SiteBuild {
  masonry: Masonry;
}

export async function buildSite(h: LevelHost): Promise<SiteBuild> {
  const { engine, col, wind } = h;
  const masonry = new Masonry(H0);
  const [tex] = await Promise.all([loadKitTextures(engine.q.anisotropy), masonry.init(engine)]);
  const k = new Kit();

  // --- plancher : madriers parallèles, découpés en couronne autour du lanterneau ---
  const R = DECK.r, core = DECK.core - 0.25;
  for (let i = 0, z = -R + 0.16; z < R; z += 0.32, i++) {
    const c = Math.sqrt(Math.max(0, R * R - z * z));
    if (c < 0.3) continue;
    rgb(k.wood, 0x8b7758, 0.86 + ((i * 7) % 5) * 0.05);
    const inner = Math.abs(z) < core ? Math.sqrt(core * core - z * z) : 0;
    if (inner > 0) {
      k.wood.box(-(c + inner) / 2, H0 - 0.04, z, c - inner, 0.08, 0.3, 1.2);
      k.wood.box((c + inner) / 2, H0 - 0.04, z, c - inner, 0.08, 0.3, 1.2);
    } else k.wood.box(0, H0 - 0.04, z, 2 * c, 0.08, 0.3, 1.2);
  }
  col.surfaces.push({ x0: -R - 0.3, x1: R + 0.3, z0: -R - 0.3, z1: R + 0.3, h: () => H0, kind: 'wood' });

  // --- charpente d'acier sous le plancher : ceinture, rayons, béquilles posées sur le toit de la cuve ---
  const N = 32;
  rgb(k.metal, 0x565c5e);
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
    const len = 2 * R * Math.sin(Math.PI / N);
    k.metal.obox(v3(Math.cos(am) * (R - 0.08), H0 - 0.2, Math.sin(am) * (R - 0.08)), v3(-Math.sin(am), 0, Math.cos(am)), UP, v3(Math.cos(am), 0, Math.sin(am)), len / 2 + 0.02, 0.12, 0.06, 1.2);
    if (i % 2 === 0) k.metal.obox(v3(Math.cos(a0) * (R + core) / 2, H0 - 0.17, Math.sin(a0) * (R + core) / 2), v3(Math.cos(a0), 0, Math.sin(a0)), UP, v3(-Math.sin(a0), 0, Math.cos(a0)), (R - core) / 2, 0.09, 0.05, 1.2);
    if (i % 4 === 0) {
      // béquille : du plancher au toit conique (28,05 m au bord, 29,65 m au lanterneau ; le plancher est à 29,8 m)
      const rr = R - 0.5, drop = DECK_H - (28.05 + (8.25 - rr) * (1.6 / 6.85)) + 0.15;
      k.metal.box(Math.cos(a0) * rr, H0 - 0.1 - drop / 2, Math.sin(a0) * rr, 0.1, drop, 0.1, 1.2);
    }
  }

  // --- garde-corps : 32 potelets, lisse haute et lisse basse. Ni l'un ni l'autre dans les collisions des balles
  //     (un potelet dans l'axe d'un tir couché l'arrêterait) : seulement des obstacles à la marche ---
  const rb = new GeoBuilder();
  const rr = DECK.rail;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
    const ax = Math.cos(a0) * rr, az = Math.sin(a0) * rr, bx = Math.cos(a1) * rr, bz = Math.sin(a1) * rr;
    rb.box(ax, H0 + 0.56, az, 0.05, 1.12, 0.05);
    const len = Math.hypot(bx - ax, bz - az);
    for (const y of [0.56, 1.1]) rb.obox(v3((ax + bx) / 2, H0 + y, (az + bz) / 2), v3(-Math.sin(am), 0, Math.cos(am)), UP, v3(Math.cos(am), 0, Math.sin(am)), len / 2 + 0.02, 0.022, 0.022);
    col.segs.push({ ax, az, bx, bz, r: 0.12, y0: H0 - 0.6, y1: H0 + 1.25 });
    col.soft.push({ x: (ax + bx) / 2, y: H0 + 0.6, z: (az + bz) / 2, r: 1.0 });
  }
  const rail = new Mesh(rb.build(), engine.setupMaterial(new MeshStandardMaterial({ color: 0x3f4648, roughness: 0.55, metalness: 0.5 }), undefined, 'plaineRail'));
  rail.castShadow = true;
  masonry.group.add(rail);
  // le lanterneau et le mât du relais, au centre : on en fait le tour
  col.segs.push({ ax: 0, az: 0, bx: 0.01, bz: 0, r: DECK.core, y0: H0 - 1, y1: H0 + 6 });

  // --- quelques caisses près du départ, une table d'observation contre le lanterneau ---
  rgb(k.wood, 0x5c6247);
  const S = SITE.start;
  k.wood.box(S.x + 2.3, H0 + 0.22, S.z - 1.2, 1.0, 0.44, 0.5, 1.5, 0.4);
  k.wood.box(S.x + 2.5, H0 + 0.22, S.z - 0.4, 1.0, 0.44, 0.5, 1.5, -0.2);
  k.wood.box(S.x + 2.4, H0 + 0.66, S.z - 0.8, 1.0, 0.44, 0.5, 1.5, 0.1);
  col.segs.push({ ax: S.x + 2.3, az: S.z - 1.3, bx: S.x + 2.5, bz: S.z - 0.3, r: 0.55, y0: H0 - 1, y1: H0 + 1.0 });

  kitMeshes(engine, k, tex, col, masonry.group);

  // --- abri du râtelier (bois) ---
  const wb = new GeoBuilder();
  masonry.rackShelter(wb, col, SITE.rack);
  const wood = new Mesh(wb.build(), masonry.woodMat);
  wood.castShadow = wood.receiveShadow = true;
  masonry.group.add(wood);
  col.addGeometry(wood.geometry, null, 'wood');

  // --- manche à air de la plate-forme (le vent au poste), sur un mât fixé au garde-corps nord-est ---
  const F = polar(48, DECK.rail - 0.05);
  buildFlags(engine, wind, masonry.group, [[F.x, H0, F.z, 3.4, 0xd9541e]]);
  col.soft.push({ x: F.x, y: H0 + 2.4, z: F.z, r: 2.2 });
  return { masonry };
}

// ---------------------------------------------------------------------------------------------
// Ce que le joueur sait du site.
// ---------------------------------------------------------------------------------------------
/** Zone praticable : la couronne du plancher. Le garde-corps et le lanterneau (collisions) arrêtent avant elle. */
function allowed(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  return r < DECK.rail - 0.05 && r > DECK.core - 0.4;
}

export const nav: SiteNav = {
  allowed,
  limit: () => null,
  surfaceAt(): Surface {
    return 'wood';
  },
  /** Le lanterneau est au milieu : si la ligne droite vers le poste le traverse, on en fait le tour par un point de la couronne. */
  waypoint(key: string, pos: Vector3): { x: number; z: number; hint: string } | null {
    const P = POSTS[key];
    if (!P) return null;
    const dx = P.x - pos.x, dz = P.z - pos.z, l2 = dx * dx + dz * dz;
    if (l2 < 1) return null;
    const t = Math.min(1, Math.max(0, -(pos.x * dx + pos.z * dz) / l2));
    if (Math.hypot(pos.x + dx * t, pos.z + dz * t) > DECK.core + 1.3) return null;
    // tourner du côté le plus court, d'un sixième de tour à la fois, à mi-couronne
    const a0 = Math.atan2(pos.z, pos.x), a1 = Math.atan2(P.z, P.x);
    let d = a1 - a0;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const a = a0 + Math.sign(d || 1) * Math.min(Math.abs(d), 1.05);
    const r = Math.max(4.6, Math.min(DECK.post, Math.hypot(pos.x, pos.z)));
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, hint: 'contourner le lanterneau' };
  },
};

/** Pas d'herbe du jeu dans le lot du château d'eau : le modèle fournit sa pelouse et sa cour. */
export function grassBlocked(x: number, z: number): boolean {
  return Math.abs(x - 6) < 29.5 && Math.abs(z - 11) < 24.5;
}
