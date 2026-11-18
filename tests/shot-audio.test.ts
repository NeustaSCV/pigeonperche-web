// Son du coup de feu : paramètres dérivés des dix-sept fiches (src/audio/shot-params.ts), cuisson du tampon avec et
// sans enregistrement (src/audio/shot-bake.ts), lecture des fichiers (src/audio/samples.ts), écho des cartes.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { SAMPLE_FILES, SampleBank, parseWav, type Pcm, type SampleName } from '../src/audio/samples';
import { bakeShot } from '../src/audio/shot-bake';
import { SR, bq } from '../src/audio/shot-dsp';
import { DEFAULT_ECHO, MAX_ECHO_TAPS, echoPan, echoTaps, shotSound } from '../src/audio/shot-params';
import { Kit } from '../src/audio/synth';
import { WEAPONS, weaponById } from '../src/config/weapons';
import { ECHO as ECHO_AVANCE } from '../src/levels/avance/map';
import { ECHO as ECHO_FACILE } from '../src/levels/facile/map';
import { ECHO as ECHO_STANDARD } from '../src/levels/standard/map';
import { DIVERSION_COUNT, OnlineSounds, SOUND_SPEED, VOICE_COUNT, chime, chimes, dryShot, farShot, farShotKey, farVoice, turretTick, whip } from '../src/online/sounds';

const DIR = join('public', 'assets', 'audio');
const file = (name: SampleName): ArrayBuffer => {
  const b = readFileSync(join(DIR, SAMPLE_FILES[name]));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const S = (id: string) => shotSound(weaponById(id));
/** hiérarchie demandée : .22 LR < .223 < 6,5 < .308 < .300 < .338 < CheyTac < .50 */
const LADDER = ['22lr', '223', '65cm', '308', '300wm', '338lm', '408ct', '50bmg'];
const rms = (x: Float32Array): number => { let a = 0; for (let i = 0; i < x.length; i++) a += x[i] * x[i]; return Math.sqrt(a / x.length); };
const dB = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12));
/** énergie du grave (sous 120 Hz) du tampon cuit, dB */
const bass = (x: Float32Array): number => dB(rms(bq(bq(x, 'lowpass', 120, 0.7), 'lowpass', 120, 0.7).subarray(0, Math.round(0.4 * SR))));

