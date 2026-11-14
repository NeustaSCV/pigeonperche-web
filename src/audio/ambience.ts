// Couches d'ambiance continues et événements aléatoires : vent, feuillage, oiseaux, insectes,
// et, si la carte les déclare (Landmarks) : rumeur d'un marché, cloche, sirène de la zone d'alerte.

import type { AmbienceState, Landmarks } from './types';
import { Kit, clamp, clamp01, makeInsectEnv, rnd, wander, type Host, type Note } from './synth';

interface WindBand {
  f: BiquadFilterNode;
  g: GainNode;
  md: GainNode;
  p: StereoPannerNode;
  side: number;
}

interface Perch {
  inp: GainNode;
  lp: BiquadFilterNode;
  pan: PannerNode;
  species: number;
  next: number;
  bout: number;
}

interface Insect {
  g: GainNode;
  base: number;
}

interface Siren {
  nodes: AudioNode[];
  srcs: AudioScheduledSourceNode[];
  out: GainNode;
  lp: BiquadFilterNode;
  pan: StereoPannerNode;
  idle: number;
}

const BELL: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 9, 0.55],
  [1, 7, 1],
  [1.19, 5.2, 0.7],
  [1.5, 3.6, 0.3],
  [2, 3.2, 0.6],
  [2.51, 2.1, 0.22],
  [3.01, 1.6, 0.18],
  [4.16, 1.0, 0.1],
];

export class Ambience {
  /** repères de la carte jouée ; vide tant que le niveau ne les a pas donnés : ni rumeur, ni cloche, ni sirène */
  landmarks: Landmarks = {};

  private rates: Array<[AudioBufferSourceNode, number]> = [];
  private carriers: Array<[OscillatorNode, number]> = [];

  private wLowF: BiquadFilterNode;
  private wLowG: GainNode;
  private wMid: WindBand[] = [];
  private wHiF: BiquadFilterNode;
  private wHiG: GainNode;
  private wHiP: StereoPannerNode;

  private trees: Array<{ f: BiquadFilterNode; g: GainNode; md: GainNode }> = [];
  private gustLag = 0;

  private insects: Insect[] = [];

  private mktG: GainNode;
  private mktLp: BiquadFilterNode;
  private mktPan: StereoPannerNode;

  private perches: Perch[] = [];
  private nextRaptor: number;
  private nextCrow: number;
  private nextBell: number;
  private siren: Siren | null = null;

