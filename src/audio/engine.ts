// Moteur audio de « PIGEON PERCHÉ » : synthétisé (Web Audio), sans bibliothèque. Seuls l'attaque du coup de feu et la
// mécanique de culasse partent de courts enregistrements (samples.ts), avec repli sur la synthèse s'ils manquent.
//
// Graphe :
//   ambiance ─► ambBus ─► ambFilter (ralenti / lunette) ─► ambDuck (oreilles après un tir) ─┐
//   joueur (pas, souffle, cœur, mécanique) ─► sfx ───────────────────────────────────────────┤
//   impacts, véhicules ─► world ─────────────────────────────────────────────────────────────┼─► masterIn ─► compresseur ─► limiteur ─► volume ─► sortie
//   tir et ses échos (tampons cuits par arme et par carte, shot-bake.ts) ─► shotBus ─► volume (ni compresseur ni limiteur)
//   envois ─► reverbIn ─► convolution « vallée » ────────────────────────────────────────────┤

import type { AmbienceState, IAudioEngine, ImpactKind, Landmarks, Surface } from './types';
import { SampleBank, type SampleName } from './samples';
import { BAKE_SEC, bakeShot, type BakedShot } from './shot-bake';
import { SR } from './shot-dsp';
import { DEFAULT_ECHO, echoPan, shotSound, type EchoSpec, type ShotSound, type ShotSource } from './shot-params';
import { Ambience } from './ambience';
import {
  Kit,
  clamp,
  clamp01,
  finite,
  makeBuffers,
  makeThump,
  makeValleyIR,
  rnd,
  wander,
  type Host,
  type Loc,
  type SpatialOpts,
} from './synth';

interface Graph {
  ctx: AudioContext;
  k: Kit;
  masterIn: GainNode;
  vol: GainNode;
  ambBus: GainNode;
  ambFilter: BiquadFilterNode;
  ambDuck: GainNode;
  sfx: GainNode;
  world: GainNode;
  ui: GainNode;
  shotBus: GainNode;
  reverbIn: GainNode;
  amb: Ambience;
  breathF: BiquadFilterNode;
  breathG: GainNode;
  heartG: GainNode;
  thump: AudioBuffer;
  whooshF: BiquadFilterNode;
  whooshG: GainNode;
  whooshF2: BiquadFilterNode;
  whooshG2: GainNode;
  whooshMd: GainNode;
}

/** Voix continue spatialisée (véhicule, drone), créée à la demande et libérée après silence. */
interface Cont {
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  out: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
  idle: number;
  level: number;
  x: number;
  y: number;
  z: number;
  tune(level: number): void;
}

const AMB_LEVEL = 0.5;
/** crête de la détonation du .50 BMG en sortie (le tampon cuit plafonne sous 1 : pas d'écrêtage possible à lui seul) */
const SHOT_GAIN = 0.7;
const MECH_GAIN = 0.16;
interface Baked {
  sound: ShotSound;
  shot: BakedShot;
  echoBufs?: AudioBuffer[] | null;
  buffer: AudioBuffer | null;
}

/**
 * Bus de sortie d'un tampon joué par `playBuffer` : `sfx` (joueur), `world` (monde) et `ui` passent par le compresseur
 * et le limiteur de sortie ; `shot` rejoint directement le volume, comme le coup de feu.
 */
export type BufferBus = 'sfx' | 'world' | 'ui' | 'shot';
export interface PlayBufferOpts {
  /** retard avant le début du son, s */
  delay?: number;
  /** placement : −1 à gauche … 1 à droite */
  pan?: number;
  gain?: number;
  /** défaut : `sfx` */
  bus?: BufferBus;
}

const STEEL: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1.5, 1],
  [1.006, 1.3, 0.5],
  [1.58, 1.25, 0.7],
  [2.24, 1.0, 0.55],
  [2.92, 0.8, 0.42],
  [3.47, 0.6, 0.3],
  [4.31, 0.42, 0.22],
  [5.43, 0.3, 0.15],
  [6.8, 0.2, 0.1],
];

/** partiels d'une petite cloche de bronze (rapport de fréquence, durée en s, amplitude) : bourdon, fondamentale, tierce mineure, quinte, nominal */
const BRONZE: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 4.6, 0.45],
  [1, 3.8, 1],
  [1.19, 2.8, 0.65],
  [1.5, 2.0, 0.3],
  [2, 1.5, 0.45],
  [2.74, 0.9, 0.22],
  [4.1, 0.5, 0.12],
];
const CLANK: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.34, 1],
  [1.47, 0.28, 0.7],
  [2.09, 0.2, 0.6],
  [2.56, 0.16, 0.45],
  [3.31, 0.11, 0.35],
  [4.2, 0.08, 0.25],
];

export class AudioEngine implements IAudioEngine {
  private n: Graph | null = null;
  private volume = 0.8;
  private landmarks: Landmarks | null = null;
  private echoSpec: EchoSpec = DEFAULT_ECHO;
  private samples = new SampleBank();
  private sampleBufs = new Map<SampleName, AudioBuffer>();
  private bakes = new Map<string, Baked>();
  /** tampons de `playBuffer`, par voie gauche */
  private pcmBufs = new WeakMap<Float32Array, { r: Float32Array; buf: AudioBuffer }>();
  private lastWeapon: ShotSource | null = null;

  private lx = 0;
  private ly = 0;
  private lz = 0;
  private fx = 0;
  private fy = 0;
  private fz = -1;

  private lastNow = 0;
  private acc = 0;
  private menu = false;
  private breathPhase = 0;
  private nextBeat = 0;
  private stepSide = 1;
  private whoosh = 0;
  private veh: Cont | null = null;
  private drn: Cont | null = null;

  get started(): boolean {
    return this.n !== null;
  }

  async start(): Promise<void> {
    try {
      if (!this.n) {
        const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return;
        let ctx: AudioContext;
        try {
          ctx = new Ctor({ latencyHint: 'interactive' });
        } catch {
          ctx = new Ctor();
        }
        try {
          this.n = this.build(ctx);
        } catch (e) {
          this.n = null;
          void ctx.close().catch(() => undefined);
          throw e;
        }
        this.lastNow = ctx.currentTime;
        this.applyListener();
        // enregistrements : chargés après le premier geste du joueur ; d'ici là, et s'ils manquent, tout est synthétisé
        this.samples.load(import.meta.env.BASE_URL + 'assets/audio/', (name) => {
          const w = this.lastWeapon;
          if (w && shotSound(w).attack === name) this.prepareShot(w);
        });
      }
      if (this.n.ctx.state !== 'running') await this.n.ctx.resume();
    } catch (e) {
      console.warn('[audio] start', e);
    }
  }

