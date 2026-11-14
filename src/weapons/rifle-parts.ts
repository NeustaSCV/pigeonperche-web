// Pièces communes aux carabines : lunette tactique (tube 34 mm), rail Picatinny, colliers, bipied type Harris,
// freins de bouche, modérateur, verrou. Porté de native/game/src/weapons/rifle_parts.gd.
// Tout en mètres, dans le repère de l'arme (canon vers +Z, côté droit = −X).
import { Matrix4, Vector3 } from 'three';
import { RifleMesh, along, arc, p2, translate, type LatheMod, type Matter, type P2 } from './rifle-mesh';

// matières : [r, g, b (sRGB), métal, rugosité, nature] (natures : voir rifle-model.ts)
export const STEEL: Matter = [0.105, 0.108, 0.118, 0.85, 0.4, 0];
export const STEEL_MAT: Matter = [0.13, 0.13, 0.135, 0.65, 0.58, 0];
export const BRIGHT: Matter = [0.66, 0.66, 0.68, 1.0, 0.26, 0];
export const ALU: Matter = [0.1, 0.102, 0.108, 0.4, 0.55, 1];
export const POLY: Matter = [0.085, 0.087, 0.092, 0.0, 0.68, 2];
export const RUBBER: Matter = [0.06, 0.06, 0.062, 0.0, 0.88, 3];
export const GRIP: Matter = [0.075, 0.075, 0.078, 0.0, 0.8, 5];
export const WOOD: Matter = [0.2, 0.2, 0.2, 0.0, 0.34, 4];
export const GLASS: Matter = [0.02, 0.03, 0.05, 0.9, 0.06, 6];
/** acier inoxydable microbillé (canons de compétition) */
export const STAINLESS: Matter = [0.4, 0.4, 0.42, 0.9, 0.42, 0];

const rad = (d: number): number => (d * Math.PI) / 180;
const UP = new Vector3(0, 1, 0), LEFT = new Vector3(-1, 0, 0), RIGHT = new Vector3(1, 0, 0), BACK = new Vector3(0, 0, 1);

/** Repère pour extruder une section (x, y) le long de Z : le « z » du profil devient X, la largeur suit Z. */
export function crossXf(zc: number): Matrix4 {
  return new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)).setPosition(0, 0, zc);
}
export const teeth = (z0: number, z1: number, depth: number): LatheMod => (z, j) => (j % 2 === 1 && z > z0 && z < z1 ? -depth : 0);
export const flutes = (z0: number, z1: number, depth: number, per: number): LatheMod => (z, j) => {
  const k = j % per, h = Math.floor(per / 2);
  const f = k === h ? 1 : k === h - 1 || k === h + 1 ? 0.55 : 0;
  const ends = Math.min(1, Math.max(0, (z - z0) / 0.02)) * Math.min(1, Math.max(0, (z1 - z) / 0.02));
  return -depth * f * ends;
};

/** Fin de profil de canon : couronne en retrait et âme. */
export function crown(prof: P2[], z: number, r: number, bore: number): void {
  prof.push(p2(z - 0.0012, r), p2(z, r - 0.0012), p2(z, bore + 0.003), p2(z - 0.0025, bore + 0.0005), p2(z - 0.0025, bore), p2(z - 0.04, bore));
}

/** Rail Picatinny cranté (MIL-STD-1913) : dessus à yTop, de z0 à z1. */
export function picatinny(g: RifleMesh, z0: number, z1: number, yTop: number, body = 0.0094, mat: Matter = ALU): void {
  g.mat(mat);
  const o: P2[] = [p2(z0, yTop - body), p2(z0, yTop)];
  if (g.q >= 1) {
    let z = z0 + 0.0035;
    while (z + 0.0052 < z1 - 0.003) {
      o.push(p2(z, yTop), p2(z, yTop - 0.003), p2(z + 0.0052, yTop - 0.003), p2(z + 0.0052, yTop));
      z += 0.01;
    }
  }
  o.push(p2(z1, yTop), p2(z1, yTop - body));
  g.extrude(o, 0.0212, 0.0027, 1);
}

/**
 * Lunette tactique, tube de 34 mm. `zs` : centre des tourelles ; `ys` : axe optique ; `sc` : échelle de longueur ;
 * `bell` : rayon extérieur de la cloche d'objectif ; `railTop` : dessus du rail qui porte les colliers.
 * Retourne z de l'oculaire (arrière).
 */
