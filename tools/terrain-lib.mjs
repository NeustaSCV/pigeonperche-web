// Boîte à outils du relief, commune à tous les niveaux : grille, polylignes, érosion, sites aplanis, route,
// couloirs de visée, carte de matières. Le générateur d'un niveau (src/levels/<id>/terrain.gen.mjs) compose ces étapes.
// L'ordre des opérations de chaque étape est figé : le relief du niveau standard doit rester identique au bit près.
import { makeNoise2D, fbm2, ridged2, mulberry32, smoothstep as ss, clamp, lerp } from '../src/core/noise.ts';
import { lotOf, lotDistance, lotCorners } from '../src/levels/building-lots.ts';

export { makeNoise2D, fbm2, ridged2, mulberry32, ss, clamp, lerp };

/**
 * Grille carrée de `res` × `res` altitudes couvrant `size` mètres, centrée sur l'origine (le site de tir).
 * H : Float32Array ; wx(i) : abscisse (ou cote z) de la colonne i ; idx(i, j) : indice de la cellule.
 */
export function createGrid(size, res) {
  const N = res, S = size;
  const T = {
    N, S, CELL: S / (N - 1), H: new Float32Array(N * N),
    wx: (i) => (i / (N - 1) - 0.5) * S,
    idx: (i, j) => j * N + i,
    /** altitude interpolée (bilinéaire) en un point du monde */
    sampleH(x, z) {
      const fx = clamp((x / S + 0.5) * (N - 1), 0, N - 1.001), fz = clamp((z / S + 0.5) * (N - 1), 0, N - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const H = T.H;
      return lerp(lerp(H[j * N + i], H[j * N + i + 1], u), lerp(H[(j + 1) * N + i], H[(j + 1) * N + i + 1], u), v);
    },
  };
  return T;
}

// ---------- polylignes ----------
/** Spline de Catmull-Rom : `per` points par tronçon, toutes dimensions confondues (x, z, altitude…). */
export function catmull(pts, per) {
  const out = [];
  const D = pts[0].length;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const o = [];
      for (let d = 0; d < D; d++)
        o.push(0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3));
      out.push(o);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/** Distance à une polyligne ; écrit [distance, indice flottant, côté] dans `out`. */
export function polyDist(px, pz, pts, out) {
  let best = 1e18, bi = 0, bs = 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = ((px - ax) * dx + (pz - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) {
      best = d2;
      bi = i + t;
      bs = dx * (pz - az) - dz * (px - ax) > 0 ? 1 : -1; // +1 = côté sud (z plus grand) pour une polyligne ouest→est
    }
  }
  out[0] = Math.sqrt(best);
  out[1] = bi;
  out[2] = bs;
}
/** Valeur de la dimension `d` d'une polyligne à l'indice flottant `fi`. */
export const polyVal = (pts, fi, d) => {
  const i = Math.min(pts.length - 2, Math.floor(fi));
  return lerp(pts[i][d], pts[i + 1][d], fi - i);
};

/** Maximum adouci (rayon k). */
export const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k)) - k * 0.5 * (Math.abs(a - b) < 1e9 ? 0 : 0);

// ---------- érosion hydraulique par gouttes ----------
/**
 * Érode T.H. `weight(x, z)` : part de l'érosion conservée en chaque point (0 = relief analytique intact ; à garder
 * nul sur le site de tir, dont les lignes de visée sont calculées).
 */