  constructor(
    private k: Kit,
    private out: AudioNode,
    private rev: AudioNode,
    private host: Host,
  ) {
    const now = k.now;

    // ---- vent -------------------------------------------------------------------------------
    const lowS = this.src('brown', 1);
    this.wLowF = k.kfilter('lowpass', 160, 0.5);
    this.wLowG = k.gain(0);
    lowS.connect(this.wLowF);
    this.wLowF.connect(this.wLowG);
    this.wLowG.connect(out);

    for (const side of [-1, 1]) {
      const s = this.src('pink', side < 0 ? 1 : 0.91);
      const f = k.kfilter('bandpass', 500, 0.7);
      const g = k.gain(0);
      const p = k.pan(side * 0.6);
      const m = this.src('mod', side < 0 ? 0.11 : 0.137);
      const md = k.gain(0);
      m.connect(md);
      md.connect(g.gain);
      s.connect(f);
      f.connect(g);
      g.connect(p);
      p.connect(out);
      this.wMid.push({ f, g, md, p, side });
    }

    const hiS = this.src('pink', 1.13);
    this.wHiF = k.kfilter('bandpass', 1800, 3);
    this.wHiG = k.gain(0);
    this.wHiP = k.pan(0);
    hiS.connect(this.wHiF);
    this.wHiF.connect(this.wHiG);
    this.wHiG.connect(this.wHiP);
    this.wHiP.connect(out);

    // ---- feuillage --------------------------------------------------------------------------
    for (const side of [-1, 1]) {
      const s = this.src('white', side < 0 ? 1 : 0.87);
      const hp = k.filter('highpass', 1900, 0.5);
      const f = k.kfilter('bandpass', 4800, 0.6);
      const g = k.gain(0);
      const p = k.pan(side * 0.55);
      const m = this.src('mod', side < 0 ? 0.61 : 0.47);
      const md = k.gain(0);
      m.connect(md);
      md.connect(g.gain);
      s.connect(hp);
      hp.connect(f);
      f.connect(g);
      g.connect(p);
      p.connect(out);
      this.trees.push({ f, g, md });
    }

    // ---- insectes ---------------------------------------------------------------------------
    const insect = (carrier: AudioNode, kind: 'chirp' | 'trill' | 'rasp', secs: number, pan: number, base: number): void => {
      const am = k.gain(0);
      const env = k.loop(makeInsectEnv(k.ctx, kind, secs), 1);
      this.rates.push([env, 1]);
      env.connect(am.gain);
      const g = k.gain(0);
      const p = k.pan(pan);
      carrier.connect(am);
      am.connect(g);
      g.connect(p);
      p.connect(out);
      this.insects.push({ g, base });
    };
    const osc = (f: number): OscillatorNode => {
      const o = k.ctx.createOscillator();
      o.frequency.value = f;
      o.start();
      this.carriers.push([o, f]);
      return o;
    };
    insect(osc(4620), 'chirp', 7.3, -0.45, 0.02);
    insect(osc(4180), 'chirp', 9.1, 0.7, 0.012);
    insect(osc(3150), 'trill', 11.3, 0.3, 0.012);
    const raspS = this.src('white', 1);
    const raspF = k.filter('bandpass', 8200, 2);
    raspS.connect(raspF);
    insect(raspF, 'rasp', 13.7, -0.75, 0.035);

    // ---- rumeur du marché -------------------------------------------------------------------
    const mS = this.src('pink', 0.97);
    const sum = k.gain(1);
    const formants: Array<[number, number, number]> = [
      [430, 2.2, 0.41],
      [880, 2.6, 0.53],
      [1650, 2.2, 0.33],
    ];
    for (const [f, q, rate] of formants) {
      const bp = k.filter('bandpass', f, q);
      const g = k.gain(0.5);
      const m = this.src('mod', rate);
      const md = k.gain(0.5);
      m.connect(md);
      md.connect(g.gain);
      mS.connect(bp);
      bp.connect(g);
      g.connect(sum);
    }
    this.mktLp = k.kfilter('lowpass', 1500, 0.5);
    this.mktG = k.gain(0);
    this.mktPan = k.pan(0);
    sum.connect(this.mktLp);
    this.mktLp.connect(this.mktG);
    this.mktG.connect(this.mktPan);
    this.mktPan.connect(out);

    // ---- perchoirs d'oiseaux (HRTF, alloués une fois) ---------------------------------------
    for (let i = 0; i < 5; i++) {
      const inp = k.gain(0.3);
      const lp = k.filter('lowpass', 9000, 0.5);
      const pan = k.ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'linear';
      pan.rolloffFactor = 0;
      const rv = k.gain(0.12);
      inp.connect(lp);
      lp.connect(pan);
      pan.connect(out);
      inp.connect(rv);
      rv.connect(rev);
      const p: Perch = { inp, lp, pan, species: i, next: now + rnd(1.5, 4) + i * rnd(1.5, 3.5), bout: 0 };
      this.perches.push(p);
      this.place(p);
    }
    this.nextRaptor = now + rnd(25, 70);
    this.nextCrow = now + rnd(14, 45);
    this.nextBell = now + rnd(40, 90);
  }

  private src(kind: 'white' | 'pink' | 'brown' | 'mod', rate: number): AudioBufferSourceNode {
    const s = this.k.loop(kind, rate);
    this.rates.push([s, rate]);
    return s;
  }

  // --------------------------------------------------------------------------------------------

