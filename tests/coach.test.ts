// Conseil après tirs manqués : déclenchement, diagnostic des impacts, arme adaptée ou non (solutions de tir réelles
// des armes du jeu), texte selon le niveau.
import { describe, expect, it } from 'vitest';
import { firingSolution, type FiringSolution } from '../src/ballistics/firing-solution';
import { GAME_AIR } from '../src/ballistics/solver';
import { SIGHT_HEIGHT, weaponById, type WeaponDef } from '../src/config/weapons';
import { CoachTracker, MISS_THRESHOLD, REMIND_AFTER, WEAK_THRESHOLD, WIND_BETTER, assessWeapon, buildAdvice, diagnose, weaponIssues, type CoachContext } from '../src/game/coach';
import { WEAPON_IDS as rackFacile } from '../src/levels/facile/map';
import { WEAPON_IDS as rackStandard } from '../src/levels/standard/map';
import { WEAPON_IDS as rackAvance } from '../src/levels/avance/map';

const W = (id: string): WeaponDef => weaponById(id)!;
const rack = (ids: string[]): WeaponDef[] => ids.map(W);
/** solution de tir dans l'air du jeu, vent de plein travers venant de la gauche */
const solveAt = (range: number, wind = 3) => (w: WeaponDef): FiringSolution | null => firingSolution(w, { range, windSpeed: wind, windFromDeg: 270, azimuthDeg: 0, air: GAME_AIR, sightHeight: SIGHT_HEIGHT });
const miss = (up = -0.8, right = 0.1, target = 'plate') => ({ kind: 'miss' as const, target, offset: { up, right } });

describe('déclenchement', () => {
  it('rien avant le troisième tir manqué de suite, conseil au troisième', () => {
    const c = new CoachTracker();
    expect(MISS_THRESHOLD).toBe(3);
    expect(c.record(miss())).toBeNull();
    expect(c.record(miss())).toBeNull();
    expect(c.visible).toBe(false);
    expect(c.record(miss())).toEqual({ show: 'miss', reminder: false });
    expect(c.visible).toBe(true);
    expect(c.streak).toBe(3);
  });
  it('une touche entre-temps remet le compte à zéro', () => {
    const c = new CoachTracker();
    c.record(miss()); c.record(miss());
    expect(c.record({ kind: 'hit', target: 'plate' })).toBeNull();
    expect(c.streak).toBe(0);
    expect(c.record(miss())).toBeNull();
    expect(c.record(miss())).toBeNull();
    expect(c.record(miss())).toEqual({ show: 'miss', reminder: false });
  });
  it('une touche referme le conseil affiché', () => {
    const c = new CoachTracker();
    for (let i = 0; i < 3; i++) c.record(miss());
    expect(c.record({ kind: 'hit', target: 'plate' })).toEqual({ hide: true });
    expect(c.visible).toBe(false);
  });
  it('une fois par cible, puis un seul rappel quatre tirs manqués plus tard', () => {
    const c = new CoachTracker();
    const got: unknown[] = [];
    for (let i = 0; i < 20; i++) got.push(c.record(miss()));
    const shown = got.map((g, i) => (g ? i + 1 : 0)).filter(Boolean);
    expect(shown).toEqual([MISS_THRESHOLD, MISS_THRESHOLD + REMIND_AFTER]);
    expect(got[MISS_THRESHOLD + REMIND_AFTER - 1]).toEqual({ show: 'miss', reminder: true });
  });
  it('fermé par le joueur : il ne revient qu’en rappel', () => {
    const c = new CoachTracker();
    for (let i = 0; i < 3; i++) c.record(miss());
    c.dismiss();
    expect(c.visible).toBe(false);
    for (let i = 0; i < REMIND_AFTER - 1; i++) expect(c.record(miss())).toBeNull();
    expect(c.record(miss())).toEqual({ show: 'miss', reminder: true });
  });
  it('le compte est par cible : changer de cible repart de zéro, chaque cible a droit à son conseil', () => {
    const c = new CoachTracker();
    c.record(miss(-1, 0, 'a')); c.record(miss(-1, 0, 'a'));
    expect(c.record(miss(-1, 0, 'b'))).toBeNull();
    expect(c.streak).toBe(1);
    c.record(miss(-1, 0, 'b'));
    expect(c.record(miss(-1, 0, 'b'))).toEqual({ show: 'miss', reminder: false });
    c.clear();
    c.record(miss(-1, 0, 'a')); c.record(miss(-1, 0, 'a'));
    expect(c.record(miss(-1, 0, 'a'))).toEqual({ show: 'miss', reminder: false });
  });
  it('touches sans effet : conseil de calibre à la deuxième, une seule fois ; elles ne comptent pas comme tirs manqués', () => {
    const c = new CoachTracker();
    expect(WEAK_THRESHOLD).toBe(2);
    c.record(miss()); c.record(miss());
    expect(c.record({ kind: 'weak', target: 'plate' })).toBeNull();
    expect(c.streak).toBe(0);
    expect(c.record({ kind: 'weak', target: 'plate' })).toEqual({ show: 'weak', reminder: false });
    expect(c.record({ kind: 'weak', target: 'plate' })).toBeNull();
  });
});

