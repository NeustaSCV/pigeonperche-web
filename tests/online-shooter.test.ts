// Tireur distant du mode en ligne (src/online/remote-shooter.ts) : zone de touche et orientation, sans moteur de rendu.
import { describe, expect, it } from 'vitest';
import { Mesh, Vector3 } from 'three';
import { weaponById } from '../src/config/weapons';
import { Rig, type Outfit } from '../src/player/character';
import { EYE_Y, HEAD_R, HEAD_Y, HIT_HALF, HIT_RADIUS, RemoteShooter, zoneOnLine } from '../src/online/remote-shooter';
import { rifleBlueprint } from '../src/weapons/rifle-model';

const OUTFIT: Outfit = { jacket: 0x3f4a3a, trousers: 0x2e3338, skin: 0xd9b08c, hat: 0x262a22, pack: null, boots: 0x1c1915, height: 1.0 };
const tireur = (): RemoteShooter => {
  const bp = rifleBlueprint(weaponById('375ct'), 0.5);
  const t = new RemoteShooter(7, 'Bob', new Rig(OUTFIT), { mesh: new Mesh(bp.merged), anchors: bp.anchors });
  t.place('E1', new Vector3(100, 50, -200), 0);
  return t;
};
/** balle horizontale venant du sud (elle vole vers −Z), à la hauteur `y` au-dessus des pieds et à `x` mètres de l'axe */
const balle = (t: RemoteShooter, y: number, x = 0) => t.segment(new Vector3(100 + x, 50 + y, -190), new Vector3(100 + x, 50 + y, -210));

describe('tireur distant', () => {
  it('zone de touche : un cylindre de 1 m de large et 2 m de haut', () => {
    const t = tireur();
    expect([HIT_HALF, HIT_RADIUS, HEAD_Y, HEAD_R, EYE_Y]).toEqual([1, 0.5, 1.62, 0.24, 1.6]);
    expect(balle(t, 1)?.part).toBe('torso');
    expect(balle(t, 0.05)?.part).toBe('torso');
    expect(balle(t, 1, 0.49)?.part).toBe('torso');
    expect(balle(t, 1, 0.51)).toBeNull();
    expect(balle(t, 2.05)).toBeNull();
    expect(balle(t, -0.05)).toBeNull();
  });
  it('tête : à moins de 24 cm de son centre, à 1,62 m au-dessus des pieds', () => {
    const t = tireur();
    expect(balle(t, 1.62)?.part).toBe('head');
    expect(balle(t, 1.62, 0.23)?.part).toBe('head');
    expect(balle(t, 1.62, 0.25)?.part).toBe('torso');
    expect(balle(t, 1.39)?.part).toBe('head');
    expect(balle(t, 1.37)?.part).toBe('torso');
    expect(balle(t, 1.85)?.part).toBe('head');
    expect(zoneOnLine(t.feet, new Vector3(100, 51.62, -150), new Vector3(100, 51.62, -199))).toBe('tete');      // la droite, pas le seul segment
    expect(zoneOnLine(t.feet, new Vector3(100, 51, -150), new Vector3(100, 51, -199))).toBe('corps');
  });
  it('abattu, il n’arrête plus les balles ; relevé, il les arrête de nouveau', () => {
    const t = tireur();
    t.setDown(true);
    expect(t.active).toBe(false); expect(balle(t, 1)).toBeNull();
    t.setDown(false);
    expect(t.active).toBe(true); expect(balle(t, 1)?.part).toBe('torso');
    expect(t.onHit({} as never)).toEqual({ kind: 'body' });      // la cible ne décide de rien : la touche vient du serveur
  });
  it('porte la carabine à l’épaule (hors de la zone de touche) et se tourne vers ce qu’il vise', () => {
    const t = tireur();
    const arme = t.group.children[0];
    expect(arme.visible).toBe(true);
    // à hauteur d'épaule, devant lui
    expect(arme.position.y).toBeGreaterThan(1.3); expect(arme.position.y).toBeLessThan(1.7);
    expect(arme.position.z).toBeGreaterThan(0);
    expect(t.colliders).toHaveLength(0);
    // d'abord vers le cap de l'emplacement (ici le nord), puis vers sa cible, à l'est
    expect(t.group.rotation.y).toBeCloseTo(Math.PI, 9);
    t.aimAt({ x: 900, z: -200 });
    expect(t.group.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    t.aimAlong(0, 1);                                              // un tir vers le sud
    expect(t.group.rotation.y).toBeCloseTo(0, 9);
    t.aimAt(null);
    expect(t.group.rotation.y).toBeCloseTo(Math.PI, 9);
    // la zone de touche ne tourne pas avec lui
    expect(balle(t, 1, 0.49)?.part).toBe('torso');
    // abattu : l'arme disparaît avec la visée
    t.setDown(true); t.update(0.1, {} as never);
    expect(arme.visible).toBe(false);
  });
});
