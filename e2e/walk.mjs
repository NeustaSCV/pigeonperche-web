// Parcours à pied automatisé : le déplacement est réellement joué, image par image (1/60 s), en tenant les touches
// dans `game.input` et en avançant la simulation par `game.step`. Vérifie :
//  - du point de départ à chacun des cinq postes en suivant le cap de `player.guideTo`, puis retour par un trajet réaliste ;
//  - sortie et retour dans les brèches est et ouest, debout, accroupi et couché ;
//  - murs : on reste dans l'enceinte ; angles : on ne reste pas coincé, on ne passe jamais sous le sol ;
//  - palier et escalier de la tour ; aucune image hors de la zone jouable.
// Une ligne par cas (OK / COINCÉ avec position et cause), code de sortie 1 si un cas échoue.
// Usage : node e2e/walk.mjs [--level <id>] [--verbose]
// La partie 1 (du départ à chaque poste par le guide, point de tir exact, retour par data.testWalk) et la partie
// 1 bis (terrain libre : huit caps depuis le départ et chaque poste, arrêt sur une limite lisible) valent pour tout
// niveau ; les parties suivantes éprouvent la géométrie de la ruine du niveau standard et ne sont jouées que sur lui.
import { chromium } from 'playwright';
import { LEVEL, LQ, assertLevel } from './levellib.mjs';
const VERBOSE = process.argv.includes('--verbose');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
await page.goto((process.env.HR_URL || 'http://127.0.0.1:5173/') + '?dr=0&q=low&play&test&' + LQ);
await page.waitForFunction(() => window.hr && window.hr.ready, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await assertLevel(page);
const LV = await page.evaluate(() => ({ start: window.hr.level.site.start, posts: window.hr.level.posts, back: window.hr.level.testWalk ?? {} }));
await page.evaluate(() => {
  const g = window.hr.game, p = g.player;
  g.cinematic = false;
  g.continueBrief();
  const DT = 1 / 60;
  const H0 = window.hr.level.site.baseY;
  const W = (window.W = { frames: 0, trace: [] });
  /** une image de jeu : cap imposé, touches tenues */
  W.frame = (yaw, keys) => {
    if (g.state !== 'play') { if (g.state === 'brief') g.continueBrief(); g.state = 'play'; }
    if (yaw !== null) p.yaw = yaw;
    g.input.enabled = true;
    g.input.keys.clear();
    for (const k of keys) g.input.keys.add(k);
    g.step(DT, DT);
    g.input.endFrame();
    g.input.keys.clear();
    W.frames++;
  };
  W.pos = () => `(${p.pos.x.toFixed(2)}, ${p.pos.z.toFixed(2)}, y ${(p.pos.y - H0).toFixed(2)})`;
  /** position illégale ? */
  W.illegal = () => {
    if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) return 'position invalide';
    if (!p.isAllowed(p.pos.x, p.pos.z)) return 'hors de la zone jouable';
    if (p.pos.y < g.terrain.heightAt(p.pos.x, p.pos.z) - 0.1) return 'sous le sol';
    return '';
  };
  /** pourquoi n'avance-t-on plus ? */
  W.cause = (yaw) => {
    const sp = 0.05, x = p.pos.x + Math.sin(yaw) * sp, z = p.pos.z - Math.cos(yaw) * sp;
    const q = { x, z };
    const h = p.stance === 'prone' ? 0.5 : p.stance === 'crouch' ? 1.1 : 1.75;
    g.col.resolve(q, p.stance === 'prone' ? 0.42 : 0.3, p.pos.y, h);
    const out = [];
    if (Math.hypot(q.x - x, q.z - z) > 0.01) out.push('collision (mur ou obstacle)');
    if (!p.isAllowed(q.x, q.z)) out.push('limite de la zone jouable');
    const surf = p.surface;
    const gr = p.groundAt(q.x, q.z, p.pos.y);
    p.surface = surf;
    if (gr - p.pos.y >= 0.6) out.push(`marche trop haute (${(gr - p.pos.y).toFixed(2)} m)`);
    return out.join(' + ') || 'aucun obstacle détecté (vitesse nulle ?)';
  };
  W.stance = (s) => {
    p.setStance(s);
    for (let i = 0; i < 90; i++) W.frame(null, []);
  };
  /**
   * Marche vers un point (to) ou en suivant le guide d'un poste (guide) jusqu'à nearestPost() === guide.
   * Renvoie { ok, t, why }.
   */
  W.go = (o) => {
    const tol = o.tol ?? 0.45, maxT = o.maxT ?? 90;
    const keys = ['KeyW', ...(o.run ? ['ShiftLeft'] : [])];
    const out = { x: 0, z: 0, dist: 0, bearing: 0, hint: '' };
    let t = 0, ax = p.pos.x, az = p.pos.z, at = 0, yaw = p.yaw, hints = [];
    while (t < maxT) {
      if (o.guide) {
        if (p.nearestPost() === o.guide) return { ok: true, t, hints };
        p.guideTo(o.guide, out);
        yaw = out.bearing;
        if (out.hint && hints[hints.length - 1] !== out.hint) hints.push(out.hint);
      } else {
        const dx = o.to[0] - p.pos.x, dz = o.to[1] - p.pos.z;
        if (Math.hypot(dx, dz) < tol) return { ok: true, t, hints };
        yaw = Math.atan2(dx, -dz);
      }
      W.frame(yaw, keys);
      t += DT;
      const bad = W.illegal();
      if (bad) return { ok: false, t, why: `${bad} en ${W.pos()}` };
      // coincé : moins de 25 cm de déplacement net en 3 s
      if (t - at > 3) {
        if (Math.hypot(p.pos.x - ax, p.pos.z - az) < 0.25) return { ok: false, t, why: `COINCÉ en ${W.pos()} : ${W.cause(yaw)}` };
        ax = p.pos.x; az = p.pos.z; at = t;
      }
    }
    return { ok: false, t, why: `trop long (${maxT} s), arrêté en ${W.pos()}` };
  };
  /** Suite de points de passage. */
  W.path = (pts, o = {}) => {
    let t = 0;
    for (const to of pts) {
      const r = W.go({ ...o, to });
      t += r.t;
      if (!r.ok) return { ok: false, t, why: `vers (${to[0]}, ${to[1]}) : ${r.why}` };
    }
    return { ok: true, t };
  };
  /** Pousse dans une direction pendant `sec` secondes ; renvoie la première position illégale rencontrée. */
  W.push = (toward, sec, keys = ['KeyW']) => {
    for (let i = 0; i < sec * 60; i++) {
      const yaw = Math.atan2(toward[0] - p.pos.x, -(toward[1] - p.pos.z));
      W.frame(yaw, keys);
      const bad = W.illegal();
      if (bad) return `${bad} en ${W.pos()}`;
    }
    return '';
  };
  W.tp = (x, z, stance = 'stand', yOff = 0) => { p.teleport(x, z, 0, stance, yOff); for (let i = 0; i < 20; i++) W.frame(null, []); };
});