export function scope(g: RifleMesh, zs: number, ys: number, sc: number, bell: number, railTop: number, shade: boolean): number {
  const zOc = zs - 0.188 * sc;
  const zOb = zs + 0.24 * sc;
  g.push(translate(0, ys, 0));
  g.mat(ALU);
  const p: P2[] = [
    p2(zOc + 0.006, 0.0195), p2(zOc, 0.0195), p2(zOc, 0.0222), p2(zOc + 0.002, 0.023), p2(zOc + 0.014, 0.023), p2(zOc + 0.015, 0.0218),
    p2(zOc + 0.058 * sc, 0.0218), p2(zOc + 0.059 * sc, 0.0245), p2(zOc + 0.09 * sc, 0.0245), p2(zOc + 0.091 * sc, 0.0215),
    p2(zOc + 0.097 * sc, 0.021), p2(zOc + 0.11 * sc, 0.017),
    p2(zs - 0.029, 0.017), p2(zs - 0.025, 0.0235), p2(zs - 0.021, 0.0255), p2(zs + 0.021, 0.0255), p2(zs + 0.025, 0.0235), p2(zs + 0.029, 0.017),
    p2(zs + 0.072 * sc, 0.017), p2(zs + 0.152 * sc, bell - 0.0008), p2(zs + 0.157 * sc, bell),
  ];
  let zEnd = zOb;
  if (shade) {
    // pare-soleil vissé : gorge de jonction puis tube
    p.push(p2(zOb - 0.002, bell), p2(zOb - 0.0015, bell - 0.0012), p2(zOb + 0.0015, bell - 0.0012), p2(zOb + 0.002, bell));
    zEnd = zOb + 0.085;
  }
  p.push(p2(zEnd - 0.001, bell), p2(zEnd, bell - 0.001), p2(zEnd, bell - 0.0028), p2(zOb - 0.012, bell - 0.0028));
  const zl0 = zOc + 0.059 * sc, zl1 = zOc + 0.09 * sc;
  g.lathe(p, 40, (z, j) => (z > zl0 - 0.0002 && z < zl1 + 0.0002 && j % 4 >= 2 ? -0.0011 : 0));
  // lentilles
  g.mat(GLASS);
  g.lathe([p2(zOc + 0.0045, 0), p2(zOc + 0.0055, 0.012), p2(zOc + 0.006, 0.0196)], 20);
  g.lathe([p2(zOb - 0.012, bell - 0.0027), p2(zOb - 0.0105, (bell - 0.0027) * 0.6), p2(zOb - 0.0098, 0)], 24);
  g.pop();
  // tourelles moletées : hausse (dessus), dérive (côté droit, −X), parallaxe et éclairage (côté gauche)
  g.mat(ALU);
  g.push(along(UP, new Vector3(0, ys, zs)));
  g.lathe([p2(0.02, 0.0175), p2(0.027, 0.0175), p2(0.027, 0.0192), p2(0.046, 0.0192), p2(0.047, 0.0172), p2(0.051, 0.0172), p2(0.052, 0.016), p2(0.052, 0)], 32, teeth(0.0275, 0.0455, 0.0008));
  g.pop();
  g.push(along(LEFT, new Vector3(0, ys, zs)));
  g.lathe([p2(0.02, 0.0165), p2(0.027, 0.0165), p2(0.027, 0.0178), p2(0.041, 0.0178), p2(0.042, 0.016), p2(0.044, 0.016), p2(0.045, 0.0145), p2(0.045, 0)], 28, teeth(0.0275, 0.0405, 0.0008));
  g.pop();
  g.push(along(RIGHT, new Vector3(0, ys, zs)));
  g.lathe([p2(0.02, 0.018), p2(0.026, 0.018), p2(0.026, 0.0195), p2(0.038, 0.0195), p2(0.039, 0.0175), p2(0.04, 0.0125), p2(0.04, 0.0135), p2(0.049, 0.0135), p2(0.05, 0.012), p2(0.05, 0)], 32, teeth(0.0265, 0.0375, 0.0008));
  g.pop();
  // colliers et embases
  for (const zr of [zs - 0.052 * sc, zs + 0.05 * sc]) ring(g, zr, ys, railTop);
  return zOc;
}

