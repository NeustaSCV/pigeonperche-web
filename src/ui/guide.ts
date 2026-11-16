// « Régler la lunette » : page d'explication ouverte depuis l'accueil et la pause. Cinq chapitres, des schémas
// vectoriels que l'on manipule (distance, tourelles, vent) et des vues de la lunette du jeu. Les chiffres viennent du
// même calcul balistique que le carnet de tir (6,5 Creedmoor, zéro à 100 m) : ce qu'on lit ici se retrouve en jeu.
import './guide.css';
import { GAME_AIR, ballisticTable, type TableRow } from '../ballistics/solver';
import { SIGHT_HEIGHT, weaponById } from '../config/weapons';

const GOLD = '#e7b565', BLUE = '#7fd4f0', INK = '#f2ede3', DIM = 'rgba(242,237,227,0.62)', FAINT = 'rgba(242,237,227,0.28)', RED = '#e0603f';
/** vent de référence des tables, m/s */
const WIND = 5;
const fr = (v: number, d = 0): string => v.toFixed(d).replace('.', ',');
const cm = (m: number): string => (Math.abs(m) >= 1 ? `${fr(m, 2)} m` : `${fr(m * 100)} cm`);
const clicks = (mil: number): string => { const n = Math.round(Math.abs(mil) * 10); return `${n} clic${n > 1 ? 's' : ''}`; };

// ------------------------------------------------------------------ balistique (table du carnet)
let table: TableRow[] | null = null;
const STEP = 25;
function rows(): TableRow[] {
  if (table) return table;
  const def = weaponById('65cm');
  const ranges: number[] = [];
  for (let r = STEP; r <= 900; r += STEP) ranges.push(r);
  return (table = ballisticTable(def, { zero: def.zero, sightHeight: SIGHT_HEIGHT, crosswind: WIND, ranges, air: GAME_AIR }));
}
const at = (range: number): TableRow => rows()[Math.max(0, Math.min(rows().length - 1, Math.round(range / STEP) - 1))];

// ------------------------------------------------------------------ pièces de dessin
/** grossissement des textes des schémas : sur un écran étroit, le schéma est réduit et ses lettres avec */
let FS = 1;
const txt = (x: number, y: number, s: string, o: { fill?: string; size?: number; anchor?: string; weight?: number } = {}): string =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${o.fill ?? DIM}" font-size="${((o.size ?? 12) * FS).toFixed(1)}" text-anchor="${o.anchor ?? 'middle'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${s}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1, dash = ''): string =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;

/** Réticule gradué en mrad, centré en (cx, cy), `k` pixels par mrad, sur ±`span` mrad. */
function reticle(cx: number, cy: number, k: number, span: number): string {
  let s = line(cx - span * k, cy, cx + span * k, cy, INK, 1) + line(cx, cy - span * k, cx, cy + span * k, INK, 1);
  for (let i = -span * 2; i <= span * 2; i++) {
    if (!i) continue;
    const whole = i % 2 === 0, t = whole ? 5 : 2.5, p = (i / 2) * k;
    s += line(cx + p, cy - t, cx + p, cy + t, INK, 1) + line(cx - t, cy + p, cx + t, cy + p, INK, 1);
    if (whole && (i / 2) % 2 === 0) s += txt(cx + p, cy + 18, String(Math.abs(i / 2)), { size: 10 }) + txt(cx - 12, cy + p + 3.5, String(Math.abs(i / 2)), { size: 10 });
  }
  return s;
}
/** Cadre rond d'une lunette. */
const scopeFrame = (cx: number, cy: number, r: number, inner: string, id: string): string =>
  `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="#5d6b58"/><g clip-path="url(#${id})"><rect x="${cx - r}" y="${cy + r * 0.25}" width="${r * 2}" height="${r}" fill="#4d5a44"/>${inner}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0b0c0b" stroke-width="10"/>`;
/** Tambour de tourelle : fenêtre graduée au dixième de mrad, repère fixe au centre. */
function drum(x: number, y: number, w: number, value: number, label: string, fmt: (v: number) => string): string {
  const k = 26, h = 40, id = 'dr' + label.replace(/\W/g, '');
  let s = `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#17191a" stroke="${FAINT}"/><g clip-path="url(#${id})">`;
  const c = x + w / 2;
  for (let i = Math.floor((value - w / k / 2) * 10) - 1; i <= Math.ceil((value + w / k / 2) * 10) + 1; i++) {
    const v = i / 10, px = c + (v - value) * k * 1;
    const whole = i % 10 === 0, half = i % 5 === 0;
    s += line(px, y + h, px, y + h - (whole ? 16 : half ? 11 : 7), whole ? INK : DIM, 1);
    if (whole) s += txt(px, y + 15, fmt(v), { size: 11, fill: INK });
  }
  s += `</g><path d="M${c - 5} ${y - 7}h10l-5 7z" fill="${GOLD}"/>` + txt(x, y - 9, label, { anchor: 'start', size: 11, fill: GOLD });
  return s;
}
const svg = (w: number, h: number, body: string, label: string): string => `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>`;

