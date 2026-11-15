// Boîte à outils de traitement du signal du coup de feu : calcul direct sur des tableaux, à 48 kHz, sans Web Audio.
// Sert à « cuire » le tampon d'un tir quand le joueur prend une arme (src/audio/shot-bake.ts) ; le moteur le joue
// ensuite par un simple AudioBufferSourceNode. Aucune dépendance : le même code tourne dans les tests unitaires.

export const SR = 48000;

export interface St {
  l: Float32Array;
  r: Float32Array;
}

export const st = (sec: number): St => ({ l: new Float32Array(Math.ceil(sec * SR)), r: new Float32Array(Math.ceil(sec * SR)) });

/** générateur pseudo-aléatoire reproductible (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise(sec: number, rnd: () => number, kind: 'white' | 'pink' | 'brown' = 'white'): Float32Array {
  const n = Math.ceil(sec * SR);
  const x = new Float32Array(n);
  if (kind === 'white') {
    for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
  } else if (kind === 'pink') {
    // filtre de Paul Kellet
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let v = 0;
    for (let i = 0; i < n; i++) { v = (v + 0.02 * (rnd() * 2 - 1)) / 1.02; x[i] = v * 3.5; }
  }
  return x;
}

type Bq = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peak';

function coefs(type: Bq, f: number, q: number, gainDb: number): [number, number, number, number, number] {
  const w = (2 * Math.PI * Math.min(Math.max(f, 10), SR * 0.45)) / SR;
  const c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lowpass': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'highpass': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'peak': b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
    case 'lowshelf': {
      const k = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 - (A - 1) * c + k); b1 = 2 * A * (A - 1 - (A + 1) * c); b2 = A * (A + 1 - (A - 1) * c - k);
      a0 = A + 1 + (A - 1) * c + k; a1 = -2 * (A - 1 + (A + 1) * c); a2 = A + 1 + (A - 1) * c - k; break;
    }
    case 'highshelf': {
      const k = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 + (A - 1) * c + k); b1 = -2 * A * (A - 1 + (A + 1) * c); b2 = A * (A + 1 + (A - 1) * c - k);
      a0 = A + 1 - (A - 1) * c + k; a1 = 2 * (A - 1 - (A + 1) * c); a2 = A + 1 - (A - 1) * c - k; break;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Filtre du second ordre (formules RBJ). Renvoie un nouveau tableau. */
export function bq(x: Float32Array, type: Bq, f: number, q = 0.707, gainDb = 0): Float32Array {
  const [b0, b1, b2, a1, a2] = coefs(type, f, q, gainDb);
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Filtre dont la coupure glisse de f0 vers f1 avec la constante de temps tau (s). */
export function bqSweep(x: Float32Array, type: Bq, f0: number, f1: number, tau: number, q = 0.707): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let c = coefs(type, f0, q, 0);
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) c = coefs(type, f1 + (f0 - f1) * Math.exp(-i / SR / tau), q, 0);
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Enveloppe : montée linéaire `a`, palier `hold`, puis décroissance exponentielle de constante `tau` (secondes). En place. */
export function env(x: Float32Array, a: number, tau: number, hold = 0): Float32Array {
  const na = Math.max(1, Math.round(a * SR)), nh = Math.round(hold * SR);
  for (let i = 0; i < x.length; i++) {
    x[i] *= i < na ? i / na : i < na + nh ? 1 : Math.exp(-(i - na - nh) / SR / tau);
  }
  return x;
}