function ring(g: RifleMesh, zc: number, ys: number, railTop: number): void {
  g.mat(ALU);
  const r = 0.0213;
  const o: P2[] = [];
  const seg = g.q >= 1 ? 24 : 12;
  for (let k = 0; k <= seg; k++) {
    const deg = -52 + (284 * k) / seg;
    const a = rad(deg);
    if (Math.abs(deg) < 13 || Math.abs(deg - 180) < 13) continue;
    if (o.length > 0) {
      const prev = -52 + (284 * (k - 1)) / seg;
      if (deg >= 13 && prev < 13) o.push(p2(0.0275, ys - 0.0048), p2(0.0275, ys + 0.0048));
      if (deg >= 193 && prev < 193) o.push(p2(-0.0275, ys + 0.0048), p2(-0.0275, ys - 0.0048));
    }
    o.push(p2(Math.cos(a) * r, ys + Math.sin(a) * r));
  }
  o.push(p2(-0.0135, railTop + 0.0005), p2(-0.016, railTop - 0.007), p2(0.016, railTop - 0.007), p2(0.0135, railTop + 0.0005));
  g.push(crossXf(zc));
  g.extrude(o, 0.02, 0.0012, 1);
  g.pop();
  // vis de serrage et écrou de l'embase
  if (g.q >= 1) {
    g.mat(STEEL);
    for (const sx of [-1, 1])
      for (const dz of [-0.0055, 0.0055]) {
        g.push(along(UP, new Vector3(sx * 0.0238, ys + 0.0046, zc + dz)));
        g.lathe([p2(0, 0.0028), p2(0.0012, 0.0028), p2(0.0012, 0)], 6);
        g.pop();
      }
    g.push(along(RIGHT, new Vector3(0.016, railTop - 0.003, zc)));
    g.lathe([p2(0, 0.006), p2(0.005, 0.006), p2(0.005, 0)], 6, null, true);
    g.pop();
  }
}

/** Frein de bouche à chambres : collier arrière, cloisons, ponts haut et bas, évents latéraux réels. */
export function brake(g: RifleMesh, by: number, z0: number, length: number, r: number, ports: number, bore = 0.0045, collar = 0.3): void {
  g.mat(STEEL_MAT);
  g.push(translate(0, by, 0));
  const zc = z0 + length * collar;
  g.lathe([p2(z0, 0), p2(z0, r - 0.002), p2(z0 + 0.002, r), p2(zc, r), p2(zc, bore + 0.001)], 24);
  const wall = 0.0032;
  const pitch = (z0 + length - zc) / ports;
  for (let i = 0; i < ports; i++) {
    const za = zc + pitch * (i + 1) - wall, zb = zc + pitch * (i + 1);
    const d: P2[] = [p2(za, bore + 0.0008), p2(za, r)];
    if (i === ports - 1) d.push(p2(zb - 0.0015, r), p2(zb, r - 0.0015));
    else d.push(p2(zb, r));
    d.push(p2(zb, bore + 0.0008), p2(za, bore + 0.0008));
    g.lathe(d, 24);
  }
  // ponts : secteurs haut et bas reliant les cloisons
  const br: P2[] = [p2(zc, r * 0.66), p2(zc, r), p2(z0 + length - wall, r), p2(z0 + length - wall, r * 0.66), p2(zc, r * 0.66)];
  g.lathe(br, 24, null, false, rad(52), rad(128));
  g.lathe(br, 24, null, false, rad(232), rad(308));
  g.pop();
}

/** Modérateur de son : tube lisse, bagues, sortie. */
export function suppressor(g: RifleMesh, by: number, z0: number, length: number, r: number): void {
  g.mat(STEEL_MAT);
  g.push(translate(0, by, 0));
  const z1 = z0 + length;
  g.lathe([
    p2(z0, 0), p2(z0, r * 0.62), p2(z0 + 0.012, r * 0.62), p2(z0 + 0.014, r - 0.001), p2(z0 + 0.016, r),
    p2(z0 + 0.034, r), p2(z0 + 0.0345, r - 0.0008), p2(z0 + 0.036, r - 0.0008), p2(z0 + 0.0365, r),
    p2(z1 - 0.03, r), p2(z1 - 0.0295, r - 0.0008), p2(z1 - 0.028, r - 0.0008), p2(z1 - 0.0275, r),
    p2(z1 - 0.002, r), p2(z1, r - 0.002), p2(z1, 0.0075), p2(z1 - 0.004, 0.0055), p2(z1 - 0.03, 0.0055),
  ], 32, teeth(z0 + 0.016, z0 + 0.034, 0.0006));
  g.pop();
}

/**
 * Bipied type Harris, déplié, dans le repère du nœud `bipod` (origine à l'articulation, sous le fût).
 * Retourne [pied gauche (+X), pied droit (−X)].
 */