export function erode(T, { drops = 260000, seed = 2024, weight }) {
  const { N, CELL, H, idx, wx } = T;
  const rnd = mulberry32(seed);
  const G = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) G[i] = H[i] / CELL; // unités de cellule
  const radius = 3;
  const brush = [];
  let wsum = 0;
  for (let y = -radius; y <= radius; y++)
    for (let x = -radius; x <= radius; x++) {
      const d = Math.hypot(x, y);
      if (d < radius) {
        brush.push([x, y, 1 - d / radius]);
        wsum += 1 - d / radius;
      }
    }
  for (const b of brush) b[2] /= wsum;
  const inertia = 0.06, capK = 5, minCap = 0.01, depK = 0.3, eroK = 0.28, evap = 0.012, grav = 4;
  for (let n = 0; n < drops; n++) {
    let px = rnd() * (N - 1), py = rnd() * (N - 1);
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let life = 0; life < 48; life++) {
      const ix = Math.floor(px), iy = Math.floor(py);
      if (ix < 1 || iy < 1 || ix >= N - 2 || iy >= N - 2) break;
      const u = px - ix, v = py - iy;
      const i00 = idx(ix, iy);
      const h00 = G[i00], h10 = G[i00 + 1], h01 = G[i00 + N], h11 = G[i00 + N + 1];
      const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
      const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      const hOld = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;
      px += dx;
      py += dy;
      const jx = Math.floor(px), jy = Math.floor(py);
      if (jx < 1 || jy < 1 || jx >= N - 2 || jy >= N - 2) break;
      const u2 = px - jx, v2 = py - jy;
      const j00 = idx(jx, jy);
      const hNew = G[j00] * (1 - u2) * (1 - v2) + G[j00 + 1] * u2 * (1 - v2) + G[j00 + N] * (1 - u2) * v2 + G[j00 + N + 1] * u2 * v2;
      const dh = hNew - hOld;
      const cap = Math.max(-dh * speed * water * capK, minCap);
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depK;
        sed -= dep;
        G[i00] += dep * (1 - u) * (1 - v);
        G[i00 + 1] += dep * u * (1 - v);
        G[i00 + N] += dep * (1 - u) * v;
        G[i00 + N + 1] += dep * u * v;
      } else {
        const amt = Math.min((cap - sed) * eroK, -dh);
        for (const [bx, by, bw] of brush) {
          const k = idx(ix + bx, iy + by);
          if (k < 0 || k >= N * N) continue;
          G[k] -= amt * bw;
        }
        sed += amt;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * grav));
      water *= 1 - evap;
    }
  }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      H[k] = lerp(H[k], G[k] * CELL, weight(wx(i), wx(j)));
    }
}

// ---------- lac, rivière ----------
/** Creuse un lac : `lakeQ[k]` est une distance normalisée au rivage (< 1 dans l'eau, cuvette adoucie jusqu'à 2). */
export function carveLake(T, lakeQ, level) {
  const { N, H } = T;
  for (let k = 0; k < N * N; k++) {
    const q = lakeQ[k];
    if (q < 2.0) {
      const tgt = q < 1 ? level - 0.4 - 15 * Math.pow(1 - q, 0.75) : level - 0.4 + (q - 1) * 26;
      H[k] = q < 1 ? Math.min(H[k], tgt) : lerp(Math.min(tgt, H[k]), H[k], ss(1.0, 2.0, q));
    }
  }
}
/** Creuse le lit d'une rivière : distance `riverD[k]` et altitude du lit `riverBed[k]` par cellule ; `skip(k)` l'interdit (lac). */
export function carveRiver(T, riverD, riverBed, width, skip = () => false) {
  const { N, H } = T;
  const half = width / 2;
  for (let k = 0; k < N * N; k++) {
    const d = riverD[k];
    if (d < half + 34 && !skip(k)) {
      const bed = riverBed[k];
      const prof = d < half ? bed - 1.3 * (1 - (d / half) ** 2) - 0.2 : bed - 0.2 + (d - half) * 0.42;
      H[k] = lerp(Math.min(H[k], prof + 4 * ss(half, half + 34, d)), H[k], ss(half + 6, half + 34, d));
      if (d < half + 6) H[k] = Math.min(H[k], prof);
    }
  }
}

// ---------- sites aplanis ----------
/**
 * Aplanit chaque site { x, z, h, r0, r1 } (plat jusqu'à r0, raccord jusqu'à r1 ; r1 = 0 : site ignoré). Altitude visée :
 * `target(name, site)` si elle renvoie un nombre, sinon `site.h`, sinon le relief en place. Renvoie les altitudes retenues.
 */
