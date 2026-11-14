// Constructeur de géométrie des carabines : tours de révolution, profils extrudés chanfreinés ou arrondis (avec
// lumières), tubes balayés. Porté de native/game/src/weapons/rifle_mesh.gd. Tout part dans une seule géométrie ;
// la matière est codée par sommet pour le matériau unique des armes : `color` teinte (linéaire),
// `aMat` = (métal, rugosité, nature, masque d'arête). Unités : mètres. Profils 2D : (x = z de l'arme, y).
import { BufferAttribute, BufferGeometry, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three';

export interface P2 { x: number; y: number }
/** matière : [r, g, b (sRGB), métal, rugosité, nature] */
export type Matter = readonly [number, number, number, number, number, number];
export type LatheMod = (z: number, j: number, n: number) => number;

export const p2 = (x: number, y: number): P2 => ({ x, y });
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const sub2 = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
const len2 = (a: P2): number => Math.hypot(a.x, a.y);
const norm2 = (a: P2): P2 => { const l = len2(a); return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };
const d2sq = (a: P2, b: P2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Repère dont l'axe +Z local suit `dir`, origine `o`. */
export function along(dir: Vector3, o: Vector3): Matrix4 {
  const z = dir.clone().normalize();
  const up = Math.abs(z.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0);
  const x = up.cross(z).normalize();
  const y = z.clone().cross(x);
  return new Matrix4().makeBasis(x, y, z).setPosition(o);
}
export const translate = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);

/** Contour aux coins arrondis à partir de triplets [z, y, rayon, ...]. */
export function rpoly(a: number[], seg = 5): P2[] {
  const n = a.length / 3;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const c = p2(a[i * 3], a[i * 3 + 1]);
    const r = a[i * 3 + 2];
    const ip = (i - 1 + n) % n, inx = (i + 1) % n;
    let d1 = sub2(p2(a[ip * 3], a[ip * 3 + 1]), c), d2 = sub2(p2(a[inx * 3], a[inx * 3 + 1]), c);
    const l1 = len2(d1), l2 = len2(d2);
    if (r <= 0 || l1 < 1e-7 || l2 < 1e-7) { out.push(c); continue; }
    d1 = p2(d1.x / l1, d1.y / l1); d2 = p2(d2.x / l2, d2.y / l2);
    const phi = Math.acos(Math.min(1, Math.max(-1, d1.x * d2.x + d1.y * d2.y)));
    if (phi > Math.PI - 0.05 || phi < 0.05) { out.push(c); continue; }
    const t = Math.min(r / Math.tan(phi * 0.5), 0.48 * Math.min(l1, l2));
    const rr = t * Math.tan(phi * 0.5);
    const bis = norm2(p2(d1.x + d2.x, d1.y + d2.y));
    const k = rr / Math.sin(phi * 0.5);
    const ctr = p2(c.x + bis.x * k, c.y + bis.y * k);
    const s0 = p2(c.x + d1.x * t, c.y + d1.y * t), s1 = p2(c.x + d2.x * t, c.y + d2.y * t);
    const ang0 = Math.atan2(s0.y - ctr.y, s0.x - ctr.x), ang1 = Math.atan2(s1.y - ctr.y, s1.x - ctr.x);
    let da = ang1 - ang0;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    const ns = Math.max(1, Math.ceil((seg * Math.abs(da)) / (Math.PI * 0.5)));
    for (let q = 0; q <= ns; q++) {
      const ang = ang0 + (da * q) / ns;
      out.push(p2(ctr.x + Math.cos(ang) * rr, ctr.y + Math.sin(ang) * rr));
    }
  }
  return out;
}

