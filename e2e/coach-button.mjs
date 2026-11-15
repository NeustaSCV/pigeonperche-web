// Bouton « Conseil » : il apparaît quand on referme le conseil affiché après plusieurs tirs manqués, le rouvre (clic,
// toucher ou touche Entrée), et disparaît quand l'objectif est validé ou les conseils coupés.
//   HR_URL=http://127.0.0.1:5196/ PLAYWRIGHT_BROWSERS_PATH=0 node e2e/coach-button.mjs
import { chromium } from 'playwright';
const URL = process.env.HR_URL || 'http://127.0.0.1:5196/';
let ok = 0, ko = 0;
const check = (name, cond, detail = '') => { if (cond) ok++; else { ko++; console.log('ÉCHEC', name, detail); } };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const errors = [];
for (const [nom, vp, q] of [['ordinateur', { width: 1280, height: 720 }, ''], ['téléphone', { width: 390, height: 844 }, '&touch=1']]) {
  const page = await browser.newPage({ viewport: vp, hasTouch: !!q, isMobile: !!q });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(URL + '?test=1&play=1&coach=1&level=facile' + q);
  await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  // jusqu'au jeu : le briefing peut se présenter après la courte introduction
  for (let i = 0; i < 20; i++) { const state = await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; if (g.state === 'brief') g.continueBrief(); return g.state; }); if (state === 'play') break; await page.waitForTimeout(300); }
  await page.waitForTimeout(400);
  const st = () => page.evaluate(() => { const b = document.querySelector('.coach-again'), c = document.querySelector('[data-id="coach"]'); const r = b ? b.getBoundingClientRect() : null; return { btn: !!b && !b.classList.contains('hidden'), coach: !c.classList.contains('hidden'), tracker: window.hr.game.coach.visible, box: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null, W: innerWidth, H: innerHeight }; });
  let s = await st();
  check(`${nom} : pas de bouton tant qu'aucun conseil n'a été affiché`, !s.btn && !s.coach, JSON.stringify(s));
  // trois tirs manqués sur la cible de l'objectif : le conseil s'ouvre
  await page.evaluate(() => { const g = window.hr.game; const t = g.targets.get(g.mission.step.targets[0]); let sig = null; for (let i = 0; i < 3; i++) sig = g.coach.record({ kind: 'miss', target: t.id, offset: { up: -1.2, right: 0.4 } }); if (sig && 'show' in sig) g.openCoach(t, sig.show, sig.reminder); });
  await page.waitForTimeout(300);
  s = await st();
  check(`${nom} : le conseil s'ouvre après trois tirs manqués, sans bouton`, s.coach && s.tracker && !s.btn, JSON.stringify(s));
  await page.evaluate(() => window.hr.game.closeCoach());
  await page.waitForTimeout(200);
  s = await st();
  check(`${nom} : conseil refermé, le bouton « Conseil » apparaît`, !s.coach && s.btn, JSON.stringify(s));
  check(`${nom} : bouton entièrement dans l'écran`, !!s.box && s.box[0] >= 0 && s.box[1] >= 0 && s.box[2] <= s.W && s.box[3] <= s.H, JSON.stringify(s));
  if (q) check(`${nom} : cible tactile d'au moins 40 px de haut`, s.box[3] - s.box[1] >= 40, JSON.stringify(s.box));
  await page.screenshot({ path: `e2e/out/conseil-bouton-${q ? 'tel' : 'bureau'}.png` });
  // rouvrir : clic ou toucher
  await page.click('.coach-again');
  await page.waitForTimeout(250);
  s = await st();
  check(`${nom} : le bouton rouvre le conseil et s'efface`, s.coach && s.tracker && !s.btn, JSON.stringify(s));
  // en lunette aussi
  await page.evaluate(() => { const g = window.hr.game; g.closeCoach(); const p = g.data.posts[g.data.testPlan[0].post]; g.player.teleport(p.x, p.z, 0, p.stance, p.y ?? 0); g.scope.enter(0, 0); });
  await page.waitForTimeout(900);
  s = await st();
  check(`${nom} : bouton visible et dans l'écran en lunette`, s.btn && s.box[0] >= 0 && s.box[2] <= s.W && s.box[1] >= 0 && s.box[3] <= s.H, JSON.stringify(s));
  await page.screenshot({ path: `e2e/out/conseil-bouton-lunette-${q ? 'tel' : 'bureau'}.png` });
  if (!q) {
    // touche Entrée : rouvre, puis referme
    await page.locator('#view').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    s = await st();
    check(`${nom} : Entrée rouvre le conseil`, s.coach && !s.btn, JSON.stringify(s));
    await page.evaluate(() => window.hr.game.closeCoach());
    await page.waitForTimeout(150);
  }
  // hors du jeu (pause) le bouton s'efface, et revient à la reprise
  await page.evaluate(() => window.hr.game.setState('pause'));
  await page.waitForTimeout(150);
  s = await st();
  check(`${nom} : bouton masqué pendant la pause`, !s.btn, JSON.stringify(s));
  await page.evaluate(() => window.hr.game.setState('play'));
  await page.waitForTimeout(150);
  s = await st();
  check(`${nom} : bouton de retour à la reprise`, s.btn, JSON.stringify(s));
  // objectif validé : plus de bouton
  await page.evaluate(() => { const g = window.hr.game; g.mission.onStepDone(g.mission.step, { shots: 1, hits: 1, time: 1, distance: 65, weapon: '', points: 1000 }); });
  await page.waitForTimeout(200);
  s = await st();
  check(`${nom} : objectif validé, le bouton disparaît`, !s.btn && !s.coach, JSON.stringify(s));
  await page.close();
}
await browser.close();
check('aucune erreur de page', errors.length === 0, errors.join(' | '));
console.log(`bouton conseil : ${ok} contrôles réussis sur ${ok + ko}`);
process.exit(ko ? 1 : 0);