export function flattenSites(T, sites, { noise, target = () => undefined }) {
  const { N, S, H, wx, idx } = T;
  const siteHeights = {};
  for (const [name, s] of Object.entries(sites)) {
    if (!s.r1) continue;
    const tgt = target(name, s) ?? (s.h || T.sampleH(s.x, s.z));
    siteHeights[name] = tgt;
    const i0 = Math.floor(((s.x - s.r1) / S + 0.5) * (N - 1)) - 1, i1 = Math.ceil(((s.x + s.r1) / S + 0.5) * (N - 1)) + 1;
    const j0 = Math.floor(((s.z - s.r1) / S + 0.5) * (N - 1)) - 1, j1 = Math.ceil(((s.z + s.r1) / S + 0.5) * (N - 1)) + 1;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = wx(i), z = wx(j);
        const d = Math.hypot(x - s.x, z - s.z) * (1 + 0.12 * noise(x / 40, z / 40));
        const w = 1 - ss(s.r0, s.r1, d);
        if (w > 0) H[idx(i, j)] = lerp(H[idx(i, j)], tgt, w);
      }
  }
  return siteHeights;
}

// ---------- bâtiments ----------
/** Lot d'un bâtiment de la banque (largeur, profondeur, sol fourni, creusement) et distance d'un point à ce lot. */
export { lotOf, lotDistance, lotCorners };

/**
 * Terrasse l'emprise de chaque bâtiment `{ id, carte?, x, z, yaw, groundY? }` (les `BuildingSpot` du niveau), d'après
 * la taille de lot du catalogue (src/levels/building-lots.ts) : aucun modèle n'est chargé.
 *
 * Sous le lot et sur une bande de `flat` mètres autour, le relief est mis à l'altitude du bâtiment ; il rejoint le
 * relief en place sur `blend` mètres de plus. La bande plate n'est pas un luxe : loin du site, le maillage du terrain
 * a des mailles de 12 à 20 m et l'interpolation de la carte dépasse un peu aux ruptures de pente — sans elle, une
 * maille dépasserait du sol du bâtiment. Sur un versant, compter (lot + 2·flat) × pente de déblai et de remblai :
 * choisir un replat, ou un lot petit.
 *
 * Altitude retenue : `spot.groundY` s'il est donné, sinon la moyenne du relief en place sous le lot.
 * Un modèle qui fournit son sol et creuse dessous (`own`, `dug` > 0 : moulin, château d'eau…) reçoit en plus une
 * fosse sous son lot, en retrait de `inset` mètres des bords, profonde de `dug` + 0,4 m : ses bassins restent visibles.
 *
 * `keep(k)` (facultatif) protège ce qui est déjà creusé : 0 laisse la cellule k intacte, 1 la terrasse, entre les deux
 * un raccord. Indispensable près d'une rivière ou d'une route, que la bande plate comblerait ou couperait :
 *   keep: (k) => ss(RIVER_WIDTH / 2 + 2, RIVER_WIDTH / 2 + 12, riverD[k]) * ss(ROAD_WIDTH / 2 + 2, ROAD_WIDTH / 2 + 12, roadD[k])
 * (le lot lui-même ne doit toucher ni l'une ni l'autre : c'est à la carte de le placer).
 *
 * Renvoie `[{ id, carte, x, z, yaw, groundY }]`, à passer tel quel dans `meta.buildings` : le jeu y lit l'altitude
 * où poser chaque bâtiment. À appeler après la route et les sites, AVANT `carveSightlines` et `paint`.
 */
