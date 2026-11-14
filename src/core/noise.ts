// Bruit et utilitaires numériques, sans dépendance (utilisé aussi par le générateur Node).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Amortissement exponentiel indépendant du pas de temps. */
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));

export type Noise2D = (x: number, y: number) => number;

/** Bruit de gradient 2D (Perlin), sortie dans environ [-1, 1]. */
export function makeNoise2D(seed: number): Noise2D {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const d00 = gx[aa] * xf + gy[aa] * yf;
    const d10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const d01 = gx[ab] * xf + gy[ab] * (yf - 1);
    const d11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const x0 = d00 + (d10 - d00) * u;
    const x1 = d01 + (d11 - d01) * u;
    return (x0 + (x1 - x0) * v) * 1.41;
  };
}

export function fbm2(n: Noise2D, x: number, y: number, oct: number, lac = 2, gain = 0.5): number {
  let a = 1;
  let f = 1;
  let s = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f + i * 17.3, y * f - i * 9.1);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return s / norm;
}

/** Multifractal à crêtes, sortie 0..1. */
export function ridged2(n: Noise2D, x: number, y: number, oct: number, lac = 2, gain = 0.5): number {
  let a = 1;
  let f = 1;
  let s = 0;
  let norm = 0;
  let w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(n(x * f + i * 31.7, y * f + i * 11.9));
    v *= v;
    s += a * v * w;
    w = clamp(v * 1.6, 0, 1);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return s / norm;
}

/** Hash entier → [0, 1). */
export function hash01(i: number, j = 0): number {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
