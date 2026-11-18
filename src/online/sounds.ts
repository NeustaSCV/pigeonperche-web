// Sons du mode en ligne, tels qu'ils ont été choisis à l'écoute sur une maquette (recettes de src/ville/sons.js,
// inchangées). Ils passent par le moteur audio du solo (`AudioEngine.playBuffer`) : volume et réglages du jeu.
//  - son propre tir : rien ici, le coup de feu et la culasse du solo sont joués par l'arme (`Rifle`) ;
//  - tir d'un autre : le coup de feu de son arme, rendu de façon réaliste à sa distance (très sourd et très faible au
//    loin), retardé par le trajet du son et placé à gauche ou à droite ;
//  - balle qui vous manque : un souffle bref, comme un bâton qui fend l'air, qui traverse d'une oreille à l'autre ;
//  - touche : une vraie voix (dix cris tirés au hasard), toute proche si c'est soi, amincie et un peu réverbérée
//    (sans écho) si c'est un autre ;
//  - diversion : un bruit qu'un joueur fait exprès (cinq sons, celui que le serveur a tiré), tout proche pour lui,
//    traité comme une voix pour les autres (amincie, un peu réverbérée), retardé par le trajet du son et placé à
//    gauche ou à droite ;
//  - cran de tourelle, début et fin de manche, compte à rebours. Aucun son quand on est visé.
import type { AudioEngine, BufferBus } from '../audio/engine';
import { parseWav } from '../audio/samples';
import type { BakedShot } from '../audio/shot-bake';
import { SR, add, bq, bqSweep, env, gain, mix, mono, noise, norm, peak, rng, smear, st, thump, type St } from '../audio/shot-dsp';
import type { ShotSource } from '../audio/shot-params';

/** vitesse du son, m/s */
export const SOUND_SPEED = 340;
/** nombre de voix enregistrées (public/ville/voix/voix-01.wav … voix-10.wav) */
export const VOICE_COUNT = 10;
/** nombre de sons de diversion (public/ville/diversion/pet-01.wav … pet-05.wav) */
export const DIVERSION_COUNT = 5;
/**
 * Bus des sons du mode en ligne : droit au volume, sans le compresseur ni le limiteur de sortie. Sur la maquette
 * validée, ces sons allaient droit à la sortie, à 0,8 (le volume par défaut du jeu) : leurs niveaux sont les mêmes.
 */
const BUS: BufferBus = 'shot';

const stereo = (x: Float32Array): St => ({ l: x, r: x });
/** fondu de sortie, en place */
const fadeEnd = (x: Float32Array, sec = 0.05): Float32Array => {
  const n = Math.round(sec * SR);
  for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n;
  return x;
};
/** enveloppe en cloche centrée sur `at` (s), en place */
const bellEnv = (x: Float32Array, at: number, width: number): Float32Array => {
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= Math.exp(-(((t - at) / width) ** 2)); }
  return x;
};

/** Partie du tir cuit dont on tire le coup de feu lointain : les 3,2 premières secondes, en mono. */
export function dryShot(shot: { l: Float32Array; r: Float32Array }): Float32Array {
  return mono(shot).slice(0, Math.round(3.2 * SR));
}

/** Tranche de distance (50 m) d'un coup de feu lointain. */
export const farShotKey = (d: number): number => Math.max(50, Math.round(d / 50) * 50);

/** Coup de feu d'un autre à `d` mètres : l'air retire l'aigu, le niveau suit la distance. `dry` : voir `dryShot`. */
export function farShot(dry: Float32Array, d: number): St {
  const key = farShotKey(d);
  const cutoff = 400 + 11000 * Math.exp(-key / 650), level = Math.min(1, 28 / key);
  const y = bq(bq(dry, 'lowpass', cutoff, 0.6), 'highpass', 45, 0.7);
  return stereo(fadeEnd(gain(norm(y), level)));
}

