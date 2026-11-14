// Briques de synthèse partagées par le moteur audio : tampons de bruit, réponses impulsionnelles,
// primitives « one-shot » (rafale de bruit filtré, ton glissé, partiels, phrase de notes).

export type NoiseKind = 'white' | 'pink' | 'brown';

export interface Buffers {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  /** Signal aléatoire lisse et périodique dans [-1, 1], utilisé comme modulateur lent. */
  mod: AudioBuffer;
}

export interface Loc {
  /** -1 (gauche) .. 1 (droite). */
  pan: number;
  dist: number;
  /** 1 devant, -1 derrière. */
  front: number;
}

export interface SpatialOpts {
  g: number;
  /** Distance de référence de la loi douce : gain = 1 / (1 + d / ref). */
  ref: number;
  rev?: number;
  dest?: AudioNode;
  lpMin?: number;
  floor?: number;
}

/** Services que le moteur fournit aux couches (ambiance). */
export interface Host {
  lx: number;
  ly: number;
  lz: number;
  locate(x: number, y: number, z: number): Loc;
  spatialOut(x: number, y: number, z: number, dur: number, o: SpatialOpts): GainNode;
}

export interface BurstOpts {
  n?: NoiseKind;
  type?: BiquadFilterType;
  f: number;
  f1?: number;
  q?: number;
  /** Attaque (s). */
  a?: number;
  /** Tenue (s). */
  h?: number;
  /** Décroissance jusqu'à -60 dB (s). */
  d: number;
  g: number;
  rate?: number;
  pan?: number;
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  f1?: number;
  /** Durée du glissé (par défaut toute la note). */
  ft?: number;
  a?: number;
  h?: number;
  d: number;
  g: number;
  pan?: number;
}

export interface Note {
  t: number;
  d: number;
  f0: number;
  f1: number;
  g: number;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const finite = (v: number, d: number): number => (Number.isFinite(v) ? v : d);

/** Dérive lente déterministe dans [-1, 1] (somme de sinus de périodes incommensurables). */
export function wander(t: number, k: number): number {
  return (
    (Math.sin(t * 0.131 * (1 + k * 0.37) + k * 12.9) +
      Math.sin(t * 0.0717 * (1 + k * 0.21) + k * 4.1) +
      Math.sin(t * 0.311 * (1 + k * 0.13) + k * 7.7)) /
    3
  );
}

/** Rend un tampon bouclable sans clic : fond la fin (au-delà de n) dans le début. */
function seamless(raw: Float32Array, n: number, fade: number, out: Float32Array): void {
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    let v = raw[i];
    if (i < fade) {
      const a = i / fade;
      v = v * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
    }
    out[i] = v;
    const m = Math.abs(v);
    if (m > peak) peak = m;
  }
  const s = 0.95 / peak;
  for (let i = 0; i < n; i++) out[i] *= s;
}

export function makeBuffers(ctx: BaseAudioContext): Buffers {
  const sr = ctx.sampleRate;
  const fade = Math.floor(sr * 0.25);
  const mk = (seconds: number, gen: (raw: Float32Array) => void): AudioBuffer => {
    const n = Math.floor(sr * seconds);
    const raw = new Float32Array(n + fade);
    gen(raw);
    const b = ctx.createBuffer(1, n, sr);
    seamless(raw, n, fade, b.getChannelData(0));
    return b;
  };
  const white = mk(4.3, (r) => {
    for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1;
  });
  const pink = mk(6.7, (r) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < r.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      r[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  });
  const brown = mk(7.9, (r) => {
    let last = 0;
    for (let i = 0; i < r.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      r[i] = last;
    }
  });

  // Modulateur : 256 points aléatoires sur 16 s, interpolation cosinus, périodique. Basse fréquence d'échantillonnage.
  const msr = 8000;
  const secs = 16;
  const pts = 256;
  const ctl = new Float32Array(pts);
  for (let i = 0; i < pts; i++) ctl[i] = Math.random() * 2 - 1;
  const mod = ctx.createBuffer(1, msr * secs, msr);
  const md = mod.getChannelData(0);
  for (let i = 0; i < md.length; i++) {
    const x = (i / md.length) * pts;
    const i0 = Math.floor(x);
    const fr = x - i0;
    const a = ctl[i0 % pts];
    const b = ctl[(i0 + 1) % pts];
    const c = (1 - Math.cos(fr * Math.PI)) * 0.5;
    md[i] = a + (b - a) * c;
  }
  return { white, pink, brown, mod };
}

/** Réponse impulsionnelle de vallée : longue, sombre, diffuse, stéréo décorrélée. */
export function makeValleyIR(ctx: BaseAudioContext, seconds = 5.2): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    let lp2 = 0;
    const pre = Math.floor(sr * (0.035 + ch * 0.007));
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      // montée diffuse lente, puis double décroissance (proche + roulement lointain)
      const env = (1 - Math.exp(-t / 0.11)) * (0.75 * Math.exp(-t / 0.55) + 0.25 * Math.exp(-t / 1.5));
      // assombrissement progressif : coupure de ~4,5 kHz vers ~450 Hz
      const fc = 450 + 4000 * Math.exp(-t / 0.9);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (Math.random() * 2 - 1 - lp);
      lp2 += a * (lp - lp2);
      const fadeOut = Math.min(1, (n - i) / (sr * 0.6));
      d[i] = lp2 * env * fadeOut;
    }
  }
  return ir;
}