export function harris(g: RifleMesh, leg = 0.2): Vector3[] {
  g.mat(ALU);
  g.block(-0.024, 0.024, -0.011, 0, 0.044, 0.002);
  g.block(-0.012, 0.012, -0.03, -0.009, 0.07, 0.003);
  g.mat(STEEL);
  g.push(along(BACK, new Vector3(0, -0.006, -0.03)));
  g.lathe([p2(0, 0), p2(0, 0.007), p2(0.006, 0.007), p2(0.006, 0)], 10, teeth(-1, 1, 0.0008));
  g.pop();
  const feet: Vector3[] = [];
  for (const s of [1, -1]) {
    const top = new Vector3(s * 0.031, -0.02, 0);
    const dir = new Vector3(s * 0.37, -0.925, 0.07).normalize();
    g.push(along(dir, top));
    g.mat(ALU);
    g.lathe([p2(-0.008, 0), p2(-0.008, 0.0082), p2(leg * 0.62, 0.0082), p2(leg * 0.62, 0.0092), p2(leg * 0.62 + 0.012, 0.0092), p2(leg * 0.62 + 0.012, 0.006)], 12);
    g.mat(STEEL);
    g.lathe([p2(leg * 0.62 + 0.012, 0.006), p2(leg - 0.02, 0.006)], 10);
    g.mat(RUBBER);
    g.lathe([p2(leg - 0.024, 0.006), p2(leg - 0.024, 0.0095), p2(leg - 0.004, 0.0095), p2(leg, 0.007), p2(leg, 0)], 12);
    g.pop();
    // ressort de rappel
    g.mat(STEEL);
    const sa = new Vector3(s * 0.012, -0.004, 0.02);
    const sb = top.clone().addScaledVector(dir, leg * 0.5).add(new Vector3(0, 0, 0.009));
    g.tube([sa, sb], [0.0022, 0.0022], 6, false);
    feet.push(top.clone().addScaledVector(dir, leg));
  }
  return feet;
}

/**
 * Verrou dans le repère du nœud `bolt` (origine sur l'axe de la culasse). `lat`, `drop` : position de la boule,
 * à droite (−X) et sous l'axe ; `zk` : recul de la boule par rapport à la racine `zr`.
 */
export function bolt(g: RifleMesh, z0: number, z1: number, r: number, zr: number, lat: number, drop: number, zk: number, knobR: number, shroud: P2[], longKnob = false): Vector3 {
  g.mat(BRIGHT);
  g.lathe([p2(z0, 0), p2(z0, r), p2(z1, r), p2(z1, 0)], 16);
  if (shroud.length > 0) {
    g.mat(STEEL);
    g.lathe(shroud, 20);
  }
  g.mat(STEEL);
  const k = new Vector3(-lat, -drop, zk);
  const p0 = new Vector3(-r * 0.4, 0, zr);
  const p1 = new Vector3(-r - 0.006, -0.002, zr);
  const pm = p1.clone().lerp(k, 0.5).add(new Vector3(0, 0.004, 0));
  const dirk = k.clone().sub(pm).normalize();
  const p3 = k.clone().addScaledVector(dirk, -knobR * 0.7);
  g.tube([p0, p1, pm, p3], [0.0065, 0.006, 0.005, 0.0045], 12);
  g.push(along(dirk, k));
  if (longKnob) g.lathe([p2(-knobR * 1.3, 0), p2(-knobR * 1.3, knobR * 0.55), p2(-knobR * 0.9, knobR * 0.85), p2(knobR * 0.9, knobR), p2(knobR * 1.35, knobR * 0.75), p2(knobR * 1.5, 0)], 16);
  else g.lathe([p2(-knobR * 1.25, 0), p2(-knobR * 1.25, knobR * 0.45), ...arc(0, knobR, Math.PI * 0.82, 0, 10)], 18);
  g.pop();
  return k;
}

/**
 * Gros frein de bouche prismatique des calibres lourds (« tank ») : collier arrière, plaques haut et bas,
 * cloisons percées à l'âme, évents latéraux ouverts. `w` : largeur, `h` : hauteur.
 */
