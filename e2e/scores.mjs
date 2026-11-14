// Classements, de bout en bout. Le script lance lui-même le serveur du jeu (server/server.mjs) sur un dossier construit
// et sur un fichier de scores temporaire : il ne touche ni au serveur de développement ni au classement réel.
//   1. API présente : mission jouée par le tireur automatique, nom inscrit, rang ; second joueur dans un autre
//      contexte de navigateur ; hors des vingt premiers ; « Passer » ; partie d'essai non classée ; noms hostiles ;
//      redémarrage du serveur (le fichier est conservé) ; portrait tactile 375 × 664 et 430 × 932.
//   2. API absente (SCORES_API=off, comme un hébergement statique) : repli sur le navigateur, effacement.
//   3. Garde-fous du serveur interrogés directement : validation, taille, débit, sortie du dossier servi.
// Usage : node e2e/scores.mjs [--level <id>] [--quick]
//   HR_DIST   dossier construit à servir (dist par défaut : lancer `npm run build` avant)
//   --quick   saute la mission jouée par le tireur automatique (les fins de mission sont alors toutes simulées)
// Captures dans e2e/out/scores/. Une ligne par contrôle, code de sortie 1 au moindre échec.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LEVEL } from './levellib.mjs';
import { Fingers, NONE, center, launch, screenReport } from './touchlib.mjs';
import { BOARD_SIZE, GRADES, HOME_SIZE, parseBoards, scoreBounds, serializeBoards, emptyBoards, SCORE_LEVELS } from '../src/shared/scores-core.mjs';

const QUICK = process.argv.includes('--quick');
const DIST = resolve(process.env.HR_DIST || 'dist');
const OUT = 'e2e/out/scores';
if (!existsSync(join(DIST, 'index.html'))) { console.log(`! ${process.env.HR_DIST || 'dist'}/index.html introuvable : construire le jeu d'abord (npm run build)`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 'pp-e2e-scores-'));
const FILE = join(TMP, 'scores.json');

let fails = 0, total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// ------------------------------------------------------------------ serveur du jeu
const servers = new Set();
async function startServer(env = {}) {
  const port = env.PORT ? Number(env.PORT) : await freePort();
  const child = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DIST_DIR: DIST, SCORES_FILE: FILE, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + 'healthz')).ok) break; } catch { /* pas encore prêt */ }
    if (i === 59) throw new Error('le serveur ne démarre pas :\n' + log);
    await sleep(100);
  }
  const srv = { base, port, child, log: () => log, stop: () => new Promise((r) => { servers.delete(srv); child.once('exit', r); child.kill('SIGTERM'); }) };
  servers.add(srv);
  return srv;
}
const api = (srv, init) => fetch(srv.base + 'api/scores', init);
const post = (srv, body, headers = { 'Content-Type': 'application/json' }) => api(srv, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

// ------------------------------------------------------------------ navigateur
const browser = await launch();
const errors = [];
/** page du jeu chargée ; `mobile` : contexte tactile portrait. Les erreurs de page et de console sont relevées. */
async function open(srv, query, { mobile = null, ctx = null, allow404 = false } = {}) {
  ctx ??= mobile ? await browser.newContext({ viewport: mobile, deviceScaleFactor: 2, hasTouch: true, isMobile: true }) : await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 300)));
  // sans API, le navigateur note lui-même le 404 de api/scores dans la console : c'est le repli attendu
  page.on('console', (m) => { if (m.type() === 'error' && !(allow404 && /404/.test(m.text()))) errors.push(m.text().slice(0, 300)); });
  await page.goto(`${srv.base}?${query}&level=${LEVEL}${mobile ? '&fs=0' : ''}`);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  // le voile de chargement met 1,6 s à s'effacer
  await page.waitForTimeout(2300);
  const cdp = mobile ? await ctx.newCDPSession(page) : null;
  return { ctx, page, fingers: cdp ? new Fingers(cdp) : null };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
/** état des classements de l'accueil : lignes par niveau, mode affiché */
const menuBoards = (page, root = '#menu .boards') => page.evaluate((root) => {
  const out = { mode: document.querySelector(root + ' [data-mode], ' + root + ' ~ * [data-mode]')?.textContent ?? document.querySelector('[data-mode]').textContent, levels: {} };
  document.querySelectorAll(root + ' [data-board]').forEach((ol) => { out.levels[ol.dataset.board] = [...ol.querySelectorAll('li')].map((li) => (li.classList.contains('none') ? 'vide' : [...li.children].map((c) => c.textContent).join('|'))); });
  return out;
}, root);
/** écran de fin : message, formulaire, liste */
const endState = (page) => page.evaluate(() => {
  const c = document.querySelector('#end [data-id=endCard]');
  const form = c.querySelector('.rank-form'), ol = c.querySelector('.board.full'), me = ol.querySelector('li.me');
  const vis = (e) => { const b = e.getBoundingClientRect(), o = ol.getBoundingClientRect(); return b.height > 0 && b.top >= o.top - 1 && b.bottom <= o.bottom + 1; };
  return {
    state: window.hr.game.state, msg: c.querySelector('.rank-msg').textContent, mode: c.querySelector('.rank-mode').textContent, form: !form.classList.contains('hidden'),
    name: c.querySelector('.rank-name').value, focused: document.activeElement === c.querySelector('.rank-name'),
    rows: ol.querySelectorAll('li:not(.none)').length, me: me ? { rank: Number(me.querySelector('.rk').textContent), name: me.querySelector('.nm').textContent, score: me.querySelector('.sc').textContent, visible: vis(me) } : null,
    names: [...ol.querySelectorAll('li .nm')].map((n) => n.textContent), html: ol.querySelectorAll('img, script, b, i, svg').length,
    score: Number(c.querySelector('.score-grid b').textContent.replace(/\D/g, '')),
  };
});
/**
 * Fin de mission simulée : le bilan est posé dans la mission (points par objectif, tirs, alerte) puis la fin normale
 * est déclenchée (Mission.onStepDone) ; le score est celui que calcule Mission.score().
 */