/** Courte RI mono qui « étale » un écho discret (réflexion sur un versant, pas sur un mur). */
export function makeSmearIR(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.42);
  const ir = ctx.createBuffer(1, n, sr);
  const d = ir.getChannelData(0);
  let lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 2600) / sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    lp += a * (Math.random() * 2 - 1 - lp);
    d[i] = lp * (1 - Math.exp(-t / 0.012)) * Math.exp(-t / 0.075);
  }
  return ir;
}

/** Double coup sourd du cœur (un seul « thump » ; le second est rejoué plus aigu et plus faible). */
export function makeThump(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.26);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 40 + 36 * Math.exp(-t / 0.035);
    ph += (2 * Math.PI * f) / sr;
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.045) * Math.min(1, (n - i) / (sr * 0.02));
    d[i] = (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.18 * Math.sin(3 * ph)) * env * 0.7;
  }
  return b;
}

/** Enveloppe de stridulation pré-calculée (8 kHz), lue en boucle comme modulateur d'amplitude. */
export function makeInsectEnv(ctx: BaseAudioContext, kind: 'chirp' | 'trill' | 'rasp', seconds: number): AudioBuffer {
  const sr = 8000;
  const n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const pulse = (t: number, len: number, amp: number): void => {
    const i0 = Math.floor(t * sr);
    const m = Math.floor(len * sr);
    for (let i = 0; i < m; i++) {
      const j = i0 + i;
      if (j >= n) return;
      const s = Math.sin((i / m) * Math.PI);
      d[j] = Math.max(d[j], s * s * amp);
    }
  };
  let t = 0.1;
  if (kind === 'chirp') {
    while (t < seconds - 0.4) {
      if (Math.random() < 0.13) t += rnd(0.6, 1.8);
      const np = Math.random() < 0.3 ? 4 : 3;
      for (let p = 0; p < np && t + p * 0.031 < seconds - 0.05; p++) pulse(t + p * 0.031, 0.017, 0.55 + (0.45 * (p + 1)) / np);
      t += rnd(0.36, 0.5);
    }
  } else if (kind === 'trill') {
    while (t < seconds - 0.5) {
      const len = Math.min(rnd(1.4, 3.8), seconds - 0.3 - t);
      const per = 1 / rnd(40, 47);
      for (let x = 0; x < len; x += per) {
        const shape = Math.min(1, x / 0.4, (len - x) / 0.3);
        pulse(t + x, per * 0.55, Math.max(0, shape));
      }
      t += len + rnd(0.8, 2.6);
    }
  } else {
    while (t < seconds - 1.6) {
      const len = rnd(0.7, 1.4);
      const per = 1 / rnd(24, 30);
      for (let x = 0; x < len; x += per) pulse(t + x, per * 0.6, 0.2 + (0.8 * x) / len);
      t += len + rnd(2.2, 5);
    }
  }
  return b;
}

export class Kit {
  private last = new WeakMap<AudioParam, number>();
  private warned = 0;

  constructor(
    readonly ctx: AudioContext,
    readonly buf: Buffers,
  ) {}

  get now(): number {
    return this.ctx.currentTime;
  }

  warn(e: unknown): void {
    if (this.warned++ < 12) console.warn('[audio]', e);
  }

  gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = this.hz(f);
    b.Q.value = q;
    return b;
  }

  /** Filtre permanent dont les paramètres sont pilotés en k-rate (coefficients recalculés une fois par bloc). */
  kfilter(type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const b = this.filter(type, f, q);
    try {
      b.frequency.automationRate = 'k-rate';
      b.Q.automationRate = 'k-rate';
    } catch {
      /* non pris en charge : sans importance */
    }
    return b;
  }

  pan(p: number): StereoPannerNode {
    const n = this.ctx.createStereoPanner();
    n.pan.value = clamp(p, -1, 1);
    return n;
  }

  hz(f: number): number {
    return clamp(finite(f, 440), 12, this.ctx.sampleRate * 0.45);
  }

  /** Source en boucle permanente, démarrée à un décalage aléatoire. */
  loop(kind: keyof Buffers | AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const b = typeof kind === 'string' ? this.buf[kind] : kind;
    s.buffer = b;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * b.duration * 0.98);
    return s;
  }

  /** Cible lissée, sans réémettre d'événement d'automation si la valeur n'a pas bougé. */
  set(p: AudioParam, v: number, tc = 0.1): void {
    if (!Number.isFinite(v)) return;
    const prev = this.last.get(p);
    if (prev !== undefined && Math.abs(v - prev) <= 1e-5 + Math.abs(prev) * 0.004) return;
    this.last.set(p, v);
    p.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  /** Déconnecte les nœuds éphémères une fois le son terminé. */
  release(tEnd: number, ...nodes: AudioNode[]): void {
    const ms = Math.max(0, tEnd - this.ctx.currentTime) * 1000 + 200;
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* déjà déconnecté */
        }
      }
    }, ms);
  }

  /** Rafale de bruit filtré avec enveloppe attaque / tenue / décroissance. Retourne l'instant de fin. */
  burst(dest: AudioNode, t: number, o: BurstOpts): number {
    const ctx = this.ctx;
    t = Math.max(t, ctx.currentTime);
    const a = Math.max(0.0002, o.a ?? 0.001);
    const h = o.h ?? 0;
    const d = Math.max(0.004, o.d);
    const g = Math.max(1e-5, finite(o.g, 0));
    const end = t + a + h + d;
    const b = this.buf[o.n ?? 'white'];
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 1;
    const f = this.filter(o.type ?? 'bandpass', o.f, o.q ?? 0.707);
    if (o.f1 !== undefined) {
      f.frequency.setValueAtTime(this.hz(o.f), t);
      f.frequency.exponentialRampToValueAtTime(this.hz(o.f1), t + a + h + d * 0.7);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + a);
    if (h > 0) env.gain.setValueAtTime(g, t + a + h);
    env.gain.exponentialRampToValueAtTime(g * 0.001, end);
    src.connect(f);
    f.connect(env);
    if (o.pan !== undefined) {
      const p = this.pan(o.pan);
      env.connect(p);
      p.connect(dest);
      this.release(end, src, f, env, p);
    } else {
      env.connect(dest);
      this.release(end, src, f, env);
    }
    src.start(t, Math.random() * b.duration * 0.95);
    src.stop(end + 0.03);
    return end;
  }

  /** Ton (oscillateur) avec glissé de hauteur optionnel. Retourne l'instant de fin. */
  tone(dest: AudioNode, t: number, o: ToneOpts): number {
    const ctx = this.ctx;
    t = Math.max(t, ctx.currentTime);
    const a = Math.max(0.0005, o.a ?? 0.002);
    const h = o.h ?? 0;
    const d = Math.max(0.004, o.d);
    const g = Math.max(1e-5, finite(o.g, 0));
    const end = t + a + h + d;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(this.hz(o.f), t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(this.hz(o.f1), t + (o.ft ?? a + h + d));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + a);
    if (h > 0) env.gain.setValueAtTime(g, t + a + h);
    env.gain.exponentialRampToValueAtTime(g * 0.001, end);
    osc.connect(env);
    if (o.pan !== undefined) {
      const p = this.pan(o.pan);
      env.connect(p);
      p.connect(dest);
      this.release(end, osc, env, p);
    } else {
      env.connect(dest);
      this.release(end, osc, env);
    }
    osc.start(t);
    osc.stop(end + 0.03);
    return end;
  }

  /** Somme de partiels sinusoïdaux décroissants : [rapport, décroissance (s), amplitude]. */
  ring(dest: AudioNode, t: number, f0: number, parts: ReadonlyArray<readonly [number, number, number]>, g: number): number {
    const ctx = this.ctx;
    t = Math.max(t, ctx.currentTime);
    let end = t;
    const nyq = ctx.sampleRate * 0.45;
    for (const [ratio, decay, amp] of parts) {
      const f = f0 * ratio;
      const lvl = amp * g;
      if (f >= nyq || lvl < 1e-5) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(lvl, t + 0.0015);
      env.gain.exponentialRampToValueAtTime(lvl * 0.001, t + 0.0015 + decay);
      osc.connect(env);
      env.connect(dest);
      osc.start(t);
      osc.stop(t + decay + 0.03);
      this.release(t + decay, osc, env);
      if (t + decay > end) end = t + decay;
    }
    return end;
  }

  /** Phrase de notes non chevauchantes jouée par un seul oscillateur (chants d'oiseaux). */
  notes(
    dest: AudioNode,
    t0: number,
    notes: ReadonlyArray<Note>,
    type: OscillatorType,
    g: number,
    vib?: { rate: number; depth: number },
  ): number {
    const ctx = this.ctx;
    if (notes.length === 0) return t0;
    t0 = Math.max(t0, ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = type;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    let end = t0;
    for (const n of notes) {
      const t = t0 + n.t;
      const d = Math.max(0.01, n.d);
      const a = Math.min(0.015, d * 0.3);
      const lvl = Math.max(1e-5, n.g * g);
      osc.frequency.setValueAtTime(this.hz(n.f0), t);
      osc.frequency.exponentialRampToValueAtTime(this.hz(n.f1), t + d);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(lvl, t + a);
      env.gain.setValueAtTime(lvl, t + d * 0.6);
      env.gain.linearRampToValueAtTime(0, t + d);
      end = t + d;
    }
    osc.connect(env);
    env.connect(dest);
    osc.start(t0);
    osc.stop(end + 0.03);
    if (vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vib.rate;
      const dg = this.gain(vib.depth);
      lfo.connect(dg);
      dg.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(end + 0.03);
      this.release(end, osc, env, lfo, dg);
    } else {
      this.release(end, osc, env);
    }
    return end;
  }
}
