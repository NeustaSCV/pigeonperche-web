import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Canopies } from '../src/world/canopy';
import { Glass } from '../src/world/glass';
import { GLASS_BLAST_J, GLASS_CRACK_J, glassLevel } from '../src/world/glassfx';

describe('vitres', () => {
  const glass = new Glass();
  // deux fenêtres côte à côte (boîtes minces face au nord), une verrière à plat
  glass.add(new BoxGeometry(0.84, 1.2, 0.06), new Matrix4().makeTranslation(0, 2, -50));
  glass.add(new BoxGeometry(0.84, 1.2, 0.06), new Matrix4().makeTranslation(3, 2, -50));
  glass.add(new PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new Matrix4().makeTranslation(10, 0, -50));
  glass.build();
  const out: { pane: any; d: number }[] = [];
  it('une boîte mince fait un carreau, la surface à plat est écartée', () => {
    expect(glass.panes.length).toBe(2);
    const p = glass.panes[0];
    expect(p.hu).toBeCloseTo(0.42, 2);
    expect(p.hv).toBeCloseTo(0.6, 2);
    expect(Math.abs(p.n.z)).toBeCloseTo(1, 3);
  });
  it('un segment traverse le carreau une seule fois, à la bonne distance', () => {
    expect(glass.cross(new Vector3(0, 2, 0), new Vector3(0, 2, -100), 100, out)).toBe(1);
    expect(out[0].d).toBeCloseTo(49.97, 1);
    expect(out[0].pane).toBe(glass.panes.find((p) => Math.abs(p.center.x) < 0.1));
  });
  it('rien à côté, rien au-delà de l’obstacle', () => {
    expect(glass.cross(new Vector3(1.5, 2, 0), new Vector3(1.5, 2, -100), 100, out)).toBe(0);
    expect(glass.cross(new Vector3(0, 2, 0), new Vector3(0, 2, -100), 40, out)).toBe(0);
  });
  it('l’effet dépend de l’énergie, et un carreau fêlé cède au coup suivant', () => {
    expect(glassLevel(GLASS_CRACK_J - 1, 0)).toBe('crack');
    expect(glassLevel(GLASS_CRACK_J - 1, 1)).toBe('break');
    expect(glassLevel(GLASS_CRACK_J, 0)).toBe('break');
    expect(glassLevel(GLASS_BLAST_J, 0)).toBe('blast');
  });
});

describe('couronnes des arbres', () => {
  const leaf = new MeshBasicMaterial({ alphaTest: 0.4 });
  const tree = new InstancedMesh(new BoxGeometry(4, 6, 4).translate(0, 7, 0), leaf, 2);
  tree.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -100));
  tree.setMatrixAt(1, new Matrix4().makeTranslation(40, 0, -100));
  const grass = new InstancedMesh(new BoxGeometry(1, 0.5, 1), leaf, 1);
  grass.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -50));
  const rock = new InstancedMesh(new BoxGeometry(4, 6, 4), new MeshBasicMaterial(), 1);
  rock.setMatrixAt(0, new Matrix4().makeTranslation(20, 0, -100));
  const c = new Canopies();
  for (const m of [tree, grass, rock]) c.collect(m);
  it('seuls les arbres comptent', () => {
    const only = new Canopies();
    only.collect(tree);
    expect(only.count).toBe(2);
    const none = new Canopies();
    none.collect(grass); expect(none.count).toBe(0);
    none.collect(rock); expect(none.count).toBe(0);
  });
  it('un pas de vol qui entre dans la couronne la signale une fois', () => {
    const only = new Canopies();
    only.collect(tree);
    const seen = new Set<number>();
    let n = 0;
    for (let z = -90; z > -110; z -= 2) only.enter(new Vector3(0, 7, z), new Vector3(0, 7, z - 2), seen, (i) => { seen.add(i); n++; });
    expect(n).toBe(1);
    // au-dessus de l'arbre : rien
    let above = 0;
    for (let z = -90; z > -110; z -= 2) only.enter(new Vector3(0, 14, z), new Vector3(0, 14, z - 2), null, () => above++);
    expect(above).toBe(0);
  });
});