/** Souffle bref dont la hauteur monte puis retombe, et qui traverse d'une oreille à l'autre (`dir` > 0 : de gauche à droite). */
export function whip(dur: number, f0: number, f1: number, q: number, dir: number): St {
  const rnd = rng(21 + Math.round(dur * 100)), at = dur * 0.45;
  const rise = bqSweep(noise(dur, rnd), 'bandpass', f0, f1, dur * 0.3, q), high = bqSweep(noise(dur, rnd), 'bandpass', f0 * 2.3, f1 * 1.7, dur * 0.25, q * 1.3);
  const y = norm(add(bellEnv(rise, at, dur * 0.2), bellEnv(high, at * 0.95, dur * 0.13), 0.45));
  const l = new Float32Array(y.length), r = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) {
    const u = Math.max(0, Math.min(1, (i / y.length - 0.15) / 0.7)), a = ((dir > 0 ? u : 1 - u) * Math.PI) / 2;
    l[i] = y[i] * Math.cos(a);
    r[i] = y[i] * Math.sin(a);
  }
  return { l, r };
}

/** Voix entendue à `d` mètres : l'air mange l'aigu, la voix s'amincit, une petite réverbération et rien de plus. */
export function farVoice(voice: Float32Array, d: number): St {
  const k = Math.min(1, d / 1000), rnd = rng(1000 + Math.round(d));
  const direct = bq(bq(bq(voice, 'highpass', 180 + 260 * k, 0.7), 'lowpass', 9000 * Math.exp(-d / 620) + 1500, 0.6), 'highshelf', 3000, 0.7, -3 - 9 * k);
  const out = st(voice.length / SR + 0.5 + 0.2 * k);
  mix(out, direct, 0, 1, 0);
  const diffuse = bq(smear(direct, rnd, 0.22 + 0.16 * k, 30, 0.07 + 0.05 * k), 'lowpass', 2200 - 700 * k, 0.6);
  mix(out, diffuse, 0.02, 0.07 + 0.11 * k, -0.35);
  mix(out, diffuse, 0.03, 0.07 + 0.11 * k, 0.35);
  const pk = Math.max(peak(out.l), peak(out.r)) || 1, level = Math.min(0.8, (45 / Math.max(d, 45)) ** 0.5) / pk;
  return { l: gain(out.l, level), r: gain(out.r, level) };
}

/** Note de cloche : fondamentale et deux partiels. */
export function chime(f: number, tau: number, g = 1): Float32Array {
  return gain(norm(add(add(thump(f, f, 1, tau, tau * 5), thump(f * 2.01, f * 2.01, 1, tau * 0.6, tau * 5), 0.35), thump(f * 2.99, f * 2.99, 1, tau * 0.35, tau * 5), 0.15)), g);
}
/** Suite de notes de cloche, une tous les `step` secondes. */
export function chimes(notes: number[], step: number, tau: number): St {
  const out = st(notes.length * step + 1.2);
  notes.forEach((f, i) => mix(out, chime(f, tau, 0.7), i * step, 1, 0));
  return out;
}
/** Cran de tourelle de la maquette. */
export function turretTick(): St {
  return stereo(gain(norm(add(env(bq(noise(0.01, rng(2)), 'highpass', 3000, 0.7), 0.0001, 0.0012), thump(3100, 3100, 1, 0.004, 0.03), 0.5)), 0.45));
}

export class OnlineSounds {
  private voices: St[] = [];
  /** sons de diversion, par numéro (1 à 5) ; null : fichier absent ou illisible */
  private diversions: (Float32Array | null)[] = [];
  private loading: Promise<void> | null = null;
  private whipR = whip(0.34, 600, 2800, 1.8, 1);
  private whipL = whip(0.34, 600, 2800, 1.8, -1);
  private tickBuf = turretTick();
  private startBuf = chimes([392, 523, 659], 0.16, 0.3);
  private endBuf = chimes([659, 523, 392], 0.2, 0.35);
  private topBuf = stereo(chime(660, 0.07, 0.5));
  private goBuf = stereo(chime(990, 0.4, 0.8));
  /** coups de feu lointains, par arme : tir cuit dont ils viennent, et un rendu par tranche de 50 m */
  private far = new Map<string, { shot: BakedShot; dry: Float32Array; byRange: Map<number, St> }>();

  /**
   * `voiceBase` : dossier des voix, barre finale comprise (défaut : `ville/voix/` sous la base du site) ;
   * `diversionBase` : celui des sons de diversion (défaut : `ville/diversion/`).
   */
  constructor(private audio: AudioEngine, private voiceBase: string = import.meta.env.BASE_URL + 'ville/voix/', private diversionBase: string = import.meta.env.BASE_URL + 'ville/diversion/') {}

