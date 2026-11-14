// Balistique avancée : traînée G7, atmosphère, Coriolis, dérive gyroscopique, saut aérodynamique, solution de tir.
//
// Deux sortes de tests, signalées dans chaque titre :
//   [publié]    comparaison à une valeur publiée et citée (tests/reference-tables.json, bloc « published », ou
//               norme OACI) ;
//   [cohérence] aucune référence publiée trouvée à cette distance ou pour cet effet : on vérifie la physique
//               (symétries, limites, formule fermée, ordres de grandeur). Ce n'est PAS une validation externe.
import { describe, expect, it } from 'vitest';
import ref from './reference-tables.json';
import {
  DENSITY_EXP, EARTH_RATE, GAME_AIR, GRAIN_KG, ICAO, NEUTRAL_ENV, aeroJumpMil, airDensity, atmosphereFor, ballisticTable, cdG7, densityAltitude,
  densityRatio, dragCd, earthRateFlat, earthRateWorld, firingSolution, fullEnv, makeFlight, millerStability, muzzleVelocity, predictImpact,
  solutionTable, speedOfSound, spinDrift, splitElevation, standardPressure, stepBullet, stepDrag, stepFlight, windComponents, zeroAngle,
  type BallisticEnv, type BulletState,
} from '../src/ballistics';
import { RETICLE_HOLD_MIL, SIGHT_HEIGHT, WEAPONS, buildOf, usableElevation, weaponById, weaponsOfTier } from '../src/config/weapons';

const YD = 0.9144, IN = 0.0254, FPS = 0.3048, MPH = 0.44704;
const pub = (ref as any).published;
const W = (id: string) => WEAPONS.find((w) => w.id === id)!;
const ORIGINAL = ['22lr', '223', '65cm', '308', '308sub', '300wm', '338lm'];
const ELR_BEYOND_338 = ['33xc', '375ct', '408ct', '416b', '50bmg'];
const state = (v0: number, angle = 0.01): BulletState => ({ x: 0, y: 0, z: 0, vx: v0 * Math.cos(angle), vy: v0 * Math.sin(angle), vz: 0, t: 0 });
const only = (k: Partial<BallisticEnv>): BallisticEnv => ({ ...NEUTRAL_ENV, ...k });