/** Bande d'épaisseur `th` suivant une ligne brisée (z, y) : pontets, lames. */
export function ribbon(path: P2[], th: number): P2[] {
  const n = path.length;
  const l: P2[] = [], r: P2[] = [];
  for (let i = 0; i < n; i++) {
    let d: P2;
    if (i === 0) d = norm2(sub2(path[1], path[0]));
    else if (i === n - 1) d = norm2(sub2(path[n - 1], path[n - 2]));
    else { const a = norm2(sub2(path[i], path[i - 1])), b = norm2(sub2(path[i + 1], path[i])); d = norm2(p2(a.x + b.x, a.y + b.y)); }
    const nx = -d.y * th * 0.5, ny = d.x * th * 0.5;
    l.push(p2(path[i].x + nx, path[i].y + ny));
    r.push(p2(path[i].x - nx, path[i].y - ny));
  }
  r.reverse();
  return l.concat(r);
}

/** Profil d'arc de cercle pour le tour : centre (zc, rOff), rayon r, de l'angle a0 à a1. */
export function arc(zc: number, r: number, a0: number, a1: number, seg = 8, rOff = 0): P2[] {
  const o: P2[] = [];
  for (let k = 0; k <= seg; k++) {
    const a = lerp(a0, a1, k / seg);
    o.push(p2(zc + Math.cos(a) * r, rOff + Math.sin(a) * r));
  }
  return o;
}

function clean(p: P2[]): P2[] {
  const o: P2[] = [];
  for (const v of p) if (o.length === 0 || d2sq(o[o.length - 1], v) > 1e-12) o.push(v);
  if (o.length > 1 && d2sq(o[0], o[o.length - 1]) < 1e-12) o.pop();
  return o;
}
function area(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s * 0.5;
}

export class RifleMesh {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private mt: number[] = [];
  xf = new Matrix4();
  /** qualité : 1 = complet, < 1 = allégé (moins de côtés, chanfreins simples, pas de moletage) */
  q = 1;
  private stack: Matrix4[] = [];
  private c: [number, number, number] = [0.01, 0.01, 0.01];
  private metal = 0.8;
  private rough = 0.4;
  private kind = 0;
  private ta = new Vector3(); private tb = new Vector3(); private tc = new Vector3();
  private e1 = new Vector3(); private e2 = new Vector3(); private ns = new Vector3();
  private na = new Vector3(); private nb = new Vector3(); private nc = new Vector3();

