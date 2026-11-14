// Réticule de la lunette : géométrie en mrad (src/weapons/reticle-geometry.ts), règles de lisibilité, et accord
// avec la contre-visée que le jeu annonce (carnet de tir, ligne « Contre-visée », objectifs du niveau avancé).
import { describe, expect, it } from 'vitest';
import {
  AXIS_MIL, BAR_BOTTOM_START_MIL, BAR_MIL, BAR_START_MIL, CENTER_DOT_MIL, CENTER_GAP_MIL, DOT_MIL, FINE_MIL, LINE_MIL, RETICLE, TREE_MIL,
  reticleLod, treeHalfWidth, type Tick,
} from '../src/weapons/reticle-geometry';
import { RETICLE_HOLD_MIL } from '../src/config/weapons';

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const at = (axis: 'h' | 'v', v: number): Tick | undefined => RETICLE.ticks.find((t) => t.axis === axis && near(t.at, v));
const seq = (a: number, b: number, step: number): number[] => { const o: number[] = []; for (let i = Math.round(a / step); i <= Math.round(b / step); i++) o.push(Math.round(i * step * 1000) / 1000); return o; };

describe('réticule : proportions d’une gravure fine', () => {
  it('trait de 0,03 à 0,05 mrad, point central de 0,04 à 0,06 mrad au milieu d’une croix ouverte, barres épaisses hors de la zone graduée', () => {
    expect(LINE_MIL).toBeGreaterThanOrEqual(0.03);
    expect(LINE_MIL).toBeLessThanOrEqual(0.05);
    expect(CENTER_DOT_MIL).toBeGreaterThanOrEqual(0.04);
    expect(CENTER_DOT_MIL).toBeLessThanOrEqual(0.06);
    expect(CENTER_GAP_MIL).toBeGreaterThan(CENTER_DOT_MIL);
    expect(CENTER_GAP_MIL).toBeLessThan(0.2); // la première graduation (0,2 mrad) reste sur la branche
    expect(BAR_MIL).toBeGreaterThan(8 * LINE_MIL);
    expect(BAR_START_MIL).toBeGreaterThan(AXIS_MIL);
    expect(BAR_BOTTOM_START_MIL).toBeGreaterThan(TREE_MIL);
  });
});