describe('diagnostic des impacts', () => {
  it('trois tirs trop bas : écart moyen', () => {
    const d = diagnose([{ up: -0.7, right: 0.05 }, { up: -0.9, right: -0.1 }, { up: -0.8, right: 0.1 }])!;
    expect(d.vertical).toEqual({ mil: expect.closeTo(0.8, 5), low: true });
    expect(d.horizontal).toBeNull();
    expect(d.scattered).toBeNull();
  });
  it('trop haut et à droite', () => {
    const d = diagnose([{ up: 1.2, right: 0.9 }, { up: 1.0, right: 1.1 }, { up: 1.1, right: 1.0 }])!;
    expect(d.vertical).toMatchObject({ low: false });
    expect(d.horizontal).toEqual({ mil: expect.closeTo(1, 5), left: false });
  });
  it('à gauche seulement', () => {
    const d = diagnose([{ up: 0.1, right: -1.5 }, { up: -0.1, right: -1.4 }, { up: 0.05, right: -1.7 }])!;
    expect(d.vertical).toBeNull();
    expect(d.horizontal).toMatchObject({ left: true });
  });
  it('impacts de part et d’autre : aucune tendance inventée', () => {
    expect(diagnose([{ up: 0.4, right: -0.3 }, { up: -0.5, right: 0.4 }, { up: 0.2, right: 0.1 }])).toBeNull();
  });
  it('impacts très étalés sans tendance : dispersion signalée, avec son étendue', () => {
    const d = diagnose([{ up: 2.0, right: -1 }, { up: -1.5, right: 1.2 }, { up: 0.3, right: 0.2 }])!;
    expect(d.vertical).toBeNull();
    expect(d.horizontal).toBeNull();
    expect(d.scattered).toBeCloseTo(3.5, 5);
  });
  it('du même côté mais trop étalés pour chiffrer un écart : pas de valeur', () => {
    const d = diagnose([{ up: -0.2, right: 0 }, { up: -3, right: 0.1 }, { up: -1.2, right: -0.1 }]);
    expect(d?.vertical ?? null).toBeNull();
  });
  it('écarts non mesurables : rien', () => {
    expect(diagnose([null, null, null])).toBeNull();
    expect(diagnose([null, { up: -1, right: 0 }, null])).toBeNull();
    expect(diagnose([])).toBeNull();
  });
  it('seuls les trois derniers tirs comptent', () => {
    const d = diagnose([{ up: 5, right: 5 }, { up: -0.8, right: 0 }, { up: -0.8, right: 0 }, { up: -0.8, right: 0 }])!;
    expect(d.n).toBe(3);
    expect(d.vertical).toMatchObject({ low: true });
  });
});

