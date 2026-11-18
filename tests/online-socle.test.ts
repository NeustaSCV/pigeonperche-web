// Socle du mode en ligne : extensions du moteur du solo, toutes inertes par défaut.
import { BoxGeometry, Matrix4, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import type { Engine } from '../src/core/engine';
import type { Input } from '../src/core/input';
import type { SiteNav } from '../src/levels/types';
import { Player } from '../src/player/player';
import { Colliders } from '../src/world/colliders';
import type { Terrain } from '../src/world/terrain';
import { Wind, type WindSample } from '../src/world/wind';

describe('vent : facteur `wander`', () => {
  /** formule d'origine de `Wind.update`, recopiée : cap (degrés) et force à l'instant t, sans lissage en cours */
  const original = (t: number, base: number, from: number): { speed: number; dx: number; dz: number } => {
    const bearing = from + 14 * Math.sin(t * 0.011) + 7 * Math.sin(t * 0.037 + 1.3);
    const b = ((bearing + 180) * Math.PI) / 180;
    return { speed: base * (1 + 0.22 * Math.sin(t * 0.017 + 1) + 0.1 * Math.sin(t * 0.053)), dx: Math.sin(b), dz: -Math.cos(b) };
  };

  it('à 1 (défaut), le vent est celui d’origine au bit près', () => {
    const w = new Wind();
    expect(w.wander).toBe(1);
    w.configure({ fromBearing: 255, speed: 3.5 });
    let t = 0;
    for (let i = 0; i < 400; i++) {
      const dt = 0.016 + (i % 7) * 0.003;
      w.update(dt);
      t += dt;
      const o = original(t, 3.5, 255);
      expect(w.speedNow).toBe(o.speed);
      expect(w.dir.x).toBe(o.dx);
      expect(w.dir.y).toBe(o.dz);
    }
  });

  it('à 0, cap et force moyenne ne bougent plus', () => {
    const w = new Wind();
    w.configure({ fromBearing: 90, speed: 4, wander: 0 });
    const dx = w.dir.x, dz = w.dir.y;
    for (let i = 0; i < 2000; i++) {
      w.update(0.5);
      expect(w.speedNow).toBe(4);
      expect(w.dir.x).toBe(dx);
      expect(w.dir.y).toBe(dz);
    }
    // vent venu de l'est : il va vers l'ouest
    expect(dx).toBeCloseTo(-1, 12);
    expect(dz).toBeCloseTo(0, 12);
  });

  it('à 0 et sans rafales, le vent est le même partout et à tout instant', () => {
    const w = new Wind();
    w.configure({ fromBearing: 0, speed: 5, wander: 0, gusts: 0, shelter: 1 });
    const a: WindSample = { x: 0, z: 0, speed: 0, gust: 0 }, b: WindSample = { x: 0, z: 0, speed: 0, gust: 0 };
    w.sample(0, 100, 0, a);
    for (let i = 0; i < 50; i++) {
      w.update(3.7);
      w.sample(i * 83 - 2000, 100 + i, 1500 - i * 61, b);
      expect(b.speed).toBe(a.speed);
      expect(b.x).toBe(a.x);
      expect(b.z).toBe(a.z);
    }
    expect(a.speed).toBe(5);
  });

  it('entre 0 et 1, l’errance est réduite d’autant', () => {
    const full = new Wind(), half = new Wind();
    full.configure({ speed: 4 });
    half.configure({ speed: 4, wander: 0.5 });
    for (let i = 0; i < 200; i++) {
      full.update(1);
      half.update(1);
      expect(half.speedNow - 4).toBeCloseTo((full.speedNow - 4) / 2, 12);
    }
  });
});

describe('collisions : `addBuffer`', () => {
  /** triangles en espace monde d'une boîte posée en (x, y, z) */
  const boxTris = (x: number, y: number, z: number, sx = 2, sy = 2, sz = 2): number[] => {
    const g = new BoxGeometry(sx, sy, sz).toNonIndexed();
    g.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
    return Array.from(g.getAttribute('position').array as Float32Array);
  };
  const rays: [Vector3, Vector3][] = [];
  for (let i = 0; i < 60; i++) {
    const a = new Vector3(-30 + i * 1.03, 0.2 + (i % 5) * 0.37, 40), b = new Vector3(25 - i * 0.71, 0.9 - (i % 3) * 0.4, -60);
    rays.push([a, b]);
  }
  const probe = (col: Colliders): { d: number; p: number[]; tag: string }[] =>
    rays.map(([a, b]) => {
      const p = new Vector3(), t = { tag: 'stone' as const };
      const d = col.segment(a, b, p, t as never);
      return { d, p: d >= 0 ? p.toArray() : [], tag: d >= 0 ? t.tag : '' };
    });
  const parts: [number[], 'stone' | 'wood' | 'metal'][] = [
    [boxTris(-8, 0, 0), 'stone'], [boxTris(0, 0.5, -12, 6, 3, 1), 'wood'], [boxTris(7, 0, -30, 3, 3, 3), 'metal'], [boxTris(2, 0, 10, 1, 4, 1), 'stone'],
  ];

  it('mêmes lancers de rayon qu’`addTriangles`, matières comprises', () => {
    const ref = new Colliders(), buf = new Colliders();
    for (const [xyz, tag] of parts) { ref.addTriangles(xyz, tag); buf.addBuffer(new Float32Array(xyz), tag); }
    ref.build();
    buf.build();
    const want = probe(ref);
    expect(want.filter((h) => h.d >= 0).length).toBeGreaterThan(10);
    expect(new Set(want.map((h) => h.tag)).size).toBeGreaterThan(2);
    expect(probe(buf)).toEqual(want);
  });

  it('mélangé à `addTriangles` et `addGeometry`, l’ordre des appels est gardé', () => {
    const ref = new Colliders(), mix = new Colliders();
    for (const [xyz, tag] of parts) ref.addTriangles(xyz, tag);
    mix.addTriangles(parts[0][0], parts[0][1]);
    mix.addBuffer(new Float32Array(parts[1][0]), parts[1][1]);
    mix.addBuffer(new Float32Array(parts[2][0]), parts[2][1]);
    mix.addGeometry(new BoxGeometry(1, 4, 1).toNonIndexed(), new Matrix4().makeTranslation(2, 0, 10), 'stone');
    ref.build();
    mix.build();
    expect(probe(mix)).toEqual(probe(ref));
  });

  it('second BVH (`buildExtra`) : pareil, et le nombre de triangles est rendu', () => {
    const ref = new Colliders(), buf = new Colliders();
    ref.addTriangles(parts[0][0], parts[0][1]);
    buf.addTriangles(parts[0][0], parts[0][1]);
    ref.build();
    buf.build();
    for (const [xyz, tag] of parts.slice(1)) { ref.addTriangles(xyz, tag); buf.addBuffer(new Float32Array(xyz), tag); }
    expect(buf.buildExtra()).toBe(ref.buildExtra());
    expect(probe(buf)).toEqual(probe(ref));
    // tout est consommé : rien de plus à construire
    expect(buf.buildExtra()).toBe(0);
  });

  it('refuse un tableau qui n’est pas fait de triangles entiers', () => {
    expect(() => new Colliders().addBuffer(new Float32Array(10), 'stone')).toThrow();
  });
});

describe('joueur : `locked` et `braced`', () => {
  const engine = { setupMaterial: (m: Material) => m } as unknown as Engine;
  const terrain = { heightAt: () => 0, raycast: () => false } as unknown as Terrain;
  const nav: SiteNav = { allowed: () => true, surfaceAt: () => 'grass' };
  const make = (): Player => new Player(engine, terrain, new Colliders(), { footstep: () => {}, cloth: () => {} }, undefined, { baseY: 0, start: { x: 0, z: 0, yaw: 0 }, posts: {} }, nav);
  /** entrées : touches tenues, touches frappées à cette image, déplacement de la souris */
  const input = (down: string[] = [], hit: string[] = [], dx = 0, dy = 0): Input =>
    ({ dx, dy, enabled: true, axisX: 0, axisY: 0, run: false, down: (c: string) => down.includes(c), hit: (c: string) => hit.includes(c) }) as unknown as Input;
  const walk = (p: Player, sec: number, keys = ['KeyW']): void => { for (let t = 0; t < sec; t += 1 / 60) p.update(1 / 60, input(keys), false); };

  it('par défaut (solo), le joueur marche et change de posture', () => {
    const p = make();
    expect(p.locked).toBe(false);
    expect(p.braced).toBe(false);
    walk(p, 1);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThan(1);
    p.update(1 / 60, input([], ['KeyC']), false);
    expect(p.stance).toBe('crouch');
    // accroupi sans mur à portée : pas d'appui
    expect(p.supported).toBe(false);
  });

  it('`locked` : ni déplacement ni changement de posture, le regard reste libre', () => {
    const p = make();
    p.locked = true;
    walk(p, 1, ['KeyW', 'KeyD', 'ShiftLeft']);
    expect(p.pos.x).toBe(0);
    expect(p.pos.z).toBe(0);
    expect(p.moving).toBe(false);
    for (const k of ['KeyC', 'KeyX', 'ControlLeft', 'Space']) p.update(1 / 60, input([], [k]), false);
    expect(p.stance).toBe('stand');
    // manette analogique (tactile) : sans effet non plus
    const stick = input();
    (stick as { axisY: number }).axisY = 1;
    for (let i = 0; i < 60; i++) p.update(1 / 60, stick, false);
    expect(p.pos.z).toBe(0);
    const yaw = p.yaw, pitch = p.pitch;
    p.update(1 / 60, input([], [], 100, -50), false);
    expect(p.yaw).toBeGreaterThan(yaw);
    expect(p.pitch).toBeGreaterThan(pitch);
  });

  it('`locked` levé : le joueur repart', () => {
    const p = make();
    p.locked = true;
    walk(p, 0.5);
    p.locked = false;
    walk(p, 1);
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThan(1);
  });

  it('`braced` : appui forcé dans toutes les postures, sans mur', () => {
    const p = make();
    p.braced = true;
    for (const s of ['stand', 'crouch', 'prone'] as const) {
      p.teleport(0, 0, 0, s);
      p.update(1 / 60, input(), false);
      expect(p.supported).toBe(true);
    }
    p.braced = false;
    p.update(1 / 60, input(), false);
    expect(p.supported).toBe(false);
  });
});
