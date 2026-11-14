// Captures et mesures de l'intégration : bâtiments du niveau (œil nu, lunette), râtelier, carnet de tir.
// Usage : node e2e/integration.mjs [--level <id>] [vues…]      (HR_URL pour tester une copie figée)
//   vues : batiments, ratelier, carnet, portrait (toutes par défaut). Sorties : e2e/out/integration/*.png
//   Les bâtiments sont ceux de `data.buildings` ; le carnet « avancé » et le râtelier à douze armes passent par les
//   surcharges d'essai `?phys=full` et `?arsenal=…` (voir src/levels/README.md), sans toucher au niveau.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const OUT = 'e2e/out/integration/';
mkdirSync(OUT, { recursive: true });
const TAG = LEVEL === 'standard' ? '' : LEVEL + '-';
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('-') && all[i - 1] !== '--level');
const want = (v) => !args.length || args.includes(v);
const URL0 = process.env.HR_URL || 'http://127.0.0.1:5173/';
const TWELVE = '22lr,223,6cm,65cm,65prc,308,7prc,300prc,338lm300,33xc,375ct,50bmg';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
let ok = true;

async function open(query, portrait = false) {
  const page = portrait
    ? await (await browser.newContext({ viewport: { width: 375, height: 664 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })).newPage()
    : await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(`${URL0}?dr=0&q=${portrait ? 'low' : 'medium'}&play&test&fs=0&${LQ}${query ? '&' + query : ''}`);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await assertLevel(page);
  await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); });
  await page.waitForTimeout(400);
  return page;
}

if (want('batiments')) {
  const page = await open('');
  const list = await page.evaluate(() => {
    const g = window.hr.game;
    return (g.buildings?.list ?? []).map((b) => ({ name: b.name, x: b.x, z: b.z, groundY: +b.groundY.toFixed(2), height: +b.height.toFixed(1), posts: Object.fromEntries(Object.entries(window.hr.level.posts).map(([k, p]) => [k, Math.round(Math.hypot(b.x - p.x, b.z - p.z))])) }));
  });
  console.log(`niveau ${LEVEL} : ${list.length} bâtiment(s)`);
  console.table(list.map((b) => ({ nom: b.name, x: b.x, z: b.z, sol: b.groundY, hauteur: b.height, ...b.posts })));
  if (list.length) {
    // œil nu : debout au poste d'où l'on voit le plus de bâtiments (le premier poste « accroupi », sinon le premier)
    const post = await page.evaluate(() => { const P = window.hr.level.posts; const k = Object.keys(P).find((k) => P[k].stance === 'crouch') ?? Object.keys(P)[0]; return { k, ...P[k] }; });
    const cx = list.reduce((s, b) => s + b.x, 0) / list.length, cz = list.reduce((s, b) => s + b.z, 0) / list.length;
    // œil nu : caméra au-dessus du mur du poste (la vue qu'on a debout à un créneau), champ du jeu
    const cam = await page.evaluate(({ post, cx, cz }) => {
      const g = window.hr.game, y = (post.ground ?? window.hr.level.site.baseY) + (post.y ?? 0) + 3.6;
      g.player.teleport(post.x, post.z, Math.atan2(cx - post.x, -(cz - post.z)), 'crouch', post.y ?? 0);
      g.testCam = { pos: [post.x, y, post.z], look: [cx, 40, cz], fov: g.engine.view.baseFov };
      return g.testCam;
    }, { post, cx, cz });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}${TAG}batiments-oeil-nu.png` });
    // téléobjectif sans le masque de la lunette : cadrage large de chaque bâtiment (raccord au sol, teintes, échelle)
    for (const b of list) {
      await page.evaluate(({ b, cam }) => {
        const g = window.hr.game;
        const d = Math.hypot(b.x - cam.pos[0], b.z - cam.pos[2]);
        g.testCam = { pos: cam.pos, look: [b.x, b.groundY + b.height * 0.3, b.z], fov: (2 * Math.atan(95 / d) * 180) / Math.PI };
      }, { b, cam });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}${TAG}batiment-${b.name}-tele.png` });
    }
    await page.evaluate((cam) => { window.hr.game.testCam = { ...cam }; }, cam);
    await page.waitForTimeout(800);
    console.log('niveaux de détail à l’œil nu :', JSON.stringify(await page.evaluate(() => window.hr.game.buildings.stats())));
    await page.evaluate(() => { window.hr.game.testCam = null; });
    // lunette : chaque bâtiment, à deux grossissements, depuis ce même poste
    for (const b of list) {
      for (const zoom of [8, 20]) {
        const st = await page.evaluate(async ({ b, post, zoom }) => {
          const g = window.hr.game;
          g.equip(g.weapons.find((w) => w.scope[1] >= 20)?.id ?? g.weapons[0].id);
          g.player.teleport(post.x, post.z, 0, 'crouch', post.y ?? 0);
          const eye = g.player.eye(g.player.pos.clone());
          const ty = b.groundY + b.height * 0.4;
          const yaw = Math.atan2(b.x - eye.x, -(b.z - eye.z)), pitch = Math.atan2(ty - eye.y, Math.hypot(b.x - eye.x, b.z - eye.z));
          g.scope.enter(yaw, pitch);
          g.rifle.zoom = Math.min(g.rifle.def.scope[1], Math.max(g.rifle.def.scope[0], zoom));
          g.scope.swayX = g.scope.swayY = 0;
          await new Promise((r) => setTimeout(r, 900));
          g.scope.yaw = yaw; g.scope.pitch = pitch;
          await new Promise((r) => setTimeout(r, 300));
          return { lod: g.buildings.stats().find((s) => s.name === b.name), calls: g.engine.stats.calls, tris: g.engine.stats.tris, dist: Math.round(Math.hypot(b.x - eye.x, b.z - eye.z)) };
        }, { b, post, zoom });
        await page.screenshot({ path: `${OUT}${TAG}batiment-${b.name}-x${zoom}.png` });
        console.log(`${b.name} en lunette ×${zoom} à ${st.dist} m : niveau ${st.lod.lod} (${st.lod.triangles} tri), image ${st.calls} appels, ${(st.tris / 1e6).toFixed(2)} M tri`);
        await page.evaluate(() => window.hr.game.scope.exit());
      }
    }
    // collisions : un rayon tiré du poste vers le milieu de chaque bâtiment doit s'y arrêter
    const hits = await page.evaluate(({ list, post }) => {
      const g = window.hr.game;
      g.player.teleport(post.x, post.z, 0, 'crouch', post.y ?? 0);
      const eye = g.player.eye(g.player.pos.clone());
      return list.map((b) => {
        const best = { name: b.name, hit: -1 };
        // une grille de points sur le lot, à plusieurs hauteurs : le lot n'est pas bâti partout, et un rayon peut passer par une fenêtre
        for (const k of [0.15, 0.3, 0.5])
          for (let dx = -24; dx <= 24; dx += 6)
            for (let dz = -18; dz <= 18; dz += 6) {
              const to = eye.clone().set(b.x + dx, b.groundY + b.height * k, b.z + dz);
              const d = g.col.segment(eye, to);
              if (d >= 0 && (best.hit < 0 || d < best.hit)) best.hit = Math.round(d);
            }
        return best;
      });
    }, { list, post });
    console.log('collisions (distance du premier obstacle sur la ligne poste → bâtiment) :', JSON.stringify(hits));
    if (hits.some((h) => h.hit < 0)) { console.log('! un bâtiment n’arrête pas le rayon'); ok = false; }
  }
  await page.close();
}

