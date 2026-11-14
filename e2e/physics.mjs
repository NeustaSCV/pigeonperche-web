// Physique avancée dans le jeu : le tir RÉEL (Shots.fire, boucle du jeu, collisions) arrive-t-il là où le solveur
// (firingSolution, celui du carnet) le dit ? Armes G7 et ELR, à 1 000 et 2 000 m, tous les effets actifs.
// Usage : node e2e/physics.mjs [--level <id>]        (HR_URL pour une copie figée)
// Le niveau est chargé avec les surcharges d'essai `?phys=full&alt=1800&temp=8&lat=46&arsenal=…`. La cible est un plan
// fictif perpendiculaire à la ligne de visée, à la distance voulue, en plein ciel au-dessus de la vallée. Pour comparer
// à un calcul, le vent du jeu (rafales, abri du fond de vallée) est remplacé par un vent uniforme et le tirage de la
// déstabilisation transsonique est neutralisé : c'est le vol que l'on contrôle, pas l'aléa.
import { chromium } from 'playwright';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const ARMS = ['65prc', '300prc', '338lm300', '33xc', '375ct', '416b'];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + '?dr=0&q=low&play&test&' + LQ + '&phys=full&alt=1800&temp=8&lat=46&arsenal=' + ARMS.join(','));
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 180000 });
await page.waitForTimeout(1200);
await assertLevel(page);
await page.evaluate(() => { const g = window.hr.game; g.cinematic = false; g.continueBrief(); });
const env = await page.evaluate(() => window.hr.game.benv);
console.log('environnement :', JSON.stringify(env));
const rows = [];
let ok = !!env;
for (const id of ARMS) {
  for (const range of [1000, 2000]) {
    for (const wind of [0, 4]) {
      const r = await page.evaluate(async ({ id, range, wind }) => {
        const g = window.hr.game, V = g.player.pos.constructor;
        g.equip(id);
        // ligne de visée en plein ciel : du haut du site, vers le haut de 3°, à l'azimut le plus dégagé (essayé en jeu)
        const eye = new V(0, window.hr.level.site.baseY + 12, 0);
        const pitch = 0.05;
        let bearing = -1;
        for (const b of [60, 250, 300, 20, 100, 140, 200, 340]) {
          const a = (b * Math.PI) / 180, d = new V(Math.sin(a) * Math.cos(pitch), Math.sin(pitch), -Math.cos(a) * Math.cos(pitch));
          const far = eye.clone().addScaledVector(d, range + 60);
          // la trajectoire reste au-dessus de la ligne de visée jusqu'au plan : il suffit que la ligne soit dégagée (5 m de marge)
          let free = g.col.segment(eye, far) < 0;
          for (let t = 20; free && t <= range + 60; t += 20) if (g.terrain.heightAt(eye.x + d.x * t, eye.z + d.z * t) > eye.y + d.y * t - 5) free = false;
          if (free) { bearing = b; break; }
        }
        if (bearing < 0) return { err: 'aucun azimut dégagé' };
        const a = (bearing * Math.PI) / 180;
        const los = new V(Math.sin(a) * Math.cos(pitch), Math.sin(pitch), -Math.cos(a) * Math.cos(pitch));
        const windFrom = bearing - 70;
        // vent uniforme (ou nul) à la place du champ de vent du jeu, le temps du tir
        const wb = ((windFrom + 180) * Math.PI) / 180, wx = Math.sin(wb) * wind, wz = -Math.cos(wb) * wind;
        const sample0 = g.wind.sample, random0 = Math.random;
        g.wind.sample = (_x, _y, _z, out) => { out.x = wx; out.z = wz; out.speed = wind; out.gust = 0; return out; };
        const sol = g.testSolution(range, bearing, Math.sin(pitch) * range, wind, windFrom);
        if (!sol) { g.wind.sample = sample0; return { err: 'hors de portée' }; }
        const c = eye.clone().addScaledVector(los, range);
        const plane = { id: '__plan', active: true, done: false, group: { visible: false }, update() {}, segment(p, q) { const da = p.clone().sub(c).dot(los), db = q.clone().sub(c).dot(los); return da < 0 && db >= 0 ? { t: da / (da - db), part: 'plan' } : null; }, onHit: () => ({ kind: 'steel', success: false }) };
        const targets0 = g.shots.targets, impact0 = g.shots.onImpact;
        let rep = null;
        g.shots.targets = [plane];
        g.shots.onImpact = (x) => { rep = x; };
        Math.random = () => 0.25;
        g.shots.fire(eye, los, g.rifle.def, sol.elevMil, sol.windMil, false);
        const t0 = performance.now();
        while (!rep && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 30));
        Math.random = random0;
        g.wind.sample = sample0;
        g.shots.targets = targets0;
        g.shots.onImpact = impact0;
        if (!rep || rep.target !== plane) return { err: rep ? 'arrêté avant le plan (' + rep.kind + ' à ' + Math.round(rep.distance) + ' m)' : 'pas d’impact' };
        const right = new V().crossVectors(los, new V(0, 1, 0)).normalize(), up = new V().crossVectors(right, los);
        const d = rep.point.clone().sub(c);
        return { bearing, drag: g.rifle.def.dragModel ?? 'G1', elev: sol.elevMil, windage: sol.windMil, upMil: (d.dot(up) / range) * 1000, rightMil: (d.dot(right) / range) * 1000, tofSol: sol.tof, tof: rep.tof, vSol: sol.velocity, v: rep.velocity };
      }, { id, range, wind });
      if (r.err) { rows.push({ arme: id, distance: range, vent: wind, resultat: r.err }); ok = false; continue; }
      const miss = Math.hypot(r.upMil, r.rightMil);
      const good = miss < 0.05 && Math.abs(r.tof - r.tofSol) < 0.02;
      if (!good) ok = false;
      rows.push({ arme: id, trainee: r.drag, distance: range, vent: wind, azimut: r.bearing, elevation: r.elev.toFixed(2), derive: r.windage.toFixed(2), 'écart haut (mrad)': r.upMil.toFixed(3), 'écart droite (mrad)': r.rightMil.toFixed(3), 'vol jeu / solveur (s)': `${r.tof.toFixed(3)} / ${r.tofSol.toFixed(3)}`, resultat: good ? 'concorde' : 'ÉCART' });
    }
  }
}
console.table(rows);
const worst = Math.max(...rows.filter((r) => r['écart haut (mrad)']).map((r) => Math.hypot(+r['écart haut (mrad)'], +r['écart droite (mrad)'])));
console.log(`niveau ${LEVEL} : ${rows.filter((r) => r.resultat === 'concorde').length} tirs sur ${rows.length} à moins de 0,05 mrad du point visé (pire écart ${worst.toFixed(3)} mrad)`);
if (errors.length) { console.log('ERREURS\n' + [...new Set(errors)].join('\n')); ok = false; }
await browser.close();
process.exit(ok ? 0 : 1);