describe('paramètres sonores dérivés des fiches', () => {
  it('couvre les dix-sept armes avec des valeurs finies', () => {
    expect(WEAPONS.length).toBe(17);
    for (const w of WEAPONS) {
      const p = shotSound(w);
      for (const v of [p.energyJ, p.s, p.power, p.rate, p.blastT, p.level, p.levelDb, p.drive, p.tailK, p.tailDb, p.echoBoostDb, p.duck, p.thump.f0, p.thump.f1, p.thump.tau, p.thump.gain, p.body.gain, p.side.gain]) {
        expect(Number.isFinite(v), w.id).toBe(true);
      }
      expect(p.power).toBeGreaterThanOrEqual(0);
      expect(p.power).toBeLessThanOrEqual(1);
      expect(p.level).toBeLessThanOrEqual(1.08);
      expect(p.rate).toBeGreaterThanOrEqual(0.8);
      expect(p.rate).toBeLessThanOrEqual(1.06);
    }
  });

  it('respecte la hiérarchie .22 LR < .223 < 6,5 < .308 < .300 < .338 < CheyTac < .50', () => {
    for (let i = 1; i < LADDER.length; i++) {
      const a = S(LADDER[i - 1]), b = S(LADDER[i]);
      const tag = `${LADDER[i - 1]} → ${LADDER[i]}`;
      expect(b.power, tag).toBeGreaterThan(a.power);
      expect(b.energyJ, tag).toBeGreaterThan(a.energyJ);
      expect(b.levelDb, tag).toBeGreaterThan(a.levelDb);
      expect(b.thump.gain, tag).toBeGreaterThan(a.thump.gain);
      expect(b.tailK, tag).toBeGreaterThan(a.tailK);
      expect(b.duck, tag).toBeGreaterThanOrEqual(a.duck);
    }
  });

  it('classe toutes les armes sans modérateur par puissance : niveau, queue et grave croissants', () => {
    const ws = WEAPONS.filter((w) => !w.suppressed).map(shotSound).sort((a, b) => a.power - b.power);
    expect(ws[0].id).toBe('22lr');
    expect(ws[ws.length - 1].id).toBe('50bmg');
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i].tailK).toBeGreaterThanOrEqual(ws[i - 1].tailK);
      expect(ws[i].thump.f0).toBeLessThanOrEqual(ws[i - 1].thump.f0 + 6);
      // un frein ajoute 0,3 à 0,6 dB : l'ordre des niveaux suit la puissance à cette marge près
      expect(ws[i].levelDb).toBeGreaterThan(ws[i - 1].levelDb - 0.65);
    }
  });

  it('donne à chaque arme un tir distinct', () => {
    const sig = WEAPONS.map((w) => { const p = shotSound(w); return [p.attack, p.rate.toFixed(4), p.thump.gain.toFixed(4), p.levelDb.toFixed(3), p.side.gain, p.tailK.toFixed(4)].join('|'); });
    expect(new Set(sig).size).toBe(17);
  });

  it('sépare nettement le .338 du .50 (ils sortaient presque identiques)', () => {
    const a = S('338lm'), b = S('50bmg');
    expect(a.attack).toBe('magnum');
    expect(b.attack).toBe('magnum');
    // dosages de la maquette : le .50 est lu trois demi-tons plus bas, avec près de deux fois plus de coup sourd
    expect(b.thump.gain / a.thump.gain).toBeGreaterThan(1.6);
    expect(a.rate - b.rate).toBeGreaterThan(0.12);
    expect(b.thump.tau).toBeGreaterThan(a.thump.tau * 1.1);
    expect(b.tailK).toBeGreaterThan(a.tailK * 1.1);
    expect(b.tailDb).toBeGreaterThan(a.tailDb + 1);
  });

  it('lit la bouche dans build.muzzle : frein, canon nu, modérateur', () => {
    expect(S('308').brake).toBe(false);
    expect(S('308').side.gain).toBe(0);
    expect(S('338lm').muzzle).toBe('brake3');
    expect(S('338lm300').muzzle).toBe('brake2');
    expect(S('338lm').side.gain).toBeGreaterThan(S('338lm300').side.gain);
    expect(S('50bmg').muzzle).toBe('tank');
    // sans `build`, repli sur l'ancienne description (look.brake)
    expect(shotSound({ id: 'x', bulletGr: 175, v0: 790, chargeGr: 43, suppressed: false, look: { brake: true } }).muzzle).toBe('brake3');
  });

  it('garde le .308 subsonique modéré discret et sans bang supersonique', () => {
    const p = S('308sub');
    expect(p.suppressed).toBe(true);
    expect(p.supersonic).toBe(false);
    expect(p.attack).toBe('suppressed');
    expect(p.thump.gain).toBe(0);
    expect(p.side.gain).toBe(0);
    // le plus discret de tous (−10,7 dB de crête dans la maquette), avec une queue et des échos 8 dB plus bas
    for (const w of WEAPONS) if (w.id !== '308sub') expect(p.levelDb, w.id).toBeLessThan(shotSound(w).levelDb - 2.5);
    expect(p.levelDb).toBeLessThan(S('308').levelDb - 9);
    expect(p.duck).toBeLessThan(0.05);
    expect(p.echoBoostDb).toBeLessThan(-6);
    // le .22 LR est subsonique lui aussi ; toutes les autres armes claquent
    expect(S('22lr').supersonic).toBe(false);
    for (const w of WEAPONS) if (w.id !== '22lr' && w.id !== '308sub') expect(shotSound(w).supersonic, w.id).toBe(true);
  });
});

describe('fichiers enregistrés', () => {
  it('sont tous des WAV PCM lisibles, pour moins de 450 Ko au total', () => {
    let total = 0;
    for (const name of Object.keys(SAMPLE_FILES) as SampleName[]) {
      const b = file(name);
      total += b.byteLength;
      const p = parseWav(b) as Pcm;
      expect(p, name).not.toBeNull();
      expect(p.data.length / p.sr).toBeGreaterThan(0.1);
      expect(p.data.length / p.sr).toBeLessThan(0.7);
      // les attaques de tir sont stéréo (deux micros espacés : la largeur du tir vient de là), la mécanique mono
      expect(!!p.l && !!p.r, name).toBe(['small', 'intermediate', 'medium', 'magnum', 'suppressed'].includes(name));
      let pk = 0;
      for (const c of p.l && p.r ? [p.l, p.r] : [p.data]) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
      expect(pk).toBeGreaterThan(0.5);
      expect(pk).toBeLessThan(1);
    }
    expect(total).toBeLessThan(450 * 1024);
    // rien d'autre n'est embarqué dans le dossier
    expect(readdirSync(DIR).filter((f) => !f.startsWith('.')).sort()).toEqual(Object.values(SAMPLE_FILES).slice().sort());
  });

  it('refuse ce qui n’est pas un WAV PCM 16 bits (page HTML d’un serveur, fichier tronqué, vide)', () => {
    const html = new TextEncoder().encode('<!doctype html><html><head><title>Pigeon perché</title></head><body></body></html>').buffer as ArrayBuffer;
    expect(parseWav(html)).toBeNull();
    expect(parseWav(new ArrayBuffer(0))).toBeNull();
    expect(parseWav(file('magnum').slice(0, 40))).toBeNull();
    expect(parseWav(file('magnum').slice(0, 60))).toBeNull();
    const float = file('magnum').slice(0);
    new DataView(float).setUint16(20, 3, true); // format flottant annoncé
    expect(parseWav(float)).toBeNull();
    // tronqué au milieu des données : ce qui reste est lu, sans exception
    expect(parseWav(file('magnum').slice(0, 9000))?.data.length).toBeGreaterThan(2000);
  });
});