export function flattenBuildings(T, spots, { flat = 20, blend = 36, inset = 9, keep = null } = {}) {
  const { N, S, H, wx, idx } = T;
  const out = [];
  for (const spot of spots) {
    const lot = lotOf(spot.id, spot.carte);
    if (!lot) throw new Error(`terrassement : bâtiment inconnu « ${spot.id}${spot.carte ? ':' + spot.carte : ''} » (voir src/levels/building-lots.ts)`);
    const hx = lot.l / 2, hz = lot.p / 2;
    const c = Math.cos(spot.yaw), s = Math.sin(spot.yaw);
    let g = spot.groundY;
    if (g === undefined) {
      // moyenne du relief en place sous le lot (pas de 3 m)
      let sum = 0, n = 0;
      for (let lz = -hz; lz <= hz; lz += 3)
        for (let lx = -hx; lx <= hx; lx += 3) { sum += T.sampleH(spot.x + lx * c + lz * s, spot.z - lx * s + lz * c); n++; }
      g = sum / n;
    }
    // au centimètre : c'est la valeur écrite dans meta.json, celle où le jeu posera le bâtiment
    g = Math.round(g * 100) / 100;
    const reach = Math.hypot(hx, hz) + flat + blend;
    const cell = (v) => (v / S + 0.5) * (N - 1);
    const i0 = Math.max(0, Math.floor(cell(spot.x - reach))), i1 = Math.min(N - 1, Math.ceil(cell(spot.x + reach)));
    const j0 = Math.max(0, Math.floor(cell(spot.z - reach))), j1 = Math.min(N - 1, Math.ceil(cell(spot.z + reach)));
    const pit = lot.own && lot.dug > 0 ? lot.dug + 0.4 : 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = wx(i) - spot.x, dz = wx(j) - spot.z;
        const u = Math.abs(dx * c - dz * s) - hx, v = Math.abs(dx * s + dz * c) - hz;
        const d = Math.hypot(Math.max(u, 0), Math.max(v, 0));
        if (d >= flat + blend) continue;
        const k = idx(i, j);
        const w = (1 - ss(flat, flat + blend, d)) * (keep ? keep(k) : 1);
        if (w <= 0) continue;
        H[k] = lerp(H[k], g, w);
        // fosse sous un modèle creusé : nulle au bord du lot, entière à `inset` mètres à l'intérieur
        if (pit > 0 && d === 0) H[k] -= pit * ss(0, inset, Math.min(-u, -v));
      }
    out.push({ id: spot.id, ...(spot.carte ? { carte: spot.carte } : {}), x: spot.x, z: spot.z, yaw: spot.yaw, groundY: g });
  }
  return out;
}

/**
 * Facteur 0..1 à multiplier à la forêt dans `paint` (option `forestExtra`) : 0 dans les lots et à moins de `margin`
 * mètres, 1 au-delà de `margin + fade`. Les arbres du jeu étant semés sur la forêt, aucun ne pousse dans un bâtiment.
 */
export function buildingClearing(spots, margin = 14, fade = 22) {
  return (x, z) => {
    let f = 1;
    for (const spot of spots) {
      const d = lotDistance(spot, x, z);
      if (d < margin + fade) f = Math.min(f, ss(margin, margin + fade, d));
    }
    return f;
  };
}

/**
 * Contrôle : bâtiments qui coupent une ligne de visée. Pour chaque ligne poste → cible et chaque bâtiment, la ligne
 * passe-t-elle au-dessus du lot plus bas que `height(spot)` (hauteur du bâtiment, m ; 40 par défaut) ? Marge latérale
 * `margin`. Renvoie les couples fautifs ; le test en jeu (e2e/matrix.mjs) reste le juge, géométrie réelle comprise.
 */
export function checkBuildingSightlines(T, placed, lines, posts, baseY, { height = () => 40, margin = 6 } = {}) {
  const bad = [];
  for (const L of lines) {
    const P = posts[L.post];
    const ey = (P.ground ?? baseY) + eyeAbove(P);
    const ty = L.abs ? L.y : T.sampleH(L.x, L.z) + L.y;
    const len = Math.hypot(L.x - P.x, L.z - P.z);
    const n = Math.ceil(len / 2);
    for (const b of placed) {
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = P.x + (L.x - P.x) * t, z = P.z + (L.z - P.z) * t;
        if (lotDistance(b, x, z) > margin) continue;
        const y = ey + (ty - ey) * t;
        if (y < b.groundY + height(b)) { bad.push({ post: L.post, x: Math.round(L.x), z: Math.round(L.z), building: b.id, at: Math.round(t * len), clearance: +(y - b.groundY).toFixed(1) }); break; }
      }
    }
  }
  return bad;
}

// ---------- route ----------
/**
 * Pose une route (polyligne déjà lissée, voir catmull) : profil en long adouci, plate-forme nivelée. `bridge`
 * { x, z, deck } impose l'altitude du tablier ; `skip(k)` laisse une cellule intacte (lit de rivière).
 * Complète chaque point de la route par son altitude et renvoie la distance à la route de chaque cellule.
 */