export function gain(x: Float32Array, g: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function add(a: Float32Array, b: Float32Array, g = 1, at = 0): Float32Array {
  const o = Math.round(at * SR);
  const n = Math.max(a.length, o + b.length);
  const y = n === a.length ? a : (() => { const t = new Float32Array(n); t.set(a); return t; })();
  for (let i = 0; i < b.length; i++) y[o + i] += b[i] * g;
  return y;
}

export function peak(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
  return m;
}

/** ramène la crête à `to` (1 par défaut). En place. */
export function norm(x: Float32Array, to = 1): Float32Array {
  const p = peak(x);
  return p > 0 ? gain(x, to / p) : x;
}

/** Mixe un signal mono dans le bus stéréo : instant (s), gain, panoramique à puissance constante (−1 gauche, +1 droite). */
export function mix(dst: St, src: Float32Array, at: number, g = 1, pan = 0): void {
  const o = Math.round(at * SR);
  const a = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(a) * g * Math.SQRT2, gr = Math.sin(a) * g * Math.SQRT2;
  const n = Math.min(src.length, dst.l.length - o);
  for (let i = 0; i < n; i++) { dst.l[o + i] += src[i] * gl; dst.r[o + i] += src[i] * gr; }
}

export function mixSt(dst: St, src: St, at: number, g = 1): void {
  const o = Math.round(at * SR);
  const n = Math.min(src.l.length, dst.l.length - o);
  for (let i = 0; i < n; i++) { dst.l[o + i] += src.l[i] * g; dst.r[o + i] += src.r[i] * g; }
}

export const mono = (s: St): Float32Array => { const y = new Float32Array(s.l.length); for (let i = 0; i < y.length; i++) y[i] = (s.l[i] + s.r[i]) * 0.5; return y; };
export const mapSt = (s: St, f: (x: Float32Array) => Float32Array): St => ({ l: f(s.l), r: f(s.r) });

/**
 * Onde de souffle de Friedlander : montée instantanée, phase positive de durée T (s), puis dépression.
 * p(t) = (1 − t/T)·exp(−b·t/T). C'est la forme mesurée d'une détonation de bouche en champ libre.
 */
export function friedlander(T: number, b = 1.2): Float32Array {
  const n = Math.ceil(T * 7 * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR / T; y[i] = (1 - t) * Math.exp(-b * t); }
  return y;
}

/** Onde en N du bang supersonique : saut, rampe descendante de durée T, saut de retour. */
export function nWave(T: number): Float32Array {
  const n = Math.max(3, Math.ceil(T * SR));
  const y = new Float32Array(n + 2);
  for (let i = 0; i < n; i++) y[i] = 1 - (2 * i) / (n - 1);
  return y;
}

/** Sinus amorti dont la hauteur chute de f0 vers f1 (coup sourd). */
export function thump(f0: number, f1: number, fTau: number, tau: number, sec: number): Float32Array {
  const n = Math.ceil(sec * SR);
  const y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / fTau))) / SR;
    y[i] = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0015);
  }
  return y;
}

/**
 * Étalement par réflexions multiples : le signal est répété `taps` fois sur `len` secondes avec des gains
 * décroissants et des signes aléatoires. Simule un versant rocheux ou une lisière (surface rugueuse, pas un miroir).
 */
export function smear(x: Float32Array, rnd: () => number, len: number, taps: number, tau: number): Float32Array {
  const y = new Float32Array(x.length + Math.ceil(len * SR));
  let e = 0;
  for (let k = 0; k < taps; k++) {
    const t = k === 0 ? 0 : Math.pow(rnd(), 1.4) * len;
    const g = Math.exp(-t / tau) * (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.5 * rnd());
    const o = Math.round(t * SR);
    e += g * g;
    for (let i = 0; i < x.length; i++) y[o + i] += x[i] * g;
  }
  return gain(y, 1 / Math.sqrt(e));
}

/** Changement de vitesse de lecture (interpolation linéaire) : rate < 1 abaisse la hauteur et allonge. */
export function resample(x: Float32Array, rate: number): Float32Array {
  const n = Math.floor(x.length / rate);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * rate, j = Math.floor(p), f = p - j; y[i] = x[j] * (1 - f) + (x[j + 1] ?? 0) * f; }
  return y;
}

/** Saturation douce (tanh), comme le bus de tir du jeu : densifie les gros calibres sans écrêter. En place. */
export function sat(s: St, drive: number): St {
  for (const c of [s.l, s.r]) for (let i = 0; i < c.length; i++) c[i] = Math.tanh(c[i] * drive);
  return s;
}

export function fadeOut(s: St, sec: number): St {
  const n = Math.round(sec * SR), N = s.l.length;
  for (let i = 0; i < n && i < N; i++) { const g = i / n; s.l[N - 1 - i] *= g; s.r[N - 1 - i] *= g; }
  return s;
}

export function slice(x: Float32Array, from: number, to: number, fade = 0.01): Float32Array {
  const a = Math.round(from * SR), b = Math.min(x.length, Math.round(to * SR));
  const y = x.slice(a, b);
  const nf = Math.min(y.length, Math.round(fade * SR));
  for (let i = 0; i < nf; i++) y[y.length - 1 - i] *= i / nf;
  return y;
}

/** Bruit stéréo décorrélé dont chaque bande a sa propre durée : l'aigu meurt vite, le grave traîne (queue en extérieur). */
export function outdoorTail(rnd: () => number, sec: number, k: number, bright: number): St {
  const out = st(sec);
  const bands: [number, number, number, number][] = [
    // fréquence, Q, constante de temps (s), gain
    [140, 0.7, 0.42 * k, 1.0],
    [420, 0.7, 0.34 * k, 0.9],
    [1200, 0.7, 0.22 * k, 0.6 * (0.6 + bright)],
    [3200, 0.7, 0.12 * k, 0.32 * (0.4 + bright)],
    [7500, 0.8, 0.06 * k, 0.14 * bright],
  ];
  for (const ch of [out.l, out.r]) {
    for (const [f, q, tau, g] of bands) {
      const b = env(bq(noise(sec, rnd, 'pink'), 'bandpass', f, q), 0.02, tau);
      for (let i = 0; i < ch.length; i++) ch[i] += b[i] * g;
    }
  }
  return out;
}
