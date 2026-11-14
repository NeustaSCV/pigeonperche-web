// Mission jouée de bout en bout par un tireur automatique : vérifie que chacune des cibles du niveau
// est atteignable depuis un poste de tir réel, avec une arme du râtelier, à travers la vraie balistique.
// Le plan (poste, arme, grossissement par objectif) est celui du niveau : data.testPlan.
// Usage : node e2e/mission.mjs [--level <id>] [--shots] [--portrait]
//   --level    niveau joué (standard par défaut)
//   --shots    captures de la vue lunette dans e2e/out/
//   --portrait même mission sur un téléphone tenu à la verticale (contexte tactile 375 × 664, commandes à l'écran,
//              champ de la lunette dans la moitié haute) : la visée, le télémètre et le tir doivent rester exacts
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const SHOTS = process.argv.includes('--shots');
const PORTRAIT = process.argv.includes('--portrait');
const TAG = (LEVEL === 'standard' ? '' : LEVEL + '-') + (PORTRAIT ? 'portrait-' : '');
mkdirSync('e2e/out', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = PORTRAIT
  ? await (await browser.newContext({ viewport: { width: 375, height: 664 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })).newPage()
  : await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + (PORTRAIT ? '?dr=0&q=low&play&test&fs=0&' : '?dr=0&q=medium&play&test&') + LQ);
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await assertLevel(page);
const PLAN = await page.evaluate(() => window.hr.level.testPlan);
await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); });
if (PORTRAIT) {
  const v = await page.evaluate(() => ({ touch: window.hr.touch, view: window.hr.engine.view, cls: document.documentElement.className }));
  console.log('portrait :', JSON.stringify(v));
  if (!v.touch || !v.view.portrait) { console.log('! la mise en page portrait n’est pas active'); process.exit(1); }
}
const sleep = (ms) => page.waitForTimeout(ms);
let ok = true, centred = 0;
const rows = [];
for (const P of PLAN) {
  const st = await page.evaluate(() => ({ state: window.hr.game.state, id: window.hr.game.mission.step.id }));
  if (st.state === 'brief') await page.evaluate(() => window.hr.game.continueBrief());
  if (st.id !== P.step) { console.log(`! étape attendue ${P.step}, étape courante ${st.id}`); ok = false; break; }
  await page.evaluate(({ post, weapon, zoom }) => {
    const g = window.hr.game;
    const p = window.hr.level.posts[post];
    g.equip(weapon);
    g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0);
    g.player.heartRate = 60;
    g.scope.enter(0, 0);
    g.rifle.zoom = Math.min(g.rifle.def.scope[1], zoom);
  }, P);
  await sleep(500);
  for (const id of P.targets) {
    let done = false, tries = 0, info = null;
    // crochets du niveau : une cible peut demander une mise en place (foule figée) ou une attente (véhicule en vue)
    await page.evaluate((id) => window.hr.game.testPrepare(id), id);
    const isReady = () => page.evaluate((id) => window.hr.game.testReady(id), id);
    const waitReady = () => page.waitForFunction((id) => window.hr.game.testReady(id), id, { timeout: 240000, polling: 500 });
    if (!(await isReady())) await waitReady();
    while (!done && tries < 10) {
      tries++;
      info = await page.evaluate((id) => {
        const g = window.hr.game;
        if (!g.rifle.chambered && g.rifle.mag === 0) g.rifle.reload();
        return { ...g.autoAim(id), ready: g.rifle.ready };
      }, id);
      if (!info.visible) { if (!(await isReady())) { tries--; await waitReady(); continue; } break; }
      if (!info.ready) { await sleep(400); tries--; continue; }
      // capture : tourelles réglées pour la cible (testDial), sinon elle sort du champ au-delà de 1 500 m
      if (SHOTS && tries === 1) { await page.evaluate((id) => window.hr.game.testDial(id), id); await sleep(350); await page.evaluate((id) => window.hr.game.testDial(id), id); await page.screenshot({ path: `e2e/out/cible-${TAG}${P.step}-${id}.png` }); }
      // on ré-aligne juste avant le départ du coup (cible mobile, vent qui tourne)
      if (PORTRAIT && tries === 1) {
        // la ligne de visée doit sortir par le centre optique affiché : le point visé se projette sur (cx, cy)
        // (caméra recalculée sans avancer le temps, pour mesurer la visée et la projection de la même image)
        const off = await page.evaluate((id) => { const g = window.hr.game, e = g.engine, v = e.view; g.autoAim(id); g.step(0, 0); const eye = g.player.eye(e.camera.position.clone()); const p = g.scope.lineOfSight(eye.clone()).multiplyScalar(800).add(eye).project(e.camera); return Math.hypot((p.x * 0.5 + 0.5) * v.w - v.cx, (1 - (p.y * 0.5 + 0.5)) * v.h - v.cy); }, id);
        if (!(off < 0.6)) { console.log(`! ${id} : la ligne de visée sort à ${off.toFixed(2)} px du centre optique`); ok = false; }
        else centred++;
      }
      await page.evaluate((id) => { const g = window.hr.game; g.autoAim(id); g.steadyFire(); }, id);
      await page.waitForFunction(() => window.hr.game.shots.bullets.length === 0, null, { timeout: 15000 });
      await sleep(250);
      done = await page.evaluate((id) => window.hr.game.targets.get(id).done, id);
    }
    const last = await page.evaluate(() => window.hr.game.mission.log[0]);
    rows.push({ cible: id, poste: P.post, arme: P.weapon, visible: info.visible, distance: Math.round(info.dist), vol: info.tof.toFixed(2), tirs: tries, resultat: done ? 'neutralisée' : info.visible ? 'ÉCHEC' : 'INVISIBLE', dernier: last?.result });
    if (!done) ok = false;
  }
  // attendre la validation de l'objectif et passer au suivant
  try { await page.waitForFunction(() => ['brief', 'end', 'fail'].includes(window.hr.game.state), null, { timeout: 9000 }); } catch { /* reste en jeu */ }
  const s2 = await page.evaluate(() => window.hr.game.state);
  if (s2 === 'fail') { console.log('! mission en échec :', await page.evaluate(() => window.hr.game.mission.failed)); ok = false; break; }
  if (s2 === 'brief') await page.evaluate(() => window.hr.game.continueBrief());
}
console.table(rows);
const fin = await page.evaluate(() => { const g = window.hr.game; return { etat: g.state, objectif: g.mission.index, fini: g.mission.finished, tirs: g.mission.totalShots, touches: g.mission.totalHits, alerte: Math.round(g.mission.alert), alarme: g.mission.alarm, score: g.mission.finished ? g.mission.score() : null }; });
console.log(`niveau ${LEVEL} : ${rows.filter((r) => r.resultat === 'neutralisée').length} cibles neutralisées sur ${PLAN.reduce((n, P) => n + P.targets.length, 0)}`);
console.log(JSON.stringify(fin));
if (PORTRAIT) console.log(`ligne de visée sur le centre optique (à 0,6 px près) : ${centred} cibles sur ${rows.length}`);
if (SHOTS) { await sleep(800); await page.screenshot({ path: `e2e/out/${LEVEL === 'standard' ? '' : LEVEL + '-'}${PORTRAIT ? 'mobile-fin' : 'fin'}.png` }); }
if (errors.length) console.log('ERREURS\n' + [...new Set(errors)].join('\n'));
await browser.close();
process.exit(ok && fin.fini ? 0 : 1);
