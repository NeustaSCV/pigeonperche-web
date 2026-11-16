import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Colliders } from '../src/world/colliders';
import { solidifyAround } from '../src/world/solidify';

const box = (x: number, y: number, z: number, opts: Record<string, unknown> = {}): Mesh => {
  const m = new Mesh(new BoxGeometry(1, 4, 1), new MeshBasicMaterial(opts));
  m.position.set(x, y, z);
  return m;
};
const setup = (fill: (g: Group) => void): Colliders => {
  const col = new Colliders();
  // le BVH principal existe déjà quand les décors proches des cibles arrivent
  col.addGeometry(new BoxGeometry(1, 1, 1).toNonIndexed(), new Matrix4().makeTranslation(0, -500, 0), 'stone');
  col.build();
  const g = new Group();
  fill(g);
  solidifyAround([g], [new Vector3(0, 2, -100)], 14, col);
  col.buildExtra();
  return col;
};
const through = (col: Colliders, x: number): number => col.segment(new Vector3(x, 2, 0), new Vector3(x, 2, -200));

describe('décors proches des cibles', () => {
  it('un mât à côté de la cible arrête la ligne de visée', () => {
    const col = setup((g) => g.add(box(3, 2, -100)));
    expect(through(col, 3)).toBeCloseTo(99.5, 1);
    expect(through(col, 6)).toBe(-1);
  });
  it('ce qui est loin des cibles reste hors des collisions', () => {
    const col = setup((g) => g.add(box(40, 2, -100)));
    expect(through(col, 40)).toBe(-1);
  });
  it('mobile, souple, translucide ou découpé : laissés de côté', () => {
    const col = setup((g) => {
      const moving = box(-4, 2, -100); moving.userData.moving = true;
      const soft = box(-2, 2, -100); soft.userData.soft = true;
      const glass = box(0, 2, -100, { transparent: true, opacity: 0.3 });
      const leaf = box(2, 2, -100, { alphaTest: 0.5 });
      g.add(moving, soft, glass, leaf);
    });
    for (const x of [-4, -2, 0, 2]) expect(through(col, x)).toBe(-1);
  });
  it('plusieurs matières : le groupe vitré reste traversable, le reste arrête', () => {
    const col = setup((g) => {
      const geo = new BoxGeometry(1, 4, 1);
      const wall = new Mesh(geo, [0, 1, 2, 3, 4, 5].map(() => new MeshBasicMaterial()));
      wall.position.set(3, 2, -100);
      const pane = new Mesh(geo.clone(), [0, 1, 2, 3, 4, 5].map(() => new MeshBasicMaterial({ transparent: true, opacity: 0.3 })));
      pane.position.set(-3, 2, -100);
      g.add(wall, pane);
    });
    expect(through(col, 3)).toBeCloseTo(99.5, 1);
    expect(through(col, -3)).toBe(-1);
  });
  it('instances : seules celles proches d’une cible entrent', () => {
    const col = setup((g) => {
      const im = new InstancedMesh(new BoxGeometry(1, 4, 1), new MeshBasicMaterial(), 2);
      im.setMatrixAt(0, new Matrix4().makeTranslation(5, 2, -100));
      im.setMatrixAt(1, new Matrix4().makeTranslation(60, 2, -100));
      g.add(im);
    });
    expect(through(col, 5)).toBeCloseTo(99.5, 1);
    expect(through(col, 60)).toBe(-1);
  });
});