// ------------------------------------------------------------------ 1. le mrad
function figCone(d: number): string {
  const x0 = 46, x1 = 610, cy = 120, half = 78;
  const X = (r: number): number => x0 + (r / 1000) * (x1 - x0), H = (r: number): number => (half * r) / 1000;
  let s = `<polygon points="${x0},${cy} ${x1},${cy - half} ${x1},${cy + half}" fill="${GOLD}" opacity="0.13"/>` + line(x0, cy, x1, cy - half, GOLD) + line(x0, cy, x1, cy + half, GOLD) + line(x0, cy, x1, cy, FAINT, 1, '3 4');
  for (let r = 100; r <= 1000; r += 100) s += line(X(r), 214, X(r), 220, FAINT) + (r % 200 === 0 ? txt(X(r), 234, `${r} m`, { size: 10.5 }) : '');
  s += line(x0, 214, x1, 214, FAINT) + `<circle cx="${x0}" cy="${cy}" r="5" fill="${GOLD}"/>` + txt(x0, cy + 22, 'Tireur', { size: 11 });
  const x = X(d), h = H(d);
  s += line(x, cy - h, x, cy + h, BLUE, 4) + line(x, cy + h + 4, x, 214, BLUE, 1, '2 3');
  const side = d > 760 ? 'end' : 'start', tx = d > 760 ? x - 12 : x + 12;
  s += txt(tx, cy - h - 20, `1 mrad = ${cm(d / 1000)}`, { anchor: side, fill: INK, size: 14, weight: 500 }) + txt(tx, cy - h - 5, `1 clic (0,1 mrad) = ${fr(d / 100, d < 100 ? 1 : 0)} cm`, { anchor: side, size: 11.5, fill: GOLD });
  s += txt(120, cy - 18, 'angle de 1 mrad', { size: 11, fill: GOLD });
  return svg(650, 244, s, `Cône d'un mrad : ${cm(d / 1000)} à ${d} m`);
}
function figSizes(): string {
  // la même plaque de 45 cm vue de plus en plus loin : elle couvre de moins en moins de mrad
  const ds = [100, 200, 300, 450], k = 26, base = 150;
  let s = '';
  ds.forEach((d, i) => {
    const cx = 85 + i * 160, m = 450 / d, side = m * k;
    s += `<rect x="${cx - side / 2}" y="${base - side}" width="${side}" height="${side}" fill="${BLUE}" opacity="0.85"/>` + line(cx - 62, base, cx + 62, base, FAINT);
    for (let t = -2; t <= 2; t++) s += line(cx + t * k, base, cx + t * k, base + (t ? 5 : 9), DIM);
    s += txt(cx, base + 30, `à ${d} m`, { fill: INK, size: 13, weight: 500 }) + txt(cx, base + 47, `${fr(m, m % 1 ? 1 : 0)} mrad de large`, { size: 11.5 });
  });
  s += txt(325, 18, 'Une plaque de 45 cm, vue à quatre distances (graduations : 1 mrad)', { size: 11.5 });
  return svg(650, 205, s, 'La même plaque couvre moins de mrad quand elle est plus loin');
}

// ------------------------------------------------------------------ 2. lire le réticule
const TARGETS = [{ id: 'plaque', label: 'Plaque 0,45 m', w: 0.45, h: 0.45 }, { id: 'bidon', label: 'Bidon 0,90 m', w: 0.6, h: 0.9 }];
function figRange(d: number, ti: number): string {
  const cx = 190, cy = 190, k = 42, T = TARGETS[ti];
  const w = (T.w / d) * 1000 * k, h = (T.h / d) * 1000 * k, mh = (T.h / d) * 1000;
  // la cible est posée sur le trait horizontal, bord gauche sur le trait vertical : sa hauteur se lit directement
  const inner = `<rect x="${cx}" y="${cy - h}" width="${w}" height="${h}" fill="${BLUE}" opacity="0.9"/>` + reticle(cx, cy, k, 4);
  let s = scopeFrame(cx, cy, 168, inner, 'gcR');
  s += line(cx - 14, cy - h, cx - 34, cy - h, GOLD) + line(cx - 24, cy, cx - 24, cy - h, GOLD, 1.5);
  const x = 392;
  s += txt(x, 96, 'Hauteur réelle', { anchor: 'start', size: 11.5 }) + txt(x, 118, `${fr(T.h, 2)} m`, { anchor: 'start', fill: INK, size: 20 });
  s += txt(x, 158, 'Hauteur lue au réticule', { anchor: 'start', size: 11.5 }) + txt(x, 180, `${fr(mh, 2)} mrad`, { anchor: 'start', fill: GOLD, size: 20 });
  s += line(x, 200, 630, 200, FAINT) + txt(x, 226, `${fr(T.h, 2)} ÷ ${fr(mh, 2)} × 1 000`, { anchor: 'start', size: 13 }) + txt(x, 262, `= ${Math.round(T.h / +mh.toFixed(2) * 1000)} m`, { anchor: 'start', fill: BLUE, size: 26 });
  return svg(650, 380, s, `Réticule : la cible couvre ${fr(mh, 2)} mrad, elle est à ${d} m`);
}