const START = [LV.start.x, LV.start.z];
// trajets de retour réalistes, du poste au point de départ (data.testWalk du niveau ; sans trajet déclaré : pas de retour joué)
const BACK = Object.fromEntries(Object.entries(LV.back).map(([k, pts]) => [k, [...pts, START]]));
const rows = [];
let fail = 0;
const add = (name, r, extra = '') => {
  if (!r.ok) fail++;
  const line = `${r.ok ? 'OK    ' : 'ÉCHEC '} ${name}${r.ok ? (r.t !== undefined ? ` · ${r.t.toFixed(1)} s` : '') + (extra ? ' · ' + extra : '') : ' · ' + r.why}`;
  rows.push(line);
  console.log(line);
};
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- 1. départ → poste (cap du guide) → départ
for (const key of Object.keys(LV.posts)) {
  await ev(([s]) => window.W.tp(s[0], s[1]), [START]);
  const r = await ev((key) => window.W.go({ guide: key, maxT: 150 }), key);
  add(`départ → poste ${key} en suivant le guide`, r, r.hints?.length ? 'étapes : ' + r.hints.join(', ') : 'direct');
  if (r.ok) {
    const st = await ev((key) => { const g = window.hr.game; return { post: g.player.nearestPost(), pos: window.W.pos() }; }, key);
    if (VERBOSE) console.log('        arrivé en', st.pos);
    // le poste lui-même doit être atteignable (point exact du briefing)
    const r1 = await ev((key) => { const q = window.hr.level.posts[key]; return window.W.go({ to: [q.x, q.z], tol: 0.5, maxT: 30 }); }, key);
    add(`poste ${key} : point de tir exact atteint, « en position »`, r1.ok ? { ok: (await ev(() => window.hr.game.player.nearestPost())) === key, t: r1.t, why: 'nearestPost() ne reconnaît pas le poste en ' + (await ev(() => window.W.pos())) } : r1);
  }
  if (!BACK[key]) continue;
  const b = await ev(([pts]) => window.W.path(pts, { maxT: 90 }), [BACK[key]]);
  add(`poste ${key} → départ (trajet de retour)`, b);
}

