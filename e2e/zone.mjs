// Zone praticable du site de tir, vue de dessus : node e2e/zone.mjs [--level <id>] [--tag <nom>]     (HR_URL : copie figée)
// Dessine la zone (vert) sur le relief (courbes de niveau tous les 2 m), les postes, et colore sa limite selon sa
// nature : orange = rupture de pente à moins de 1,5 m (rebord, talus), blanc = obstacle des collisions (mur, clôture, rocher,
// bâtiment), rouge = limite invisible en terrain praticable. Compte les trois par secteur de boussole.
// Sortie : e2e/out/routes/<niveau>-zone<-tag>.png ; code de sortie 1 s'il reste plus de 1 % de limite invisible.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const argv = process.argv.slice(2);
const ti = argv.indexOf('--tag');
const TAG = ti >= 0 ? '-' + argv[ti + 1] : '';
mkdirSync('e2e/out/routes', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
await page.goto(`${process.env.HR_URL || 'http://127.0.0.1:5173/'}?dr=0&q=low&play&test&fs=0&${LQ}`);
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
await page.waitForTimeout(800);
await assertLevel(page);
const res = await page.evaluate(() => {
  const g = window.hr.game, p = g.player, t = g.terrain, L = window.hr.level;
  const R = 90, ST = 0.5, N = Math.round((2 * R) / ST) + 1;
  const A = new Uint8Array(N * N), Hh = new Float32Array(N * N);
  const at = (i) => -R + i * ST;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { A[j * N + i] = p.isAllowed(at(i), at(j)) ? 1 : 0; Hh[j * N + i] = t.heightAt(at(i), at(j)); }
  const slope = (x, z) => Math.hypot(t.heightAt(x + 0.6, z) - t.heightAt(x - 0.6, z), t.heightAt(x, z + 0.6) - t.heightAt(x, z - 0.6)) / 1.2;
  // rupture de pente à moins de 1,5 m (la zone joignable est calculée sur une grille de 1 m)
  const steepNear = (x, z) => { if (slope(x, z) > 0.42 || t.heightAt(x, z) < base - 8.5) return true; for (let q = 0; q < 8; q++) for (const r of [0.75, 1.5]) if (slope(x + Math.cos(q * 0.785) * r, z + Math.sin(q * 0.785) * r) > 0.42) return true; return false; };
  const segs = g.col.segs;
  const nearSeg = (x, z) => segs.some((s) => { const dx = s.bx - s.ax, dz = s.bz - s.az; const l2 = dx * dx + dz * dz || 1e-9; const u = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / l2)); return Math.hypot(x - s.ax - dx * u, z - s.az - dz * u) < s.r + 1.1 && s.y1 > t.heightAt(x, z) + 0.4; });
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1000;
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  cv.id = 'zone';
  document.body.appendChild(cv);
  const c = cv.getContext('2d'), K = 1000 / N;
  const base = L.site.baseY;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const tally = Object.fromEntries(names.map((n) => [n, { pente: 0, obstacle: 0, invisible: 0, rmin: 1e9, rmax: 0 }]));
  let area = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, h = Hh[k] - base;
    const v = Math.max(40, Math.min(215, 150 + h * 6));
    const line = Math.floor(Hh[k] / 2) !== Math.floor(Hh[Math.min(N * N - 1, k + 1)] / 2) || Math.floor(Hh[k] / 2) !== Math.floor(Hh[Math.min(N * N - 1, k + N)] / 2);
    let col = A[k] ? `rgb(${v * 0.55},${v},${v * 0.6})` : `rgb(${v},${v * 0.97},${v * 0.9})`;
    if (line) col = A[k] ? 'rgb(50,110,60)' : 'rgb(120,112,100)';
    if (A[k]) area += ST * ST;
    // limite : cellule praticable dont une voisine ne l'est pas
    if (A[k] && i > 0 && j > 0 && i < N - 1 && j < N - 1) {
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (A[(j + b) * N + i + a]) continue;
        const x = at(i + a), z = at(j + b);
        const kind = nearSeg(x, z) || nearSeg(at(i), at(j)) ? 'obstacle' : steepNear(x, z) ? 'pente' : 'invisible';
        const brg = ((Math.atan2(at(i), -at(j)) * 180) / Math.PI + 382.5) % 360;
        const T = tally[names[Math.floor(brg / 45)]];
        T[kind]++;
        const r = Math.hypot(at(i), at(j));
        T.rmin = Math.min(T.rmin, r); T.rmax = Math.max(T.rmax, r);
        col = kind === 'pente' ? 'rgb(240,140,20)' : kind === 'obstacle' ? 'rgb(255,255,255)' : 'rgb(230,20,30)';
        break;
      }
    }
    c.fillStyle = col;
    c.fillRect(i * K, j * K, K + 0.5, K + 0.5);
  }
  c.font = '15px sans-serif';
  const px = (x) => ((x + R) / (2 * R)) * 1000;
  for (const [k, P] of Object.entries(L.posts)) { c.fillStyle = '#102a66'; c.beginPath(); c.arc(px(P.x), px(P.z), 5, 0, 7); c.fill(); c.fillText(k, px(P.x) + 8, px(P.z) + 5); }
  c.fillStyle = '#000'; c.beginPath(); c.arc(px(L.site.start.x), px(L.site.start.z), 4, 0, 7); c.fill(); c.fillText('départ', px(L.site.start.x) + 7, px(L.site.start.z) + 5);
  c.fillStyle = '#000'; c.fillRect(20, 965, (20 / (2 * R)) * 1000, 4); c.fillText('20 m — nord en haut — vert : praticable ; orange : pente ; blanc : obstacle ; rouge : limite invisible', 20, 955);
  return { area: Math.round(area), tally };
});
await page.waitForTimeout(200);
await page.locator('#zone').screenshot({ path: `e2e/out/routes/${LEVEL}-zone${TAG}.png` });
let inv = 0, tot = 0;
console.log(`niveau ${LEVEL}${TAG} : zone praticable ${res.area} m² (dans un carré de 180 m)`);
for (const [n, T] of Object.entries(res.tally)) {
  const s = T.pente + T.obstacle + T.invisible;
  inv += T.invisible; tot += s;
  const main = s ? (T.invisible > s * 0.5 ? 'INVISIBLE' : T.pente >= T.obstacle ? 'rupture de pente' : 'obstacle (mur, clôture, rocher)') : '—';
  console.log(`  ${n.padEnd(2)} : limite de ${T.rmin.toFixed(0)} à ${T.rmax.toFixed(0)} m — pente ${T.pente}, obstacle ${T.obstacle}, invisible ${T.invisible} → ${main}`);
}
console.log(`limite invisible : ${inv} cellule(s) sur ${tot} (${((inv / Math.max(1, tot)) * 100).toFixed(1)} %)`);
// --bord <cap> : le joueur court droit dans ce cap jusqu'à l'arrêt ; captures debout, vue extérieure, couché en lunette
const bi = argv.indexOf('--bord');
if (bi >= 0) {
  const brg = +argv[bi + 1];
  await page.evaluate(() => { document.getElementById('zone').remove(); const g = window.hr.game; g.cinematic = false; if (g.state === 'brief') g.continueBrief(); });
  const end = await page.evaluate((brg) => {
    const g = window.hr.game, p = g.player, L = window.hr.level, yaw = (brg * Math.PI) / 180;
    p.teleport(L.site.start.x, L.site.start.z, yaw, 'stand');
    for (let i = 0; i < 60 * 40; i++) {
      if (g.state !== 'play') g.state = 'play';
      p.yaw = yaw; g.input.enabled = true; g.input.keys.clear(); g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft');
      g.step(1 / 60, 1 / 60); g.input.endFrame();
    }
    g.input.keys.clear();
    p.pitch = -0.22;
    return { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), y: +(p.pos.y - L.site.baseY).toFixed(2), r: +Math.hypot(p.pos.x, p.pos.z).toFixed(1), limit: p.limitAt(p.pos.x + Math.sin(yaw) * 0.8, p.pos.z - Math.cos(yaw) * 0.8) };
  }, brg);
  console.log(`bord, cap ${brg}° : arrêté à ${end.r} m du centre (${end.x}, ${end.z}), ${end.y} m par rapport au site, limite « ${end.limit} »`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `e2e/out/routes/${LEVEL}-bord-debout${TAG}.png` });
  await page.evaluate((brg) => {
    const g = window.hr.game, p = g.player, yaw = (brg * Math.PI) / 180;
    const sx = Math.sin(yaw), sz = -Math.cos(yaw);
    g.testCam = { pos: [p.pos.x - sx * 7 + sz * 6, p.pos.y + 3.2, p.pos.z - sz * 7 - sx * 6], look: [p.pos.x + sx * 6, p.pos.y - 1.5, p.pos.z + sz * 6], fov: 55 };
  }, brg);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `e2e/out/routes/${LEVEL}-bord-exterieur${TAG}.png` });
  await page.evaluate(async (brg) => {
    const g = window.hr.game, p = g.player, yaw = (brg * Math.PI) / 180;
    g.testCam = null;
    p.teleport(p.pos.x, p.pos.z, yaw, 'prone', p.pos.y - window.hr.level.site.baseY);
    await new Promise((r) => setTimeout(r, 900));
    g.testCam = { pos: [p.pos.x - Math.cos(yaw) * 5, p.pos.y + 1.6, p.pos.z - Math.sin(yaw) * 5], look: [p.pos.x, p.pos.y + 0.2, p.pos.z], fov: 50 };
  }, brg);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `e2e/out/routes/${LEVEL}-bord-couche-exterieur${TAG}.png` });
  for (const pitch of [-0.12, -0.45]) {
    await page.evaluate(async ({ brg, pitch }) => {
      const g = window.hr.game, yaw = (brg * Math.PI) / 180;
      g.testCam = null;
      g.scope.enter(yaw, pitch);
      g.rifle.zoom = g.rifle.def.scope[0];
      g.scope.swayX = g.scope.swayY = 0;
      await new Promise((r) => setTimeout(r, 900));
      g.scope.yaw = yaw; g.scope.pitch = pitch;
    }, { brg, pitch });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e/out/routes/${LEVEL}-bord-couche-lunette${pitch < -0.3 ? '-plongee' : ''}${TAG}.png` });
    await page.evaluate(() => window.hr.game.scope.exit());
  }
}
await browser.close();
process.exit(inv > tot * 0.01 && !TAG.includes('avant') ? 1 : 0);
