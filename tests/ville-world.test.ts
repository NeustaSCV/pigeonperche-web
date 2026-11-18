// Carte « ville » : ce que le jeu calcule à partir de public/ville/ sans rien dessiner. Les emplacements déplacés
// côté client (grues, toits) doivent rester près de la position que le serveur connaît (il tolère 40 m) ; aucun œil
// dans un bâtiment ; courbure nulle au centre et de −16 m aux bords ; la table `visibles` du fichier, calculée à
// part, doit se retrouver en lançant des rayons d'œil à œil dans le BVH des bâtiments (celui qui arrête les balles)
// et contre les houppiers des arbres (qui cachent la vue sans arrêter la balle).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEVELS, CAMPAIGNS, LEVEL_IDS } from '../src/levels';
import { buildingChunks, chunkTriangles } from '../src/levels/ville/buildings';
import { BOMBE, EYE, VilleWorld, hash, readVille } from '../src/levels/ville/data';
import { SCORE_LEVELS } from '../src/shared/scores-core.mjs';
import { Colliders } from '../src/world/colliders';

const pub = (p: string): string => join('public', p);
let w: VilleWorld;
let col: Colliders;
let tris = 0;

beforeAll(async () => {
  const raw = await readVille(
    async (p) => JSON.parse(readFileSync(pub(p), 'utf8')),
    async (p) => { const b = readFileSync(pub(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
  );
  w = new VilleWorld(raw);
  const chunks = buildingChunks(w);
  const buf = chunkTriangles(chunks);
  tris = buf.length / 9;
  col = new Colliders();
  col.addBuffer(buf, 'stone');
  col.build();
}, 120000);

describe('carte ville', () => {
  it('est enregistrée hors campagne et hors classement', () => {
    expect(LEVEL_IDS).toContain('ville');
    expect(LEVELS.find((l) => l.id === 'ville')?.playable).toBe(true);
    for (const c of CAMPAIGNS) expect(c.levels).not.toContain('ville');
    expect(SCORE_LEVELS as string[]).not.toContain('ville');
  });

  it('courbure : nulle au centre, −16 m aux bords et au-delà', () => {
    expect(BOMBE).toBe(16);
    expect(w.bendY(w.BCX, w.BCZ)).toBeCloseTo(0, 12);
    for (const [x, z] of [[w.OX, w.BCZ], [w.OX + w.N, w.BCZ], [w.BCX, w.OZ], [w.BCX, w.OZ + w.N], [w.OX, w.OZ], [w.OX + w.N, w.OZ + w.N], [w.OX - 5000, w.BCZ + 300], [w.BCX, w.OZ + w.N + 9000]])
      expect(w.bendY(x, z)).toBeCloseTo(-16, 12);
    // jamais positive, jamais sous −16 m, et de plus en plus basse en s'éloignant du centre
    let prev = 0;
    for (let d = 0; d <= w.BH; d += 100) { const b = w.bendY(w.BCX + d, w.BCZ); expect(b).toBeLessThanOrEqual(prev + 1e-12); expect(b).toBeGreaterThanOrEqual(-16); prev = b; }
  });

  it('trente-neuf emplacements, chacun à moins de 30 m de sa position dans emplacements.json', () => {
    expect(w.emp.length).toBe(39);
    const moved = w.emp.map((e) => ({ n: e.n, type: e.type, d: Math.hypot(e.x + e.ox - e.x0, e.z + e.oz - e.z0) })).sort((a, b) => b.d - a.d);
    console.log('déplacements les plus grands (m) :', moved.slice(0, 6).map((m) => `n° ${m.n} ${m.type} ${m.d.toFixed(1)}`).join(' ; '));
    for (const m of moved) expect(m.d, `emplacement n° ${m.n}`).toBeLessThan(30);
    // les trois grues portent un emplacement
    expect(w.emp.filter((e) => e.grue).length).toBe(3);
    expect(w.grues.length).toBeGreaterThanOrEqual(3);
  });

  it('aucun œil dans un bâtiment, et chaque tireur a les pieds au-dessus du sol', () => {
    for (const e of w.emp) {
      const x = e.x + e.ox, z = e.z + e.oz;
      expect(w.inBuilding(x, e.y, z), `œil de l'emplacement n° ${e.n}`).toBe(false);
      // le plancher (1,6 m sous l'œil) n'est pas non plus dans un volume : au plus posé dessus
      expect(w.inBuilding(x, e.y - EYE + 0.05, z), `plancher de l'emplacement n° ${e.n}`).toBe(false);
      expect(e.y - EYE).toBeGreaterThan(w.groundY(x, z) + 2);
    }
  });

  it('la table `visibles` du fichier se retrouve avec le BVH des bâtiments et les houppiers des arbres', () => {
    expect(tris).toBeGreaterThan(300000);
    const eyes = w.emp.map((e) => { const p = w.eyeOf(e); return new Vector3(p.x, p.y, p.z); });
    const table = w.raw.visibles.map((l) => new Set(l));
    const trees = w.raw.arbres, nTrees = trees.length / 8;
    // un arbre cache la vue (pas la balle, qui traverse les houppiers) : cylindre du rayon du houppier dessiné, jusqu'à la cime
    const treeHides = (a: Vector3, dir: Vector3, len: number): boolean => {
      for (let k = 0; k < nTrees; k++) {
        const x = trees[k * 8], z = trees[k * 8 + 2], h = trees[k * 8 + 3];
        const t = (x - a.x) * dir.x + (z - a.z) * dir.z;
        if (t < 20 || t > len - 20) continue;
        const r = Math.max(1.8, h * (0.27 + 0.10 * hash(x, z)));
        if (Math.hypot(a.x + dir.x * t - x, a.z + dir.z * t - z) > r) continue;
        if (a.y + dir.y * t < trees[k * 8 + 1] + w.bendY(x, z) + h) return true;
      }
      return false;
    };
    let bvh = 0, both = 0, total = 0, openOnly = 0;
    const dir = new Vector3(), a = new Vector3(), b = new Vector3();
    for (let i = 0; i < eyes.length; i++) for (let j = i + 1; j < eyes.length; j++) {
      // d'œil à œil, en laissant 2 m à chaque bout (perchoir, acrotère sous les pieds)
      dir.subVectors(eyes[j], eyes[i]);
      const len = dir.length();
      dir.divideScalar(len);
      a.copy(eyes[i]).addScaledVector(dir, 2);
      b.copy(eyes[i]).addScaledVector(dir, len - 2);
      const clear = col.segment(a, b) < 0;
      const listed = table[i].has(w.emp[j].n) || table[j].has(w.emp[i].n);
      total++;
      if (clear === listed) bvh++;
      else if (clear) openOnly++;
      if ((clear && !treeHides(a, dir, len - 4)) === listed) both++;
    }
    const pBvh = (100 * bvh) / total, pBoth = (100 * both) / total;
    console.log(`visibles : bâtiments seuls ${bvh}/${total} (${pBvh.toFixed(1)} %), dont ${openOnly} paires ouvertes aux balles que la table dit masquées ; bâtiments et arbres ${both}/${total} (${pBoth.toFixed(1)} %) ; ${tris} triangles`);
    expect(total).toBe(741);
    // la table a été calculée avec les arbres : les bâtiments seuls (ce qui arrête les balles) en retrouvent 87 %
    expect(pBvh).toBeGreaterThanOrEqual(85);
    expect(pBoth).toBeGreaterThanOrEqual(95);
  });
});