  tick(dt: number, s: AmbienceState, now: number, pitch: number): void {
    const k = this.k;
    const w = clamp01(s.windSpeed / 14);
    const gust = clamp01(s.gust);
    const wide = s.menu ? 1.3 : 1;

    // hauteur globale (ralenti)
    for (const [src, base] of this.rates) k.set(src.playbackRate, base * pitch, 0.3);
    for (const [o, f] of this.carriers) k.set(o.frequency, f * pitch, 0.3);

    // vent
    k.set(this.wLowF.frequency, 110 + 250 * w + 50 * wander(now, 0), 0.4);
    k.set(this.wLowG.gain, (0.05 + 0.3 * Math.pow(w, 1.2)) * (1 + 0.3 * gust) * wide, 0.3);
    for (let i = 0; i < this.wMid.length; i++) {
      const b = this.wMid[i];
      const lvl = (0.07 + 0.6 * Math.pow(w, 1.3)) * (1 + 0.6 * gust) * (1 + 0.3 * wander(now, 1 + i)) * wide;
      k.set(b.f.frequency, 380 + 650 * w + 250 * gust + 140 * wander(now, 3 + i), 0.4);
      k.set(b.g.gain, lvl, 0.25);
      k.set(b.md.gain, lvl * 0.35, 0.25);
      k.set(b.p.pan, clamp(b.side * (s.menu ? 0.85 : 0.6) + 0.25 * wander(now, 5 + i), -1, 1), 0.5);
    }
    k.set(this.wHiF.frequency, 1300 + 1700 * w + 500 * gust + 350 * wander(now, 8), 0.35);
    k.set(this.wHiF.Q, 2.5 + 3 * gust, 0.4);
    k.set(this.wHiG.gain, 0.9 * w * w * (0.25 + 0.75 * gust) * (1 + 0.5 * wander(now, 7)) * wide, 0.3);
    k.set(this.wHiP.pan, 0.7 * wander(now, 9), 0.6);

    // feuillage : suit la rafale avec un léger retard
    this.gustLag += (gust - this.gustLag) * (1 - Math.exp(-dt / 0.9));
    const tp = clamp01(s.treeProximity);
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const lvl = tp * (0.03 + 0.2 * Math.pow(this.gustLag, 1.2) + 0.07 * w) * (1 + 0.25 * wander(now, 11 + i)) * wide;
      k.set(t.f.frequency, 4300 + 1800 * this.gustLag + 500 * wander(now, 13 + i), 0.4);
      k.set(t.g.gain, lvl, 0.3);
      k.set(t.md.gain, lvl * 0.6, 0.3);
    }

    // insectes : discrets, masqués par le vent
    for (let i = 0; i < this.insects.length; i++) {
      const ins = this.insects[i];
      const act = clamp01(0.55 + 0.9 * wander(now * 0.6, 20 + i));
      k.set(ins.g.gain, ins.base * 3 * act * (1 - 0.7 * w) * wide, 1.2);
    }

    // marché : seulement sur une carte qui a un village
    const v = this.landmarks.village;
    if (v) {
      const loc = this.host.locate(v[0], v[1], v[2]);
      const act = clamp01(s.marketActivity);
      k.set(this.mktG.gain, act * 0.3 * (1 / (1 + loc.dist / 500)) * (1 + 0.35 * wander(now, 30)) * (0.75 + 0.25 * loc.front), 0.8);
      k.set(this.mktPan.pan, loc.pan * 0.8, 0.3);
      k.set(this.mktLp.frequency, clamp(9000 / (1 + loc.dist / 200), 900, 5000), 0.5);
    } else k.set(this.mktG.gain, 0, 0.8);

    // oiseaux
    const calm = 1 + 2.5 * w * w;
    for (const p of this.perches) {
      if (now < p.next) continue;
      if (p.bout <= 0) {
        if (Math.random() < 0.45) this.place(p);
        p.bout = 2 + Math.floor(Math.random() * 5);
      }
      const end = this.sing(p, now + 0.05);
      p.bout--;
      p.next = end + this.gap(p.species) * calm + (p.bout <= 0 ? rnd(10, 45) * calm : 0);
    }
    if (now >= this.nextRaptor) {
      this.nextRaptor = now + rnd(60, 160);
      this.raptor(now + 0.05);
    }
    if (now >= this.nextCrow) {
      this.nextCrow = now + rnd(45, 120);
      this.crow(now + 0.05);
    }
    if (now >= this.nextBell) {
      this.nextBell = now + rnd(120, 240);
      // cloche : celle que la carte déclare, à défaut celle du village ; `bell: null` ou pas de village : silence
      const bell = this.landmarks.bell === undefined ? this.landmarks.village : this.landmarks.bell;
      if (bell) this.bell(now + 0.05, bell, this.landmarks.bell ? 0 : 15);
    }

