// Tutoriel : déroulé complet en Assisté et en Standard, sur ordinateur (vraies touches et vraie souris simulées
// par Playwright, lues sans capture grâce à ?test) et au doigt, téléphone tenu à la verticale (375 × 664, vrais
// événements tactiles CDP). Chaque étape doit
// rester en attente tant que l'action n'est pas faite, puis se valider par l'action. Vérifie aussi « Passer »,
// l'action faite en avance, l'absence en Réaliste, la proposition au premier lancement et la relance depuis le menu.
// Aides admises : cap de marche (boussole) et orientation vers la plaque (`game.autoAim`) fournis par le script ;
// la marche est accélérée ×3 (game.timeScale). Tout le reste passe par les commandes.
// Usage : node e2e/tutorial.mjs [--level <id>]   (serveur de développement lancé, ou HR_URL)
// Le poste et les deux cibles du tutoriel viennent du niveau : data.tutorial et data.testTouch.
import { mkdirSync } from 'node:fs';
import { assertScenario, center, gameUrl, launch, mobilePage, scenario, tapSel, tapText, tb } from './touchlib.mjs';
scenario.needTutorial = true;

mkdirSync('e2e/out', { recursive: true });
const browser = await launch();
let fails = 0, total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORDER = ['look', 'move', 'go', 'prone', 'scope', 'zoom', 'wind', 'range', 'mrad', 'book', 'elev', 'breath', 'fire', 'impact', 'reload', 'rack', 'plate2'];

async function desktopPage(query, viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(gameUrl(query));
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  await assertScenario(page);
  await page.waitForTimeout(1200);
  return { page, errors };
}

const info = (page) => page.evaluate(() => { const g = window.hr.game, t = g.tutorial; return t ? { step: t.stepId, validated: [...t.validated], finished: t.finished, skipped: t.skipped, card: document.querySelector('.tuto').innerText.replace(/\s+/g, ' '), shown: !document.querySelector('.tuto').classList.contains('hidden'), state: g.state } : null; });
const steer = (page, on, target) => page.evaluate(({ on, target }) => {
  const g = window.hr.game;
  window.__steer = on;
  g.timeScale = on ? 3 : 1;
  if (!on) return;
  const out = { x: 0, z: 0, dist: 0, bearing: 0, hint: '' };
  const tick = () => {
    if (!window.__steer) return;
    if (target === 'post') { g.player.guideTo(window.hr.level.tutorial.post, out); g.player.yaw = out.bearing; }
    else g.player.yaw = Math.atan2(target[0] - g.player.pos.x, -(target[1] - g.player.pos.z));
    requestAnimationFrame(tick);
  };
  tick();
}, { on, target });
const waitNear = async (page, target, tol, timeout = 40000) => {
  try {
    if (target === 'post') await page.waitForFunction(() => window.hr.game.player.nearestPost() === window.hr.level.tutorial.post, null, { timeout });
    else await page.waitForFunction(({ t, tol }) => { const p = window.hr.game.player.pos; return Math.hypot(p.x - t[0], p.z - t[1]) < tol; }, { t: target, tol }, { timeout });
    return true;
  } catch { return false; }
};