export function carveRoad(T, road, { width, bridge = null, skip = () => false }) {
  const { N, H, wx, idx } = T;
  const roadD = new Float32Array(N * N).fill(1e9);
  const tmp = [0, 0, 0];
  // profil en long lissé
  const rh = road.map((p) => T.sampleH(p[0], p[1]));
  for (let pass = 0; pass < 40; pass++)
    for (let i = 1; i < rh.length - 1; i++) rh[i] = (rh[i - 1] + rh[i] * 2 + rh[i + 1]) / 4;
  for (let i = 0; i < road.length; i++) {
    if (bridge) {
      const db = Math.hypot(road[i][0] - bridge.x, road[i][1] - bridge.z);
      rh[i] = lerp(bridge.deck, rh[i], ss(14, 70, db));
    }
    road[i][2] = rh[i];
  }
  const half = width / 2;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = wx(i), z = wx(j);
      const k = idx(i, j);
      polyDist(x, z, road, tmp);
      const d = tmp[0];
      roadD[k] = d;
      if (d > half + 16 || skip(k)) continue;
      const tgt = polyVal(road, tmp[1], 2);
      H[k] = lerp(tgt, H[k], ss(half + 1.5, half + 16, d));
    }
  return roadD;
}

// ---------- couloirs de visée ----------
/** Hauteur de l'œil au-dessus du sol d'un poste, selon sa posture (accroupi appuyé : 1,0 m ; couché : 0,2 m). */
export const eyeAbove = (post) => (post.y ?? 0) + (post.stance === 'crouch' ? 1.0 : 0.2);

/**
 * Rabote tout relief qui dépasserait une ligne poste → cible, avec marge (large au milieu du parcours, nulle à
 * l'arrivée). `lines` : [{ post, x, z, y, abs? }] ; y = hauteur de la cible au-dessus du sol en place (altitude absolue
 * si abs). `posts` : postes du niveau ; `baseY` : altitude du sol du site (remplacée par post.ground s'il existe).
 * Rien n'est raboté dans les 40 premiers mètres : le plateau du site se règle à la main (CLEAR, SCULPT).
 */
export function carveSightlines(T, lines, posts, baseY, opts = {}) {
  const { N, S, H, wx, idx } = T;
  // `opts.smooth` (passes de lissage, 0 par défaut : rabotage d'origine, arêtes vives) : le sol raboté est adouci
  // sans jamais remonter au-dessus du plafond de chaque couloir — les lignes restent dégagées.
  const smooth = opts.smooth ?? 0;
  const cap = smooth ? new Float32Array(N * N).fill(Infinity) : null;
  const cut = smooth ? new Uint8Array(N * N) : null;
  for (const L of lines) {
    const P = posts[L.post];
    if (!P) throw new Error(`couloir de visée : poste inconnu « ${L.post} »`);
    const ex = P.x, ez = P.z;
    const ey = (P.ground ?? baseY) + eyeAbove(P);
    const ty = L.abs ? L.y : T.sampleH(L.x, L.z) + L.y;
    const dx = L.x - ex, dz = L.z - ez;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const i0 = Math.floor(((Math.min(ex, L.x) - 80) / S + 0.5) * (N - 1)), i1 = Math.ceil(((Math.max(ex, L.x) + 80) / S + 0.5) * (N - 1));
    const j0 = Math.floor(((Math.min(ez, L.z) - 80) / S + 0.5) * (N - 1)), j1 = Math.ceil(((Math.max(ez, L.z) + 80) / S + 0.5) * (N - 1));
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
        const x = wx(i), z = wx(j);
        const t = (x - ex) * ux + (z - ez) * uz;
        if (t < 40 || t > len - 4) continue;
        const lat = Math.abs((x - ex) * uz - (z - ez) * ux);
        const wdt = 14 + t * 0.03;
        if (lat > wdt * 2) continue;
        const los = ey + ((ty - ey) * t) / len;
        // marge : large au milieu du parcours, nulle à l'arrivée
        const margin = Math.min(7, 1 + (len - t) * 0.03) + 1;
        const lim = los - margin + Math.max(0, lat - wdt) * 0.6;
        const k = idx(i, j);
        if (cap && lim < cap[k]) cap[k] = lim;
        if (H[k] > lim) { H[k] = lim; if (cut) cut[k] = 1; }
      }
  }
  if (!smooth) return;
  // zone à lisser : les cellules rabotées et leur voisinage (rayon `opts.reach` cellules, 4 par défaut), en fondu
  const reach = opts.reach ?? 4;
  const w = new Float32Array(N * N);
  for (let j = reach; j < N - reach; j++)
    for (let i = reach; i < N - reach; i++) {
      if (!cut[idx(i, j)]) continue;
      for (let b = -reach; b <= reach; b++)
        for (let a = -reach; a <= reach; a++) {
          const f = 1 - Math.hypot(a, b) / (reach + 1);
          const k = idx(i + a, j + b);
          if (f > w[k]) w[k] = f;
        }
    }
  // `opts.protect(x, z)` → 0 (ne pas toucher : terrasse d'un site, lot d'un bâtiment) à 1 (lissage entier)
  let keep = null;
  if (opts.protect) {
    keep = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = idx(i, j); if (w[k] > 0) keep[k] = opts.protect(wx(i), wx(j)); }
  }
  const tmp = new Float32Array(N * N);
  for (let it = 0; it < smooth; it++) {
    tmp.set(H);
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const k = idx(i, j);
        if (w[k] <= 0) continue;
        const m = (tmp[k - 1] + tmp[k + 1] + tmp[k - N] + tmp[k + N]) * 0.125 + (tmp[k - N - 1] + tmp[k - N + 1] + tmp[k + N - 1] + tmp[k + N + 1]) * 0.0625 + tmp[k] * 0.25;
        H[k] = Math.min(cap[k], tmp[k] + (m - tmp[k]) * Math.min(1, w[k] * 1.5) * (keep ? keep[k] : 1));
      }
  }
}

