// Mesure de performance : node e2e/perf.mjs [--level <id>] [vue|all] "variante1" "variante2" ...
// Chaque image est rendue REP fois (4 par défaut) : cadence / REP = coût réel d'une image, hors plafond d'affichage.
// Les vues sont celles du niveau (data.testViews : position, posture, regard ou lunette réglée sur une cible) ; un
// niveau qui n'en déclare pas a deux vues génériques, `depart` (point de départ, debout) et `lunette` (dernier
// objectif du plan de tir). `all` (ou aucune vue) : toutes les vues du niveau. Sans vsync, résolution dynamique coupée.
// Carte d'origine : tp (troisième personne, cour), nord (vue vallée), sun (contre-jour), scope (lunette sur le marché).
import { chromium } from 'playwright';
import { LEVEL, LQ } from './levellib.mjs';
const args = process.argv.slice(2);
const li = args.indexOf('--level');
if (li >= 0) args.splice(li, 2);
const firstIsView = args.length && !args[0].includes('=');
const view0 = firstIsView ? args.shift() : 'all';
const variants = args.length ? args : ['q=medium'];
const REP = +(process.env.REP || 4);
const W = +(process.env.W || 2560), H = +(process.env.H || 1440);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
let views = view0 === 'all' ? null : [view0];
for (const v of variants) {
  for (let vi = 0; vi < (views ? views.length : 1); vi++) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
    const t0 = Date.now();
    await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + '?dr=0&play&test&tuto=0&rep=' + REP + '&' + v + (/(^|&)level=/.test(v) ? '' : '&' + LQ));
    await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
    const load = Date.now() - t0;
    await page.waitForTimeout(900);
    if (!views) views = await page.evaluate(() => Object.keys(window.hr.level.testViews ?? { depart: 1, lunette: 1 }));
    const view = views[vi];
    const ok = await page.evaluate(async (view) => {
      const g = window.hr.game, L = window.hr.level;
      g.cinematic = false;
      if (g.state === 'brief') g.continueBrief();
      let V = L.testViews?.[view];
      if (!V && view === 'depart') V = { at: [L.site.start.x, L.site.start.z, L.site.start.yaw, 'stand'] };
      if (!V && view === 'lunette') { const P = L.testPlan[L.testPlan.length - 1], p = L.posts[P.post]; V = { at: [p.x, p.z, 0, p.stance, p.y ?? 0], scope: { weapon: P.weapon, zoom: P.zoom, target: P.targets[0] } }; }
      if (!V) return false;
      if (V.scope) g.equip(V.scope.weapon);
      g.player.teleport(...V.at);
      if (V.scope) {
        g.scope.enter(V.at[2], -0.1);
        g.rifle.zoom = Math.min(g.rifle.def.scope[1], V.scope.zoom);
        await new Promise((r) => setTimeout(r, 300));
        g.testPrepare(V.scope.target);
        g.testDial(V.scope.target);
      } else g.player.pitch = V.pitch ?? 0;
      return true;
    }, view);
    if (!ok) { console.log(`! vue « ${view} » inconnue du niveau ${LEVEL} (data.testViews)`); await page.close(); continue; }
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const g = window.hr.game;
      if (g.state === 'brief') g.continueBrief();
      const n0 = g.perf.frames, t0 = performance.now();
      await new Promise((r) => setTimeout(r, 2500));
      const ms = (performance.now() - t0) / (g.perf.frames - n0);
      const e = g.engine;
      return { ms: +ms.toFixed(2), step: +g.perf.step.toFixed(2), submit: +g.perf.submit.toFixed(2), calls: e.stats.calls, tris: e.stats.tris, pr: e.pixelRatio };
    });
    if (process.env.SHOT) await page.screenshot({ path: `e2e/out/perf-${LEVEL}-${view}.png` });
    console.log(`${LEVEL.padEnd(9)} ${view.padEnd(16)} ${v.padEnd(14)} ${(r.ms / REP).toFixed(1).padStart(5)} ms par image (${(1000 / (r.ms / REP)).toFixed(0)} i/s hors plafond ; simulation ${r.step} ms) | ${r.calls} appels, ${(r.tris / 1e6).toFixed(2)} M tri, pr ${r.pr}, chargement ${load} ms${errs.length ? ' ERR ' + errs[0] : ''}`);
    await page.close();
  }
}
await browser.close();