if (want('ratelier')) {
  for (const [tag, q] of [['niveau', ''], ['12', 'arsenal=' + TWELVE]]) {
    const page = await open(q);
    const n = await page.evaluate(() => window.hr.game.weapons.length);
    // vue du râtelier depuis la cour, puis l'écran du râtelier
    await page.evaluate(() => {
      const g = window.hr.game, r = window.hr.level.site.rack, y = window.hr.level.site.baseY;
      g.testCam = { pos: [r.x + 0.3, y + 1.35, r.z - 2.3], look: [r.x, y + 0.85, r.z + 1.1], fov: 62 };
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}${TAG}ratelier-${tag}-3d.png` });
    await page.evaluate(() => { const g = window.hr.game; g.testCam = null; g.ui.openRack(g.rifle.def.id); g.setState('rack'); });
    await page.waitForTimeout(300);
    // clavier : dernière touche de la rangée, puis flèche vers le haut
    const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
    const picked = [];
    for (let i = 0; i < n; i++) { await page.keyboard.press(keys[i]); await page.waitForTimeout(60); picked.push(await page.evaluate(() => window.hr.game.ui.rackSel)); }
    const ids = await page.evaluate(() => window.hr.game.weapons.map((w) => w.id));
    const good = picked.every((id, i) => id === ids[i]);
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(80);
    const up = await page.evaluate(() => window.hr.game.ui.rackSel);
    await page.screenshot({ path: `${OUT}${TAG}ratelier-${tag}-liste.png` });
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const cur = await page.evaluate(() => ({ id: window.hr.game.rifle.def.id, state: window.hr.game.state }));
    console.log(`râtelier (${tag}) : ${n} armes ; touches ${good ? 'toutes bonnes' : 'ERREUR ' + picked.join(',')} ; ↑ → ${up} ; Entrée → ${cur.id} en main (${cur.state})`);
    if (!good || up !== ids[n - 2] || cur.id !== up) ok = false;
    await page.close();
  }
}

if (want('carnet')) {
  for (const [tag, q, weapon] of [['neutre', '', null], ['neutre-g7', 'arsenal=' + TWELVE, '300prc'], ['avance', 'phys=full&alt=1800&temp=8&lat=46&arsenal=' + TWELVE, '300prc'], ['avance-elr', 'phys=full&alt=1800&temp=8&lat=46&dope=2500&arsenal=' + TWELVE, '338lm300']]) {
    const page = await open(q);
    const t = await page.evaluate((weapon) => {
      const g = window.hr.game;
      if (weapon) g.equip(weapon);
      g.player.yaw = 5.97; // azimut 342°
      const t0 = performance.now();
      const d = g.bookData(g.rifle.def);
      const t1 = performance.now();
      g.bookData(g.rifle.def);
      const t2 = performance.now();
      g.ui.openBook(d, g.mission.log, g.rifle.elevMil, g.rifle.windMil);
      g.setState('book');
      return { first: +(t1 - t0).toFixed(1), cached: +(t2 - t1).toFixed(2), rows: (d.adv?.rows ?? d.flat).length, drag: d.drag, adv: !!d.adv, hold: d.adv ? d.adv.rows.filter((r) => r.hold > 0).length : 0 };
    }, weapon);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${TAG}carnet-${tag}.png` });
    const fit = await page.evaluate(() => { const c = document.querySelector('#book .card'), t = document.querySelector('#book table.dope'), s = t.parentElement; return { card: Math.round(c.getBoundingClientRect().width), table: Math.round(t.getBoundingClientRect().width), room: Math.round(s.clientWidth), over: t.scrollWidth > s.clientWidth + 1 }; });
    console.log(`carnet ${tag} : ${t.drag}, ${t.adv ? 'décomposé' : 'simple'}, ${t.rows} lignes, ${t.hold} en contre-visée ; calcul ${t.first} ms, relecture ${t.cached} ms ; table ${fit.table} px dans ${fit.room} px${fit.over ? ' — DÉBORDE' : ''}`);
    if (fit.over) ok = false;
    await page.close();
  }
}