// ---------- carte de matières ----------
/**
 * Carte RGBA8 : R roche, V éboulis / galets, B forêt (les arbres du jeu sont semés dessus), A terre battue.
 *  - rockNoise, forestNoise : bruits 2D ; rockAlt : altitude où la roche nue apparaît ;
 *  - forestLow, treeLine : altitude où la forêt s'épaissit, puis limite des arbres ;
 *  - clearRadius : [r0, r1] autour du site de tir, sans forêt (le site est planté à la main) ;
 *  - riverD + riverWidth, lakeQ, roadD + roadWidth : optionnels (distances par cellule) ;
 *  - sites : dégagés de forêt, cœur en terre battue (`siteCore(name)` : intensité, `skipSite(name)` : site ignoré) ;
 *  - forestExtra(x, z) : facteur supplémentaire sur la forêt (couloir dégagé, clairière…).
 */
export function paint(T, o) {
  const { N, CELL, H, wx, idx } = T;
  const {
    rockNoise, forestNoise, rockAlt = [600, 820], forestLow = [40, 160], treeLine = [420, 560], clearRadius = [44, 70],
    riverD = null, riverWidth = 0, lakeQ = null, roadD = null, roadWidth = 0,
    sites = {}, siteCore = () => 0.5, skipSite = () => false, forestExtra = null,
  } = o;
  const splat = new Uint8Array(N * N * 4);
  const rock = new Float32Array(N * N);
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = idx(i, j);
      const sx = (H[k + 1] - H[k - 1]) / (2 * CELL), sz = (H[k + N] - H[k - N]) / (2 * CELL);
      const slope = Math.hypot(sx, sz);
      const x = wx(i), z = wx(j);
      const nz = fbm2(rockNoise, x / 70, z / 70, 3);
      rock[k] = ss(0.9, 1.3, slope + nz * 0.16) + ss(rockAlt[0], rockAlt[1], H[k] + nz * 80) * 0.6;
    }
  const rockBlur = new Float32Array(N * N);
  {
    const R = 3;
    const t1 = new Float32Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = R; i < N - R; i++) {
        let s = 0;
        for (let d = -R; d <= R; d++) s += rock[idx(i + d, j)];
        t1[idx(i, j)] = s / (2 * R + 1);
      }
    for (let j = R; j < N - R; j++)
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let d = -R; d <= R; d++) s += t1[idx(i, j + d)];
        rockBlur[idx(i, j)] = s / (2 * R + 1);
      }
  }
  const siteList = Object.entries(sites).filter(([name, s]) => s.r1 && !skipSite(name));
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = idx(i, j);
      const x = wx(i), z = wx(j);
      const r = Math.hypot(x, z);
      const h = H[k];
      const sx = (H[k + 1] - H[k - 1]) / (2 * CELL), sz = (H[k + N] - H[k - N]) / (2 * CELL);
      const slope = Math.hypot(sx, sz);
      const R = clamp(rock[k], 0, 1);
      const scree = clamp((rockBlur[k] - R * 0.6) * 2.2, 0, 1) * ss(0.25, 0.5, slope) * (1 - R);
      // forêt : taches de bruit, pente modérée, sous la limite des arbres, hors sites
      const fn = fbm2(forestNoise, x / 230 + 4, z / 230, 4) * 0.5 + 0.5;
      let forest = ss(0.42, 0.6, fn + ss(forestLow[0], forestLow[1], h) * 0.22 - ss(treeLine[0], treeLine[1], h) * 0.5);
      forest *= 1 - ss(0.75, 1.0, slope);
      forest *= 1 - R;
      if (riverD) forest *= ss(riverWidth / 2 + 4, riverWidth / 2 + 30, riverD[k]);
      if (lakeQ) forest *= ss(1.02, 1.12, lakeQ[k]);
      if (roadD) forest *= ss(7, 22, roadD[k]);
      forest *= ss(clearRadius[0], clearRadius[1], r); // le site de tir est planté à la main
      let dirt = roadD ? 1 - ss(roadWidth / 2 - 0.5, roadWidth / 2 + 3.5, roadD[k]) : 0;
      for (const [name, s] of siteList) {
        const d = Math.hypot(x - s.x, z - s.z);
        forest *= ss(s.r0 * 1.05, s.r1 * 1.15, d);
        dirt = Math.max(dirt, siteCore(name) * (1 - ss(s.r0 * 0.5, s.r0 * 1.1, d)) * (0.6 + 0.4 * fn));
      }
      if (forestExtra) forest *= forestExtra(x, z);
      // berges : galets
      const bank = riverD ? 1 - ss(riverWidth / 2 - 1, riverWidth / 2 + 7, riverD[k]) : 0;
      const shore = lakeQ && lakeQ[k] < 1.08 ? 1 : 0;
      splat[k * 4] = Math.round(255 * R);
      splat[k * 4 + 1] = Math.round(255 * clamp(Math.max(scree, bank * 0.9, shore * 0.8), 0, 1));
      splat[k * 4 + 2] = Math.round(255 * clamp(forest, 0, 1));
      splat[k * 4 + 3] = Math.round(255 * clamp(dirt, 0, 1));
    }
  return splat;
}

/** Arrondit une polyligne pour meta.json : x, z au décimètre, altitude au centimètre. */
export const roundLine = (pts) => pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 100) / 100]);

/** Vérifie chaque ligne de visée sur le relief fini : renvoie celles que le terrain coupe encore (marge en mètres). */
export function checkSightlines(T, lines, posts, baseY, margin = 0.3) {
  const bad = [];
  for (const L of lines) {
    const P = posts[L.post];
    const ey = (P.ground ?? baseY) + eyeAbove(P);
    const ty = L.abs ? L.y : T.sampleH(L.x, L.z) + L.y;
    const len = Math.hypot(L.x - P.x, L.z - P.z);
    const n = Math.ceil(len / 2);
    for (let i = 1; i < n; i++) {
      const t = (i / n) * len;
      if (t < 40 || t > len - 4) continue;
      const x = P.x + ((L.x - P.x) * t) / len, z = P.z + ((L.z - P.z) * t) / len;
      const over = T.sampleH(x, z) - (ey + ((ty - ey) * t) / len) + margin;
      if (over > 0) { bad.push({ post: L.post, x: Math.round(L.x), z: Math.round(L.z), at: Math.round(t), over: +over.toFixed(2) }); break; }
    }
  }
  return bad;
}