describe('repli sans fichier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ne lève rien et ne charge rien quand le réseau échoue, répond 404 ou renvoie autre chose', async () => {
    for (const impl of [
      () => Promise.reject(new Error('hors ligne')),
      () => Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
      () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new TextEncoder().encode('<!doctype html>').buffer) }),
      () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.reject(new Error('coupé')) }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(impl));
      const bank = new SampleBank();
      const seen: string[] = [];
      bank.load('assets/audio/', (n) => seen.push(n));
      await new Promise((r) => setTimeout(r, 5));
      expect(seen).toEqual([]);
      for (const name of Object.keys(SAMPLE_FILES) as SampleName[]) expect(bank.get(name)).toBeNull();
    }
  });

  it('charge chaque fichier une seule fois et prévient à son arrivée', async () => {
    const f = vi.fn((url: string) => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(file((Object.keys(SAMPLE_FILES) as SampleName[]).find((k) => url.endsWith(SAMPLE_FILES[k])) as SampleName)) }));
    vi.stubGlobal('fetch', f);
    const bank = new SampleBank();
    const seen: string[] = [];
    bank.load('base/', (n) => seen.push(n));
    bank.load('base/', (n) => seen.push(n));
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(Object.keys(SAMPLE_FILES).length);
    expect(seen.sort()).toEqual(Object.keys(SAMPLE_FILES).sort());
    expect(bank.get('magnum')?.sr).toBe(48000);
  });

  it('cuit sans enregistrement un tir synthétisé pour chacune des dix-sept armes : ni silence, ni écrêtage', () => {
    for (const w of WEAPONS) {
      const b = bakeShot(shotSound(w), null);
      expect(b.recorded).toBe(false);
      let pk = 0, finite = true;
      for (let i = 0; i < b.l.length; i++) {
        if (!Number.isFinite(b.l[i]) || !Number.isFinite(b.r[i])) finite = false;
        pk = Math.max(pk, Math.abs(b.l[i]), Math.abs(b.r[i]));
      }
      expect(finite, w.id).toBe(true);
      expect(pk, w.id).toBeGreaterThan(0.5);
      expect(pk, w.id).toBeLessThan(1);
      expect(b.ref, w.id).toBeGreaterThan(0.05);
      // la détonation part dans les trois premiers millièmes de seconde
      let first = 0;
      while (Math.abs(b.l[first]) < 0.1 * pk) first++;
      expect(first / SR, w.id).toBeLessThan(0.003);
    }
  });
});