    this.tickSiren(dt, s.alarm, now);
  }

  // ---- oiseaux ---------------------------------------------------------------------------------

  private place(p: Perch): void {
    const far = p.species === 4;
    const d = far ? rnd(120, 150) : rnd(20, 150);
    const a = Math.random() * Math.PI * 2;
    const x = this.host.lx + Math.cos(a) * d;
    const y = this.host.ly + rnd(2, 22);
    const z = this.host.lz + Math.sin(a) * d;
    const pn = p.pan;
    if (pn.positionX) {
      pn.positionX.value = x;
      pn.positionY.value = y;
      pn.positionZ.value = z;
    } else {
      pn.setPosition(x, y, z);
    }
    p.inp.gain.value = (far ? 0.5 : 0.26) / (1 + d / 60);
    p.lp.frequency.value = clamp(15000 / (1 + d / 110), 2500, 12000);
  }

  private gap(species: number): number {
    switch (species) {
      case 0:
        return rnd(2.5, 6);
      case 1:
        return rnd(4, 9);
      case 2:
        return rnd(2, 5);
      case 3:
        return rnd(1.5, 4.5);
      default:
        return rnd(5, 10);
    }
  }

  private sing(p: Perch, t0: number): number {
    const k = this.k;
    const n: Note[] = [];
    let t = 0;
    switch (p.species) {
      case 0: {
        // mésange : motif à deux tons répété
        const f = rnd(4200, 5200);
        const reps = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < reps; i++) {
          n.push({ t, d: 0.085, f0: f, f1: f * 0.98, g: 1 });
          t += 0.12;
          n.push({ t, d: 0.1, f0: f * 0.76, f1: f * 0.74, g: 0.9 });
          t += 0.17;
        }
        return k.notes(p.inp, t0, n, 'sine', 0.8);
      }
      case 1: {
        // trille descendant qui accélère, terminé par une fioriture
        const f = rnd(5600, 6400);
        const cnt = 10 + Math.floor(Math.random() * 12);
        for (let i = 0; i < cnt; i++) {
          const f0 = f * (1 - (0.28 * i) / cnt);
          n.push({ t, d: 0.04, f0, f1: f0 * 0.8, g: 0.6 + (0.4 * i) / cnt });
          t += 0.09 - (0.04 * i) / cnt;
        }
        n.push({ t, d: 0.12, f0: 3000, f1: 4300, g: 1 });
        t += 0.13;
        n.push({ t, d: 0.1, f0: 4300, f1: 2600, g: 0.9 });
        return k.notes(p.inp, t0, n, 'sine', 0.7);
      }
      case 2: {
        // merle : phrase flûtée, notes glissées, petit gazouillis final
        const cnt = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < cnt; i++) {
          const d = rnd(0.14, 0.32);
          const f0 = rnd(1700, 3200);
          n.push({ t, d, f0, f1: f0 * rnd(0.8, 1.25), g: rnd(0.7, 1) });
          t += d + rnd(0.03, 0.1);
        }
        const tw = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < tw; i++) {
          const f0 = rnd(5000, 6500);
          n.push({ t, d: 0.05, f0, f1: f0 * rnd(0.85, 1.15), g: 0.35 });
          t += 0.075;
        }
        return k.notes(p.inp, t0, n, 'sine', 1, { rate: rnd(22, 30), depth: 45 });
      }
      case 3: {
        // pinson / moineau : pépiements brefs
        const cnt = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < cnt; i++) {
          const f0 = rnd(5000, 5900);
          n.push({ t, d: 0.06, f0, f1: rnd(2800, 3400), g: rnd(0.7, 1) });
          t += rnd(0.14, 0.28);
        }
        return k.notes(p.inp, t0, n, 'sine', 0.7);
      }
      default: {
        // coucou lointain
        const reps = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < reps; i++) {
          n.push({ t, d: 0.22, f0: 685, f1: 668, g: 1 });
          n.push({ t: t + 0.36, d: 0.34, f0: 545, f1: 528, g: 0.9 });
          t += 1.25;
        }
        return k.notes(p.inp, t0, n, 'triangle', 0.9);
      }
    }
  }

  private sky(dMin: number, dMax: number, hMin: number, hMax: number): [number, number, number] {
    const d = rnd(dMin, dMax);
    const a = Math.random() * Math.PI * 2;
    return [this.host.lx + Math.cos(a) * d, this.host.ly + rnd(hMin, hMax), this.host.lz + Math.sin(a) * d];
  }

  private raptor(t: number): void {
    const k = this.k;
    const [x, y, z] = this.sky(280, 600, 60, 200);
    const o = this.host.spatialOut(x, y, z, 4, { g: 0.8, ref: 350, rev: 0.7, dest: this.out, lpMin: 2600 });
    const bp = k.filter('bandpass', 2300, 2.2);
    bp.connect(o);
    k.release(t + 4, bp);
    const n: Note[] = [];
    const cries = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < cries; i++) n.push({ t: i * 1.7, d: rnd(0.8, 1.05), f0: rnd(2550, 2750), f1: rnd(1650, 1800), g: 1 - i * 0.2 });
    k.notes(bp, t, n, 'sawtooth', 0.5, { rate: 8, depth: 35 });
  }

  private crow(t: number): void {
    const k = this.k;
    const [x, y, z] = this.sky(140, 420, 10, 60);
    const o = this.host.spatialOut(x, y, z, 3, { g: 0.7, ref: 300, rev: 0.4, dest: this.out, lpMin: 2200 });
    const bp = k.filter('bandpass', 1450, 1.3);
    bp.connect(o);
    k.release(t + 3, bp);
    const n: Note[] = [];
    const cnt = 2 + Math.floor(Math.random() * 3);
    let tt = 0;
    for (let i = 0; i < cnt; i++) {
      const f0 = rnd(520, 590);
      n.push({ t: tt, d: 0.26, f0, f1: f0 * 0.78, g: rnd(0.8, 1) });
      tt += rnd(0.38, 0.5);
    }
    k.notes(bp, t, n, 'sawtooth', 0.6, { rate: rnd(68, 82), depth: 90 });
  }

  // ---- cloche ----------------------------------------------------------------------------------

  /** `up` : hauteur du clocher au-dessus du repère (le repère du village est au sol, celui de la cloche est la cloche) */
  private bell(t: number, v: [number, number, number], up: number): void {
    const k = this.k;
    const strikes = 1 + Math.floor(Math.random() * 4);
    const o = this.host.spatialOut(v[0], v[1] + up, v[2], strikes * 2.7 + 10, {
      g: 0.45,
      ref: 500,
      rev: 0.5,
      dest: this.out,
      lpMin: 1800,
      floor: 0.15,
    });
    for (let i = 0; i < strikes; i++) {
      const ts = t + i * 2.7 + rnd(-0.03, 0.03);
      k.ring(o, ts, 311, BELL, 0.4);
      k.burst(o, ts, { n: 'pink', f: 1300, q: 0.9, a: 0.002, d: 0.06, g: 0.25 });
    }
  }

  // ---- sirène ----------------------------------------------------------------------------------

  private tickSiren(dt: number, on: boolean, now: number): void {
    const k = this.k;
    // sirène : à l'endroit que la carte désigne ; sans repère, pas de sirène
    const c = this.landmarks.camp;
    if (on && !this.siren && c) this.siren = this.makeSiren();
    const s = this.siren;
    if (!s) return;
    if (!c) on = false;
    const loc = c ? this.host.locate(c[0], c[1], c[2]) : { dist: 1e5, pan: 0 };
    k.set(s.out.gain, on ? 0.4 * Math.max(0.12, 1 / (1 + loc.dist / 400)) : 0, on ? 0.4 : 0.8);
    k.set(s.pan.pan, loc.pan * 0.85, 0.3);
    k.set(s.lp.frequency, clamp(14000 / (1 + loc.dist / 300), 1500, 9000), 0.5);
    s.idle = on ? 0 : s.idle + dt;
    if (s.idle > 6) {
      for (const src of s.srcs) {
        try {
          src.stop();
        } catch {
          /* déjà arrêté */
        }
      }
      k.release(now, ...s.nodes);
      this.siren = null;
    }
  }

  private makeSiren(): Siren {
    const k = this.k;
    const ctx = k.ctx;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 720;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 720;
    o2.detune.value = 9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.31;
    const depth = k.gain(210);
    lfo.connect(depth);
    depth.connect(o1.frequency);
    depth.connect(o2.frequency);
    const mix = k.gain(0.5);
    const g2 = k.gain(0.35);
    const bp = k.filter('bandpass', 950, 0.9);
    const lp = k.kfilter('lowpass', 4000, 0.5);
    const out = k.gain(0);
    const pan = k.pan(0);
    const rv = k.gain(0.5);
    o1.connect(mix);
    o2.connect(g2);
    g2.connect(mix);
    mix.connect(bp);
    bp.connect(lp);
    lp.connect(out);
    out.connect(pan);
    pan.connect(this.out);
    out.connect(rv);
    rv.connect(this.rev);
    o1.start();
    o2.start();
    lfo.start();
    return { nodes: [o1, o2, lfo, depth, mix, g2, bp, lp, out, pan, rv], srcs: [o1, o2, lfo], out, lp, pan, idle: 0 };
  }
}
