// Site de tir du niveau « fete » : une terrasse de bois posée sur le toit mansardé du Grand Hôtel, au bout nord du
// faîtage (le toit du modèle n'a aucun plancher praticable : deux pans de zinc et un brisis d'ardoise). Plancher sur
// solives, garde-corps blancs à l'ouest, à l'est et au sud, bord nord ouvert pour le tir (simple butée), une souche
// de cheminée de l'hôtel qui traverse le plancher, l'abri du râtelier. Et ce que le joueur a besoin d'en savoir.
import { Mesh, MeshStandardMaterial } from 'three';
import type { Surface } from '../../audio/types';
import { GeoBuilder } from '../../core/builder';
import type { LevelHost, SiteNav } from '../types';
import { Masonry } from '../../world/masonry';
import { BASE_Y, DECK, HOTEL_GROUND, POSTS } from './map';

const H0 = BASE_Y;

/** Monte la terrasse et pose ses collisions. */
export async function buildDeck(h: LevelHost): Promise<Masonry> {
  const { engine, col } = h;
  const site = new Masonry(H0);
  await site.init(engine);
  const D = DECK;
  const cx = (D.x0 + D.x1) / 2, cz = (D.z0 + D.z1) / 2, dw = D.x1 - D.x0, dd = D.z1 - D.z0;
  const C = D.chimney;

  // --- bois brut : solives, chandelles posées sur le zinc, plancher, abri du râtelier, tapis de tir ---
  const wb = new GeoBuilder();
  // le toit monte de 18,1 m (pied du terrasson) à 19,1 m (faîtage, x = 0) : les chandelles suivent la pente
  const roofY = (x: number): number => HOTEL_GROUND + 18.15 + 0.95 * (1 - Math.min(1, Math.abs(x) / 6));
  for (let i = 0; i <= 6; i++) {
    const x = D.x0 + (i / 6) * dw;
    wb.box(x, H0 - 0.2, cz, 0.12, 0.2, dd, 1.1);
    for (const z of [D.z0 + 0.3, cz - 2, cz + 3, D.z1 - 0.3]) {
      const y0 = roofY(x) - 0.05, y1 = H0 - 0.3;
      if (y1 - y0 > 0.04) wb.box(x, (y0 + y1) / 2, z, 0.14, y1 - y0, 0.14, 1.1);
    }
  }
  for (const z of [D.z0 + 0.3, cz - 2, cz + 3, D.z1 - 0.3]) wb.box(cx, H0 - 0.36, z, dw, 0.12, 0.14, 1.1);
  const planks = Math.round(dw / 0.24);
  for (let i = 0; i < planks; i++) {
    const x = D.x0 + (i + 0.5) * (dw / planks);
    // le plancher s'ouvre autour de la souche de cheminée
    if (Math.abs(x - C.x) < C.hx + 0.1) {
      wb.box(x, H0 - 0.05 + (i % 2) * 0.006, (D.z0 + C.z - C.hz) / 2, dw / planks - 0.014, 0.07, C.z - C.hz - D.z0, 1.1);
      wb.box(x, H0 - 0.05 + (i % 2) * 0.006, (D.z1 + C.z + C.hz) / 2, dw / planks - 0.014, 0.07, D.z1 - C.z - C.hz, 1.1);
    } else wb.box(x, H0 - 0.05 + (i % 2) * 0.006, cz, dw / planks - 0.014, 0.07, dd + 0.2, 1.1);
  }
  col.surfaces.push({ x0: D.x0 - 0.15, x1: D.x1 + 0.15, z0: D.z0 - 0.15, z1: D.z1 + 0.15, h: () => H0, kind: 'wood' });
  // butée du bord nord : une lisse au ras du plancher, le tir passe par-dessus (la collision monte plus haut qu'elle)
  wb.box(cx, H0 + 0.035, D.z0 + 0.03, dw, 0.07, 0.08, 1.1);
  col.segs.push({ ax: D.x0, az: D.z0, bx: D.x1, bz: D.z0, r: 0.06, y0: H0 - 0.3, y1: H0 + 1.1, box: true });
  // tapis de tir (toile sur planches) et sac d'appui du poste accroupi
  const T = POSTS.tapis, A = POSTS.appui;
  wb.box(T.x, H0 + 0.012, T.z + 0.95, 0.9, 0.024, 2.1, 1.1);
  wb.box(A.x, H0 + 0.11, A.z - 0.36, 0.7, 0.22, 0.3, 1.1);
  // souche de cheminée : la collision seulement (elle est dans le modèle), et un banc adossé
  col.segs.push({ ax: C.x, az: C.z - C.hz + C.hx, bx: C.x, bz: C.z + C.hz - C.hx, r: C.hx + 0.12, y0: H0 - 1, y1: H0 + 2.2, box: true });
  site.rackShelter(wb, col, D.rack);
  const woodMesh = new Mesh(wb.build(), site.woodMat);
  woodMesh.castShadow = woodMesh.receiveShadow = true;
  site.group.add(woodMesh);
  col.addGeometry(woodMesh.geometry, null, 'wood');

  // --- garde-corps peints en blanc, comme la digue : lisse, sous-lisse, barreaux, poteaux ---
  const rb = new GeoBuilder();
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az), alongX = Math.abs(bx - ax) > 0.1;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    rb.box(mx, H0 + 1.02, mz, alongX ? len + 0.1 : 0.1, 0.07, alongX ? 0.1 : len + 0.1, 1);
    rb.box(mx, H0 + 0.16, mz, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, 1);
    const n = Math.round(len / 0.16);
    for (let i = 1; i < n; i++) {
      const u = i / n;
      rb.box(ax + (bx - ax) * u, H0 + 0.59, az + (bz - az) * u, 0.03, 0.82, 0.03, 1);
    }
    const posts = Math.max(1, Math.round(len / 2.4));
    for (let i = 0; i <= posts; i++) {
      const u = i / posts;
      rb.box(ax + (bx - ax) * u, H0 + 0.56, az + (bz - az) * u, 0.1, 1.12, 0.1, 1);
    }
    col.segs.push({ ax, az, bx, bz, r: 0.08, y0: H0 - 0.3, y1: H0 + 1.15, box: true });
  };
  rail(D.x0, D.z0, D.x0, D.z1);
  rail(D.x1, D.z0, D.x1, D.z1);
  rail(D.x0, D.z1, D.x1, D.z1);
  // mât de la manche à air, à l'angle nord-ouest
  rb.box(D.x0, H0 + 1.9, D.z0, 0.06, 3.8, 0.06, 1);
  const white = engine.setupMaterial(new MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.7 }), undefined, 'feterail');
  const railMesh = new Mesh(rb.build(), white);
  railMesh.castShadow = railMesh.receiveShadow = true;
  site.group.add(railMesh);
  col.addGeometry(railMesh.geometry, null, 'wood');
  return site;
}

// ---------------------------------------------------------------------------------------------
// Ce que le joueur sait de la terrasse.
// ---------------------------------------------------------------------------------------------
/** On ne marche que sur le plancher : le garde-corps et la butée arrêtent avant le vide. */
function allowed(x: number, z: number): boolean {
  return x > DECK.x0 + 0.2 && x < DECK.x1 - 0.2 && z > DECK.z0 + 0.2 && z < DECK.z1 - 0.2;
}

export const nav: SiteNav = {
  allowed,
  limit: () => null,
  surfaceAt(): Surface {
    return 'wood';
  },
  waypoint(key, pos) {
    // la souche de cheminée est entre le départ et le bord nord : on la contourne par l'est ou par l'ouest
    const C = DECK.chimney;
    const P = POSTS[key];
    if (P && pos.z > C.z - C.hz - 0.4 && Math.abs(pos.x - C.x) < C.hx + 0.9 && Math.abs(P.x - C.x) < 3) {
      const side = pos.x >= C.x ? 1 : -1;
      return { x: C.x + side * (C.hx + 1.3), z: C.z - C.hz - 0.6, hint: 'la cheminée' };
    }
    return null;
  },
};

/** Pas d'herbe sur un toit. */
export const grassBlocked = (): boolean => true;
