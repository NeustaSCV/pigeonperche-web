// Classement : cœur partagé (jeu, serveur, greffon Vite), fichier du serveur, service du jeu. Sans réseau.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createScoreStore } from '../server/score-store.mjs';
import { createRateLimiter } from '../server/scores-api.mjs';
import { NAME_KEY, SCORES_KEY, ScoreService } from '../src/game/scores';
import { Mission } from '../src/game/mission';
import { meta as metaFacile } from '../src/levels/facile/meta';
import { meta as metaStandard } from '../src/levels/standard/meta';
import { meta as metaAvance } from '../src/levels/avance/meta';
import { RANGE_LIMIT as rangeFacile } from '../src/levels/facile/map';
import { RANGE_LIMIT as rangeStandard } from '../src/levels/standard/map';
import { RANGE_LIMIT as rangeAvance } from '../src/levels/avance/map';
import { STEPS as stepsFacile } from '../src/levels/facile/mission';
import { STEPS as stepsStandard } from '../src/levels/standard/mission';
import { STEPS as stepsAvance } from '../src/levels/avance/mission';
import { meta as metaFete } from '../src/levels/fete/meta';
import { meta as metaPhare } from '../src/levels/phare/meta';
import { meta as metaPlaine } from '../src/levels/plaine/meta';
import { BONUS_MAX as bonusFete, RANGE_LIMIT as rangeFete } from '../src/levels/fete/map';
import { BONUS_MAX as bonusPhare, RANGE_LIMIT as rangePhare } from '../src/levels/phare/map';
import { BONUS_MAX as bonusPlaine, RANGE_LIMIT as rangePlaine } from '../src/levels/plaine/map';
import { STEPS as stepsFete } from '../src/levels/fete/mission';
import { STEPS as stepsPhare } from '../src/levels/phare/mission';
import { STEPS as stepsPlaine } from '../src/levels/plaine/mission';
import {
  BOARD_SIZE, DEFAULT_NAME, GRADES, LEVEL_RULES, SCORES_VERSION, addEntry, cleanName, compareEntries, emptyBoards, escapeHtml, normalizeBoards, normalizeEntry,
  parseBoards, qualifies, rankOf, scoreBounds, serializeBoards, validateSubmission, type ScoreEntry, type ScoreLevel,
} from '../src/shared/scores-core.mjs';

const entry = (score: number, name = 'AAA', date = '2026-01-01T00:00:00.000Z'): ScoreEntry => ({ name, score, grade: GRADES[1], accuracy: 0.7, shots: 12, time: 300, date });
const good = { level: 'facile', name: 'Zoé', score: 15000, accuracy: 0.9, shots: 10, time: 300, grade: GRADES[0] };