// ---- 1 bis. terrain libre : du départ et de chaque poste, droit devant dans huit directions, en courant, 40 s.
// On doit s'arrêter sur une limite lisible — obstacle des collisions (mur, clôture, rocher), ou rupture de pente
// (le rebord) — jamais en terrain plat ; ne jamais passer sous le sol ni dévaler la pente ; et pouvoir revenir.
{
  const origins = [['départ', START[0], START[1], 0], ...Object.entries(LV.posts).map(([k, p]) => [`poste ${k}`, p.x, p.z, p.y ?? 0])];
  for (const [name, ox, oz, oy] of origins) {
    const r = await ev(([ox, oz, oy]) => {
      const W = window.W, g = window.hr.game, p = g.player, t = g.terrain, H0 = window.hr.level.site.baseY;
      const slope = (x, z) => Math.hypot(t.heightAt(x + 0.6, z) - t.heightAt(x - 0.6, z), t.heightAt(x, z + 0.6) - t.heightAt(x, z - 0.6)) / 1.2;
      const out = [], ends = [];
      for (let d = 0; d < 8; d++) {
        const yaw = (d * Math.PI) / 4;
        W.tp(ox, oz, 'stand', oy);
        const far = [ox + Math.sin(yaw) * 400, oz - Math.cos(yaw) * 400];
        const bad = W.push(far, 40, ['KeyW', 'ShiftLeft']);
        if (bad) { out.push(`cap ${d * 45}° : ${bad}`); continue; }
        const y = p.pos.y - H0, r = Math.hypot(p.pos.x, p.pos.z);
        if (y < -5) out.push(`cap ${d * 45}° : descendu à ${y.toFixed(1)} m sous le site en ${W.pos()}`);
        // pourquoi s'est-on arrêté ? (un pas de plus dans l'axe)
        const cause = W.cause(Math.atan2(far[0] - p.pos.x, -(far[1] - p.pos.z)));
        const nx = p.pos.x + Math.sin(yaw) * 0.6, nz = p.pos.z - Math.cos(yaw) * 0.6;
        let near = false;
        for (let q = 0; q < 8 && !near; q++) for (const rr of [0, 0.8, 1.6]) if (slope(nx + Math.cos(q * 0.785) * rr, nz + Math.sin(q * 0.785) * rr) > 0.42) { near = true; break; }
        const kind = cause.includes('collision') ? 'obstacle' : cause.includes('marche trop haute') ? 'ressaut' : cause.includes('limite') ? (near || p.limitAt?.(nx, nz) === 'pente' ? 'rebord' : 'INVISIBLE') : 'glisse';
        if (kind === 'INVISIBLE') out.push(`cap ${d * 45}° : arrêté en terrain plat en ${W.pos()} (${cause})`);
        ends.push(`${d * 45}° ${kind} à ${r.toFixed(0)} m`);
      }
      return { ok: out.length === 0, why: out.join(' ; '), ends };
    }, [ox, oz, oy]);
    add(`terrain libre depuis ${name} : huit caps, arrêt sur obstacle ou rebord, pas de chute`, r, r.ends?.join(', '));
  }
}

