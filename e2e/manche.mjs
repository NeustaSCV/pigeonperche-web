// Ville nouvelle : duel de contrôle entre deux navigateurs sur la manche du serveur. node e2e/manche.mjs   (serveur de développement lancé)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/out', { recursive: true });
const URL0 = (process.env.HR_URL || 'http://127.0.0.1:5173/') + 'ville.html?pseudo=';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ouvre = async (pseudo) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('ERREUR', pseudo, String(e).slice(0, 300)));
  await page.goto(URL0 + pseudo);
  await page.waitForFunction(() => window.ville?.state.enLigne, null, { timeout: 120000 });
  return page;
};
const etat = (p) => p.evaluate(() => ({ moi: window.ville.reseau.moi(), poste: window.ville.state.post, couche: !!window.ville.state.couche, joueurs: [...window.ville.reseau.joueurs.values()].map((j) => `${j.pseudo}@${j.emp}:${j.points}pts${j.vivant ? '' : ' couché'}`) }));
const anna = await ouvre('Anna'); let bob = await ouvre('Bob');
console.log('entrée', JSON.stringify(await etat(anna)));
let res = null;
for (let essai = 1; essai <= 8 && !res?.touche; essai++) {
  await anna.waitForTimeout(1500);
  res = await anna.evaluate(() => {
    const v = window.ville, autre = [...v.reseau.joueurs.values()].find((j) => j.id !== v.reseau.moi()), e = v.EMP.find((q) => q.nom === autre.emp);
    const s = v.tir.solution(e), c = v.tir.centre(e, v.camera.position.clone()).sub(v.camera.position);
    v.state.scope = true; v.state.mag = 14; v.state.yaw = Math.atan2(-c.x, -c.z); v.state.pitch = Math.atan2(c.y, Math.hypot(c.x, c.z)); v.draw();
    v.tir.etat.pret = 0; v.tir.etat.elev = Math.round(s.dialMil * 10) / 10; const r = v.tir.tirer();
    return { cible: autre.emp, dist: Math.round(s.range), touche: r?.touche?.nom ?? null, mur: !!r?.mur, tof: r?.tof };
  });
  console.log('essai', essai, JSON.stringify(res));
  if (!res.touche) { await bob.close(); bob = await ouvre('Bob'); }      // ligne de visée masquée : Bob reparaît ailleurs
}
if (res?.touche) {
  await anna.waitForTimeout(res.tof * 1000 + 500);
  await anna.screenshot({ path: 'e2e/out/manche-tireur.png' }); await bob.screenshot({ path: 'e2e/out/manche-cible.png' });
  console.log('après la touche, côté Anna', JSON.stringify(await etat(anna)));
  console.log('après la touche, côté Bob ', JSON.stringify(await etat(bob)));
  await bob.waitForTimeout(5600);
  console.log('après le retour, côté Bob ', JSON.stringify(await etat(bob)));
}
await bob.close(); await anna.waitForTimeout(800);
console.log('Bob parti, côté Anna', JSON.stringify(await etat(anna)));
await browser.close();
