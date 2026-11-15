// Son du coup de feu : paramètres dérivés des dix-sept fiches (src/audio/shot-params.ts), cuisson du tampon avec et
// sans enregistrement (src/audio/shot-bake.ts), lecture des fichiers (src/audio/samples.ts), écho des cartes.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FILES, SampleBank, parseWav, type Pcm, type SampleName } from '../src/audio/samples';
import { bakeShot } from '../src/audio/shot-bake';
import { SR, bq } from '../src/audio/shot-dsp';
import { DEFAULT_ECHO, MAX_ECHO_TAPS, echoPan, echoTaps, shotSound } from '../src/audio/shot-params';
import { WEAPONS, weaponById } from '../src/config/weapons';
import { ECHO as ECHO_AVANCE } from '../src/levels/avance/map';
import { ECHO as ECHO_FACILE } from '../src/levels/facile/map';
import { ECHO as ECHO_STANDARD } from '../src/levels/standard/map';

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
    expect(b.thump.gain / a.thump.gain).toBeGreaterThan(2);
    expect(a.rate - b.rate).toBeGreaterThan(0.12);
    expect(b.thump.tau).toBeGreaterThan(a.thump.tau * 1.3);
    expect(b.levelDb - a.levelDb).toBeGreaterThan(1.5);
    expect(b.side.gain).toBeGreaterThan(a.side.gain);
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
    expect(p.levelDb).toBeLessThan(S('22lr').levelDb - 5);
    expect(p.levelDb).toBeLessThan(S('308').levelDb - 18);
    expect(p.duck).toBeLessThan(0.05);
    expect(p.echoBoostDb).toBeLessThan(-6);
    // le .22 LR est subsonique lui aussi ; toutes les autres armes claquent
    expect(S('22lr').supersonic).toBe(false);
    for (const w of WEAPONS) if (w.id !== '22lr' && w.id !== '308sub') expect(shotSound(w).supersonic, w.id).toBe(true);
  });
});

describe('fichiers enregistrés', () => {
  it('sont tous des WAV PCM lisibles, pour moins de 300 Ko au total', () => {
    let total = 0;
    for (const name of Object.keys(SAMPLE_FILES) as SampleName[]) {
      const b = file(name);
      total += b.byteLength;
      const p = parseWav(b) as Pcm;
      expect(p, name).not.toBeNull();
      expect(p.data.length / p.sr).toBeGreaterThan(0.1);
      expect(p.data.length / p.sr).toBeLessThan(0.7);
      let pk = 0;
      for (let i = 0; i < p.data.length; i++) pk = Math.max(pk, Math.abs(p.data[i]));
      expect(pk).toBeGreaterThan(0.5);
      expect(pk).toBeLessThan(1);
    }
    expect(total).toBeLessThan(300 * 1024);
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
    expect(parseWav(file('magnum').slice(0, 9000))?.data.length).toBeGreaterThan(4000);
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

  it('élargit l’image stéréo derrière un frein de bouche', () => {
    const width = (id: string): number => {
      const b = bakeShot(S(id), attack(id));
      const side = new Float32Array(4800), mid = new Float32Array(4800);
      for (let i = 0; i < 4800; i++) { side[i] = b.l[i] - b.r[i]; mid[i] = b.l[i] + b.r[i]; }
      return rms(side) / rms(mid);
    };
    expect(width('65cm')).toBeGreaterThan(width('308') * 1.5);
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

  it('reste à un niveau crédible : aucun retour au-dessus de −30 dB, bien sous les −17 dB de la maquette', () => {
    for (const spec of [ECHO_FACILE, ECHO_STANDARD, ECHO_AVANCE, DEFAULT_ECHO]) for (const t of echoTaps(spec)) expect(t.db).toBeLessThan(-30);
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
