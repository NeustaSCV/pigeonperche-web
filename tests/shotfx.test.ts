// Intensité des effets du coup de feu par arme (src/world/shotfx-params.ts) : les dix-sept fiches.
import { describe, expect, it } from 'vitest';
import { WEAPONS, weaponById } from '../src/config/weapons';
import { dustAt, muzzleOf, recoilAt, shotEnergy, shotFxParams, veilAt, type ShotFxParams } from '../src/world/shotfx-params';

const P = (id: string, lite = false): ShotFxParams => shotFxParams(weaponById(id)!, lite);
/** grandeurs qui doivent croître avec la charge */
const SCALARS = ['energy', 'flame', 'glow', 'smoke', 'dust', 'recoil', 'scopeJump', 'veil', 'veilTau', 'scopeFlash', 'caseLen'] as const;

describe('effets du coup de feu : intensité par arme', () => {
  it('couvre les dix-sept armes, avec des valeurs finies et bornées', () => {
    expect(WEAPONS.length).toBe(17);
    for (const w of WEAPONS) {
      const p = shotFxParams(w);
      for (const k of SCALARS) expect(Number.isFinite(p[k]), `${w.id}.${k}`).toBe(true);
      expect(p.energy).toBeGreaterThanOrEqual(0);
      expect(p.energy).toBeLessThanOrEqual(1);
      expect(p.flame).toBeLessThanOrEqual(1.25);
      expect(p.veil).toBeLessThanOrEqual(0.9);
      expect(p.scopeJump).toBeGreaterThanOrEqual(1);
      expect(p.scopeJump).toBeLessThanOrEqual(1.25);
      expect(p.flameFrames).toBeLessThanOrEqual(2);
    }
  });

  it('est monotone avec la charge de poudre (hors modérateur)', () => {
    const ws = WEAPONS.filter((w) => !w.suppressed).sort((a, b) => a.chargeGr - b.chargeGr);
    for (let i = 1; i < ws.length; i++) {
      const a = shotFxParams(ws[i - 1]), b = shotFxParams(ws[i]);
      for (const k of SCALARS) expect(b[k], `${ws[i - 1].id} → ${ws[i].id} : ${k}`).toBeGreaterThanOrEqual(a[k]);
    }
    // et strictement plus fort d'un bout à l'autre de la gamme
    const lo = P('223'), mid = P('338lm'), hi = P('50bmg');
    for (const k of ['flame', 'dust', 'recoil', 'veil', 'scopeJump'] as const) {
      expect(mid[k]).toBeGreaterThan(lo[k]);
      expect(hi[k]).toBeGreaterThan(mid[k]);
    }
    expect(shotEnergy(1.2)).toBe(0);
    expect(shotEnergy(230)).toBeCloseTo(1, 9);
  });

  it('.22 LR : presque rien', () => {
    const p = P('22lr');
    expect(p.shape).toBe('none');
    expect(p.flame).toBe(0);
    expect(p.flameFrames).toBe(0);
    expect(p.glow).toBe(0);
    expect(p.dust).toBe(0);
    expect(p.dustCount).toBe(0);
    expect(p.veil).toBe(0);
    expect(p.scopeFlash).toBe(0);
    expect(p.scopeJump).toBe(1);
    expect(p.recoil).toBeLessThan(0.06);
    expect(p.smokeCount).toBeLessThanOrEqual(2);
    expect(dustAt(p, 0.2)).toBe(0);
  });

  it('.50 BMG : marqué', () => {
    const p = P('50bmg');
    expect(p.shape).toBe('tank');
    expect(p.flame).toBeCloseTo(1.25, 6);
    expect(p.flameFrames).toBe(2);
    expect(p.dust).toBeCloseTo(1, 6);
    expect(p.recoil).toBeCloseTo(1, 6);
    expect(p.scopeJump).toBeCloseTo(1.25, 6);
    expect(p.veil).toBeGreaterThan(0.8);
  });

  it('.308 subsonique modéré : ni flamme ni poussière notable, moins que le .308 en tout', () => {
    const sub = P('308sub'), full = P('308');
    expect(sub.muzzle).toBe('suppressor');
    expect(sub.shape).toBe('none');
    expect(sub.flame).toBe(0);
    expect(sub.glow).toBe(0);
    expect(sub.scopeFlash).toBe(0);
    expect(sub.dust).toBeLessThan(0.05);
    expect(sub.dustCount).toBeLessThanOrEqual(1);
    expect(sub.veil).toBeLessThan(0.01);
    expect(sub.scopeJump).toBe(1);
    for (const k of ['smoke', 'recoil', 'dust', 'veil'] as const) expect(sub[k]).toBeLessThan(full[k]);
  });

  it('la forme de la flamme suit la bouche de l’arme', () => {
    for (const w of WEAPONS) {
      const p = shotFxParams(w);
      const m = w.build!.muzzle;
      expect(p.muzzle, w.id).toBe(m);
      if (w.id === '22lr') continue; // canon nu, mais charge trop faible pour une flamme
      expect(p.shape, w.id).toBe(m === 'none' ? 'axial' : m === 'suppressor' ? 'none' : m === 'tank' ? 'tank' : 'side');
      expect(p.ports, w.id).toBe(m === 'brake3' ? 3 : m === 'brake2' || m === 'tank' ? 2 : 0);
    }
    expect(P('308').shape).toBe('axial');
    expect(P('338lm').shape).toBe('side');
    expect(P('338lm').ports).toBe(3);
    expect(P('338lm300').ports).toBe(2);
    expect(P('408ct').shape).toBe('tank');
  });

  it('sans description du modèle : repli sur `suppressed` puis `look.brake`', () => {
    expect(muzzleOf({ chargeGr: 40, suppressed: true, look: { brake: true }, build: { muzzle: 'brake3' } })).toBe('suppressor');
    expect(muzzleOf({ chargeGr: 40, suppressed: false, look: { brake: true } })).toBe('brake3');
    expect(muzzleOf({ chargeGr: 40, suppressed: false, look: { brake: false } })).toBe('none');
    expect(shotFxParams({ chargeGr: 90, suppressed: false, look: { brake: true } }).shape).toBe('side');
    expect(shotFxParams({ chargeGr: 43, suppressed: false, look: { brake: false } }).shape).toBe('axial');
    expect(shotFxParams({ chargeGr: 43, suppressed: true, look: { brake: false } }).shape).toBe('none');
  });

  it('poussière : entière au ras du sol (couché), nulle quand la bouche est haute', () => {
    for (const w of WEAPONS) {
      const p = shotFxParams(w);
      expect(dustAt(p, 0.25), w.id).toBeCloseTo(p.dust, 9);
      expect(dustAt(p, 2.2), w.id).toBe(0);
      if (p.energy < 0.6) expect(dustAt(p, 1.0), w.id).toBeLessThan(0.08);
      expect(dustAt(p, 0.5)).toBeLessThanOrEqual(dustAt(p, 0.25));
    }
    expect(dustAt(P('50bmg'), 0.25)).toBeGreaterThan(dustAt(P('308'), 0.25) * 1.5);
  });

  it('voile de lunette : bref pour les calibres standards, dissipé en moins d’une seconde pour tous', () => {
    for (const w of WEAPONS) {
      const p = shotFxParams(w);
      const d = dustAt(p, 0.25);
      expect(veilAt(p, 1, d), w.id).toBeLessThan(0.03);
      expect(veilAt(p, 0, d), w.id).toBe(0);
      // jamais plus dense sans poussière (accroupi) qu'avec (couché)
      for (const t of [0.02, 0.1, 0.3, 0.6]) expect(veilAt(p, t, 0)).toBeLessThanOrEqual(veilAt(p, t, d) + 1e-12);
      if (w.tier === 'standard') {
        // l'impact reste observable : jamais opaque, presque dissipé à 0,4 s
        for (let t = 0; t < 1; t += 0.01) expect(veilAt(p, t, d), w.id).toBeLessThan(0.45);
        expect(veilAt(p, 0.4, d), w.id).toBeLessThan(0.1);
      }
    }
    // très gros calibres : masque brièvement la cible
    expect(veilAt(P('50bmg'), 0.05, 1)).toBeGreaterThan(0.7);
    expect(veilAt(P('408ct'), 0.05, P('408ct').dust)).toBeGreaterThan(0.45);
    expect(veilAt(P('308'), 0.05, P('308').dust)).toBeLessThan(0.25);
  });

  it('version allégée (téléphone) : moins de particules, flamme d’une image, une seule vague de poussière, mêmes intensités visibles', () => {
    for (const w of WEAPONS) {
      const full = shotFxParams(w), lite = shotFxParams(w, true);
      expect(lite.lite).toBe(true);
      expect(lite.dustWaves, w.id).toBe(1);
      expect(lite.flameFrames, w.id).toBeLessThanOrEqual(1);
      expect(lite.smokeCount, w.id).toBeLessThanOrEqual(Math.ceil(full.smokeCount * 0.75));
      expect(lite.dustCount, w.id).toBeLessThanOrEqual(Math.ceil(full.dustCount * 0.75));
      for (const k of ['shape', 'ports', 'flame', 'glow', 'dust', 'recoil', 'scopeJump', 'veil', 'veilTau', 'scopeFlash'] as const) expect(lite[k], `${w.id}.${k}`).toBe(full[k]);
    }
    // budget de particules d'un tir de .50 BMG couché, version allégée : fumée + une vague de poussière
    const p = P('50bmg', true);
    expect(p.smokeCount + p.dustCount).toBeLessThanOrEqual(40);
  });

  it('recul : nul à l’image de la flamme, maximal vers 45 ms, éteint avant 0,7 s', () => {
    expect(recoilAt(0)).toEqual({ back: 0, hop: 0, body: 0 });
    expect(recoilAt(0.8)).toEqual({ back: 0, hop: 0, body: 0 });
    let best = 0, at = 0;
    for (let t = 0.001; t < 0.7; t += 0.001) {
      const r = recoilAt(t);
      expect(r.back).toBeGreaterThanOrEqual(0);
      expect(r.back).toBeLessThanOrEqual(1);
      expect(r.hop).toBeGreaterThanOrEqual(0);
      expect(Math.abs(r.body)).toBeLessThanOrEqual(1.01);
      if (r.back > best) { best = r.back; at = t; }
    }
    expect(best).toBeGreaterThan(0.9);
    expect(at).toBeGreaterThan(0.025);
    expect(at).toBeLessThan(0.07);
    expect(recoilAt(0.6).back).toBeLessThan(0.02);
  });
});
