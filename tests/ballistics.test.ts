// Compare l'intégrateur (G1, et G7 pour les charges publiées dans ce modèle) aux tables publiées par les fabricants (tests/reference-tables.json).
// Chaque table est rejouée avec SES propres entrées (vitesse, BC, zérotage, hauteur de visée, vent).
import { describe, expect, it } from 'vitest';
import ref from './reference-tables.json';
import { ballisticTable, cdG1, ICAO, zeroAngle, type Atmosphere } from '../src/ballistics/solver';
import { WEAPONS } from '../src/config/weapons';

const YD = 0.9144, IN = 0.0254, FPS = 0.3048, MPH = 0.44704;
// Federal publie à 59 °F, 29,53 inHg, niveau de la mer : c'est l'atmosphère standard « Army Metro » ≈ OACI.
const AIR: Atmosphere = ICAO;

interface Row { range: number; drop: number | null; drift: number | null; velocity: number | null }

/** Tolérance sur la chute : absolue (m) + relative, élargie au-delà de 600 m (BC unique contre BC par tranches). */
function tolDrop(rangeM: number, dropM: number): number {
  const rel = rangeM <= 300 ? 0.05 : rangeM <= 650 ? 0.06 : 0.09;
  return 0.012 + Math.abs(dropM) * rel + rangeM * 0.00012;
}

describe('table de traînée G1', () => {
  it('valeurs de référence', () => {
    expect(cdG1(0)).toBeCloseTo(0.2629, 4);
    expect(cdG1(1)).toBeCloseTo(0.4805, 4);
    expect(cdG1(1.4)).toBeCloseTo(0.6625, 4);
    expect(cdG1(2.5)).toBeCloseTo(0.5397, 4);
    expect(cdG1(0.975)).toBeGreaterThan(cdG1(0.95));
  });
});

const WANT = [100, 300, 600, 1000];
for (const load of (ref as any).loads) {
  describe(`${load.id} — ${load.maker} ${load.product}`, () => {
    for (const t of load.tables as any[]) {
      const L = t.load;
      const v0 = L.muzzleVelocityMps ?? L.muzzleVelocityFps * FPS;
      const bc = typeof L.bcG1 === 'number' ? L.bcG1 : parseFloat(L.bcG1);
      if (!v0 || !bc) continue;
      // charges publiées en G7 (balles longues) : la table est rejouée avec le G7 du fabricant
      const g7 = L.dragModel === 'G7' && typeof L.bcG7 === 'number';
      const metric = t.units.range === 'm';
      const ru = metric ? 1 : YD;
      const du = t.units.drop === 'mm' ? 0.001 : t.units.drop === 'cm' ? 0.01 : IN;
      const vu = t.units.velocity === 'mps' ? 1 : FPS;
      const sh = (t.sightHeight ?? (metric ? 40 : 1.5)) * du;
      const cw = metric ? 4 : 10 * MPH;
      const rows: Row[] = t.rows.filter((r: Row) => r.range > 0);
      const ranges = rows.map((r) => r.range * ru);
      const calc = ballisticTable(
        g7 ? { v0, bcG1: bc, bulletGr: L.bulletGr ?? load.bulletGr, dragModel: 'G7', bcG7: L.bcG7 } : { v0, bcG1: bc, bulletGr: L.bulletGr ?? load.bulletGr },
        { zero: t.zeroRange * ru, sightHeight: sh, crosswind: cw, ranges, air: AIR },
      );
      const tag = `${t.kind} zéro ${t.zeroRange} ${t.units.range} (v0 ${Math.round(v0)} m/s, ${g7 ? `G7 ${L.bcG7}` : `BC ${bc}`})`;
      it(`${tag} : chute`, () => {
        rows.forEach((r, i) => {
          if (r.drop === null || !calc[i]) return;
          const rm = r.range * ru;
          // on vérifie surtout autour de 100, 300, 600 et 1 000 m, mais toutes les lignes publiées doivent tenir
          const near = WANT.some((w) => Math.abs(rm - w) < 60);
          const tol = tolDrop(rm, r.drop * du) * (near ? 1 : 1.25);
          expect(Math.abs(calc[i].path - r.drop * du), `chute à ${r.range} ${t.units.range} : calculé ${(calc[i].path / du).toFixed(1)}, publié ${r.drop}`).toBeLessThan(tol);
        });
      });
      it(`${tag} : vitesse restante`, () => {
        rows.forEach((r, i) => {
          if (r.velocity === null || !calc[i]) return;
          const rm = r.range * ru;
          const tol = (rm <= 650 ? 0.03 : 0.06) * r.velocity * vu + 3;
          expect(Math.abs(calc[i].velocity - r.velocity * vu), `vitesse à ${r.range} : calculé ${(calc[i].velocity / vu).toFixed(0)}, publié ${r.velocity}`).toBeLessThan(tol);
        });
      });
      // dérive : la ligne Lapua .300 WM est signalée comme douteuse dans la source (1,5 fois sa propre table impériale)
      const driftDoubt = load.id === '300wm' && metric;
      if (!driftDoubt && rows.some((r) => r.drift !== null && r.drift !== 0))
        it(`${tag} : dérive au vent`, () => {
          rows.forEach((r, i) => {
            if (r.drift === null || !calc[i] || r.range * ru < 90) return;
            const rm = r.range * ru;
            const pub = r.drift * du;
            const tol = 0.012 + Math.abs(pub) * (rm <= 650 ? 0.12 : 0.16);
            expect(Math.abs(calc[i].drift - pub), `dérive à ${r.range} : calculé ${(calc[i].drift / du).toFixed(1)}, publié ${r.drift}`).toBeLessThan(tol);
          });
        });
    }
  });
}

describe('cohérence des armes du jeu', () => {
  it('le .22 LR tombe en cloche, le .338 LM reste tendu', () => {
    const lr = WEAPONS.find((w) => w.id === '22lr')!;
    const lm = WEAPONS.find((w) => w.id === '338lm')!;
    const a = ballisticTable(lr, { zero: 50, sightHeight: 0.05, ranges: [150] })[0];
    const b = ballisticTable(lm, { zero: 100, sightHeight: 0.05, ranges: [1000] })[0];
    expect(a.elevMil).toBeGreaterThan(4.5); // près de 5 mrad de correction à 150 m
    expect(b.elevMil).toBeLessThan(10); // moins de 10 mrad à 1 000 m
    expect(b.velocity).toBeGreaterThan(ICAO.sos * 1.2); // encore franchement supersonique
    expect(a.time).toBeGreaterThan(0.45);
  });
  it('angle de zérotage positif et petit', () => {
    for (const w of WEAPONS) {
      const z = zeroAngle(w, w.zero, 0.05);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(0.02);
    }
  });
});