describe('tampon cuit, hybride et repli', () => {
  const attack = (id: string): Pcm => parseWav(file(shotSound(weaponById(id)).attack)) as Pcm;

  it('part de l’enregistrement quand il est là, et reste reproductible', () => {
    const a = bakeShot(S('308'), attack('308'));
    const b = bakeShot(S('308'), attack('308'));
    expect(a.recorded).toBe(true);
    expect(Array.from(a.l.subarray(0, 2000))).toEqual(Array.from(b.l.subarray(0, 2000)));
    expect(a.l.length).toBe(a.r.length);
  });

  it('donne au .50 bien plus de grave qu’au .338, avec la même attaque comme sans fichier', () => {
    for (const rec of [true, false]) {
      const a = bakeShot(S('338lm'), rec ? attack('338lm') : null);
      const b = bakeShot(S('50bmg'), rec ? attack('50bmg') : null);
      expect(bass(b.l) - bass(a.l), rec ? 'hybride' : 'repli').toBeGreaterThan(4);
    }
  });

  it('fait croître le grave du tampon le long de la hiérarchie', () => {
    let prev = -Infinity;
    for (const id of LADDER) {
      const v = bass(bakeShot(S(id), attack(id)).l);
      expect(v, id).toBeGreaterThan(prev);
      prev = v;
    }
  });

  const width = (id: string, rec: boolean): number => {
    const b = bakeShot(S(id), rec ? attack(id) : null);
    const side = new Float32Array(4800), mid = new Float32Array(4800);
    for (let i = 0; i < 4800; i++) { side[i] = b.l[i] - b.r[i]; mid[i] = b.l[i] + b.r[i]; }
    return rms(side) / rms(mid);
  };

  it('garde la largeur stéréo de l’enregistrement (les deux micros de la prise), comme la maquette', () => {
    for (const id of ['223', '308', '338lm', '50bmg']) expect(width(id, true), id).toBeGreaterThan(0.4);
  });

  it('sans fichier, élargit l’image stéréo derrière un frein de bouche', () => {
    expect(width('65cm', false)).toBeGreaterThan(width('308', false) * 1.2);
  });

  it('cuit la queue et un écho par relief de la carte, aux niveaux de la maquette', () => {
    const b = bakeShot(S('308'), attack('308'), ECHO_STANDARD);
    expect(b.echoes.length).toBe(echoTaps(ECHO_STANDARD).length);
    for (let i = 1; i < b.echoes.length; i++) expect(b.echoes[i].delay).toBeGreaterThan(b.echoes[i - 1].delay);
    const win = (x: Float32Array, a: number, z: number): number => dB(rms(x.subarray(Math.round(a * SR), Math.round(z * SR))));
    // queue diffuse : 20 à 32 dB sous les cinq premières millisecondes, entre 100 et 300 ms (maquette : −22 dB)
    const tail = win(b.l, 0.1, 0.3) - win(b.l, 0, 0.005);
    expect(tail).toBeGreaterThan(-32);
    expect(tail).toBeLessThan(-14);
    // premier écho (versant à 450 m) : audible, 10 à 30 dB sous la détonation
    const e = b.echoes[0].data;
    let pk = 0;
    for (let i = 0; i < e.length; i++) pk = Math.max(pk, Math.abs(e[i]));
    expect(dB(pk)).toBeGreaterThan(-30);
    expect(dB(pk)).toBeLessThan(-8);
    // carte ouverte : moins de queue
    const o = bakeShot(S('308'), attack('308'), ECHO_AVANCE);
    expect(win(o.l, 0.3, 0.6)).toBeLessThan(win(b.l, 0.3, 0.6) - 6);
  });
});

