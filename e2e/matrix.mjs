// Matrice de visibilité poste × cible, calculée dans le jeu par lancer de rayons (terrain + décor) :
// distance (m) si la cible est en vue directe du poste, « · » sinon. Postes et cibles sont ceux du niveau.
// Usage : node e2e/matrix.mjs [--level <id>]
import { chromium } from 'playwright';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + '?dr=0&q=low&play&test&' + LQ);
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await assertLevel(page);
const res = await page.evaluate(async () => {
  const g = window.hr.game;
  g.continueBrief();
  const posts = Object.fromEntries(Object.entries(window.hr.level.posts).map(([k, p]) => [k, [p.x, p.z, p.stance, p.y ?? 0]]));
  const ids = [...g.targets.keys()];
  const out = {};
  for (const [k, p] of Object.entries(posts)) {
    out[k] = {};
    for (const id of ids) {
      const t = g.targets.get(id);
      const a = t.aimPoint(new (g.player.pos.constructor)());
      const yaw = Math.atan2(a.x - p[0], -(a.z - p[1]));
      g.player.teleport(p[0], p[1], yaw, p[2], p[3]);
      g.player.update(0.016, g.input, true);
      const eye = g.player.eye(new (g.player.pos.constructor)());
      out[k][id] = g.canSee(id) ? Math.round(eye.distanceTo(a)) : 0;
    }
  }
  return out;
});
const ids = Object.keys(Object.values(res)[0]);
console.log(`niveau ${LEVEL}`);
console.log('poste'.padEnd(9) + ids.map((i) => i.slice(0, 7).padStart(8)).join(''));
for (const [k, row] of Object.entries(res)) console.log(k.padEnd(9) + ids.map((i) => String(row[i] || '·').padStart(8)).join(''));
await browser.close();