/** Pilote « ordinateur » : clavier et souris de Playwright. */
function desktopDriver(page) {
  const k = page.keyboard, m = page.mouse;
  return {
    name: 'ordinateur',
    begin: async () => { await k.press('Enter'); await sleep(900); },
    look: async () => { await m.move(400, 360); for (let i = 1; i <= 12; i++) { await m.move(400 + i * 45, 360 + (i % 2) * 6); await sleep(30); } },
    walkOn: async (run = true) => { if (run) await k.down('ShiftLeft'); await k.down('KeyW'); },
    walkOff: async () => { await k.up('KeyW'); await k.up('ShiftLeft'); },
    prone: () => k.press('KeyX'),
    stand: async () => { await k.press('Space'); await sleep(900); await k.press('Space'); await sleep(900); },
    scope: () => m.click(640, 360, { button: 'right' }),
    zoom: async () => { await m.wheel(0, -120); await sleep(60); await m.wheel(0, -120); },
    range: () => k.press('KeyT'),
    book: () => k.press('Tab'),
    bookClose: () => k.press('Tab'),
    elev: async (n) => { for (let i = 0; i < Math.abs(n); i++) { await k.press(n > 0 ? 'ArrowUp' : 'ArrowDown'); await sleep(35); } },
    breathOn: () => k.down('Space'),
    breathOff: () => k.up('Space'),
    fire: () => m.click(640, 360),
    reload: () => k.press('KeyR'),
    rack: () => k.press('KeyE'),
    // la touche du .223 est celle de sa place au râtelier du niveau (1 à 9, puis 0)
    take223: async () => { const i = await page.evaluate(() => window.hr.game.weapons.findIndex((w) => w.id === '223')); await k.press(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'][i]); await sleep(200); await k.press('Enter'); },
  };
}
/** Pilote « tactile » (portrait) : doigts simulés sur les boutons, pouce gauche en bas pour la manette, pouce droit pour le regard. */
function touchDriver(page, f) {
  const tap = (id) => tapSel(page, f, tb(id));
  return {
    name: 'tactile',
    begin: async () => { await tapText(page, f, 'Continuer'); await sleep(900); },
    look: async () => { for (const y of [300, 320, 310]) { await f.down(1, 200, y); await f.slide(1, 350, y - 8, 12); await f.up(1); } },
    walkOn: async () => { await f.down(5, 90, 520); await f.slide(5, 90, 440, 5); },
    walkOff: () => f.up(5),
    prone: () => tap('prone'),
    stand: async () => { await tap('prone'); await sleep(900); await tap('crouch'); await sleep(900); },
    scope: () => tap('aim'),
    zoom: async () => { await tap('zin'); await tap('zin'); },
    range: () => tap('range'),
    book: () => tap('book'),
    bookClose: () => tapText(page, f, 'Fermer'),
    elev: async (n) => { const c = await center(page, tb(n > 0 ? 'e+1' : 'e-1')); for (let i = 0; i < Math.abs(n); i++) { await f.tap(c.x, c.y, 9, 35); await sleep(60); } },
    breathOn: async () => { const c = await center(page, tb('breath')); await f.down(1, c.x, c.y); },
    breathOff: () => f.up(1),
    fire: async () => { const c = await center(page, tb('fire')); await f.tap(c.x, c.y, 2, 50); },
    reload: () => tap('reload'),
    rack: () => tap('rack'),
    take223: async () => { const c = await center(page, '#rack [data-w="223"]'); await f.tap(c.x, c.y); await sleep(250); await tapText(page, f, 'Prendre cette arme'); },
  };
}

/** Déroule les seize étapes. `early` : le carnet est ouvert dès la première étape (action faite en avance). */
async function runTutorial(page, d, diff, errors, { early = false, shots = null } = {}) {
  const label = `${d.name}, ${diff === 'assist' ? 'Assisté' : 'Standard'}`;
  console.log(`\n— tutoriel complet : ${label} —`);
  const G = (f, a) => page.evaluate(f, a);
  await d.begin();
  let s = await info(page);
  check(`${label} : tutoriel lancé, carte affichée, étape 1 / 17`, !!s && s.step === 'look' && s.shown && /1 \/ 17/.test(s.card) && s.state === 'play', s ? s.card.slice(0, 80) : 'pas de tutoriel');
  if (!s) return;
  const cmdOk = d.name === 'tactile' ? /pouce droit/i.test(s.card) && !/souris|moitié/i.test(s.card) : /souris/i.test(s.card);
  check(`${label} : la carte nomme la commande ${d.name === 'tactile' ? 'tactile (portrait)' : 'clavier/souris'}`, cmdOk);
  if (shots) await page.screenshot({ path: `e2e/out/${shots}-1.png` });

  /** l'étape `id` est en attente ; `act` la valide */
  const stepDo = async (id, act, { wait = 9000, pre = true } = {}) => {
    const before = await info(page);
    const waiting = before.step === id && !before.validated.includes(id);
    if (pre) await sleep(350);
    const still = pre ? (await info(page)).step === id : true;
    await act();
    let ok = true;
    try { await page.waitForFunction((id) => window.hr.game.tutorial.validated.includes(id), id, { timeout: wait }); } catch { ok = false; }
    const after = await info(page);
    check(`${label} : étape ${ORDER.indexOf(id) + 1} « ${id} » en attente, puis validée par l’action`, waiting && still && ok, waiting && still ? (ok ? '' : `non validée ; carte : ${after.card.slice(0, 90)}`) : `étape courante « ${before.step} »`);
    await sleep(1050); // la coche reste 0,9 s avant l'étape suivante
  };

  if (early) {
    // faire autre chose pendant l'étape 1 : rien n'est bloqué, et le carnet ouvert en avance comptera plus tard
    await d.book(); await sleep(500);
    const st = await G(() => ({ st: window.hr.game.state, inline: document.querySelector('[data-id=tutoBook]').innerText }));
    await d.bookClose(); await sleep(400);
    s = await info(page);
    check(`${label} : le joueur peut faire autre chose (carnet ouvert à l’étape 1), l’étape attend`, st.st === 'book' && s.state === 'play' && s.step === 'look' && /Tutoriel 1 \/ 17/i.test(st.inline), st.inline.slice(0, 60));
  }
  await stepDo('look', () => d.look());
  await stepDo('move', async () => { await d.walkOn(false); await sleep(2600); await d.walkOff(); });
  s = await G(() => { const h = window.hr.game.hudState; return { label: h.guide?.label, way: document.querySelector('[data-id=cLabel]').innerText }; });
  await stepDo('go', async () => { await steer(page, true, 'post'); await d.walkOn(); await waitNear(page, 'post'); await d.walkOff(); await steer(page, false); }, { wait: 3000 });
  // au poste exact, face aux plaques (l'orientation est une aide du script)
  await G(() => window.hr.game.player.teleport(...window.hr.level.testTouch.post, 'stand'));
  await sleep(300);
  await stepDo('prone', async () => { await d.prone(); });
  await sleep(700);
  await stepDo('scope', () => d.scope());
  await stepDo('zoom', () => d.zoom());
  await stepDo('wind', async () => { await G(() => { window.hr.game.rifle.zoom = 10; window.hr.game.autoAim(window.hr.level.tutorial.near); }); }, { pre: true });
  if (diff === 'assist') {
    // télémètre permanent : la lecture sur la plaque suffit
    let ok = true;
    try { await page.waitForFunction(() => window.hr.game.tutorial.validated.includes('range'), null, { timeout: 6000 }); } catch { ok = false; }
    s = await G(() => ({ r: window.hr.game.range, pred: !!window.hr.game.ui.reticle.predict }));
    check(`${label} : étape 8 « range » validée par la lecture continue sur la plaque (losange affiché)`, ok && s.r !== null && s.pred, `distance ${s.r?.toFixed(0)} m`);
    await sleep(1050);
  } else await stepDo('range', async () => { await G(() => window.hr.game.autoAim(window.hr.level.tutorial.near)); await d.range(); });
  // leçon du mrad : la plaque gardée dans le réticule le temps de lire (6 s), l'étape se valide d'elle-même
  s = await G(() => ({ step: window.hr.game.tutorial.stepId, card: document.querySelector('.tuto').innerText.replace(/\s+/g, ' '), d: window.hr.game.tutoSnap.dist1 }));
  check(`${label} : étape 9 « mrad » explique l’angle (10 cm à 100 m, 20 cm à 200 m, 1 m à 1 000 m) et le chiffre à la distance de la plaque`, s.step === 'mrad' && /10 cm à 100 m, 20 cm à 200 m, 1 m à 1.000 m/.test(s.card) && s.card.includes(`1 mrad couvre ${Math.max(1, Math.round(s.d / 10))} cm`), s.card.slice(0, 260));
  await stepDo('mrad', async () => { await G(() => window.hr.game.autoAim(window.hr.level.tutorial.near)); }, { wait: 14000 });
  if (early) {
    let ok = true;
    try { await page.waitForFunction(() => window.hr.game.tutorial.validated.includes('book'), null, { timeout: 4000 }); } catch { ok = false; }
    check(`${label} : étape 10 « book » validée d’office (carnet déjà ouvert en avance)`, ok);
    await sleep(1050);
  } else {
    await stepDo('book', () => d.book());
    s = await G(() => ({ st: window.hr.game.state, inline: document.querySelector('[data-id=tutoBook]').innerText, hidden: document.querySelector('[data-id=tutoBook]').classList.contains('hidden') }));
    check(`${label} : dans le carnet, le tutoriel reste lisible`, s.st === 'book' && !s.hidden && /Tutoriel/i.test(s.inline), s.inline.slice(0, 70));
    if (shots) await page.screenshot({ path: `e2e/out/${shots}-carnet.png` });
    await d.bookClose(); await sleep(500);
  }
  const need = await G(() => { const g = window.hr.game; return { need: g.tutoSnap.need1, clicks: g.rifle.elevClicks, d: g.tutoSnap.dist1, card: document.querySelector('.tuto').innerText.replace(/\s+/g, ' ') }; });
  check(`${label} : la carte annonce l’élévation du carnet (${need.need.toFixed(1)} mrad à ${Math.round(need.d)} m)`, need.card.includes(need.need.toFixed(1).replace('.', ',') + ' mrad'), need.card.slice(0, 110));
  if (shots) await page.screenshot({ path: `e2e/out/${shots}-tourelle.png` });
  // un seul clic ne suffit pas : l'étape attend la bonne valeur
  await d.elev(1); await sleep(500);
  s = await info(page);
  check(`${label} : tourelle à 0,1 mrad seulement : l’étape attend toujours`, s.step === 'elev' && !s.validated.includes('elev'));
  await stepDo('elev', () => d.elev(Math.round(need.need * 10) - need.clicks - 1), { pre: false });
  await stepDo('breath', async () => { await d.breathOn(); await sleep(1000); await d.breathOff(); });
  await stepDo('fire', async () => { await G(() => window.hr.game.autoAim(window.hr.level.tutorial.near)); await d.breathOn(); await sleep(350); await G(() => window.hr.game.autoAim(window.hr.level.tutorial.near)); await d.fire(); await sleep(150); await d.breathOff(); });
  // observer et corriger : on tire jusqu'à faire sonner la plaque
  let hit = await G(() => window.hr.game.targets.get(window.hr.level.tutorial.near).done), tries = 0;
  const before = await info(page);
  while (!hit && tries < 6) {
    tries++;
    await page.waitForFunction(() => window.hr.game.rifle.ready || (!window.hr.game.rifle.chambered && window.hr.game.rifle.mag === 0), null, { timeout: 8000 });
    if (await G(() => !window.hr.game.rifle.chambered && window.hr.game.rifle.mag === 0)) { await d.reload(); await sleep(3200); continue; }
    await d.breathOn(); await sleep(350); await G(() => window.hr.game.autoAim(window.hr.level.tutorial.near)); await d.fire(); await sleep(150); await d.breathOff();
    await page.waitForFunction(() => window.hr.game.shots.bullets.length === 0, null, { timeout: 15000 });
    await sleep(300);
    hit = await G(() => window.hr.game.targets.get(window.hr.level.tutorial.near).done);
  }
  let ok = true;
  try { await page.waitForFunction(() => window.hr.game.tutorial.validated.includes('impact'), null, { timeout: 5000 }); } catch { ok = false; }
  check(`${label} : étape 13 « impact » validée quand la plaque carrée sonne`, hit && ok, `${tries} tir(s) de plus ; avant : « ${before.step} »`);
  await sleep(1300);
  await page.waitForFunction(() => window.hr.game.rifle.boltT <= 0, null, { timeout: 5000 });
  await stepDo('reload', () => d.reload());
  await sleep(2600);
  // râtelier : la boussole y mène, le .22 LR ne suffit pas pour 300 m
  await d.scope(); await sleep(400);
  await d.stand();
  s = await G(() => { const g = window.hr.game; return { stance: g.player.stance, sc: g.scope.active, guide: g.hudState.guide?.label, way: document.querySelector('[data-id=cLabel]').innerText, step: g.tutorial.stepId }; });
  check(`${label} : étape 15, la boussole mène au râtelier`, s.step === 'rack' && s.guide === 'Râtelier' && /râtelier/i.test(s.way) && s.stance === 'stand' && !s.sc, JSON.stringify(s));
  let reached = false;
  // trajet du poste au râtelier : points de passage du niveau (testTouch.rackWalk, [12, 6] par défaut), puis le râtelier
  const TT = await G(() => window.hr.level.testTouch);
  const VIA = (TT.rackWalk ?? [[12, 6]]).map((p) => [p[0], p[1], 2.5]);
  for (const wp of [...VIA, [TT.rack[0], TT.rack[1], 1.2]]) { await steer(page, true, [wp[0], wp[1]]); await d.walkOn(); reached = await waitNear(page, [wp[0], wp[1]], wp[2], 30000); await d.walkOff(); await steer(page, false); }
  await sleep(400);
  await stepDo('rack', async () => { await d.rack(); await sleep(600); if (shots) await page.screenshot({ path: `e2e/out/${shots}-ratelier.png` }); await d.take223(); await sleep(400); }, { pre: false });
  s = await G(() => ({ w: window.hr.game.rifle.def.id, st: window.hr.game.state }));
  check(`${label} : râtelier rejoint à pied, .223 Rem en main`, reached && s.w === '223' && s.st === 'play', JSON.stringify(s));
  // plaque ronde : retour au poste, mêmes gestes, seul
  await d.walkOn();
  for (const wp of [...VIA].reverse()) { await steer(page, true, [wp[0], wp[1]]); await waitNear(page, [wp[0], wp[1]], wp[2], 30000); await steer(page, false); }
  await steer(page, true, 'post'); const back = await waitNear(page, 'post'); await d.walkOff(); await steer(page, false);
  await G(() => window.hr.game.player.teleport(...window.hr.level.testTouch.post, 'stand'));
  await sleep(300);
  await d.prone(); await sleep(1400);
  await d.scope(); await sleep(600);
  const n2 = await G(() => { const g = window.hr.game; g.rifle.zoom = 14; g.autoAim(window.hr.level.tutorial.far); return { need: g.tutoSnap.need2, clicks: g.rifle.elevClicks, card: document.querySelector('.tuto').innerText.replace(/\s+/g, ' ') }; });
  await sleep(300);
  await d.elev(Math.round(n2.need * 10) - n2.clicks);
  s = await info(page);
  check(`${label} : étape 17 « plate2 » en attente au poste, élévation du carnet annoncée (${n2.need.toFixed(1)} mrad)`, back && s.step === 'plate2' && !s.finished && s.card.includes(n2.need.toFixed(1).replace('.', ',')), s.card.slice(0, 110));
  if (shots) await page.screenshot({ path: `e2e/out/${shots}-plaque2.png` });
  hit = false; tries = 0;
  while (!hit && tries < 6) {
    tries++;
    await page.waitForFunction(() => window.hr.game.rifle.ready, null, { timeout: 8000 });
    await d.breathOn(); await sleep(350); await G(() => window.hr.game.autoAim(window.hr.level.tutorial.far)); await d.fire(); await sleep(150); await d.breathOff();
    await page.waitForFunction(() => window.hr.game.shots.bullets.length === 0, null, { timeout: 15000 });
    await sleep(300);
    hit = await G(() => window.hr.game.targets.get(window.hr.level.tutorial.far).done);
  }
  await sleep(1300);
  s = await G(() => { const g = window.hr.game, t = g.tutorial; return { fin: t.finished, skipped: t.skipped, validated: t.validated, pref: localStorage.getItem('hr.tuto'), card: document.querySelector('.tuto').innerText.replace(/\s+/g, ' '), elev: g.rifle.elevMil }; });
  check(`${label} : plaque ronde touchée (${tries} tir(s)), tutoriel terminé, mémorisé`, hit && s.fin && !s.skipped && s.pref === 'done' && /Tutoriel terminé/i.test(s.card), `hr.tuto = ${s.pref}`);
  check(`${label} : les 16 étapes validées dans l’ordre`, JSON.stringify(s.validated) === JSON.stringify(ORDER), s.validated.join(' → '));
  if (shots) await page.screenshot({ path: `e2e/out/${shots}-fin.png` });
  let nxt = true;
  try { await page.waitForFunction(() => window.hr.game.state === 'brief' && window.hr.game.mission.index === 1, null, { timeout: 8000 }); } catch { nxt = false; }
  check(`${label} : l’objectif « Réglage » est validé, briefing suivant`, nxt);
  check(`${label} : aucune erreur dans la console`, errors.length === 0, [...new Set(errors)].join(' | '));
}

// ---------------------------------------------------------------- quatre déroulés complets
for (const diff of ['assist', 'standard']) {
  {
    const { page, errors } = await desktopPage(`test&tuto=1&play&d=${diff}&q=low&dr=0`);
    await runTutorial(page, desktopDriver(page), diff, errors, { early: diff === 'standard', shots: `tutoriel-ordinateur-${diff}` });
    await page.context().close();
  }
  {
    const { page, errors, fingers } = await mobilePage(browser, { width: 375, height: 664 }, `test&tuto=1&play&d=${diff}&q=low&dr=0`, { dsf: 3 });
    const pv = await page.evaluate(() => ({ p: window.hr.engine.view.portrait, turn: document.documentElement.classList.contains('turn') }));
    check(`tactile, ${diff === 'assist' ? 'Assisté' : 'Standard'} : téléphone à la verticale, mise en page portrait`, pv.p && !pv.turn);
    await runTutorial(page, touchDriver(page, fingers), diff, errors, { shots: `tutoriel-tactile-${diff}` });
    await page.context().close();
  }
}

// ---------------------------------------------------------------- passer, Réaliste, premier lancement, relance
console.log('\n— passer, Réaliste, proposition, relance —');
{
  const { page, errors } = await desktopPage('test&tuto=1&play&d=standard&q=low&dr=0');
  await page.keyboard.press('Enter'); await sleep(900);
  let s = await info(page);
  const shown = s?.shown && /P Passer le tutoriel/i.test(s.card);
  await page.keyboard.press('KeyP'); await sleep(500);
  s = await page.evaluate(() => { const g = window.hr.game; return { skipped: g.tutorial.skipped, active: g.tutorial.active, hidden: document.querySelector('.tuto').classList.contains('hidden'), pref: localStorage.getItem('hr.tuto'), st: g.state }; });
  check('« Passer le tutoriel » (touche P, ordinateur) : carte retirée, jeu inchangé, choix mémorisé', shown && s.skipped && !s.active && s.hidden && s.pref === 'off' && s.st === 'play', JSON.stringify(s));
  await page.keyboard.press('KeyX'); await sleep(1200);
  s = await page.evaluate(() => ({ stance: window.hr.game.player.stance, hidden: document.querySelector('.tuto').classList.contains('hidden') }));
  check('après « Passer » : le tutoriel ne revient pas', s.stance === 'prone' && s.hidden);
  check('aucune erreur dans la console', errors.length === 0, errors.join(' | '));
  await page.context().close();
}
{
  // en pause : le bouton « Passer le tutoriel » du menu de pause (souris libre)
  const { page } = await desktopPage('test&tuto=1&play&d=assist&q=low&dr=0');
  await page.keyboard.press('Enter'); await sleep(900);
  await page.evaluate(() => window.hr.game.setState('pause')); await sleep(400);
  await page.click('#pause [data-act=skipTuto]'); await sleep(300);
  const s = await page.evaluate(() => ({ skipped: window.hr.game.tutorial.skipped, btn: document.querySelector('[data-id=pauseSkip]').classList.contains('hidden') }));
  check('« Passer le tutoriel » depuis le menu de pause', s.skipped && s.btn);
  await page.context().close();
}
for (const q of ['test&tuto=1&play&d=real&q=low&dr=0', 'tuto=1&play&d=real&q=low&dr=0&touch=1&fs=0']) {
  const { page } = await desktopPage(q, q.includes('touch=1') ? { width: 375, height: 664 } : undefined);
  const b = await page.evaluate(() => ({ choice: !!document.querySelector('#brief [data-tuto]'), row: document.querySelector('[data-id=tutoRow]').classList.contains('hidden'), touch: window.hr.touch }));
  await page.evaluate(() => window.hr.game.continueBrief()); await sleep(900);
  const s = await page.evaluate(() => ({ t: window.hr.game.tutorial, hidden: document.querySelector('.tuto').classList.contains('hidden'), st: window.hr.game.state }));
  check(`Réaliste (${b.touch ? 'tactile forcé par ?touch=1' : 'ordinateur'}), même avec ?tuto=1 : pas de tutoriel, pas de choix au briefing ni au menu`, s.t === null && s.hidden && s.st === 'play' && !b.choice && b.row, JSON.stringify({ ...b, ...s }));
  await page.context().close();
}
{
  const { page } = await desktopPage('test&play&d=standard&q=low&dr=0');
  const b = await page.evaluate(() => !!document.querySelector('#brief [data-tuto]'));
  await page.keyboard.press('Enter'); await sleep(900);
  const s = await page.evaluate(() => ({ t: window.hr.game.tutorial, st: window.hr.game.state }));
  check('mode ?test sans ?tuto=1 : tutoriel désactivé, non proposé', s.t === null && s.st === 'play' && !b);
  await page.context().close();
}
{
  // premier lancement réel (sans ?test) : proposition au briefing, choix mémorisé, relance depuis le menu
  const { page } = await desktopPage('q=low&dr=0&d=standard');
  let s = await page.evaluate(() => ({ pref: localStorage.getItem('hr.tuto'), menu: document.querySelector('[data-id=segTuto] .sel')?.dataset.k }));
  await page.click('text=Commencer'); await page.waitForFunction(() => window.hr.game.ready && window.hr.game.state !== 'menu', null, { timeout: 180000 }); await sleep(800);
  const b = await page.evaluate(() => ({ choice: [...document.querySelectorAll('#brief [data-tuto]')].map((e) => e.textContent), sel: document.querySelector('#brief [data-tuto].sel')?.dataset.tuto, cont: !!document.querySelector('#brief [data-act=continue]') }));
  check('premier lancement : le briefing propose « Avec le tutoriel » / « Sans »', s.pref === null && s.menu === 'on' && b.choice.join('|') === 'Avec le tutoriel|Sans' && b.sel === 'on' && b.cont, JSON.stringify(b));
  await page.screenshot({ path: 'e2e/out/tutoriel-ordinateur-briefing.png' });
  await page.click('#brief [data-tuto=off]'); await sleep(200);
  await page.click('text=Continuer'); await sleep(900);
  s = await page.evaluate(() => ({ t: window.hr.game.tutorial, pref: localStorage.getItem('hr.tuto'), st: window.hr.game.state }));
  check('choix « Sans » : pas de tutoriel, mémorisé dans localStorage', s.t === null && s.pref === 'off' && s.st === 'play', JSON.stringify(s));
  await page.evaluate(() => document.exitPointerLock?.());
  await page.reload();
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  await sleep(1200);
  s = await page.evaluate(() => document.querySelector('[data-id=segTuto] .sel')?.dataset.k);
  await page.click('[data-id=segTuto] [data-k=on]'); await sleep(200);
  const pref = await page.evaluate(() => localStorage.getItem('hr.tuto'));
  await page.click('text=Commencer'); await page.waitForFunction(() => window.hr.game.ready && window.hr.game.state !== 'menu', null, { timeout: 180000 }); await sleep(800);
  const again = await page.evaluate(() => !!document.querySelector('#brief [data-tuto]'));
  await page.click('text=Continuer'); await sleep(900);
  const t = await page.evaluate(() => ({ step: window.hr.game.tutorial?.stepId, shown: !document.querySelector('.tuto').classList.contains('hidden') }));
  check('partie suivante : choix retenu (« Sans »), pas de nouvelle proposition ; relance par le menu « Tutoriel : Avec »', s === 'off' && pref === 'on' && !again && t.step === 'look' && t.shown, JSON.stringify({ s, pref, again, t }));
  await page.context().close();
}

await browser.close();
console.log(`\n${total - fails} contrôles réussis sur ${total}`);
process.exit(fails ? 1 : 0);