if (LEVEL === 'standard') {

// ---- 2. brèches : sortir puis revenir, dans les trois postures, vers trois points du bord extérieur
const BREACH = {
  est: { inside: [24.3, -5.6], post: [27.0, -7.0], outs: [[28.35, -7.45], [28.2, -6.1], [27.9, -8.2]] },
  ouest: { inside: [-25.4, -6.2], post: [-28.3, -6.4], outs: [[-29.7, -6.75], [-29.5, -5.6], [-29.4, -7.5]] },
};
for (const [k, B] of Object.entries(BREACH)) {
  for (const stance of ['stand', 'crouch', 'prone']) {
    await ev(([B, stance]) => { window.W.tp(B.inside[0], B.inside[1]); window.W.stance(stance); }, [B, stance]);
    const r = await ev(([B]) => {
      const W = window.W, p = window.hr.game.player;
      let t = 0, low = 0;
      for (const out of B.outs) {
        const a = W.path([B.post, out], { maxT: 40, tol: 0.35 });
        if (!a.ok) return { ok: false, why: 'sortie ' + a.why };
        // au bout : on pousse encore vers l'extérieur, on doit rester dans la zone
        const bad = W.push([out[0] * 2 - B.post[0], out[1] * 2 - B.post[1]], 3);
        if (bad) return { ok: false, why: 'en poussant vers l’extérieur : ' + bad };
        low = Math.min(low, p.pos.y - 260);
        const b = W.path([B.post, B.inside], { maxT: 40, tol: 0.35 });
        if (!b.ok) return { ok: false, why: 'retour ' + b.why };
        t += a.t + b.t;
      }
      return { ok: true, t, low };
    }, [B]);
    add(`brèche ${k}, ${stance === 'stand' ? 'debout' : stance === 'crouch' ? 'accroupi' : 'couché'} : trois sorties, trois retours dans la cour`, r, r.ok ? `point le plus bas ${r.low.toFixed(2)} m` : '');
  }
}

// ---- 3. droit dans les murs : on reste dans l'enceinte
const WALLS = [
  ['mur nord', [0, -12], [0, -40]], ['mur est', [20, 4], [60, 6]], ['mur sud', [-4, 16], [-4, 60]], ['mur ouest', [-20, 2], [-60, 2]],
  ['mur nord-est', [19.6, -17.5], [40, -30]], ['mur sud-est', [16, 14], [40, 40]], ['mur sud-ouest', [-16, 14], [-45, 40]],
  ['cloison intérieure (face est)', [-2, -12], [-30, -12]], ['arcade (face sud)', [-11.2, 13], [-11.2, -20]], ['tour, mur sud', [20.5, -2], [20.5, -30]],
  ['flanc de l’escalier', [9, -9], [30, -9]], ['puits', [-1.5, 8], [-1.5, -10]],
];
for (const [name, from, toward] of WALLS) {
  for (const run of [false, true]) {
    const r = await ev(([from, toward, run]) => {
      const W = window.W, p = window.hr.game.player;
      W.tp(from[0], from[1]);
      const bad = W.push(toward, 6, run ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
      if (bad) return { ok: false, why: bad };
      // puis on doit pouvoir repartir
      const b = W.go({ to: from, maxT: 20 });
      if (!b.ok) return { ok: false, why: 'ne revient pas : ' + b.why };
      return { ok: true, t: 6 + b.t };
    }, [from, toward, run]);
    add(`droit dans : ${name}${run ? ' (en courant)' : ''}`, r);
  }
}
// le puits et le mur de la tour se contournent ; les murs d'enceinte ne se traversent pas
const through = await ev(() => { const W = window.W, p = window.hr.game.player; W.tp(0, -12); W.push([0, -40], 6); return { z: p.pos.z, ok: p.pos.z > -19.5 }; });
add('mur nord : pas de traversée', { ok: through.ok, why: `z = ${through.z.toFixed(2)}` }, `arrêté à z = ${through.z.toFixed(2)}`);

// hors zone (téléportation) : on ne reste pas coincé dehors, et une fois rentré on ne ressort plus
{
  const r = await ev(() => {
    const W = window.W, p = window.hr.game.player, out = [];
    for (const [x, z, to] of [[30.6, -8.2, [24.3, -5.6]], [-31.5, -6.8, [-25.4, -6.2]], [-29.5, -36.5, [-25, -32]]]) {
      p.teleport(x, z, 0, 'stand');
      const dx = to[0] - x, dz = to[1] - z;
      let inside = false;
      for (let i = 0; i < 600 && Math.hypot(to[0] - p.pos.x, to[1] - p.pos.z) > 0.5; i++) {
        W.frame(Math.atan2(to[0] - p.pos.x, -(to[1] - p.pos.z)), ['KeyW']);
        const ok = p.isAllowed(p.pos.x, p.pos.z);
        if (inside && !ok) { out.push(`ressorti en ${W.pos()}`); break; }
        inside = inside || ok;
      }
      if (Math.hypot(to[0] - p.pos.x, to[1] - p.pos.z) > 0.5) out.push(`parti de (${x}, ${z}), coincé en ${W.pos()}`);
      void dx; void dz;
    }
    return { ok: out.length === 0, why: out.join(' ; ') };
  });
  add('hors zone (téléporté à l’extérieur) : on rentre, on ne ressort plus', r);
}

// rochers : ceux qui dépassent 0,45 m ne se traversent pas, et aucun ne barre un passage
{
  const r = await ev(() => {
    const W = window.W, g = window.hr.game, p = g.player, out = [];
    const segs = g.veg.rockSegs;
    const dist = (s, x, z) => { const dx = s.bx - s.ax, dz = s.bz - s.az; const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.r; };
    // passages : lignes échantillonnées tous les 25 cm, 0,55 m de dégagement de part et d'autre de l'axe
    const lines = { 'brèche est': [[24.3, -5.6], [27, -7], [28.4, -7.4]], 'brèche ouest': [[-25.4, -6.2], [-28.3, -6.4], [-29.7, -6.7]], 'pied de l’escalier': [[10, -1.5], [12.47, -3.6], [12.47, -5]],
      'couloir du rebord d’éboulis': [[-17, -15], [-20.3, -18.4], [-22.5, -24], [-25, -32]], 'couloir tour / mur est': [[24.4, -15], [24.4, -3]], 'couloir tour / mur nord': [[13, -17.6], [21.5, -17.6]],
      'créneau nord': [[2.6, -15], [2.6, -18.7]], 'arcade': [[-9.5, 6], [-9.5, 12]], 'porte de la tour': [[17.95, -3.5], [17.95, -9]], 'porte de la cloison': [[-4.5, -10.1], [-9.5, -10.1]] };
    for (const [name, pts] of Object.entries(lines)) for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25);
      for (let k = 0; k <= n; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
        const hit = segs.find((s) => s.y1 > p.groundAt(x, z, 265) + 0.35 && dist(s, x, z) < 0.55);
        if (hit) { out.push(`${name} : rocher à collision en (${hit.ax.toFixed(1)}, ${hit.az.toFixed(1)})`); k = n; }
      }
    }
    // le plus gros rocher de la cour : on bute dessus, puis on le contourne
    const yard = segs.filter((s) => p.isAllowed(s.ax, s.az) && Math.hypot(s.ax, s.az) < 24).sort((a, b) => b.r - a.r)[0];
    if (yard) {
      const cx = (yard.ax + yard.bx) / 2, cz = (yard.az + yard.bz) / 2;
      W.tp(cx + 2.5, cz + 0.3);
      const bad = W.push([cx, cz], 4);
      if (bad) out.push(bad);
      if (dist(yard, p.pos.x, p.pos.z) < 0.25) out.push(`rocher traversé en ${W.pos()}`);
      const b = W.path([[cx + 0.4, cz + yard.r + 1.6], [cx - 2.5, cz]], { maxT: 20 });
      if (!b.ok) out.push('contournement du rocher : ' + b.why);
    } else out.push('aucun rocher à collision dans la cour');
    return { ok: out.length === 0, why: out.join(' ; '), n: segs.filter((s) => p.isAllowed(s.ax, s.az)).length };
  });
  add('rochers : passages dégagés, gros rocher de la cour infranchissable et contournable', r, r.ok ? `${r.n} rochers à collision dans la zone jouable` : '');
}