  /**
   * Charge les dix voix et les cinq sons de diversion (une seule fois). Un fichier absent ou illisible est ignoré ;
   * sans aucune voix, les touches sont muettes.
   */
  load(): Promise<void> {
    const wav = (url: string) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? parseWav(b) : null)).catch(() => null);
    const nn = (i: number): string => String(i + 1).padStart(2, '0');
    this.loading ??= Promise.all([
      Promise.all(Array.from({ length: VOICE_COUNT }, (_, i) => wav(`${this.voiceBase}voix-${nn(i)}.wav`))),
      Promise.all(Array.from({ length: DIVERSION_COUNT }, (_, i) => wav(`${this.diversionBase}pet-${nn(i)}.wav`))),
    ]).then(([voices, diversions]) => {
      this.voices = voices.flatMap((p) => (p ? [{ l: p.l ?? p.data, r: p.r ?? p.data }] : []));
      this.diversions = diversions.map((p) => (p ? p.data : null));
    });
    return this.loading;
  }
  /** nombre de voix chargées */
  get voiceCount(): number {
    return this.voices.length;
  }

  private play(s: St | null, delay = 0, pan = 0, g = 1): boolean {
    return !!s && this.audio.playBuffer(s.l, s.r, { delay, pan, gain: g, bus: BUS });
  }
  private anyVoice(): St | null {
    return this.voices.length ? this.voices[Math.floor(Math.random() * this.voices.length)] : null;
  }

  /** Tir d'un autre, avec l'arme `w`, à `d` mètres, entendu du côté `pan` (−1 gauche … 1 droite) ; il arrive après le trajet du son. */
  distantShot(w: ShotSource, d: number, pan: number): boolean {
    if (!this.audio.started || !(d >= 0)) return false;
    const shot = this.audio.bakedShot(w);
    let f = this.far.get(w.id);
    // tir recuit (enregistrement arrivé, autre carte) : les rendus lointains sont à refaire
    if (!f || f.shot !== shot) this.far.set(w.id, (f = { shot, dry: dryShot(shot), byRange: new Map() }));
    const key = farShotKey(d);
    let s = f.byRange.get(key);
    if (!s) f.byRange.set(key, (s = farShot(f.dry, d)));
    return this.play(s, d / SOUND_SPEED, pan);
  }
  /** Une balle passe tout près : `dir` > 0 si elle traverse de gauche à droite ; `delay` en secondes. */
  bulletPass(dir: number, delay = 0): boolean {
    return this.play(dir > 0 ? this.whipR : this.whipL, delay);
  }
  /** On est touché : une voix toute proche. */
  hitSelf(): boolean {
    return this.play(this.anyVoice(), 0, 0, 0.85);
  }
  /** On touche quelqu'un à `d` mètres : la voix, au loin, du côté `pan`. */
  hitFar(d: number, pan = 0): boolean {
    const v = this.anyVoice();
    return !!v && this.audio.started && this.play(farVoice(v.l, d), 0, pan);
  }
  /** Sa propre diversion, son n° `n` (1 à 5) : toute proche. */
  diversionSelf(n: number): boolean {
    const v = this.diversions[n - 1];
    return !!v && this.play(stereo(v), 0, 0, 0.85);
  }
  /**
   * Diversion d'un autre à `d` mètres, son n° `n` (1 à 5) : même traitement qu'une voix au loin (`farVoice`), du côté
   * `pan`, et elle arrive après le trajet du son.
   */
  diversionFar(n: number, d: number, pan = 0): boolean {
    const v = this.diversions[n - 1];
    return !!v && this.audio.started && d >= 0 && this.play(farVoice(v, d), d / SOUND_SPEED, pan);
  }
  /** Cran de tourelle de la maquette. */
  turretClick(): boolean {
    return this.play(this.tickBuf);
  }
  roundStart(): boolean {
    return this.play(this.startBuf);
  }
  roundEnd(): boolean {
    return this.play(this.endBuf);
  }
  /** Un top du compte à rebours ; `last` : le top de départ, plus aigu et plus long. */
  countdown(last = false): boolean {
    return this.play(last ? this.goBuf : this.topBuf);
  }
}