export function boxBrake(g: RifleMesh, by: number, z0: number, length: number, w: number, h: number, ports: number, bore = 0.008): void {
  g.mat(STEEL_MAT);
  g.push(translate(0, by, 0));
  const zb = z0 + length * 0.2, z1 = z0 + length - 0.008, t = 0.007, rc = bore + 0.011;
  g.lathe([p2(z0, 0), p2(z0, rc - 0.0015), p2(z0 + 0.0015, rc), p2(zb, rc), p2(zb, 0)], 20);
  g.block(zb, z1, h * 0.5 - 0.006, h * 0.5, w, 0.0015);
  g.block(zb, z1, -h * 0.5, -h * 0.5 + 0.006, w, 0.0015);
  const hs = g.q >= 1 ? 14 : 8;
  for (let i = 0; i <= ports; i++) {
    const zc = zb + t * 0.5 + ((z1 - zb - t) * i) / ports;
    const hole: P2[] = [];
    for (let k = 0; k < hs; k++) { const a = (Math.PI * 2 * k) / hs; hole.push(p2(Math.cos(a) * bore, Math.sin(a) * bore)); }
    g.push(crossXf(zc));
    g.extrude([p2(-w * 0.5, -h * 0.5 + 0.004), p2(w * 0.5, -h * 0.5 + 0.004), p2(w * 0.5, h * 0.5 - 0.004), p2(-w * 0.5, h * 0.5 - 0.004)], t, 0.0012, 1, [hole]);
    g.pop();
  }
  g.lathe([p2(z1, bore + 0.009), p2(z0 + length - 0.001, bore + 0.006), p2(z0 + length, bore + 0.005), p2(z0 + length, bore), p2(z1, bore)], 16);
  g.pop();
}

/**
 * Bipied lourd intégré à l'arme, déplié, dans le repère du nœud `bipod` (origine à la chape). Jambes en tube
 * télescopique ou en profilé plat perforé, patins ronds ou en ski. Retourne [pied gauche (+X), pied droit (−X)].
 */
export function legBipod(g: RifleMesh, leg: number, flat: boolean, ski: boolean, spread = 0.34, yoke = 0.05): Vector3[] {
  g.mat(ALU);
  g.block(-0.02, 0.02, -0.016, 0.004, yoke + 0.014, 0.003);
  g.mat(STEEL);
  g.push(along(RIGHT, new Vector3(-yoke * 0.5 - 0.01, -0.008, 0)));
  g.lathe([p2(0, 0), p2(0, 0.005), p2(yoke + 0.02, 0.005), p2(yoke + 0.02, 0)], 10);
  g.pop();
  const feet: Vector3[] = [];
  for (const s of [1, -1]) {
    const top = new Vector3(s * yoke * 0.5, -0.008, 0);
    const dir = new Vector3(s * spread, -1, 0.04).normalize();
    const foot = top.clone().addScaledVector(dir, leg);
    if (flat) {
      // profilé plat : la face perforée regarde le côté de l'arme
      const xl = new Vector3(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
      const yl = dir.clone().cross(xl);
      g.push(new Matrix4().makeBasis(xl, yl, dir).setPosition(top));
      g.mat(STEEL_MAT);
      const holes: P2[][] = [];
      const hn = g.q >= 1 ? 8 : 4;
      for (let z = 0.035; z < leg - 0.03; z += g.q >= 1 ? 0.024 : 0.048) {
        const h: P2[] = [];
        for (let k = 0; k < hn; k++) { const a = (Math.PI * 2 * k) / hn; h.push(p2(z + Math.cos(a) * 0.005, Math.sin(a) * 0.005)); }
        holes.push(h);
      }
      g.extrude([p2(-0.01, -0.012), p2(leg - 0.006, -0.012), p2(leg - 0.006, 0.012), p2(-0.01, 0.012)], 0.012, 0.0015, 1, holes);
      g.pop();
    } else {
      g.push(along(dir, top));
      g.mat(ALU);
      g.lathe([p2(-0.01, 0), p2(-0.01, 0.0105), p2(leg * 0.55, 0.0105), p2(leg * 0.55, 0.0125), p2(leg * 0.55 + 0.02, 0.0125), p2(leg * 0.55 + 0.02, 0.008)], 14);
      g.mat(STEEL);
      g.lathe([p2(leg * 0.55 + 0.02, 0.008), p2(leg - 0.006, 0.008)], 12);
      g.pop();
    }
    g.push(translate(foot.x, foot.y, foot.z));
    if (ski) {
      g.mat(STEEL_MAT);
      g.extrude([p2(-0.04, 0.012), p2(-0.03, 0.002), p2(0.03, 0.002), p2(0.04, 0.012), p2(0.036, 0.015), p2(0.028, 0.007), p2(-0.028, 0.007), p2(-0.036, 0.015)], 0.03, 0.001, 1);
      g.block(-0.008, 0.008, 0.004, 0.02, 0.014, 0.001);
    } else {
      g.mat(RUBBER);
      g.push(along(new Vector3(0, -1, 0), new Vector3(0, 0.014, 0)));
      g.lathe([p2(0, 0), p2(0, 0.012), p2(0.008, 0.016), p2(0.014, 0.016), p2(0.014, 0)], 12);
      g.pop();
    }
    g.pop();
    feet.push(foot);
  }
  return feet;
}