describe('écho des cartes', () => {
  it('place chaque retour à 2 × distance / 343 s, du plus proche au plus lointain', () => {
    for (const spec of [ECHO_FACILE, ECHO_STANDARD, ECHO_AVANCE, DEFAULT_ECHO]) {
      const taps = echoTaps(spec);
      expect(taps.length).toBeGreaterThan(0);
      expect(taps.length).toBeLessThanOrEqual(MAX_ECHO_TAPS);
      const ds = spec.reliefs.map((r) => (2 * r.distance) / 343).sort((a, b) => a - b);
      taps.forEach((t, i) => expect(t.delay).toBeCloseTo(ds[i], 6));
      for (let i = 1; i < taps.length; i++) expect(taps[i].lowpass).toBeLessThan(taps[i - 1].lowpass);
    }
    expect(echoTaps(undefined)).toEqual(echoTaps(DEFAULT_ECHO));
    expect(echoTaps({ reliefs: [] })).toEqual([]);
  });

  it('reprend le niveau de la maquette : versant de taille 0,6 à 230 m à −17 dB, −9 dB par doublement de distance', () => {
    const [t] = echoTaps({ reliefs: [{ distance: 230, bearing: 0, size: 0.6 }] });
    expect(t.db).toBeCloseTo(-17, 6);
    expect(echoTaps({ reliefs: [{ distance: 460, bearing: 0, size: 0.6 }] })[0].db).toBeCloseTo(-26, 6);
    for (const spec of [ECHO_FACILE, ECHO_STANDARD, ECHO_AVANCE, DEFAULT_ECHO]) for (const x of echoTaps(spec)) expect(x.db).toBeLessThan(-17);
    // chaque carte a au moins un retour audible, sauf le plateau ouvert du niveau avancé
    for (const spec of [ECHO_FACILE, ECHO_STANDARD, DEFAULT_ECHO]) expect(Math.max(...echoTaps(spec).map((x) => x.db))).toBeGreaterThan(-30);
  });

  it('est plus présent dans la vallée du niveau standard que sur le plateau du niveau avancé', () => {
    const best = (s: typeof ECHO_STANDARD): number => Math.max(...echoTaps(s).map((t) => t.db));
    const sum = (s: typeof ECHO_STANDARD): number => 10 * Math.log10(echoTaps(s).reduce((a, t) => a + t.gain * t.gain, 0));
    expect(best(ECHO_STANDARD) - best(ECHO_AVANCE)).toBeGreaterThan(10);
    expect(sum(ECHO_STANDARD) - sum(ECHO_AVANCE)).toBeGreaterThan(10);
    expect(best(ECHO_STANDARD)).toBeGreaterThan(best(ECHO_FACILE));
    expect(ECHO_STANDARD.tail).toBeGreaterThan(ECHO_FACILE.tail);
    expect(ECHO_FACILE.tail).toBeGreaterThan(ECHO_AVANCE.tail);
  });

  it('garde l’écho du côté de son relief quand le joueur tourne la tête', () => {
    // relief à l'est (azimut 90) ; nord = −Z, est = +X
    expect(echoPan(90, 0, -1)).toBeGreaterThan(0.8); // face au nord : à droite
    expect(echoPan(90, 0, 1)).toBeLessThan(-0.8); // face au sud : à gauche
    expect(Math.abs(echoPan(90, 1, 0))).toBeLessThan(1e-9); // face à l'est : devant
    expect(echoPan(90, 0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Mode en ligne : `AudioEngine.playBuffer`, accès au tir cuit, recettes de src/online/sounds.ts
// ---------------------------------------------------------------------------------------------------------------

/** Doublure du graphe audio : nœuds qui notent leurs branchements, sources qui notent leur instant de départ. */
function fakeEngine(state = 'running') {
  const started: any[] = [];
  const node = (kind: string, extra: object = {}): any => {
    const n: any = { kind, to: [] as any[], connect(d: any) { n.to.push(d); }, disconnect() { n.to.length = 0; }, ...extra };
    return n;
  };
  const ctx: any = {
    state, currentTime: 12.5, sampleRate: 48000,
    createBuffer(ch: number, len: number, sr: number) {
      const d = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: (c: number) => d[c] };
    },
    createBufferSource() { const s = node('source', { buffer: null, start(t: number) { s.at = t; started.push(s); } }); return s; },
    createGain: () => node('gain', { gain: { value: 1 } }),
    createStereoPanner: () => node('pan', { pan: { value: 0 } }),
  };
  const graph = { ctx, k: new Kit(ctx, {} as any), sfx: node('sfx'), world: node('world'), ui: node('ui'), shotBus: node('shotBus') };
  const engine = new AudioEngine();
  (engine as any).n = graph;
  /** chaîne d'un son joué : source → gain → (panoramique) → bus */
  const chain = (s: any) => {
    const gain = s.to[0], next = gain.to[0];
    const pan = next.kind === 'pan' ? next : null;
    return { gain: gain.gain.value as number, pan: pan ? (pan.pan.value as number) : 0, bus: (pan ? pan.to[0] : next).kind as string, delay: s.at - ctx.currentTime, buffer: s.buffer };
  };
  return { engine, ctx, started, chain };
}

describe('AudioEngine.playBuffer', () => {
  const l = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 7)), r = Float32Array.from({ length: 480 }, (_, i) => Math.cos(i / 5));

  it('ne joue rien tant que le moteur n’est pas démarré, ou qu’il est suspendu', () => {
    expect(new AudioEngine().playBuffer(l, r)).toBe(false);
    const f = fakeEngine('suspended');
    expect(f.engine.playBuffer(l, r, { delay: 2 })).toBe(false);
    expect(f.started.length).toBe(0);
    const ok = fakeEngine();
    expect(ok.engine.playBuffer(new Float32Array(0), new Float32Array(0))).toBe(false);
    expect(ok.engine.playBuffer(l, r.subarray(0, 100))).toBe(false);
  });

  it('copie les deux voies dans un tampon à 48 kHz, et par défaut joue tout de suite, au centre, sur le bus du joueur', () => {
    const f = fakeEngine();
    expect(f.engine.playBuffer(l, r)).toBe(true);
    const c = f.chain(f.started[0]);
    expect(c.buffer.sampleRate).toBe(SR);
    expect(c.buffer.numberOfChannels).toBe(2);
    expect(Array.from(c.buffer.getChannelData(0))).toEqual(Array.from(l));
    expect(Array.from(c.buffer.getChannelData(1))).toEqual(Array.from(r));
    expect([c.delay, c.pan, c.gain, c.bus]).toEqual([0, 0, 1, 'sfx']);
  });

  it('applique le retard, le placement, le niveau et le bus demandés', () => {
    const f = fakeEngine();
    f.engine.playBuffer(l, r, { delay: 2.94, pan: -0.6, gain: 0.85, bus: 'shot' });
    f.engine.playBuffer(l, r, { delay: 0.5, pan: 0.3, bus: 'world' });
    f.engine.playBuffer(l, r, { bus: 'ui' });
    const [a, b, c] = f.started.map(f.chain);
    expect(a.delay).toBeCloseTo(2.94, 9);
    expect([a.pan, a.gain, a.bus]).toEqual([-0.6, 0.85, 'shotBus']);
    expect(b.delay).toBeCloseTo(0.5, 9);
    expect([b.pan, b.bus]).toEqual([0.3, 'world']);
    expect(c.bus).toBe('ui');
    // le même son rejoué ne recopie pas ses échantillons
    expect(b.buffer).toBe(a.buffer);
  });

  it('borne le placement et refuse un retard négatif ou invalide', () => {
    const f = fakeEngine();
    f.engine.playBuffer(l, r, { pan: 3, delay: -1 });
    f.engine.playBuffer(l, r, { pan: -7, delay: NaN });
    const [a, b] = f.started.map(f.chain);
    expect([a.pan, a.delay]).toEqual([1, 0]);
    expect([b.pan, b.delay]).toEqual([-1, 0]);
  });

  it('donne accès au tir cuit que joue shot(), sans changer l’arme du joueur', () => {
    const f = fakeEngine();
    const mine = weaponById('308'), other = weaponById('375ct');
    f.engine.prepareShot(mine);
    const b = f.engine.bakedShot(other);
    expect(b.sound.id).toBe('375ct');
    expect(b.l.length).toBe(b.r.length);
    expect(f.engine.bakedShot(other)).toBe(b);
    expect((f.engine as any).lastWeapon).toBe(mine);
  });
});

describe('sons du mode en ligne', () => {
  const VOIX = join('public', 'ville', 'voix');
  const voice = (i: number): Pcm => {
    const b = readFileSync(join(VOIX, `voix-${String(i).padStart(2, '0')}.wav`));
    return parseWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) as Pcm;
  };
  const pk = (x: Float32Array): number => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  /** part de l'énergie au-dessus de `f` Hz */
  const above = (x: Float32Array, f: number): number => rms(bq(bq(x, 'highpass', f, 0.7), 'highpass', f, 0.7)) / rms(x);
  const dry = dryShot(bakeShot(S('375ct'), parseWav(file('magnum'))));

  it('les dix voix sont là, lisibles, à la cadence des tampons', () => {
    expect(readdirSync(VOIX).filter((n) => n.endsWith('.wav')).length).toBe(VOICE_COUNT);
    for (let i = 1; i <= VOICE_COUNT; i++) {
      const p = voice(i);
      expect(p, `voix ${i}`).not.toBeNull();
      expect(p.sr).toBe(SR);
      expect(p.data.length / SR).toBeGreaterThan(0.3);
      expect(p.data.length / SR).toBeLessThan(1.2);
    }
  });

  it('tir lointain : niveau 28 / d (plein à moins de 28 m), aigu retiré par l’air, par tranche de 50 m', () => {
    expect(dry.length).toBe(Math.round(3.2 * SR));
    expect([farShotKey(0), farShotKey(60), farShotKey(1234), farShotKey(1976)]).toEqual([50, 50, 1250, 2000]);
    let prevHigh = Infinity;
    for (const d of [50, 200, 500, 1000, 2000]) {
      const s = farShot(dry, d);
      expect(s.l).toBe(s.r);
      expect(s.l.length).toBe(dry.length);
      expect(pk(s.l), `${d} m`).toBeCloseTo(Math.min(1, 28 / d), 5);
      const high = above(s.l, 1500);
      expect(high, `${d} m`).toBeLessThan(prevHigh);
      prevHigh = high;
      // fin en fondu : pas de claquement à la coupure
      expect(Math.abs(s.l[s.l.length - 1])).toBeLessThan(1e-4);
    }
  });

  it('balle qui passe : un tiers de seconde, d’une oreille à l’autre dans le sens du passage', () => {
    for (const dir of [1, -1]) {
      const w = whip(0.34, 600, 2800, 1.8, dir);
      expect(w.l.length / SR).toBeCloseTo(0.34, 3);
      const n = w.l.length, head = (x: Float32Array) => rms(x.subarray(0, n >> 1)), tail = (x: Float32Array) => rms(x.subarray(n >> 1));
      const from = dir > 0 ? w.l : w.r, to = dir > 0 ? w.r : w.l;
      expect(head(from)).toBeGreaterThan(head(to) * 1.5);
      // le souffle culmine à 45 % de sa durée, juste avant de passer au centre : la seconde moitié est moins tranchée
      expect(tail(to)).toBeGreaterThan(tail(from) * 1.2);
      expect(Math.max(pk(w.l), pk(w.r))).toBeLessThanOrEqual(1);
      expect(Math.max(pk(w.l), pk(w.r))).toBeGreaterThan(0.5);
    }
  });

  it('voix au loin : plus faible et plus sourde avec la distance, une petite réverbération et pas d’écho', () => {
    const v = voice(3).data;
    let prev = Infinity;
    for (const d of [100, 500, 1000, 2000]) {
      const s = farVoice(v, d);
      const p = Math.max(pk(s.l), pk(s.r));
      expect(p, `${d} m`).toBeCloseTo(Math.min(0.8, Math.sqrt(45 / d)), 5);
      expect(p).toBeLessThan(prev);
      prev = p;
      // la réverbération n'allonge la voix que de 0,5 à 0,7 s, et meurt : rien d'audible dans le dernier dixième de seconde
      const extra = s.l.length / SR - v.length / SR;
      expect(extra).toBeGreaterThanOrEqual(0.5);
      expect(extra).toBeLessThanOrEqual(0.71);
      expect(dB(rms(s.l.subarray(s.l.length - 4800)) / p)).toBeLessThan(-30);
      // pas d'écho : après la fin de la voix, le niveau ne remonte jamais (fenêtres de 50 ms)
      const start = v.length + 2400;
      let last = Infinity;
      for (let o = start; o + 2400 <= s.l.length; o += 2400) {
        const e = rms(s.l.subarray(o, o + 2400));
        expect(e, `${d} m, ${((o - v.length) / SR).toFixed(2)} s après la voix`).toBeLessThan(last * 1.25 + 1e-5);
        last = e;
      }
    }
    expect(above(farVoice(v, 2000).l, 3000)).toBeLessThan(above(farVoice(v, 100).l, 3000));
  });

  it('cran de tourelle et repères de manche : niveaux et durées de la maquette', () => {
    const t = turretTick();
    expect(pk(t.l)).toBeCloseTo(0.45, 5);
    expect(t.l.length / SR).toBeLessThan(0.04);
    expect(pk(chime(660, 0.07, 0.5))).toBeCloseTo(0.5, 5);
    expect(chime(660, 0.07, 0.5).length / SR).toBeCloseTo(0.35, 3);
    expect(pk(chime(990, 0.4, 0.8))).toBeCloseTo(0.8, 5);
    expect(chime(990, 0.4, 0.8).length / SR).toBeCloseTo(2, 3);
    const a = chimes([392, 523, 659], 0.16, 0.3), z = chimes([659, 523, 392], 0.2, 0.35);
    expect(a.l.length / SR).toBeCloseTo(1.68, 3);
    expect(z.l.length / SR).toBeCloseTo(1.8, 3);
    for (const s of [a, z]) { expect(pk(s.l)).toBeGreaterThan(0.5); expect(pk(s.l)).toBeLessThan(1.3); }
  });

  describe('lecture par le moteur du solo', () => {
    afterEach(() => vi.unstubAllGlobals());
    const withVoices = async () => {
      const f = fakeEngine();
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        const m = /(voix|pet)-(\d\d)\.wav$/.exec(url);
        // la voix 7 et le son de diversion 4 manquent : ils sont ignorés
        if (!m || (m[1] === 'voix' && m[2] === '07') || (m[1] === 'pet' && m[2] === '04')) return Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
        const b = readFileSync(m[1] === 'voix' ? join(VOIX, `voix-${m[2]}.wav`) : join(VOIX, '..', 'diversion', `pet-${m[2]}.wav`));
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
      }));
      const sounds = new OnlineSounds(f.engine, 'base/ville/voix/', 'base/ville/diversion/');
      await sounds.load();
      await sounds.load();
      return { f, sounds };
    };

    it('tir d’un autre : retardé de d / 340 s, du côté demandé, sans compresseur ; un rendu par tranche de 50 m', async () => {
      const f = fakeEngine();
      const sounds = new OnlineSounds(f.engine, 'x/');
      const w = weaponById('375ct');
      expect(SOUND_SPEED).toBe(340);
      expect(sounds.distantShot(w, 1000, -0.7)).toBe(true);
      expect(sounds.distantShot(w, 1010, 0.4)).toBe(true);
      expect(sounds.distantShot(w, 300, 0)).toBe(true);
      const [a, b, c] = f.started.map(f.chain);
      expect(a.delay).toBeCloseTo(1000 / 340, 9);
      expect([a.pan, a.gain, a.bus]).toEqual([-0.7, 1, 'shotBus']);
      expect(b.delay).toBeCloseTo(1010 / 340, 9);
      expect(b.buffer).toBe(a.buffer);
      expect(c.buffer).not.toBe(a.buffer);
      expect(pk(c.buffer.getChannelData(0))).toBeCloseTo(28 / 300, 5);
      expect(pk(a.buffer.getChannelData(0))).toBeCloseTo(28 / 1000, 5);
    });

    it('balle qui passe, cran, repères : joués tels quels ; rien si le moteur est suspendu', async () => {
      const f = fakeEngine();
      const sounds = new OnlineSounds(f.engine, 'x/');
      expect(sounds.bulletPass(1, 0.8)).toBe(true);
      expect(sounds.bulletPass(-1)).toBe(true);
      expect(sounds.turretClick() && sounds.roundStart() && sounds.roundEnd() && sounds.countdown() && sounds.countdown(true)).toBe(true);
      const all = f.started.map(f.chain);
      expect(all.length).toBe(7);
      expect(all[0].delay).toBeCloseTo(0.8, 9);
      expect(all[0].buffer).not.toBe(all[1].buffer);
      for (const c of all) expect([c.pan, c.gain, c.bus]).toEqual([0, 1, 'shotBus']);
      const off = fakeEngine('suspended');
      const mute = new OnlineSounds(off.engine, 'x/');
      expect(mute.turretClick() || mute.bulletPass(1) || mute.distantShot(weaponById('375ct'), 500, 0)).toBe(false);
      expect(off.started.length).toBe(0);
    });

    it('touche : l’une des voix chargées, toute proche pour soi (0,85), au loin pour sa propre touche ; muette sans voix', async () => {
      const none = new OnlineSounds(fakeEngine().engine, 'x/');
      expect(none.hitSelf()).toBe(false);
      expect(none.hitFar(800)).toBe(false);
      const { f, sounds } = await withVoices();
      expect((globalThis.fetch as any).mock.calls.length).toBe(VOICE_COUNT + DIVERSION_COUNT);
      expect((globalThis.fetch as any).mock.calls[0][0]).toBe('base/ville/voix/voix-01.wav');
      expect(sounds.voiceCount).toBe(VOICE_COUNT - 1);
      const seen = new Set<number>();
      for (let i = 0; i < 60; i++) { expect(sounds.hitSelf()).toBe(true); seen.add(f.chain(f.started[f.started.length - 1]).buffer.length); }
      expect(seen.size).toBeGreaterThan(4);
      const near = f.chain(f.started[0]);
      expect([near.delay, near.pan, near.gain, near.bus]).toEqual([0, 0, 0.85, 'shotBus']);
      expect(sounds.hitFar(900, 0.5)).toBe(true);
      const far = f.chain(f.started[f.started.length - 1]);
      expect([far.delay, far.pan, far.gain, far.bus]).toEqual([0, 0.5, 1, 'shotBus']);
      expect(pk(far.buffer.getChannelData(0))).toBeLessThanOrEqual(Math.sqrt(45 / 900) + 1e-6);
    });

    it('diversion : le son demandé, tout proche pour soi ; pour un autre, comme une voix au loin, retardé de d / 340 s', async () => {
      const none = new OnlineSounds(fakeEngine().engine, 'x/', 'y/');
      expect(none.diversionSelf(1)).toBe(false);
      expect(none.diversionFar(1, 500)).toBe(false);
      const { f, sounds } = await withVoices();
      expect((globalThis.fetch as any).mock.calls.some((c: any[]) => c[0] === 'base/ville/diversion/pet-05.wav')).toBe(true);
      const n0 = f.started.length;
      expect(sounds.diversionSelf(2)).toBe(true);
      const near = f.chain(f.started[n0]);
      expect([near.delay, near.pan, near.gain, near.bus]).toEqual([0, 0, 0.85, 'shotBus']);
      // le fichier 4 manque, le 6 n'existe pas : rien
      expect(sounds.diversionSelf(4) || sounds.diversionFar(4, 300) || sounds.diversionSelf(6) || sounds.diversionSelf(0)).toBe(false);
      expect(sounds.diversionFar(2, 680, -0.6)).toBe(true);
      const far = f.chain(f.started[f.started.length - 1]);
      expect(far.delay).toBeCloseTo(2, 9);
      expect([far.pan, far.gain, far.bus]).toEqual([-0.6, 1, 'shotBus']);
      // même traitement que les voix : plus long que le son d'origine (réverbération), niveau qui fond avec la distance
      expect(far.buffer.length).toBeGreaterThan(near.buffer.length);
      expect(pk(far.buffer.getChannelData(0))).toBeLessThanOrEqual(Math.sqrt(45 / 680) + 1e-6);
      // un autre numéro, un autre son
      expect(sounds.diversionSelf(1)).toBe(true);
      expect(f.chain(f.started[f.started.length - 1]).buffer.length).not.toBe(near.buffer.length);
    });
  });
});