describe('réticule : graduations', () => {
  it('chaque graduation tombe sur sa valeur : multiples exacts de 0,1 mrad, aucune en double, gauche et droite symétriques', () => {
    const seen = new Set<string>();
    for (const t of RETICLE.ticks) {
      expect(Math.abs(t.at * 10 - Math.round(t.at * 10)), `${t.axis} ${t.at}`).toBeLessThan(1e-9);
      const k = `${t.axis}:${t.at.toFixed(3)}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
      if (t.axis === 'h') { const m = at('h', -t.at)!; expect([m.from, m.to, m.pitch]).toEqual([t.from, t.to, t.pitch]); }
      else expect(t.from).toBe(-t.to); // graduations de la branche verticale centrées sur elle
    }
  });
  it('branche horizontale : mrad de 1 à 10 (trait long), demi-mrad (trait moyen), 0,2 mrad jusqu’à 4 mrad (trait court)', () => {
    for (const s of [-1, 1]) {
      const side = RETICLE.ticks.filter((t) => t.axis === 'h' && s * t.at > 0);
      const pos = (f: (t: Tick) => boolean) => side.filter(f).map((t) => Math.round(s * t.at * 10) / 10).sort((a, b) => a - b);
      expect(pos((t) => t.pitch >= 1)).toEqual(seq(1, 10, 1));
      expect(pos((t) => t.pitch === 0.5)).toEqual(seq(1, 10, 1).map((m) => m - 0.5));
      expect(pos((t) => t.pitch === 0.2)).toEqual(seq(0.2, 3.8, 0.2).filter((m) => !Number.isInteger(m)));
      expect(pos(() => true).at(-1)).toBe(AXIS_MIL);
    }
    expect(FINE_MIL).toBe(4);
    // trois longueurs distinctes, de la plus fine à la plus longue
    const len = (m: number) => { const t = at('h', m)!; return t.to - t.from; };
    expect(len(0.2)).toBeLessThan(len(0.5));
    expect(len(0.5)).toBeLessThan(len(1));
    // 0,2 mrad au-dessus du trait, demi-mrad dessous : deux traits voisins de 0,1 mrad ne se touchent jamais
    expect(at('h', 0.4)!.to).toBe(0);
    expect(at('h', 0.5)!.from).toBe(0);
  });
  it('branche haute : mrad et demi-mrad de 0,5 à 10 ; branche basse : de 0,5 à 24', () => {
    const v = (sign: number) => RETICLE.ticks.filter((t) => t.axis === 'v' && sign * t.at > 0).map((t) => sign * t.at).sort((a, b) => a - b);
    expect(v(-1)).toEqual(seq(0.5, 10, 0.5));
    expect(v(1)).toEqual(seq(0.5, 24, 0.5));
    for (const m of [1, 7, 24]) expect(at('v', m)!.to).toBeGreaterThan(at('v', m - 0.5)!.to);
  });
  it('pas d’un mrad pair : 2 ; impair : 1 (à faible grossissement, seuls les pairs restent)', () => {
    for (const m of seq(1, 10, 1)) expect(at('h', m)!.pitch).toBe(m % 2 === 0 ? 2 : 1);
    for (const m of seq(1, 24, 1)) expect(at('v', m)!.pitch).toBe(m % 2 === 0 ? 2 : 1);
  });
});

describe('réticule : arbre de contre-visée', () => {
  it('vingt-quatre lignes de chute, de 1 à 24 mrad : l’étendue annoncée par le jeu', () => {
    expect(TREE_MIL).toBe(24);
    expect(RETICLE_HOLD_MIL).toBe(TREE_MIL);
    expect([...new Set(RETICLE.dots.map((d) => d.y))]).toEqual(seq(1, 24, 1));
  });
  it('un point de dérive par mrad ; la ligne s’élargit avec la chute : 2, 2, 3, 3, 4, 4, 5, 5, puis 6 mrad de chaque côté', () => {
    expect(seq(1, 12, 1).map(treeHalfWidth)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6]);
    expect(treeHalfWidth(24)).toBe(6);
    for (let drop = 1; drop <= 24; drop++) {
      const row = RETICLE.dots.filter((d) => d.y === drop);
      const e = treeHalfWidth(drop);
      expect(row.map((d) => d.x).sort((a, b) => a - b)).toEqual([...seq(-e, -1, 1), ...seq(1, e, 1)]);
      for (const d of row) expect(d.d).toBe(DOT_MIL);
    }
    expect(DOT_MIL).toBeLessThan(0.1); // points fins : ils ne masquent pas une plaque lointaine
  });
});

describe('réticule : chiffres', () => {
  it('branches horizontales et haute : pairs de 2 à 10, à l’aplomb de leur graduation', () => {
    for (const s of [-1, 1]) {
      const row = RETICLE.labels.filter((l) => l.anchor === 'bottom' && Math.sign(l.x) === s);
      expect(row.map((l) => l.text)).toEqual(['2', '4', '6', '8', '10']);
      for (const l of row) { expect(l.x).toBe(s * l.value); expect(l.y).toBeLessThan(at('h', l.x)!.from); }
    }
    const up = RETICLE.labels.filter((l) => l.y < -1);
    expect(up.map((l) => l.text)).toEqual(['2', '4', '6', '8', '10']);
    for (const l of up) { expect(l.y).toBe(-l.value); expect(l.x).toBeGreaterThan(at('v', l.y)!.to); expect(l.anchor).toBe('left'); }
  });
  it('arbre : les lignes paires portent leur chute en mrad aux deux bouts, après le dernier point', () => {
    for (let drop = 1; drop <= 24; drop++) {
      const row = RETICLE.labels.filter((l) => l.y === drop);
      if (drop % 2) { expect(row.length).toBe(0); continue; }
      expect(row.map((l) => l.text)).toEqual([String(drop), String(drop)]);
      const e = treeHalfWidth(drop);
      for (const l of row) { expect(Math.abs(l.x)).toBeGreaterThan(e + DOT_MIL); expect(l.anchor).toBe(l.x < 0 ? 'right' : 'left'); }
    }
    expect(RETICLE.labels.length).toBe(10 + 5 + 24);
  });
});

describe('réticule : lisibilité selon le grossissement', () => {
  // px CSS par mrad : 0,864 × grossissement sur un écran paysage de 900 px de haut, 0,36 × en portrait de 375 px
  it('les détails apparaissent par ordre de finesse quand le grossissement augmente, sans jamais se toucher', () => {
    for (const dpr of [1, 2]) {
      let last = Infinity;
      for (let ppm = 0.8; ppm <= 40; ppm += 0.2) {
        const l = reticleLod(ppm, dpr);
        expect(l.minPitch).toBeLessThanOrEqual(last);
        last = l.minPitch;
        expect(l.tickW).toBeGreaterThanOrEqual(dpr >= 2 ? 0.75 : 1); // plancher en pixels : le trait reste net
        expect(l.tickW).toBeGreaterThanOrEqual(LINE_MIL * ppm);
        if (Number.isFinite(l.minPitch)) expect(l.minPitch * ppm).toBeGreaterThanOrEqual(2 * l.tickW);
        if (l.dots) expect(ppm).toBeGreaterThanOrEqual(3 * l.dotPx);
      }
    }
    const desk25 = reticleLod(0.864 * 25, 1), desk5 = reticleLod(0.864 * 5, 1), phone25 = reticleLod(0.36 * 25, 2), phone5 = reticleLod(0.36 * 5, 2);
    expect([desk25.minPitch, desk25.dots, desk25.rowStep, desk25.labels]).toEqual([0.2, true, 1, 'all']); // tout est tracé
    expect([desk5.minPitch, desk5.dots, desk5.labels]).toEqual([0.5, false, 'sparse']); // mrad et demi-mrad, chiffres espacés, arbre en grisé
    expect([phone25.minPitch, phone25.dots, phone25.labels]).toEqual([0.2, true, 'all']);
    expect([phone5.minPitch, phone5.dots, phone5.labels]).toEqual([1, false, 'none']); // croix, mrad entiers, barres, arbre en grisé
  });
  it('à très fort grossissement, les traits prennent leur épaisseur réelle en mrad', () => {
    expect(reticleLod(60, 1).tickW).toBeCloseTo(LINE_MIL * 60, 9);
    expect(reticleLod(60, 1).dotPx).toBeCloseTo(DOT_MIL * 60, 9);
  });
});
