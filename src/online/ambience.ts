// Ambiance de la Ville nouvelle, discrète : une rumeur de ville en boucle, très basse, et par manche au plus un klaxon
// et au plus une sirène, toujours au loin (500 m ou plus au plus près). Klaxon et sirène viennent d'un véhicule qui
// roule : effet Doppler (la hauteur glisse), niveau et placement gauche/droite suivent sa position. Sons choisis à
// l'écoute par le propriétaire (public/ville/ambiance/). Ils passent par le moteur audio du solo, donc par son volume.
import type { AudioEngine } from '../audio/engine';
import { parseWav } from '../audio/samples';
import { SR } from '../audio/shot-dsp';

/** vitesse du son, m/s */
const C = 340;
/** distance minimale du véhicule au joueur, au plus près de son passage (m) */
export const AMBIENCE_MIN_RANGE = 500;
/** niveau de la rumeur de fond (le fichier est déjà à −26 LUFS) */
const BED_GAIN = 0.5;

interface St { l: Float32Array; r: Float32Array }

/** met un son au taux du moteur (48 kHz), par interpolation linéaire */
function to48k(x: Float32Array, sr: number): Float32Array {
  if (sr === SR) return x;
  const n = Math.floor((x.length * SR) / sr), y = new Float32Array(n), k = sr / SR;
  for (let i = 0; i < n; i++) { const p = i * k, a = Math.floor(p), b = Math.min(x.length - 1, a + 1); y[i] = x[a] + (x[b] - x[a]) * (p - a); }
  return y;
}

/**
 * Son `s` émis par un véhicule qui suit une droite à `v` m/s et passe au plus près du joueur (à `d0` m) à l'instant 0.
 * L'émission commence à `t0` secondes (négatif : avant le passage) ; on rend `sec` secondes d'écoute. `side` : +1 si
 * le véhicule va de gauche à droite, −1 dans l'autre sens. `level` : niveau au plus près.
 */
export function passBy(s: Float32Array, v: number, d0: number, t0: number, sec: number, side: 1 | -1, level: number): St {
  const n = Math.floor(sec * SR), l = new Float32Array(n), r = new Float32Array(n), lag0 = Math.hypot(v * t0, d0) / C;
  for (let i = 0; i < n; i++) {
    const t = t0 + lag0 + i / SR;                     // instant d'écoute ; le premier son émis arrive à i = 0
    let tau = t;
    for (let k = 0; k < 4; k++) tau = t - Math.hypot(v * tau, d0) / C;     // instant d'émission entendu à t
    const p = (tau - t0) * SR, a = Math.floor(p);
    if (a < 0 || a + 1 >= s.length) continue;
    const x = v * tau, dist = Math.hypot(x, d0);
    const y = (s[a] + (s[a + 1] - s[a]) * (p - a)) * level * Math.min(1, d0 / dist);
    const ang = ((Math.max(-1, Math.min(1, (side * x * 0.8) / dist)) + 1) * Math.PI) / 4;
    l[i] = y * Math.cos(ang); r[i] = y * Math.sin(ang);
  }
  return { l, r };
}

/** fondus d'entrée et de sortie, en place */
function fades(s: St, sec: number): St {
  const n = Math.min(Math.floor(sec * SR), s.l.length >> 1);
  for (let i = 0; i < n; i++) { const g = i / n, j = s.l.length - 1 - i; s.l[i] *= g; s.r[i] *= g; s.l[j] *= g; s.r[j] *= g; }
  return s;
}

export class CityAmbience {
  private bed: Float32Array | null = null;
  private horn: Float32Array | null = null;
  private siren: Float32Array | null = null;
  private loading: Promise<void> | null = null;
  /** instant (ms, horloge de la page) où la boucle en cours se termine */
  private bedEnd = 0;
  /** instants (ms) prévus pour le klaxon et la sirène de la manche en cours ; 0 : déjà joué, ou pas dans cette manche */
  private hornAt = 0;
  private sirenAt = 0;

  constructor(private audio: AudioEngine, private base: string = import.meta.env.BASE_URL + 'ville/ambiance/', private rand: () => number = Math.random) {}

  /** Charge les trois sons (une seule fois). Un fichier absent ou illisible est ignoré : ce son-là ne joue pas. */
  load(): Promise<void> {
    const wav = (nom: string) => fetch(this.base + nom).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? parseWav(b) : null)).then((p) => (p ? to48k(p.data, p.sr) : null)).catch(() => null);
    return (this.loading ??= Promise.all([wav('fond.wav'), wav('klaxon.wav'), wav('sirene.wav')]).then(([bed, horn, siren]) => { this.bed = bed; this.horn = horn; this.siren = siren; }));
  }

  /**
   * Début d'une manche de `ms` millisecondes : tire au sort l'instant du klaxon et celui de la sirène (au plus un de
   * chaque par manche), loin du début et de la fin, et à 40 secondes au moins l'un de l'autre.
   */
  newRound(ms: number, now = performance.now()): void {
    const a = now + 25000, b = now + ms - 30000;
    if (b <= a) { this.hornAt = this.sirenAt = 0; return; }
    this.hornAt = a + this.rand() * (b - a);
    this.sirenAt = a + this.rand() * (b - a);
    if (Math.abs(this.sirenAt - this.hornAt) < 40000) this.sirenAt = this.hornAt + 40000 < b ? this.hornAt + 40000 : this.hornAt - 40000 > a ? this.hornAt - 40000 : 0;
  }

  /** Fin de manche, ou sortie : plus de klaxon ni de sirène à venir. */
  endRound(): void {
    this.hornAt = this.sirenAt = 0;
  }

  /** À chaque image. `on` : l'ambiance doit s'entendre (salon ou manche). */
  frame(on: boolean, now = performance.now()): void {
    if (!on || !this.audio.started) return;
    // rumeur de fond : la boucle suivante est mise en file un peu avant la fin de celle qui joue
    if (this.bed && now > this.bedEnd - 400) {
      const delay = Math.max(0, (this.bedEnd - now) / 1000);
      if (this.audio.playBuffer(this.bed, this.bed, { delay, gain: BED_GAIN, bus: 'world' })) this.bedEnd = now + delay * 1000 + (this.bed.length / SR) * 1000;
    }
    if (this.hornAt && now >= this.hornAt) {
      this.hornAt = 0;
      if (this.horn) {
        // une voiture à 40–70 km/h, à 500–800 m au plus près, qui klaxonne avant, pendant ou après son passage
        const v = 11 + this.rand() * 8, d0 = AMBIENCE_MIN_RANGE + this.rand() * 300, t0 = -12 + this.rand() * 24;
        const s = passBy(this.horn, v, d0, t0, this.horn.length / SR + 0.3, this.rand() < 0.5 ? 1 : -1, 0.85);
        this.audio.playBuffer(s.l, s.r, { bus: 'world' });
      }
    }
    if (this.sirenAt && now >= this.sirenAt) {
      this.sirenAt = 0;
      if (this.siren) {
        // un véhicule à 70–90 km/h, à 500–900 m au plus près : seize secondes de son passage, fondues aux deux bouts
        const v = 19.5 + this.rand() * 5.5, d0 = AMBIENCE_MIN_RANGE + this.rand() * 400, sec = Math.min(16, this.siren.length / SR - 1);
        const s = fades(passBy(this.siren, v, d0, -sec / 2, sec, this.rand() < 0.5 ? 1 : -1, 0.8), 2.5);
        this.audio.playBuffer(s.l, s.r, { bus: 'world' });
      }
    }
  }
}