// ---------------------------------------------------------------------------------------------------------------
describe('non-régression : les sept armes d’origine', () => {
  it('données balistiques inchangées', () => {
    const want: Record<string, [number, number, number, number, number]> = {
      // bulletGr, v0, bcG1, zero, turretMaxMil
      '22lr': [40, 327, 0.172, 50, 32], '223': [77, 829, 0.372, 100, 26], '65cm': [136, 835, 0.545, 100, 26], '308': [175, 793, 0.49, 100, 26],
      '308sub': [200, 325, 0.518, 100, 26], '300wm': [185, 900, 0.482, 100, 28], '338lm': [250, 905, 0.648, 100, 30],
    };
    expect(WEAPONS.slice(0, 7).map((w) => w.id)).toEqual(ORIGINAL);
    for (const id of ORIGINAL) {
      const w = W(id);
      expect([w.bulletGr, w.v0, w.bcG1, w.zero, w.turretMaxMil]).toEqual(want[id]);
      expect(w.dragModel ?? 'G1').toBe('G1');
      expect(w.tier).toBe('standard');
    }
  });

  it('environnement neutre : stepFlight est identique à stepBullet au bit près, pas après pas', () => {
    for (const id of ORIGINAL) {
      const w = W(id);
      for (const env of [undefined, NEUTRAL_ENV, only({ latitudeDeg: -33, altitudeM: 1800, temperatureC: 31, aeroJump: true })]) {
        // aeroJump n'agit qu'à la bouche (direction initiale) : il ne doit rien changer au pas de vol
        const f = makeFlight(w, env, { air: GAME_AIR, frame: 'world', y0: 320 });
        expect(f.plain).toBe(true);
        const a = state(w.v0, 0.03), b = state(w.v0, 0.03);
        for (let i = 0; i < 2400; i++) {
          const wx = 3 * Math.sin(i * 0.01), wz = -4 + Math.cos(i * 0.003);
          stepBullet(a, 1 / 400, w.bcG1, GAME_AIR, wx, 0, wz);
          stepFlight(b, 1 / 400, f, wx, 0, wz);
          if (!(Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z) && Object.is(a.vx, b.vx) && Object.is(a.vy, b.vy) && Object.is(a.vz, b.vz) && Object.is(a.t, b.t)))
            throw new Error(`${id} : écart au pas ${i}`);
        }
      }
    }
  });

  it('stepDrag en G1 est stepBullet', () => {
    const a = state(800), b = state(800);
    for (let i = 0; i < 500; i++) { stepBullet(a, 0.001, 0.5, ICAO, 1, 0, 2); stepDrag(b, 0.001, 0.5, 'G1', ICAO, 1, 0, 2); }
    expect(b).toEqual(a);
  });

  it('table de tir à plat inchangée au bit près (valeurs du solveur d’origine, relevées sur la sauvegarde avant modification)', () => {
    // .338 LM, zéro 100 m, OACI, vent 4 m/s : [position, dérive, vitesse, temps] à 500, 1 000 et 1 500 m
    const want = [
      [-1.3182872296062067, 0.3530373238222481, 673.7300852870945, 0.6407458663791807],
      [-8.210934340009475, 1.6588851355372423, 482.04140832032704, 1.519694354731469],
      [-26.080840704708613, 4.39004969690851, 348.005556325387, 2.7549720304981227],
    ];
    const r = ballisticTable(W('338lm'), { zero: 100, sightHeight: 0.05, crosswind: 4, ranges: [500, 1000, 1500] });
    expect(r.map((x) => [x.path, x.drift, x.velocity, x.time])).toEqual(want);
  });

  it('la solution de tir neutre redonne la table à plat', () => {
    for (const id of ORIGINAL) {
      const w = W(id);
      const r = id === '22lr' || id === '308sub' ? 200 : 800;
      const row = ballisticTable(w, { zero: w.zero, sightHeight: SIGHT_HEIGHT, ranges: [r], air: GAME_AIR })[0];
      const s = firingSolution(w, { range: r, air: GAME_AIR })!;
      // pas d'intégration différent (1/400 s contre 1/2000 s) : écart admis 0,02 mrad, soit 1,6 cm à 800 m
      expect(Math.abs(s.elevMil - row.elevMil)).toBeLessThan(0.02);
      expect(Math.abs(s.velocity - row.velocity)).toBeLessThan(0.5);
      expect(s.windMil).toBeCloseTo(0, 6);
      expect(s.parts.spinDrift + s.parts.coriolisH + s.parts.coriolisV + s.parts.aeroJump + s.parts.wind + s.parts.windVertical).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('traînée G7', () => {
  it('[publié] points de la table standard G7', () => {
    expect(cdG7(0)).toBeCloseTo(0.1198, 4);
    expect(cdG7(0.9)).toBeCloseTo(0.1464, 4);
    expect(cdG7(1.0)).toBeCloseTo(0.3803, 4);
    expect(cdG7(1.05)).toBeCloseTo(0.4043, 4); // maximum de la table
    expect(cdG7(2.0)).toBeCloseTo(0.298, 4);
    expect(cdG7(2.5)).toBeCloseTo(0.2697, 4);
    expect(cdG7(3.0)).toBeCloseTo(0.2424, 4);
    expect(cdG7(5.0)).toBeCloseTo(0.1618, 4);
    expect(cdG7(9)).toBeCloseTo(0.1618, 4);
    expect(dragCd('G7', 2.25)).toBeCloseTo(0.2835, 4);
    expect(dragCd('G1', 2.5)).toBeCloseTo(0.5397, 4);
  });
  it('[cohérence] décroissante au-delà de Mach 1,05, continue', () => {
    for (let m = 1.05; m < 5; m += 0.01) expect(cdG7(m + 0.01)).toBeLessThanOrEqual(cdG7(m) + 1e-12);
    for (let m = 0; m < 5; m += 0.005) expect(Math.abs(cdG7(m + 0.005) - cdG7(m))).toBeLessThan(0.02);
  });

  // Tables Hornady (6.5 PRC, 7 mm PRC, .300 PRC) : rejouées en G7 avec le coefficient publié à Mach 2,25.
  // Tolérances : 0,5 % sur la vitesse (12 ft/s : l'atmosphère de Hornady n'est pas publiée, 1 % de densité déplace la
  // vitesse à 500 yards de 4 ft/s) ; 0,25 pouce sur la trajectoire jusqu'à 400 yards (la table est arrondie à 0,1 pouce
  // et la hauteur de visée est déduite de la case « bouche »).
  for (const id of ['65prc', '7prc', '300prc']) {
    it(`[publié] ${id} : table Hornady jusqu’à 500 yards`, () => {
      const load = (ref as any).loads.find((l: any) => l.id === id);
      const t = load.tables[0], L = t.load;
      const rows = t.rows.filter((r: any) => r.range > 0);
      const calc = ballisticTable(
        { v0: L.muzzleVelocityFps * FPS, bcG1: L.bcG1, bulletGr: L.bulletGr, dragModel: 'G7', bcG7: L.bcG7 },
        { zero: t.zeroRange * YD, sightHeight: t.sightHeight * IN, ranges: rows.map((r: any) => r.range * YD), air: ICAO },
      );
      rows.forEach((r: any, i: number) => {
        expect(Math.abs(calc[i].velocity / FPS - r.velocity) / r.velocity, `vitesse à ${r.range} yd`).toBeLessThan(0.005);
        if (r.range <= 400) expect(Math.abs(calc[i].path / IN - r.drop), `trajectoire à ${r.range} yd`).toBeLessThan(0.25);
      });
      // l'arme du jeu porte bien cette charge
      const w = W(id);
      expect(w.bcG7).toBe(L.bcG7);
      expect(Math.abs(w.v0 - L.muzzleVelocityFps * FPS)).toBeLessThan(0.6);
    });
  }

  // Tables Lapua à longue distance (jusqu'à 1 000, 1 200 et 1 500 m), pour lesquelles Lapua publie aussi un G7.
  // Lapua calcule ses tables avec une traînée mesurée au radar Doppler : un G7 unique ne peut pas les reproduire
  // exactement. Tolérances : 4 % + 3 m/s sur la vitesse, 4 % + 3 cm sur la chute — c'est la précision à attendre d'un
  // coefficient unique jusque dans le transsonique, et c'est mieux que le G1 des mêmes tables au-delà de 800 m.
  for (const id of ['65cm', '308', '300wm', '338lm']) {
    it(`[publié] ${id} : table Lapua longue distance rejouée en G7`, () => {
      const load = (ref as any).loads.find((l: any) => l.id === id);
      const t = load.tables.find((x: any) => x.units.range === 'm' && x.zeroRange === 100 && typeof x.load.bcG7 === 'number');
      const L = t.load;
      const rows = t.rows.filter((r: any) => r.range >= 100);
      const opt = { zero: 100, sightHeight: t.sightHeight / 1000, ranges: rows.map((r: any) => r.range), air: ICAO };
      const g7 = ballisticTable({ v0: L.muzzleVelocityMps, bcG1: L.bcG1, bulletGr: L.bulletGr, dragModel: 'G7', bcG7: L.bcG7 }, opt);
      const g1 = ballisticTable({ v0: L.muzzleVelocityMps, bcG1: L.bcG1, bulletGr: L.bulletGr }, opt);
      let e7 = 0, e1 = 0;
      rows.forEach((r: any, i: number) => {
        if (r.velocity !== null) {
          expect(Math.abs(g7[i].velocity - r.velocity), `vitesse à ${r.range} m : ${g7[i].velocity.toFixed(0)} contre ${r.velocity}`).toBeLessThan(0.04 * r.velocity + 3);
          if (r.range >= 800) { e7 += Math.abs(g7[i].velocity - r.velocity); e1 += Math.abs(g1[i].velocity - r.velocity); }
        }
        if (r.drop !== null && r.range > 100)
          expect(Math.abs(g7[i].path - r.drop / 1000), `chute à ${r.range} m : ${(g7[i].path * 1000).toFixed(0)} contre ${r.drop}`).toBeLessThan(0.04 * Math.abs(r.drop / 1000) + 0.03);
      });
      expect(e7, 'le G7 suit mieux la vitesse publiée que le G1 au-delà de 800 m').toBeLessThan(e1);
    });
  }

  it('[cohérence] G1 et G7 publiés pour une même balle donnent la même vitesse à courte distance', () => {
    // les deux coefficients sont publiés autour de Mach 2,25 : ils doivent s'accorder tant que la balle en est proche
    for (const w of WEAPONS.filter((x) => x.dragModel === 'G7')) {
      const a = ballisticTable(w, { zero: 100, sightHeight: 0.05, ranges: [300] })[0];
      const b = ballisticTable({ v0: w.v0, bcG1: w.bcG1, bulletGr: w.bulletGr }, { zero: 100, sightHeight: 0.05, ranges: [300] })[0];
      expect(Math.abs(a.velocity - b.velocity) / a.velocity, w.id).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('atmosphère', () => {
  it('[publié] atmosphère type OACI (Doc 7488) : niveau de la mer, 1 000, 2 000 et 3 000 m', () => {
    expect(airDensity(15, 1013.25)).toBeCloseTo(1.225, 3);
    expect(speedOfSound(15)).toBeCloseTo(340.29, 1);
    // altitude : [pression hPa, température °C, masse volumique kg/m³]
    const icao: [number, number, number, number][] = [[1000, 898.746, 8.5, 1.11164], [2000, 794.952, 2.0, 1.00649], [3000, 701.085, -4.5, 0.909122]];
    for (const [h, p, t, rho] of icao) {
      expect(Math.abs(standardPressure(h) - p)).toBeLessThan(0.05);
      expect(Math.abs(airDensity(t, standardPressure(h)) - rho)).toBeLessThan(0.0003);
      expect(Math.abs(densityAltitude(rho) - h)).toBeLessThan(2);
    }
  });
  it('[publié] variation de densité le long d’une trajectoire : conforme à l’atmosphère type', () => {
    // poste à 1 000 m (8,5 °C) : 1 000 m plus bas on doit retrouver la densité du niveau de la mer, 1 000 m plus haut celle de 2 000 m
    const f = makeFlight(W('338lm300'), fullEnv({ altitudeM: 1000, temperatureC: 8.5 }), { y0: 50 });
    expect(f.air.rho).toBeCloseTo(1.11164, 3);
    expect(f.air.rho * densityRatio(f, 50 - 1000)).toBeCloseTo(1.225, 3);
    expect(f.air.rho * densityRatio(f, 50 + 1000)).toBeCloseTo(1.00649, 3);
    expect(densityRatio(f, 50)).toBe(1);
    expect(DENSITY_EXP).toBeCloseTo(9.80665 / (287.05287 * 0.0065) - 1, 4);
  });
  it('[cohérence] environnement neutre : atmosphère de base rendue telle quelle', () => {
    expect(atmosphereFor(undefined, GAME_AIR)).toBe(GAME_AIR);
    expect(atmosphereFor(NEUTRAL_ENV, GAME_AIR)).toBe(GAME_AIR);
    expect(atmosphereFor(only({ coriolis: true, spinDrift: true, aeroJump: true }), ICAO)).toBe(ICAO);
  });
  it('[cohérence] air chaud, altitude et humidité allègent l’air ; pression station prioritaire', () => {
    expect(airDensity(35, 1013.25)).toBeLessThan(airDensity(-5, 1013.25));
    expect(airDensity(25, 1013.25, 90)).toBeLessThan(airDensity(25, 1013.25, 0));
    expect(airDensity(25, 1013.25, 90) / airDensity(25, 1013.25, 0)).toBeGreaterThan(0.985); // effet de l'ordre de 1 %
    expect(atmosphereFor(fullEnv({ altitudeM: 1600 })).rho).toBeLessThan(atmosphereFor(fullEnv({ altitudeM: 0 })).rho);
    expect(atmosphereFor(fullEnv({ altitudeM: 1600, pressureHPa: 1013.25 })).rho).toBeCloseTo(1.225, 3);
  });
  it('[cohérence] l’air mince tend la trajectoire ; tirer vers la vallée freine davantage qu’à densité constante', () => {
    const w = W('375ct');
    const sea = firingSolution(w, { range: 2000, env: only({ densityFromAltitude: true, altitudeM: 0, temperatureC: 15 }) })!;
    const high = firingSolution(w, { range: 2000, env: only({ densityFromAltitude: true, altitudeM: 1600, temperatureC: 15 }) })!;
    const cold = firingSolution(w, { range: 2000, env: only({ densityFromAltitude: true, altitudeM: 0, temperatureC: -15 }) })!;
    expect(high.elevMil).toBeLessThan(sea.elevMil - 1);
    expect(high.velocity).toBeGreaterThan(sea.velocity + 20);
    expect(cold.elevMil).toBeGreaterThan(sea.elevMil + 0.5);
    // poste type OACI, tir à plat : le solveur avancé retrouve le calcul en air uniforme (la flèche de la
    // trajectoire, 20 m, ne change la densité que de 0,2 %)
    const flat = firingSolution(w, { range: 2000, air: ICAO })!;
    expect(Math.abs(sea.elevMil - flat.elevMil)).toBeLessThan(0.05);
    // cible 600 m plus bas : la balle traverse un air de plus en plus dense
    const env = only({ densityFromAltitude: true, altitudeM: 1600, temperatureC: 10 });
    const down = firingSolution(w, { range: 2000, heightDiff: -600, env })!;
    const uniform = firingSolution(w, { range: 2000, heightDiff: -600, air: atmosphereFor(env) })!;
    expect(down.velocity).toBeLessThan(uniform.velocity - 3);
    expect(down.tof).toBeGreaterThan(uniform.tof);
    expect(down.elevMil).toBeGreaterThan(uniform.elevMil);
  });
  it('[cohérence] sensibilité de la poudre à la température', () => {
    expect(muzzleVelocity(900)).toBe(900);
    expect(muzzleVelocity(900, NEUTRAL_ENV)).toBe(900);
    expect(muzzleVelocity(900, only({ temperatureC: 35, powderTempSens: 0.5 }))).toBeCloseTo(910, 9);
    expect(muzzleVelocity(900, only({ temperatureC: -5, powderTempSens: 0.5 }))).toBeCloseTo(890, 9);
    const hot = firingSolution(W('416b'), { range: 2000, env: only({ temperatureC: 35, powderTempSens: 0.5 }) })!;
    const ref0 = firingSolution(W('416b'), { range: 2000 })!;
    expect(hot.v0).toBeCloseTo(879, 6);
    expect(hot.elevMil).toBeLessThan(ref0.elevMil - 0.2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('force de Coriolis', () => {
  const L = pub.litzSpinCoriolis;
  const R1000 = L.rangeYd * YD;
  const cor = (lat: number): BallisticEnv => only({ coriolis: true, latitudeDeg: lat });

  it('[publié] Litz : 2,5 à 3,0 pouces vers la droite à 1 000 yards par 45° N, quel que soit l’azimut', () => {
    // « typical small arms trajectory » : on prend les calibres de tir à 1 000 yards du jeu (temps de vol 1,3 à 1,6 s).
    // Litz écrit « about » : la fourchette publiée est élargie de 10 % de chaque côté.
    for (const id of ['65cm', '300wm', '338lm', '65prc', '300prc']) {
      for (const az of [0, 90, 180, 270]) {
        const s = firingSolution(W(id), { range: R1000, azimuthDeg: az, air: ICAO, env: cor(L.latitudeDeg) })!;
        const inch = s.deflection.coriolisH / IN;
        expect(inch, `${id} azimut ${az} : ${inch.toFixed(2)} po`).toBeGreaterThan(L.coriolisHorizontalIn[0] * 0.9);
        expect(inch, `${id} azimut ${az} : ${inch.toFixed(2)} po`).toBeLessThan(L.coriolisHorizontalIn[1] * 1.1);
        expect(s.windMil).toBeLessThan(0); // on corrige à gauche
      }
    }
  });
  it('[publié] Litz : vertical nul au nord et au sud, +2,5 à 3 pouces à l’est, −2,5 à 3 pouces à l’ouest', () => {
    for (const id of ['65cm', '300wm', '338lm']) {
      const at = (az: number) => firingSolution(W(id), { range: R1000, azimuthDeg: az, air: ICAO, env: cor(45) })!.deflection.coriolisV / IN;
      expect(Math.abs(at(0))).toBeLessThan(0.05);
      expect(Math.abs(at(180))).toBeLessThan(0.05);
      expect(at(90)).toBeGreaterThan(L.coriolisVerticalIn[0] * 0.9);
      expect(at(90)).toBeLessThan(L.coriolisVerticalIn[1] * 1.1);
      expect(at(270)).toBeCloseTo(-at(90), 2);
    }
  });
  it('[cohérence] formule fermée : dérive = 2·Ω·sin(latitude)·(T·X − ∫x dt), à 0,5 % près', () => {
    // la force de Coriolis fait tourner le vecteur vitesse à la vitesse angulaire constante 2·Ω·sin(latitude), traînée
    // ou pas : la dérive vaut donc ∫ v(t)·2Ω·sin(lat)·t dt = 2Ω·sin(lat)·(T·X − ∫x dt). Sans traînée on retrouve la
    // formule classique Ω·sin(lat)·X·T (McCoy, « Modern Exterior Ballistics »).
    const w = W('375ct');
    const f = makeFlight(w, undefined, { air: ICAO });
    const s = state(w.v0, 0.02);
    let integral = 0;
    const dt = 1 / 400;
    while (s.x < 2000) { const x0 = s.x; stepFlight(s, dt, f, 0, 0, 0); integral += ((x0 + s.x) / 2) * dt; }
    const fc = makeFlight(w, cor(45), { air: ICAO, azimuthDeg: 0 });
    const c = state(w.v0, 0.02);
    while (c.t < s.t - 1e-9) stepFlight(c, dt, fc, 0, 0, 0);
    const expected = 2 * EARTH_RATE * Math.sin(Math.PI / 4) * (s.t * s.x - integral);
    expect(c.z).toBeGreaterThan(0.2);
    expect(Math.abs(c.z - expected) / expected).toBeLessThan(0.005);
    // et la formule classique sans traînée majore la dérive réelle, de moins de 20 %
    const classic = EARTH_RATE * Math.sin(Math.PI / 4) * s.x * s.t;
    expect(c.z).toBeLessThan(classic);
    expect(c.z).toBeGreaterThan(classic * 0.8);
  });
  it('[cohérence] symétries : hémisphère sud, équateur, pôle', () => {
    const w = W('416b');
    const at = (lat: number, az: number) => firingSolution(w, { range: 2000, azimuthDeg: az, air: ICAO, env: cor(lat) })!.deflection;
    // tir au nord : au terme principal (qui change de signe avec l'hémisphère) s'ajoute un terme de quelques
    // millimètres dû à la vitesse verticale (la balle monte puis retombe), qui lui ne change pas de signe
    expect(Math.abs(at(-45, 0).coriolisH + at(45, 0).coriolisH)).toBeLessThan(0.012);
    expect(Math.abs(at(0, 0).coriolisH)).toBeLessThan(0.012);
    // tir à l'est ou à l'ouest : ce terme disparaît, la symétrie est exacte
    expect(at(-45, 90).coriolisH).toBeCloseTo(-at(45, 90).coriolisH, 6);
    expect(Math.abs(at(0, 90).coriolisH)).toBeLessThan(1e-6);
    expect(Math.abs(at(90, 90).coriolisV)).toBeLessThan(1e-3);
    expect(at(0, 90).coriolisV).toBeGreaterThan(at(45, 90).coriolisV * 1.35); // 1/cos(45°) = 1,41
    expect(at(90, 0).coriolisH).toBeGreaterThan(at(45, 0).coriolisH * 1.35);
    // à 2 000 m l'effet n'est plus négligeable : plusieurs dizaines de centimètres
    expect(at(45, 0).coriolisH).toBeGreaterThan(0.25);
    expect(at(45, 0).coriolisH).toBeLessThan(0.45);
  });
  it('[cohérence] repère du monde du jeu (nord = −Z, est = +X) et repère de tir à plat donnent le même résultat', () => {
    const w = W('408ct');
    const ow = earthRateWorld(45);
    expect(ow.x).toBe(0);
    expect(ow.y).toBeCloseTo(EARTH_RATE * Math.SQRT1_2, 15); // composante verticale, vers le haut dans l'hémisphère nord
    expect(ow.z).toBeCloseTo(-EARTH_RATE * Math.SQRT1_2, 15); // composante horizontale, vers le nord (−Z)
    for (const azDeg of [0, 70, 180, 255]) {
      const az = (azDeg * Math.PI) / 180;
      const flat = makeFlight(w, cor(45), { air: GAME_AIR, azimuthDeg: azDeg });
      const world = makeFlight(w, cor(45), { air: GAME_AIR, frame: 'world' });
      const a = state(w.v0, 0.03);
      // même tir dans le monde : direction horizontale (sin az, −cos az) en (X, Z)
      const b: BulletState = { x: 0, y: 0, z: 0, vx: a.vx * Math.sin(az), vy: a.vy, vz: -a.vx * Math.cos(az), t: 0 };
      for (let i = 0; i < 1600; i++) { stepFlight(a, 1 / 400, flat, 0, 0, 0); stepFlight(b, 1 / 400, world, 0, 0, 0); }
      const along = b.x * Math.sin(az) - b.z * Math.cos(az);
      const right = b.x * Math.cos(az) + b.z * Math.sin(az);
      expect(along).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(right).toBeCloseTo(a.z, 6);
      const o = earthRateFlat(45, azDeg);
      expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(EARTH_RATE, 12);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('dérive gyroscopique et stabilité', () => {
  const L = pub.litzSpinCoriolis;
  it('[publié] formules de Miller et de Litz : valeurs calculées à la main', () => {
    // Miller : 175 gr, calibre .308, longueur 1,24 po, pas de 12 po, 2 800 ft/s, air type → 30·175 / (38,96²·0,308³·4,026·17,21) = 1,708
    expect(millerStability({ bulletGr: 175, bulletDiaMm: 0.308 * 25.4, bulletLenMm: 1.24 * 25.4, twistIn: 12 }, 2800 * FPS)).toBeCloseTo(1.708, 2);
    // Litz : 1,25·(Sg + 1,2)·tof^1,83 pouces → Sg 1,5 et 1 s : 3,375 po
    expect(spinDrift(1.5, 1) / IN).toBeCloseTo(3.375, 9);
    expect(spinDrift(1.5, 2) / IN).toBeCloseTo(3.375 * Math.pow(2, 1.83), 9);
    expect(spinDrift(1.5, 1, -1)).toBe(-spinDrift(1.5, 1));
  });
  it('[publié] Litz : 8 à 9 pouces typiques à 1 000 yards, jamais plus de 10 à 12, vers la droite', () => {
    // les cinq calibres supersoniques d'origine, pas à droite, OACI. Fourchette admise : 6 à 12,5 pouces
    // (« typiquement 8-9 », « pas plus de 10 à 12 ») ; la moyenne doit tomber dans 7,5 à 10 pouces.
    let sum = 0;
    const ids = ['223', '65cm', '308', '300wm', '338lm'];
    for (const id of ids) {
      const s = firingSolution(W(id), { range: L.rangeYd * YD, air: ICAO, env: only({ spinDrift: true }) })!;
      const inch = s.deflection.spinDrift / IN;
      expect(inch, `${id} : ${inch.toFixed(1)} po`).toBeGreaterThan(6);
      expect(inch, `${id} : ${inch.toFixed(1)} po`).toBeLessThan(L.spinDriftMaxIn[1] + 0.5);
      expect(s.windMil).toBeLessThan(0);
      sum += inch;
    }
    expect(sum / ids.length).toBeGreaterThan(L.spinDriftTypicalIn[0] - 0.5);
    expect(sum / ids.length).toBeLessThan(L.spinDriftTypicalIn[1] + 1);
  });
  it('[publié] Litz : Coriolis et dérive gyroscopique s’ajoutent (≈ 11,5 pouces à 1 000 yards dans l’hémisphère nord)', () => {
    const s = firingSolution(W('300wm'), { range: 1000 * YD, air: ICAO, env: only({ spinDrift: true, coriolis: true, latitudeDeg: 45 }) })!;
    const total = (-s.windMil * 0.001 * s.range) / IN;
    expect(total).toBeCloseTo((s.deflection.spinDrift + s.deflection.coriolisH) / IN, 1);
    expect(total).toBeGreaterThan(9);
    expect(total).toBeLessThan(14);
  });
  it('[cohérence] la dérive accumulée pas à pas suit exactement la formule', () => {
    const w = W('338lm300');
    const f = makeFlight(w, only({ spinDrift: true }), { air: ICAO });
    const s = state(f.v0, 0.02);
    for (let i = 0; i < 2000; i++) stepFlight(s, 1 / 400, f, 0, 0, 0);
    expect(s.t).toBeCloseTo(5, 9);
    expect(s.z).toBeCloseTo(spinDrift(f.sg, 5), 6);
    expect(f.sg).toBeCloseTo(millerStability(w, w.v0), 12);
  });
  it('[cohérence] pas à gauche : dérive opposée ; données manquantes : aucune dérive', () => {
    const w = W('308');
    const r = firingSolution(w, { range: 800, env: only({ spinDrift: true }) })!;
    const l = firingSolution({ ...w, twistIn: -w.twistIn! }, { range: 800, env: only({ spinDrift: true }) })!;
    expect(l.deflection.spinDrift).toBeCloseTo(-r.deflection.spinDrift, 9);
    expect(l.windMil).toBeCloseTo(-r.windMil, 3);
    const lr = W('22lr');
    expect(lr.bulletLenMm).toBeUndefined();
    expect(millerStability(lr, lr.v0)).toBe(0);
    expect(firingSolution(lr, { range: 150, env: only({ spinDrift: true, aeroJump: true }), windSpeed: 3, windFromDeg: 90 })!.parts.spinDrift).toBe(0);
  });
  it('[cohérence] Miller : lois d’échelle, et toutes les armes du jeu sont stables', () => {
    const p = { bulletGr: 300, bulletDiaMm: 8.59, bulletLenMm: 46.2, twistIn: 10 };
    expect(millerStability({ ...p, twistIn: 5 }, 800) / millerStability(p, 800)).toBeCloseTo(4, 9);
    expect(millerStability(p, 800, 1.0) / millerStability(p, 800, 1.225)).toBeCloseTo(1.225, 9);
    expect(millerStability(p, 900) / millerStability(p, 800)).toBeCloseTo(Math.cbrt(900 / 800), 9);
    for (const w of WEAPONS.filter((x) => x.bulletLenMm)) {
      const sg = millerStability(w, w.v0);
      expect(sg, `${w.id} Sg ${sg.toFixed(2)}`).toBeGreaterThan(w.v0 < 400 ? 1.2 : 1.4);
      expect(sg, `${w.id} Sg ${sg.toFixed(2)}`).toBeLessThan(3);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('saut aérodynamique', () => {
  const p = { bulletGr: 175, bulletDiaMm: 7.82, bulletLenMm: 7.82 * 4.5, twistIn: 10 };
  it('[publié] formule de Litz : 0,01·Sg − 0,0024·L + 0,032 MOA par mph', () => {
    // Sg 1,75, L 4,5 calibres : 0,0387 MOA/mph ; 10 mph venant de la droite → 0,387 MOA vers le haut = 0,1126 mrad
    expect(aeroJumpMil(p, 1.75, -10 * MPH)).toBeCloseTo(0.387 * 0.2908882, 4);
  });
  it('[cohérence] sens : vent de droite = impact haut, vent de gauche = impact bas (pas à droite) ; inversé à gauche', () => {
    expect(aeroJumpMil(p, 1.75, -5)).toBeGreaterThan(0);
    expect(aeroJumpMil(p, 1.75, 5)).toBe(-aeroJumpMil(p, 1.75, -5));
    expect(aeroJumpMil({ ...p, twistIn: -10 }, 1.75, -5)).toBe(-aeroJumpMil(p, 1.75, -5));
    expect(aeroJumpMil(p, 1.75, 0)).toBe(0);
    expect(aeroJumpMil({ bulletGr: 40 }, 0, 5)).toBe(0);
    // tir au nord, vent d'ouest (venant de la gauche) : l'impact descend, on corrige vers le haut
    const w = W('300prc');
    const left = firingSolution(w, { range: 1000, azimuthDeg: 0, windSpeed: 5, windFromDeg: 270, env: only({ aeroJump: true }) })!;
    const right = firingSolution(w, { range: 1000, azimuthDeg: 0, windSpeed: 5, windFromDeg: 90, env: only({ aeroJump: true }) })!;
    expect(left.deflection.aeroJump).toBeLessThan(0);
    expect(left.parts.aeroJump).toBeGreaterThan(0.1);
    expect(left.parts.aeroJump).toBeLessThan(0.25);
    expect(right.parts.aeroJump).toBeCloseTo(-left.parts.aeroJump, 9);
    expect(left.elevMil - right.elevMil).toBeCloseTo(2 * left.parts.aeroJump, 2);
    // vent de face : aucun saut
    expect(firingSolution(w, { range: 1000, azimuthDeg: 0, windSpeed: 5, windFromDeg: 0, env: only({ aeroJump: true }) })!.parts.aeroJump).toBeCloseTo(0, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('solution de tir', () => {
  const env = fullEnv({ latitudeDeg: 45, altitudeM: 600, temperatureC: 18 });
  it('[cohérence] composantes du vent', () => {
    const c = windComponents(10, 90, 0); // tir au nord, vent d'est : il pousse à gauche
    expect(c.right).toBeCloseTo(-10, 9);
    expect(c.along).toBeCloseTo(0, 9);
    expect(windComponents(10, 0, 0).along).toBeCloseTo(-10, 9); // vent de face
    expect(windComponents(10, 180, 0).along).toBeCloseTo(10, 9); // vent de dos
    expect(windComponents(10, 0, 90).right).toBeCloseTo(10, 9); // tir à l'est, vent du nord : il pousse à droite
  });
  it('[cohérence] vent de gauche : impact à droite, correction à gauche ; vent de face : il faut monter', () => {
    const w = W('338lm300');
    const s = firingSolution(w, { range: 1200, azimuthDeg: 0, windSpeed: 4, windFromDeg: 270 })!;
    expect(s.deflection.wind).toBeGreaterThan(1);
    expect(s.windMil).toBeLessThan(-1);
    expect(s.windMil).toBeCloseTo(s.parts.wind, 2);
    const head = firingSolution(w, { range: 1200, azimuthDeg: 0, windSpeed: 8, windFromDeg: 0 })!;
    const tail = firingSolution(w, { range: 1200, azimuthDeg: 0, windSpeed: 8, windFromDeg: 180 })!;
    expect(head.parts.windVertical).toBeGreaterThan(0);
    expect(tail.parts.windVertical).toBeLessThan(0);
    expect(Math.abs(head.windMil)).toBeLessThan(1e-6);
  });
  it('[cohérence] la somme des parts redonne le réglage complet, et ce réglage met au but', () => {
    for (const w of WEAPONS.filter((x) => x.tier === 'elr')) {
      for (const range of [1000, 1609, 2000, 2500]) {
        const setup = { range, azimuthDeg: 90, windSpeed: 4.4704, windFromDeg: 0, air: GAME_AIR, env };
        const s = firingSolution(w, setup)!;
        const p = s.parts;
        expect(Math.abs(p.drop + p.windVertical + p.coriolisV + p.aeroJump - s.elevMil), `${w.id} ${range} élévation`).toBeLessThan(0.05);
        expect(Math.abs(p.wind + p.spinDrift + p.coriolisH - s.windMil), `${w.id} ${range} dérive`).toBeLessThan(0.05);
        const hit = predictImpact(w, setup, s.elevMil, s.windMil)!;
        expect(Math.abs(hit.up), `${w.id} ${range}`).toBeLessThan(0.01);
        expect(Math.abs(hit.right), `${w.id} ${range}`).toBeLessThan(0.01);
        expect(hit.tof).toBeCloseTo(s.tof, 3);
        // sans réglage, l'impact prédit est bas de la chute et décalé de la dérive
        const raw = predictImpact(w, setup, 0, 0)!;
        expect(raw.upMil).toBeLessThan(-s.elevMil * 0.9);
        expect(raw.rightMil).toBeGreaterThan(0);
        expect(s.energy).toBeCloseTo(0.5 * w.bulletGr * GRAIN_KG * s.velocity ** 2, 6);
      }
    }
  });
  it('[cohérence] passages transsonique et subsonique', () => {
    for (const w of WEAPONS) {
      const s = firingSolution(w, { range: 300, air: GAME_AIR })!;
      if (w.v0 < 1.2 * GAME_AIR.sos) { expect(s.transonicRange).toBe(0); continue; }
      expect(s.transonicRange!, w.id).toBeGreaterThan(300);
      expect(s.subsonicRange!, w.id).toBeGreaterThan(s.transonicRange!);
      // la distance de passage ne dépend pas de la cible visée (à la pente de tir près)
      const far = firingSolution(w, { range: 900, air: GAME_AIR })!;
      expect(Math.abs(far.transonicRange! - s.transonicRange!), w.id).toBeLessThan(5);
      // à la distance transsonique, le projectile est bien à Mach 1,2
      const at = firingSolution(w, { range: s.transonicRange!, air: GAME_AIR })!;
      expect(at.mach, w.id).toBeGreaterThan(1.19);
      expect(at.mach, w.id).toBeLessThan(1.21);
    }
  });
  it('[cohérence] tir en pente : moins d’élévation qu’à plat (règle du cosinus)', () => {
    const w = W('375ct');
    const flat = firingSolution(w, { range: 1500, air: GAME_AIR })!;
    const down = firingSolution(w, { range: 1500, heightDiff: -500, air: GAME_AIR })!;
    const up = firingSolution(w, { range: 1500, heightDiff: 500, air: GAME_AIR })!;
    const cos = Math.cos(Math.asin(500 / 1500));
    expect(down.elevMil).toBeLessThan(flat.elevMil);
    expect(up.elevMil).toBeLessThan(flat.elevMil);
    expect(Math.abs(down.elevMil / flat.elevMil - cos)).toBeLessThan(0.05);
    expect(down.velocity).toBeGreaterThan(up.velocity); // la pesanteur aide en descente
  });
  it('[cohérence] hors de portée → null ; carnet de tir ; partage tourelle / réticule', () => {
    expect(firingSolution(W('22lr'), { range: 2500, air: GAME_AIR })).toBeNull();
    const rows = solutionTable(W('22lr'), [50, 100, 2500], { air: GAME_AIR });
    expect(rows.map((r) => r.range)).toEqual([50, 100]);
    expect(Math.abs(rows[0].elevMil)).toBeLessThan(0.02); // zéro à 50 m
    expect(splitElevation(37.14, 34)).toEqual({ dialMil: 34, holdMil: expect.closeTo(3.14, 9) });
    expect(splitElevation(12.34, 34).dialMil).toBeCloseTo(12.3, 9);
    expect(splitElevation(12.34, 34).holdMil).toBeCloseTo(0.04, 9);
  });
  it('[cohérence] zéro : aucune correction à la distance de zérotage', () => {
    for (const w of WEAPONS) {
      const s = firingSolution(w, { range: w.zero, air: GAME_AIR })!;
      expect(Math.abs(s.elevMil), w.id).toBeLessThan(0.02);
      expect(zeroAngle(w, w.zero, SIGHT_HEIGHT, GAME_AIR)).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('nouvelles armes', () => {
  it('[publié] vitesses, coefficients et longueurs de balle conformes aux fiches fabricants', () => {
    for (const a of pub.ammunition) {
      const w = W(a.id);
      expect(Math.abs(w.v0 - a.fps * FPS), `${a.id} v0`).toBeLessThan(0.6);
      expect(w.bcG1, `${a.id} G1`).toBe(a.bcG1 ?? w.bcG1);
      if (a.bcG7) { expect(w.bcG7).toBe(a.bcG7); expect(w.dragModel).toBe('G7'); }
      if (a.bulletOalIn) expect(Math.abs(w.bulletLenMm! - a.bulletOalIn * 25.4), `${a.id} longueur`).toBeLessThan(0.06);
      // énergie à la bouche publiée par Berger (à 1 % près)
      if (a.energyFtLb) expect(Math.abs((0.5 * w.bulletGr * GRAIN_KG * w.v0 ** 2) / 1.3558179 - a.energyFtLb) / a.energyFtLb).toBeLessThan(0.01);
    }
  });
  it('[publié] carabines : canon, pas, masse et chargeur des fiches constructeur', () => {
    const rifles = (ref as any).rifles as any[];
    for (const w of WEAPONS.filter((x) => x.tier !== 'standard')) {
      const r = rifles.find((x) => x.model.startsWith(w.name.replace('Seekins', 'Seekins Precision').replace('Barrett M99', 'Barrett Model 99').replace('Tubb Adaptive Target Rifle', 'Tubb Adaptive Target Rifle (ATR)')) && x.caliber.replace('6mm', '6 mm').replace('7mm', '7 mm') === w.caliber);
      expect(r, `fiche de ${w.name} ${w.caliber}`).toBeTruthy();
      expect(w.barrelMm).toBe(r.barrelMm);
      expect(`1:${w.twistIn}`).toBe(r.twist);
      if (r.weightKg !== null) expect(Math.abs(w.weightKg - r.weightKg)).toBeLessThan(0.06);
      if (r.magazine !== null) expect(w.magazine).toBe(r.magazine);
    }
  });
  it('[cohérence] fiches complètes et progression lisible', () => {
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    expect(weaponsOfTier('standard').length).toBe(7);
    expect(weaponsOfTier('intermediate').map((w) => w.id)).toEqual(['6cm', '65prc', '7prc', '300prc']);
    expect(weaponsOfTier('elr').map((w) => w.id)).toEqual(['338lm300', ...ELR_BEYOND_338]);
    expect(weaponById('408ct').name).toBe('CheyTac M200 Intervention');
    for (const w of WEAPONS) {
      if (w.dragModel === 'G7') expect(w.bcG7, w.id).toBeGreaterThan(0.2);
      expect(w.sound.loudness).toBeLessThanOrEqual(1);
      expect(w.penetration).toBeLessThanOrEqual(6);
      const b = buildOf(w);
      expect(b.overallMm, w.id).toBeGreaterThan(w.build?.layout === 'bullpup' ? w.barrelMm + 300 : w.barrelMm + 350);
      expect(b.feed).toBe(w.magazine > 1 ? 'magazine' : 'single');
      if (w.tier !== 'standard') {
        expect(w.optic, w.id).toBeTruthy();
        expect(w.build, w.id).toBeTruthy();
        // la course de tourelle annoncée tient dans la lunette et l'embase réelles
        expect(w.turretMaxMil, w.id).toBeLessThanOrEqual(usableElevation(w.optic!.travelMil, w.optic!.railMoa));
        expect(w.scope).toEqual(w.optic!.model.includes('7-35') ? [7, 35] : [5, 25]);
      }
    }
    // énergie à la bouche croissante dans la famille ELR, du .338 au .50
    const e = weaponsOfTier('elr').map((w) => 0.5 * w.bulletGr * GRAIN_KG * w.v0 ** 2);
    for (let i = 1; i < e.length; i++) expect(e[i], weaponsOfTier('elr')[i].id).toBeGreaterThan(e[i - 1]);
    expect(e[e.length - 1]).toBeGreaterThan(17000);
    // chaque calibre intermédiaire porte plus loin que le .308 et moins que le .338 lourd, en supersonique
    const reach = (id: string) => firingSolution(W(id), { range: 300, air: GAME_AIR })!.subsonicRange!;
    expect(reach('6cm')).toBeGreaterThan(reach('308'));
    expect(reach('65prc')).toBeGreaterThan(reach('65cm'));
    expect(reach('7prc')).toBeGreaterThan(reach('65prc'));
    expect(reach('33xc')).toBeGreaterThan(reach('338lm300'));
    for (const id of ELR_BEYOND_338) expect(reach(id), id).toBeGreaterThan(reach('338lm'));
  });
  it('[cohérence] un tir à 2 500 m est réglable avec les calibres ELR (tourelle + réticule), dans l’air du jeu et en OACI', () => {
    const dialable2500 = ['33xc', '375ct', '50bmg'];
    for (const id of ELR_BEYOND_338) {
      const w = W(id);
      for (const air of [GAME_AIR, ICAO]) {
        const s = firingSolution(w, { range: 2500, air })!;
        expect(s, id).not.toBeNull();
        expect(s.elevMil, `${id} : ${s.elevMil.toFixed(1)} mrad`).toBeLessThan(w.turretMaxMil + RETICLE_HOLD_MIL);
        expect(s.holdMil).toBeCloseTo(Math.max(0, s.elevMil - w.turretMaxMil), 9);
        expect(s.tof).toBeGreaterThan(4);
        expect(s.tof).toBeLessThan(7);
      }
      const g = firingSolution(w, { range: 2500, air: GAME_AIR })!;
      expect(g.dialable, `${id} : ${g.elevMil.toFixed(1)} mrad pour ${w.turretMaxMil}`).toBe(dialable2500.includes(id));
      // le mile et les 2 000 m se règlent entièrement à la tourelle
      expect(firingSolution(w, { range: 2000, air: ICAO })!.dialable, id).toBe(true);
    }
    // le .338 LM 300 gr règle le mile à la tourelle, pas les 2 500 m
    expect(firingSolution(W('338lm300'), { range: 1609, air: ICAO })!.dialable).toBe(true);
    expect(firingSolution(W('338lm300'), { range: 2500, air: GAME_AIR })!.dialable).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('stabilité numérique et coût', () => {
  it('[cohérence] l’intégration à 1/400 s est convergée à 2 500 m (écart < 1 cm avec un pas dix fois plus fin)', () => {
    for (const id of ['33xc', '408ct', '50bmg']) {
      const w = W(id);
      const env = fullEnv({ altitudeM: 600, temperatureC: 18 });
      const a = firingSolution(w, { range: 2500, azimuthDeg: 40, windSpeed: 5, windFromDeg: 300, heightDiff: -300, air: GAME_AIR, env })!;
      const b = firingSolution(w, { range: 2500, azimuthDeg: 40, windSpeed: 5, windFromDeg: 300, heightDiff: -300, air: GAME_AIR, env, dt: 1 / 4000 })!;
      expect(Math.abs(a.elevMil - b.elevMil) * 2.5, id).toBeLessThan(0.01);
      expect(Math.abs(a.windMil - b.windMil) * 2.5, id).toBeLessThan(0.01);
      expect(Math.abs(a.tof - b.tof), id).toBeLessThan(0.002);
      expect(Math.abs(a.velocity - b.velocity), id).toBeLessThan(0.05);
    }
  });
  it('[cohérence] vol long : aucune valeur non finie, vitesse bornée, 20 s de vol', () => {
    for (const w of WEAPONS) {
      const f = makeFlight(w, fullEnv({ altitudeM: 1600, temperatureC: 5 }), { air: GAME_AIR, frame: 'world', y0: 400 });
      const s: BulletState = { x: 0, y: 400, z: 0, vx: f.v0 * 0.6, vy: f.v0 * 0.3, vz: -f.v0 * 0.74, t: 0 };
      let vmax = 0;
      for (let i = 0; i < 8000; i++) {
        stepFlight(s, 1 / 400, f, 6, 0, -3);
        const v = Math.hypot(s.vx, s.vy, s.vz);
        if (v > vmax) vmax = v;
        if (!Number.isFinite(s.x + s.y + s.z + v)) throw new Error(`${w.id} : valeur non finie au pas ${i}`);
      }
      expect(vmax).toBeLessThan(f.v0 * 1.001);
      expect(s.t).toBeCloseTo(20, 6);
    }
  });
  it('coût mesuré : un pas de vol et une solution complète à 2 500 m', () => {
    const w = W('416b');
    const env = fullEnv({ altitudeM: 600, temperatureC: 18 });
    const full = makeFlight(w, env, { air: GAME_AIR, frame: 'world' });
    const plain = makeFlight(W('338lm'), undefined, { air: GAME_AIR });
    const bench = (f: ReturnType<typeof makeFlight>): number => {
      const N = 200000;
      let best = Infinity;
      for (let k = 0; k < 5; k++) {
        const s = state(f.v0, 0.03);
        const t0 = performance.now();
        for (let i = 0; i < N; i++) { if (s.t > 6) { s.x = s.y = s.z = 0; s.vx = f.v0; s.vy = 20; s.vz = 0; s.t = 0; } stepFlight(s, 1 / 400, f, 2, 0, -3); }
        best = Math.min(best, (performance.now() - t0) / N);
      }
      return best * 1000; // µs par pas
    };
    const usFull = bench(full), usPlain = bench(plain);
    const setup = { range: 2500, azimuthDeg: 90, windSpeed: 5, windFromDeg: 0, air: GAME_AIR, env };
    for (let i = 0; i < 20; i++) firingSolution(w, setup);
    let best = Infinity;
    for (let k = 0; k < 30; k++) { const t0 = performance.now(); firingSolution(w, setup); best = Math.min(best, performance.now() - t0); }
    let bestP = Infinity;
    for (let k = 0; k < 30; k++) { const t0 = performance.now(); predictImpact(w, setup, 33, -4); bestP = Math.min(bestP, performance.now() - t0); }
    console.log(`[perf] pas de vol : ${usPlain.toFixed(3)} µs (origine, G1) ; ${usFull.toFixed(3)} µs (G7 + densité + Coriolis + dérive gyroscopique) ; solution complète à 2 500 m : ${best.toFixed(2)} ms ; impact prédit : ${bestP.toFixed(2)} ms`);
    // un tir de 6 s = 2 400 pas : à 1 µs le pas, 2,4 ms de calcul pour tout le vol. Bornes larges (machines de CI lentes).
    expect(usFull).toBeLessThan(5);
    expect(best).toBeLessThan(40);
    expect(bestP).toBeLessThan(10);
  });
});