// ------------------------------------------------------------------ 3. élévation
function figElev(d: number, e: number): string {
  const x0 = 60, x1 = 590, los = 150;
  const row = at(d), drop = -row.path, need = row.elevMil;
  // échelle des hauteurs très exagérée (sinon tout serait plat) : la flèche de la cloche occupe la figure
  const peak = (r: number, el: number): number => at(Math.max(STEP, r)).path + (el * r) / 1000;
  let top = 0.2;
  for (let r = STEP; r <= d; r += STEP) top = Math.max(top, peak(r, Math.max(e, need)));
  const ky = Math.min(95 / top, 60 / Math.max(0.3, drop)), X = (r: number): number => x0 + (r / d) * (x1 - x0), Y = (m: number): number => los - m * ky;
  let s = line(x0, los, x1 + 22, los, BLUE, 1.2, '6 5') + txt(x0 + 40, los + 16, 'ligne de visée', { anchor: 'start', size: 11, fill: BLUE });
  // axe du canon : relevé de l'angle de la tourelle (au-dessus de la visée, il pointe plus haut que la cible)
  const bore = Y((e + 1.2) * d / 1000 * 0.55);
  s += line(x0, los + 4, x0 + (x1 - x0) * 0.55, bore, GOLD, 1, '2 4') + txt(x0 + (x1 - x0) * 0.55 + 6, bore + 4, 'axe du canon', { anchor: 'start', size: 11, fill: GOLD });
  let path = `M${x0} ${los + 4}`;
  for (let r = STEP; r <= d; r += STEP) path += ` L${X(r).toFixed(1)} ${Y(peak(r, e)).toFixed(1)}`;
  const off = peak(d, e), hit = Math.abs(off) < 0.225;
  s += `<path d="${path}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  // cible : plaque de 45 cm à l'échelle des hauteurs
  const ph = Math.max(10, 0.45 * ky);
  s += `<rect x="${x1 - 3}" y="${los - ph / 2}" width="6" height="${ph}" fill="${BLUE}"/>` + line(x1, los + ph / 2, x1, 236, FAINT);
  s += `<circle cx="${x1}" cy="${Math.max(14, Math.min(232, Y(off)))}" r="5" fill="${hit ? GOLD : RED}"/>`;
  s += `<path d="M${x0 - 34} ${los + 1}h30v6h-30z" fill="${DIM}"/><rect x="${x0 - 28}" y="${los - 8}" width="18" height="6" fill="${DIM}"/>` + txt(x0 - 18, los + 28, 'Tireur', { size: 11 });
  s += line(x0, 236, x1, 236, FAINT) + txt((x0 + x1) / 2, 252, `${d} m`, { size: 11.5 });
  const verdict = hit ? 'Touché : la cloche retombe sur la cible' : `Impact ${cm(Math.abs(off))} ${off < 0 ? 'trop bas' : 'trop haut'}`;
  s += txt(x1 + 22, 26, verdict, { anchor: 'end', fill: hit ? GOLD : RED, size: 14, weight: 500 });
  s += txt(x0 - 34, 26, `Chute à ${d} m : ${cm(drop)} = ${fr(need, 1)} mrad`, { anchor: 'start', fill: INK, size: 13 });
  s += drum(x0 - 34, 292, 300, e, 'TOURELLE D’ÉLÉVATION', (v) => fr(v, 0)) + txt(x1 + 22, 308, `${fr(e, 1)} mrad`, { anchor: 'end', fill: GOLD, size: 22 }) + txt(x1 + 22, 326, `${clicks(e)} depuis le zéro`, { anchor: 'end', size: 11.5 });
  return svg(650, 346, s, `Trajectoire à ${d} m avec ${fr(e, 1)} mrad d'élévation : ${verdict}`);
}
function dopeTable(): string {
  const r = [100, 200, 300, 400, 500, 600, 700, 800].map(at);
  return `<div class="g-wrap-t"><table class="g-dope"><tr><th>Distance</th>${r.map((x) => `<td>${x.range} m</td>`).join('')}</tr><tr><th>Chute</th>${r.map((x) => `<td>${x.path > -0.005 ? '0' : cm(-x.path)}</td>`).join('')}</tr><tr><th>Élévation</th>${r.map((x) => `<td><b>${fr(Math.max(0, x.elevMil), 1)}</b></td>`).join('')}</tr><tr><th>Vent 5 m/s</th>${r.map((x) => `<td>${fr(Math.abs(x.windMil), 1)}</td>`).join('')}</tr></table></div>`;
}

