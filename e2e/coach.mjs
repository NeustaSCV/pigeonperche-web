// Conseil après tirs manqués, de bout en bout : on manque volontairement une cible (visée décalée d'un écart connu),
// et on vérifie l'encart, ses chiffres (distance mesurée, valeur du carnet, réglage de la tourelle, écart des impacts),
// sa fermeture, son rappel, et sa disparition dès que la cible est touchée. Ordinateur 1600 × 900 et portrait tactile
// 375 × 664, hors lunette et en lunette ; niveaux standard (télémètre), avancé (sans aide) et facile (assisté).
// Usage : node e2e/coach.mjs   (serveur lancé, ou HR_URL). Captures dans e2e/out/coach/.
import { mkdirSync } from 'node:fs';
import { Fingers, center, launch } from './touchlib.mjs';

const BASE = process.env.HR_URL || 'http://127.0.0.1:5173/';
const OUT = 'e2e/out/coach';
mkdirSync(OUT, { recursive: true });
const browser = await launch();
let fails = 0, total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) fails++;
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${detail ? ' — ' + detail : ''}`);
};
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

async function open(level, query, mobile) {
  const ctx = mobile ? await browser.newContext({ viewport: { width: 375, height: 664 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }) : await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(`${BASE}?test&play&q=low&dr=0&level=${level}&${query}${mobile ? '&fs=0' : ''}`);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  // `?play` ouvre le briefing dès que le jeu est prêt : on l'attend, puis on entre en jeu
  await page.waitForFunction(() => window.hr.game.state === 'brief', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); });
  await page.waitForFunction(() => window.hr.game.state === 'play', null, { timeout: 10000 });
  const fingers = mobile ? new Fingers(await ctx.newCDPSession(page)) : null;
  return { ctx, page, fingers, mobile: !!mobile };
}
/** au poste du plan de test pour l'objectif en cours, arme en main (celle du plan, ou `weapon`), en lunette */
const setup = (page, weapon, n = 0) => page.evaluate(({ weapon, n }) => {
  const g = window.hr.game, L = window.hr.level;
  const P = L.testPlan.find((p) => p.step === g.mission.step.id), p = L.posts[P.post];
  g.equip(weapon ?? P.weapon);
  g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0);
  g.player.heartRate = 60;
  g.scope.enter(0, 0);
  g.rifle.zoom = Math.min(g.rifle.def.scope[1], P.zoom);
  const id = P.targets[Math.min(n, P.targets.length - 1)];
  g.testPrepare(id);
  return { target: id, weapon: g.rifle.def.caliber, step: P.step };
}, { weapon, n });
/** un tir sur la cible, décalé de (up, right) mrad ; (0, 0) : au but */
async function shoot(page, id, up = 0, right = 0) {
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => { const r = window.hr.game.rifle; if (!r.chambered && r.mag === 0) r.reload(); return r.ready; });
    if (ready) break;
    await sleep(250);
  }
  await page.evaluate(({ id, up, right }) => { const g = window.hr.game; g.autoAim(id); g.scope.pitch += up / 1000; g.scope.yaw += right / 1000; g.steadyFire(); }, { id, up, right });
  await page.waitForFunction(() => window.hr.game.shots.bullets.length === 0, null, { timeout: 20000 });
  await sleep(300);
}
const coach = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-id=coach]'), g = window.hr.game, v = window.hr.engine.view;
  const shown = !c.classList.contains('hidden') && getComputedStyle(c).display !== 'none';
  const b = c.getBoundingClientRect();
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none'; };
  const txt = (id) => { const e = c.querySelector(`[data-id=${id}]`); return e && vis(e) ? e.innerText.trim() : ''; };
  // boutons tactiles recouverts par l'encart
  const over = [...document.querySelectorAll('#touch [data-tb]')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return Math.min(b.right, r.right) - Math.max(b.left, r.left) > 1 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 1; }).map((e) => e.dataset.tb);
  // distance de l'encart au centre du champ de la lunette
  const dx = Math.max(b.left - v.cx, 0, v.cx - b.right), dy = Math.max(b.top - v.cy, 0, v.cy - b.bottom);
  const hud = document.getElementById('hud').classList;
  return {
    shown, state: g.state, scope: g.scope.active, tracker: g.coach.visible, streak: g.coach.streak, rect: [b.left, b.top, b.right, b.bottom].map(Math.round), W: innerWidth, H: innerHeight,
    title: txt('coachT'), short: txt('coachS'), diag: txt('coachD'), why: txt('coachW'), steps: [...c.querySelectorAll('ol li')].filter(vis).map((li) => li.innerText.trim()), calibre: txt('coachC'), close: c.querySelector('[data-id=coachClose]')?.innerText ?? '',
    all: shown ? c.innerText : '', scrolls: getComputedStyle(c).overflowY === 'auto', closeBtn: (() => { const x = c.querySelector('.coach-x'); if (!x || !vis(x)) return null; const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; })(), fieldBottom: Math.round(v.cy + v.R),
    over, inField: hud.contains('in-scope') ? Math.hypot(dx, dy) < v.R - 1 : false, fieldTop: Math.round(v.cy - v.R), clipped: c.scrollHeight > c.clientHeight + 1 && getComputedStyle(c).overflowY === 'hidden',
    elev: g.rifle.elevMil, wind: g.rifle.windMil, time: g.gameTime,
  };
});
/** valeurs de référence : distance de la cible, élévation du carnet (sans vent) pour l'arme en main */
const truth = (page, id) => page.evaluate((id) => {
  const g = window.hr.game, t = g.targets.get(id);
  const eye = g.player.eye(g.engine.camera.position.clone()), a = t.aimPoint(eye.clone());
  const range = Math.hypot(a.x - eye.x, a.y - eye.y, a.z - eye.z), az = ((Math.atan2(a.x - eye.x, -(a.z - eye.z)) * 180) / Math.PI + 360) % 360;
  // le conseil cite les chiffres de la distance que le joueur a lue au télémètre
  const read = g.coachRange && g.difficulty === 'standard' ? g.coachRange.v : range;
  const s = g.testSolution(read, az, a.y - eye.y, 0, 0);
  // demi-taille de la cible vue du poste, mrad : un tir « manqué » doit passer au-delà
  const half = (g.targetWidth(t) / 2 / range) * 1000;
  return { range, measured: g.coachRange ? g.coachRange.v : null, book: s ? Math.max(0, s.elevMil) : null, rack: window.hr.level.weapons, off: Math.round((half * 1.7 + 0.8) * 10) / 10 };
}, id);
/** consignes chiffrées de l'encart complet, par axe (impératif suivi d'une valeur en mrad ou en clics) */
const orders = (c) => {
  const t = [c.diag, c.why, ...c.steps, c.calibre].join('\n');
  const grab = (res) => res.flatMap((re) => [...t.matchAll(re)].map((m) => m[0]));
  return {
    v: grab([/(montez|descendez)[^.;\n]*? de [\d,]+ mrad/gi, /visez [\d,]+ mrad plus (haut|bas)/gi]),
    h: grab([/corrigez la dérive de [\d,]+ mrad à (gauche|droite)/gi, /tournez-la de \d+ clics? vers la (gauche|droite)/gi, /visez [\d,]+ mrad plus à (gauche|droite)/gi]),
  };
};
const single = (c, where) => { const o = orders(c); check(`${where} : au plus une consigne chiffrée par axe dans tout l’encart`, o.v.length <= 1 && o.h.length <= 1, JSON.stringify(o)); return o; };
const fr1 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const exitScope = (page) => page.evaluate(() => window.hr.game.scope.exit()).then(() => sleep(700));
const enterScope = (page, id) => page.evaluate((id) => { const g = window.hr.game; g.scope.enter(g.player.yaw, 0); g.autoAim(id); }, id).then(() => sleep(700));
/** téléphone, en lunette : le conseil complet recouvre le champ, entre les boutons du haut et du bas de la lunette */
const overField = (c, where) => check(`${where} : conseil complet par-dessus le champ, dans l’écran, sans recouvrir un bouton, défilable, « Fermer » atteignable`,
  c.shown && c.inField && c.steps.length > 0 && c.title.length > 3 && c.rect[0] >= 0 && c.rect[2] <= c.W && c.rect[1] >= c.fieldTop + 44 && c.rect[3] <= c.fieldBottom - 44 && c.over.length === 0 && c.scrolls && !!c.closeBtn && c.closeBtn[1] >= c.rect[1] - 10 && c.closeBtn[3] - c.closeBtn[1] >= 40,
  JSON.stringify({ rect: c.rect, champ: [c.fieldTop, c.fieldBottom], boutons: c.over, étapes: c.steps.length, défile: c.scrolls, fermer: c.closeBtn }));
const geometry = (c, where) => check(`${where} : l’encart est dans l’écran, hors du champ de la lunette et des commandes tactiles, texte non coupé`, c.shown && c.rect[0] >= 0 && c.rect[1] >= 0 && c.rect[2] <= c.W && c.rect[3] <= c.H && !c.inField && c.over.length === 0 && !c.clipped, JSON.stringify({ rect: c.rect, champ: c.inField, boutons: c.over, coupé: c.clipped, hautDuChamp: c.fieldTop }));

// =====================================================================================================
// niveau standard : télémètre, chiffres réels, fermeture, rappel, touche
// =====================================================================================================
for (const mobile of [false, true]) {
  const dev = mobile ? 'portrait' : 'ordinateur';
  console.log(`\n— standard, ${mobile ? 'portrait tactile 375 × 664' : 'ordinateur 1600 × 900'} —`);
  const t = await open('standard', 'coach=1', mobile);
  const { page, fingers } = t;
  // seconde plaque de l'objectif « Réglage » : la plus lointaine, où la chute compte déjà
  const s = await setup(page, undefined, 1);
  const id = s.target;
  // le réticule posé sur la cible (tourelles réglées), on mesure ; puis les tourelles reviennent à zéro : c'est le joueur qui n'a pas réglé
  await page.evaluate((id) => window.hr.game.testDial(id), id);
  // mesure de la distance, comme le joueur : touche T, ou bouton Télémètre
  if (mobile) { const c = await center(page, '#touch [data-tb="range"]'); await fingers.tap(c.x, c.y); } else await page.keyboard.press('KeyT');
  await sleep(400);
  await page.evaluate(() => { const r = window.hr.game.rifle; r.elevClicks = 0; r.windClicks = 0; });
  const ref = await truth(page, id);
  const dial0 = await page.evaluate(() => window.hr.game.rifle.elevMil);
  // écart voulu : sous la cible, de `off` mrad (sa demi-taille vue d'ici, plus une marge)
  const off = ref.off;
  await shoot(page, id, -off, 0.05);
  await shoot(page, id, -off - 0.1, -0.05);
  let c = await coach(page);
  check('deux tirs manqués : pas encore de conseil', !c.shown && c.streak === 2, `série ${c.streak}`);
  await shoot(page, id, -off + 0.1, 0);
  await sleep(500);
  c = await coach(page);
  check('troisième tir manqué de suite : l’encart apparaît, le jeu continue (pas de pause)', c.shown && c.tracker && c.state === 'play', `${c.title} / état ${c.state}`);
  const t0 = c.time; await sleep(600);
  check('le temps de jeu avance pendant que l’encart est affiché', (await coach(page)).time > t0 + 0.3);
  if (mobile) overField(c, 'portrait, en lunette'); else geometry(c, `${dev}, en lunette`);
  if (mobile) {
    check('en lunette : écart des impacts et élévation du carnet dans le conseil', /trop bas/.test(c.all) && c.all.includes(`${fr1(ref.book)} mrad`), c.all.slice(0, 400));
    await page.screenshot({ path: `${OUT}/portrait-standard-lunette.png` });
    await exitScope(page);
    c = await coach(page);
    geometry(c, 'portrait, hors lunette');
    await page.screenshot({ path: `${OUT}/portrait-standard-hors-lunette.png` });
  } else await page.screenshot({ path: `${OUT}/ordinateur-standard-lunette.png` });
  // contenu chiffré (version complète)
  const low = num((c.diag.match(/environ ([\d,]+) mrad trop bas/) ?? [])[1]);
  const gap = ref.book - dial0;
  check(`diagnostic : « vos trois derniers tirs sont passés environ ${fr1(off)} mrad trop bas » (écart imposé : ${fr1(off)})`, /Vos trois derniers tirs sont passés/.test(c.diag) && Math.abs(low - off) <= 0.25, c.diag);
  // tourelle à zéro, carnet au-dessus : le diagnostic renvoie à l'étape 3 sans chiffrer de correction concurrente
  check('diagnostic et carnet divergents : le diagnostic explique et renvoie à l’étape 3, sans seconde correction chiffrée', gap < 0.05 ? /visez [\d,]+ mrad plus haut/.test(c.diag) : /valeur du carnet \(étape 3\)/.test(c.diag) && !/montez|descendez|\d+ clics?/.test(c.diag), c.diag);
  const o = single(c, `${dev}, standard`);
  check('la consigne d’élévation est celle du carnet (écart tourelle → carnet)', gap < 0.05 ? o.v.length === 1 : o.v.length === 1 && o.v[0] === `montez de ${fr1(gap)} mrad`, JSON.stringify(o.v));
  check('distance citée = distance mesurée au télémètre, proche de la distance réelle de la cible', c.steps[0]?.includes(`${Math.round(ref.measured).toLocaleString('fr-FR')} m`) && Math.abs(ref.measured - ref.range) < 0.05 * ref.range, `${c.steps[0]} (télémètre ${ref.measured?.toFixed(1)} m, cible à ${ref.range.toFixed(1)} m)`);
  check('valeur du carnet = solution de tir de l’arme en main à cette distance', c.steps[1]?.includes(`${fr1(ref.book)} mrad`), `${c.steps[1]} (solveur : ${ref.book?.toFixed(2)})`);
  check('réglage actuel de la tourelle et écart avec le carnet', Math.abs(gap) < 0.05 ? /c’est la valeur du carnet/.test(c.steps[2]) : c.steps[2]?.includes(`Votre tourelle est à ${fr1(dial0)} mrad, le carnet donne ${fr1(ref.book)} : ${gap > 0 ? 'montez' : 'descendez'} de ${fr1(Math.abs(gap))} mrad`), c.steps[2]);
  check('quatre étapes : distance, carnet, élévation, dérive selon le vent', c.steps.length === 4 && /m\/s/.test(c.steps[3]) && /vent/.test(c.steps[3]), c.steps[3]);
  check(mobile ? 'tactile : boutons nommés, aucune touche de clavier' : 'ordinateur : touches T, Tab, flèches, Entrée pour fermer', mobile ? /Télémètre/.test(c.steps[0]) && /Carnet/.test(c.steps[1]) && !/\b(Tab|Entrée|Échap)\b/.test([c.diag, c.why, ...c.steps, c.calibre].join(' ')) : /T en visant/.test(c.steps[0]) && /^Tab/.test(c.steps[1]) && /entrée/i.test(c.close), c.steps[0]);
  check('arme adaptée à cette distance : aucune suggestion de calibre', c.calibre === '', c.calibre);
  if (!mobile) { await exitScope(page); c = await coach(page); geometry(c, 'ordinateur, hors lunette'); await page.screenshot({ path: `${OUT}/ordinateur-standard-hors-lunette.png` }); }
  check('pourquoi (hors lunette) : la chute de la balle à cette distance, en mètres et en mrad', /Une balle tombe/.test(c.why) && c.why.includes(`${fr1(ref.book)} mrad`) && /descendue de [\d,]+ m/.test(c.why), c.why);
  // fermeture : Entrée, ou bouton Fermer
  if (mobile) { const x = await center(page, '.coach-x'); await fingers.tap(x.x, x.y); } else await page.keyboard.press('Enter');
  await sleep(400);
  c = await coach(page);
  check(`fermeture ${mobile ? 'd’un toucher sur « Fermer »' : 'par Entrée'} : encart retiré, partie en cours`, !c.shown && !c.tracker && c.state === 'play');
  await enterScope(page, id);
  for (let i = 0; i < 3; i++) await shoot(page, id, -off, 0);
  c = await coach(page);
  check('trois tirs manqués de plus : il ne revient pas en boucle', !c.shown, `série ${c.streak}`);
  await shoot(page, id, -off, 0);
  await sleep(400);
  c = await coach(page);
  check('quatrième tir manqué après la fermeture : un rappel, « Toujours pas au but »', c.shown && c.title === 'Toujours pas au but', c.title || c.short);
  await shoot(page, id);
  await sleep(500);
  c = await coach(page);
  const done = await page.evaluate((id) => window.hr.game.targets.get(id).done, id);
  check('cible touchée : l’encart disparaît de lui-même', done && !c.shown && !c.tracker, `cible ${done ? 'neutralisée' : 'debout'}`);
  await t.ctx.close();
}

// =====================================================================================================
// suggestion de calibre : arme inadaptée à la distance (standard, .223 sur le cadenas du treuil, à 785 m)
// =====================================================================================================
for (const mobile of [false, true]) {
  const dev = mobile ? 'portrait' : 'ordinateur';
  console.log(`\n— standard, arme inadaptée (.223 sur le cadenas), ${dev} —`);
  const t = await open('standard', 'coach=1&step=5', mobile);
  const { page, fingers } = t;
  const s = await setup(page, '223');
  const id = s.target;
  // le réticule posé sur la cible (tourelles réglées), on mesure ; puis les tourelles reviennent à zéro : c'est le joueur qui n'a pas réglé
  await page.evaluate((id) => window.hr.game.testDial(id), id);
  if (mobile) { const c = await center(page, '#touch [data-tb="range"]'); await fingers.tap(c.x, c.y); } else await page.keyboard.press('KeyT');
  await sleep(300);
  await page.evaluate(() => { const r = window.hr.game.rifle; r.elevClicks = 0; r.windClicks = 0; });
  const ref = await truth(page, id);
  for (let i = 0; i < 3; i++) await shoot(page, id, 0.2, ref.off + 1 + i * 0.1);
  await sleep(500);
  if (mobile) await exitScope(page);
  let c = await coach(page);
  const names = await page.evaluate(() => window.hr.game.weapons.map((w) => w.name));
  const cited = names.filter((n) => c.calibre.includes(n));
  check(`objectif « ${s.step} » à ${Math.round(ref.range)} m avec le .223 : le conseil dit pourquoi l’arme peine, chiffres à l’appui`, c.shown && /^À [\d\s ]+ m, le \.223 Rem /.test(c.calibre) && /(mrad|Mach|J à l’arrivée|n’atteint pas)/.test(c.calibre), c.calibre);
  check('une ou deux armes présentes au râtelier du niveau sont proposées, avec la façon d’en changer', cited.length >= 1 && cited.length <= 2 && (mobile ? /bouton Râtelier/.test(c.calibre) : /touche E/.test(c.calibre)), cited.join(', '));
  check('diagnostic : impacts trop à droite, correction à gauche ou renvoi à l’étape 4', /trop à droite/.test(c.diag) && /à gauche|étape 4/.test(c.diag), c.diag);
  single(c, `${dev}, arme inadaptée`);
  geometry(c, `${dev}, ${mobile ? 'hors lunette' : 'en lunette'}`);
  await page.screenshot({ path: `${OUT}/${dev}-calibre-${mobile ? 'hors-lunette' : 'lunette'}.png` });
  if (mobile) { await enterScope(page, id); c = await coach(page); overField(c, 'portrait, en lunette'); check('en lunette : l’arme proposée figure dans le conseil', /râtelier/i.test(c.all), c.all.slice(0, 400)); await page.screenshot({ path: `${OUT}/portrait-calibre-lunette.png` }); } else { await exitScope(page); geometry(await coach(page), 'ordinateur, hors lunette'); await page.screenshot({ path: `${OUT}/ordinateur-calibre-hors-lunette.png` }); }
  await t.ctx.close();
}

// =====================================================================================================
// niveau avancé : pas de télémètre, estimation au réticule
// =====================================================================================================
for (const mobile of [false, true]) {
  const dev = mobile ? 'portrait' : 'ordinateur';
  console.log(`\n— avancé (sans aide), ${dev} —`);
  const t = await open('avance', 'coach=1', mobile);
  const { page } = t;
  const s = await setup(page);
  const id = s.target;
  const ref = await truth(page, id);
  for (let i = 0; i < 3; i++) await shoot(page, id, ref.off, 0.05 * i);
  await sleep(500);
  if (mobile) await exitScope(page);
  let c = await coach(page);
  const all = [c.title, c.diag, c.why, ...c.steps, c.calibre].join('\n');
  check('conseil du niveau avancé : estimation de la distance au réticule (taille ÷ mrad × 1 000), repères du briefing', c.shown && /taille connue de la cible \(m\) ÷ taille lue dans la lunette \(mrad\) × 1 000/.test(c.steps[0]) && /Repères du briefing/.test(c.steps[0]), c.steps[0]);
  check('renvoi au carnet décomposé : chute + Coriolis, dérive gyroscopique', /décomposé/.test(c.steps[1]) && /Coriolis/.test(c.steps[1]) && /gyroscopique/.test(c.steps[1]), c.steps[1]);
  check('ni télémètre, ni distance réelle, ni correction du carnet révélés', !/Télémètre|T en visant/.test(all) && !all.includes(Math.round(ref.range).toLocaleString('fr-FR') + ' m') && !/le carnet donne \d/.test(all), `cible à ${Math.round(ref.range)} m`);
  check('diagnostic des impacts (observable à la lunette) : trop haut', /trop haut/.test(c.diag), c.diag);
  single(c, `${dev}, avancé`);
  geometry(c, `${dev}, ${mobile ? 'hors lunette' : 'en lunette'}`);
  await page.screenshot({ path: `${OUT}/${dev}-avance-${mobile ? 'hors-lunette' : 'lunette'}.png` });
  if (mobile) { await enterScope(page, id); c = await coach(page); overField(c, 'portrait, en lunette'); check('en lunette : diagnostic des impacts dans le conseil', /trop haut/.test(c.all), c.all.slice(0, 400)); await page.screenshot({ path: `${OUT}/portrait-avance-lunette.png` }); } else { await exitScope(page); geometry(await coach(page), 'ordinateur, hors lunette'); await page.screenshot({ path: `${OUT}/ordinateur-avance-hors-lunette.png` }); }
  await t.ctx.close();
}

// =====================================================================================================
// niveau facile (assisté), réglage, tutoriel, fenêtre étroite
// =====================================================================================================
console.log('\n— facile (assisté), réglage « Conseils », tutoriel —');
{
  const t = await open('facile', 'coach=1', false);
  const { page } = t;
  const s = await setup(page);
  const ref = await truth(page, s.target);
  for (let i = 0; i < 3; i++) await shoot(page, s.target, -ref.off, 0);
  await sleep(400);
  let c = await coach(page);
  check('facile : le conseil s’appuie sur la distance affichée et le losange d’impact prédit, sans télémètre', c.shown && /affichée en haut à droite/.test(c.steps[0]) && c.steps[0].includes(`${Math.round(ref.range)} m`) && /losange orange/.test(c.steps[3]) && !/T en visant/.test(c.steps.join(' ')), c.steps[0]);
  single(c, 'ordinateur, facile');
  await page.screenshot({ path: `${OUT}/ordinateur-facile-lunette.png` });
  // fenêtre étroite : en lunette, version courte adossée au champ
  await page.setViewportSize({ width: 1180, height: 760 }); await sleep(500);
  c = await coach(page);
  check('fenêtre 1180 × 760, en lunette : version courte, hors du champ', c.shown && !c.inField && c.steps.length === 0 && c.short.length > 20 && !c.clipped, JSON.stringify({ rect: c.rect, court: c.short }));
  await page.screenshot({ path: `${OUT}/ordinateur-facile-lunette-1180.png` });
  await t.ctx.close();
}
{
  // mode test sans ?coach=1 : pas d'encart (les parcours automatisés ne sont pas gênés)
  const t = await open('standard', '', false);
  const s = await setup(t.page);
  const off = (await truth(t.page, s.target)).off;
  for (let i = 0; i < 4; i++) await shoot(t.page, s.target, -off, 0);
  const c = await coach(t.page);
  check('parcours automatisés (mode test, sans ?coach=1) : aucun encart après quatre tirs manqués', !c.shown && !c.tracker);
  await t.ctx.close();
}
{
  // tutoriel en cours : il explique déjà la distance, le carnet et la tourelle
  const t = await open('standard', 'coach=1&tuto=1', false);
  const s = await setup(t.page);
  const tuto = await t.page.evaluate(() => !!window.hr.game.tutorial && window.hr.game.tutorial.active);
  const off = (await truth(t.page, s.target)).off;
  for (let i = 0; i < 4; i++) await shoot(t.page, s.target, -off, 0);
  const c = await coach(t.page);
  check('pendant le tutoriel : pas de conseil par-dessus', tuto && !c.shown && !c.tracker, `tutoriel ${tuto ? 'actif' : 'inactif'}`);
  await t.ctx.close();
}
{
  // réglage du menu : « Conseils : Avec / Sans », mémorisé
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(`${BASE}?level=standard&q=low&dr=0`);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2200);
  let m = await page.evaluate(() => ({ sel: document.querySelector('[data-id=segCoach] .sel')?.dataset.k, wanted: window.hr.game.coachWanted(), near: (() => { const a = document.querySelector('.o-tuto').getBoundingClientRect(), b = document.querySelector('.o-coach').getBoundingClientRect(); return Math.round(b.top - a.bottom); })() }));
  check('menu : réglage « Conseils » sous celui du tutoriel, « Avec » par défaut', m.sel === 'on' && m.wanted && m.near >= 0 && m.near < 24, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/ordinateur-menu-conseils.png` });
  await page.click('[data-id=segCoach] [data-k=off]');
  m = await page.evaluate(() => ({ sel: document.querySelector('[data-id=segCoach] .sel')?.dataset.k, wanted: window.hr.game.coachWanted(), stored: localStorage.getItem('hr.coach') }));
  check('« Sans » : conseils coupés, choix mémorisé (localStorage hr.coach)', m.sel === 'off' && !m.wanted && m.stored === 'off', JSON.stringify(m));
  await page.reload(); await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 }); await page.waitForTimeout(800);
  m = await page.evaluate(() => ({ sel: document.querySelector('[data-id=segCoach] .sel')?.dataset.k, wanted: window.hr.game.coachWanted() }));
  check('après rechargement : toujours « Sans »', m.sel === 'off' && !m.wanted, JSON.stringify(m));
  await ctx.close();
  // portrait : la rangée Tutoriel / Conseils tient, cibles ≥ 44 px, accueil sans défilement
  const mctx = await browser.newContext({ viewport: { width: 375, height: 664 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}?level=standard&q=low&dr=0&fs=0`);
  await mp.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
  await mp.waitForTimeout(2200);
  const g = await mp.evaluate(() => { const b = [...document.querySelectorAll('#menu .opt-pair button')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)]; }); const m = document.getElementById('menu'); const lab = [...document.querySelectorAll('#menu .opt-pair .opt > span')].map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, Math.round(r.left), Math.round(r.right)]; }); return { b, lab, sc: m.scrollHeight - m.clientHeight, W: innerWidth }; });
  check('portrait 375 × 664 : Tutoriel et Conseils sur une rangée, quatre boutons ≥ 44 px dans l’écran, accueil sans défilement', g.b.length === 4 && g.b.every((x) => x[2] >= 44 && x[3] >= 44 && x[0] >= 0 && x[1] <= g.W) && g.sc <= 1, JSON.stringify(g));
  await mp.screenshot({ path: `${OUT}/portrait-menu-conseils.png` });
  await mctx.close();
}

await browser.close();
if (errors.length) { fails++; console.log('ERREURS DE PAGE\n' + [...new Set(errors)].join('\n')); }
console.log(`\nconseils : ${total - Math.min(fails, total)}/${total} contrôles réussis${fails ? ` — ${fails} ÉCHEC(S)` : ''}`);
process.exit(fails ? 1 : 0);