describe('arme adaptée ou non à la distance (solutions de tir réelles)', () => {
  const kinds = (id: string, range: number, ids: string[], wind = 3, width = 0.5) => {
    const a = assessWeapon(W(id), rack(ids), solveAt(range, wind), { targetWidth: width });
    return { kinds: a.issues.map((i) => i.kind), alt: a.alternatives.map((w) => w.id), a };
  };
  it('.22 LR à 300 m (râtelier facile) : dérive au vent supérieure à la cible, d’autres armes font nettement mieux', () => {
    // vent de 4 m/s : 0,7 m de dérive pour une plaque de 0,5 m ; le .223 dérive trois fois moins
    const r = kinds('22lr', 300, rackFacile, 4);
    expect(r.kinds).toEqual(['wind']);
    const drift = Math.abs(solveAt(300, 4)(W('22lr'))!.deflection.wind);
    expect(drift).toBeGreaterThan(0.6);
    expect(r.alt.length).toBeGreaterThanOrEqual(1);
    for (const id of r.alt) {
      expect(rackFacile).toContain(id);
      expect(Math.abs(solveAt(300, 4)(W(id))!.deflection.wind)).toBeLessThanOrEqual(WIND_BETTER * drift);
    }
    // la moins puissante des armes qui conviennent d'abord
    expect(r.alt[0]).toBe('223');
  });
  it('.223 à 600 m (râtelier standard) : encore supersonique, mais dérive de 1,4 mrad pour 3 m/s ; d’autres armes dérivent deux fois moins', () => {
    const r = kinds('223', 600, rackStandard);
    const s = solveAt(600)(W('223'))!;
    expect(s.mach).toBeGreaterThan(1.2);
    expect(r.kinds).toEqual(['wind']);
    expect(r.a.issues[0]).toMatchObject({ kind: 'wind', width: 0.5 });
    expect((r.a.issues[0] as any).mil).toBeCloseTo(1.37, 1);
    expect(r.alt.length).toBeGreaterThanOrEqual(1);
    expect(r.alt.length).toBeLessThanOrEqual(2);
    for (const id of r.alt) expect(Math.abs(solveAt(600)(W(id))!.deflection.wind)).toBeLessThanOrEqual(WIND_BETTER * 0.83);
  });
  it('.308 à 1 000 m : transsonique à l’arrivée (Mach 1,04)', () => {
    const r = kinds('308', 1000, rackStandard);
    expect(r.kinds).toContain('transonic');
    expect((r.a.issues.find((i) => i.kind === 'transonic') as any).mach).toBeCloseTo(1.04, 1);
    expect(r.alt.length).toBeGreaterThanOrEqual(1);
    for (const id of r.alt) expect(weaponIssues(W(id), solveAt(1000)(W(id)))).toEqual([]);
    expect(r.alt).not.toContain('308sub');
  });
  it('.300 PRC à 2 000 m (râtelier avancé) : subsonique à l’arrivée et au-delà de la course de tourelle', () => {
    const r = kinds('300prc', 2000, rackAvance, 3, 1);
    expect(r.kinds).toEqual(expect.arrayContaining(['subsonic', 'turret']));
    expect(r.alt.length).toBeGreaterThanOrEqual(1);
    // à 2 000 m aucune arme n'est sans reproche (la contre-visée est la règle) : celles proposées restent supersoniques
    for (const id of r.alt) { expect(rackAvance).toContain(id); expect(solveAt(2000)(W(id))!.mach).toBeGreaterThanOrEqual(1); }
  });
  it('arme qui convient : aucun défaut, aucune suggestion', () => {
    for (const [id, range, ids] of [['308', 400, rackStandard], ['65cm', 600, rackStandard], ['338lm', 1000, rackStandard], ['300prc', 1000, rackAvance], ['22lr', 100, rackFacile], ['223', 300, rackFacile]] as const) {
      const r = kinds(id, range, ids as string[]);
      expect(r.kinds, `${id} à ${range} m`).toEqual([]);
      expect(r.alt, `${id} à ${range} m`).toEqual([]);
    }
  });
  it('sans vent, pas de critère de vent ; une arme subsonique d’origine n’est pas jugée sur le mur du son', () => {
    expect(kinds('22lr', 300, rackFacile, 0).kinds).toEqual([]);
    expect(weaponIssues(W('308sub'), solveAt(200)(W('308sub')))).toEqual([]);
    expect(weaponIssues(W('22lr'), solveAt(150)(W('22lr')))).toEqual([]);
  });
  it('vent fort que tout le râtelier subit : tir difficile, pas arme mal choisie', () => {
    // .338 LM à 1 000 m : 1,1 m de dérive pour une plaque de 0,5 m, mais aucune arme du râtelier standard ne dérive moitié moins
    const r = kinds('338lm', 1000, rackStandard);
    expect(Math.abs(solveAt(1000)(W('338lm'))!.deflection.wind)).toBeGreaterThan(0.5);
    expect(r.kinds).toEqual([]);
  });
  it('hors de portée', () => {
    expect(weaponIssues(W('22lr'), null)).toEqual([{ kind: 'range' }]);
  });
  it('cible touchée sans effet : énergie à l’arrivée citée, suggestion d’armes plus pénétrantes et plus énergiques', () => {
    const s = solveAt(250)(W('22lr'))!;
    const a = assessWeapon(W('22lr'), rack(rackStandard), solveAt(250), { targetWidth: 0.6, weak: true, weakEnergy: s.energy });
    expect(a.issues.map((i) => i.kind)).toContain('energy');
    expect(a.alternatives.length).toBeGreaterThanOrEqual(1);
    for (const w of a.alternatives) { expect(w.penetration).toBeGreaterThan(W('22lr').penetration); expect(solveAt(250)(w)!.energy).toBeGreaterThan(1.5 * s.energy); }
  });
});

