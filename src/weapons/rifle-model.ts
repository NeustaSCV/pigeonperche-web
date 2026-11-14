// Modèles des carabines à verrou, refaits d'après photos et portés de native/game/src/weapons/rifle_model.gd.
// Repère : canon vers +Z, haut +Y, origine à la détente (axe du canon à y = 0,035), mètres, échelle réelle.
// Côté droit de l'arme (levier, fenêtre d'éjection) = −X. Aucun logo ni marquage de marque.
import { BufferGeometry, Color, Matrix4, MeshStandardMaterial, Vector3 } from 'three';
import type { Engine } from '../core/engine';
import { buildOf, type WeaponDef } from '../config/weapons';
import { RifleMesh, along, arc, p2, ribbon, rpoly, translate, type Matter, type P2 } from './rifle-mesh';
import * as P from './rifle-parts';

export const BORE = 0.035;
const TAU = Math.PI * 2, PI = Math.PI;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export interface RifleInfo {
  name: string;
  /** longueur hors tout, m */
  length: number;
  /** longueur du canon, m */
  barrel: number;
  brake: boolean;
  tris: number;
  trisNoBipod: number;
}
export interface RifleBlueprint {
  main: BufferGeometry;
  bolt: BufferGeometry;
  bipod: BufferGeometry;
  mag: BufferGeometry;
  /** tout sauf le bipied, en une seule géométrie (râtelier) */
  merged: BufferGeometry;
  boltPos: Vector3;
  bipodPos: Vector3;
  magPos: Vector3;
  /** retrait du chargeur : direction et course (m) dans le repère de l'arme — vers le bas, ou latéral (HS .50 M1) */
  magOut: Vector3;
  /** repères dans le repère de l'arme : grip, forend, cheek, butt, mag, muzzle, eye, bolt_handle, bipod_feet_l, bipod_feet_r */
  anchors: Record<string, Vector3>;
  info: RifleInfo;
}

const cache = new Map<string, RifleBlueprint>();

class Builder {
  g = new RifleMesh();
  gb = new RifleMesh();
  gp = new RifleMesh();
  gm = new RifleMesh();
  ox = 0; oy = 0; s = 1;
  boltPos = V(0, BORE, 0);
  bipodPos = V(0, 0, 0.4);
  magPos = V(0, 0, 0);
  magOut = V(0, -0.11, 0);
  anchors: Record<string, Vector3> = {};
  info: RifleInfo = { name: '', length: 0, barrel: 0, brake: false, tris: 0, trisNoBipod: 0 };

  constructor(public q: number) {
    for (const g of [this.g, this.gb, this.gp, this.gm]) g.q = q;
  }

  // Les contours sont saisis en millimètres dans le repère des photos de profil quadrillées (x depuis la plaque de
  // couche, y vers le bas) puis ramenés au repère de l'arme : ox = x de la détente, oy = y de l'axe du canon.
  Z(x: number): number { return (x - this.ox) * this.s * 0.001; }
  Y(y: number): number { return BORE + (this.oy - y) * this.s * 0.001; }
  L(v: number): number { return v * this.s * 0.001; }
  rp(a: number[], seg = 5): P2[] {
    const o: number[] = [];
    for (let i = 0; i < a.length; i += 3) o.push(this.Z(a[i]), this.Y(a[i + 1]), this.L(a[i + 2]));
    return rpoly(o, this.q >= 1 ? seg : 2);
  }
  pp(a: number[]): P2[] {
    const o: P2[] = [];
    for (let i = 0; i < a.length; i += 2) o.push(p2(this.Z(a[i]), this.Y(a[i + 1])));
    return o;
  }
  /** Profil de tour : paires (x de la photo, rayon en mm). */
  zr(a: number[]): P2[] {
    const o: P2[] = [];
    for (let i = 0; i < a.length; i += 2) o.push(p2(this.Z(a[i]), a[i + 1] * 0.001));
    return o;
  }
  axis(g: RifleMesh, y: number, x = 0): void { g.push(translate(x, y, 0)); }
  anchor(k: string, p: Vector3, parent: '' | 'bolt' | 'bipod' = ''): void {
    this.anchors[k] = parent === 'bolt' ? p.clone().add(this.boltPos) : parent === 'bipod' ? p.clone().add(this.bipodPos) : p.clone();
  }

  /** Boîtier cylindrique avec fenêtre d'éjection réelle (côté droit) : bague arrière, coquille ouverte, bague avant. */
  receiver(g: RifleMesh, x0: number, xp0: number, xp1: number, x1: number, r: number, rIn: number, rFront: number, aLo: number, aHi: number, sides = 28, flat = false, phase = 0): void {
    this.axis(g, BORE);
    const rr = r * 0.001, ri = rIn * 0.001;
    const Z = (x: number): number => this.Z(x);
    g.lathe([p2(Z(x0), 0), p2(Z(x0), rr - 0.001), p2(Z(x0) + 0.001, rr), p2(Z(xp0), rr), p2(Z(xp0), ri)], sides, null, flat, 0, TAU, phase);
    g.lathe([p2(Z(xp0), ri), p2(Z(xp0), rr), p2(Z(xp1), rr), p2(Z(xp1), ri), p2(Z(xp0), ri)], sides, null, flat, aHi, aLo + TAU, 0);
    g.lathe([p2(Z(xp1), ri), p2(Z(xp1), rr), p2(Z(x1) - 0.001, rr), p2(Z(x1), rr - 0.001), p2(Z(x1), rFront * 0.001)], sides, null, flat, 0, TAU, phase);
    g.pop();
  }

  /** Garde-main à huit pans avec lumières M-LOK réelles. `skipTop` : le pan supérieur porte un rail. */
  handguard(g: RifleMesh, z0: number, z1: number, apo: number, slot0: number, nSlots: number, skew: number, skipTop: boolean, wall = 0.003): void {
    const fw = 2 * apo * Math.tan(PI / 8);
    for (let f = 0; f < 8; f++) {
      const ang = (f * PI) / 4;
      if (skipTop && f === 2) continue;
      const nrm = V(Math.cos(ang), Math.sin(ang), 0);
      const tg = V(-Math.sin(ang), Math.cos(ang), 0);
      g.push(new Matrix4().makeBasis(nrm, tg, V(0, 0, 1)).setPosition(V(0, BORE, 0).addScaledVector(nrm, apo - wall * 0.5)));
      const o = [p2(z0, -fw * 0.5), p2(z1, -fw * 0.5), p2(z1, fw * 0.5), p2(z0, fw * 0.5)];
      const holes: P2[][] = [];
      // lumières réelles sur l'arme en main ; sur la version allégée, seuls les flancs les gardent
      if (g.q >= 1 || f === 0 || f === 4) {
        const diag = f % 2 === 1;
        const sh = (diag ? 0.0035 : 0.007) * 0.5;
        let sk = diag ? skew : 0;
        if (tg.y < 0 || (Math.abs(tg.y) < 0.01 && tg.x > 0)) sk = -sk;
        for (let i = 0; i < nSlots; i++) {
          const za = slot0 + 0.04 * i;
          if (za + 0.032 > z1 - 0.006) break;
          holes.push(rpoly([za - sk, -sh, sh * 0.8, za + 0.032 - sk, -sh, sh * 0.8, za + 0.032 + sk, sh, sh * 0.8, za + sk, sh, sh * 0.8], g.q >= 1 ? 2 : 1));
        }
      }
      g.extrude(o, wall, 0, 1, holes);
      g.pop();
    }
    // arêtes entre pans : baguettes chanfreinées qui accrochent la lumière
    for (let f = 0; f < 8; f++) {
      const ang = ((f + 0.5) * PI) / 4;
      const radius = apo / Math.cos(PI / 8);
      const c = V(Math.cos(ang), Math.sin(ang), 0);
      const t = V(-Math.sin(ang), Math.cos(ang), 0);
      const pa = V(0, BORE, 0).addScaledVector(c, radius - 0.0012);
      const h = 0.0016;
      const n1 = c.clone().addScaledVector(t, 0.6).normalize(), n2 = c.clone().addScaledVector(t, -0.6).normalize();
      const at = (k: number, cc: number, z: number): Vector3 => pa.clone().addScaledVector(t, k).addScaledVector(c, cc).add(V(0, 0, z));
      const a0 = at(h, -0.0004, z0), a1 = at(h, -0.0004, z1), b0 = at(-h, -0.0004, z0), b1 = at(-h, -0.0004, z1), m0 = at(0, 0.0006, z0), m1 = at(0, 0.0006, z1);
      g.quad(a0, a1, m1, m0, n1, n1, c, c, 0, 0, 1, 1);
      g.quad(m0, m1, b1, b0, c, c, n2, n2, 1, 1, 0, 0);
    }
  }

  trigger(g: RifleMesh, x: number, y0: number, y1: number, w = 0.007): void {
    g.mat(P.STEEL);
    const path = this.pp([x + 3, y0, x + 1, lerp(y0, y1, 0.45), x - 1, lerp(y0, y1, 0.8), x - 4.5, y1]);
    g.extrude(ribbon(path, 0.0028), w, 0.0008, 1);
  }
  stud(g: RifleMesh, x: number, y: number): void {
    g.mat(P.STEEL);
    g.push(along(V(0, -1, 0), V(0, this.Y(y), this.Z(x))));
    g.lathe([p2(-0.002, 0.0045), p2(0.001, 0.0045), p2(0.001, 0.0028), p2(0.006, 0.0028), p2(0.007, 0.0042), p2(0.011, 0.0042), p2(0.012, 0)], 10);
    g.pop();
  }
  magBegin(center: Vector3): void {
    this.magPos = center.clone();
    this.gm.push(translate(-center.x, -center.y, -center.z));
  }
  finish(def: WeaponDef, buttX: number, muzzleX: number, barrelM: number, withBrake: boolean): void {
    this.info.length = this.Z(muzzleX) - this.Z(buttX);
    this.info.barrel = barrelM;
    this.info.brake = withBrake;
    this.info.name = def.name;
  }