describe('nom du joueur', () => {
  it('majuscules sans accent, 8 caractères, lettres chiffres espace tiret', () => {
    expect(cleanName('zoé')).toBe('ZOE');
    expect(cleanName('  jean-luc  picard ')).toBe('JEAN-LUC');
    expect(cleanName('a  b')).toBe('A B');
    expect(cleanName('abcdefghijkl')).toBe('ABCDEFGH');
    expect(cleanName('R2 D2')).toBe('R2 D2');
    expect(cleanName('ça_va')).toBe('CA-VA');
  });
  it('rien d’injectable ne survit', () => {
    expect(cleanName('<img src=x onerror=alert(1)>')).toBe('IMG SRCX');
    expect(cleanName('<b>"\'&;')).toBe('B');
    expect(cleanName('<script>')).toBe('SCRIPT');
    for (const raw of ['<svg/onload=1>', '"><i>', "';--", '&lt;', '\u0000‮']) expect(cleanName(raw)).toMatch(/^[A-Z0-9 -]{0,8}$/);
  });
  it('valeurs non textuelles et noms vides', () => {
    for (const raw of [null, undefined, 12, {}, [], '', '   ', '!!!', '日本']) expect(cleanName(raw)).toBe('');
  });
  it('saisie en cours : l’espace finale est gardée, pas l’espace initiale', () => {
    expect(cleanName('ab ', true)).toBe('AB ');
    expect(cleanName(' ab', true)).toBe('AB');
    expect(cleanName('ab ')).toBe('AB');
  });
  it('échappement HTML', () => {
    expect(escapeHtml('<b a="1">&\'')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
  });
});

describe('tri et limite du classement', () => {
  it('score décroissant, puis date croissante', () => {
    const list = [entry(100, 'B', '2026-02-01T00:00:00.000Z'), entry(300, 'C'), entry(100, 'A', '2026-01-01T00:00:00.000Z'), entry(200, 'D')];
    expect(list.sort(compareEntries).map((e) => e.name)).toEqual(['C', 'D', 'A', 'B']);
  });
  it('rang d’un nouveau score : derrière les scores égaux déjà inscrits', () => {
    const board = [entry(300), entry(200), entry(200), entry(100)];
    expect(rankOf(board, 400)).toBe(1);
    expect(rankOf(board, 200)).toBe(4);
    expect(rankOf(board, 50)).toBe(5);
    expect(rankOf([], 1)).toBe(1);
  });
  it('insertion à son rang, 20 lignes au plus, le dernier sort', () => {
    let board: ScoreEntry[] = [];
    for (let i = 1; i <= 25; i++) board = addEntry(board, entry(i * 100, 'N' + i)).board;
    expect(board).toHaveLength(BOARD_SIZE);
    expect(board[0].score).toBe(2500);
    expect(board[BOARD_SIZE - 1].score).toBe(600);
    for (let i = 1; i < board.length; i++) expect(board[i - 1].score).toBeGreaterThanOrEqual(board[i].score);
    // un score trop faible n'entre pas, le classement n'est pas modifié
    const out = addEntry(board, entry(600, 'TARD'));
    expect(out.rank).toBe(0);
    expect(out.board).toBe(board);
    expect(qualifies(board, 600)).toBe(false);
    expect(qualifies(board, 601)).toBe(true);
    const mid = addEntry(board, entry(1550, 'MID'));
    expect(mid.rank).toBe(11);
    expect(mid.board[10].name).toBe('MID');
    expect(mid.board).toHaveLength(BOARD_SIZE);
    expect(board).toHaveLength(BOARD_SIZE);
  });
});

describe('lecture de données enregistrées', () => {
  it('aller-retour', () => {
    const boards = emptyBoards();
    boards.standard = [entry(20000, 'ABC'), entry(15000, 'DEF')];
    expect(parseBoards(serializeBoards(boards))).toEqual({ boards, corrupt: false });
    expect(JSON.parse(serializeBoards(boards)).v).toBe(SCORES_VERSION);
  });
  it('texte vide ou absent : classement vide, pas une corruption', () => {
    for (const t of ['', '   ', null, undefined]) expect(parseBoards(t)).toEqual({ boards: emptyBoards(), corrupt: false });
  });
  it('JSON cassé, autre format, autre version : classement vide, signalé', () => {
    for (const t of ['{', 'null', '[]', '"x"', '42', '{"levels":{}}', '{"v":99,"levels":{}}', '{"v":1}', '{"v":1,"levels":7}']) expect(parseBoards(t)).toEqual({ boards: emptyBoards(), corrupt: true });
  });
  it('lignes abîmées écartées, lignes valides gardées, triées et bornées à 20', () => {
    const levels = {
      facile: [entry(100, 'OK'), null, 7, 'x', { name: 'SANS SCORE' }, { ...entry(1), score: 1.5 }, { ...entry(1), score: -4 }, { ...entry(1), score: '9' }, entry(900, '<b>x</b>')],
      standard: 'pas une liste',
      avance: Array.from({ length: 60 }, (_, i) => entry(i)),
      inconnu: [entry(5)],
    };
    const { boards, ok } = normalizeBoards({ v: SCORES_VERSION, levels });
    expect(ok).toBe(true);
    expect(boards.facile.map((e) => [e.name, e.score])).toEqual([['BXB', 900], ['OK', 100]]);
    expect(boards.standard).toEqual([]);
    expect(boards.avance).toHaveLength(BOARD_SIZE);
    expect(boards.avance[0].score).toBe(59);
    expect(Object.keys(boards)).toEqual(['facile', 'standard', 'avance', 'fete', 'phare', 'plaine']);
  });
  it('champs annexes remis dans leurs bornes', () => {
    const e = normalizeEntry({ name: '', score: 10, grade: '<i>', accuracy: 7, shots: -1, time: 'x', date: 'hier' })!;
    expect(e).toEqual({ name: DEFAULT_NAME, score: 10, grade: GRADES[3], accuracy: 1, shots: 0, time: 0, date: '1970-01-01T00:00:00.000Z' });
  });
});

describe('bornes du score par niveau', () => {
  // [fiche, objectifs, portée, plafond du bonus propre à la carte (0 : aucun)]
  const levels = {
    facile: [metaFacile, stepsFacile, rangeFacile, 0], standard: [metaStandard, stepsStandard, rangeStandard, 0], avance: [metaAvance, stepsAvance, rangeAvance, 0],
    fete: [metaFete, stepsFete, rangeFete, bonusFete], phare: [metaPhare, stepsPhare, rangePhare, bonusPhare], plaine: [metaPlaine, stepsPlaine, rangePlaine, bonusPlaine],
  } as const;
  it('les règles suivent les données des niveaux et le coefficient de Mission.score', () => {
    for (const id of Object.keys(levels) as (keyof typeof levels)[]) {
      const [meta, steps, range, bonus] = levels[id];
      const m = new Mission(new Map(), steps as any, null);
      m.difficulty = meta.difficulty;
      m.stats = [{ shots: 1, hits: 1, time: 1, distance: 0, weapon: '', points: 1000 }];
      // coefficient : score d'un seul objectif à 1 000 points, sans discrétion (alerte donnée)
      m.alarm = true;
      expect(LEVEL_RULES[id]).toEqual({ steps: steps.length, factor: m.score().total / 1000, range, ...(bonus ? { bonus } : {}) });
    }
  });
  it('un score parfait à portée maximale tient dans les bornes, un score au-delà est refusé', () => {
    for (const id of Object.keys(levels) as (keyof typeof levels)[]) {
      const [meta, steps, range, bonus] = levels[id];
      const m = new Mission(new Map(), steps as any, null);
      m.difficulty = meta.difficulty;
      // meilleur cas : chaque objectif en un tir instantané à la portée maximale de la carte, aucune alerte
      m.stats = steps.map(() => ({ shots: 1, hits: 1, time: 0, distance: range, weapon: '', points: Math.round(1000 + 600 + 300 + range * 0.5) }));
      // et tous les tirs d'adresse possibles (plafond par objectif)
      m.addSkill(1e9);
      // et tout le bonus propre à la carte
      m.bonusMax = bonus;
      m.addBonus(1e9);
      const best = m.score().total;
      const b = scoreBounds(id)!;
      expect(best).toBeLessThanOrEqual(b.max);
      expect(b.max - best).toBeLessThan(5);
      // pire cas : 1 000 points par objectif, alerte donnée
      m.stats = steps.map(() => ({ shots: 9, hits: 1, time: 999, distance: 0, weapon: '', points: 1000 }));
      m.alarm = true;
      expect(m.score().total).toBeGreaterThanOrEqual(b.min);
      const sub = { ...good, level: id, shots: 20, grade: GRADES[0] };
      expect(validateSubmission({ ...sub, score: b.max }).ok).toBe(true);
      expect(validateSubmission({ ...sub, score: b.min }).ok).toBe(true);
      expect(validateSubmission({ ...sub, score: b.max + 1 }).ok).toBe(false);
      expect(validateSubmission({ ...sub, score: b.min - 1 }).ok).toBe(false);
    }
    expect(scoreBounds('autre')).toBeNull();
  });
});

describe('validation d’une inscription (côté serveur)', () => {
  it('inscription correcte : nom nettoyé, précision arrondie, pas de date ni de champ en trop', () => {
    const v = validateSubmission({ ...good, accuracy: 0.912345, date: '1999-01-01T00:00:00.000Z', admin: true });
    expect(v).toEqual({ ok: true, level: 'facile', entry: { name: 'ZOE', score: 15000, grade: GRADES[0], accuracy: 0.9123, shots: 10, time: 300 } });
  });
  it('refus : niveau, nom, score, champs annexes, grade', () => {
    const bad: unknown[] = [
      null, 'x', [], 42,
      { ...good, level: 'expert' }, { ...good, level: 7 }, { ...good, level: '__proto__' },
      { ...good, name: '' }, { ...good, name: '<>' }, { ...good, name: 7 }, { ...good, name: undefined },
      { ...good, score: 15000.5 }, { ...good, score: '15000' }, { ...good, score: NaN }, { ...good, score: Infinity }, { ...good, score: 1e9 }, { ...good, score: -5 }, { ...good, score: 0 },
      { ...good, accuracy: 1.2 }, { ...good, accuracy: 0 }, { ...good, accuracy: '0.9' }, { ...good, accuracy: NaN },
      { ...good, shots: 2 }, { ...good, shots: 9.5 }, { ...good, shots: 1e6 },
      { ...good, time: 3 }, { ...good, time: 1e7 }, { ...good, time: 12.5 },
      { ...good, grade: 'Dieu du tir' }, { ...good, grade: GRADES[0], accuracy: 0.5 }, { ...good, grade: GRADES[3], accuracy: 0.9 }, { ...good, grade: GRADES[2], accuracy: 0.9 },
    ];
    for (const b of bad) expect(validateSubmission(b).ok, JSON.stringify(b)).toBe(false);
  });
  it('grades possibles pour une précision donnée (l’alerte peut coûter le premier grade)', () => {
    expect(validateSubmission({ ...good, accuracy: 0.9, grade: GRADES[1] }).ok).toBe(true);
    expect(validateSubmission({ ...good, accuracy: 0.5, grade: GRADES[2] }).ok).toBe(true);
    expect(validateSubmission({ ...good, accuracy: 0.2, grade: GRADES[3] }).ok).toBe(true);
  });
  it('les grades connus sont ceux que Mission.score peut rendre', () => {
    const got = new Set<string>();
    for (const [hits, shots, alarm] of [[9, 10, false], [9, 10, true], [5, 10, false], [2, 10, false]] as const) {
      const m = new Mission(new Map(), stepsFacile as any, null);
      m.totalHits = hits; m.totalShots = shots; m.alarm = alarm;
      const sc = m.score();
      got.add(sc.grade);
      expect(validateSubmission({ ...good, accuracy: sc.accuracy, grade: sc.grade }).ok).toBe(true);
    }
    expect([...got].sort()).toEqual([...GRADES].sort());
  });
  it('limitation de débit : n requêtes par fenêtre et par adresse', () => {
    let t = 0;
    const allow = createRateLimiter(3, 1000, () => t);
    expect([allow('a'), allow('a'), allow('a'), allow('a')]).toEqual([true, true, true, false]);
    expect(allow('b')).toBe(true);
    t = 1001;
    expect(allow('a')).toBe(true);
  });
});

describe('fichier du classement (serveur)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-scores-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sub = (score: number, name = 'AAA') => ({ name, score, grade: GRADES[1], accuracy: 0.7, shots: 12, time: 300 });
  const quiet = { log: () => {} };

  it('fichier absent : classement vide ; une inscription le crée, dans un sous-dossier au besoin', async () => {
    const file = join(dir, 'sous', 'dossier', 'scores.json');
    const store = createScoreStore(file, quiet);
    expect(await store.read()).toEqual(emptyBoards());
    const r = await store.submit('facile', sub(12000));
    expect(r.rank).toBe(1);
    expect(r.board[0]).toMatchObject({ name: 'AAA', score: 12000 });
    expect(r.board[0].date).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(parseBoards(readFileSync(file, 'utf8')).boards.facile).toHaveLength(1);
    // un autre processus (redémarrage) relit le même fichier
    expect((await createScoreStore(file, quiet).read()).facile[0].score).toBe(12000);
  });
  it('inscriptions simultanées : aucune perdue, 20 gardées, pas de fichier temporaire oublié', async () => {
    const file = join(dir, 'concurrent.json');
    const store = createScoreStore(file, quiet);
    const ranks = await Promise.all(Array.from({ length: 30 }, (_, i) => store.submit('standard', sub(12000 + i, 'J' + i))));
    expect(ranks.filter((r) => r.rank > 0).length).toBeGreaterThanOrEqual(BOARD_SIZE);
    const saved = parseBoards(readFileSync(file, 'utf8'));
    expect(saved.corrupt).toBe(false);
    expect(saved.boards.standard).toHaveLength(BOARD_SIZE);
    expect(saved.boards.standard[0].score).toBe(12029);
    expect(saved.boards.standard[BOARD_SIZE - 1].score).toBe(12010);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('fichier illisible : mis de côté, on repart d’un classement vide, puis on réécrit', async () => {
    const file = join(dir, 'casse.json');
    writeFileSync(file, '{"v":1,"levels":{"facile":[{"name":"AAA","sco');
    const logs: string[] = [];
    const store = createScoreStore(file, { log: (m: string) => logs.push(m) });
    expect(await store.read()).toEqual(emptyBoards());
    const aside = readdirSync(dir).filter((f) => f.startsWith('casse.json.illisible-'));
    expect(aside.length).toBeGreaterThanOrEqual(1);
    expect(readFileSync(join(dir, aside[0]), 'utf8')).toContain('"sco');
    expect(logs.join(' ')).toContain('illisible');
    expect((await store.submit('avance', sub(20000))).rank).toBe(1);
    expect(parseBoards(readFileSync(file, 'utf8'))).toMatchObject({ corrupt: false });
  });
  it('fichier supprimé en cours de route : remise à zéro sans redémarrage', async () => {
    const file = join(dir, 'reset.json');
    const store = createScoreStore(file, quiet);
    await store.submit('facile', sub(9000));
    rmSync(file);
    expect(await store.read()).toEqual(emptyBoards());
  });
  it('score hors des 20 : rien n’est écrit', async () => {
    const file = join(dir, 'plein.json');
    const store = createScoreStore(file, quiet);
    for (let i = 0; i < BOARD_SIZE; i++) await store.submit('facile', sub(10000 + i));
    const before = readFileSync(file, 'utf8');
    expect((await store.submit('facile', sub(9000))).rank).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('service du jeu : API ou repli local', () => {
  class Mem {
    data = new Map<string, string>();
    getItem(k: string): string | null { return this.data.get(k) ?? null; }
    setItem(k: string, v: string): void { this.data.set(k, v); }
    removeItem(k: string): void { this.data.delete(k); }
  }
  const result = { score: 15000, grade: GRADES[0], accuracy: 0.9, shots: 10, time: 300 };
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('pas d’API (404, page HTML, réseau coupé) : mode local, sans erreur', async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => new Response('Introuvable', { status: 404 }),
      async () => new Response('<!doctype html><title>Pigeon</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      async () => { throw new TypeError('Failed to fetch'); },
      async () => json(200, { bonjour: 1 }),
      async () => new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ];
    for (const fetch of answers) {
      const s = new ScoreService({ storage: new Mem(), fetch });
      await expect(s.load()).resolves.toEqual(emptyBoards());
      expect(s.online).toBe(false);
    }
  });
  it('mode local : inscription dans le navigateur, relue après rechargement, nom mémorisé', async () => {
    const storage = new Mem();
    const s = new ScoreService({ storage, fetch: null, now: () => new Date('2026-03-01T10:00:00Z') });
    await s.load();
    const out = await s.submit('facile', result, ' zoé ');
    expect(out).toMatchObject({ status: 'ok', rank: 1, online: false, fellBack: false });
    expect(s.boards.facile[0]).toMatchObject({ name: 'ZOE', score: 15000, date: '2026-03-01T10:00:00.000Z' });
    const again = new ScoreService({ storage, fetch: null });
    expect(again.boards.facile[0].name).toBe('ZOE');
    expect(again.lastName()).toBe('ZOE');
    expect(again.localCount()).toBe(1);
    again.clearLocal();
    expect(again.localCount()).toBe(0);
    expect(again.boards).toEqual(emptyBoards());
    expect(storage.getItem(NAME_KEY)).toBe('ZOE');
  });
  it('nom vide : nom par défaut', async () => {
    const s = new ScoreService({ storage: new Mem(), fetch: null });
    await s.submit('avance', result, '???');
    expect(s.boards.avance[0].name).toBe(DEFAULT_NAME);
  });
  it('stockage corrompu : classement vide, puis réécrit proprement', async () => {
    for (const junk of ['{', 'null', '{"v":1,"levels":{"facile":"x"}}', '<html>', '{"v":2,"levels":{}}']) {
      const storage = new Mem();
      storage.setItem(SCORES_KEY, junk);
      storage.setItem(NAME_KEY, '<script>alert(1)</script>');
      const s = new ScoreService({ storage, fetch: null });
      expect(s.boards).toEqual(emptyBoards());
      expect(s.lastName()).toBe('SCRIPTAL');
      expect((await s.submit('facile', result, 'ABC')).status).toBe('ok');
      expect(parseBoards(storage.getItem(SCORES_KEY)).corrupt).toBe(false);
    }
  });
  it('stockage indisponible (navigation privée) : rien ne lève, le score reste affiché pour la séance', async () => {
    const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
    for (const storage of [broken, null]) {
      const s = new ScoreService({ storage, fetch: null });
      expect(s.lastName()).toBe('');
      expect(s.localCount()).toBe(0);
      const out = await s.submit('facile', result, 'ABC');
      expect(out).toMatchObject({ status: 'ok', rank: 1 });
      expect(s.boards.facile).toHaveLength(1);
      expect(() => s.clearLocal()).not.toThrow();
    }
  });
  it('API présente : classement du serveur, inscription envoyée, rien dans le classement local', async () => {
    const storage = new Mem();
    const server = emptyBoards();
    server.facile = [entry(20000, 'SRV')];
    const calls: { method: string; body: any }[] = [];
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (init?.method === 'POST') { const r = addEntry(server.facile, { ...JSON.parse(String(init.body)), date: '2026-05-05T00:00:00.000Z' }); server.facile = r.board; return json(201, { v: 1, level: 'facile', rank: r.rank, board: r.board }); }
      return json(200, { v: 1, size: 20, levels: server });
    };
    const s = new ScoreService({ storage, fetch });
    await s.load();
    expect(s.online).toBe(true);
    expect(s.boards.facile[0].name).toBe('SRV');
    const out = await s.submit('facile', result, 'moi');
    expect(out).toMatchObject({ status: 'ok', rank: 2, online: true, fellBack: false });
    expect(calls[1]).toEqual({ method: 'POST', body: { level: 'facile', name: 'MOI', ...result } });
    expect(s.boards.facile.map((e) => e.name)).toEqual(['SRV', 'MOI']);
    expect(storage.getItem(SCORES_KEY)).toBeNull();
    expect(storage.getItem(NAME_KEY)).toBe('MOI');
  });
  it('API présente : refus (400) et débit dépassé (429) sont rapportés, sans écriture locale', async () => {
    for (const [status, expected] of [[400, 'refused'], [429, 'retry']] as const) {
      const storage = new Mem();
      const fetch = async (_u: string, init?: RequestInit): Promise<Response> => (init?.method === 'POST' ? json(status, { error: 'non' }) : json(200, { v: 1, levels: emptyBoards() }));
      const s = new ScoreService({ storage, fetch });
      await s.load();
      expect((await s.submit('facile', result, 'ABC')).status).toBe(expected);
      expect(storage.getItem(SCORES_KEY)).toBeNull();
    }
  });
  it('serveur qui tombe entre la lecture et l’inscription : repli sur l’appareil, signalé', async () => {
    const storage = new Mem();
    let up = true;
    const fetch = async (): Promise<Response> => { if (!up) throw new TypeError('Failed to fetch'); return json(200, { v: 1, levels: emptyBoards() }); };
    const s = new ScoreService({ storage, fetch });
    await s.load();
    up = false;
    const out = await s.submit('standard', { ...result, score: 20000 }, 'ABC');
    expect(out).toMatchObject({ status: 'ok', rank: 1, online: false, fellBack: true });
    expect(s.online).toBe(false);
    expect(parseBoards(storage.getItem(SCORES_KEY)).boards.standard[0].name).toBe('ABC');
  });
  it('réponse hostile du serveur : les noms sont nettoyés avant d’atteindre l’interface', async () => {
    const levels = { facile: [{ ...entry(20000), name: '<img src=x onerror=alert(1)>' }], standard: [], avance: [] };
    const s = new ScoreService({ storage: new Mem(), fetch: async () => json(200, { v: 1, levels }) });
    await s.load();
    expect(s.boards.facile[0].name).toBe('IMG SRCX');
  });
});