// ------------------------------------------------------------------ 4. dérive
function figWind(d: number, speed: number, fromLeft: boolean, w: number): string {
  // vue de dessus : le tireur regarde vers la droite de la figure ; sa gauche est en haut
  const x0 = 60, x1 = 590, cy = 128, row = at(d);
  const drift = (row.drift * speed) / WIND * (fromLeft ? 1 : -1), need = -(drift / d) * 1000;
  const lat = (r: number): number => drift * (r / d) ** 2 + (w * r) / 1000;
  const ky = Math.min(110, 80 / Math.max(0.4, Math.abs(drift), Math.abs(drift + (w * d) / 1000))), Y = (m: number): number => cy + m * ky, X = (r: number): number => x0 + (r / d) * (x1 - x0);
  let s = line(x0, cy, x1 + 22, cy, BLUE, 1.2, '6 5') + txt(x0 + 40, cy - 8, 'ligne de visée', { anchor: 'start', size: 11, fill: BLUE });
  if (speed > 0) for (let i = 0; i < 5; i++) {
    const ax = 150 + i * 95, y1 = fromLeft ? 26 : 230, y2 = fromLeft ? 26 + 12 + speed * 3 : 230 - 12 - speed * 3;
    s += line(ax, y1, ax, y2, DIM, 1.4) + `<path d="M${ax - 4} ${y2 + (fromLeft ? -5 : 5)}L${ax} ${y2}L${ax + 4} ${y2 + (fromLeft ? -5 : 5)}" fill="none" stroke="${DIM}" stroke-width="1.4"/>`;
  }
  let path = `M${x0} ${cy}`;
  for (let r = STEP; r <= d; r += STEP) path += ` L${X(r).toFixed(1)} ${Y(lat(r)).toFixed(1)}`;
  const off = lat(d), hit = Math.abs(off) < 0.225;
  s += `<path d="${path}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  const ph = Math.max(10, 0.45 * ky);
  s += `<rect x="${x1 - 3}" y="${cy - ph / 2}" width="6" height="${ph}" fill="${BLUE}"/><circle cx="${x1}" cy="${Math.max(20, Math.min(236, Y(off)))}" r="5" fill="${hit ? GOLD : RED}"/>`;
  s += `<circle cx="${x0 - 14}" cy="${cy}" r="7" fill="${DIM}"/><rect x="${x0 - 10}" y="${cy - 1.5}" width="22" height="3" fill="${DIM}"/>`;
  s += txt(x0 - 34, 20, 'gauche du tireur', { anchor: 'start', size: 10.5 }) + txt(x0 - 34, 244, 'droite du tireur', { anchor: 'start', size: 10.5 });
  const verdict = hit ? 'Touché : le vent ramène la balle sur la cible' : `Impact ${cm(Math.abs(off))} à ${off > 0 ? 'droite' : 'gauche'}`;
  s += txt(x1 + 22, 20, verdict, { anchor: 'end', fill: hit ? GOLD : RED, size: 14, weight: 500 });
  const sideW = (v: number): string => (Math.abs(v) < 0.05 ? '0' : `${v < 0 ? 'G' : 'D'} ${fr(Math.abs(v), 1)}`);
  s += drum(x0 - 34, 292, 300, w, 'TOURELLE DE DÉRIVE', (v) => (v ? `${v < 0 ? 'G' : 'D'}${Math.abs(v)}` : '0')) + txt(x1 + 22, 308, sideW(w), { anchor: 'end', fill: GOLD, size: 22 });
  s += txt(x1 + 22, 326, speed ? `à afficher : ${sideW(need)} (${clicks(need)})` : 'pas de vent : rien à corriger', { anchor: 'end', size: 11.5 });
  return svg(650, 346, s, `Vent de ${speed} m/s à ${d} m, tourelle ${sideW(w)} : ${verdict}`);
}
function figClock(): string {
  // part du vent qui pousse la balle de côté, selon l'angle entre le vent et le tir
  const cx = 150, cy = 118, R = 84;
  let s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${FAINT}"/>` + line(cx, cy + R, cx, cy - R - 12, BLUE, 1.2, '6 5') + `<path d="M${cx - 5} ${cy - R - 6}L${cx} ${cy - R - 16}L${cx + 5} ${cy - R - 6}" fill="none" stroke="${BLUE}" stroke-width="1.4"/>` + txt(cx, cy + R + 20, 'sens du tir', { size: 11, fill: BLUE });
  for (const [deg, pct] of [[0, 0], [30, 50], [45, 70], [60, 87], [90, 100]] as const) {
    const a = (deg * Math.PI) / 180, x = cx + Math.sin(a) * R, y = cy - Math.cos(a) * R;
    s += line(cx + Math.sin(a) * (R + 26), cy - Math.cos(a) * (R + 26), x, y, pct ? GOLD : DIM, 1.2 + pct / 60) + `<circle cx="${x}" cy="${y}" r="3" fill="${pct ? GOLD : DIM}"/>`;
    s += txt(cx + Math.sin(a) * (R + 44), cy - Math.cos(a) * (R + 44) + 4, `${pct} %`, { size: 12, fill: pct ? INK : DIM, anchor: deg < 20 ? 'middle' : 'start' });
  }
  const x = 360;
  [['De face ou de dos', '0 % : presque aucune dérive'], ['À 30° de l’axe du tir', '50 % du vent compte'], ['À 45°', '70 %'], ['Plein travers (90°)', '100 % : la valeur du carnet']].forEach(([a, b], i) => {
    s += txt(x, 62 + i * 40, a, { anchor: 'start', fill: INK, size: 13 }) + txt(x, 79 + i * 40, b, { anchor: 'start', size: 11.5 });
  });
  return svg(650, 236, s, 'Part du vent qui dévie la balle selon son angle');
}