if (want('portrait')) {
  const page = await open('phys=full&alt=1800&temp=8&lat=46&dope=2500&arsenal=' + TWELVE, true);
  for (const weapon of ['300prc', '338lm300']) {
    await page.evaluate((weapon) => { const g = window.hr.game; g.equip(weapon); g.player.yaw = 5.97; g.ui.openBook(g.bookData(g.rifle.def), g.mission.log, g.rifle.elevMil, g.rifle.windMil); g.setState('book'); }, weapon);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${TAG}portrait-carnet-${weapon}.png` });
    // aucune fiche ne doit dépasser la largeur de l'écran
    const over = await page.evaluate(() => [...document.querySelectorAll('#book .dl1')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth).length);
    const n = await page.evaluate(() => document.querySelectorAll('#book .dl').length);
    console.log(`portrait, carnet ${weapon} : ${n} fiches, ${over} qui débordent`);
    if (over) ok = false;
    await page.evaluate(() => window.hr.game.setState('play'));
  }
  await page.evaluate(() => { const g = window.hr.game; g.ui.openRack(g.rifle.def.id); g.setState('rack'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${TAG}portrait-ratelier-12.png` });
  // au doigt : toucher la dernière arme de la liste la sélectionne
  const last = await page.evaluate(() => { const b = [...document.querySelectorAll('#rack [data-w]')].pop(); const r = b.getBoundingClientRect(); return { id: b.dataset.w, x: r.x + r.width / 2, y: r.y + r.height / 2, h: Math.round(r.height), inView: r.bottom <= innerHeight && r.top >= 0 }; });
  await page.touchscreen.tap(last.x, last.y);
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => window.hr.game.ui.rackSel);
  console.log(`portrait, râtelier à 12 : dernière arme ${last.id} (bouton de ${last.h} px, ${last.inView ? 'visible' : 'HORS ÉCRAN'}) → sélection ${sel}`);
  if (sel !== last.id || !last.inView) ok = false;
  await page.close();
}

if (errors.length) { console.log('ERREURS\n' + [...new Set(errors)].join('\n')); ok = false; }
await browser.close();
process.exit(ok ? 0 : 1);