  mat(m: Matter): void {
    this.c = [Math.pow(m[0], 2.2), Math.pow(m[1], 2.2), Math.pow(m[2], 2.2)];
    this.metal = m[3]; this.rough = m[4]; this.kind = m[5];
  }
  push(t: Matrix4): void {
    this.stack.push(this.xf);
    this.xf = this.xf.clone().multiply(t);
  }
  pop(): void {
    this.xf = this.stack.pop()!;
  }
  get triCount(): number {
    return this.pos.length / 9;
  }
  private v(p: Vector3, n: Vector3, e: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(this.c[0], this.c[1], this.c[2]);
    this.mt.push(this.metal, this.rough, this.kind, e);
  }
  tri(a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, ea = 0, eb = 0, ec = 0): void {
    const A = this.ta.copy(a).applyMatrix4(this.xf), B = this.tb.copy(b).applyMatrix4(this.xf), C = this.tc.copy(c).applyMatrix4(this.xf);
    const fn = this.e1.subVectors(B, A).cross(this.e2.subVectors(C, A));
    if (fn.lengthSq() < 1e-18) return;
    const NA = this.na.copy(na).transformDirection(this.xf), NB = this.nb.copy(nb).transformDirection(this.xf), NC = this.nc.copy(nc).transformDirection(this.xf);
    // Three.js : face avant = sens trigonométrique
    if (fn.dot(this.ns.copy(NA).add(NB).add(NC)) >= 0) { this.v(A, NA, ea); this.v(B, NB, eb); this.v(C, NC, ec); }
    else { this.v(A, NA, ea); this.v(C, NC, ec); this.v(B, NB, eb); }
  }
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, na: Vector3, nb: Vector3, nc: Vector3, nd: Vector3, ea = 0, eb = 0, ec = 0, ed = 0): void {
    this.tri(a, b, c, na, nb, nc, ea, eb, ec);
    this.tri(a, c, d, na, nc, nd, ea, ec, ed);
  }

  // ------------------------------------------------------------------ tour de révolution
  /**
   * Tour d'axe +Z local. `prof` : points (z, rayon), de l'arrière vers l'avant pour une surface extérieure.
   * `mod` (z, j, côtés) → variation de rayon (cannelures, moletage). `flat` : facettes vives autour de l'axe.
   * `a0`..`a1` : secteur (profil fermé → joues).
   */
  lathe(prof: P2[], sides = 24, mod: LatheMod | null = null, flat = false, a0 = 0, a1 = TAU, phase = 0): void {
    const m = prof.length;
    if (m < 2) return;
    let n = sides;
    if (this.q < 1 && !flat) {
      n = Math.max(8, Math.round(sides * this.q));
      mod = null;
    }
    const wrap = a1 - a0 > TAU - 0.001;
    let cols = n;
    if (!wrap) cols = Math.max(2, Math.round((n * (a1 - a0)) / TAU)) + 1;
    const sharp0: boolean[] = [];
    for (let i = 0; i < m; i++) {
      let s = true;
      if (i > 0 && i < m - 1) {
        const d1 = sub2(prof[i], prof[i - 1]), d2 = sub2(prof[i + 1], prof[i]);
        if (len2(d1) > 1e-7 && len2(d2) > 1e-7) s = Math.abs(Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y)) > 0.45;
      }
      sharp0.push(s);
    }
    const pts: P2[] = [], shp: boolean[] = [], edg: number[] = [];
    const full = this.q >= 1;
    for (let i = 0; i < m; i++) {
      pts.push(prof[i]); shp.push(sharp0[i]); edg.push(sharp0[i] && prof[i].y > 0.0005 && full ? 1 : 0);
      if (i < m - 1 && full) {
        const d = sub2(prof[i + 1], prof[i]);
        const l = len2(d);
        if (l > 0.005) {
          d.x /= l; d.y /= l;
          if (sharp0[i] && prof[i].y > 0.0005) { pts.push(p2(prof[i].x + d.x * 0.0012, prof[i].y + d.y * 0.0012)); shp.push(false); edg.push(0); }
          if (sharp0[i + 1] && prof[i + 1].y > 0.0005) { pts.push(p2(prof[i + 1].x - d.x * 0.0012, prof[i + 1].y - d.y * 0.0012)); shp.push(false); edg.push(0); }
        }
      }
    }
    const rn = pts.length;
    const grid: Vector3[][] = [];
    for (let a = 0; a < rn; a++) {
      const row: Vector3[] = [];
      for (let j = 0; j < cols; j++) {
        const ang = phase + a0 + ((a1 - a0) * j) / (wrap ? cols : cols - 1);
        let r = pts[a].y;
        if (mod && r > 0.0005) r += mod(pts[a].x, j, n);
        row.push(v3(Math.cos(ang) * r, Math.sin(ang) * r, pts[a].x));
      }
      grid.push(row);
    }
    const span = a1 - a0, aa = phase + a0;
    const ln = (a: number, dir: number, j: number): Vector3 => {
      let jm = j - 1, jp = j + 1;
      if (wrap) { jm = (j - 1 + cols) % cols; jp = (j + 1) % cols; } else { jm = Math.max(0, jm); jp = Math.min(cols - 1, jp); }
      const tt = grid[a][jp].clone().sub(grid[a][jm]);
      if (tt.lengthSq() < 1e-16) {
        const ang = aa + (span * j) / (wrap ? cols : cols - 1);
        tt.set(-Math.sin(ang), Math.cos(ang), 0);
      }
      let tp: Vector3;
      if (shp[a]) tp = dir > 0 ? grid[a + 1][j].clone().sub(grid[a][j]) : grid[a][j].clone().sub(grid[a - 1][j]);
      else tp = grid[Math.min(a + 1, rn - 1)][j].clone().sub(grid[Math.max(a - 1, 0)][j]);
      const nn = tt.cross(tp);
      if (nn.lengthSq() < 1e-24) return v3(0, 0, 1);
      return nn.normalize();
    };
    for (let a = 0; a < rn - 1; a++) {
      const b = a + 1;
      if (pts[a].y < 1e-6 && pts[b].y < 1e-6) continue;
      const jn = wrap ? cols : cols - 1;
      for (let j = 0; j < jn; j++) {
        const j2 = (j + 1) % cols;
        const pa = grid[a][j], pb = grid[a][j2], pc = grid[b][j2], pd = grid[b][j];
        if (flat) {
          let tt = pb.clone().sub(pa);
          if (tt.lengthSq() < 1e-16) tt = pc.clone().sub(pd);
          let fn = tt.clone().cross(pd.clone().sub(pa));
          if (fn.lengthSq() < 1e-20) fn = tt.clone().cross(pc.clone().sub(pb));
          fn.normalize();
          this.quad(pa, pb, pc, pd, fn, fn, fn, fn, edg[a], edg[a], edg[b], edg[b]);
        } else this.quad(pa, pb, pc, pd, ln(a, 1, j), ln(a, 1, j2), ln(b, -1, j2), ln(b, -1, j), edg[a], edg[a], edg[b], edg[b]);
      }
    }
    // joues d'un secteur ouvert
    if (!wrap && m > 3 && d2sq(prof[0], prof[m - 1]) < 1e-12) {
      const poly = prof.slice(0, m - 1);
      const idx = ShapeUtils.triangulateShape(poly.map((p) => new Vector2(p.x, p.y)), []);
      for (let side = 0; side < 2; side++) {
        const ang = phase + (side === 0 ? a0 : a1);
        const sg = side === 0 ? -1 : 1;
        const tn = v3(-Math.sin(ang) * sg, Math.cos(ang) * sg, 0);
        for (const t of idx) {
          const v = t.map((k) => v3(Math.cos(ang) * poly[k].y, Math.sin(ang) * poly[k].y, poly[k].x));
          this.tri(v[0], v[1], v[2], tn, tn, tn);
        }
      }
    }
  }

  // ------------------------------------------------------------------ profil extrudé
  /**
   * Extrude un contour (z, y) le long de X, centré en `x0`, largeur `width`. `bevel` : chanfrein (steps = 1) ou
   * arrondi (steps > 1) des arêtes latérales. `holes` : lumières traversantes. `hw` → demi-largeur locale.
   */
  extrude(outline: P2[], width: number, bevel = 0, steps = 1, holes: P2[][] = [], x0 = 0, hw: ((p: P2) => number) | null = null): void {
    const loops: P2[][] = [];
    const o = clean(outline);
    if (o.length < 3) return;
    if (area(o) < 0) o.reverse();
    loops.push(o);
    for (const h of holes) {
      const hh = clean(h);
      if (hh.length < 3) continue;
      if (area(hh) > 0) hh.reverse();
      loops.push(hh);
    }
    if (this.q < 1) {
      steps = 1;
      if (bevel < 0.0012) bevel = 0;
    }
    bevel = Math.min(bevel, width * 0.5 - 0.0001);
    const half = width * 0.5;
    const rd = [0], rx = [bevel], ra = [0];
    if (bevel > 0) {
      for (let k = 1; k <= steps; k++) {
        const t = (k / steps) * Math.PI * 0.5;
        rd.push(bevel * (1 - Math.cos(t))); rx.push(bevel * (1 - Math.sin(t))); ra.push(t);
      }
      if (steps === 1) { ra[0] = Math.PI * 0.25; ra[1] = Math.PI * 0.25; }
    }
    const nr = rd.length;
    const insetLoops: P2[][] = [];
    for (const lp of loops) {
      const n = lp.length;
      const en: P2[] = [];
      for (let i = 0; i < n; i++) { const d = norm2(sub2(lp[(i + 1) % n], lp[i])); en.push(p2(d.y, -d.x)); }
      const vn: (P2 | null)[] = [], mit: P2[] = [];
      for (let i = 0; i < n; i++) {
        const n1 = en[(i - 1 + n) % n], n2 = en[i];
        const dt = n1.x * n2.x + n1.y * n2.y;
        vn.push(dt > 0.8 ? norm2(p2(n1.x + n2.x, n1.y + n2.y)) : null);
        const k = Math.max(0.3, 1 + dt);
        mit.push(p2((n1.x + n2.x) / k, (n1.y + n2.y) / k));
      }
      insetLoops.push(lp.map((p, i) => p2(p.x - mit[i].x * rd[nr - 1], p.y - mit[i].y * rd[nr - 1])));
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const na2 = vn[i] ?? en[i], nb2 = vn[j] ?? en[i];
        const ha = hw ? hw(lp[i]) : half, hb = hw ? hw(lp[j]) : half;
        const na3 = v3(0, na2.y, na2.x), nb3 = v3(0, nb2.y, nb2.x);
        // flanc périphérique
        this.quad(v3(x0 - (ha - rx[0]), lp[i].y, lp[i].x), v3(x0 + (ha - rx[0]), lp[i].y, lp[i].x), v3(x0 + (hb - rx[0]), lp[j].y, lp[j].x), v3(x0 - (hb - rx[0]), lp[j].y, lp[j].x), na3, na3, nb3, nb3);
        // chanfrein ou arrondi, des deux côtés
        for (let k = 0; k < nr - 1; k++) {
          const pa0 = p2(lp[i].x - mit[i].x * rd[k], lp[i].y - mit[i].y * rd[k]), pa1 = p2(lp[i].x - mit[i].x * rd[k + 1], lp[i].y - mit[i].y * rd[k + 1]);
          const pb0 = p2(lp[j].x - mit[j].x * rd[k], lp[j].y - mit[j].y * rd[k]), pb1 = p2(lp[j].x - mit[j].x * rd[k + 1], lp[j].y - mit[j].y * rd[k + 1]);
          const ek0 = steps === 1 ? 1 : Math.sin((Math.PI * k) / steps);
          const ek1 = steps === 1 ? 1 : Math.sin((Math.PI * (k + 1)) / steps);
          const c0 = Math.cos(ra[k]), c1 = Math.cos(ra[k + 1]), s0 = Math.sin(ra[k]), s1 = Math.sin(ra[k + 1]);
          for (const sg of [-1, 1]) {
            const a_0 = v3(x0 + sg * (ha - rx[k]), pa0.y, pa0.x), a_1 = v3(x0 + sg * (ha - rx[k + 1]), pa1.y, pa1.x);
            const b_0 = v3(x0 + sg * (hb - rx[k]), pb0.y, pb0.x), b_1 = v3(x0 + sg * (hb - rx[k + 1]), pb1.y, pb1.x);
            this.quad(a_0, b_0, b_1, a_1,
              v3(sg * s0, na3.y * c0, na3.z * c0), v3(sg * s0, nb3.y * c0, nb3.z * c0), v3(sg * s1, nb3.y * c1, nb3.z * c1), v3(sg * s1, na3.y * c1, na3.z * c1), ek0, ek0, ek1, ek1);
          }
        }
      }
    }
    // joues latérales (découpage en oreilles, lumières comprises)
    const flatPts = insetLoops.flat();
    let idx = ShapeUtils.triangulateShape(insetLoops[0].map((p) => new Vector2(p.x, p.y)), insetLoops.slice(1).map((l) => l.map((p) => new Vector2(p.x, p.y))));
    let src = flatPts;
    if (idx.length === 0 && insetLoops.length === 1) { idx = ShapeUtils.triangulateShape(loops[0].map((p) => new Vector2(p.x, p.y)), []); src = loops[0]; }
    for (const sg of [-1, 1]) {
      for (const t of idx) {
        const v: Vector3[] = [], nn: Vector3[] = [];
        for (const k of t) {
          const q = src[k];
          let hh = half;
          let n3 = v3(sg, 0, 0);
          if (hw) {
            hh = hw(q);
            const gz = (hw(p2(q.x + 0.004, q.y)) - hw(p2(q.x - 0.004, q.y))) / 0.008;
            const gy = (hw(p2(q.x, q.y + 0.004)) - hw(p2(q.x, q.y - 0.004))) / 0.008;
            n3 = v3(sg, -gy, -gz).normalize();
          }
          v.push(v3(x0 + sg * hh, q.y, q.x)); nn.push(n3);
        }
        this.tri(v[0], v[1], v[2], nn[0], nn[1], nn[2]);
      }
    }
  }

  /** Pavé chanfreiné : z0..z1, y0..y1, largeur selon X. */
  block(z0: number, z1: number, y0: number, y1: number, width: number, bevel = 0, x0 = 0, steps = 1): void {
    this.extrude([p2(z0, y0), p2(z1, y0), p2(z1, y1), p2(z0, y1)], width, bevel, steps, [], x0);
  }

  // ------------------------------------------------------------------ tube balayé
  /** Tube de section ronde le long d'une ligne 3D, rayons par point. */
  tube(pts: Vector3[], radii: number[], sides = 10, caps = true): void {
    const n = pts.length;
    if (n < 2) return;
    const ns = this.q >= 1 ? sides : Math.max(5, Math.floor(sides / 2));
    const rings: Vector3[][] = [], norms: Vector3[][] = [];
    const tan0 = pts[1].clone().sub(pts[0]).normalize();
    let u = (Math.abs(tan0.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)).cross(tan0).normalize();
    for (let i = 0; i < n; i++) {
      let tg: Vector3;
      if (i === 0) tg = tan0;
      else if (i === n - 1) tg = pts[n - 1].clone().sub(pts[n - 2]).normalize();
      else tg = pts[i].clone().sub(pts[i - 1]).normalize().add(pts[i + 1].clone().sub(pts[i]).normalize()).normalize();
      u = u.clone().addScaledVector(tg, -u.dot(tg)).normalize();
      const w = tg.clone().cross(u);
      const ring: Vector3[] = [], rnm: Vector3[] = [];
      const r = radii[Math.min(i, radii.length - 1)];
      for (let j = 0; j < ns; j++) {
        const a = (TAU * j) / ns;
        const d = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
        ring.push(pts[i].clone().addScaledVector(d, r)); rnm.push(d);
      }
      rings.push(ring); norms.push(rnm);
    }
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < ns; j++) {
        const j2 = (j + 1) % ns;
        this.quad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j], norms[i][j], norms[i][j2], norms[i + 1][j2], norms[i + 1][j]);
      }
    if (caps)
      for (let e = 0; e < 2; e++) {
        const i = e === 0 ? 0 : n - 1;
        const tg = e === 0 ? pts[0].clone().sub(pts[1]).normalize() : pts[n - 1].clone().sub(pts[n - 2]).normalize();
        for (let j = 0; j < ns; j++) this.tri(pts[i], rings[i][j], rings[i][(j + 1) % ns], tg, tg, tg);
      }
  }

  /** Ajoute la géométrie d'un autre constructeur, décalée. */
  append(o: RifleMesh, dx = 0, dy = 0, dz = 0): void {
    for (let i = 0; i < o.pos.length; i += 3) this.pos.push(o.pos[i] + dx, o.pos[i + 1] + dy, o.pos[i + 2] + dz);
    for (const v of o.nor) this.nor.push(v);
    for (const v of o.col) this.col.push(v);
    for (const v of o.mt) this.mt.push(v);
  }

  commit(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mt), 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
