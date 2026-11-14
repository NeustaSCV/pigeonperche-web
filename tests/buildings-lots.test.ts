// Catalogue des lots (src/levels/building-lots.ts, sans dépendance : lu par les niveaux et par le générateur de
// relief) : il doit dire la même chose que le catalogue de l'adaptateur (src/buildings/catalog.ts), et le
// terrassement du générateur (tools/terrain-lib.mjs) doit mettre le lot à plat là où le jeu posera le bâtiment.
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/buildings/catalog';
import { SELECTION } from '../src/buildings/selection';
import { BUILDING_LOTS, lotCorners, lotDistance, lotOf, lotToWorld } from '../src/levels/building-lots';
// @ts-expect-error module Node sans types
import * as lib from '../tools/terrain-lib.mjs';
import * as STD from '../src/levels/standard/map';

describe('catalogue des lots', () => {
  it('chaque carte de la banque a son lot, de la même taille que dans la fiche', () => {
    let n = 0;
    for (const b of CATALOG)
      for (const c of b.cartes) {
        const lot = BUILDING_LOTS[c.id ? `${b.id}:${c.id}` : b.id];
        expect(lot, `${b.id}:${c.id}`).toBeDefined();
        expect([lot.l, lot.p, lot.own], `${b.id}:${c.id}`).toEqual([c.l, c.p, c.ownGround]);
        n++;
      }
    // les haltes entières ('id:*') s'ajoutent aux cartes
    expect(Object.keys(BUILDING_LOTS).length).toBe(n + CATALOG.filter((b) => b.halte).length);
  });
  it('lotOf : carte absente = la première de la fiche ; la sélection « premier choix » est connue', () => {
    expect(lotOf('eglise')).toEqual({ l: 60, p: 50, own: false, dug: 0 });
    expect(lotOf('sanatorium')).toBe(BUILDING_LOTS['sanatorium:galeries']);
    expect(lotOf('moulin')!.dug).toBeGreaterThan(2);
    expect(lotOf('inconnu')).toBeUndefined();
    for (const s of SELECTION) expect(lotOf(s.id, s.carte), s.id).toBeDefined();
  });
  it('géométrie du lot : même convention de lacet que l’adaptateur (placeBuilding / flattenArea)', () => {
    const spot = { id: 'eglise', x: 100, z: -200, yaw: Math.PI / 2 };
    // à yaw = +90° (sens trigonométrique vu de dessus), le +x local part vers le nord (−z)
    const [x, z] = lotToWorld(spot, 10, 0);
    expect(x).toBeCloseTo(100, 9);
    expect(z).toBeCloseTo(-210, 9);
    expect(lotDistance(spot, 100, -200)).toBe(0);
    expect(lotDistance(spot, 100 + 24.9, -200)).toBe(0); // profondeur 50 → 25 m le long de x monde
    expect(lotDistance(spot, 100 + 35, -200)).toBeCloseTo(10, 9);
    expect(lotDistance(spot, 100, -200 - 40)).toBeCloseTo(10, 9); // largeur 60 → 30 m le long de z monde
    expect(lotCorners(spot)).toHaveLength(4);
    expect(lotDistance({ id: 'inconnu', x: 0, z: 0, yaw: 0 }, 0, 0)).toBe(Infinity);
  });
});

