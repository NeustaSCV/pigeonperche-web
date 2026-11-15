// Sensibilité du doigt en lunette (src/ui/touch.ts) : large au zoom le plus bas, fine à fort grossissement, accélérée par un geste vif.
import { describe, expect, it } from 'vitest';
import { scopeLookGain } from '../src/ui/touch';

describe('sensibilité du doigt en lunette', () => {
  it('balaie plus large au zoom le plus bas qu’à fort grossissement', () => {
    expect(scopeLookGain(4, 0)).toBeCloseTo(2.6, 6);
    expect(scopeLookGain(16, 0)).toBeCloseTo(1.15, 6);
    expect(scopeLookGain(3, 0)).toBe(scopeLookGain(4, 0));
    expect(scopeLookGain(25, 0)).toBe(scopeLookGain(16, 0));
    let prev = Infinity;
    for (const z of [4, 6, 8, 10, 12, 16]) { const g = scopeLookGain(z, 0); expect(g).toBeLessThanOrEqual(prev); prev = g; }
  });

  it('reste plus sensible qu’avant (0,9) à tous les grossissements, sans dépasser le double à fort zoom', () => {
    for (const z of [4, 8, 16, 25]) expect(scopeLookGain(z, 0)).toBeGreaterThan(0.9);
    expect(scopeLookGain(25, 0)).toBeLessThan(1.8);
  });

  it('n’accélère pas un geste lent et ajoute 80 % à un geste vif', () => {
    expect(scopeLookGain(8, 0.1)).toBe(scopeLookGain(8, 0));
    expect(scopeLookGain(8, 0.25)).toBe(scopeLookGain(8, 0));
    expect(scopeLookGain(8, 1.2) / scopeLookGain(8, 0)).toBeCloseTo(1.8, 6);
    expect(scopeLookGain(8, 5)).toBe(scopeLookGain(8, 1.2));
    // valeurs aberrantes : jamais de résultat non fini (il déplacerait la visée n'importe où)
    expect(scopeLookGain(8, NaN)).toBe(scopeLookGain(8, 0));
    expect(Number.isFinite(scopeLookGain(NaN, 0.5))).toBe(true);
  });
});
