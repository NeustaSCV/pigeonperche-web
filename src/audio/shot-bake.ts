// « Cuisson » du tampon d'un coup de feu au poste de tir : attaque enregistrée (ou synthèse de repli), coup sourd et
// jet de gaz selon la charge, gerbes du frein, premières réflexions. Calcul direct sur des tableaux (48 kHz), fait
// quand le joueur prend l'arme. La queue diffuse et les échos de la carte sont ajoutés en direct par le moteur
// (src/audio/engine.ts), parce qu'ils dépendent du niveau et de la direction du regard.
import { SR, add, bq, bqSweep, env, friedlander, gain, mix, nWave, noise, norm, peak, resample, rng, st, thump, type St } from './shot-dsp';
import type { Pcm } from './samples';
import type { ShotSound } from './shot-params';

export interface BakedShot {
  sound: ShotSound;
  /** vrai si l'attaque vient d'un enregistrement, faux si tout est synthétisé (fichier absent) */
  recorded: boolean;
  l: Float32Array;
  r: Float32Array;
  /** plus fort niveau efficace sur 5 ms : repère pour doser la queue et les échos en décibels sous la détonation */
  ref: number;
}

/** durée du tampon cuit, s */
export const BAKE_SEC = 1.3;

const dB = (v: number): number => Math.pow(10, v / 20);

/** plus fort niveau efficace sur 5 ms */
export function rmsPeak(x: Float32Array): number {
  const n = Math.round(0.005 * SR);
  let acc = 0, best = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i] * x[i];
    if (i >= n) acc -= x[i - n] * x[i - n];
    if (acc > best) best = acc;
  }
  return Math.sqrt(best / n);
}

const coupSourd = (p: ShotSound): Float32Array => thump(p.thump.f0, p.thump.f1, p.thump.fTau, p.thump.tau, 0.9);

/** Synthèse de repli (proposition 1 de la maquette) : claquement de bouche et corps de la détonation, mono, sans espace. */
function synthDry(p: ShotSound, rnd: () => number): Float32Array {
  const s = p.s;
  if (p.suppressed) {
    // modérateur, balle subsonique : pas de détonation, un souffle court
    let y = env(bq(noise(0.3, rnd, 'pink'), 'bandpass', 950, 0.6), 0.0015, 0.022);
    y = add(y, env(bq(noise(0.2, rnd), 'highpass', 4200, 0.7), 0.002, 0.016), 0.4);
    y = add(y, thump(160, 90, 0.02, 0.025, 0.3), 0.22);
    return norm(bq(y, 'highpass', 60, 0.7));
  }
  // 1. claquement : onde de souffle de Friedlander (montée en un échantillon) + bouffée large bande de 2 à 4 ms
  const click = norm(env(bq(bq(noise(0.03, rnd), 'highpass', 1800, 0.6), 'lowpass', 9000, 0.6), 0.00004, 0.0016 + 0.002 * s));
  let y = add(friedlander(p.blastT, 1), click, p.brake ? 0.4 : 0.28);
  // 2. le « bang » : bande large entre 300 et 700 Hz, d'autant plus bas et long que la charge est forte
  y = add(y, norm(env(bq(noise(0.4, rnd), 'bandpass', 720 - 420 * s, 0.45), 0.0003, 0.006 + 0.017 * s, 0.001 + 0.004 * s)), 1.0);
  // 3. jet de gaz turbulent : son spectre se referme en quelques dizaines de millisecondes
  y = add(y, norm(env(bqSweep(noise(0.6, rnd), 'lowpass', 6500 - 1500 * s, 480 - 120 * s, 0.01 + 0.016 * s, 0.6), 0.0005, 0.012 + 0.03 * s)), 0.45);
  // 4. coup sourd : son poids suit la puissance de la munition
  y = add(y, coupSourd(p), p.thump.gain);
  return norm(bq(y, 'highpass', 45, 0.7));
}