describe('terrassement (tools/terrain-lib.mjs)', () => {
  const slope = (): any => {
    const T = lib.createGrid(1536, 257); // mailles de 6 m, comme le niveau standard
    for (let j = 0; j < T.N; j++) for (let i = 0; i < T.N; i++) T.H[T.idx(i, j)] = 100 + 0.12 * T.wx(i) - 0.05 * T.wx(j);
    return T;
  };
  it('le lot et sa bande sont à plat à l’altitude rendue ; au loin le relief est intact', () => {
    const T = slope();
    const spot = { id: 'eglise', x: 60, z: -40, yaw: 0.4 };
    const [b] = lib.flattenBuildings(T, [spot]);
    expect(b.groundY).toBeCloseTo(100 + 0.12 * 60 + 0.05 * 40, 0);
    for (const [x, z] of [...lotCorners(spot), [spot.x, spot.z], lotToWorld(spot, 40, 30)]) expect(T.sampleH(x, z)).toBeCloseTo(b.groundY, 4);
    const far = lotToWorld(spot, 120, 0);
    expect(T.sampleH(far[0], far[1])).toBeCloseTo(100 + 0.12 * far[0] - 0.05 * far[1], 3);
  });
  it('`groundY` imposé, fosse sous un modèle creusé, zone protégée par `keep`', () => {
    const T = slope();
    const [b] = lib.flattenBuildings(T, [{ id: 'moulin', x: 0, z: 0, yaw: 0, groundY: 90 }], { keep: (k: number) => (T.H[k] > 135 ? 0 : 1) });
    expect(b.groundY).toBe(90);
    const lot = lotOf('moulin')!;
    expect(T.sampleH(0, 0)).toBeCloseTo(90 - lot.dug - 0.4, 3); // fosse entière au cœur du lot
    expect(T.sampleH(lot.l / 2 + 6, 0)).toBeCloseTo(90, 3); // au bord et autour : le sol du bâtiment
    expect(lib.flattenBuildings(slope(), [{ id: 'eglise', x: 0, z: 0, yaw: 0 }])[0].groundY).toBeCloseTo(100, 1);
    expect(() => lib.flattenBuildings(slope(), [{ id: 'inconnu', x: 0, z: 0, yaw: 0 }])).toThrow(/inconnu/);
  });
  it('buildingClearing : pas de forêt dans le lot ni autour, forêt entière au-delà', () => {
    const f = lib.buildingClearing([{ id: 'eglise', x: 0, z: 0, yaw: 0 }], 14, 22);
    expect(f(0, 0)).toBe(0);
    expect(f(30 + 10, 0)).toBe(0);
    expect(f(30 + 40, 0)).toBe(1);
  });
  it('niveau standard : ses bâtiments sont au catalogue, hors route et rivière, et ne coupent aucune ligne de visée', () => {
    expect(STD.BUILDINGS.length).toBeGreaterThanOrEqual(3);
    expect(STD.BUILDINGS.length).toBeLessThanOrEqual(5);
    const road = lib.catmull(STD.ROAD, 16), river = lib.catmull(STD.RIVER, 24);
    const tmp = [0, 0, 0];
    for (const b of STD.BUILDINGS) {
      expect(lotOf(b.id, b.carte), b.id).toBeDefined();
      expect(SELECTION.find((s) => s.id === b.id)?.role, b.id).not.toBe('avoid');
      // tout le lot (pas de 4 m) à plus de 6 m du bord de la route et de l'eau, à 150 m du campement, hors de la place
      const lot = lotOf(b.id, b.carte)!;
      for (let lz = -lot.p / 2; lz <= lot.p / 2; lz += 4)
        for (let lx = -lot.l / 2; lx <= lot.l / 2; lx += 4) {
          const [x, z] = lotToWorld(b, lx, lz);
          lib.polyDist(x, z, road, tmp);
          expect(tmp[0], `${b.id} / route`).toBeGreaterThan(STD.ROAD_WIDTH / 2 + 6);
          lib.polyDist(x, z, river, tmp);
          expect(tmp[0], `${b.id} / rivière`).toBeGreaterThan(STD.RIVER_WIDTH / 2 + 4);
          expect(Math.hypot(x - STD.SITES.camp.x, z - STD.SITES.camp.z), `${b.id} / campement`).toBeGreaterThan(150);
          expect(Math.hypot(x - STD.SITES.village.x, z - STD.SITES.village.z), `${b.id} / place du marché`).toBeGreaterThan(30);
        }
    }
    // lignes de visée : sur un relief de contrôle à l'altitude des sites, aucune ne passe à moins de 40 m au-dessus d'un lot
    const T = lib.createGrid(STD.TERRAIN_SIZE, 65);
    T.H.fill(20);
    const placed = STD.BUILDINGS.map((b) => ({ ...b, groundY: b.groundY ?? 45 }));
    expect(STD.SIGHTLINES).toHaveLength(17);
    expect(lib.checkBuildingSightlines(T, placed, STD.SIGHTLINES, STD.POSTS, STD.SUMMIT_HEIGHT)).toEqual([]);
  });
});
