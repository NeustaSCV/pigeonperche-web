// Captures des voies d'accès aux bâtiments et des cours d'eau : node e2e/routes.mjs [--level <id>] [--tag <nom>] [vues…]
//   vues : carte (vue d'ensemble de dessus), air (vue plongeante de chaque bâtiment et de sa voie), lunette (chaque
//   bâtiment à la lunette depuis le poste qui le voit le mieux), eau (points de `data.testViews` dont le nom commence
//   par « eau- », en vue libre). Toutes par défaut. Sorties : e2e/out/routes/<niveau>-*.png      (HR_URL : copie figée)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const argv = process.argv.slice(2);
const ti = argv.indexOf('--tag');
const TAG = ti >= 0 ? '-' + argv.splice(ti, 2)[1] : '';
const li = argv.indexOf('--level');
if (li >= 0) argv.splice(li, 2);
const want = (v) => !argv.length || argv.includes(v);
const OUT = 'e2e/out/routes/';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.HR_URL || 'http://127.0.0.1:5173/'}?dr=0&q=medium&play&test&fs=0&${LQ}`);
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
await page.waitForTimeout(1200);
await assertLevel(page);
await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); });
const shot = async (name, wait = 1300) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${OUT}${LEVEL}-${name}${TAG}.png` }); };
const cam = (pos, look, fov) => page.evaluate((c) => { window.hr.game.testCam = c; }, { pos, look, fov });

const info = await page.evaluate(() => {
  const g = window.hr.game, m = g.terrain.meta;
  return {
    buildings: (g.buildings?.list ?? []).map((b) => ({ name: b.name, x: b.x, z: b.z, groundY: b.groundY, height: b.height })),
    ways: (m.ways ?? []).map((w) => ({ name: w.name, kind: w.kind, to: w.to ?? null, line: w.line })),
    posts: window.hr.level.posts, baseY: window.hr.level.site.baseY,
  };
});
const H = (x, z) => page.evaluate(([x, z]) => window.hr.game.terrain.heightAt(x, z), [x, z]);