// ------------------------------------------------------------------ 5. corriger après un tir
function figFix(ox: number, oy: number, e: number, w: number): string {
  const cx = 190, cy = 190, k = 42;
  // écart restant de l'impact, mrad (x vers la droite, y vers le haut)
  const x = ox + w, y = oy + e, done = Math.abs(x) < 0.05 && Math.abs(y) < 0.05;
  const side = 0.45 / 300 * 1000 * k;
  const inner = `<rect x="${cx - side / 2}" y="${cy - side / 2}" width="${side}" height="${side}" fill="${BLUE}" opacity="0.9"/>` + reticle(cx, cy, k, 4) + `<circle cx="${cx + x * k}" cy="${cy - y * k}" r="6" fill="${done ? GOLD : RED}" stroke="#0b0c0b" stroke-width="1.5"/>`;
  let s = scopeFrame(cx, cy, 168, inner, 'gcF');
  const X = 392;
  const say = (v: number, neg: string, pos: string): string => (Math.abs(v) < 0.05 ? 'dans l’axe' : `${fr(Math.abs(v), 1)} mrad ${v < 0 ? neg : pos}`);
  s += txt(X, 70, 'Impact lu au réticule', { anchor: 'start', size: 11.5 }) + txt(X, 94, say(y, 'trop bas', 'trop haut'), { anchor: 'start', fill: done ? GOLD : INK, size: 17 }) + txt(X, 118, say(x, 'à gauche', 'à droite'), { anchor: 'start', fill: done ? GOLD : INK, size: 17 });
  s += line(X, 138, 630, 138, FAINT) + txt(X, 162, 'Correction à donner', { anchor: 'start', size: 11.5 });
  if (done) s += txt(X, 190, 'Réglé : le prochain tir', { anchor: 'start', fill: GOLD, size: 16 }) + txt(X, 212, 'part au centre.', { anchor: 'start', fill: GOLD, size: 16 });
  else s += txt(X, 188, Math.abs(y) < 0.05 ? 'Élévation : rien' : `${clicks(y)} vers le ${y < 0 ? 'haut' : 'bas'}`, { anchor: 'start', fill: GOLD, size: 16 }) + txt(X, 212, Math.abs(x) < 0.05 ? 'Dérive : rien' : `${clicks(x)} vers la ${x < 0 ? 'droite' : 'gauche'}`, { anchor: 'start', fill: GOLD, size: 16 });
  s += txt(X, 262, `Élévation ${e >= 0 ? '+' : '−'}${fr(Math.abs(e), 1)}`, { anchor: 'start', size: 12.5 }) + txt(X, 282, `Dérive ${Math.abs(w) < 0.05 ? '0' : (w < 0 ? 'G ' : 'D ') + fr(Math.abs(w), 1)}`, { anchor: 'start', size: 12.5 });
  return svg(650, 380, s, done ? 'Impact ramené au centre' : 'Impact à corriger');
}