  // ------------------------------------------------------------------ CZ 457 Varmint (.22 LR)
  cz457(def: WeaponDef): void {
    this.ox = 368; this.oy = 15; this.s = 1;
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const muzzle = 983;
    // crosse en noyer : busc droit, poignée pistolet marquée, fût court
    const hwf = (p: P2): number => lerp(lerp(0.0215, 0.0188, sstep(-0.2, -0.085, p.x)), 0.0225, sstep(-0.07, 0.03, p.x));
    g.mat(P.WOOD);
    g.extrude(this.rp([18, 36, 2, 120, 31.5, 0, 238, 27, 9, 272, 50, 26, 334, 22, 6, 345, 19.5, 0, 772, 16.5, 4, 792, 18, 5, 795, 31, 9, 780, 43, 10,
      700, 47, 0, 560, 53, 0, 470, 58, 0, 404, 62, 0, 350, 63, 5, 331, 74, 10, 297, 108, 5, 284, 115, 5, 262, 109, 8, 226, 100, 22, 24, 161, 2], 6), 0.045, 0.0105, 4, [], 0, hwf);
    // plaque de couche caoutchouc
    g.mat(P.RUBBER);
    g.extrude(this.rp([18, 36, 0, 24, 161, 0, 9, 163, 4, 2, 38, 4]), 0.041, 0.006, 3);
    // canon lourd cylindrique de 525 mm, couronne en retrait
    g.mat(P.STEEL);
    const bp = [p2(Z(470), 0.011)];
    P.crown(bp, Z(muzzle), 0.011, 0.0028);
    this.axis(g, BORE); g.lathe(bp, 28); g.pop();
    // boîtier : bague arrière, fenêtre d'éjection, bague avant, queues d'aronde
    this.receiver(g, 338, 402, 452, 488, 14, 9, 10, 1.95, 3.25, 28);
    g.block(Z(346), Z(400), BORE + 0.012, BORE + 0.0152, 0.012, 0.001);
    g.block(Z(454), Z(486), BORE + 0.012, BORE + 0.0152, 0.012, 0.001);
    // pontet en feuillard d'acier et détente
    g.extrude(ribbon(this.rp([346, 61, 0, 347, 84, 14, 360, 93.5, 12, 390, 93.5, 14, 403, 82, 14, 403, 61, 0], 6), 0.0026), 0.0125, 0.0007, 1);
    this.trigger(g, 372, 62, 86);
    this.stud(g, 87, 137); this.stud(g, 738, 44);
    // rail et lunette 4-16×50
    const railTop = BORE + 0.0238;
    P.picatinny(g, Z(342), Z(486), railTop);
    const ys = BORE + 0.047;
    const zOc = P.scope(g, Z(414), ys, 0.92, 0.0285, railTop, false);
    // verrou : corps poli, capuchon, levier coudé à boule
    const k = P.bolt(this.gb, Z(325), Z(456), 0.0085, Z(386), 0.058, 0.031, Z(376), 0.0095, this.zr([318, 0, 318, 9.5, 320, 11, 337, 11, 337, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    // chargeur 5 coups polymère
    this.magBegin(V(0, Y(54), Z(450)));
    this.gm.mat(P.POLY);
    this.gm.extrude(this.rp([432, 34, 1, 468, 34, 1, 468, 64, 1, 432, 64, 1]), 0.0135, 0.001, 1);
    this.gm.extrude(this.rp([430, 62, 1, 472, 62, 1, 472, 66.5, 1.5, 430, 66.5, 1.5]), 0.016, 0.0012, 1);
    // bipied sur le grenadière avant
    this.bipodPos = V(0, Y(50), Z(738));
    const feet = P.harris(this.gp, 0.2);
    this.anchor('bipod_feet_l', feet[0], 'bipod'); this.anchor('bipod_feet_r', feet[1], 'bipod');
    this.anchor('grip', V(0, Y(80), Z(302)));
    this.anchor('forend', V(0, Y(50), Z(630)));
    this.anchor('cheek', V(0, Y(30), Z(150)));
    this.anchor('butt', V(0, Y(98), Z(3)));
    this.anchor('mag', V(0, Y(66), Z(450)));
    this.anchor('muzzle', V(0, BORE, Z(muzzle)));
    this.anchor('eye', V(0, ys, zOc - 0.07));
    this.finish(def, 2, muzzle, 0.525, false);
  }

  // ------------------------------------------------------------------ Tikka T3x TAC A1 (.223 Rem, 6.5 Creedmoor)
  tikka(def: WeaponDef, alu: Matter): void {
    this.ox = 350; this.oy = 31; this.s = 1.05;
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y), L = (v: number): number => this.L(v);
    const breech = 490;
    const muzzle = breech + 600 / this.s;
    const brakeEnd = muzzle + 44;
    // canon semi-lourd
    g.mat(P.STEEL);
    this.axis(g, BORE);
    g.lathe([p2(Z(520), 0.015), p2(Z(545), 0.015), p2(Z(575), 0.0118), p2(Z(muzzle - 16), 0.0105), p2(Z(muzzle - 16), 0.0085), p2(Z(muzzle), 0.0085)], 28);
    g.pop();
    P.brake(g, BORE, Z(muzzle - 18), L(62), 0.0152, 3, 0.0042, 0.3);
    // boîtier acier et rail intégré
    g.mat(P.STEEL);
    this.receiver(g, 352, 395, 476, 527, 16.6, 10.2, 13, 1.75, 3.3, 32);
    const railTop = Y(0);
    g.block(Z(366), Z(527), railTop - 0.016, railTop - 0.009, 0.019, 0.0015);
    P.picatinny(g, Z(365), Z(527), railTop, 0.0094, P.STEEL);
    // châssis aluminium : berceau, puits de chargeur, pontet intégré
    g.mat(alu);
    g.extrude(this.rp([290, 40, 1.5, 547, 40, 1.5, 547, 71, 2, 522, 73, 5, 497, 82, 4, 479, 89, 2, 401, 89, 2, 393, 118, 3, 330, 118, 4, 326, 101, 3, 298, 99, 2, 290, 88, 3]),
      L(42), 0.0022, 1, [this.rp([337, 90, 3, 391, 90, 3, 384, 111.5, 3, 337, 111.5, 3])]);
    // nervure oblique caractéristique du flanc
    g.extrude(this.rp([395, 66, 2, 470, 60, 2, 540, 62, 2, 540, 70, 2, 497, 80, 2, 478, 86, 2, 402, 86, 2]), L(45), 0.0018, 1);
    this.trigger(g, 352, 91, 108);
    // poignée type AR surmoulée
    g.mat(P.GRIP);
    g.extrude(this.rp([297, 97, 2, 331, 97, 2, 333, 112, 4, 320, 123, 8, 314, 140, 12, 300, 160, 10, 291, 181, 5, 247, 176, 7, 256, 148, 14, 268, 124, 12, 262, 108, 5, 266, 99, 3], 5), L(30), L(8), 3);
    // charnière et tube de crosse repliable
    g.mat(P.STEEL_MAT);
    g.extrude(this.rp([264, 38, 3, 296, 38, 2, 296, 86, 2, 270, 86, 4, 262, 78, 3]), L(38), 0.003, 2);
    this.axis(g, Y(62));
    g.lathe(this.zr([205, 0, 205, 17, 218, 17, 219, 18.5, 240, 18.5, 241, 17, 264, 17]), 24);
    g.pop();
    // crosse squelette : cadre aluminium ajouré
    g.mat(alu);
    g.extrude(this.rp([47, 46, 2, 208, 46, 2, 212, 60, 3, 210, 79, 3, 176, 111, 8, 101, 111, 3, 101, 141, 2, 55, 141, 2, 47, 122, 2]), L(28), 0.002, 1,
      [this.rp([64, 57, 3, 72, 57, 2, 96, 97, 3, 96, 126, 3, 64, 126, 3]), this.rp([84, 57, 3, 196, 57, 3, 198, 74, 3, 171, 99, 5, 110, 99, 3])]);
    // appui-joue réglable et ses molettes
    g.mat(P.POLY);
    g.extrude(this.rp([68, 18, 4, 205, 22, 6, 207, 58, 3, 176, 60, 2, 176, 101, 5, 92, 101, 5, 92, 60, 2, 70, 58, 3]), L(44), L(5), 2,
      [this.rp([100, 82, 2, 110, 82, 2, 110, 96, 2, 100, 96, 2]), this.rp([152, 82, 2, 162, 82, 2, 162, 96, 2, 152, 96, 2])]);
    for (const kx of [104, 157])
      for (const sd of [-1, 1]) {
        g.push(along(V(sd, 0, 0), V(sd * L(22), Y(73), Z(kx))));
        g.lathe([p2(0, 0.0095), p2(0.006, 0.0095), p2(0.007, 0.0075), p2(0.007, 0)], 12, P.teeth(-1, 0.0065, 0.0022));
        g.pop();
      }
    // plaque de couche réglable
    g.mat(alu);
    g.extrude(this.rp([45, 40, 2, 57, 40, 2, 57, 148, 2, 45, 148, 2]), L(36), 0.002, 1);
    g.mat(P.RUBBER);
    g.extrude(this.rp([1, 44, 10, 12, 33, 6, 45, 32, 2, 45, 152, 2, 22, 153, 8, 4, 140, 8], 5), L(42), L(6), 3);
    // garde-main M-LOK à huit pans, rail supérieur continu
    g.mat(alu);
    this.handguard(g, Z(527), Z(860), L(23.5), Z(572), 7, 0, true);
    g.extrude(this.rp([527, 40, 2, 572, 40, 2, 566, 61, 4, 529, 61, 3]), L(34), 0.002, 1);
    g.block(Z(527), Z(862), railTop - 0.0125, railTop - 0.009, L(19.5), 0.001);
    P.picatinny(g, Z(527.5), Z(862), railTop, 0.0094, alu);
    // lunette 5-25×56
    const ys = BORE + 0.067;
    const zOc = P.scope(g, Z(441), ys, 1, 0.031, railTop, false);
    // verrou
    const k = P.bolt(this.gb, Z(330), Z(482), 0.0098, Z(358), 0.062, 0.033, Z(347), 0.0125, this.zr([316, 0, 316, 8, 322, 12.5, 350, 12.5, 350, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    // chargeur 10 coups
    this.magBegin(V(0, Y(95), Z(440)));
    this.gm.mat(P.POLY);
    this.gm.extrude(this.rp([403, 62, 1, 474, 62, 1, 474, 104, 1, 403, 104, 1]), L(23), 0.0012, 1);
    this.gm.extrude(this.rp([400, 100, 2, 478, 100, 2, 484, 108, 3, 480, 119, 3, 401, 123, 3]), L(27), 0.0025, 2);
    g.mat(P.STEEL_MAT);
    g.extrude(this.rp([390.5, 99, 1, 398.5, 99, 1, 397, 117, 1.5, 389.5, 115, 1.5]), L(9), 0.001, 1);
    // bipied sous le garde-main
    this.bipodPos = V(0, BORE - L(23.5), Z(800));
    const feet = P.harris(this.gp, 0.2);
    this.anchor('bipod_feet_l', feet[0], 'bipod'); this.anchor('bipod_feet_r', feet[1], 'bipod');
    this.anchor('grip', V(0, Y(138), Z(285)));
    this.anchor('forend', V(0, BORE - L(24), Z(690)));
    this.anchor('cheek', V(0, Y(19), Z(140)));
    this.anchor('butt', V(0, Y(92), Z(1)));
    this.anchor('mag', V(0, Y(122), Z(440)));
    this.anchor('muzzle', V(0, BORE, Z(brakeEnd)));
    this.anchor('eye', V(0, ys, zOc - 0.07));
    this.finish(def, 1, brakeEnd, 0.6, true);
  }

  // ------------------------------------------------------------------ Ruger Precision Rifle (.308 Win)
  rpr(def: WeaponDef, alu: Matter): void {
    this.ox = 345; this.oy = 30; this.s = 1;
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const poly = P.POLY;
    const breech = 485;
    const muzzle = breech + 508;
    let front = muzzle + 47;
    // canon de 20 pouces, profil moyen
    g.mat(P.STEEL);
    const bp = [p2(Z(515), 0.0155), p2(Z(548), 0.0155), p2(Z(585), 0.0105), p2(Z(muzzle - 14), 0.0095)];
    if (def.suppressed) {
      bp.push(p2(Z(muzzle), 0.0095));
      this.axis(g, BORE); g.lathe(bp, 28); g.pop();
      P.suppressor(g, BORE, Z(muzzle - 12), 0.205, 0.0215);
      front = muzzle - 12 + 205;
    } else {
      bp.push(p2(Z(muzzle - 14), 0.0085), p2(Z(muzzle), 0.0085));
      this.axis(g, BORE); g.lathe(bp, 28); g.pop();
      // frein hybride : collier percé puis deux chambres
      P.brake(g, BORE, Z(muzzle - 8), 0.055, 0.013, 2, 0.0045, 0.45);
    }
    // boîtier supérieur cylindrique, fenêtre d'éjection, rail 20 MOA
    g.mat(alu);
    this.receiver(g, 266, 398, 472, 515, 21, 10.6, 15.5, 2.2, 3.35, 32);
    const railTop = Y(0);
    P.picatinny(g, Z(320), Z(515), railTop, 0.0094, alu);
    // écrou de garde-main
    this.axis(g, BORE);
    g.lathe(this.zr([515, 15.5, 515, 22.5, 540, 22.5, 540, 15.5]), 32);
    g.pop();
    // boîtier inférieur : puits de chargeur évasé, pontet
    g.extrude(this.rp([268, 46, 2, 515, 46, 1, 515, 62, 2, 489, 80, 3, 489, 97, 2, 401, 97, 2, 395, 112, 3, 336, 112, 3, 334, 86, 2, 300, 84, 3, 270, 76, 3]),
      0.036, 0.002, 1, [this.rp([341, 88, 3, 395, 88, 3, 389, 106.5, 3, 341, 106.5, 3])]);
    // flancs anguleux du puits (lignes obliques visibles sur les photos)
    g.extrude(this.rp([398, 60, 2, 470, 56, 2, 512, 58, 2, 512, 63, 2, 487, 79, 2, 487, 95, 2, 402, 95, 2]), 0.041, 0.002, 1);
    this.trigger(g, 348, 88, 105);
    // poignée polymère type AR
    g.mat(P.GRIP);
    g.extrude(this.rp([293, 82, 2, 333, 82, 2, 335, 97, 3, 319, 110, 7, 301, 176, 4, 248, 170, 5, 268, 119, 10, 273, 97, 4], 5), 0.029, 0.0075, 3);
    // charnière de crosse et tube
    g.mat(alu);
    g.extrude(this.rp([238, 14, 3, 268, 14, 2, 268, 76, 2, 244, 76, 4, 238, 62, 3]), 0.036, 0.003, 2);
    this.axis(g, Y(35));
    g.lathe(this.zr([150, 0, 150, 14.5, 205, 14.5, 206, 16.5, 215, 16.5, 216, 14.5, 238, 14.5]), 24);
    g.pop();
    // corps de crosse et appui-joue
    g.mat(poly);
    g.extrude(this.rp([100, 24, 4, 116, 19, 4, 212, 19, 4, 213, 51, 5, 176, 60, 4, 100, 60, 4]), 0.043, 0.006, 3);
    g.extrude(this.rp([112, 12, 3, 209, 12, 3, 209, 22, 2, 112, 22, 2]), 0.036, 0.004, 2);
    // réglage de longueur : tige crantée, chariot, leviers
    g.mat(P.STEEL);
    this.axis(g, Y(76));
    const rod = [p2(Z(30), 0), p2(Z(30), 0.006)];
    for (let i = 0; i < 4; i++) {
      const zx = 62 + i * 7;
      rod.push(p2(Z(zx), 0.006), p2(Z(zx), 0.0085), p2(Z(zx + 4), 0.0085), p2(Z(zx + 4), 0.006));
    }
    rod.push(p2(Z(172), 0.006), p2(Z(172), 0));
    g.lathe(rod, 14);
    g.pop();
    g.mat(poly);
    g.extrude(this.rp([78, 22, 3, 100, 22, 2, 100, 100, 3, 78, 100, 3]), 0.03, 0.003, 2);
    g.extrude(this.rp([134, 60, 2, 166, 60, 2, 168, 86, 3, 152, 101, 4, 138, 92, 3]), 0.026, 0.003, 2);
    // semelle arrière crantée
    g.extrude(this.rp([38, 109, 2, 146, 109, 4, 151, 118, 4, 146, 126, 3, 134, 126, 0, 131, 129, 0, 122, 129, 0, 119, 126, 0, 108, 126, 0, 105, 129, 0, 96, 129, 0, 93, 126, 0,
      82, 126, 0, 79, 129, 0, 70, 129, 0, 67, 126, 0, 38, 126, 2]), 0.022, 0.002, 1);
    // plaque de couche
    g.extrude(this.rp([20, 17, 3, 38, 17, 3, 38, 137, 3, 20, 137, 3]), 0.038, 0.003, 2);
    g.mat(P.RUBBER);
    const pad = [20, 16, 2, 20, 138, 2, 6, 137, 5];
    for (let i = 0; i < 9; i++) { const yy = 126 - i * 12; pad.push(0, yy, 0, 3.5, yy - 6, 0); }
    pad.push(1, 22, 0, 6, 16, 4);
    g.extrude(this.rp(pad), 0.04, 0.004, 2);
    // garde-main flottant M-LOK (lumières obliques sur les pans à 45°)
    g.mat(alu);
    this.handguard(g, Z(540), Z(890), 0.0215, Z(576), 8, 0.005, false);
    // lunette 5-25×56
    const ys = BORE + 0.057;
    const zOc = P.scope(g, Z(420), ys, 1, 0.031, railTop, false);
    // verrou : queue longue, poignée allongée
    const k = P.bolt(this.gb, Z(280), Z(476), 0.0102, Z(376), 0.062, 0.033, Z(360), 0.0085, this.zr([258, 0, 258, 10, 262, 12.5, 284, 12.5, 284, 0]), true);
    this.anchor('bolt_handle', k, 'bolt');
    // chargeur polymère 10 coups
    this.magBegin(V(0, Y(110), Z(444)));
    this.gm.mat(P.POLY);
    this.gm.extrude(this.rp([403, 66, 1, 486, 66, 1, 487, 120, 3, 484, 132, 4, 404, 138, 4]), 0.0265, 0.003, 2);
    this.gm.extrude(this.rp([408, 100, 2, 480, 97, 2, 480, 124, 2, 408, 129, 2]), 0.0285, 0.0015, 1);
    // bipied
    this.bipodPos = V(0, BORE - 0.0215, Z(845));
    const feet = P.harris(this.gp, 0.2);
    this.anchor('bipod_feet_l', feet[0], 'bipod'); this.anchor('bipod_feet_r', feet[1], 'bipod');
    this.anchor('grip', V(0, Y(130), Z(290)));
    this.anchor('forend', V(0, BORE - 0.022, Z(700)));
    this.anchor('cheek', V(0, Y(12), Z(160)));
    this.anchor('butt', V(0, Y(77), Z(0)));
    this.anchor('mag', V(0, Y(136), Z(444)));
    this.anchor('muzzle', V(0, BORE, Z(front)));
    this.anchor('eye', V(0, ys, zOc - 0.07));
    this.finish(def, 0, front, 0.508, !def.suppressed);
  }

  // ------------------------------------------------------------------ Sako TRG 42 (.300 Win Mag)
  trg(def: WeaponDef, poly: Matter): void {
    this.ox = 380; this.oy = 120; this.s = 1;
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const breech = 510;
    const muzzle = breech + 690;
    const front = muzzle + 46;
    // canon lourd de 690 mm
    g.mat(P.STEEL);
    this.axis(g, BORE);
    g.lathe([p2(Z(566), 0.016), p2(Z(600), 0.016), p2(Z(660), 0.0132), p2(Z(muzzle - 22), 0.0112), p2(Z(muzzle - 22), 0.009), p2(Z(muzzle), 0.009)], 28);
    g.pop();
    P.brake(g, BORE, Z(muzzle - 18), 0.064, 0.0152, 3, 0.0048, 0.32);
    // boîtier à pans, fenêtre d'éjection, rail
    g.mat(P.STEEL);
    this.receiver(g, 392, 432, 522, 568, 17.5, 11.3, 14, PI * 0.625, PI * 1.125, 8, true, PI / 8);
    const railTop = Y(96);
    P.picatinny(g, Z(398), Z(566), railTop, 0.008, P.STEEL);
    // crosse TRG : fût large, poignée verticale à repose-pouce, talon anguleux
    const hwf = (p: P2): number => lerp(lerp(0.021, 0.0195, sstep(-0.3, -0.1, p.x)), 0.0265, sstep(-0.03, 0.06, p.x));
    g.mat(poly);
    g.extrude(this.rp([40, 150, 3, 53, 130, 8, 90, 129, 3, 95, 159, 2, 231, 160, 4, 241, 172, 8, 268, 194, 24, 300, 160, 12, 322, 141, 3, 392, 138, 0, 778, 137, 3,
      778, 171, 6, 650, 177, 0, 590, 181, 10, 548, 186, 8, 512, 190, 4, 421, 190, 2, 421, 181, 2, 353, 181, 5, 343, 202, 8, 338, 240, 10, 331, 262, 6, 276, 262, 8,
      224, 243, 18, 180, 230, 12, 98, 230, 4, 95, 258, 3, 40, 258, 3], 6), 0.05, 0.011, 4, [], 0, hwf);
    // berceau aluminium noir visible entre crosse et boîtier
    g.mat(P.ALU);
    g.block(Z(322), Z(664), Y(146), Y(134), 0.037, 0.002);
    g.mat(poly);
    // appui-joue réglable
    g.extrude(this.rp([86, 117, 7, 110, 110, 4, 160, 110, 3, 172, 113, 4, 237, 127, 3, 240, 133, 2, 228, 165, 4, 89, 165, 4], 5), 0.046, 0.0085, 3);
    g.mat(P.STEEL);
    for (const px of [125, 195]) {
      g.push(along(V(-1, 0, 0), V(-0.0195, Y(176), Z(px))));
      g.lathe([p2(0, 0.004), p2(0.0025, 0.004), p2(0.0025, 0)], 10);
      g.pop();
    }
    // plaque de couche et cales
    g.mat(P.RUBBER);
    g.extrude(this.rp([3, 152, 8, 40, 148, 2, 40, 278, 2, 14, 278, 9, 1, 250, 0], 5), 0.041, 0.006, 3);
    // pontet aluminium et détente
    g.mat(P.ALU);
    g.extrude(ribbon(this.rp([356, 180, 0, 357, 200, 7, 366, 208.5, 6, 400, 208.5, 7, 411, 200, 7, 414, 180, 0], 4), 0.0032), 0.015, 0.001, 1);
    this.trigger(g, 382, 182, 201);
    this.stud(g, 752, 172);
    // lunette 5-25×56 avec pare-soleil
    const ys = BORE + 0.053;
    const zOc = P.scope(g, Z(486), ys, 1, 0.031, railTop, true);
    // verrou massif, boule ronde
    const k = P.bolt(this.gb, Z(370), Z(526), 0.0108, Z(396), 0.062, 0.033, Z(370), 0.011, this.zr([360, 0, 360, 9, 366, 13, 391, 13, 391, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    // chargeur acier 7 coups
    this.magBegin(V(0, Y(180), Z(462)));
    this.gm.mat(P.STEEL_MAT);
    this.gm.extrude(this.rp([424, 150, 1, 500, 150, 1, 500, 195, 2, 424, 203, 2]), 0.022, 0.0012, 1);
    this.gm.mat(P.POLY);
    this.gm.extrude(this.rp([422, 198, 2, 502, 190, 2, 502, 197, 2, 422, 206, 2]), 0.025, 0.0015, 1);
    // bipied
    this.bipodPos = V(0, Y(178), Z(752));
    const feet = P.harris(this.gp, 0.21);
    this.anchor('bipod_feet_l', feet[0], 'bipod'); this.anchor('bipod_feet_r', feet[1], 'bipod');
    this.anchor('grip', V(0, Y(215), Z(308)));
    this.anchor('forend', V(0, Y(180), Z(640)));
    this.anchor('cheek', V(0, Y(110), Z(160)));
    this.anchor('butt', V(0, Y(210), Z(1)));
    this.anchor('mag', V(0, Y(205), Z(462)));
    this.anchor('muzzle', V(0, BORE, Z(front)));
    this.anchor('eye', V(0, ys, zOc - 0.07));
    this.finish(def, 1, front, 0.69, true);
  }

  // ------------------------------------------------------------------ PGM 338 (.338 Lapua Magnum)
  pgm(def: WeaponDef, alu: Matter): void {
    this.ox = 350; this.oy = 123; this.s = 1;
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const front = 1240;
    const full = g.q >= 1;
    // canon cannelé de 690 mm, manchon conique, frein à chambre unique en anneau
    g.mat(P.STEEL);
    this.axis(g, BORE);
    g.lathe([p2(Z(585), 0.0165), p2(Z(596), 0.0165), p2(Z(598), 0.0148), p2(Z(600), 0.0148), p2(Z(624), 0.0148), p2(Z(840), 0.0144), p2(Z(1061), 0.014), p2(Z(1085), 0.014),
      p2(Z(1088), 0.014), p2(Z(1092), 0.0155), p2(Z(1100), 0.0155), p2(Z(1150), 0.0125), p2(Z(1152), 0.0105), p2(Z(1172), 0.0105)], 48, P.flutes(Z(600), Z(1085), 0.0032, 6));
    g.pop();
    g.mat(P.STEEL_MAT);
    const ringO = rpoly([Z(1168), BORE + 0.011, 0.003, Z(1186), BORE + 0.0185, 0.008, Z(1226), BORE + 0.0185, 0.012, Z(1240), BORE + 0.009, 0.006,
      Z(1240), BORE - 0.009, 0.006, Z(1226), BORE - 0.0185, 0.012, Z(1186), BORE - 0.0185, 0.008, Z(1168), BORE - 0.011, 0.003], full ? 5 : 2);
    const hole: P2[] = [];
    const hs = full ? 20 : 10;
    for (let i = 0; i < hs; i++) { const a = (TAU * i) / hs; hole.push(p2(Z(1208) + Math.cos(a) * 0.0155, BORE + Math.sin(a) * 0.0135)); }
    g.extrude(ringO, 0.03, 0.004, 2, [hole]);
    // boîtier parallélépipédique : blocs arrière et avant, fenêtre d'éjection ouverte à droite
    g.mat(alu);
    g.extrude(this.rp([330, 100, 2, 402, 100, 0, 402, 146, 0, 330, 146, 2]), 0.044, 0.0025, 1);
    g.extrude(this.rp([480, 100, 0, 585, 100, 2, 585, 150, 2, 480, 150, 0]), 0.044, 0.0025, 1);
    g.block(Z(402), Z(480), Y(108), Y(100), 0.044, 0.0025);
    g.block(Z(402), Z(480), Y(146), Y(127), 0.044, 0.0025);
    g.block(Z(402), Z(480), Y(127), Y(108), 0.012, 0, 0.016);
    // flanc rapporté du boîtier (marquage absent)
    g.extrude(this.rp([486, 106, 2, 580, 106, 2, 580, 144, 2, 486, 144, 2]), 0.0465, 0.0015, 1);
    // long rail supérieur en pont au-dessus du canon
    const railTop = Y(90);
    P.picatinny(g, Z(330), Z(806), railTop, 0.0105, alu);
    // poutre du châssis : puits de chargeur, pontet découpé, bras avant
    g.extrude(this.rp([262, 140, 2, 330, 140, 0, 330, 146, 0, 585, 150, 0, 780, 150, 2, 818, 150, 4, 818, 166, 4, 783, 167, 3, 780, 178, 3, 600, 190, 0, 492, 196, 3,
      401, 196, 2, 401, 212, 3, 322, 212, 6, 318, 178, 3, 262, 172, 3]), 0.036, 0.0025, 1, [this.rp([331, 182, 11, 390, 182, 11, 390, 206, 11, 331, 206, 11], 5)]);
    this.trigger(g, 353, 183, 203);
    // support de rail avant : flasques et rails latéraux
    for (const sd of [-1, 1]) {
      g.mat(alu);
      g.extrude(this.rp([606, 166, 2, 606, 143, 3, 622, 105, 3, 734, 100.5, 0, 790, 100.5, 2, 772, 112, 3, 752, 143, 3, 765, 166, 2]), 0.004, 0.001, 1, [], sd * 0.021);
      // rail latéral : Picatinny tourné de 90°
      g.push(new Matrix4().makeBasis(V(0, -sd, 0), V(sd, 0, 0), V(0, 0, 1)).setPosition(sd * 0.023, Y(127), 0));
      P.picatinny(g, Z(628), Z(744), 0.0085, 0.008, alu);
      g.pop();
      if (full) {
        g.mat(P.STEEL);
        for (const sx of [628, 668, 708, 748]) {
          g.push(along(V(sd, 0, 0), V(sd * 0.023, Y(158), Z(sx))));
          g.lathe([p2(0, 0.0038), p2(0.0015, 0.0038), p2(0.0015, 0)], 10);
          g.pop();
        }
      }
    }
    // poignée caoutchouc à empreintes de doigts
    g.mat(P.GRIP);
    g.extrude(this.rp([278, 176, 2, 326, 176, 2, 328, 197, 3, 314, 207, 5, 306, 216, 3, 311, 226, 4, 300, 236, 3, 305, 246, 4, 293, 257, 3, 296, 270, 4, 234, 257, 6,
      262, 206, 12, 271, 186, 4], 5), 0.03, 0.008, 3);
    // charnière et crosse repliable : poutre, serrage, appui-joue cylindrique
    g.mat(alu);
    g.extrude(this.rp([186, 141, 2, 262, 141, 2, 262, 171, 2, 186, 171, 2]), 0.03, 0.003, 1, [this.rp([200, 151, 2, 250, 151, 2, 250, 161, 2, 200, 161, 2])]);
    g.extrude(this.rp([44, 143, 2, 186, 143, 2, 186, 172, 2, 44, 172, 2]), 0.026, 0.0025, 1, [this.rp([58, 151, 3, 134, 151, 3, 134, 160, 3, 58, 160, 3])]);
    g.extrude(this.rp([138, 134, 3, 186, 134, 3, 186, 173, 3, 138, 173, 3]), 0.034, 0.003, 2);
    g.extrude(this.rp([55, 172, 2, 122, 172, 2, 120, 206, 4, 58, 206, 4]), 0.026, 0.0025, 1);
    g.mat(P.STEEL);
    for (const sd of [-1, 1]) {
      g.push(along(V(sd, 0, 0), V(sd * 0.017, Y(158), Z(161))));
      g.lathe([p2(0, 0.0095), p2(0.007, 0.0095), p2(0.008, 0.008), p2(0.008, 0)], 20, P.teeth(-1, 0.0075, 0.0009));
      g.pop();
    }
    g.mat(P.POLY);
    this.axis(g, Y(118));
    g.lathe([p2(Z(52), 0), ...arc(Z(62), 0.01, PI, PI * 0.5, 5, 0.0075), ...arc(Z(195), 0.01, PI * 0.5, 0, 5, 0.0075), p2(Z(205), 0)], 24);
    g.pop();
    g.mat(alu);
    g.block(Z(70), Z(190), Y(143), Y(130), 0.02, 0.002);
    // plaque de couche, patin cranté et crochet
    g.extrude(this.rp([30, 110, 3, 45, 110, 3, 45, 262, 3, 30, 262, 3]), 0.04, 0.003, 1);
    g.extrude(this.rp([45, 200, 0, 62, 205, 5, 79, 226, 9, 70, 246, 7, 45, 249, 0]), 0.03, 0.004, 2);
    g.mat(P.RUBBER);
    const pad = [30, 129, 2, 30, 261, 2, 12, 262, 6];
    for (let i = 0; i < 10; i++) { const yy = 250 - i * 12; pad.push(1, yy, 0, 4.5, yy - 6, 0); }
    pad.push(4, 134, 0, 10, 129, 4);
    g.extrude(this.rp(pad), 0.042, 0.004, 2);
    // béquille arrière moletée
    g.push(along(V(0, -1, 0), V(0, Y(200), Z(103))));
    g.mat(P.STEEL);
    g.lathe([p2(0, 0.0065), p2(0.03, 0.0065), p2(0.03, 0.015), p2(0.032, 0.0155), p2(0.106, 0.0155), p2(0.108, 0.014), p2(0.108, 0.006), p2(0.122, 0.006), p2(0.122, 0.0165),
      p2(0.124, 0.0175), p2(0.129, 0.0175), p2(0.13, 0.016), p2(0.13, 0)], 36, P.teeth(0.033, 0.105, 0.0007));
    g.pop();
    // poussoir de chargeur
    g.push(along(V(0, -1, 0), V(0, Y(212), Z(361))));
    g.lathe([p2(0, 0.005), p2(0.012, 0.005), p2(0.013, 0.004), p2(0.013, 0)], 12);
    g.pop();
    // lunette 6-30×56 avec pare-soleil
    const ys = BORE + 0.068;
    const zOc = P.scope(g, Z(430), ys, 1.04, 0.032, railTop, true);
    // verrou : grosse boule
    const k = P.bolt(this.gb, Z(300), Z(500), 0.0112, Z(376), 0.064, 0.034, Z(360), 0.014, this.zr([292, 0, 292, 9, 297, 12.5, 329, 12.5, 329, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    // chargeur acier 10 coups
    this.magBegin(V(0, Y(195), Z(441)));
    this.gm.mat(P.STEEL_MAT);
    this.gm.extrude(this.rp([403, 150, 1, 479, 150, 1, 479, 220, 2, 401, 236, 2]), 0.027, 0.0015, 1);
    this.gm.extrude(this.rp([446, 200, 0.5, 450, 200, 0.5, 450, 224, 0.5, 446, 225, 0.5]), 0.029, 0.0008, 1);
    // bipied PGM sur le bras avant du châssis
    this.bipodPos = V(0, Y(158), Z(801));
    const feet = this.pgmBipod(this.gp, alu);
    this.anchor('bipod_feet_l', feet[0], 'bipod'); this.anchor('bipod_feet_r', feet[1], 'bipod');
    this.anchor('grip', V(0, Y(225), Z(284)));
    this.anchor('forend', V(0, Y(188), Z(680)));
    this.anchor('cheek', V(0, Y(100.5), Z(130)));
    this.anchor('butt', V(0, Y(195), Z(1)));
    this.anchor('mag', V(0, Y(232), Z(441)));
    this.anchor('muzzle', V(0, BORE, Z(front)));
    this.anchor('eye', V(0, ys, zOc - 0.07));
    this.finish(def, 1, front, 0.69, true);
  }

  // =================================================================================================================
  // Dix armes des familles « intermediate » et « elr ». Contours relevés sur photos de profil (tools/weapons-ref,
  // hors du jeu), mis à l'échelle sur la longueur hors tout publiée : x en mm depuis la plaque de couche, y en mm
  // sous l'axe du canon (négatif au-dessus). Pièces partagées : boîtier prismatique à fenêtre, poignée type AR,
  // garde-main à huit pans, crosse squelette, freins et bipieds de rifle-parts.ts.
  // =================================================================================================================

  /** Repère des relevés : `trig` = x de la détente (origine de l'arme), y = 0 sur l'axe du canon. */
  private frame(trig: number): void { this.ox = trig; this.oy = 0; this.s = 1; }

  /** Canon tourné : paires (x, rayon mm) ; cannelé entre f0 et f1 si f1 > f0. */
  private barrel(g: RifleMesh, prof: number[], mat: Matter = P.STEEL, f0 = 0, f1 = 0): void {
    g.mat(mat);
    this.axis(g, BORE);
    if (f1 > f0) g.lathe(this.zr(prof), 48, P.flutes(this.Z(f0), this.Z(f1), 0.0028, 6));
    else g.lathe(this.zr(prof), 28);
    g.pop();
  }

  /** Boîtier prismatique : x0..x1, de yTop à yBot ; fenêtre d'éjection (xp0..xp1, yp0..yp1) ouverte à droite. */
  private boxReceiver(g: RifleMesh, x0: number, xp0: number, xp1: number, x1: number, yTop: number, yBot: number, yp0: number, yp1: number, w: number): void {
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    g.block(Z(x0), Z(xp0), Y(yBot), Y(yTop), w, 0.0025);
    g.block(Z(xp1), Z(x1), Y(yBot), Y(yTop), w, 0.0025);
    g.block(Z(xp0), Z(xp1), Y(yp0), Y(yTop), w, 0.0025);
    g.block(Z(xp0), Z(xp1), Y(yBot), Y(yp1), w, 0.0025);
    g.block(Z(xp0), Z(xp1), Y(yp1), Y(yp0), w * 0.28, 0, w * 0.36);
  }

  /** Poignée pistolet type AR ; (x, y) : coin haut-avant, sous le châssis ; k : échelle. */
  private arGrip(g: RifleMesh, x: number, y: number, k = 1, mat: Matter = P.GRIP): void {
    const a = [-34, 0, 2, 0, 0, 2, 2, 15, 3, -11, 26, 7, -17, 43, 12, -31, 63, 10, -40, 84, 5, -84, 79, 7, -75, 51, 14, -63, 27, 12, -69, 11, 5, -65, 2, 3];
    const o: number[] = [];
    for (let i = 0; i < a.length; i += 3) o.push(x + a[i] * k, y + a[i + 1] * k, a[i + 2] * k);
    g.mat(mat);
    g.extrude(this.rp(o, 5), 0.03, 0.008, 3);
  }

  /** Appui-joue sur deux colonnettes : plateau (x0..x1, dessus à yTop) et tiges jusqu'à yBase. */
  private cheekRest(g: RifleMesh, x0: number, x1: number, yTop: number, yBase: number, w = 0.044, th = 14): void {
    g.mat(P.POLY);
    g.extrude(this.rp([x0, yTop + 5, 4, x0 + 8, yTop, 4, x1 - 8, yTop, 4, x1, yTop + 6, 4, x1 - 2, yTop + th, 2, x0 + 2, yTop + th, 2], 4), w, 0.006, 2);
    g.mat(P.STEEL);
    for (const px of [lerp(x0, x1, 0.28), lerp(x0, x1, 0.72)]) {
      g.push(along(V(0, -1, 0), V(0, this.Y(yTop + th - 2), this.Z(px))));
      g.lathe([p2(0, 0.005), p2((yBase - yTop - th + 2) * 0.001, 0.005)], 8);
      g.pop();
    }
  }

  /** Plaque de couche caoutchouc : x de 0 à `t`, y de y0 à y1. */
  private buttPad(g: RifleMesh, t: number, y0: number, y1: number, w = 0.042): void {
    g.mat(P.RUBBER);
    g.extrude(this.rp([0, y0 + 6, 6, t, y0, 1, t, y1, 1, 0, y1 - 4, 6], 5), w, 0.005, 3);
  }

  /** Chargeur parallélépipédique amovible (nœud `magazine`) avec semelle. */
  private boxMag(x0: number, x1: number, y0: number, y1: number, w: number, mat: Matter = P.STEEL_MAT, slant = 4): void {
    this.magBegin(V(0, this.Y((y0 + y1) * 0.5), this.Z((x0 + x1) * 0.5)));
    this.gm.mat(mat);
    this.gm.extrude(this.rp([x0, y0, 1, x1, y0, 1, x1, y1 - slant, 2, x0, y1, 2]), w, 0.0015, 1);
    this.gm.extrude(this.rp([x0 - 2, y1 - 5, 2, x1 + 2, y1 - 5 - slant, 2, x1 + 2, y1 + 1 - slant, 2, x0 - 2, y1 + 2, 2]), w + 0.003, 0.0015, 1);
  }

  /** Lunette Nightforce ATACR (5-25x56 ou 7-35x56 selon la fiche) : tourelles à xs, rail à yRail. Retourne [ys, zOc]. */
  private optic(g: RifleMesh, def: WeaponDef, xs: number, yRail: number): number[] {
    const railTop = this.Y(yRail);
    const ys = railTop + 0.036;
    const zOc = P.scope(g, this.Z(xs), ys, def.scope[1] > 30 ? 0.95 : 0.91, 0.0325, railTop, false);
    return [ys, zOc];
  }

  /** Repères des mains, de la joue, de la crosse, du chargeur, de la bouche et de l'œil (couples x, y des relevés). */
  private marks(def: WeaponDef, o: { grip: number[]; forend: number[]; cheek: number[]; butt: number[]; mag: number[]; muzzle: number; eye: number[]; feet: Vector3[]; barrel: number; brake: boolean }): void {
    const at = (a: number[]): Vector3 => V(0, this.Y(a[1]), this.Z(a[0]));
    this.anchor('bipod_feet_l', o.feet[0], 'bipod'); this.anchor('bipod_feet_r', o.feet[1], 'bipod');
    this.anchor('grip', at(o.grip)); this.anchor('forend', at(o.forend)); this.anchor('cheek', at(o.cheek));
    this.anchor('butt', at(o.butt)); this.anchor('mag', at(o.mag));
    this.anchor('muzzle', V(0, BORE, this.Z(o.muzzle)));
    this.anchor('eye', V(0, o.eye[0], o.eye[1] - 0.07));
    this.finish(def, 0, o.muzzle, o.barrel, o.brake);
  }

  // ------------------------------------------------------------------ Savage 110 Elite Precision, châssis MDT ACC (6 mm Creedmoor)
  savage(def: WeaponDef, alu: Matter): void {
    this.frame(325);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    // canon inox lourd de 26 pouces, frein à deux chambres
    this.barrel(g, [500, 14.5, 530, 14.5, 562, 12.5, 1056, 11, 1056, 8.5, 1072, 8.5], P.STAINLESS);
    P.brake(g, BORE, Z(1054), 0.064, 0.0135, 2, 0.0042, 0.36);
    // boîtier cylindrique noir, écrou de canon, rail
    g.mat(P.STEEL);
    this.receiver(g, 318, 386, 458, 505, 17, 10.5, 14, 1.9, 3.3, 28);
    this.axis(g, BORE); g.lathe(this.zr([503, 14, 503, 17.5, 522, 17.5, 522, 14]), 24, P.teeth(-1, 1, 0.0008)); g.pop();
    P.picatinny(g, Z(332), Z(505), Y(-27), 0.0094, P.STEEL);
    // châssis : corps central, puits de chargeur, pontet intégré
    g.mat(alu);
    g.extrude(this.rp([258, 8, 2, 502, 8, 2, 502, 36, 2, 480, 56, 4, 462, 62, 3, 378, 62, 2, 372, 110, 3, 300, 110, 4, 296, 86, 3, 270, 82, 3, 258, 60, 3]), 0.044, 0.0025, 1,
      [this.rp([306, 70, 3, 365, 70, 3, 362, 104, 3, 306, 104, 3])]);
    // fût en U à lumières M-LOK, rail ARCA sur toute la longueur
    const slots: P2[][] = [];
    for (let x = 524; x + 32 < 872; x += 40) slots.push(this.rp([x, 16, 3, x + 32, 16, 3, x + 32, 23, 3, x, 23, 3], g.q >= 1 ? 2 : 1));
    g.extrude(this.rp([480, 6, 1, 880, 6, 2, 880, 30, 3, 872, 34, 2, 480, 34, 1]), 0.05, 0.003, 1, slots);
    g.block(Z(500), Z(878), Y(40), Y(33), 0.038, 0.0015);
    this.trigger(g, 328, 71, 96);
    // poignée verticale rapportée
    g.mat(P.GRIP);
    g.extrude(this.rp([254, 84, 2, 298, 84, 2, 299, 100, 3, 293, 150, 5, 250, 152, 5, 250, 104, 6], 5), 0.03, 0.008, 3);
    // crosse squelette réglable : cadre ajouré, appui-joue, plaque de couche
    g.mat(alu);
    g.extrude(this.rp([34, 14, 2, 258, 10, 2, 258, 62, 3, 232, 66, 4, 152, 118, 6, 120, 124, 3, 34, 124, 2]), 0.03, 0.002, 1, [
      this.rp([48, 26, 3, 108, 25, 3, 108, 60, 3, 48, 60, 3]), this.rp([120, 25, 3, 214, 23, 3, 182, 56, 3, 120, 60, 3]),
      this.rp([48, 72, 3, 108, 72, 3, 108, 112, 3, 48, 112, 3]), this.rp([120, 72, 3, 172, 70, 3, 142, 106, 3, 120, 110, 3]),
      this.rp([200, 52, 2, 246, 24, 2, 246, 52, 2])]);
    g.mat(P.POLY);
    g.extrude(this.rp([72, 0, 4, 80, -4, 4, 168, -4, 4, 176, 2, 4, 174, 12, 2, 74, 12, 2], 4), 0.04, 0.006, 2);
    g.block(Z(34), Z(46), Y(128), Y(12), 0.036, 0.002);
    this.buttPad(g, 34, 14, 130, 0.04);
    for (const kx of [92, 150]) {
      g.mat(P.STEEL);
      g.push(along(V(-1, 0, 0), V(-0.015, Y(40), Z(kx))));
      g.lathe([p2(0, 0.009), p2(0.006, 0.009), p2(0.007, 0.007), p2(0.007, 0)], 12, P.teeth(-1, 0.0065, 0.0012));
      g.pop();
    }
    const [ys, zOc] = this.optic(g, def, 405, -27);
    const k = P.bolt(this.gb, Z(322), Z(462), 0.0098, Z(340), 0.058, 0.04, Z(328), 0.011, this.zr([306, 0, 306, 8, 312, 12, 334, 12, 334, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(384, 456, 30, 106, 0.024, P.POLY, 2);
    this.bipodPos = V(0, Y(40), Z(840));
    this.marks(def, { grip: [275, 120], forend: [680, 38], cheek: [124, -4], butt: [1, 70], mag: [420, 106], muzzle: 1118, eye: [ys, zOc], feet: P.harris(this.gp, 0.2), barrel: 0.66, brake: true });
  }

  // ------------------------------------------------------------------ crosses composites (Bergara B-14 HMR, Seekins Havak PH2)
  /** Pontet en feuillard et détente, communs aux deux carabines à crosse moulée. */
  private bottomMetal(g: RifleMesh, y: number): void {
    g.mat(P.STEEL);
    g.extrude(ribbon(this.rp([318, y, 0, 319, y + 22, 12, 332, y + 31, 10, 362, y + 31, 12, 374, y + 20, 12, 375, y, 0], 6), 0.0028), 0.013, 0.0007, 1);
    this.trigger(g, 348, y + 1, y + 23);
  }

  /** Bergara B-14 HMR (6.5 PRC) : crosse moulée à mini-châssis, appui-joue réglable, canon lourd fileté sans frein. */
  hmr(def: WeaponDef, poly: Matter): void {
    this.frame(345);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const hwf = (p: P2): number => lerp(lerp(0.022, 0.018, sstep(-0.24, -0.1, p.x)), 0.0245, sstep(-0.06, 0.05, p.x));
    g.mat(poly);
    g.extrude(this.rp([52, 14, 3, 212, 14, 4, 250, 36, 16, 292, 22, 8, 330, 12, 3, 790, 7, 3, 792, 30, 6, 762, 38, 8, 520, 45, 0, 470, 49, 3, 376, 50, 2, 316, 50, 4,
      292, 72, 9, 272, 130, 6, 264, 143, 5, 224, 139, 8, 216, 112, 14, 200, 92, 12, 150, 98, 8, 104, 100, 6, 92, 140, 5, 52, 142, 3], 6), 0.046, 0.0105, 4, [], 0, hwf);
    // appui-joue réglable, molette côté droit
    g.extrude(this.rp([84, 2, 6, 92, -2, 5, 200, -2, 5, 210, 6, 5, 208, 20, 3, 86, 20, 3], 5), 0.04, 0.008, 3);
    g.mat(P.STEEL);
    g.push(along(V(-1, 0, 0), V(-0.021, Y(52), Z(150))));
    g.lathe([p2(0, 0.011), p2(0.005, 0.011), p2(0.006, 0.009), p2(0.006, 0)], 14, P.teeth(-1, 0.0055, 0.0012));
    g.pop();
    // cales de longueur et plaque de couche
    g.mat(P.POLY);
    g.block(Z(36), Z(52), Y(143), Y(13), 0.04, 0.002);
    this.buttPad(g, 36, 13, 143, 0.041);
    // canon lourd de 24 pouces, protège-filet
    g.mat(P.STEEL);
    const bp = this.zr([478, 15.5, 520, 15.5, 565, 12.5, 1096, 10.5, 1096, 11.3, 1116, 11.3]);
    P.crown(bp, Z(1118), 0.0113, 0.0034);
    this.axis(g, BORE); g.lathe(bp, 28); g.pop();
    this.receiver(g, 332, 392, 470, 500, 17, 10.5, 15, 1.9, 3.3, 28);
    P.picatinny(g, Z(340), Z(498), Y(-27), 0.0094, P.STEEL);
    this.bottomMetal(g, 50);
    this.stud(g, 120, 100); this.stud(g, 742, 39);
    const [ys, zOc] = this.optic(g, def, 418, -27);
    const k = P.bolt(this.gb, Z(336), Z(474), 0.0098, Z(352), 0.06, 0.034, Z(342), 0.0105, this.zr([318, 0, 318, 8, 324, 12, 346, 12, 346, 0]), true);
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(388, 462, 34, 90, 0.024, P.POLY, 2);
    this.bipodPos = V(0, Y(45), Z(742));
    this.marks(def, { grip: [262, 100], forend: [640, 42], cheek: [140, -2], butt: [1, 78], mag: [425, 90], muzzle: 1118, eye: [ys, zOc], feet: P.harris(this.gp, 0.2), barrel: 0.61, brake: false });
  }

  /** Seekins Havak PH2 (7 mm PRC) : crosse carbone de chasse, boîtier à pans et rail intégré, canon cannelé, chargeur affleurant. */
  havak(def: WeaponDef, poly: Matter): void {
    this.frame(345);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const hwf = (p: P2): number => lerp(lerp(0.021, 0.017, sstep(-0.24, -0.1, p.x)), 0.021, sstep(-0.06, 0.05, p.x));
    g.mat(poly);
    g.extrude(this.rp([30, 8, 3, 196, 12, 5, 238, 32, 16, 286, 20, 8, 322, 12, 3, 800, 9, 3, 802, 26, 6, 776, 33, 8, 540, 41, 0, 480, 46, 3, 376, 48, 2, 316, 48, 4,
      290, 68, 9, 268, 124, 6, 260, 137, 5, 222, 133, 8, 214, 108, 14, 196, 90, 14, 120, 106, 0, 30, 128, 3], 6), 0.042, 0.0105, 4, [], 0, hwf);
    this.buttPad(g, 30, 8, 129, 0.038);
    // canon acier cannelé de 26 pouces, frein
    this.barrel(g, [530, 14.5, 560, 14.5, 604, 11.2, 1126, 9.2, 1126, 7.8, 1140, 7.8], P.STEEL, 612, 1118);
    P.brake(g, BORE, Z(1124), 0.056, 0.0118, 2, 0.004, 0.32);
    g.mat(P.STEEL);
    this.receiver(g, 316, 382, 464, 532, 17, 10.5, 14.5, PI * 0.625, PI * 1.125, 8, true, PI / 8);
    P.picatinny(g, Z(350), Z(530), Y(-25), 0.0085, P.STEEL);
    this.bottomMetal(g, 48);
    this.stud(g, 96, 110); this.stud(g, 760, 34);
    const [ys, zOc] = this.optic(g, def, 440, -25);
    const k = P.bolt(this.gb, Z(322), Z(470), 0.0098, Z(338), 0.058, 0.032, Z(326), 0.0105, this.zr([302, 0, 302, 8, 308, 12, 330, 12, 330, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(388, 468, 34, 60, 0.023, P.POLY, 1);
    this.bipodPos = V(0, Y(40), Z(760));
    this.marks(def, { grip: [258, 98], forend: [650, 38], cheek: [130, 10], butt: [1, 70], mag: [428, 60], muzzle: 1180, eye: [ys, zOc], feet: P.harris(this.gp, 0.2), barrel: 0.66, brake: true });
  }

  // ------------------------------------------------------------------ Barrett MRAD (.300 PRC)
  mrad(def: WeaponDef, alu: Matter): void {
    this.frame(354);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    this.barrel(g, [600, 14, 940, 12.5, 1168, 10.6, 1168, 8.5, 1184, 8.5], P.STEEL, 950, 1158);
    P.brake(g, BORE, Z(1168), 0.087, 0.016, 2, 0.0048, 0.3);
    // boîtier supérieur monobloc : partie arrière basse, fenêtre d'éjection, rail continu jusqu'au bout du garde-main
    g.mat(alu);
    g.extrude(this.rp([231, -12, 2, 362, -12, 2, 376, -24, 2, 376, 17, 0, 231, 17, 2]), 0.044, 0.0025, 1);
    this.boxReceiver(g, 376, 432, 534, 628, -24, 17, -9, 5, 0.044);
    P.picatinny(g, Z(376), Z(942), Y(-33), 0.0094, alu);
    this.handguard(g, Z(628), Z(942), 0.027, Z(660), 7, 0, true);
    // boîtier inférieur : puits de chargeur, pontet
    g.extrude(this.rp([240, 17, 2, 548, 17, 1, 548, 68, 3, 416, 70, 2, 412, 100, 3, 336, 100, 4, 332, 68, 2, 300, 66, 3, 240, 50, 4]), 0.04, 0.0025, 1,
      [this.rp([340, 66, 3, 404, 66, 3, 404, 94, 3, 340, 94, 3])]);
    this.trigger(g, 357, 67, 88);
    this.arGrip(g, 334, 66, 1.08, [alu[0] * 0.9, alu[1] * 0.9, alu[2] * 0.9, 0, 0.8, 5]);
    // charnière, crosse squelette repliable, appui-joue
    g.mat(P.STEEL_MAT);
    g.extrude(this.rp([217, -8, 2, 233, -8, 2, 233, 34, 2, 217, 34, 2]), 0.04, 0.003, 1);
    g.mat(alu);
    g.extrude(this.rp([18, 0, 2, 217, 0, 2, 217, 30, 3, 200, 50, 5, 122, 96, 6, 18, 99, 2]), 0.03, 0.002, 1, [
      this.rp([30, 10, 3, 96, 10, 3, 96, 40, 3, 30, 40, 3]), this.rp([106, 10, 3, 205, 10, 3, 196, 40, 3, 106, 40, 3]), this.rp([30, 50, 3, 150, 50, 3, 112, 88, 3, 30, 88, 3])]);
    this.cheekRest(g, 56, 218, -42, 2, 0.044, 26);
    this.buttPad(g, 18, 0, 100);
    const [ys, zOc] = this.optic(g, def, 470, -33);
    const k = P.bolt(this.gb, Z(380), Z(536), 0.011, Z(398), 0.062, 0.037, Z(378), 0.013, []);
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(420, 545, 30, 132, 0.03, [alu[0] * 0.9, alu[1] * 0.9, alu[2] * 0.9, 0, 0.7, 2]);
    this.bipodPos = V(0, BORE - 0.027, Z(900));
    this.marks(def, { grip: [300, 130], forend: [780, 30], cheek: [130, -42], butt: [1, 50], mag: [482, 132], muzzle: 1255, eye: [ys, zOc], feet: P.harris(this.gp, 0.2), barrel: 0.66, brake: true });
  }

  // ------------------------------------------------------------------ Accuracy International AXSR (.338 LM, balle de 300 gr)
  axsr(def: WeaponDef, alu: Matter): void {
    this.frame(345);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    this.barrel(g, [540, 15, 960, 13.5, 1193, 11.5, 1193, 9, 1210, 9]);
    P.brake(g, BORE, Z(1193), 0.072, 0.0145, 3, 0.0048, 0.25);
    // boîtier à flancs plats, rail continu de la culasse au bout du garde-main à huit pans
    g.mat(alu);
    this.boxReceiver(g, 290, 440, 530, 562, -24, 22, -8, 6, 0.046);
    P.picatinny(g, Z(292), Z(962), Y(-33), 0.0094, alu);
    this.handguard(g, Z(562), Z(962), 0.028, Z(592), 9, 0, true);
    g.extrude(this.rp([262, 10, 2, 562, 10, 2, 562, 42, 3, 504, 60, 3, 504, 70, 2, 392, 70, 2, 388, 98, 3, 318, 98, 4, 314, 70, 2, 280, 66, 3, 262, 50, 3]), 0.042, 0.0025, 1,
      [this.rp([322, 68, 3, 384, 68, 3, 380, 92, 3, 322, 92, 3])]);
    this.trigger(g, 348, 69, 88);
    this.arGrip(g, 318, 68, 1.05);
    // charnière, crosse repliable : poutre ajourée, appui-joue sur colonnettes, plaque de couche et cales
    g.mat(P.STEEL_MAT);
    g.extrude(this.rp([252, -10, 2, 276, -10, 2, 276, 44, 2, 252, 44, 2]), 0.04, 0.003, 1);
    g.mat(alu);
    g.extrude(this.rp([40, -4, 2, 252, -4, 2, 252, 26, 3, 186, 32, 4, 152, 72, 6, 122, 98, 5, 40, 102, 3]), 0.03, 0.002, 1,
      [this.rp([58, 36, 3, 136, 36, 3, 114, 86, 3, 58, 90, 3]), this.rp([60, 6, 3, 236, 6, 3, 236, 18, 3, 60, 22, 3])]);
    this.cheekRest(g, 92, 240, -42, -2);
    g.mat(P.POLY);
    g.block(Z(24), Z(40), Y(108), Y(-10), 0.038, 0.002);
    this.buttPad(g, 24, -12, 112);
    const [ys, zOc] = this.optic(g, def, 445, -33);
    const k = P.bolt(this.gb, Z(296), Z(534), 0.011, Z(402), 0.06, 0.036, Z(384), 0.012, this.zr([270, 0, 270, 9, 276, 12.5, 292, 12.5, 292, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(396, 500, 30, 132, 0.032, [alu[0] * 0.95, alu[1] * 0.95, alu[2] * 0.95, 0.3, 0.6, 1]);
    this.bipodPos = V(0, BORE - 0.028, Z(915));
    this.marks(def, { grip: [282, 130], forend: [760, 30], cheek: [160, -42], butt: [1, 50], mag: [448, 132], muzzle: 1265, eye: [ys, zOc], feet: P.harris(this.gp, 0.2), barrel: 0.686, brake: true });
  }

  // ------------------------------------------------------------------ Tubb Adaptive Target Rifle (.33 XC)
  tubb(def: WeaponDef, alu: Matter): void {
    this.frame(365);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    // canon inox lourd de 33 pouces, frein à évents multiples
    this.barrel(g, [1000, 16, 1030, 16, 1356, 14, 1356, 10, 1372, 10], P.STAINLESS);
    P.brake(g, BORE, Z(1356), 0.064, 0.016, 4, 0.0048, 0.2);
    // boîtier tubulaire, rail, carter de détente et puits de chargeur
    g.mat(alu);
    this.receiver(g, 290, 440, 536, 622, 24, 11.5, 16, 1.9, 3.3, 32);
    P.picatinny(g, Z(300), Z(640), Y(-33), 0.0094, P.ALU);
    g.extrude(this.rp([300, 14, 2, 518, 14, 2, 518, 40, 2, 396, 40, 2, 392, 72, 3, 322, 72, 4, 318, 40, 2, 300, 36, 3]), 0.034, 0.0025, 1,
      [this.rp([326, 42, 3, 388, 42, 3, 384, 66, 3, 326, 66, 3])]);
    this.trigger(g, 368, 43, 62);
    this.arGrip(g, 322, 40, 1.05);
    // garde-main tubulaire à segments nervurés, grande bague avant porte-bipied
    const hp: number[] = [620, 16, 620, 27];
    for (let i = 0; i < 4; i++) { const s = 628 + i * 96; hp.push(s, 27, s, 28.5, s + 66, 28.5, s + 66, 25.5, s + 90, 25.5, s + 90, 27); }
    hp.push(1008, 27, 1008, 34, 1030, 34, 1030, 17);
    g.mat(P.ALU);
    this.axis(g, BORE);
    g.lathe(this.zr(hp), 32, (z, j) => (j % 4 === 0 && Math.abs(((z - Z(628)) % 0.096) - 0.033) < 0.032 && z < Z(1005) ? -0.0012 : 0));
    g.pop();
    // crosse : tube, console de plaque de couche réglable, appui-joue sur tiges, tige d'appui inférieure
    g.mat(alu);
    this.axis(g, Y(24));
    g.lathe(this.zr([44, 0, 44, 13, 290, 13, 290, 0]), 20);
    g.pop();
    g.extrude(this.rp([268, -6, 2, 300, -6, 2, 300, 40, 2, 268, 40, 3]), 0.036, 0.003, 1);
    g.extrude(this.rp([18, -30, 3, 48, -30, 3, 48, 106, 3, 18, 106, 3]), 0.03, 0.003, 1, [this.rp([26, 44, 3, 40, 44, 3, 40, 96, 3, 26, 96, 3]), this.rp([26, -22, 3, 40, -22, 3, 40, 4, 3, 26, 4, 3])]);
    g.mat(P.STEEL);
    this.axis(g, Y(70));
    g.lathe(this.zr([44, 0, 44, 7, 190, 7, 190, 0]), 12);
    g.pop();
    this.cheekRest(g, 108, 262, -40, 12, 0.04);
    this.buttPad(g, 18, -34, 110, 0.038);
    const [ys, zOc] = this.optic(g, def, 458, -33);
    const k = P.bolt(this.gb, Z(296), Z(540), 0.0115, Z(352), 0.06, 0.04, Z(340), 0.012, []);
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(400, 512, 26, 150, 0.034, P.POLY, 0);
    for (const dx of [-30, 0, 30]) this.gm.block(Z(456 + dx - 5), Z(456 + dx + 5), Y(140), Y(50), 0.037, 0.001);
    this.bipodPos = V(0, BORE - 0.034, Z(1019));
    this.marks(def, { grip: [285, 105], forend: [800, 30], cheek: [180, -40], butt: [1, 40], mag: [456, 150], muzzle: 1420, eye: [ys, zOc], feet: P.harris(this.gp, 0.22), barrel: 0.838, brake: true });
  }

  // ------------------------------------------------------------------ Desert Tech HTI (.375 CheyTac), bullpup
  hti(def: WeaponDef, alu: Matter): void {
    this.frame(418);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    const skin: Matter = [alu[0], alu[1], alu[2], 0, 0.7, 2];
    this.barrel(g, [560, 16, 882, 15, 1024, 13.5, 1024, 10, 1036, 10], P.STEEL, 892, 1014);
    // frein à quatre chambres, collier large
    g.mat(P.STEEL_MAT);
    this.axis(g, BORE); g.lathe(this.zr([1012, 13.5, 1012, 20, 1030, 20, 1030, 13.5]), 24); g.pop();
    P.brake(g, BORE, Z(1026), 0.101, 0.0175, 4, 0.0055, 0.2);
    // châssis : la culasse et sa fenêtre sont derrière la poignée ; rail continu jusqu'au bout du garde-main
    g.mat(alu);
    this.boxReceiver(g, 25, 161, 288, 581, -17, 42, -6, 12, 0.05);
    P.picatinny(g, Z(307), Z(884), Y(-26), 0.0094, alu);
    this.handguard(g, Z(581), Z(884), 0.03, Z(606), 7, 0.006, true);
    g.block(Z(590), Z(880), Y(42), Y(28), 0.03, 0.002);
    // habillage polymère : talon, puits de chargeur, poignée et pontet d'un seul tenant
    g.mat(skin);
    g.extrude(this.rp([25, 40, 0, 472, 40, 1, 472, 60, 3, 466, 92, 3, 386, 92, 2, 378, 122, 6, 370, 166, 4, 318, 166, 5, 312, 120, 8, 300, 84, 6, 290, 80, 2,
      148, 80, 2, 130, 102, 4, 82, 144, 4, 25, 144, 2], 5), 0.046, 0.006, 2, [this.rp([398, 56, 3, 458, 56, 3, 456, 86, 3, 398, 86, 3])]);
    this.trigger(g, 421, 57, 78);
    // appui-joue et plaque de couche, béquille arrière
    g.mat(P.POLY);
    g.extrude(this.rp([64, -27, 3, 222, -27, 3, 222, -16, 1, 64, -16, 1]), 0.04, 0.005, 2);
    this.buttPad(g, 25, -42, 147, 0.046);
    g.mat(P.STEEL);
    g.push(along(V(0, -1, 0), V(0, Y(142), Z(46))));
    g.lathe([p2(0, 0.007), p2(0.016, 0.007), p2(0.016, 0.011), p2(0.022, 0.011), p2(0.022, 0)], 12);
    g.pop();
    const [ys, zOc] = this.optic(g, def, 468, -26);
    const k = P.bolt(this.gb, Z(122), Z(292), 0.0125, Z(270), 0.064, 0.04, Z(280), 0.013, []);
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(150, 287, 62, 144, 0.036, P.STEEL_MAT, 0);
    this.bipodPos = V(0, Y(42), Z(840));
    this.marks(def, { grip: [345, 130], forend: [700, 44], cheek: [140, -27], butt: [1, 50], mag: [218, 144], muzzle: 1127, eye: [ys, zOc], feet: P.harris(this.gp, 0.21), barrel: 0.737, brake: true });
  }

  // ------------------------------------------------------------------ CheyTac M200 Intervention (.408 CheyTac)
  m200(def: WeaponDef, alu: Matter): void {
    this.frame(439);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    // Le relevé est fait crosse sortie à 1 422 mm (56 po, cote du constructeur). La crosse est télescopique : si la
    // fiche (build.overallMm) donne une longueur plus courte, tout le bloc arrière (selle, plaque de couche, béquille)
    // avance de `c` mm sur ses tubes, sans toucher au reste de l'arme.
    const c = Math.min(190, Math.max(0, 1422 - buildOf(def).overallMm));
    // canon cannelé libre, manchon et tube de liaison, frein
    this.barrel(g, [1000, 16, 1024, 15, 1358, 13, 1358, 10, 1372, 10], P.STEEL, 1032, 1346);
    P.brake(g, BORE, Z(1358), 0.064, 0.0165, 3, 0.0052, 0.3);
    g.mat(alu);
    this.axis(g, BORE);
    g.lathe(this.zr([662, 16, 662, 21, 809, 21, 809, 24, 972, 24, 972, 28, 1010, 28, 1010, 24, 1022, 24, 1022, 16.5]), 28);
    g.pop();
    // boîtier, rail, pontet
    this.boxReceiver(g, 424, 482, 613, 664, -22, 26, -8, 8, 0.048);
    P.picatinny(g, Z(436), Z(660), Y(-31), 0.0094, alu);
    g.block(Z(330), Z(424), Y(26), Y(8), 0.03, 0.003);
    g.mat(P.STEEL);
    g.extrude(ribbon(this.rp([420, 26, 0, 421, 50, 10, 432, 60, 8, 474, 60, 10, 488, 48, 10, 489, 26, 0], 4), 0.003), 0.014, 0.0008, 1);
    this.trigger(g, 442, 27, 50);
    // poignée et sa semelle large
    this.arGrip(g, 418, 26, 1);
    g.mat(P.GRIP);
    g.extrude(this.rp([326, 100, 4, 392, 104, 4, 396, 114, 4, 326, 116, 4]), 0.046, 0.006, 2);
    // crosse télescopique : tubes, selle d'appui-joue, plaque de couche, béquille
    g.mat(P.STEEL);
    this.axis(g, Y(14));
    g.lathe(this.zr([60 + c, 0, 60 + c, 9, 424, 9, 424, 0]), 14);
    g.pop();
    this.axis(g, Y(40));
    g.lathe(this.zr([40 + c, 0, 40 + c, 5, 330, 5, 330, 0]), 10);
    g.pop();
    // bloc arrière coulissant : relevé à x, posé à x + c
    this.ox -= c;
    g.mat(alu);
    g.extrude(this.rp([12, -28, 3, 168, -28, 4, 172, -10, 4, 70, -6, 3, 64, 52, 3, 12, 52, 2]), 0.05, 0.004, 2);
    g.extrude(this.rp([12, 52, 1, 48, 52, 1, 48, 104, 4, 12, 104, 2]), 0.04, 0.003, 1);
    this.buttPad(g, 12, -28, 106, 0.046);
    g.mat(P.STEEL);
    g.push(along(V(0, -1, 0), V(0, Y(102), Z(34))));
    g.lathe([p2(0, 0.006), p2(0.05, 0.006), p2(0.05, 0.011), p2(0.058, 0.014), p2(0.062, 0.014), p2(0.062, 0)], 12);
    g.pop();
    this.ox += c;
    // poignée de transport perforée, repliée sous le manchon
    g.mat(alu);
    const hh: P2[][] = [];
    const hn = g.q >= 1 ? 10 : 6;
    for (let i = 0; i < 5; i++) { const h: P2[] = []; for (let a = 0; a < hn; a++) h.push(p2(Z(668 + i * 30) + Math.cos((TAU * a) / hn) * 0.006, Y(62) + Math.sin((TAU * a) / hn) * 0.006)); hh.push(h); }
    g.extrude(this.rp([636, 50, 3, 826, 50, 3, 826, 24, 2, 846, 24, 2, 846, 56, 4, 826, 74, 4, 636, 74, 4]), 0.016, 0.002, 1, hh);
    g.block(Z(640), Z(662), Y(52), Y(24), 0.016, 0.002);
    const [ys, zOc] = this.optic(g, def, 548, -31);
    const k = P.bolt(this.gb, Z(440), Z(616), 0.012, Z(456), 0.06, 0.034, Z(440), 0.012, this.zr([408, 0, 408, 9, 414, 12.5, 428, 12.5, 428, 0]));
    this.anchor('bolt_handle', k, 'bolt');
    this.boxMag(489, 612, 30, 134, 0.036, P.STEEL_MAT, 0);
    for (const dx of [-36, -12, 12, 36]) this.gm.block(Z(550 + dx - 4), Z(550 + dx + 4), Y(124), Y(40), 0.039, 0.001);
    // bipied intégré, sur le collier du manchon
    this.bipodPos = V(0, Y(28), Z(991));
    this.marks(def, { grip: [380, 80], forend: [740, 76], cheek: [90 + c, -28], butt: [1 + c, 40], mag: [550, 134], muzzle: 1422, eye: [ys, zOc], feet: P.legBipod(this.gp, 0.25, false, false), barrel: 0.749, brake: true });
    this.info.length = Z(1422) - Z(c);
  }

  // ------------------------------------------------------------------ Barrett M99 (.416 Barrett), bullpup à un coup
  m99(def: WeaponDef, alu: Matter): void {
    this.frame(378);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    // canon lourd de 32 pouces, frein prismatique à deux évents
    this.barrel(g, [740, 17, 1143, 16, 1143, 12, 1160, 12]);
    P.boxBrake(g, BORE, Z(1143), 0.127, 0.05, 0.054, 2, 0.0075);
    // boîtier en profilé d'aluminium : fenêtre de chargement à l'arrière, nez en sifflet, rail
    g.mat(alu);
    this.boxReceiver(g, 44, 119, 325, 404, -24, 38, -12, 16, 0.05);
    g.extrude(this.rp([404, -24, 0, 764, -24, 2, 766, -6, 3, 704, 25, 3, 404, 25, 0]), 0.05, 0.0025, 1);
    P.picatinny(g, Z(321), Z(668), Y(-33), 0.0094, P.ALU);
    // carter de détente, pontet, poignée
    g.mat(P.STEEL_MAT);
    g.extrude(this.rp([316, 38, 1, 414, 38, 1, 414, 104, 4, 350, 104, 4, 346, 70, 2, 316, 66, 3]), 0.03, 0.002, 1, [this.rp([356, 70, 3, 407, 70, 3, 407, 98, 3, 356, 98, 3])]);
    this.trigger(g, 381, 71, 91);
    this.arGrip(g, 350, 68, 1.08);
    // plaque de couche sculptée, fixée au dos du boîtier
    g.mat(P.RUBBER);
    g.extrude(this.rp([0, -8, 8, 18, -18, 5, 44, -18, 1, 44, 62, 1, 52, 72, 3, 52, 113, 3, 12, 113, 8, 0, 92, 6], 5), 0.046, 0.006, 3);
    const [ys, zOc] = this.optic(g, def, 500, -33);
    const k = P.bolt(this.gb, Z(126), Z(336), 0.014, Z(318), 0.064, 0.062, Z(290), 0.014, []);
    this.anchor('bolt_handle', k, 'bolt');
    // arme à un coup : pas de chargeur. Le nœud `magazine` porte la cartouche de .416 Barrett (116 mm), montrée le
    // temps du rechargement ; son repos est l'auget, devant la tête de culasse ouverte (recul de 120 mm).
    this.magPos = V(0, BORE, Z(276));
    this.gm.mat([0.72, 0.56, 0.27, 1, 0.3, 0]);
    this.gm.lathe([p2(-0.058, 0), p2(-0.058, 0.0086), p2(-0.0565, 0.0093), p2(-0.055, 0.0093), p2(-0.0545, 0.0082), p2(-0.053, 0.0082), p2(-0.052, 0.0093),
      p2(0.004, 0.0088), p2(0.011, 0.0061), p2(0.025, 0.006), p2(0.025, 0)], 14);
    this.gm.mat([0.62, 0.36, 0.22, 1, 0.34, 0]);
    this.gm.lathe([p2(0.025, 0.0053), p2(0.034, 0.0053), p2(0.046, 0.0038), p2(0.055, 0.0016), p2(0.058, 0.0006), p2(0.058, 0)], 14);
    this.bipodPos = V(0, Y(25), Z(703));
    this.marks(def, { grip: [318, 130], forend: [600, 27], cheek: [200, -24], butt: [1, 45], mag: [276, -12], muzzle: 1270, eye: [ys, zOc], feet: P.legBipod(this.gp, 0.25, true, false, 0.3), barrel: 0.813, brake: true });
  }

  // ------------------------------------------------------------------ Steyr HS .50 M1 (.50 BMG)
  hs50(def: WeaponDef, alu: Matter): void {
    this.frame(430);
    const g = this.g;
    const Z = (x: number): number => this.Z(x), Y = (y: number): number => this.Y(y);
    // canon cannelé de 35 pouces, frein à trois chambres
    // (longueur hors tout de la fiche Steyr : 1 460 mm, frein compris)
    this.barrel(g, [585, 22, 640, 22, 662, 20, 1324, 16.5, 1324, 18, 1339, 18, 1339, 12, 1356, 12], P.STEEL, 684, 1308);
    P.brake(g, BORE, Z(1339), 0.121, 0.022, 3, 0.0075, 0.25);
    // boîtier tubulaire, pont de rail ajouré au-dessus du canon
    g.mat(P.STEEL);
    this.receiver(g, 232, 331, 465, 585, 25, 14.5, 21, 1.9, 3.3, 32);
    g.mat(alu);
    g.extrude(this.rp([384, -25, 2, 384, -46, 3, 825, -46, 3, 825, -30, 2, 800, -25, 2]), 0.032, 0.0025, 1,
      [this.rp([536, -41, 2, 596, -41, 2, 596, -33, 2, 536, -33, 2]), this.rp([616, -41, 2, 676, -41, 2, 676, -33, 2, 616, -33, 2]), this.rp([696, -41, 2, 756, -41, 2, 756, -33, 2, 696, -33, 2])]);
    P.picatinny(g, Z(378), Z(828), Y(-54), 0.0094, alu);
    // carter de détente et pontet, fût sous le canon
    g.extrude(this.rp([290, 24, 2, 487, 24, 1, 487, 48, 3, 470, 74, 3, 466, 104, 4, 400, 104, 4, 396, 72, 2, 340, 72, 3, 290, 45, 3]), 0.036, 0.0025, 1,
      [this.rp([406, 76, 3, 460, 76, 3, 458, 98, 3, 406, 98, 3])]);
    g.extrude(this.rp([485, 24, 1, 949, 24, 2, 951, 40, 4, 902, 62, 6, 520, 66, 3, 485, 50, 2]), 0.058, 0.004, 2);
    this.trigger(g, 433, 77, 96);
    this.arGrip(g, 396, 72, 1.08);
    // crosse : bloc supérieur à appui-joue réglable, jambe inférieure ajourée, cales et plaque de couche, béquille
    g.extrude(this.rp([55, -31, 3, 232, -31, 2, 232, 28, 2, 55, 28, 2]), 0.046, 0.003, 1);
    g.extrude(this.rp([100, 28, 1, 292, 28, 1, 292, 42, 2, 262, 48, 3, 232, 104, 4, 100, 104, 3]), 0.032, 0.0025, 1, [this.rp([116, 40, 3, 248, 40, 3, 222, 92, 3, 116, 92, 3])]);
    g.mat(P.POLY);
    g.extrude(this.rp([76, -42, 3, 216, -42, 3, 216, -31, 1, 76, -31, 1]), 0.04, 0.005, 2);
    g.block(Z(30), Z(55), Y(116), Y(-22), 0.042, 0.002);
    this.buttPad(g, 30, -22, 118, 0.046);
    g.mat(P.STEEL);
    g.push(along(V(-1, 0, 0), V(-0.023, Y(-4), Z(150))));
    g.lathe([p2(0, 0.011), p2(0.006, 0.011), p2(0.007, 0.009), p2(0.007, 0)], 14, P.teeth(-1, 0.0065, 0.0012));
    g.pop();
    g.push(along(V(0, -1, 0), V(0, Y(104), Z(84))));
    g.lathe([p2(0, 0.007), p2(0.018, 0.007), p2(0.018, 0.012), p2(0.026, 0.012), p2(0.026, 0)], 12);
    g.pop();
    const [ys, zOc] = this.optic(g, def, 486, -54);
    const k = P.bolt(this.gb, Z(246), Z(482), 0.0155, Z(468), 0.072, 0.062, Z(460), 0.015, []);
    this.anchor('bolt_handle', k, 'bolt');
    // chargeur latéral de cinq coups, à gauche du boîtier (particularité du M1)
    this.magBegin(V(0.08, BORE, Z(410)));
    this.gm.mat(P.STEEL_MAT);
    this.gm.extrude(this.rp([348, -14, 2, 470, -14, 2, 470, 14, 2, 348, 14, 2]), 0.115, 0.002, 1, [], 0.08);
    this.gm.extrude(this.rp([344, -17, 2, 474, -17, 2, 474, 17, 2, 344, 17, 2]), 0.008, 0.002, 1, [], 0.139);
    // il s'enlève par le côté, dans son axe
    this.magOut = V(0.13, 0, 0);
    // bipied intégré à patins en ski, au bout du fût
    this.bipodPos = V(0, Y(50), Z(958));
    this.marks(def, { grip: [362, 135], forend: [700, 66], cheek: [150, -42], butt: [1, 48], mag: [410, 0], muzzle: 1460, eye: [ys, zOc], feet: P.legBipod(this.gp, 0.22, false, true, 0.36, 0.06), barrel: 0.889, brake: true });
  }

  /** Bipied intégré du PGM : chape pivotante, jambes télescopiques, patins. */
  pgmBipod(g: RifleMesh, alu: Matter): Vector3[] {
    g.mat(alu);
    g.block(-0.016, 0.016, -0.012, 0.01, 0.058, 0.003);
    g.mat(P.STEEL);
    g.push(along(V(1, 0, 0), V(-0.031, 0, 0)));
    g.lathe([p2(0, 0), p2(0, 0.0045), p2(0.062, 0.0045), p2(0.062, 0)], 12);
    g.pop();
    const feet: Vector3[] = [];
    const leg = 0.215;
    for (const s of [1, -1]) {
      const top = V(s * 0.027, -0.006, 0);
      const dir = V(s * 0.33, -0.94, 0.03).normalize();
      g.push(along(dir, top));
      g.mat(alu);
      g.lathe([p2(-0.006, 0), p2(-0.006, 0.009), p2(0.03, 0.009), p2(0.032, 0.0078), p2(leg * 0.6, 0.0078), p2(leg * 0.6, 0.0095), p2(leg * 0.6 + 0.018, 0.0095), p2(leg * 0.6 + 0.018, 0.006)], 14);
      g.mat(P.STEEL);
      g.lathe([p2(leg * 0.6 + 0.018, 0.006), p2(leg - 0.012, 0.006)], 12);
      g.pop();
      // patin en T
      const foot = top.clone().addScaledVector(dir, leg);
      g.mat(P.RUBBER);
      g.push(translate(foot.x, foot.y, foot.z));
      g.extrude(rpoly([-0.016, 0.012, 0.003, 0.016, 0.012, 0.003, 0.019, 0, 0.004, -0.019, 0, 0.004], 3), 0.02, 0.003, 2);
      g.pop();
      feet.push(foot);
    }
    return feet;
  }
}

/** Géométrie d'une arme (mise en cache par identifiant et niveau de détail). `quality` : 1 complet, 0.5 allégé. */
export function rifleBlueprint(def: WeaponDef, quality = 1): RifleBlueprint {
  const key = def.id + '_' + quality;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new Builder(quality);
  const c = new Color(def.look.color);
  const tint = (base: Matter): Matter => [c.r * 0.62, c.g * 0.62, c.b * 0.62, base[3], base[4], base[5]];
  // def.look.color est une couleur sRGB : Color la convertit en linéaire, on revient en sRGB pour les matières
  c.convertLinearToSRGB();
  switch (def.id) {
    case '22lr': b.cz457(def); break;
    case '223': case '65cm': b.tikka(def, tint(P.ALU)); break;
    case '308': case '308sub': b.rpr(def, tint(P.ALU)); break;
    case '300wm': b.trg(def, tint(P.POLY)); break;
    case '6cm': b.savage(def, tint(P.ALU)); break;
    case '65prc': b.hmr(def, tint(P.POLY)); break;
    case '7prc': b.havak(def, tint(P.POLY)); break;
    case '300prc': b.mrad(def, tint(P.ALU)); break;
    case '338lm300': b.axsr(def, tint(P.ALU)); break;
    case '33xc': b.tubb(def, tint(P.ALU)); break;
    case '375ct': b.hti(def, tint(P.ALU)); break;
    case '408ct': b.m200(def, tint(P.ALU)); break;
    case '416b': b.m99(def, tint(P.ALU)); break;
    case '50bmg': b.hs50(def, tint(P.ALU)); break;
    default: b.pgm(def, tint(P.ALU));
  }
  b.info.tris = b.g.triCount + b.gb.triCount + b.gp.triCount + b.gm.triCount;
  b.info.trisNoBipod = b.info.tris - b.gp.triCount;
  const merged = new RifleMesh();
  merged.append(b.g);
  merged.append(b.gb, b.boltPos.x, b.boltPos.y, b.boltPos.z);
  // (arme à un coup : le nœud `magazine` porte une cartouche, absente de l'arme au râtelier)
  if (buildOf(def).feed !== 'single') merged.append(b.gm, b.magPos.x, b.magPos.y, b.magPos.z);
  const bp: RifleBlueprint = {
    main: b.g.commit(), bolt: b.gb.commit(), bipod: b.gp.commit(), mag: b.gm.commit(), merged: merged.commit(),
    boltPos: b.boltPos, bipodPos: b.bipodPos, magPos: b.magPos, magOut: b.magOut, anchors: b.anchors, info: b.info,
  };
  cache.set(key, bp);
  return bp;
}

// ---------------------------------------------------------------------------------------------------------------
// Matériau unique des carabines (un appel de dessin par nœud). Par sommet : color = teinte, aMat = (métal, rugosité,
// nature, masque d'arête). Natures : 0 acier bronzé · 1 aluminium anodisé / peint · 2 polymère grainé · 3 caoutchouc ·
// 4 noyer verni · 5 caoutchouc picoté · 6 lentille traitée. Porté de native/game/shaders/rifle_surface.gdshader.
const FRAG_DECL = /* glsl */ `
varying vec4 vRifleMat;
varying vec3 vRiflePos;
varying vec3 vRifleNor;
float rHash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float rNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rHash3(i), rHash3(i + vec3(1, 0, 0)), f.x), mix(rHash3(i + vec3(0, 1, 0)), rHash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(rHash3(i + vec3(0, 0, 1)), rHash3(i + vec3(1, 0, 1)), f.x), mix(rHash3(i + vec3(0, 1, 1)), rHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float rFbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 3; i++) { s += a * rNoise(p); p = p * 2.03 + vec3(7.1, 3.7, 1.3); a *= 0.5; } return s * 1.14; }
float rCells(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 c = o + vec3(rHash3(i + o), rHash3(i + o + 17.0), rHash3(i + o + 31.0)) - f;
    d = min(d, dot(c, c));
  }
  return sqrt(d);
}
float rBox(vec2 p, vec4 b, float ang) {
  vec2 d = p - b.xy; float c = cos(ang); float s = sin(ang);
  d = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  vec2 e = abs(d) - b.zw + 0.006;
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - 0.006;
}
// relief sans tangentes : gradient de hauteur en espace écran (Mikkelsen)
vec3 rBump(vec3 n, vec3 p, float h, float k) {
  vec3 dpx = dFdx(p); vec3 dpy = dFdy(p);
  vec3 r1 = cross(dpy, n); vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - k * g);
}
`;
const FRAG_BODY = /* glsl */ `
  vec3 rAlb = diffuseColor.rgb;
  float rEdge = vRifleMat.w;
  float rMet = vRifleMat.x;
  float rRough = vRifleMat.y;
  int rK = int(vRifleMat.z + 0.5);
  vec3 rP = vRiflePos;
  float rN1 = rFbm(rP * 55.0);
  float rPx = length(fwidth(rP));
  float rFine = 1.0 - smoothstep(0.0004, 0.0016, rPx);
  float rMid = 1.0 - smoothstep(0.002, 0.008, rPx);
  float rH = 0.0;
  float rHk = 0.0;
  vec3 rLens = vec3(0.0);
  float rWear = smoothstep(0.6, 1.0, rEdge) * (0.12 + 0.3 * smoothstep(0.45, 0.65, rN1));
  if (rK == 0) {
    rAlb *= 0.82 + 0.36 * rN1;
    rRough += (rN1 - 0.5) * 0.16;
    rAlb = mix(rAlb, vec3(0.30, 0.30, 0.32), rWear * 0.75);
    rRough = mix(rRough, 0.3, rWear * 0.7);
    rH = rNoise(rP * 1400.0); rHk = 0.00005 * rFine;
  } else if (rK == 1) {
    rH = rNoise(rP * 1800.0); rHk = 0.00007 * rFine;
    rAlb *= 0.9 + 0.2 * rN1;
    rRough += (rN1 - 0.5) * 0.1;
    rAlb = mix(rAlb, vec3(0.5, 0.51, 0.53), rWear * 0.6);
    rMet = mix(rMet, 1.0, rWear);
    rRough = mix(rRough, 0.34, rWear);
  } else if (rK == 2) {
    rH = rNoise(rP * 1100.0) * 0.6 + rNoise(rP * 2300.0) * 0.4; rHk = 0.00025 * rFine;
    rAlb *= 0.9 + 0.2 * rN1;
    rRough = mix(rRough + (rH - 0.5) * 0.12 * rFine, rRough * 0.72, rWear * 0.6);
    rAlb = mix(rAlb, rAlb * 1.5 + 0.01, rWear * 0.5);
  } else if (rK == 3) {
    rH = rNoise(rP * 800.0); rHk = 0.0002 * rFine;
    rAlb *= 0.85 + 0.3 * rN1;
  } else if (rK == 4) {
    // noyer verni : cernes étirés le long de l'arme, pores sombres, vernis
    float warp = rFbm(rP * vec3(7.0, 7.0, 1.6)) * 0.085;
    float r = length(vec2(rP.x * 1.1, rP.y * 0.55 + 0.08)) + warp + rP.z * 0.016;
    float ring = sin(r * 250.0) * 0.5 + 0.5;
    float streak = rFbm(vec3(rP.x * 130.0, rP.y * 130.0, rP.z * 5.0));
    float fig = smoothstep(0.15, 0.9, ring * 0.45 + streak * 0.75);
    vec3 wood = mix(vec3(0.07, 0.027, 0.01), vec3(0.36, 0.16, 0.055), fig);
    wood = mix(wood, vec3(0.42, 0.23, 0.09), smoothstep(0.62, 0.9, rFbm(rP * vec3(20.0, 20.0, 3.0))) * 0.5);
    float pore = smoothstep(0.78, 0.9, rNoise(vec3(rP.x * 1500.0, rP.y * 1500.0, rP.z * 90.0)));
    wood *= 1.0 - 0.4 * pore * rMid;
    rAlb = wood * (rAlb / 0.029) * 0.5;
    rRough = 0.2 + 0.1 * streak;
    rH = streak; rHk = 0.00003 * rFine;
    // zones picotées (prise en main), seulement sur les flancs
    float sd = min(rBox(rP.zy, vec4(-0.085, -0.022, 0.044, 0.025), 0.72), rBox(rP.zy, vec4(0.282, 0.0185, 0.115, 0.0095), 0.012));
    float side = smoothstep(0.45, 0.75, abs(normalize(vRifleNor).x));
    float st = (1.0 - smoothstep(-0.0008, 0.0008, sd)) * side;
    if (st > 0.001) {
      float cd = rCells(rP * 1250.0);
      rAlb = mix(rAlb, rAlb * (0.38 + 0.5 * cd), st);
      rRough = mix(rRough, 0.62, st);
      rH = mix(rH, cd * 1.6, st);
      rHk = mix(rHk, 0.0006 * rFine, st);
    }
  } else if (rK == 5) {
    float cd = rMid > 0.01 ? rCells(rP * 900.0) : 0.5;
    rH = cd; rHk = 0.0007 * rFine;
    rAlb *= 0.7 + 0.5 * cd * rMid;
  }
  diffuseColor.rgb = rAlb;
`;
const FRAG_NORMAL = /* glsl */ `
  if (rHk > 0.0) normal = rBump(normal, -vViewPosition, rH, rHk);
  if (rK == 6) {
    // lentille traitée multicouche : reflet vert-magenta selon l'angle
    float f = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    vec3 coatc = mix(vec3(0.05, 0.32, 0.16), vec3(0.42, 0.06, 0.38), smoothstep(0.15, 0.75, f));
    diffuseColor.rgb = mix(vec3(0.004, 0.006, 0.01), coatc, 0.25 + 0.6 * f);
    metalnessFactor = 0.92;
    roughnessFactor = 0.06;
    rLens = coatc * 0.012;
  }
`;

let material: MeshStandardMaterial | null = null;
export function rifleMaterial(engine: Engine): MeshStandardMaterial {
  if (material) return material;
  const m = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.5, envMapIntensity: 1 });
  material = engine.setupMaterial(m, (sh: any) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nvarying vec4 vRifleMat;\nvarying vec3 vRiflePos;\nvarying vec3 vRifleNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRifleMat = aMat;\nvRiflePos = position;\nvRifleNor = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_BODY)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(rRough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = rMet;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += rLens;');
  }, 'rifle');
  return material;
}