if (want('carte') && info.buildings.length) {
  // de dessus : tous les bâtiments et leurs voies dans le cadre (nord en haut)
  const xs = info.buildings.map((b) => b.x), zs = info.buildings.map((b) => b.z);
  for (const w of info.ways) for (const p of w.line) { xs.push(p[0]); zs.push(p[1]); }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const ext = Math.max((Math.max(...xs) - Math.min(...xs)) / 1.78, Math.max(...zs) - Math.min(...zs)) + 240;
  // la caméra reste sous 2 400 m (au-delà, la brume de la carte voile tout) : le champ s'ouvre à la place
  const up = Math.min(2400, ext / 2 / Math.tan((12 * Math.PI) / 180));
  const y = (await H(cx, cz)) + up;
  await cam([cx, y, cz + 1], [cx, 0, cz], (2 * Math.atan(ext / 2 / up) * 180) / Math.PI);
  await shot('carte', 2500);
}
for (const b of info.buildings) {
  const mine = info.ways.filter((w) => w.to === b.name);
  if (want('air')) {
    // vue plongeante : le bâtiment et toute sa voie jusqu'au raccord, depuis le côté opposé au raccord
    const pts = [[b.x, b.z], ...mine.flatMap((w) => w.line.map((p) => [p[0], p[1]]))];
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ext = Math.max(x1 - x0, z1 - z0, 120) + 90;
    const gy = await H(cx, cz);
    await cam([cx + ext * 0.25, gy + ext * 0.95, cz + ext * 0.62], [cx, gy, cz], 50);
    await shot(`${b.name}-air`);
    // de près : l'arrivée de la voie au bâtiment
    const end = mine.length ? mine[0].line[mine[0].line.length - 1] : [b.x, b.z + 30];
    const far = mine.length ? mine[0].line[Math.max(0, mine[0].line.length - 30)] : [b.x, b.z + 90];
    const dx = far[0] - end[0], dz = far[1] - end[1], l = Math.hypot(dx, dz) || 1;
    await cam([end[0] + (dx / l) * 85 + (dz / l) * 30, b.groundY + 48, end[1] + (dz / l) * 85 - (dx / l) * 30], [end[0], b.groundY + 4, end[1]], 52);
    await shot(`${b.name}-arrivee`);
  }
  if (want('lunette')) {
    // poste qui voit le pied du bâtiment (relief seul) ; à défaut le plus proche
    const best = await page.evaluate((b) => {
      const g = window.hr.game, L = window.hr.level;
      let pick = null;
      for (const [k, p] of Object.entries(L.posts)) {
        g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0);
        const eye = g.player.eye(g.player.pos.clone());
        const out = eye.clone();
        const blocked = g.terrain.raycast(eye.x, eye.y, eye.z, b.x, b.groundY + b.height * 0.5, b.z, out, 4) && Math.hypot(out.x - b.x, out.z - b.z) > 60;
        const d = Math.hypot(b.x - eye.x, b.z - eye.z);
        if (!blocked && (!pick || d < pick.d)) pick = { k, d };
      }
      return pick?.k ?? Object.keys(L.posts)[0];
    }, b);
    for (const zoom of [6, 14]) {
      await page.evaluate(async ({ b, k, zoom }) => {
        const g = window.hr.game, p = window.hr.level.posts[k];
        g.testCam = null;
        g.equip(g.weapons.find((w) => w.scope[1] >= 14)?.id ?? g.weapons[g.weapons.length - 1].id);
        g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0);
        const eye = g.player.eye(g.player.pos.clone());
        const yaw = Math.atan2(b.x - eye.x, -(b.z - eye.z)), pitch = Math.atan2(b.groundY + b.height * 0.25 - eye.y, Math.hypot(b.x - eye.x, b.z - eye.z));
        g.scope.enter(yaw, pitch);
        g.rifle.zoom = Math.min(g.rifle.def.scope[1], Math.max(g.rifle.def.scope[0], zoom));
        g.scope.swayX = g.scope.swayY = 0;
        await new Promise((r) => setTimeout(r, 900));
        g.scope.yaw = yaw; g.scope.pitch = pitch;
      }, { b, k: best, zoom });
      await shot(`${b.name}-lunette-x${zoom}-${best}`, 500);
      await page.evaluate(() => window.hr.game.scope.exit());
    }
  }
}
if (want('eau')) {
  // cours d'eau : vue d'ensemble depuis le site, vue près du bâtiment le plus proche de l'eau, chaque pont
  const W = await page.evaluate(() => {
    const m = window.hr.game.terrain.meta;
    return { river: m.river ?? [], bridges: (m.ways ?? []).flatMap((w) => (w.bridges ?? []).map((b) => ({ ...b, way: w.name }))) };
  });
  if (W.river.length > 1) {
    const near = (x, z) => W.river.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(best[0] - x, best[1] - z) ? p : best), W.river[0]);
    const r0 = near(0, 0);
    await cam([0, info.baseY + 6, -2], [r0[0], r0[2], r0[1]], 46);
    await shot('eau-ensemble');
    await cam([0, info.baseY + 6, -2], [r0[0], r0[2], r0[1]], 9);
    await shot('eau-ensemble-tele');
    let best = null;
    for (const b of info.buildings) { const p = near(b.x, b.z); const d = Math.hypot(p[0] - b.x, p[1] - b.z); if (!best || d < best.d) best = { b, p, d }; }
    if (best) {
      const { b, p, d } = best;
      const ux = (b.x - p[0]) / d, uz = (b.z - p[1]) / d;
      // depuis l'autre rive, en plongée : l'eau au premier plan, le bâtiment derrière
      await cam([p[0] - ux * 95 + uz * 60, p[2] + 60, p[1] - uz * 95 - ux * 60], [(b.x + p[0]) / 2, b.groundY + 6, (b.z + p[1]) / 2], 52);
      await shot(`eau-${b.name}`);
      await cam([p[0] + uz * 160, p[2] + 18, p[1] - ux * 160], [p[0], p[2], p[1]], 40);
      await shot(`eau-${b.name}-rasant`);
      console.log(`cours d'eau : ${Math.round(d)} m de l'axe au centre de « ${b.name} »`);
    }
    // à la lunette depuis le site (premier poste), sur le point de la rivière le plus proche du bâtiment
    if (best) {
      await page.evaluate(async ({ p }) => {
        const g = window.hr.game, k = Object.keys(window.hr.level.posts)[0], P = window.hr.level.posts[k];
        g.testCam = null;
        g.equip(g.weapons[g.weapons.length - 1].id);
        g.player.teleport(P.x, P.z, 0, P.stance, P.y ?? 0);
        const eye = g.player.eye(g.player.pos.clone());
        const yaw = Math.atan2(p[0] - eye.x, -(p[1] - eye.z)), pitch = Math.atan2(p[2] - eye.y, Math.hypot(p[0] - eye.x, p[1] - eye.z));
        g.scope.enter(yaw, pitch);
        g.rifle.zoom = Math.min(g.rifle.def.scope[1], 12);
        g.scope.swayX = g.scope.swayY = 0;
        await new Promise((r) => setTimeout(r, 900));
        g.scope.yaw = yaw; g.scope.pitch = pitch;
      }, { p: best.p });
      await shot('eau-lunette', 600);
      await page.evaluate(() => window.hr.game.scope.exit());
    }
  }
  for (const [i, b] of W.bridges.entries()) {
    await cam([b.x + b.dir[0] * 34 - b.dir[1] * 30, b.deck + 16, b.z + b.dir[1] * 34 + b.dir[0] * 30], [b.x, b.deck - 0.5, b.z], 50);
    await shot(`pont-${i + 1}`);
    await cam([b.x - b.dir[1] * 46, b.deck + 3, b.z + b.dir[0] * 46], [b.x, b.deck - 1, b.z], 40);
    await shot(`pont-${i + 1}-profil`);
  }
}
console.log(`${LEVEL} : ${info.buildings.length} bâtiment(s), ${info.ways.length} voie(s) → ${OUT}`);
if (errors.length) console.log('erreurs :\n' + [...new Set(errors)].slice(0, 8).join('\n'));
await browser.close();