const finish = (page, o) => page.evaluate((o) => {
  const g = window.hr.game, m = g.mission, n = m.steps.length;
  if (g.state === 'menu') g.startMission();
  m.stats = m.steps.map(() => ({ shots: o.shotsPer ?? 1, hits: 1, time: 45, distance: 300, weapon: g.rifle.def.caliber, points: o.points }));
  m.totalShots = n * (o.shotsPer ?? 1); m.totalHits = n; m.elapsed = 45 * n + 7; m.alert = 0; m.alarm = !!o.alarm;
  m.index = n; m.finished = true; m.running = false;
  m.onStepDone(m.steps[n - 1], m.stats[n - 1]);
  return m.score().total;
}, o);
const typeName = async (page, text) => { await page.keyboard.type(text, { delay: 25 }); await page.waitForTimeout(120); };
const waitDone = (page) => page.waitForFunction(() => document.querySelector('#end .rank-form').classList.contains('hidden'), null, { timeout: 8000 }).then(() => page.waitForTimeout(250));

// classement d'essai : noms de 8 caractères les plus larges compris, un nom hostile (il doit ressortir nettoyé)
const NAMES = ['MARGOT', 'WWWWWWWW', 'R2-D2', 'LA BUSE', 'ZAZIE', 'PIAF', 'COLOMBE', 'MERLE', 'BERNACHE', 'HULOTTE', 'MILAN', 'EFFRAIE', 'PIC VERT', 'GRIVE', 'ALOUETTE', 'MARTINET', 'HIBOU', 'CORBEAU', 'MOINEAU', 'GEAI'];
function seed(count, { hostile = false } = {}) {
  const boards = emptyBoards();
  for (const id of SCORE_LEVELS) {
    const b = scoreBounds(id), n = id === LEVEL ? count : Math.min(count, id === 'avance' ? 3 : 7);
    boards[id] = Array.from({ length: n }, (_, i) => {
      const acc = 0.97 - i * 0.03;
      return { name: NAMES[i], score: Math.round(b.max - 1500 - ((b.max - b.min - 3500) * i) / 19), grade: acc > 0.85 ? GRADES[0] : acc > 0.6 ? GRADES[1] : GRADES[2], accuracy: acc, shots: 9 + i, time: 380 + i * 37, date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() };
    });
  }
  const text = serializeBoards(boards);
  // le fichier porte un nom jamais passé par le nettoyage : la lecture doit le rendre inoffensif
  return hostile ? text.replace('"MERLE"', JSON.stringify('<img src=x onerror="window.__xss=1">')) : text;
}
const fileBoards = () => parseBoards(existsSync(FILE) ? readFileSync(FILE, 'utf8') : '').boards;
const B = scoreBounds(LEVEL);
/** points par objectif donnant un score proche de `target` (fin simulée sans alerte : 2 000 points de discrétion) */
const pointsFor = (target, steps, factor) => Math.round((target / factor - 2000) / steps);