  setMasterVolume(v: number): void {
    this.volume = clamp01(finite(v, 0.8));
    this.run((n) => n.k.set(n.vol.gain, this.volume, 0.05));
  }

  setLandmarks(l: Landmarks): void {
    this.landmarks = l;
    this.run((n) => {
      n.amb.landmarks = l;
    });
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    if (![px, py, pz, fx, fy, fz].every(Number.isFinite)) return;
    this.lx = px;
    this.ly = py;
    this.lz = pz;
    const len = Math.hypot(fx, fy, fz);
    if (len > 1e-6) {
      this.fx = fx / len;
      this.fy = fy / len;
      this.fz = fz / len;
    }
    this.run(() => this.applyListener());
  }

  update(dt: number, s: AmbienceState): void {
    this.run((n) => {
      const now = n.ctx.currentTime;
      let rdt = now - this.lastNow;
      this.lastNow = now;
      if (!(rdt > 0)) return; // contexte suspendu
      if (rdt > 0.25) rdt = 0.25;
      this.menu = !!s.menu;
      this.acc += rdt;
      if (this.acc < 0.033) return;
      const tdt = Math.min(this.acc, 0.25);
      this.acc = 0;
      this.tick(n, tdt, s, now);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Tir
  // ---------------------------------------------------------------------------------------------

  setEcho(spec: EchoSpec | null | undefined): void {
    this.echoSpec = spec ?? DEFAULT_ECHO;
    // les échos sont cuits avec le tir : une autre carte, d'autres tampons
    this.bakes.clear();
  }

  prepareShot(w: ShotSource): void {
    try {
      this.baked(w);
    } catch (e) {
      console.warn('[audio] tir', e);
    }
  }

  shot(w: ShotSource): void {
    this.run((n) => {
      const k = n.k;
      const ctx = n.ctx;
      const b = this.baked(w);
      const p = b.sound;
      const t = k.now + 0.004;
      if (!b.buffer) {
        b.buffer = ctx.createBuffer(2, b.shot.l.length, SR);
        b.buffer.getChannelData(0).set(b.shot.l);
        b.buffer.getChannelData(1).set(b.shot.r);
      }
      // détonation cuite : légère variation de hauteur et de niveau d'un tir à l'autre
      const src = ctx.createBufferSource();
      src.buffer = b.buffer;
      src.playbackRate.value = rnd(0.985, 1.015);
      const lvl = SHOT_GAIN * p.level * rnd(0.93, 1);
      const v = k.gain(lvl);
      src.connect(v);
      v.connect(n.shotBus);
      src.start(t);

      // échos des reliefs de la carte : chacun revient du côté de son relief, quel que soit le regard
      if (!b.echoBufs) {
        b.echoBufs = b.shot.echoes.map((e) => {
          const eb = ctx.createBuffer(1, e.data.length, SR);
          eb.getChannelData(0).set(e.data);
          return eb;
        });
      }
      const held: AudioNode[] = [v];
      let end = t + BAKE_SEC;
      b.shot.echoes.forEach((e, i) => {
        const es = ctx.createBufferSource();
        es.buffer = (b.echoBufs as AudioBuffer[])[i];
        es.playbackRate.value = src.playbackRate.value;
        const pn = k.pan(echoPan(e.bearing, this.fx, this.fz));
        es.connect(pn);
        pn.connect(v);
        es.start(t + e.delay);
        held.push(es, pn);
        end = Math.max(end, t + e.delay + e.data.length / SR + 0.1);
      });
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          /* déjà déconnecté */
        }
      };
      k.release(end + 0.3, ...held);

      // oreilles : l'ambiance s'efface brièvement après un tir fort
      const duck = p.duck;
      if (duck > 0.02) {
        const g = n.ambDuck.gain;
        const now = k.now;
        g.cancelScheduledValues(now);
        g.setTargetAtTime(1 - duck, now, 0.012);
        g.setTargetAtTime(1, now + 0.18 + 0.35 * duck, 0.5 + 1.3 * duck);
      }
    });
  }

  /**
   * Tir cuit de l'arme sur la carte en cours (tampon stéréo à 48 kHz, shot-bake.ts) : celui que joue `shot()`.
   * Pour en dériver un autre son (tir entendu de loin) ; l'objet rendu change quand le tir est recuit.
   */
  bakedShot(w: ShotSource): BakedShot {
    // `baked` note l'arme pour la recuire à l'arrivée de son enregistrement : celle du joueur doit le rester
    const keep = this.lastWeapon;
    const b = this.baked(w);
    if (keep) this.lastWeapon = keep;
    return b.shot;
  }

  /**
   * Joue un tampon stéréo déjà calculé (48 kHz, comme ceux de shot-dsp.ts) : après `delay` secondes, placé à `pan`,
   * au niveau `gain`, sur le bus `bus`. Renvoie faux si rien n'est joué (moteur arrêté ou suspendu, tampon vide).
   */
  playBuffer(l: Float32Array, r: Float32Array, o: PlayBufferOpts = {}): boolean {
    const n = this.n;
    if (!n || n.ctx.state !== 'running' || !l.length || r.length !== l.length) return false;
    try {
      const ctx = n.ctx;
      let c = this.pcmBufs.get(l);
      if (!c || c.r !== r) {
        const buf = ctx.createBuffer(2, l.length, SR);
        buf.getChannelData(0).set(l);
        buf.getChannelData(1).set(r);
        c = { r, buf };
        this.pcmBufs.set(l, c);
      }
      const src = ctx.createBufferSource();
      src.buffer = c.buf;
      const gn = n.k.gain(finite(o.gain ?? 1, 1));
      src.connect(gn);
      const pan = clamp(finite(o.pan ?? 0, 0), -1, 1);
      const pn = pan !== 0 ? n.k.pan(pan) : null;
      if (pn) gn.connect(pn);
      const bus = o.bus ?? 'sfx';
      (pn ?? gn).connect(bus === 'shot' ? n.shotBus : bus === 'world' ? n.world : bus === 'ui' ? n.ui : n.sfx);
      src.onended = () => {
        try {
          src.disconnect();
          gn.disconnect();
          pn?.disconnect();
        } catch {
          /* déjà déconnecté */
        }
      };
      src.start(ctx.currentTime + Math.max(0, finite(o.delay ?? 0, 0)));
      return true;
    } catch (e) {
      n.k.warn(e);
      return false;
    }
  }

  /** Tampon du tir de l'arme : cuit à la première demande, recuit si l'attaque enregistrée est arrivée entre-temps. */
  private baked(w: ShotSource): Baked {
    const p = shotSound(w);
    const attack = this.samples.get(p.attack);
    const key = w.id;
    const had = this.bakes.get(key);
    this.lastWeapon = w;
    if (had && had.shot.recorded === !!attack) return had;
    if (this.bakes.size > 5) this.bakes.clear();
    const b: Baked = { sound: p, shot: bakeShot(p, attack, this.echoSpec), buffer: null };
    this.bakes.set(key, b);
    return b;
  }

  /** Joue un son enregistré de mécanique ; faux s'il n'est pas (encore) chargé : l'appelant synthétise. */
  private sample(n: Graph, name: SampleName, t: number, g: number, pan: number, rate = 1): boolean {
    const pcm = this.samples.get(name);
    if (!pcm) return false;
    let buf = this.sampleBufs.get(name);
    if (!buf) {
      buf = n.ctx.createBuffer(1, pcm.data.length, pcm.sr);
      buf.getChannelData(0).set(pcm.data);
      this.sampleBufs.set(name, buf);
    }
    const src = n.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * rnd(0.97, 1.03);
    const gn = n.k.gain(g);
    const pn = n.k.pan(pan);
    src.connect(gn);
    gn.connect(pn);
    pn.connect(n.sfx);
    src.onended = () => {
      try {
        src.disconnect();
        gn.disconnect();
        pn.disconnect();
      } catch {
        /* déjà déconnecté */
      }
    };
    src.start(t);
    return true;
  }

  boltOpen(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      // prise réelle (culasse de fusil à verrou), puis l'étui qui touche le sol ; synthèse si le fichier manque
      if (this.sample(n, 'boltOpen', t, MECH_GAIN, 0.15)) {
        if (!this.sample(n, 'casing', t + 0.5, MECH_GAIN * 0.22, 0.4)) k.ring(n.sfx, t + 0.3, rnd(3800, 4400), [[1, 0.12, 1], [1.52, 0.09, 0.6], [2.41, 0.06, 0.35]], 0.025);
        return;
      }
      // déverrouillage, glissement vers l'arrière, butée
      this.clack(n, t, 0.5, 1900);
      k.burst(n.sfx, t + 0.05, { f: 3400, f1: 4600, q: 2.2, a: 0.07, d: 0.07, g: 0.1, pan: 0.15 });
      k.burst(n.sfx, t + 0.05, { n: 'pink', f: 900, f1: 1300, q: 1.2, a: 0.07, d: 0.06, g: 0.08, pan: 0.15 });
      this.clack(n, t + 0.16, 0.8, 1500);
      // étui éjecté : petit tintement
      k.ring(n.sfx, t + 0.3, rnd(3800, 4400), [[1, 0.12, 1], [1.52, 0.09, 0.6], [2.41, 0.06, 0.35]], 0.025);
    });
  }

  boltClose(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      if (this.sample(n, 'boltClose', t, MECH_GAIN, 0.15)) return;
      k.burst(n.sfx, t, { f: 4400, f1: 3200, q: 2.2, a: 0.06, d: 0.06, g: 0.1, pan: 0.15 });
      k.burst(n.sfx, t, { n: 'pink', f: 1300, f1: 850, q: 1.2, a: 0.06, d: 0.05, g: 0.09, pan: 0.15 });
      this.clack(n, t + 0.11, 0.9, 1350);
      this.clack(n, t + 0.2, 0.55, 2300);
    });
  }

  dryFire(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      k.burst(n.sfx, t, { type: 'highpass', f: 3000, a: 0.0003, d: 0.014, g: 0.3 });
      k.ring(n.sfx, t, 2700, [[1, 0.05, 1], [1.71, 0.035, 0.6], [2.63, 0.02, 0.4]], 0.07);
      k.tone(n.sfx, t, { f: 320, f1: 210, d: 0.035, g: 0.12 });
      k.tone(n.sfx, t + 0.004, { f: 5200, f1: 4700, d: 0.1, g: 0.012 }); // ressort
    });
  }

  magOut(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      this.clack(n, t, 0.45, 2500);
      k.burst(n.sfx, t + 0.04, { n: 'pink', f: 1500, f1: 800, q: 1.4, a: 0.05, d: 0.1, g: 0.12, pan: 0.1 });
      k.tone(n.sfx, t + 0.13, { f: 230, f1: 160, d: 0.06, g: 0.1 });
    });
  }

  magIn(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      k.burst(n.sfx, t, { n: 'pink', f: 800, f1: 1600, q: 1.4, a: 0.06, d: 0.05, g: 0.12, pan: 0.1 });
      this.clack(n, t + 0.1, 0.6, 1250);
      k.tone(n.sfx, t + 0.1, { f: 170, f1: 110, d: 0.08, g: 0.15 });
      this.clack(n, t + 0.125, 0.3, 3100);
    });
  }

  turretClick(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      k.burst(n.sfx, t, { type: 'highpass', f: 5000, a: 0.0002, d: 0.005, g: 0.14 });
      k.ring(n.sfx, t, rnd(3300, 3500), [[1, 0.016, 1], [1.62, 0.012, 0.6], [2.3, 0.008, 0.3]], 0.05);
    });
  }

  zoomClick(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      k.burst(n.sfx, t, { f: 2400, q: 1.5, a: 0.0005, d: 0.012, g: 0.12 });
      k.tone(n.sfx, t, { f: 900, f1: 700, d: 0.02, g: 0.04 });
      k.burst(n.sfx, t, { n: 'pink', f: 1800, q: 0.8, a: 0.01, d: 0.04, g: 0.02 }); // friction de bague
    });
  }

  rangefinder(): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      k.tone(n.ui, t, { f: 2350, a: 0.003, h: 0.05, d: 0.04, g: 0.07 });
      k.tone(n.ui, t + 0.11, { f: 3130, a: 0.003, h: 0.07, d: 0.06, g: 0.07 });
      k.burst(n.ui, t, { type: 'highpass', f: 4000, a: 0.0003, d: 0.006, g: 0.05 });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Impacts
  // ---------------------------------------------------------------------------------------------

  impact(kind: ImpactKind, x: number, y: number, z: number, delaySec: number, energyJ: number): void {
    this.run((n) => {
      if (![x, y, z].every(Number.isFinite)) return;
      const k = n.k;
      const t = k.now + clamp(finite(delaySec, 0), 0, 30) + 0.003;
      const e = clamp(0.45 + 0.55 * Math.sqrt(Math.max(0, finite(energyJ, 1500)) / 3000), 0.4, 1.4);
      const dly = t - k.now;
      const out = (g: number, dur: number, rev: number, lpMin = 1400, ref = 250): GainNode =>
        this.spatialOut(x, y, z, dly + dur, { g: g * e * 1.6, ref, rev, lpMin, floor: 0.1 });

      switch (kind) {
        case 'steel': {
          // la récompense : « ding » clair, partiels inharmoniques, 1 à 1,5 s
          const o = out(0.95, 2.2, 0.55, 3200, 400);
          const f0 = rnd(1180, 1460);
          const bright = clamp(e, 0.6, 1.3);
          const parts = STEEL.map(([r, d, a], i) => [r, d * rnd(0.9, 1.1), a * (i > 3 ? bright : 1)] as const);
          k.ring(o, t, f0, parts, 0.34);
          k.burst(o, t, { type: 'highpass', f: 3500, a: 0.0003, d: 0.012, g: 0.7 });
          k.burst(o, t, { f: f0 * 2.4, q: 3, a: 0.0005, d: 0.06, g: 0.35 });
          k.tone(o, t, { f: 330, f1: 240, d: 0.07, g: 0.3 });
          break;
        }
        case 'bell': {
          // bronze : fondamentale grave et longue, tierce mineure et quinte de cloche, choc sec du projectile
          const o = out(1.0, 5.5, 0.6, 2400, 450);
          const f0 = rnd(600, 660);
          k.ring(o, t, f0, BRONZE.map(([r, d, a]) => [r, d * rnd(0.92, 1.08), a] as const), 0.36);
          k.burst(o, t, { type: 'highpass', f: 2800, a: 0.0003, d: 0.014, g: 0.6 });
          k.tone(o, t, { f: 260, f1: 180, d: 0.08, g: 0.3 });
          break;
        }
        case 'metal': {
          const o = out(1.1, 1.2, 0.35);
          k.ring(o, t, rnd(480, 700), CLANK, 0.3);
          k.burst(o, t, { f: 2500, q: 0.8, a: 0.0005, d: 0.06, g: 0.7 });
          k.tone(o, t, { f: 145, f1: 92, d: 0.11, g: 0.4 });
          break;
        }
        case 'balloon': {
          const o = out(1.2, 0.8, 0.4);
          k.burst(o, t, { type: 'highpass', f: 800, a: 0.0003, d: 0.05, g: 1 });
          k.burst(o, t, { n: 'pink', f: 1200, f1: 400, q: 0.8, a: 0.001, d: 0.13, g: 0.6 });
          k.tone(o, t, { f: 300, f1: 90, d: 0.06, g: 0.5 });
          break;
        }
        case 'glass': {
          const o = out(1.1, 1.4, 0.35, 3000);
          k.burst(o, t, { type: 'highpass', f: 3000, a: 0.0004, d: 0.04, g: 0.9 });
          k.burst(o, t, { f: 6000, q: 0.8, a: 0.005, d: 0.5, g: 0.3 });
          const cnt = 10 + Math.floor(Math.random() * 5);
          for (let i = 0; i < cnt; i++) {
            const tt = t + Math.pow(Math.random(), 1.6) * 0.65;
            k.tone(o, tt, { f: rnd(2500, 7500), a: 0.0008, d: rnd(0.08, 0.3), g: rnd(0.06, 0.18) });
          }
          break;
        }
        case 'fuel': {
          const o = out(1.4, 3.6, 0.6, 900);
          k.tone(o, t, { f: 92, f1: 34, a: 0.04, d: 1.3, g: 1 });
          k.burst(o, t, { n: 'brown', type: 'lowpass', f: 320, f1: 110, a: 0.08, d: 1.9, g: 0.9 });
          k.burst(o, t, { n: 'pink', f: 700, q: 0.5, a: 0.15, h: 0.3, d: 2.2, g: 0.35 });
          for (let i = 0; i < 26; i++) {
            const tt = t + 0.1 + Math.pow(Math.random(), 1.5) * 3.1;
            k.burst(o, tt, { type: 'highpass', f: rnd(1800, 4000), a: 0.0004, d: rnd(0.008, 0.03), g: rnd(0.1, 0.3) });
          }
          break;
        }
        case 'electric': {
          const o = out(1.0, 1.2, 0.3, 2400);
          k.tone(o, t, { type: 'square', f: 1900, f1: 280, a: 0.001, d: 0.13, g: 0.18 });
          k.tone(o, t, { type: 'sawtooth', f: 100, a: 0.005, h: 0.25, d: 0.4, g: 0.22 });
          const cnt = 8 + Math.floor(Math.random() * 5);
          for (let i = 0; i < cnt; i++) {
            const tt = t + Math.random() * 0.75;
            k.burst(o, tt, { f: rnd(3000, 5500), q: 3, a: 0.0005, d: rnd(0.02, 0.06), g: rnd(0.25, 0.5) });
          }
          break;
        }
        case 'tire': {
          const o = out(2.2, 2.4, 0.25, 2200);
          k.burst(o, t, { n: 'pink', type: 'lowpass', f: 650, a: 0.001, d: 0.09, g: 0.7 });
          k.burst(o, t, { f: 5200, f1: 2400, q: 0.7, a: 0.02, h: 0.3, d: 1.8, g: 0.32 });
          break;
        }
        case 'body': {
          const o = out(0.9, 0.5, 0.15, 900);
          k.burst(o, t, { n: 'pink', type: 'lowpass', f: 360, a: 0.003, d: 0.14, g: 0.7 });
          k.tone(o, t, { f: 96, f1: 55, d: 0.12, g: 0.5 });
          break;
        }
        case 'dirt': {
          const o = out(1.0, 1.4, 0.3);
          k.burst(o, t, { n: 'pink', type: 'lowpass', f: 700, a: 0.003, d: 0.2, g: 0.8 });
          k.burst(o, t, { f: 2200, q: 0.6, a: 0.012, d: 0.32, g: 0.25 });
          if (Math.random() < 0.1) this.ricochet(n, o, t + 0.01);
          break;
        }
        case 'rock': {
          const o = out(1.1, 1.5, 0.4, 2000);
          k.burst(o, t, { type: 'highpass', f: 1800, a: 0.0005, d: 0.05, g: 0.8 });
          k.burst(o, t, { n: 'pink', f: 900, q: 1, a: 0.001, d: 0.15, g: 0.6 });
          for (let i = 0; i < 4; i++) {
            k.burst(o, t + rnd(0.04, 0.35), { f: rnd(1800, 4500), q: 2, a: 0.001, d: rnd(0.02, 0.05), g: rnd(0.08, 0.2) });
          }
          if (Math.random() < 0.35) this.ricochet(n, o, t + 0.01);
          break;
        }
        case 'water': {
          const o = out(1.0, 1.4, 0.3);
          k.burst(o, t, { n: 'pink', type: 'lowpass', f: 520, a: 0.002, d: 0.2, g: 0.6 });
          k.burst(o, t, { f: 2600, f1: 900, q: 0.6, a: 0.012, d: 0.5, g: 0.55 });
          k.tone(o, t, { f: 300, f1: 620, d: 0.08, g: 0.25 });
          for (let i = 0; i < 5; i++) {
            const f = rnd(900, 2200);
            k.tone(o, t + rnd(0.15, 0.65), { f, f1: f * 1.5, a: 0.002, d: 0.045, g: rnd(0.04, 0.09) });
          }
          break;
        }
        case 'wood': {
          const o = out(1.0, 0.6, 0.25);
          k.tone(o, t, { f: 265, f1: 190, d: 0.1, g: 0.6 });
          k.tone(o, t, { f: 630, d: 0.05, g: 0.2 });
          k.burst(o, t, { n: 'pink', f: 1100, q: 1.5, a: 0.0008, d: 0.07, g: 0.5 });
          k.burst(o, t, { type: 'highpass', f: 3000, a: 0.0004, d: 0.03, g: 0.3 });
          break;
        }
      }
    });
  }

  bulletWhoosh(level: number): void {
    this.run((n) => {
      this.whoosh = clamp01(finite(level, 0));
      this.applyWhoosh(n, n.k.now);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Joueur
  // ---------------------------------------------------------------------------------------------

  footstep(surface: Surface, intensity: number): void {
    this.run((n) => {
      if (this.menu) return;
      const k = n.k;
      const t = k.now;
      const i = clamp01(finite(intensity, 0.5));
      const g = (0.22 + 0.5 * i) * rnd(0.85, 1.1);
      const v = rnd(0.9, 1.1);
      this.stepSide = -this.stepSide;
      const pan = this.stepSide * 0.14;
      const o = k.pan(pan);
      o.connect(n.sfx);
      let end = t + 0.3;
      switch (surface) {
        case 'grass':
          k.burst(o, t, { n: 'pink', type: 'lowpass', f: 480 * v, a: 0.004, d: 0.12, g: 0.75 * g });
          k.burst(o, t + 0.005, { f: 3400 * v, q: 0.7, a: 0.012, d: 0.13, g: 0.24 * g });
          end = k.burst(o, t + 0.07, { f: 4600 * v, q: 0.8, a: 0.02, d: 0.1, g: 0.07 * g });
          break;
        case 'stone':
          k.burst(o, t, { type: 'highpass', f: 2500 * v, a: 0.0005, d: 0.02, g: 0.3 * g });
          k.tone(o, t, { f: 145 * v, f1: 72, d: 0.09, g: 0.5 * g });
          k.burst(o, t, { n: 'pink', f: 900 * v, q: 1, a: 0.001, d: 0.06, g: 0.3 * g });
          end = k.burst(o, t + 0.05, { f: 5000, q: 1, a: 0.01, d: 0.05, g: 0.03 * g }); // grain sous la semelle
          break;
        case 'gravel': {
          k.burst(o, t, { n: 'pink', type: 'lowpass', f: 420, a: 0.003, d: 0.1, g: 0.6 * g });
          const cnt = 6 + Math.floor(Math.random() * 4);
          for (let j = 0; j < cnt; j++) {
            end = Math.max(
              end,
              k.burst(o, t + Math.random() * 0.19, { f: rnd(1800, 5200), q: 2, a: 0.001, d: rnd(0.02, 0.05), g: rnd(0.3, 0.6) * g }),
            );
          }
          break;
        }
        case 'wood':
          k.tone(o, t, { f: 190 * v, f1: 150 * v, d: 0.16, g: 0.5 * g });
          k.tone(o, t, { f: 415 * v, d: 0.08, g: 0.14 * g });
          k.burst(o, t, { n: 'pink', f: 620 * v, q: 2, a: 0.001, d: 0.07, g: 0.3 * g });
          if (Math.random() < 0.2) k.tone(o, t + 0.05, { type: 'sawtooth', f: rnd(500, 700), f1: rnd(380, 480), a: 0.03, d: 0.12, g: 0.012 * g });
          break;
      }
      k.release(end + 0.1, o);
    });
  }

  cloth(intensity: number): void {
    this.run((n) => {
      if (this.menu) return;
      const k = n.k;
      const t = k.now;
      const g = 0.04 + 0.12 * clamp01(finite(intensity, 0.5));
      k.burst(n.sfx, t, { n: 'pink', f: rnd(1500, 2200), f1: rnd(2400, 3200), q: 0.7, a: 0.06, d: 0.16, g, pan: -0.2 });
      k.burst(n.sfx, t + rnd(0.1, 0.18), { n: 'pink', f: rnd(2400, 3000), f1: rnd(1300, 1800), q: 0.7, a: 0.05, d: 0.2, g: g * 0.8, pan: 0.2 });
      k.burst(n.sfx, t + 0.02, { n: 'brown', type: 'lowpass', f: 300, a: 0.03, d: 0.15, g: g * 1.2 });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Sources lointaines continues
  // ---------------------------------------------------------------------------------------------

  vehicle(x: number, y: number, z: number, level: number): void {
    this.run((n) => {
      const lv = clamp01(finite(level, 0));
      if (!this.veh) {
        if (lv <= 0) return;
        this.veh = this.makeVehicle(n);
      }
      this.placeCont(n, this.veh, x, y, z, lv);
    });
  }

  drone(x: number, y: number, z: number, level: number): void {
    this.run((n) => {
      const lv = clamp01(finite(level, 0));
      if (!this.drn) {
        if (lv <= 0) return;
        this.drn = this.makeDrone(n);
      }
      this.placeCont(n, this.drn, x, y, z, lv);
    });
  }

  crowdPanic(x: number, y: number, z: number): void {
    this.run((n) => {
      if (![x, y, z].every(Number.isFinite)) return;
      const k = n.k;
      const t = k.now + 0.05;
      const o = this.spatialOut(x, y, z, 8, { g: 0.9, ref: 400, rev: 0.5, dest: n.ambBus, lpMin: 1500, floor: 0.12 });
      const swell = (u: number): number => (u < 1.4 ? 0.25 + (0.75 * u) / 1.4 : Math.exp(-(u - 1.4) / 1.7));
      // brouhaha : grains de bruit à formants, enveloppe de houle
      for (let i = 0; i < 34; i++) {
        const u = Math.random() * 5.2;
        k.burst(o, t + u, { n: 'pink', f: rnd(400, 2000), q: rnd(2.5, 5), a: rnd(0.07, 0.2), d: rnd(0.4, 0.9), g: 0.9 * swell(u), pan: rnd(-0.3, 0.3) });
      }
      // éclats de voix indistincts : dents de scie glissées à travers un formant
      const vb = k.filter('bandpass', 1050, 0.9);
      vb.connect(o);
      k.release(t + 7, vb);
      for (let i = 0; i < 11; i++) {
        const u = 0.2 + Math.random() * 4.2;
        const f = rnd(230, 520);
        k.tone(vb, t + u, { type: 'sawtooth', f, f1: f * rnd(0.8, 1.3), a: rnd(0.06, 0.12), d: rnd(0.3, 0.6), g: 0.11 * swell(u) });
      }
    });
  }

  ui(kind: 'hover' | 'select' | 'confirm' | 'fail' | 'success' | 'page'): void {
    this.run((n) => {
      const k = n.k;
      const t = k.now;
      const o = n.ui;
      switch (kind) {
        case 'hover':
          k.tone(o, t, { f: 1800, a: 0.003, d: 0.045, g: 0.035 });
          break;
        case 'select':
          k.tone(o, t, { type: 'triangle', f: 1100, f1: 1320, ft: 0.04, a: 0.003, d: 0.08, g: 0.07 });
          break;
        case 'confirm':
          k.tone(o, t, { f: 880, a: 0.004, d: 0.1, g: 0.08 });
          k.tone(o, t + 0.065, { f: 1320, a: 0.004, d: 0.16, g: 0.08 });
          break;
        case 'fail':
          k.tone(o, t, { f: 196, f1: 170, a: 0.01, d: 0.28, g: 0.12 });
          k.tone(o, t, { type: 'triangle', f: 147, f1: 131, a: 0.01, d: 0.3, g: 0.07 });
          break;
        case 'success':
          k.tone(o, t, { f: 784, a: 0.006, d: 0.55, g: 0.09 });
          k.tone(o, t, { f: 1568, a: 0.006, d: 0.3, g: 0.018 });
          k.tone(o, t + 0.14, { f: 1174.7, a: 0.006, d: 0.85, g: 0.09 });
          k.tone(o, t + 0.14, { f: 2349.3, a: 0.006, d: 0.4, g: 0.016 });
          break;
        case 'page':
          k.burst(o, t, { n: 'pink', f: 2500, f1: 1200, q: 0.8, a: 0.012, d: 0.12, g: 0.06 });
          break;
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Interne
  // ---------------------------------------------------------------------------------------------

  /** Exécute fn si le moteur est démarré ; n'émet jamais d'exception. */
  private run(fn: (n: Graph) => void): void {
    const n = this.n;
    if (!n) return;
    try {
      fn(n);
    } catch (e) {
      n.k.warn(e);
    }
  }

  private build(ctx: AudioContext): Graph {
    const k = new Kit(ctx, makeBuffers(ctx));

    const masterIn = k.gain(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -5;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    const vol = k.gain(this.volume);
    masterIn.connect(comp);
    comp.connect(lim);
    lim.connect(vol);
    vol.connect(ctx.destination);

    const ambBus = k.gain(AMB_LEVEL);
    const ambFilter = k.kfilter('lowpass', 20000, 0.5);
    const ambDuck = k.gain(1);
    ambBus.connect(ambFilter);
    ambFilter.connect(ambDuck);
    ambDuck.connect(masterIn);

    const sfx = k.gain(1);
    sfx.connect(masterIn);
    const world = k.gain(1);
    world.connect(masterIn);
    const ui = k.gain(0.9);
    ui.connect(masterIn);

    // tir : tampon déjà saturé en douceur à la cuisson (shot-bake.ts). Il contourne le compresseur et le limiteur de
    // sortie, qui rabotaient l'attaque de 4 dB et faisaient remonter le corps : il rejoint directement le volume.
    const shotBus = k.gain(1);
    shotBus.connect(vol);

    // réverbération de vallée
    const reverbIn = k.gain(1);
    const conv = ctx.createConvolver();
    conv.buffer = makeValleyIR(ctx);
    const reverbOut = k.gain(0.9);
    reverbIn.connect(conv);
    conv.connect(reverbOut);
    reverbOut.connect(masterIn);

    // souffle
    const bS = k.loop('pink', 1.07);
    const breathF = k.kfilter('bandpass', 1500, 0.9);
    const breathG = k.gain(0);
    bS.connect(breathF);
    breathF.connect(breathG);
    breathG.connect(sfx);

    // cœur
    const heartG = k.gain(0);
    heartG.connect(sfx);

    // passage de la balle (caméra de balle)
    const wS = k.loop('pink', 1.21);
    const whooshF = k.kfilter('bandpass', 700, 1.1);
    const whooshG = k.gain(0);
    const whooshF2 = k.kfilter('bandpass', 2600, 4);
    const whooshG2 = k.gain(0);
    const wM = k.loop('mod', 0.9);
    const whooshMd = k.gain(0);
    wM.connect(whooshMd);
    whooshMd.connect(whooshG.gain);
    wS.connect(whooshF);
    whooshF.connect(whooshG);
    whooshG.connect(sfx);
    wS.connect(whooshF2);
    whooshF2.connect(whooshG2);
    whooshG2.connect(sfx);

    const host: Host = {
      lx: 0,
      ly: 0,
      lz: 0,
      locate: (x, y, z) => this.locate(x, y, z),
      spatialOut: (x, y, z, dur, o) => this.spatialOut(x, y, z, dur, o),
    };
    Object.defineProperties(host, {
      lx: { get: () => this.lx },
      ly: { get: () => this.ly },
      lz: { get: () => this.lz },
    });

    const g: Graph = {
      ctx,
      k,
      masterIn,
      vol,
      ambBus,
      ambFilter,
      ambDuck,
      sfx,
      world,
      ui,
      shotBus,
      reverbIn,
      amb: null as unknown as Ambience,
      breathF,
      breathG,
      heartG,
      thump: makeThump(ctx),
      whooshF,
      whooshG,
      whooshF2,
      whooshG2,
      whooshMd,
    };
    // spatialOut (utilisé par l'ambiance dès sa construction) a besoin du graphe
    this.n = g;
    g.amb = new Ambience(k, ambBus, reverbIn, host);
    if (this.landmarks) g.amb.landmarks = this.landmarks;
    return g;
  }

  private tick(n: Graph, dt: number, s: AmbienceState, now: number): void {
    const k = n.k;
    const menu = !!s.menu;
    const scope = !!s.inScope && !menu;

    // ralenti : l'ambiance s'assourdit et descend légèrement en hauteur
    const slow = 1 - clamp(finite(s.timeScale, 1), 0.03, 1);
    const cut = Math.min(20000 * Math.pow(0.05, slow), scope ? 7000 : 20000);
    k.set(n.ambFilter.frequency, cut, 0.2);
    k.set(n.ambBus.gain, AMB_LEVEL * (menu ? 1.3 : scope ? 0.8 : 1), 0.4);
    n.amb.tick(dt, s, now, 1 - 0.3 * slow);

    // souffle
    const hr = clamp(finite(s.heartRate, 65), 40, 190);
    const effort = clamp01((hr - 60) / 90);
    const held = s.breath === 'held';
    const gasp = s.breath === 'gasping';
    let env = 0;
    let bf = 1500;
    if (held) {
      this.breathPhase = 0.44; // à la reprise, on commence par expirer
    } else {
      const period = gasp ? 1.05 : 4.5 - 2.8 * effort;
      this.breathPhase = (this.breathPhase + dt / period) % 1;
      const p = this.breathPhase;
      if (p < 0.36) {
        env = Math.pow(Math.sin((p / 0.36) * Math.PI), 0.8);
        bf = 1700 + 500 * env;
      } else if (p >= 0.44 && p < 0.88) {
        env = 0.8 * Math.pow(Math.sin(((p - 0.44) / 0.44) * Math.PI), 0.7);
        bf = 1150 - 250 * ((p - 0.44) / 0.44);
      }
    }
    const presence = menu ? 0 : scope ? 1 : gasp ? 0.4 : 0;
    const bl = presence * env * (gasp ? 0.13 : 0.06 + 0.07 * effort);
    k.set(n.breathG.gain, bl, gasp ? 0.03 : 0.06);
    k.set(n.breathF.frequency, bf, 0.05);

    // cœur : lub-dub programmé avec une courte avance
    const hl = scope && s.heart !== false ? (held ? 0.6 : gasp ? 0.45 : 0.28) + 0.15 * effort : 0;
    k.set(n.heartG.gain, hl, held ? 0.5 : 0.25);
    const beat = 60 / hr;
    if (this.nextBeat < now) this.nextBeat = now + 0.05;
    if (hl > 0.001 && this.nextBeat < now + 0.2) {
      const t = this.nextBeat;
      this.thump(n, t, 1, 1);
      this.thump(n, t + clamp(0.16 + 0.14 * beat, 0.14, 0.34), 1.22, 0.62);
      this.nextBeat = t + beat * rnd(0.985, 1.015);
    } else if (hl <= 0.001) {
      this.nextBeat = now + 0.1;
    }

    this.applyWhoosh(n, now);
    this.veh = this.tickCont(n, this.veh, dt);
    this.drn = this.tickCont(n, this.drn, dt);
  }

  private thump(n: Graph, t: number, rate: number, g: number): void {
    const src = n.ctx.createBufferSource();
    src.buffer = n.thump;
    src.playbackRate.value = rate;
    const gn = n.k.gain(g);
    src.connect(gn);
    gn.connect(n.heartG);
    src.onended = () => {
      src.disconnect();
      gn.disconnect();
    };
    src.start(t);
  }

  private applyWhoosh(n: Graph, now: number): void {
    const k = n.k;
    const lv = this.whoosh;
    const wob = wander(now * 9, 40);
    k.set(n.whooshF.frequency, 480 + 900 * lv + 120 * wob, 0.08);
    k.set(n.whooshG.gain, 0.5 * lv, 0.08);
    k.set(n.whooshMd.gain, 0.2 * lv, 0.08);
    k.set(n.whooshF2.frequency, 2200 + 1600 * lv + 300 * wob, 0.08);
    k.set(n.whooshG2.gain, 0.16 * lv * lv, 0.08);
  }

  /** Clac métallique : transitoire, résonances courtes, coup dans le fût. */
  private clack(n: Graph, t: number, g: number, f0: number): void {
    const k = n.k;
    const f = f0 * rnd(0.95, 1.05);
    k.burst(n.sfx, t, { type: 'highpass', f: 2800, a: 0.0003, d: 0.016, g: 0.3 * g, pan: 0.15 });
    k.burst(n.sfx, t, { f: f * 1.6, q: 1.6, a: 0.0005, d: 0.045, g: 0.3 * g, pan: 0.15 });
    k.ring(n.sfx, t, f, [[1, 0.06, 1], [1.83, 0.045, 0.7], [2.71, 0.035, 0.5], [3.94, 0.022, 0.3]], 0.07 * g);
    k.tone(n.sfx, t, { f: 210, f1: 130, d: 0.05, g: 0.2 * g });
  }

  private ricochet(n: Graph, o: AudioNode, t: number): void {
    const k = n.k;
    const f = rnd(2800, 4200);
    const d = rnd(0.5, 0.85);
    const f1 = f * rnd(0.25, 0.4);
    k.tone(o, t, { type: 'triangle', f, f1, ft: d, a: 0.012, d, g: 0.22 });
    k.tone(o, t, { type: 'sine', f: f * 1.013, f1: f1 * 1.03, ft: d, a: 0.012, d, g: 0.14 });
    k.burst(o, t, { f, f1, q: 6, a: 0.01, d, g: 0.25 });
  }

  // ---- spatialisation ---------------------------------------------------------------------------

  private locate(x: number, y: number, z: number): Loc {
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-3) return { pan: 0, dist: 0, front: 1 };
    // droite = avant × haut(+Y) = (-fz, 0, fx)
    let rx = -this.fz;
    let rz = this.fx;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-4) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    return {
      pan: clamp((dx * rx + dz * rz) / dist, -1, 1),
      dist,
      front: clamp((dx * this.fx + dy * this.fy + dz * this.fz) / dist, -1, 1),
    };
  }

  /** Entrée d'un son lointain : loi de distance douce, passe-bas d'absorption, panoramique, envoi vallée. */
  private spatialOut(x: number, y: number, z: number, dur: number, o: SpatialOpts): GainNode {
    const n = this.n as Graph;
    const k = n.k;
    const loc = this.locate(x, y, z);
    const law = Math.max(o.floor ?? 0, 1 / (1 + loc.dist / o.ref));
    const inp = k.gain(o.g * law * (0.88 + 0.12 * loc.front));
    const cut = Math.max(o.lpMin ?? 1200, 18000 / (1 + loc.dist / 300)) * (loc.front < 0 ? 0.8 : 1);
    const lp = k.filter('lowpass', cut, 0.5);
    const pan = k.pan(loc.pan * 0.9);
    inp.connect(lp);
    lp.connect(pan);
    pan.connect(o.dest ?? n.world);
    if (o.rev) {
      const rv = k.gain(o.rev);
      lp.connect(rv);
      rv.connect(n.reverbIn);
      k.release(k.now + dur, inp, lp, pan, rv);
    } else {
      k.release(k.now + dur, inp, lp, pan);
    }
    return inp;
  }

  private applyListener(): void {
    const n = this.n;
    if (!n) return;
    const l = n.ctx.listener;
    if (l.positionX) {
      l.positionX.value = this.lx;
      l.positionY.value = this.ly;
      l.positionZ.value = this.lz;
      l.forwardX.value = this.fx;
      l.forwardY.value = this.fy;
      l.forwardZ.value = this.fz;
      // haut = +Y ; si l'on regarde presque à la verticale, on bascule pour rester non colinéaire
      const vertical = Math.abs(this.fy) > 0.999;
      l.upX.value = 0;
      l.upY.value = vertical ? 0 : 1;
      l.upZ.value = vertical ? 1 : 0;
    } else {
      const vertical = Math.abs(this.fy) > 0.999;
      l.setPosition(this.lx, this.ly, this.lz);
      l.setOrientation(this.fx, this.fy, this.fz, 0, vertical ? 0 : 1, vertical ? 1 : 0);
    }
  }

  // ---- voix continues ---------------------------------------------------------------------------

  private placeCont(n: Graph, c: Cont, x: number, y: number, z: number, level: number): void {
    if ([x, y, z].every(Number.isFinite)) {
      c.x = x;
      c.y = y;
      c.z = z;
    }
    c.level = level;
    this.applyCont(n, c);
  }

  private applyCont(n: Graph, c: Cont): void {
    const k = n.k;
    const loc = this.locate(c.x, c.y, c.z);
    // Moteurs lointains (véhicule, drone) : à plusieurs centaines de mètres ce n'est qu'un murmure.
    // L'ancienne loi (1 / (1 + d / 220), plancher 0,08) laissait un drone à 455 m au tiers de son niveau :
    // un bourdonnement permanent sur le site de tir. Ici ≈ −28 dB à 455 m, −35 dB à 800 m.
    const law = Math.max(0.004, 1 / Math.pow(1 + loc.dist / 40, 1.3));
    k.set(c.out.gain, c.level > 0 ? (0.45 + 0.55 * c.level) * law * (0.85 + 0.15 * loc.front) : 0, 0.25);
    k.set(c.pan.pan, loc.pan * 0.9, 0.15);
    k.set(c.lp.frequency, clamp(16000 / (1 + loc.dist / 250), 700, 12000), 0.3);
    if (c.level > 0) c.tune(c.level);
  }

  private tickCont(n: Graph, c: Cont | null, dt: number): Cont | null {
    if (!c) return null;
    this.applyCont(n, c); // le joueur tourne la tête même si la source ne bouge pas
    c.idle = c.level > 0 ? 0 : c.idle + dt;
    if (c.idle < 3) return c;
    for (const s of c.srcs) {
      try {
        s.stop();
      } catch {
        /* déjà arrêté */
      }
    }
    n.k.release(n.k.now, ...c.nodes);
    return null;
  }

  private contBase(n: Graph): { out: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode; pre: GainNode } {
    const k = n.k;
    const pre = k.gain(1);
    const lp = k.kfilter('lowpass', 4000, 0.5);
    const out = k.gain(0);
    const pan = k.pan(0);
    pre.connect(lp);
    lp.connect(out);
    out.connect(pan);
    pan.connect(n.ambBus);
    return { out, lp, pan, pre };
  }

  /** Diesel lointain : deux dents de scie graves filtrées + souffle brun, trémolo de cylindres. */
  private makeVehicle(n: Graph): Cont {
    const k = n.k;
    const ctx = n.ctx;
    const b = this.contBase(n);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    const g2 = k.gain(0.6);
    const tone = k.kfilter('lowpass', 240, 0.8);
    const trem = k.gain(0.7);
    const lfo = ctx.createOscillator();
    const ld = k.gain(0.3);
    lfo.connect(ld);
    ld.connect(trem.gain);
    const ns = k.loop('brown', 1);
    const nf = k.filter('lowpass', 140, 0.6);
    const ng = k.gain(0.9);
    const mix = k.gain(0.55);
    o1.connect(tone);
    o2.connect(g2);
    g2.connect(tone);
    tone.connect(trem);
    ns.connect(nf);
    nf.connect(ng);
    ng.connect(trem);
    trem.connect(mix);
    mix.connect(b.pre);
    const tune = (lv: number): void => {
      const f = 36 + 30 * lv;
      k.set(o1.frequency, f, 0.3);
      k.set(o2.frequency, f * 1.503, 0.3);
      k.set(lfo.frequency, f / 4, 0.3);
      k.set(tone.frequency, 190 + 260 * lv, 0.3);
    };
    o1.frequency.value = 40;
    o2.frequency.value = 60;
    lfo.frequency.value = 10;
    o1.start();
    o2.start();
    lfo.start();
    return {
      nodes: [o1, o2, g2, tone, trem, lfo, ld, ns, nf, ng, mix, b.pre, b.lp, b.out, b.pan],
      srcs: [o1, o2, lfo, ns],
      out: b.out,
      lp: b.lp,
      pan: b.pan,
      idle: 0,
      level: 0,
      x: 0,
      y: 0,
      z: 0,
      tune,
    };
  }

  /** Drone : quatuor de rotors (dents de scie désaccordées 180–220 Hz) avec modulation d'amplitude. */
  private makeDrone(n: Graph): Cont {
    const k = n.k;
    const ctx = n.ctx;
    const b = this.contBase(n);
    const base = [183, 197, 208, 221];
    const oscs: OscillatorNode[] = [];
    const mix = k.gain(0.2);
    const am = k.gain(0.75);
    const l1 = ctx.createOscillator();
    l1.frequency.value = 27;
    const d1 = k.gain(0.25);
    const l2 = ctx.createOscillator();
    l2.frequency.value = 3.7;
    const d2 = k.gain(0.15);
    l1.connect(d1);
    d1.connect(am.gain);
    l2.connect(d2);
    d2.connect(am.gain);
    const hp = k.filter('highpass', 260, 0.7);
    const pk = k.filter('peaking', 1900, 1);
    pk.gain.value = 8;
    for (const f of base) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(mix);
      o.start();
      oscs.push(o);
    }
    mix.connect(am);
    am.connect(hp);
    hp.connect(pk);
    pk.connect(b.pre);
    l1.start();
    l2.start();
    const tune = (lv: number): void => {
      const m = 0.92 + 0.2 * lv;
      for (let i = 0; i < oscs.length; i++) k.set(oscs[i].frequency, base[i] * m * (1 + 0.012 * wander(k.now * 4, 50 + i)), 0.2);
    };
    return {
      nodes: [...oscs, mix, am, l1, d1, l2, d2, hp, pk, b.pre, b.lp, b.out, b.pan],
      srcs: [...oscs, l1, l2],
      out: b.out,
      lp: b.lp,
      pan: b.pan,
      idle: 0,
      level: 0,
      x: 0,
      y: 0,
      z: 0,
      tune,
    };
  }
}