// ------------------------------------------------------------------ page
const photo = (name: string, alt: string, cap: string): string => `<figure class="g-photo"><img src="assets/guide/${name}.jpg" alt="${alt}" loading="lazy" /><figcaption>${cap}</figcaption></figure>`;
const range = (id: string, min: number, max: number, step: number, value: number, label: string): string =>
  `<label class="g-ctl"><span>${label}</span><input type="range" data-g="${id}" min="${min}" max="${max}" step="${step}" value="${value}" /><b data-gv="${id}"></b></label>`;
const seg = (id: string, items: [string, string][], sel: string): string => `<div class="g-seg" data-gs="${id}">${items.map(([v, l]) => `<button data-v="${v}"${v === sel ? ' class="sel"' : ''}>${l}</button>`).join('')}</div>`;
const CHAPTERS = ['Le mrad', 'Lire le réticule', 'Élévation', 'Dérive', 'Corriger'];

/** Contenu de la page (sans le cadre de l'écran). `touch` : formulations pour écran tactile. */
export function guideHtml(touch: boolean): string {
  const up = touch ? 'les boutons <b>+</b> et <b>−</b>' : 'les flèches <b>↑</b> et <b>↓</b>';
  const side = touch ? 'les boutons <b>G</b> et <b>D</b>' : 'les flèches <b>←</b> et <b>→</b>';
  return `
  <nav class="g-nav">${CHAPTERS.map((c, i) => `<button data-gn="${i}"><i>${i + 1}</i>${c}</button>`).join('')}</nav>
  <p class="g-lead">Toucher loin tient à deux réglages : l’<b>élévation</b>, qui compense la chute de la balle, et la <b>dérive</b>, qui compense le vent. Les deux se comptent dans la même unité, le mrad. Les schémas ci-dessous se manipulent : déplacez les curseurs.</p>

  <section data-gc="0"><h3><i>1</i>Le mrad est un angle</h3>
    <p>Le mrad (milliradian) ne mesure pas une longueur mais une <b>ouverture</b>. Imaginez un cône très fin qui part de votre œil : plus il va loin, plus il s’élargit. À 100 m, un mrad couvre 10 cm ; à 1 000 m, il couvre 1 m. La règle tient en une ligne : <b>1 mrad = 1 mètre par kilomètre</b>, soit un millième de la distance.</p>
    <div class="g-fig" data-gf="cone"></div>
    ${range('coneD', 50, 1000, 50, 300, 'Distance de la cible')}
    <p>C’est pour cela qu’on règle en mrad et pas en centimètres : la même correction en centimètres ne veut rien dire tant qu’on ne connaît pas la distance, alors qu’un angle reste vrai partout. Une tourelle avance par <b>clics de 0,1 mrad</b> : un clic déplace l’impact de 1 cm à 100 m, de 5 cm à 500 m, de 10 cm à 1 000 m.</p>
    <div class="g-fig" data-gf="sizes"></div>
    <p>Conséquence visible dans la lunette : un objet paraît d’autant plus petit, en mrad, qu’il est loin. C’est ce qui permet d’estimer une distance, au chapitre suivant.</p>
    <div class="g-wrap-t"><table class="g-dope g-mem"><tr><th>Distance</th><td>100 m</td><td>200 m</td><td>300 m</td><td>500 m</td><td>800 m</td><td>1 000 m</td></tr><tr><th>1 mrad</th><td>10 cm</td><td>20 cm</td><td>30 cm</td><td>50 cm</td><td>80 cm</td><td>1 m</td></tr><tr><th>1 clic</th><td>1 cm</td><td>2 cm</td><td>3 cm</td><td>5 cm</td><td>8 cm</td><td>10 cm</td></tr></table></div>
  </section>

  <section data-gc="1"><h3><i>2</i>Lire le réticule</h3>
    <p>Le réticule de la lunette est une règle graduée en mrad : un grand trait tous les mrad, un petit tous les demi-mrad, des chiffres tous les deux. Il sert à deux choses : <b>mesurer</b> (la taille apparente d’une cible, l’écart d’un impact) et <b>viser à côté</b> du centre sans toucher aux tourelles.</p>
    ${photo('reticule', 'La lunette du jeu pointée sur une plaque', 'La lunette du jeu, pointée sur une plaque ronde de 60 cm à 302 m : elle couvre 2 mrad. En bas à droite, les valeurs des deux tourelles.')}
    <p>Pour estimer une distance sans télémètre, il faut connaître la taille réelle de la cible (le briefing la donne). On pose la cible contre les traits, on lit combien de mrad elle couvre, puis :</p>
    <p class="g-formula">distance (m) = taille réelle (m) ÷ taille lue (mrad) × 1 000</p>
    <div class="g-fig" data-gf="range"></div>
    ${seg('rangeT', TARGETS.map((t, i) => [String(i), t.label] as [string, string]), '0')}
    ${range('rangeD', 100, 900, 25, 300, 'Distance réelle')}
    <p>Plus la cible est loin, plus la lecture est délicate : à 800 m, la plaque ne couvre plus qu’un demi-mrad, et une erreur d’un dixième de mrad déplace l’estimation de plus de 100 m. Le télémètre${touch ? '' : ' (touche <b>T</b>)'} reste plus sûr quand le niveau l’autorise.</p>
  </section>

  <section data-gc="2"><h3><i>3</i>La tourelle d’élévation</h3>
    <p>Une balle ne vole pas droit : dès la sortie du canon, elle tombe. Pour atteindre une cible lointaine, le canon doit donc pointer <b>au-dessus</b> d’elle. La balle monte, passe par un sommet, puis redescend sur la cible : c’est la trajectoire en cloche.</p>
    <p>La lunette, elle, regarde en ligne droite. La tourelle d’élévation règle l’angle entre cette ligne de visée et l’axe du canon. Vous continuez à poser le centre du réticule sur la cible ; c’est le canon qui se relève en dessous. À 0, la lunette est réglée pour 100 m (le « zéro »).</p>
    <div class="g-fig" data-gf="elev"></div>
    ${seg('elevD', [['200', '200 m'], ['400', '400 m'], ['600', '600 m'], ['800', '800 m']], '400')}
    ${range('elevE', 0, 9, 0.1, 0, 'Tourelle d’élévation')}
    <p class="g-note">Hauteurs très exagérées : à l’échelle, la cloche serait invisible (2,5 m de chute sur 600 m).</p>
    <p>Dans le jeu, la tourelle se tourne avec ${up} : un clic vaut 0,1 mrad${touch ? ', et les boutons −1 et +1 un mrad entier' : ', et un clic avec <b>Maj droite</b> un mrad entier'}. La valeur à afficher pour chaque distance est dans le <b>carnet de tir</b>${touch ? '' : ' (touche <b>Tab</b>)'}. Voici celle d’une 6,5 Creedmoor :</p>
    ${dopeTable()}
    <p>La chute n’augmente pas régulièrement : elle double largement entre 400 et 600 m, parce que la balle ralentit et met de plus en plus de temps à parcourir chaque centaine de mètres. Une erreur de distance coûte donc beaucoup plus cher de loin que de près.</p>
    ${photo('tourelles', 'Les tourelles affichées sous la lunette', 'En jeu, la même plaque avec 1,3 mrad d’élévation (la valeur du carnet pour 300 m). Le centre du réticule reste sur la cible : c’est le canon qui s’est relevé. Le losange doré du niveau Assisté, qui annonce l’impact, est revenu au centre.')}
  </section>

  <section data-gc="3"><h3><i>4</i>La tourelle de dérive</h3>
    <p>Le vent pousse la balle de côté pendant tout son vol. Plus le vol est long, plus elle a le temps de dériver : la dérive grandit beaucoup plus vite que la distance. La tourelle de dérive décale la visée à gauche ou à droite pour l’annuler.</p>
    <p>La règle : <b>on corrige vers le côté d’où vient le vent</b>. Un vent qui vient de la gauche pousse la balle à droite ; on affiche donc une correction à gauche (G). Dans le jeu, la flèche du vent montre où <b>va</b> le vent : la balle part du côté de la flèche, on corrige du côté opposé.</p>
    <div class="g-fig" data-gf="wind"></div>
    ${seg('windD', [['300', '300 m'], ['600', '600 m'], ['900', '900 m']], '600')}
    ${seg('windS', [['L', 'Vent venant de la gauche'], ['R', 'Vent venant de la droite']], 'L')}
    ${range('windV', 0, 10, 1, 5, 'Force du vent')}
    ${range('windW', -4, 4, 0.1, 0, 'Tourelle de dérive')}
    <p>La tourelle se tourne avec ${side}, par clics de 0,1 mrad. Le carnet donne la correction pour un vent de 5 m/s de plein travers ; il faut l’adapter à la force réelle (un vent deux fois plus faible demande deux fois moins) et à son angle :</p>
    <div class="g-fig" data-gf="clock"></div>
    <p>Le vent change pendant qu’on vise. Les drapeaux plantés près des cibles et la flèche du vent donnent sa direction à l’instant du tir : mieux vaut tirer dans une accalmie que corriger une rafale.</p>
  </section>

  <section data-gc="4"><h3><i>5</i>Corriger après un tir</h3>
    <p>Un tir manqué est une mesure. L’impact soulève de la poussière ou marque la cible : on lit sur le réticule de combien il s’écarte du centre, en mrad, et on reporte cet écart <b>tel quel</b> sur les tourelles, sans aucun calcul de distance. C’est tout l’intérêt d’avoir un réticule et des tourelles dans la même unité.</p>
    <p>Impact trop bas : on monte l’élévation d’autant. Impact à droite : on ramène la dérive à gauche d’autant. Essayez :</p>
    <div class="g-fig" data-gf="fix"></div>
    <div class="g-pad"><button data-gp="e:1" aria-label="Élévation plus 0,1">▲ Haut</button><button data-gp="e:-1" aria-label="Élévation moins 0,1">▼ Bas</button><button data-gp="w:-1" aria-label="Dérive à gauche">◀ Gauche</button><button data-gp="w:1" aria-label="Dérive à droite">▶ Droite</button><button data-gp="new" class="alt">Autre tir</button></div>
    ${photo('impact', 'Un impact à côté de la cible, vu dans la lunette', 'En jeu, tourelles à zéro sur une plaque à 302 m : la balle soulève la poussière sous la plaque, là où le losange doré l’annonçait, environ 1,3 mrad sous le centre. Il faut monter l’élévation d’autant.')}
    <p>Deux façons d’appliquer la correction : tourner les tourelles (le centre du réticule redevient le point d’impact, c’est le plus précis), ou <b>contre-viser</b>, c’est-à-dire décaler la visée de l’écart lu sans toucher aux tourelles (plus rapide, utile pour une cible qui bouge ou un vent qui change). Si les tirs restent groupés ailleurs qu’au centre, c’est le réglage ; s’ils se dispersent, c’est la tenue de l’arme, le souffle ou le vent.</p>
    <p class="g-note">Résumé : 1 mrad = 1 m par kilomètre · 1 clic = 0,1 mrad · élévation contre la chute, dérive contre le vent · l’écart lu au réticule se reporte tel quel.</p>
  </section>`;
}