/** Attaque et corps enregistrés (0,3 s), relus à la hauteur de l'arme ; grave synthétisé selon la charge. */
function hybridDry(p: ShotSound, attack: Pcm, rnd: () => number): Float32Array {
  // ramené à 48 kHz, puis abaissé ou relevé selon la place de l'arme dans sa classe
  let y = norm(resample(attack.data, (attack.sr / SR) * p.rate));
  if (p.thump.gain > 0.03) y = add(y, coupSourd(p), p.thump.gain);
  if (p.body.gain > 0.01) {
    // jet de gaz grave des gros calibres : allonge le corps au-delà des 0,3 s de la prise
    y = add(y, norm(env(bqSweep(noise(0.7, rnd), 'lowpass', 2400, 260, p.body.tau, 0.6), 0.0008, p.body.tau)), p.body.gain);
  }
  return norm(bq(y, 'highpass', 40, 0.7));
}

/** Bang supersonique tel que l'entend le tireur : pas l'onde directe (elle part vers l'avant), ses retours du sol. */
function crackNear(p: ShotSound, rnd: () => number, out: St, g: number): void {
  mix(out, bq(nWave(0.0002 + 0.00012 * p.s), 'highpass', 1200, 0.6), 0.0006, g * 0.5, 0);
  for (let i = 0; i < 7; i++) {
    const t = 0.004 + rnd() * 0.05;
    const b = env(bq(noise(0.02, rnd), 'bandpass', 2200 + rnd() * 2500, 0.5), 0.0001, 0.0015 + rnd() * 0.002);
    mix(out, b, t, g * 0.3 * Math.exp(-t / 0.025), rnd() * 1.6 - 0.8);
  }
}

/** Mécanique entendue au départ du coup : percuteur, vibration du boîtier. Dominante avec un modérateur. */
function actionTick(rnd: () => number): Float32Array {
  let y = env(bq(noise(0.04, rnd), 'highpass', 2600, 0.7), 0.0002, 0.004);
  for (const [f, tau, g] of [[2150, 0.022, 1], [3940, 0.014, 0.6], [6230, 0.009, 0.4]] as const) y = add(y, thump(f, f, 1, tau, 0.12), g * 0.5);
  return norm(y);
}

/**
 * Cuit le tir d'une arme. `attack` : l'enregistrement de sa classe, ou null s'il manque (tout est alors synthétisé).
 * Le résultat est reproductible pour une arme donnée ; les variations d'un tir à l'autre sont faites à la lecture.
 */
export function bakeShot(p: ShotSound, attack: Pcm | null): BakedShot {
  let h = 2166136261;
  for (let i = 0; i < p.id.length; i++) h = Math.imul(h ^ p.id.charCodeAt(i), 16777619);
  const rnd = rng(h >>> 0);
  const out = st(BAKE_SEC);
  const dry = attack ? hybridDry(p, attack, rnd) : synthDry(p, rnd);
  mix(out, dry, 0, 1, 0);
  if (p.side.gain > 0) {
    // le frein ouvre l'image stéréo : deux gerbes latérales, un demi-millième de seconde après le front axial
    const side = bq(bq(dry, 'highpass', 900, 0.7), 'lowpass', p.side.lowpass, 0.7);
    mix(out, side, p.side.delay, p.side.gain, -0.85);
    mix(out, side, p.side.delay + 0.0003, p.side.gain, 0.85);
  }
  mix(out, actionTick(rnd), 0, p.suppressed ? 0.5 : 0.05, 0.1);
  if (!attack && p.supersonic) crackNear(p, rnd, out, 0.5);
  // premières réflexions (sol, murets, troncs) : 12 à 110 ms
  const k = p.suppressed ? dB(-8) : 1;
  for (let i = 0; i < 7; i++) {
    const t = 0.012 + Math.pow(rnd(), 1.3) * 0.1;
    mix(out, bq(dry, 'lowpass', 1800 + rnd() * 3500, 0.6), t, 0.17 * k * Math.exp(-t / 0.07), rnd() * 1.8 - 0.9);
  }
  // crête ramenée à 1, puis saturation douce (tanh) : densifie les gros calibres sans écrêter
  const pk = Math.max(peak(out.l), peak(out.r));
  if (pk > 0) { gain(out.l, 1 / pk); gain(out.r, 1 / pk); }
  const nf = Math.round(0.08 * SR), N = out.l.length;
  for (const c of [out.l, out.r]) {
    for (let i = 0; i < N; i++) c[i] = Math.tanh(c[i] * p.drive);
    for (let i = 0; i < nf; i++) c[N - 1 - i] *= i / nf;
  }
  return { sound: p, recorded: !!attack, l: out.l, r: out.r, ref: Math.max(rmsPeak(out.l), rmsPeak(out.r)) };
}