try {
  // =====================================================================================================
  // 1. API présente
  // =====================================================================================================
  console.log(`\n— classement partagé (API du serveur), niveau ${LEVEL} —`);
  let srv = await startServer({ SCORES_PER_MINUTE: '60' });
  let r = await (await api(srv)).json();
  check('GET api/scores : trois classements vides au départ', r.v === 1 && SCORE_LEVELS.every((l) => Array.isArray(r.levels[l]) && r.levels[l].length === 0), JSON.stringify(r).slice(0, 120));

  const Q = 'test&play&scores=1&q=low&dr=0';
  let p1 = await open(srv, Q.replace('&play', ''));
  let mb = await menuBoards(p1.page);
  check('accueil (ordinateur), classement vide : « Aucun score » pour chaque niveau, mode « en ligne »', SCORE_LEVELS.every((l) => mb.levels[l].length === 1 && mb.levels[l][0] === 'vide') && mb.mode === 'en ligne', JSON.stringify(mb));
  await shot(p1.page, 'ordinateur-menu-vide');
  const rules = await p1.page.evaluate(() => ({ steps: window.hr.level.steps.length, factor: (() => { const m = window.hr.game.mission; return m.difficulty === 'real' ? 1.5 : m.difficulty === 'standard' ? 1.2 : 1; })() }));
  const pts = (target) => pointsFor(target, rules.steps, rules.factor);

  // ---------------------------------------------------------------- premier joueur : mission réellement jouée
  let score1;
  if (!QUICK) {
    await p1.page.evaluate(() => { const g = window.hr.game; g.startMission(); g.cinematic = false; g.continueBrief(); });
    const PLAN = await p1.page.evaluate(() => window.hr.level.testPlan);
    const page = p1.page;
    for (const P of PLAN) {
      if ((await page.evaluate(() => window.hr.game.state)) === 'brief') await page.evaluate(() => window.hr.game.continueBrief());
      await page.evaluate(({ post, weapon, zoom }) => { const g = window.hr.game, p = window.hr.level.posts[post]; g.equip(weapon); g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0); g.player.heartRate = 60; g.scope.enter(0, 0); g.rifle.zoom = Math.min(g.rifle.def.scope[1], zoom); }, P);
      await sleep(500);
      for (const id of P.targets) {
        await page.evaluate((id) => window.hr.game.testPrepare(id), id);
        const ready = () => page.waitForFunction((id) => window.hr.game.testReady(id), id, { timeout: 240000, polling: 500 });
        await ready();
        for (let tries = 0, done = false; !done && tries < 12; tries++) {
          const info = await page.evaluate((id) => { const g = window.hr.game; if (!g.rifle.chambered && g.rifle.mag === 0) g.rifle.reload(); return { ...g.autoAim(id), ready: g.rifle.ready }; }, id);
          if (!info.visible) { await ready(); continue; }
          if (!info.ready) { await sleep(400); tries--; continue; }
          await page.evaluate((id) => { const g = window.hr.game; g.autoAim(id); g.steadyFire(); }, id);
          await page.waitForFunction(() => window.hr.game.shots.bullets.length === 0, null, { timeout: 15000 });
          await sleep(250);
          done = await page.evaluate((id) => window.hr.game.targets.get(id).done, id);
        }
      }
      try { await page.waitForFunction(() => ['brief', 'end', 'fail'].includes(window.hr.game.state), null, { timeout: 9000 }); } catch { /* reste en jeu */ }
    }
    const fin = await page.evaluate(() => { const g = window.hr.game, m = g.mission; return { state: g.state, finished: m.finished, score: m.finished ? m.score() : null, shots: m.totalShots, time: Math.floor(m.elapsed) }; });
    check('mission jouée par le tireur automatique jusqu’à l’écran de fin', fin.state === 'end' && fin.finished, JSON.stringify(fin));
    score1 = fin.score?.total;
    check('score réel dans les bornes que le serveur accepte pour ce niveau', score1 >= B.min && score1 <= B.max, `${score1} dans [${B.min}, ${B.max}]`);
  } else score1 = await finish(p1.page, { points: pts(B.min + 5200), shotsPer: 1 });
  await p1.page.waitForTimeout(700);
  let e = await endState(p1.page);
  check('fin de mission, classement vide : saisie proposée, « Nouveau record », champ prêt à la frappe', e.form && /Nouveau record/.test(e.msg) && e.focused && e.me?.rank === 1 && e.rows === 1 && e.mode === 'en ligne', JSON.stringify(e));
  // frappe réelle : minuscules, accent, espace (touche que le jeu intercepte ailleurs), balise
  await typeName(p1.page, 'zoé <b>1!');
  e = await endState(p1.page);
  check('saisie nettoyée au fil de la frappe : majuscules, sans accent ni balise, espace gardée, 8 caractères au plus', e.name === 'ZOE B1' && e.me?.name === 'ZOE B1', `champ « ${e.name} », ligne « ${e.me?.name} »`);
  await p1.page.keyboard.press('Meta+A').catch(() => {}); await p1.page.evaluate(() => { const i = document.querySelector('.rank-name'); i.select(); });
  await typeName(p1.page, 'pigeon-1xyz');
  e = await endState(p1.page);
  check('nom limité à 8 caractères', e.name === 'PIGEON-1', e.name);
  await p1.page.keyboard.press('Enter');
  await waitDone(p1.page);
  e = await endState(p1.page);
  check('Entrée inscrit le score : rang 1, « Record du niveau », ligne du joueur en évidence', !e.form && /Record du niveau : vous êtes 1er/.test(e.msg) && e.me?.rank === 1 && e.me?.name === 'PIGEON-1' && e.me?.score.replace(/\D/g, '') === String(score1), JSON.stringify(e));
  let fb = fileBoards();
  check('le serveur a écrit le score dans son fichier, daté par lui', fb[LEVEL].length === 1 && fb[LEVEL][0].name === 'PIGEON-1' && fb[LEVEL][0].score === score1 && /^20\d\d-/.test(fb[LEVEL][0].date) && readdirSync(TMP).length === 1, JSON.stringify(fb[LEVEL][0]));
  check('nom mémorisé pour la prochaine fois', (await p1.page.evaluate(() => localStorage.getItem('hr.name'))) === 'PIGEON-1' && (await p1.page.evaluate(() => localStorage.getItem('hr.scores'))) === null);

  // ---------------------------------------------------------------- classement garni, second joueur
  // 19 lignes déjà inscrites (le fichier est relu à chaque requête) : le score du premier joueur est retiré pour un état connu
  writeFileSync(FILE, seed(19, { hostile: true }));
  const seeded = fileBoards()[LEVEL];
  const p2 = await open(srv, Q.replace('&play', ''));
  mb = await menuBoards(p2.page);
  const top5 = seeded.slice(0, HOME_SIZE).map((x) => x.name);
  check('second joueur (autre contexte) : l’accueil montre les cinq premiers de chaque niveau', mb.levels[LEVEL].length === HOME_SIZE && mb.levels[LEVEL].every((row, i) => row.startsWith(`${i + 1}|${top5[i]}|`)) && SCORE_LEVELS.every((l) => mb.levels[l].length <= HOME_SIZE), JSON.stringify(mb.levels));
  let geo = await p2.page.evaluate(() => {
    const bx = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const a = bx('#menu .boards'), h1 = bx('#menu h1'), start = bx('#menu .m-start');
    const hit = (x) => !(a.r < x.l || a.l > x.r || a.b < x.t || a.t > x.b);
    const kids = [...document.querySelectorAll('#menu .menu-list > *, #menu .sub, #menu .foot')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => ({ l: b.left, t: b.top, r: b.right, b: b.bottom }));
    const tr = document.createRange(); tr.selectNodeContents(document.querySelector('#menu h1')); const tb = tr.getBoundingClientRect(); const title = { l: tb.left, t: tb.top, r: tb.right, b: tb.bottom };
    const cols = [...document.querySelectorAll('#menu .boards .board-col')].filter((c) => getComputedStyle(c).display !== 'none');
    const clipped = [...document.querySelectorAll('#menu .boards .nm')].filter((n) => n.scrollWidth > n.clientWidth + 0.5).map((n) => n.textContent);
    return { a, h1h: h1.h, overTitle: hit(title), overList: kids.some(hit), cols: cols.length, cur: document.querySelector('#menu .boards .board-col.cur h3')?.textContent, clipped, start, W: innerWidth, H: innerHeight };
  });
  check('accueil 1600 × 900 : panneau des trois classements en bas à droite, sans toucher au titre ni aux options, noms entiers', geo.cols === 3 && !geo.overTitle && !geo.overList && geo.a.r <= geo.W && geo.a.b <= geo.H && geo.clipped.length === 0, JSON.stringify({ panneau: [Math.round(geo.a.l), Math.round(geo.a.t), Math.round(geo.a.r), Math.round(geo.a.b)], tronqués: geo.clipped, cols: geo.cols, titre: geo.overTitle, options: geo.overList }));
  check('le titre reste dominant : panneau moins haut que le titre, niveau choisi mis en avant', geo.a.h < geo.h1h * 1.6 && !!geo.cur, `panneau ${Math.round(geo.a.h)} px, titre ${Math.round(geo.h1h)} px, niveau « ${geo.cur} »`);
  await shot(p2.page, 'ordinateur-menu-rempli');
  const xss = await p2.page.evaluate(() => ({ flag: window.__xss ?? null, tags: document.querySelectorAll('.board img, .board script, .board b').length, names: [...document.querySelectorAll('#menu .boards [data-board] .nm')].map((n) => n.textContent) }));
  check('nom hostile dans le fichier : affiché nettoyé, aucune balise créée, aucun script exécuté', xss.flag === null && xss.tags === 0 && xss.names.every((n) => /^[A-Z0-9 -]{1,8}$/.test(n)), JSON.stringify(xss.names.slice(0, 9)));
  // fenêtre plus étroite : seul le niveau choisi ; très étroite : plus de panneau
  for (const [w, h, want] of [[1280, 720, 1], [900, 700, 0]]) {
    await p2.page.setViewportSize({ width: w, height: h }); await p2.page.waitForTimeout(250);
    const g2 = await p2.page.evaluate(() => { const p = document.querySelector('#menu .boards'); if (getComputedStyle(p).display === 'none') return { cols: 0, over: false }; const a = p.getBoundingClientRect(); const over = [...document.querySelectorAll('#menu h1, #menu .menu-list > *, #menu .sub')].some((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }); return { cols: [...p.querySelectorAll('.board-col')].filter((c) => getComputedStyle(c).display !== 'none').length, over }; });
    check(`accueil ${w} × ${h} : ${want ? 'seul le classement du niveau choisi, sans chevauchement' : 'panneau retiré (titre et options d’abord)'}`, g2.cols === want && !g2.over, JSON.stringify(g2));
    if (want) await shot(p2.page, `ordinateur-menu-${w}`);
  }
  await p2.page.setViewportSize({ width: 1600, height: 900 }); await p2.page.waitForTimeout(250);

  // le second joueur vise le 3e rang
  const target3 = Math.round((seeded[1].score + seeded[2].score) / 2);
  const score2 = await finish(p2.page, { points: pts(target3), shotsPer: 1 });
  await p2.page.waitForTimeout(700);
  e = await endState(p2.page);
  check('second joueur : son score entre 3e, ligne provisoire à ce rang dans les vingt', e.form && /3e sur 20/.test(e.msg) && e.me?.rank === 3 && e.rows === BOARD_SIZE && score2 < seeded[1].score && score2 > seeded[2].score, JSON.stringify({ msg: e.msg, me: e.me, rows: e.rows, score2 }));
  check('écran de fin : noms du classement nettoyés, aucune balise dans la liste', e.html === 0 && e.names.every((n) => /^[A-Z0-9 -]{1,8}$|^—$/.test(n)));
  await typeName(p2.page, 'faucon');
  await shot(p2.page, 'ordinateur-fin-saisie');
  geo = await p2.page.evaluate(() => { const c = document.querySelector('#end .card').getBoundingClientRect(); const all = [...document.querySelectorAll('#end .board.full li, #end .rank-form > *, #end table.dope tr, #end [data-act=restart]')].map((x) => x.getBoundingClientRect()); return { card: [c.left, c.top, c.right, c.bottom].map(Math.round), out: all.filter((b) => b.bottom > innerHeight || b.top < 0 || b.right > innerWidth).length, H: innerHeight }; });
  check('écran de fin 1600 × 900 : bilan, saisie, vingt lignes et « Rejouer » visibles sans défiler', geo.out === 0 && geo.card[1] >= 0 && geo.card[3] <= geo.H, JSON.stringify(geo));
  await p2.page.click('#end .rank-ok');
  await waitDone(p2.page);
  e = await endState(p2.page);
  check('bouton « Inscrire » : « Inscrit : 3e », ligne du joueur en évidence, vingt lignes', !e.form && /Inscrit : 3e/.test(e.msg) && e.me?.rank === 3 && e.me?.name === 'FAUCON' && e.rows === BOARD_SIZE, JSON.stringify({ msg: e.msg, me: e.me, rows: e.rows }));
  await shot(p2.page, 'ordinateur-fin-inscrit');
  fb = fileBoards();
  check('fichier du serveur : vingt lignes, le joueur 3e', fb[LEVEL].length === BOARD_SIZE && fb[LEVEL][2].name === 'FAUCON' && fb[LEVEL][2].score === score2);

  // le premier joueur recharge : même classement que le second
  await p1.page.reload(); await p1.page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await p1.page.waitForTimeout(900);
  const m1 = await menuBoards(p1.page);
  await p2.page.reload(); await p2.page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await p2.page.waitForTimeout(900);
  const m2 = await menuBoards(p2.page);
  check('après rechargement, les deux joueurs voient le même classement à l’accueil, FAUCON 3e', JSON.stringify(m1.levels) === JSON.stringify(m2.levels) && m1.levels[LEVEL][2].startsWith('3|FAUCON|') && (await p1.page.evaluate(() => window.hr.game.state)) === 'menu', JSON.stringify(m1.levels[LEVEL]));

  // ---------------------------------------------------------------- hors des vingt premiers
  const before = readFileSync(FILE, 'utf8');
  const low = await finish(p1.page, { points: 1000, alarm: true, shotsPer: 4 });
  await p1.page.waitForTimeout(700);
  e = await endState(p1.page);
  const last = fileBoards()[LEVEL][BOARD_SIZE - 1].score;
  check('score hors des vingt premiers : pas de saisie, classement affiché, score à battre = celui du 20e', !e.form && /Hors des vingt premiers/.test(e.msg) && e.msg.replace(/[^\d]/g, '') === String(last) && e.me === null && e.rows === BOARD_SIZE && low < last, JSON.stringify({ msg: e.msg, low, last }));
  await shot(p1.page, 'ordinateur-fin-hors-classement');
  check('hors classement : rien n’est envoyé ni écrit', readFileSync(FILE, 'utf8') === before);

  // ---------------------------------------------------------------- « Passer », partie d'essai
  await p2.page.evaluate(() => window.hr.game.startMission());
  await finish(p2.page, { points: pts(target3), shotsPer: 1 });
  await p2.page.waitForTimeout(600);
  e = await endState(p2.page);
  check('nom prérempli avec le dernier nom utilisé', e.form && e.name === 'FAUCON' && e.me?.name === 'FAUCON', e.name);
  await p2.page.click('#end .rank-skip'); await p2.page.waitForTimeout(250);
  e = await endState(p2.page);
  check('« Passer » : score non inscrit, plus de ligne provisoire, fichier inchangé', !e.form && /Score non inscrit/.test(e.msg) && e.me === null && readFileSync(FILE, 'utf8') === before, e.msg);
  for (const [q, why] of [['test&play&q=low&dr=0', 'mode test (scripts automatisés)'], [`test&play&scores=1&q=low&dr=0&d=${LEVEL === 'avance' ? 'assist' : 'real'}`, 'aides forcées par ?d='], ['test&play&scores=1&q=low&dr=0&step=1', 'objectifs sautés par ?step=']]) {
    const t = await open(srv, q, { ctx: p2.ctx });
    await finish(t.page, { points: 1500, shotsPer: 1 });
    await t.page.waitForTimeout(500);
    e = await endState(t.page);
    const refused = await t.page.evaluate(() => window.hr.game.ui.h.submitScore('TRICHE').then((o) => o.status));
    check(`partie d’essai, ${why} : « score non classé », pas de saisie, inscription refusée par le jeu`, !e.form && /Partie d’essai : score non classé/.test(e.msg) && refused === 'refused' && readFileSync(FILE, 'utf8') === before, e.msg);
    await t.page.close();
  }

  // ---------------------------------------------------------------- redémarrage du serveur
  await srv.stop();
  srv = await startServer({ SCORES_PER_MINUTE: '60', PORT: String(srv.port) });
  r = await (await api(srv)).json();
  check('serveur redémarré : le classement est relu du fichier, inchangé', JSON.stringify(r.levels) === JSON.stringify(fileBoards()) && r.levels[LEVEL][2].name === 'FAUCON' && r.levels[LEVEL].length === BOARD_SIZE);
  await p1.page.reload(); await p1.page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await p1.page.waitForTimeout(900);
  mb = await menuBoards(p1.page);
  check('page rechargée après le redémarrage : même accueil', JSON.stringify(mb.levels) === JSON.stringify(m1.levels) && mb.mode === 'en ligne');
  await p1.ctx.close(); await p2.ctx.close();

  // ---------------------------------------------------------------- portrait tactile
  for (const [W, H] of [[375, 664], [430, 932]]) {
    const tag = `portrait-${W}`;
    console.log(`\n— portrait tactile ${W} × ${H} —`);
    // 19 lignes : il reste une place, le joueur visera le 12e rang (au milieu de la liste défilante)
    writeFileSync(FILE, seed(19));
    const cur = fileBoards()[LEVEL];
    const t = await open(srv, Q.replace('&play', ''), { mobile: { width: W, height: H } });
    const { page, fingers } = t;
    const tap = async (sel) => { const c = await center(page, sel); await fingers.tap(c.x, c.y); await page.waitForTimeout(350); };
    let s = await page.evaluate(() => { const m = document.getElementById('menu'), b = (q) => { const e = m.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }; return { cls: document.documentElement.className, sc: m.scrollHeight - m.clientHeight, panel: getComputedStyle(m.querySelector('.boards')).display, help: b('.m-help'), scores: b('.m-scores'), fs: b('.m-fs'), start: b('.m-start'), foot: b('.foot'), W: innerWidth, H: innerHeight }; });
    const row = [s.help, s.scores, s.fs].filter(Boolean);
    const rowOk = row.every((b) => b[2] - b[0] >= 44 && b[3] - b[1] >= 44 && b[0] >= 0 && b[2] <= s.W && b[3] <= s.H) && row.every((b, i) => i === 0 || b[0] >= row[i - 1][2] - 0.5) && row.every((b) => b[1] === row[0][1]);
    check('accueil : tout tient sans défiler, bouton « Scores » sur la rangée de « Commandes », ≥ 44 px, sans chevauchement', /\bportrait\b/.test(s.cls) && s.sc <= 1 && s.panel === 'none' && !!s.scores && rowOk && s.start[2] - s.start[0] > s.W * 0.8, JSON.stringify(s));
    await shot(page, `${tag}-menu`);
    await tap('#menu .m-scores');
    s = await page.evaluate(() => { const scr = document.querySelector('.screen.on'), card = scr.querySelector('.card'), c = card.getBoundingClientRect(); const cols = [...scr.querySelectorAll('.board-col')].map((x) => ({ t: x.querySelector('h3').textContent, n: x.querySelectorAll('li:not(.none)').length, cur: x.classList.contains('cur'), b: x.getBoundingClientRect().bottom })); return { id: scr.id, cols, mode: scr.querySelector('[data-mode]').textContent, fits: card.scrollHeight <= card.clientHeight + 1 && c.bottom <= innerHeight && c.top >= 0, clipped: [...scr.querySelectorAll('.nm')].filter((n) => n.scrollWidth > n.clientWidth + 0.5).length }; });
    check('écran « Scores » : les trois niveaux, cinq lignes au plus chacun, niveau choisi mis en avant, tout visible sans défiler', s.id === 'scores' && s.cols.length === 3 && s.cols.every((c) => c.n >= 1 && c.n <= HOME_SIZE) && s.cols.find((c) => c.cur)?.n === HOME_SIZE && s.fits && s.clipped === 0 && s.mode === 'en ligne', JSON.stringify(s));
    let sr = await screenReport(page, NONE);
    check('écran « Scores » : carte dans la zone sûre, cibles tactiles ≥ 44 px, aucune touche clavier mentionnée', sr.inSafe && sr.small.length === 0 && sr.clipped.length === 0 && sr.keys.length === 0, JSON.stringify(sr));
    await shot(page, `${tag}-scores`);
    await tap('#scores .xclose');
    check('« Retour » ramène à l’accueil', (await page.evaluate(() => document.querySelector('.screen.on').id)) === 'menu');

    const target12 = Math.round((cur[10].score + cur[11].score) / 2);
    await finish(page, { points: pts(target12), shotsPer: 2 });
    await page.waitForTimeout(700);
    e = await endState(page);
    check('fin de mission : saisie proposée, 12e sur 20, clavier non ouvert d’office, ligne du joueur visible dans la liste défilante', e.form && /12e sur 20/.test(e.msg) && !e.focused && e.me?.rank === 12 && e.me.visible, JSON.stringify({ msg: e.msg, me: e.me, focused: e.focused }));
    sr = await screenReport(page, NONE);
    s = await page.evaluate(() => { const f = document.querySelector('#end .rank-form').getBoundingClientRect(), ol = document.querySelector('#end .board.full'), W = innerWidth; const wide = [...document.querySelectorAll('#end .card *')].filter((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && (b.right > W + 0.5 || b.left < -0.5); }).length; return { formBottom: Math.round(f.bottom), half: innerHeight / 2, listScrolls: ol.scrollHeight > ol.clientHeight + 1, listH: ol.clientHeight, wide, fs: parseFloat(getComputedStyle(document.querySelector('.rank-name')).fontSize), us: getComputedStyle(document.querySelector('.rank-name')).userSelect }; });
    check('écran de fin : cibles ≥ 44 px, rien ne dépasse en largeur, saisie dans la moitié haute (au-dessus du clavier), liste défilante compacte', sr.inSafe && sr.small.length === 0 && sr.clipped.length === 0 && s.wide === 0 && s.formBottom < s.half + 40 && s.listScrolls && s.listH < 200, JSON.stringify({ ...s, small: sr.small, clipped: sr.clipped }));
    check('champ du nom : texte de 16 px au moins (pas de zoom d’iOS à la prise de focus), sélection permise', s.fs >= 16 && s.us === 'text', `${s.fs} px, user-select ${s.us}`);
    await tap('#end .rank-name');
    check('un toucher sur le champ lui donne le focus', (await endState(page)).focused);
    await typeName(page, 'bébé_2');
    e = await endState(page);
    check('saisie au doigt nettoyée', e.name === 'BEBE-2' && e.me?.name === 'BEBE-2', e.name);
    // clavier à l'écran simulé : la hauteur utile tombe sous la largeur ; ni écran de rotation ni changement de mise en page pendant la saisie
    await page.setViewportSize({ width: W, height: 300 }); await page.waitForTimeout(400);
    s = await page.evaluate(() => ({ cls: document.documentElement.className, rot: getComputedStyle(document.getElementById('rotate')).display, focused: document.activeElement?.classList.contains('rank-name') }));
    check('clavier ouvert (hauteur utile réduite) : pas d’écran « Tournez votre appareil », le champ garde le focus', !/\bturn\b/.test(s.cls) && s.rot === 'none' && s.focused, JSON.stringify(s));
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(300);
    await shot(page, `${tag}-fin-saisie`);
    await tap('#end .rank-ok');
    await waitDone(page);
    e = await endState(page);
    check('« Inscrire » au doigt : « Inscrit : 12e », ligne du joueur en évidence et visible', !e.form && /Inscrit : 12e/.test(e.msg) && e.me?.rank === 12 && e.me.name === 'BEBE-2' && e.me.visible && e.rows === BOARD_SIZE, JSON.stringify({ msg: e.msg, me: e.me }));
    s = await page.evaluate(() => ({ cls: document.documentElement.className, focused: document.activeElement?.classList.contains('rank-name') }));
    check('après l’inscription : clavier rendu (champ sans focus), mise en page portrait', !s.focused && /\bportrait\b/.test(s.cls) && !/\bturn\b/.test(s.cls));
    await shot(page, `${tag}-fin-inscrit`);
    check('fichier du serveur : BEBE-2 12e', fileBoards()[LEVEL][11].name === 'BEBE-2');
    // liste : on peut la faire défiler au doigt jusqu'au 20e
    const lb = await center(page, '#end .board.full');
    await fingers.down(1, lb.x, lb.y + 50); await fingers.slide(1, lb.x, lb.y - 70, 8); await fingers.up(1); await page.waitForTimeout(400);
    s = await page.evaluate(() => { const ol = document.querySelector('#end .board.full'); return { top: ol.scrollTop, max: ol.scrollHeight - ol.clientHeight }; });
    check('la liste des vingt défile au doigt', s.top > 20 || s.top >= s.max - 1, JSON.stringify(s));
    await page.reload(); await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await page.waitForTimeout(900);
    await finish(page, { points: 1000, alarm: true, shotsPer: 4 });
    await page.waitForTimeout(700);
    e = await endState(page);
    check('hors des vingt premiers : pas de saisie, score à battre affiché', !e.form && /Hors des vingt premiers/.test(e.msg) && e.me === null && e.rows === BOARD_SIZE, e.msg);
    await shot(page, `${tag}-fin-hors-classement`);
    await page.evaluate(() => { const c = document.querySelector('#end .card'); c.scrollTop = c.scrollHeight; }); await page.waitForTimeout(200);
    sr = await screenReport(page, NONE);
    check('« Rejouer » atteignable en bas de l’écran de fin', sr.small.length === 0 && sr.clipped.length === 0 && (await page.evaluate(() => { const b = document.querySelector('#end [data-act=restart]').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })), JSON.stringify(sr));
    await t.ctx.close();
  }

  // =====================================================================================================
  // 3. garde-fous du serveur, interrogé directement
  // =====================================================================================================
  console.log('\n— garde-fous du serveur —');
  await srv.stop();
  writeFileSync(FILE, seed(3));
  srv = await startServer({ SCORES_PER_MINUTE: '60' });
  const ok = { level: LEVEL, name: 'robot', score: B.min + 10, accuracy: 0.5, shots: 30, time: 600, grade: GRADES[2] };
  const st = async (body, headers) => (await post(srv, body, headers)).status;
  const got = { max: await st({ ...ok, score: B.max + 1 }), min: await st({ ...ok, score: B.min - 1 }), lvl: await st({ ...ok, level: 'expert' }), name: await st({ ...ok, name: '<>' }), grade: await st({ ...ok, grade: GRADES[0] }), json: await st('{"level":'), type: await st(JSON.stringify(ok), { 'Content-Type': 'text/plain' }), big: await st(JSON.stringify({ ...ok, pad: 'x'.repeat(5000) })) };
  check('refusés : score au-dessus du maximum théorique, sous le minimum, niveau inconnu, nom vide, grade incohérent, JSON cassé (400), type non JSON (415), corps trop long (413)', got.max === 400 && got.min === 400 && got.lvl === 400 && got.name === 400 && got.grade === 400 && got.json === 400 && got.type === 415 && got.big === 413, JSON.stringify(got));
  check('aucun de ces envois n’a modifié le fichier', fileBoards()[LEVEL].length === 3);
  await srv.stop();
  // limite de débit par défaut : 6 inscriptions par minute et par adresse
  srv = await startServer();
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push(await st({ ...ok, score: B.min + 20 + i }));
  check('six inscriptions valides passent (201), les suivantes sont refusées (429)', codes.join(' ') === '201 201 201 201 201 201 429 429' && fileBoards()[LEVEL].length === 9, codes.join(' '));
  const raw = async (path, init) => { const x = await fetch(srv.base + path, init); return { s: x.status, t: x.headers.get('content-type') ?? '', h: x.headers, body: await x.text() }; };
  const esc = [await raw('..%2f..%2fpackage.json'), await raw('%2e%2e/%2e%2e/package.json'), await raw('assets/..%2f..%2f..%2fpackage.json'), await raw('.env'), await raw('api/autre')];
  check('pas de sortie du dossier servi, pas de fichier caché, pas d’autre route d’API', esc.every((x) => x.s === 400 || x.s === 404) && esc.every((x) => !/"name"/.test(x.body)), esc.map((x) => x.s).join(' '));
  const idx = await raw(''), man = await raw('manifest.webmanifest'), del = await raw('api/scores', { method: 'DELETE' }), put = await raw('index.html', { method: 'PUT', body: 'x' });
  const asset = (idx.body.match(/assets\/[^"]+\.js/) ?? [''])[0];
  const js = await raw(asset, { headers: { 'Accept-Encoding': 'br' } });
  check('fichiers statiques : index.html par défaut, types MIME, cache long pour les fichiers à empreinte, compression', idx.s === 200 && /text\/html/.test(idx.t) && /manifest\+json/.test(man.t) && js.s === 200 && /javascript/.test(js.t) && /immutable/.test(js.h.get('cache-control')) && js.h.get('content-encoding') === 'br' && idx.h.get('cache-control') === 'no-cache', `${asset} : ${js.h.get('cache-control')}, ${js.h.get('content-encoding')}`);
  check('en-têtes de sécurité (nosniff, CSP, pas d’inclusion ailleurs) ; méthodes non prévues refusées (405)', idx.h.get('x-content-type-options') === 'nosniff' && /default-src 'self'/.test(idx.h.get('content-security-policy')) && idx.h.get('x-frame-options') === 'SAMEORIGIN' && del.s === 405 && put.s === 405, `${del.s} ${put.s}`);
  // fichier illisible : mis de côté, classement vide, le serveur continue
  writeFileSync(FILE, '{"v":1,"levels":{"facile":[{"na');
  r = await (await api(srv)).json();
  const aside = readdirSync(TMP).filter((f) => f.includes('.illisible-'));
  check('fichier de scores illisible : copie mise de côté, classement vide servi, nouvelle inscription acceptée', SCORE_LEVELS.every((l) => r.levels[l].length === 0) && aside.length >= 1 && (await raw('healthz')).s === 200, aside.join(', '));
  await srv.stop();

  // =====================================================================================================
  // 2. API absente : repli sur le navigateur
  // =====================================================================================================
  console.log('\n— sans API (hébergement statique) : classement local —');
  rmSync(FILE, { force: true });
  srv = await startServer({ SCORES_API: 'off' });
  check('serveur sans API : api/scores répond 404', (await api(srv)).status === 404);
  for (const mobile of [null, { width: 375, height: 664 }, { width: 430, height: 932 }]) {
    const t = await open(srv, Q.replace('&play', ''), { mobile, allow404: true });
    const { page } = t;
    const where = mobile ? `portrait ${mobile.width}` : 'ordinateur';
    if (mobile) { const c = await center(page, '#menu .m-scores'); await t.fingers.tap(c.x, c.y); await page.waitForTimeout(350); }
    mb = await menuBoards(page, mobile ? '#scores' : '#menu .boards');
    check(`${where}, sans API : classement vide, mode « local à cet appareil », aucune erreur bloquante`, SCORE_LEVELS.every((l) => mb.levels[l][0] === 'vide') && mb.mode === 'local à cet appareil' && (await page.evaluate(() => window.hr.game.scores.online)) === false, JSON.stringify(mb));
    await shot(page, mobile ? `portrait-${mobile.width}-scores-vides` : 'ordinateur-menu-vide-local');
    if (mobile) { const c = await center(page, '#scores .xclose'); await t.fingers.tap(c.x, c.y); await page.waitForTimeout(350); await shot(page, `portrait-${mobile.width}-menu-vide`); }
    if (mobile?.width === 430) { await t.ctx.close(); continue; }
    const sc = await finish(page, { points: pts(B.min + 6000), shotsPer: 1 });
    await page.waitForTimeout(600);
    e = await endState(page);
    check(`${where}, sans API : saisie proposée, mode local`, e.form && e.mode === 'local à cet appareil' && /Nouveau record/.test(e.msg), e.msg);
    if (mobile) { const c = await center(page, '#end .rank-name'); await t.fingers.tap(c.x, c.y); await page.waitForTimeout(300); }
    await typeName(page, 'local');
    if (mobile) { const c = await center(page, '#end .rank-ok'); await t.fingers.tap(c.x, c.y); } else await page.keyboard.press('Enter');
    await waitDone(page);
    e = await endState(page);
    const ls = await page.evaluate(() => localStorage.getItem('hr.scores'));
    check(`${where}, sans API : inscrit 1er dans le navigateur (localStorage)`, /Record du niveau/.test(e.msg) && e.me?.name === 'LOCAL' && parseBoards(ls).boards[LEVEL][0]?.score === sc && !existsSync(FILE), e.msg);
    await page.reload(); await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await page.waitForTimeout(900);
    if (!mobile) {
      mb = await menuBoards(page);
      check('après rechargement : le score local est à l’accueil', mb.levels[LEVEL][0]?.startsWith('1|LOCAL|') && mb.mode === 'local à cet appareil', JSON.stringify(mb.levels[LEVEL]));
      const other = await open(srv, Q.replace('&play', ''), { allow404: true });
      check('un autre navigateur ne le voit pas (classement propre à l’appareil)', (await menuBoards(other.page)).levels[LEVEL][0] === 'vide');
      await other.ctx.close();
      // effacement, écran des commandes : deux appuis
      await page.click('#menu .m-help'); await page.waitForTimeout(300);
      let loc = await page.evaluate(() => ({ shown: !document.querySelector('[data-id=localRow]').classList.contains('hidden'), text: document.querySelector('[data-id=localT]').textContent }));
      check('écran des commandes : ligne discrète « Classement local de cet appareil : 1 score »', loc.shown && /1 score\./.test(loc.text), loc.text);
      await page.click('[data-act=clearLocal]'); await page.waitForTimeout(150);
      loc = await page.evaluate(() => ({ label: document.querySelector('[data-id=localB]').textContent, kept: !!localStorage.getItem('hr.scores') }));
      check('premier appui sur « Effacer » : demande de confirmation, rien n’est effacé', /Confirmer/.test(loc.label) && loc.kept, loc.label);
      await shot(page, 'ordinateur-commandes-effacer');
      await page.click('[data-act=clearLocal]'); await page.waitForTimeout(200);
      loc = await page.evaluate(() => ({ gone: localStorage.getItem('hr.scores') === null, hidden: document.querySelector('[data-id=localRow]').classList.contains('hidden'), name: localStorage.getItem('hr.name') }));
      mb = await menuBoards(page);
      check('second appui : classement local vidé, ligne retirée, accueil vide', loc.gone && loc.hidden && mb.levels[LEVEL][0] === 'vide', JSON.stringify(loc));
      // stockage abîmé : pas d'erreur, classement vide
      await page.evaluate(() => { localStorage.setItem('hr.scores', '{"v":1,"levels":{"facile":[{"name":"<img src=x onerror=window.__xss=1>","score":"x"},'); localStorage.setItem('hr.name', '<script>'); });
      await page.reload(); await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await page.waitForTimeout(900);
      mb = await menuBoards(page);
      check('localStorage corrompu : le jeu démarre, classement vide, rien d’exécuté', mb.levels[LEVEL][0] === 'vide' && (await page.evaluate(() => window.__xss ?? null)) === null && (await page.evaluate(() => window.hr.game.state)) === 'menu');
    } else {
      const c = await center(page, '#menu .m-scores'); await t.fingers.tap(c.x, c.y); await page.waitForTimeout(350);
      mb = await menuBoards(page, '#scores');
      check('portrait, après rechargement : le score local est dans l’écran « Scores »', mb.levels[LEVEL][0]?.startsWith('1|LOCAL|'), JSON.stringify(mb.levels[LEVEL]));
    }
    await t.ctx.close();
  }
  // stockage en lecture seule (navigation privée : toute écriture lève) : la fin de mission ne lève rien
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(() => { const boom = () => { throw new DOMException('refusé', 'QuotaExceededError'); }; for (const k of ['setItem', 'removeItem']) Storage.prototype[k] = boom; });
    const t = await open(srv, Q.replace('&play', ''), { ctx, allow404: true });
    await finish(t.page, { points: pts(B.min + 6000), shotsPer: 1 });
    await t.page.waitForTimeout(500);
    await typeName(t.page, 'prive'); await t.page.keyboard.press('Enter'); await waitDone(t.page);
    e = await endState(t.page);
    check('stockage indisponible : la partie se termine, le score est affiché pour la séance, sans erreur', /Record du niveau/.test(e.msg) && e.me?.name === 'PRIVE', e.msg);
    await ctx.close();
  }
  await srv.stop();
} catch (err) {
  fails++;
  console.log('ÉCHEC  exception : ' + (err?.stack || err));
} finally {
  await browser.close().catch(() => {});
  for (const s of [...servers]) await s.stop().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
}
if (errors.length) { fails++; console.log('ERREURS DE PAGE\n' + [...new Set(errors)].join('\n')); }
console.log(`\nscores (${LEVEL}) : ${total - fails < 0 ? 0 : total - Math.min(fails, total)}/${total} contrôles réussis${fails ? ` — ${fails} ÉCHEC(S)` : ''}`);
process.exit(fails ? 1 : 0);
