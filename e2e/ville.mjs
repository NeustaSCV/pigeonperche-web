// Ville nouvelle : captures de contrôle depuis quatre emplacements et en vue de dessus. node e2e/ville.mjs   (serveur de développement lancé)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/out', { recursive: true });
const VUES = [['La Médiathèque', -0.12, 3.14], ['Grue de la piscine', -0.5, 0.6], ['Le Carrepoint', -0.3, 0], ['Lycée hôtelier', -0.22, 0.5]];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const mode of ['dessin']) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('ERREUR', String(e).slice(0, 300)));
  await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + 'ville.html?solo');
  await page.waitForFunction(() => window.ville, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#bar, #info, #tir, #tags, #retour { display: none !important; }' });
  for (let i = 0; i < VUES.length; i++) {
    const [nom, site, cap] = VUES[i];
    await page.evaluate(([nom, site, cap]) => { const v = window.ville; v.allerA(nom); v.state.pitch = site; v.state.yaw += cap; v.state.tags = false; }, [nom, site, cap]);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `e2e/out/ville-${mode}-${i + 1}.png` });
  }
  await page.evaluate(() => window.ville.plan(-97, 1064, 520));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `e2e/out/ville-${mode}-5.png` });
  console.log(mode, await page.evaluate(() => window.ville.fps.avg.toFixed(0) + ' i/s'));
  await page.close();
}
await browser.close();
