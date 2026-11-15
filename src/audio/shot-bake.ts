// « Cuisson » du tampon d'un coup de feu au poste de tir, selon la recette de la maquette retenue (hybride) : attaque
// enregistrée en stéréo (ou synthèse de repli), grave d'appoint selon la charge, premières réflexions, queue diffuse,
// roulement grave, et un tampon par écho de la carte. Calcul direct sur des tableaux (48 kHz), fait quand le joueur
// prend l'arme. Le moteur (src/audio/engine.ts) joue le tout tel quel, sans compression, et place chaque écho du
// côté de son relief selon le regard.
import { SR, add, bq, bqSweep, env, friedlander, gain, mix, mixSt, mono, nWave, noise, norm, outdoorTail, peak, resample, rng, smear, st, thump, type St } from './shot-dsp';
import type { Pcm } from './samples';
import { DEFAULT_ECHO, echoTaps, type EchoSpec, type ShotSound } from './shot-params';

export interface BakedShot {
  sound: ShotSound;
  /** vrai si l'attaque vient d'un enregistrement, faux si tout est synthétisé (fichier absent) */
  recorded: boolean;
  l: Float32Array;
  r: Float32Array;
  /** plus fort niveau efficace sur 5 ms du tampon */
  ref: number;
  /** échos des reliefs de la carte, du plus proche au plus lointain */
  echoes: BakedEcho[];
}

export interface BakedEcho {
  /** retard aller-retour, s */
  delay: number;
  /** azimut du relief, degrés */
  bearing: number;
  data: Float32Array;
}

/** durée du tampon cuit, s */
export const BAKE_SEC = 4.1;

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
  y = add(y, coupSourd(p), (0.04 + 0.8 * s * s * s) * (p.brake ? 0.85 : 1));
  return norm(bq(y, 'highpass', 45, 0.7));
}

/** Attaque et corps enregistrés (0,3 s, stéréo), relus à la hauteur de l'arme ; grave d'appoint selon la charge. */
function hybridDry(p: ShotSound, attack: Pcm): St {
  const k = (attack.sr / SR) * p.rate;
  const shot: St = { l: resample(attack.l ?? attack.data, k), r: resample(attack.r ?? attack.data, k) };
  normSt(shot);
  if (p.thump.gain > 0) {
    const th = coupSourd(p);
    shot.l = add(shot.l, th, p.thump.gain);
    shot.r = add(shot.r, th, p.thump.gain);
  }
  return normSt(shot);
}

function normSt(s: St): St {
  const pk = Math.max(peak(s.l), peak(s.r));
  if (pk > 0) { gain(s.l, 1 / pk); gain(s.r, 1 / pk); }
  return s;
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
 * Cuit le tir d'une arme sur une carte. `attack` : l'enregistrement de sa classe, ou null s'il manque (tout est alors
 * synthétisé). `echo` : reliefs de la carte. La recette et ses dosages sont ceux de la maquette retenue.
 * Le résultat est reproductible ; les variations d'un tir à l'autre sont faites à la lecture.
 */
export function bakeShot(p: ShotSound, attack: Pcm | null, echo?: EchoSpec | null): BakedShot {
  let h = 2166136261;
  for (let i = 0; i < p.id.length; i++) h = Math.imul(h ^ p.id.charCodeAt(i), 16777619);
  const rnd = rng(h >>> 0);
  const spec = echo ?? DEFAULT_ECHO;
  const taps = echoTaps(spec);
  const queue = Math.max(0, Math.min(2, spec.tail ?? 1));
  const s = p.s;
  const out = st(BAKE_SEC);
  let dry: Float32Array;
  if (attack) {
    const d = hybridDry(p, attack);
    mixSt(out, d, 0, 1);
    dry = mono(d);
  } else {
    dry = synthDry(p, rnd);
    mix(out, dry, 0, 1, 0);
    if (p.side.gain > 0) {
      // le frein ouvre l'image stéréo : deux gerbes latérales, un demi-millième de seconde après le front axial
      const side = bq(bq(dry, 'highpass', 900, 0.7), 'lowpass', p.side.lowpass, 0.7);
      mix(out, side, p.side.delay, p.side.gain, -0.85);
      mix(out, side, p.side.delay + 0.0003, p.side.gain, 0.85);
    }
    mix(out, actionTick(rnd), 0, p.suppressed ? 0.5 : 0.05, 0.1);
    if (p.supersonic) crackNear(p, rnd, out, 0.5);
  }
  const ref = rmsPeak(dry);
  // premières réflexions (sol, murets, troncs) : 12 à 110 ms
  const k = p.suppressed ? dB(-8) : 1;
  for (let i = 0; i < 7; i++) {
    const t = 0.012 + Math.pow(rnd(), 1.3) * 0.1;
    mix(out, bq(dry, 'lowpass', 1800 + rnd() * 3500, 0.6), t, 0.17 * k * Math.exp(-t / 0.07), rnd() * 1.8 - 0.9);
  }
  // queue diffuse : l'aigu meurt vite, le grave traîne ; stéréo décorrélée
  if (queue > 0) {
    const tail = outdoorTail(rnd, 3.2, p.tailK * queue, p.tailBright);
    const tp = Math.max(rmsPeak(tail.l), rmsPeak(tail.r));
    if (tp > 0) mixSt(out, tail, 0.006, (ref * dB(p.tailDb) * queue) / tp);
    // roulement grave entre les échos (gros calibres, cartes à plusieurs reliefs)
    if (!p.suppressed && taps.length > 1 && s > 0.5) {
      for (const [f, a, tau, at, pan] of [[110, 0.5, 0.9, 0.25, -0.2], [90, 0.7, 1.0, 0.4, 0.3]] as const) {
        const roll = env(bq(noise(3.6, rnd, 'brown'), 'bandpass', f, 0.6), a, tau);
        mix(out, roll, at, (ref * dB(-40 + 12 * s) * queue) / rmsPeak(roll), pan);
      }
    }
  }
  // un écho par relief : assourdi par la distance, étalé par la rugosité du versant ; joué à part pour garder son azimut
  const echoes: BakedEcho[] = [];
  for (const tap of taps) {
    const lp = bq(bq(dry, 'lowpass', tap.lowpass, 0.6), 'highpass', 70, 0.6);
    const e = smear(lp, rnd, tap.rough * 1.3, 30, tap.rough * 0.45);
    const rp = rmsPeak(e);
    if (rp > 0) echoes.push({ delay: tap.delay, bearing: tap.bearing, data: gain(e, (ref * dB(tap.db + p.echoBoostDb)) / rp) });
  }
  // crête ramenée à 1, puis saturation douce (tanh) : densifie les gros calibres sans écrêter
  const pk = Math.max(peak(out.l), peak(out.r));
  const g = pk > 0 ? 1 / pk : 1;
  const nf = Math.round(0.08 * SR);
  for (const c of [out.l, out.r, ...echoes.map((e) => e.data)]) {
    const N = c.length;
    for (let i = 0; i < N; i++) c[i] = Math.tanh(c[i] * g * p.drive);
    for (let i = 0; i < nf && i < N; i++) c[N - 1 - i] *= i / nf;
  }
  return { sound: p, recorded: !!attack, l: out.l, r: out.r, ref: Math.max(rmsPeak(out.l), rmsPeak(out.r)), echoes };
}