describe('texte du conseil', () => {
  const base = (over: Partial<CoachContext> = {}): CoachContext => {
    const weapon = over.weapon ?? W('308');
    const range = over.range === undefined ? 412 : over.range;
    const solution = over.solution === undefined ? solveAt(412)(weapon) : over.solution;
    return { touch: false, difficulty: 'standard', reason: 'miss', reminder: false, misses: 3, weapon, range, solution, elevDial: 1.2, windDial: 0, windSpeed: 3, diagnosis: null, issues: [], alternatives: [], intel: 'Plaque carrée de 50 cm.', advancedBook: false, ...over };
  };
  const all = (a: ReturnType<typeof buildAdvice>): string => [a.title, a.diag, a.why, ...a.steps, a.calibre].join('\n');

  it('standard, distance mesurée : chiffres réels de l’arme (distance, chute, carnet, tourelle, écart en clics)', () => {
    const c = base();
    const a = buildAdvice(c);
    const s = c.solution!;
    const book = s.parts.drop + s.parts.coriolisV;
    const f1 = (n: number): string => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    expect(a.title).toBe('Trois tirs manqués : reprenons le réglage');
    expect(a.why).toContain('412 m');
    expect(a.why).toContain('.308 Win');
    expect(a.why).toContain(`${Math.abs(s.deflection.drop).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`);
    expect(a.why).toContain(`${f1(book)} mrad`);
    expect(a.steps).toHaveLength(4);
    expect(a.steps[0]).toContain('<b>T</b>');
    expect(a.steps[1]).toContain('<b>Tab</b>');
    expect(a.steps[2]).toContain('<b>↑ ↓</b>');
    expect(a.steps[2]).toContain(`Votre tourelle est à 1,2 mrad, le carnet donne ${f1(book)} : montez de ${f1(book - 1.2)} mrad (${Math.round((book - 1.2) * 10)} clics)`);
    expect(a.steps[3]).toContain('3,0 m/s');
    expect(a.calibre).toBe('');
    expect(a.close).toContain('Entrée');
    expect(a.short).toContain(`Carnet à 412 m : ${f1(book)} mrad ; tourelle : 1,2.`);
  });
  it('tourelle déjà à la valeur du carnet : le conseil le dit au lieu d’inventer un écart', () => {
    const c = base();
    const book = c.solution!.parts.drop + c.solution!.parts.coriolisV;
    const a = buildAdvice({ ...c, elevDial: Math.round(book * 10) / 10 });
    expect(a.steps[2]).toContain('c’est la valeur du carnet');
    expect(a.steps[2]).not.toContain('montez');
  });
  it('standard, distance non mesurée : pas de chiffre inventé, le télémètre d’abord', () => {
    const a = buildAdvice(base({ range: null }));
    expect(a.steps[0]).toMatch(/^<b>T<\/b> en visant la cible/);
    expect(all(a)).not.toMatch(/Votre tourelle est à/);
    expect(all(a)).not.toMatch(/\d+ m\/s de vent/);
    expect(a.short).toContain('Mesurez la distance');
  });
  /** consignes chiffrées de l'encart complet, par axe : tout impératif suivi d'une valeur en mrad ou en clics */
  const orders = (a: ReturnType<typeof buildAdvice>): { v: string[]; h: string[] } => {
    const t = [a.diag, a.why, ...a.steps, a.calibre].join('\n').replace(/<\/?b>/g, '');
    const grab = (res: RegExp[]): string[] => res.flatMap((re) => [...t.matchAll(re)].map((m) => m[0]));
    return {
      v: grab([/(montez|descendez)[^.;\n]*? de [\d,]+ mrad/gi, /visez [\d,]+ mrad plus (haut|bas)/gi]),
      h: grab([/corrigez la dérive de [\d,]+ mrad à (gauche|droite)/gi, /tournez-la de \d+ clics? vers la (gauche|droite)/gi, /visez [\d,]+ mrad plus à (gauche|droite)/gi]),
    };
  };
  const bookOf = (c: CoachContext): number => Math.round((c.solution!.parts.drop + c.solution!.parts.coriolisV) * 10) / 10;
  const low = (mil: number) => diagnose([{ up: -mil + 0.1, right: 0 }, { up: -mil - 0.1, right: 0.1 }, { up: -mil, right: -0.1 }]);
  const high = (mil: number) => diagnose([{ up: mil + 0.1, right: 0 }, { up: mil - 0.1, right: 0.1 }, { up: mil, right: -0.1 }]);
  const right = (mil: number) => diagnose([{ up: 0.1, right: mil + 0.1 }, { up: -0.1, right: mil - 0.1 }, { up: 0, right: mil }]);
  const left = (mil: number) => diagnose([{ up: 0.1, right: -mil + 0.1 }, { up: -0.1, right: -mil - 0.1 }, { up: 0, right: -mil }]);

  it('carnet non chiffré (distance non mesurée) : l’écart mesuré est la seule consigne, en mrad et en clics', () => {
    const a = buildAdvice(base({ range: null, diagnosis: low(0.8) }));
    expect(a.diag).toBe('Vos trois derniers tirs sont passés environ 0,8 mrad trop bas. Le plus direct : montez l’élévation de 0,8 mrad (8 clics).');
    expect(a.short.startsWith('Impacts 0,8 mrad trop bas.')).toBe(true);
    const b = buildAdvice(base({ range: null, diagnosis: right(1.1) }));
    expect(b.diag).toContain('1,1 mrad trop à droite');
    expect(b.diag).toContain('corrigez la dérive de 1,1 mrad à gauche');
    expect(buildAdvice(base()).diag).toBe('');
  });
  it('tirs trop bas, tourelle sous le carnet (le cas de la capture) : une seule consigne, celle du carnet ; la mesure est expliquée', () => {
    const c = base({ elevDial: 0, diagnosis: low(2 * bookOf(base())) });
    const book = bookOf(c), f1 = (n: number): string => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const a = buildAdvice(c);
    expect(a.diag).toBe(`Vos trois derniers tirs sont passés environ ${f1(2 * book)} mrad trop bas. La tourelle n’est pas réglée pour cette distance : commencez par la mettre à la valeur du carnet (étape 3). Si les tirs restent bas ensuite, c’est la visée ou le vent.`);
    expect(a.diag).not.toMatch(/montez|descendez|clic/);
    expect(orders(a).v).toEqual([`montez de ${f1(book)} mrad`]);
    expect(a.steps[2]).toContain(`Votre tourelle est à 0,0 mrad, le carnet donne ${f1(book)} : montez de ${f1(book)} mrad (${Math.round(book * 10)} clics).`);
  });
  it('écart mesuré = écart tourelle/carnet : le conseil le dit, consigne à l’étape 3', () => {
    const c = base({ elevDial: 0 });
    const a = buildAdvice({ ...c, diagnosis: low(bookOf(c) + 0.1) });
    expect(a.diag).toContain('C’est à peu près ce qui manque à votre tourelle pour cette distance : mettez-la à la valeur du carnet (étape 3).');
    expect(orders(a).v).toHaveLength(1);
    expect(orders(a).v[0]).toMatch(/^montez de /);
  });
  it('tirs trop hauts, tourelle sous le carnet : contre-visée supposée, consigne unique = le carnet', () => {
    const a = buildAdvice(base({ elevDial: 0, diagnosis: high(1.1) }));
    expect(a.diag).toContain('1,1 mrad trop haut');
    expect(a.diag).toContain('Votre tourelle est pourtant sous la valeur du carnet : vous visez sans doute au-dessus de la cible pour compenser. Mettez-la à la valeur du carnet (étape 3), puis visez le centre.');
    expect(orders(a).v).toHaveLength(1);
    expect(orders(a).v[0]).toMatch(/^montez de /);
    // tourelle au-dessus du carnet, tirs trop hauts : on la redescend
    const c = base();
    const b = buildAdvice({ ...c, elevDial: bookOf(c) + 1.5, diagnosis: high(2.4) });
    expect(b.diag).toContain('Si les tirs restent hauts ensuite');
    expect(orders(b).v).toEqual(['descendez de 1,5 mrad']);
  });
  it('tourelle déjà au carnet mais tirs décalés : la consigne est l’écart mesuré, au réticule ; l’étape 3 ne chiffre rien', () => {
    const c = base();
    const a = buildAdvice({ ...c, elevDial: bookOf(c), diagnosis: low(0.8) });
    expect(a.diag).toBe('Vos trois derniers tirs sont passés environ 0,8 mrad trop bas. Votre tourelle est déjà à la valeur du carnet : l’écart vient de la visée, de la tenue de l’arme ou du vent. Pour le rattraper sans la dérégler, visez 0,8 mrad plus haut, sur les graduations du réticule.');
    expect(a.steps[2]).toContain('c’est la valeur du carnet');
    expect(orders(a).v).toEqual(['visez 0,8 mrad plus haut']);
  });
  it('dérive : mêmes règles avec la correction que demande le vent (étape 4)', () => {
    const c = base();
    const need = c.solution!.windMil, f1 = (n: number): string => Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    // vent venant de la gauche : la balle part à droite, la correction se prend à gauche
    expect(need).toBeLessThan(-0.3);
    const a = buildAdvice({ ...c, diagnosis: right(1.6) });
    expect(a.diag).toBe('Vos trois derniers tirs sont passés environ 1,6 mrad trop à droite. La dérive n’est pas réglée pour ce vent : commencez par là (étape 4). Si les tirs restent à droite ensuite, c’est la visée ou une saute de vent.');
    expect(a.steps[3]).toContain(`Ici, avec 3,0 m/s de vent, il faut ${f1(need)} mrad à gauche et votre tourelle est à 0,0 mrad : tournez-la de ${Math.round(Math.abs(need) * 10)} clics vers la gauche.`);
    expect(orders(a).h).toHaveLength(1);
    // tourelle de dérive déjà juste : écart mesuré, au réticule
    const b = buildAdvice({ ...c, windDial: Math.round(need * 10) / 10, diagnosis: left(0.9) });
    expect(b.diag).toContain('Votre tourelle est déjà à la valeur que demande ce vent');
    expect(b.steps[3]).toContain('votre tourelle y est');
    expect(orders(b).h).toEqual(['visez 0,9 mrad plus à droite']);
    // tourelle réglée du mauvais côté et tirs à gauche : le joueur compense
    const d = buildAdvice({ ...c, windDial: 1, diagnosis: left(0.9) });
    expect(d.diag).toContain('décalée dans l’autre sens');
    expect(orders(d).h).toHaveLength(1);
    // deux axes : une phrase par axe
    const e = buildAdvice({ ...c, elevDial: 0, diagnosis: diagnose([{ up: -3, right: 1.5 }, { up: -3.1, right: 1.6 }, { up: -2.9, right: 1.7 }]) });
    expect(e.diag).toContain('En hauteur : ');
    expect(e.diag).toContain('En dérive : ');
    expect(orders(e)).toMatchObject({ v: [expect.stringMatching(/^montez de /)], h: [expect.stringMatching(/^tournez-la de /)] });
  });
  it('jamais deux consignes chiffrées pour le même axe, quels que soient le niveau, les tourelles et les impacts', () => {
    const c0 = base();
    const book = bookOf(c0), need = Math.round(c0.solution!.windMil * 10) / 10;
    const diags = [null, low(0.8), low(2.6), low(book), high(1.1), high(3), left(1.2), right(0.9), right(Math.abs(need)), left(Math.abs(need)),
      diagnose([{ up: -2.6, right: 1.1 }, { up: -2.5, right: 1.2 }, { up: -2.7, right: 1 }]), diagnose([{ up: 1.4, right: -0.8 }, { up: 1.5, right: -0.9 }, { up: 1.3, right: -0.7 }]),
      diagnose([{ up: 2.0, right: -1 }, { up: -1.5, right: 1.2 }, { up: 0.3, right: 0.2 }])];
    let n = 0;
    for (const difficulty of ['standard', 'assist', 'real'] as const)
      for (const known of difficulty === 'real' ? [false] : [true, false])
        for (const elevDial of [0, 0.5, book, book + 0.1, book + 1.5])
          for (const windDial of [0, need, -need, need + 0.4])
            for (const touch of [false, true])
              for (const weapon of [W('308'), W('22lr')])
                for (const diagnosis of diags) {
                  const sol = solveAt(weapon.id === '22lr' ? 80 : 412)(weapon);
                  const a = buildAdvice(base({ difficulty, touch, weapon, solution: sol, range: known ? (weapon.id === '22lr' ? 80 : 412) : null, windSpeed: difficulty === 'real' ? null : 3, elevDial, windDial, diagnosis }));
                  const o = orders(a);
                  const tag = JSON.stringify({ difficulty, known, elevDial, windDial, w: weapon.id, d: diagnosis }) + '\n' + [a.diag, ...a.steps].join('\n');
                  expect(o.v.length, tag).toBeLessThanOrEqual(1);
                  expect(o.h.length, tag).toBeLessThanOrEqual(1);
                  // une tendance mesurée reçoit toujours sa consigne, sauf si le réglage du carnet est déjà fait ailleurs dans l'encart
                  if (diagnosis?.vertical && difficulty !== 'real') expect(o.v.length, tag).toBe(1);
                  if (diagnosis?.horizontal && difficulty !== 'real') expect(o.h.length, tag).toBe(1);
                  // le diagnostic ne chiffre de correction que s'il porte la consigne de l'axe
                  expect((a.diag.match(/\d+ clics?/g) ?? []).length, tag).toBeLessThanOrEqual(1);
                  n++;
                }
    expect(n).toBeGreaterThan(1500);
  });
  it('tactile : boutons à la place des touches, aucune touche de clavier citée', () => {
    const a = buildAdvice(base({ touch: true, range: null }));
    expect(a.steps[0]).toContain('Bouton <b>Télémètre</b>');
    expect(a.steps[1]).toContain('Bouton <b>Carnet</b>');
    expect(a.close).toBe('');
    const cal = buildAdvice(base({ touch: true, weapon: W('223'), solution: solveAt(600)(W('223')), range: 600, ...assessWeapon(W('223'), rack(rackStandard), solveAt(600), { targetWidth: 0.5 }) }));
    expect(cal.calibre).toContain('bouton <b>Râtelier</b>');
    for (const t of [all(a), all(cal), a.short, cal.short]) expect(t).not.toMatch(/<b>(T|Tab|E|Entrée|Espace|↑ ↓|← →)<\/b>/);
  });
  it('niveau facile (assisté) : s’appuie sur la distance affichée et le losange d’impact prédit, sans télémètre', () => {
    const a = buildAdvice(base({ difficulty: 'assist' }));
    expect(a.steps[0]).toContain('affichée en haut à droite');
    expect(a.steps[0]).toContain('412 m');
    expect(a.steps[3]).toContain('losange orange');
    expect(all(a)).not.toContain('<b>T</b>');
    expect(all(a)).not.toContain('Télémètre');
  });
  it('niveau avancé (sans aide) : estimation au réticule, carnet décomposé, ni télémètre ni distance ni correction révélées', () => {
    const w = W('300prc');
    const sol = firingSolution(w, { range: 1612, windSpeed: 4, windFromDeg: 250, azimuthDeg: 20, air: GAME_AIR, sightHeight: SIGHT_HEIGHT })!;
    const a = buildAdvice(base({ difficulty: 'real', weapon: w, range: null, solution: sol, windSpeed: null, advancedBook: true, intel: 'Gong rond de 60 cm.', elevDial: 9.4 }));
    const text = all(a);
    expect(a.steps[0]).toContain('taille connue de la cible (m) ÷ taille lue dans la lunette (mrad) × 1 000');
    expect(a.steps[0]).toContain('Gong rond de 60 cm.');
    expect(a.steps[1]).toContain('décomposé');
    expect(a.steps[1]).toContain('dérive gyroscopique + Coriolis');
    expect(a.steps[2]).toContain('Elle est à 9,4 mrad');
    expect(a.steps[2]).toContain('contre-visée');
    expect(text).not.toContain('<b>T</b>');
    expect(text).not.toMatch(/télémètre affiche/i);
    expect(text).not.toContain('1 612');
    expect(text).not.toContain(sol.elevMil.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mrad');
    expect(text).not.toMatch(/le carnet donne \d/);
    expect(a.short).toContain('Estimez la distance au réticule');
  });
  it('arme inadaptée : la raison chiffrée, une ou deux armes du râtelier, comment en changer', () => {
    const w = W('223');
    const as = assessWeapon(w, rack(rackStandard), solveAt(600), { targetWidth: 0.5 });
    const a = buildAdvice(base({ weapon: w, range: 600, solution: solveAt(600)(w), ...as }));
    expect(a.calibre).toMatch(/^À 600 m, le \.223 Rem dérive de 1,4 mrad par ce vent, soit 0,8 m pour une cible de 0,5 m\./);
    expect(as.alternatives.length).toBeGreaterThanOrEqual(1);
    for (const alt of as.alternatives) expect(a.calibre).toContain(`<b>${alt.name}</b> (${alt.caliber})`);
    expect(a.calibre).toContain('touche <b>E</b>');
    const t = W('308');
    const at = assessWeapon(t, rack(rackStandard), solveAt(1000), { targetWidth: 0.5 });
    const b = buildAdvice(base({ weapon: t, range: 1000, solution: solveAt(1000)(t), ...at }));
    expect(b.calibre).toContain('arrive en transsonique (Mach 1,04)');
  });
  it('arme inadaptée au niveau avancé : la raison sans la distance ni l’élévation', () => {
    const w = W('300prc');
    const as = assessWeapon(w, rack(rackAvance), solveAt(2000), { targetWidth: 1 });
    const a = buildAdvice(base({ difficulty: 'real', weapon: w, range: null, solution: solveAt(2000)(w), windSpeed: null, ...as }));
    expect(a.calibre.startsWith('À cette distance, le .300 PRC')).toBe(true);
    expect(a.calibre).not.toContain('2 000');
    expect(a.calibre).not.toContain('28,5');
    expect(a.calibre).toContain('course de sa tourelle (26,0 mrad)');
  });
  it('touché sans effet : on parle du calibre, pas du réglage', () => {
    const w = W('22lr');
    const s = solveAt(250)(w)!;
    const as = assessWeapon(w, rack(rackStandard), solveAt(250), { targetWidth: 0.6, weak: true, weakEnergy: s.energy });
    const a = buildAdvice(base({ reason: 'weak', weapon: w, range: 250, solution: s, ...as }));
    expect(a.title).toBe('Touché, mais sans effet');
    expect(a.steps).toEqual([]);
    expect(a.why).toContain('Votre visée est bonne');
    expect(a.calibre).toMatch(/n’a plus que \d+ J à l’arrivée/);
  });
  it('rappel : autre titre', () => {
    expect(buildAdvice(base({ reminder: true, misses: 7 })).title).toBe('Toujours pas au but');
  });
  it('phrase d’exemple du conseil sans distance : une .308 est bien descendue d’un mètre à 400 m', () => {
    expect(Math.abs(solveAt(400, 0)(W('308'))!.deflection.drop)).toBeCloseTo(1.06, 1);
  });
});