/** Branche les curseurs et dessine les schémas. À appeler une fois, sur l'élément qui contient `guideHtml`. */
export function initGuide(root: HTMLElement): void {
  const fig = (id: string): HTMLElement => root.querySelector<HTMLElement>(`[data-gf="${id}"]`)!;
  const val = (id: string): number => Number(root.querySelector<HTMLInputElement>(`[data-g="${id}"]`)!.value);
  const show = (id: string, s: string): void => { root.querySelector<HTMLElement>(`[data-gv="${id}"]`)!.textContent = s; };
  const pick: Record<string, string> = { rangeT: '0', elevD: '400', windD: '600', windS: 'L' };
  const fix = { ox: 0.4, oy: -0.6, e: 0, w: 0 };
  const narrow = matchMedia('(max-width: 620px)');
  const draw = (): void => {
    FS = narrow.matches ? 1.22 : 1;
    fig('sizes').innerHTML = figSizes();
    fig('clock').innerHTML = figClock();
    fig('cone').innerHTML = figCone(val('coneD'));
    show('coneD', `${val('coneD')} m`);
    fig('range').innerHTML = figRange(val('rangeD'), Number(pick.rangeT));
    show('rangeD', `${val('rangeD')} m`);
    fig('elev').innerHTML = figElev(Number(pick.elevD), val('elevE'));
    show('elevE', `${fr(val('elevE'), 1)} mrad`);
    const w = val('windW');
    fig('wind').innerHTML = figWind(Number(pick.windD), val('windV'), pick.windS === 'L', w);
    show('windV', `${val('windV')} m/s`);
    show('windW', Math.abs(w) < 0.05 ? '0' : `${w < 0 ? 'G' : 'D'} ${fr(Math.abs(w), 1)}`);
    fig('fix').innerHTML = figFix(fix.ox, fix.oy, fix.e, fix.w);
  };
  draw();
  narrow.addEventListener('change', draw);
  root.addEventListener('input', (e) => { if ((e.target as HTMLElement).dataset.g) draw(); });
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sb = t.closest<HTMLElement>('[data-gs] button');
    if (sb) {
      const box = sb.parentElement!;
      pick[box.dataset.gs!] = sb.dataset.v!;
      box.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b === sb));
      draw();
    }
    const pad = t.closest<HTMLElement>('[data-gp]')?.dataset.gp;
    if (pad === 'new') {
      const r = (): number => Math.round((0.3 + Math.random() * 1.1) * 10) / 10 * (Math.random() < 0.5 ? -1 : 1);
      fix.ox = r(); fix.oy = r(); fix.e = 0; fix.w = 0;
      draw();
    } else if (pad) {
      const [k, n] = pad.split(':');
      if (k === 'e') fix.e = Math.round((fix.e + Number(n) * 0.1) * 10) / 10;
      else fix.w = Math.round((fix.w + Number(n) * 0.1) * 10) / 10;
      draw();
    }
    const nav = t.closest<HTMLElement>('[data-gn]')?.dataset.gn;
    if (nav) root.querySelector(`[data-gc="${nav}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