// ---- 4. le long des murs dans les angles : ni coincé, ni sous le sol
const CORNERS = [
  ['cloison intérieure / mur nord, côté est', [-3.5, -15], [-7.2, -19.6], [-2, -11]],
  ['cloison intérieure / mur nord, côté ouest', [-10.5, -15], [-6.8, -19.6], [-12, -11]],
  ['angle nord-est de l’enceinte', [17.5, -17.6], [20.5, -20.3], [12, -17.6]],
  ['couloir tour / mur est', [24.4, -4], [24.6, -20], [24.4, -3.6]],
  ['angle est (28, −4)', [25, -1], [28.3, -4.2], [22, 2]],
  ['angle sud-est', [22.5, 10.5], [26.4, 13.4], [18, 8]],
  ['angle sud', [8, 22], [10.2, 26.4], [6, 18]],
  ['angle sud-ouest', [-11.5, 21.5], [-14.4, 25.4], [-8, 18]],
  ['angle ouest', [-24.5, 6], [-28.4, 8.3], [-20, 4]],
  ['angle nord-ouest effondré', [-20, -13], [-23.4, -17.2], [-16, -12]],
  ['tour : angle intérieur nord-est (rez-de-chaussée)', [18, -9], [21.9, -14.9], [17.95, -4.6]],
  ['tour : angle extérieur sud-ouest, pied de l’escalier', [10.4, -3.6], [13.6, -6.6], [9, 0]],
  ['arcade : extrémité ouest', [-17.5, 11], [-16.2, 9], [-19, 6]],
  ['râtelier / mur sud', [1, 18], [5.2, 20.6], [0, 16]],
];
for (const [name, from, corner, exit] of CORNERS) {
  for (const stance of ['stand', 'prone']) {
    const r = await ev(([from, corner, exit, stance]) => {
      const W = window.W;
      W.tp(from[0], from[1]);
      if (stance !== 'stand') W.stance(stance);
      let bad = W.push(corner, stance === 'prone' ? 14 : 6);
      // on insiste en biais des deux côtés, puis en reculant
      for (const d of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (!bad) bad = W.push([corner[0] + d[0], corner[1] + d[1]], 1.5, ['KeyW', 'KeyD']);
      if (!bad) bad = W.push(corner, 1.5, ['KeyW', 'KeyA']);
      if (bad) return { ok: false, why: bad };
      const b = W.go({ to: exit, maxT: 60 });
      if (!b.ok) return { ok: false, why: 'ne ressort pas : ' + b.why };
      return { ok: true, t: b.t };
    }, [from, corner, exit, stance]);
    add(`angle : ${name}, ${stance === 'stand' ? 'debout' : 'couché'}`, r);
  }
}

// ---- 5. tour : palier, volée de marches, bord de l'étage
{
  const r = await ev(() => {
    const W = window.W, p = window.hr.game.player;
    W.tp(12.47, -3.6);
    const up = W.path([[12.47, -13.4]], { maxT: 30, tol: 0.3 });
    if (!up.ok) return { ok: false, why: 'montée : ' + up.why };
    if (p.pos.y - 260 < 4.2) return { ok: false, why: 'pas arrivé en haut : ' + W.pos() };
    // au bout du palier, vers le nord : on ne tombe pas
    const bad = W.push([12.5, -30], 4) || W.push([11.9, -30], 2) || W.push([13.6, -30], 2);
    if (bad) return { ok: false, why: bad };
    if (p.pos.y - 260 < 4.2 || p.pos.z < -14.7) return { ok: false, why: 'tombé du palier vers le nord : ' + W.pos() };
    return { ok: true, t: up.t };
  });
  add('escalier : montée, puis poussée vers le nord au bout du palier (pas de chute)', r);
  const r2 = await ev(() => {
    const W = window.W, p = window.hr.game.player;
    // sous la volée : depuis le flanc ouest, du pied au palier, debout et couché
    for (const stance of ['stand', 'prone']) for (const z of [-7.5, -9.5, -11.5, -13.6]) {
      W.tp(10.6, z); if (stance !== 'stand') W.stance(stance);
      const bad = W.push([14, z], stance === 'prone' ? 5 : 3);
      if (bad) return { ok: false, why: bad };
      if (p.pos.x > 11.75 && p.pos.y - 260 < 0.3) return { ok: false, why: `passé sous la volée (${stance}) : ${W.pos()}` };
    }
    // par le nord du palier
    W.tp(12.5, -17); const bad = W.push([12.5, -10], 4);
    if (bad) return { ok: false, why: bad };
    if (p.pos.z > -14.9 && p.pos.y - 260 < 3) return { ok: false, why: 'passé sous le palier par le nord : ' + W.pos() };
    return { ok: true };
  });
  add('escalier : impossible de passer sous la volée ou sous le palier', r2);
  const r3 = await ev(() => {
    const W = window.W, p = window.hr.game.player;
    W.tp(12.47, -3.6);
    const up = W.path([[12.47, -13.4]], { maxT: 30, tol: 0.3, run: true });
    if (!up.ok) return { ok: false, why: 'montée en courant : ' + up.why };
    const dn = W.path([[12.47, -12.2], [12.47, -3.6]], { maxT: 30, run: true });
    if (!dn.ok) return { ok: false, why: 'descente en courant : ' + dn.why };
    if (p.pos.y - 260 > 0.3) return { ok: false, why: 'pas redescendu : ' + W.pos() };
    // chute par le flanc ouest de l'escalier puis du bord est de l'étage : on doit pouvoir repartir
    W.tp(12.47, -3.6); W.path([[12.47, -10]], { maxT: 30 });
    let bad = W.push([0, -10], 3);
    if (bad) return { ok: false, why: 'saut du flanc de l’escalier : ' + bad };
    const a = W.go({ to: [8, -6], maxT: 20 });
    if (!a.ok) return { ok: false, why: 'après le saut du flanc : ' + a.why };
    W.tp(20, -11.6, 'stand', 4.3);
    bad = W.push([40, -11.6], 4);
    if (bad) return { ok: false, why: 'bord est de l’étage : ' + bad };
    const b = W.path([[24.4, -4], [18, 2]], { maxT: 40 });
    if (!b.ok) return { ok: false, why: 'après le bord est de l’étage : ' + b.why };
    return { ok: true, t: up.t + dn.t };
  });
  add('escalier en courant (montée, descente), chutes du flanc et du bord est de l’étage : on repart', r3);
}

// ---- 6. détection des postes : au sol, la hauteur du relief ne compte pas
{
  const r = await ev(() => {
    const W = window.W, p = window.hr.game.player, out = [];
    for (const [k, x, z, y] of [['eboulis', -23.6, -30.2, 0], ['est', 26.0, -6.2, 0], ['ouest', -27.2, -6.0, 0], ['nord', 3.4, -17.6, 0], ['tour', 21.0, -11.0, 4.3]]) {
      W.tp(x, z, 'stand', y);
      if (p.nearestPost() !== k) out.push(`${k} non reconnu en ${W.pos()}`);
    }
    // sous l'étage de la tour, on n'est pas « en position »
    W.tp(21.0, -11.0);
    if (p.nearestPost() === 'tour') out.push('poste de la tour reconnu depuis le rez-de-chaussée');
    return { ok: out.length === 0, why: out.join(' ; ') };
  });
  add('nearestPost : postes reconnus à 1,5 m (rebord d’éboulis compris), tour seulement à l’étage', r);
}

// ---- 7. cadence des pas
{
  const r = await ev(() => {
    const W = window.W, g = window.hr.game, p = g.player, res = {};
    const orig = g.audio.footstep.bind(g.audio);
    let n = 0;
    g.audio.footstep = (...a) => { n++; return orig(...a); };
    for (const [name, stance, run] of [['marche', 'stand', false], ['course', 'stand', true], ['accroupi', 'crouch', false]]) {
      W.tp(-4, 20); if (stance !== 'stand') W.stance(stance);
      W.push([-4, -60], 1.5, run ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
      n = 0; const x0 = p.pos.x, z0 = p.pos.z, ph0 = p.pose.phase;
      W.push([-4, -60], 4, run ? ['KeyW', 'ShiftLeft'] : ['KeyW']);
      const d = Math.hypot(p.pos.x - x0, p.pos.z - z0);
      res[name] = { pas: n, parSeconde: +(n / 4).toFixed(2), foulee: +(d / n).toFixed(2), poses: +((p.pose.phase - ph0) / Math.PI).toFixed(1) };
    }
    g.audio.footstep = orig;
    return res;
  });
  for (const [k, v] of Object.entries(r)) {
    const good = Math.abs(v.pas - v.poses) <= 1.5;
    add(`pas (${k}) : ${v.parSeconde} pas/s, ${v.foulee} m par pas, ${v.poses} poses de pied animées pour ${v.pas} sons`, { ok: good, why: 'sons de pas désynchronisés de la foulée animée' });
  }
}
} else console.log(`(niveau ${LEVEL} : contrôles de la ruine du niveau standard non joués)`);

const frames = await ev(() => window.W.frames);
console.log(`\nniveau ${LEVEL} : ${rows.length - fail} cas réussis sur ${rows.length} (${frames} images simulées, ${(frames / 60).toFixed(0)} s de jeu)`);
if (errors.length) { console.log('ERREURS\n' + [...new Set(errors)].join('\n')); fail++; }
await browser.close();
process.exit(fail ? 1 : 0);
