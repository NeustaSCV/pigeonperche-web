// Ville nouvelle : les bâtiments. Chaque emprise des données devient des murs et un toit plat ; le dessin des façades
// (travées, baies, balcons) est entièrement dans le shader, d'après un style par bâtiment. La géométrie est découpée
// en pavés (un quart de dalle de côté), chacun avec sa sphère englobante, et la courbure de la carte y est cuite.
// `buildingChunks` ne dessine rien : les tests s'en servent pour le BVH des balles.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, ShaderMaterial, ShapeUtils, Vector2, type Texture } from 'three';
import { hash, segDist, type Batiment, type VilleWorld } from './data';
import { NOISE_GLSL, SUN, uLight } from './shade';

/** pavés par côté de dalle */
export const SUB = 4;

// Styles : 0 pierre (bureaux), 1 brique rose, 2 brique rouge, 3 blanc à balcons, 4 panneaux beiges, 5 commerce bas,
// 6 bardage métal, 7 maison, 8 béton, 9 pilastres de terre cuite, 10 arche de viaduc, 11 mur-rideau vitré
const PAL = [
  [0xd8cdb8, 0xcfc4ae, 0xe0d6c4], [0xc98f7c, 0xd09a86, 0xbd8572], [0xb5563c, 0xa94e38, 0xc0624a], [0xeceae4, 0xe2e0da, 0xf2f0ea],
  [0xcdbfa8, 0xc6b7a2, 0xd6c9b6, 0xcbb3a4], [0xb9bcc0, 0xc8c5bd, 0xa9adb2], [0x9aa3ab, 0xc0c4c8, 0xaeb4b8], [0xe6dcc6, 0xded2ba, 0xeee6d4], [0xd2cec4, 0xc8c4ba],
  [0xcdb09a, 0xc9ab94, 0xd2b6a0], [0xcdb09a], [0x8e9aa4, 0x9aa6ae, 0x7f8c98],
];
/** mur à grandes arches entre deux rangées de tours : extrémités de son axe */
const VIADUC: [number, number, number, number] = [130, 1732, 232, 1797];
/** quartiers à l'allure propre : [x, z, rayon, style, couleur ou null, hauteur minimale] */
const ZONES: [number, number, number, number, number | null, number][] = [
  [64, 1688, 185, 9, null, 6],
  [0, 0, 62, 8, 0xdcd6c8, 6],
  [42, -84, 78, 3, 0xf0eee8, 12],
  [-520, -515, 95, 6, 0xb46a35, 5],
  [-75, -78, 70, 11, 0x8a96a0, 8],
  [-190, 2150, 260, 3, 0xe9e7e1, 7],
  [80, 2190, 200, 3, 0xcfc8ba, 7],
  [-400, 350, 240, 4, 0xcdb5a6, 12],
];
/** façades autour de certains emplacements : [numéro, rayon, style, couleur ou null, hauteur minimale] */
const FACADES: [number, number, number, number | null, number][] = [
  [19, 34, 2, 0x8f4a38, 5], [11, 70, 6, 0xeceeee, 8], [24, 48, 2, 0xa5503a, 4], [39, 45, 7, 0xe6dcc4, 3], [23, 26, 8, 0xb7a684, 4], [26, 30, 8, 0xd9cdb4, 4],
  [13, 48, 8, 0xb3a487, 3], [10, 42, 1, null, 5], [18, 60, 6, 0x565a61, 6], [30, 65, 7, 0xece4d2, 3], [21, 48, 4, 0xd9cdb8, 4], [29, 50, 6, 0x2e3136, 5],
  [33, 55, 6, 0xb8c0c6, 4], [14, 50, 6, 0xc4c9cd, 4], [4, 45, 6, 0xcfd3d6, 5], [16, 70, 2, 0xa9553f, 8], [7, 62, 11, 0x7fb0aa, 8], [34, 36, 6, 0x4a4d52, 3],
  [35, 46, 6, 0x3c3f42, 3], [28, 26, 5, 0x8a4b32, 2], [27, 40, 1, 0xb5654d, 3], [37, 45, 5, 0xe2dccb, 3],
];

/** Style et couleur imposée (ou null) de chaque bâtiment : lieu connu, bâtiment voisin relevé à l'œil, sinon règle d'usage. */
function styler(w: VilleWorld): (b: Batiment) => [number, number | null] {
  const zones = [...ZONES];
  // positions d'origine du fichier (comme les façades ont été relevées), pas les places définitives
  for (const [n, R, sty, col, hmin] of FACADES) { const e = w.raw.emplacements.find((q) => q.n === n); if (e) zones.unshift([e.x, e.z, R, sty, col, hmin]); }
  const labels = w.raw.styles;
  const heur = (b: Batiment): number => {
    const h = b.r - b.b, r = hash(b.x, b.z), u = b.u;
    if (u === 'Spo') return 6;
    if (u === 'Rel') return 8;
    if (u === 'Ann' || (h < 4.5 && b.a < 60)) return 7;
    if (u === 'Com') return h < 9 ? 5 : (r < 0.25 ? 11 : 0);
    if (h < 8) return 7;
    if (b.x > 60 && b.z > 40 && b.x < 750 && b.z < 700) return r < 0.45 ? 1 : r < 0.75 ? 2 : 3;
    if (b.z < -250) return r < 0.6 ? 3 : 0;
    return r < 0.45 ? 3 : r < 0.8 ? 4 : 1;
  };
  return (b) => {
    const h = b.r - b.b;
    if (segDist(b.x, b.z, ...VIADUC) < 26 && h > 8) return [9, null];
    for (const [x, z, R, s, c, hmin] of zones) if (h >= hmin && Math.hypot(b.x - x, b.z - z) < R) return [s, c];
    let best: (typeof labels)[number] | null = null, bd = 1e9;
    for (const l of labels) {
      const d = Math.hypot(b.x - l.x, b.z - l.z);
      if (d < bd && (d < 14 || (d < 230 && Math.abs(h - l.h) < 8 && (l.s === 7) === (h < 8)))) { bd = d; best = l; }
    }
    if (best && b.u !== 'Spo' && b.u !== 'Rel') {
      if (bd >= 14 && (b.u === 'Com') !== (best.s === 11 || best.s === 0 || best.s === 5)) return [heur(b), null];
      return [best.s, best.c];
    }
    return [heur(b), null];
  };
}

/** Géométrie d'un pavé de bâtiments, courbure comprise. */
export interface BuildingChunk {
  /** dalle (texture des toits) */
  tile: number;
  pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; sty: Float32Array; dim: Float32Array;
  idx: Uint32Array;
}

/** Murs et toits de tous les bâtiments, rangés par pavé. Aucune dépendance au rendu. */
export function buildingChunks(w: VilleWorld): BuildingChunk[] {
  const { raw, NT, TS, OX, OZ, bendY } = w;
  const bats = raw.bats, G = NT * SUB, CS = TS / SUB;
  const styleOf = styler(w);
  const cellOf = (x: number, z: number): number => Math.min(G - 1, Math.max(0, Math.floor((z - OZ) / CS))) * G + Math.min(G - 1, Math.max(0, Math.floor((x - OX) / CS)));
  const lists: Batiment[][] = Array.from({ length: G * G }, () => []);
  for (const b of bats) lists[cellOf(b.x, b.z)].push(b);
  // acrotères : seulement près des emplacements (positions d'origine), là où on voit les toits de près
  const POSTS_XZ: [number, number][] = [[-40.5, 36.5], [314.5, 230.5], [-359.5, 357.5], ...raw.meta.grues.map((c): [number, number] => [c.x, c.z]), ...raw.emplacements.map((e): [number, number] => [e.x, e.z])];
  const viaducCell = cellOf(VIADUC[0], VIADUC[1]);
  const c = new Color();
  const out: BuildingChunk[] = [];
  for (let ci = 0; ci < G * G; ci++) {
    const list = lists[ci];
    if (!list.length && ci !== viaducCell) continue;
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], sty: number[] = [], dim: number[] = [], idx: number[] = [];
    const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, s: number, L: number, H: number): number => {
      pos.push(x, y + bendY(x, z), z); nrm.push(nx, ny, nz); uv.push(u, v); col.push(c.r, c.g, c.b); sty.push(s); dim.push(L, H);
      return pos.length / 3 - 1;
    };
    const wall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, s: number, vb: number): void => {
      const L = Math.hypot(bx - ax, bz - az), H = y1 - vb;
      const a = vert(ax, y0, az, nx, 0, nz, 0, y0 - vb, s, L, H), b = vert(bx, y0, bz, nx, 0, nz, L, y0 - vb, s, L, H);
      const d = vert(ax, y1, az, nx, 0, nz, 0, y1 - vb, s, L, H), e = vert(bx, y1, bz, nx, 0, nz, L, y1 - vb, s, L, H);
      idx.push(a, b, e, a, e, d);
    };
    const flat = (pts: [number, number][], y: number, tris: number[][]): void => {
      const o = pos.length / 3;
      for (const p of pts) vert(p[0], y, p[1], 0, 1, 0, 0, 0, -1, 0, 0);
      for (const t of tris) idx.push(o + t[0], o + t[2], o + t[1]);
    };
    for (const b of list) {
      const [s, fixed] = styleOf(b);
      const pal = PAL[s];
      c.setHex(fixed ?? pal[Math.floor(hash(b.x, b.z, 1) * pal.length)]).multiplyScalar(0.93 + 0.14 * hash(b.x, b.z, 2));
      const y0 = b.b - 1.5, y1 = b.r;
      for (const rings of b.p) {
        rings.forEach((ring, ri) => {
          let area = 0;
          for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
          const sgn = (area > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i], q = ring[(i + 1) % ring.length];
            const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
            if (L < 0.05) continue;
            wall(p[0], p[1], q[0], q[1], y0, y1, (sgn * dz) / L, (-sgn * dx) / L, s, b.b);
          }
        });
        const contour = rings[0].map((p) => new Vector2(p[0], p[1]));
        const holes = rings.slice(1).map((r) => r.map((p) => new Vector2(p[0], p[1])));
        flat(rings.flat(), y1, ShapeUtils.triangulateShape(contour, holes));
        // acrotère : relevé de 55 cm au bord du toit
        if (s !== 7 && s !== 10 && y1 - b.b > 7 && POSTS_XZ.some((q) => Math.hypot(b.x - q[0], b.z - q[1]) < 260)) {
          const ring = rings[0];
          for (let i = 0; i < ring.length; i++) {
            const a2 = ring[i], b2 = ring[(i + 1) % ring.length], dx = b2[0] - a2[0], dz = b2[1] - a2[1], L2 = Math.hypot(dx, dz);
            if (L2 < 0.3) continue;
            wall(a2[0], a2[1], b2[0], b2[1], y1, y1 + 0.55, dz / L2, -dx / L2, s, b.b - 0.55);
          }
        }
      }
      for (const k of b.k) {
        const [X, Z, kw, kd, th, top] = k, ct = Math.cos(th), st = Math.sin(th), hw = kw / 2, hd = kd / 2;
        const cs = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, e]): [number, number] => [X + a * ct - e * st, Z + a * st + e * ct]);
        for (let i = 0; i < 4; i++) {
          const p = cs[i], q = cs[(i + 1) % 4], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
          wall(p[0], p[1], q[0], q[1], y1 - 0.3, top, dz / L, -dx / L, s, b.b);
        }
        flat(cs, top, [[0, 1, 2], [0, 2, 3]]);
      }
    }
    if (ci === viaducCell) {
      const towers = bats.filter((b) => segDist(b.x, b.z, ...VIADUC) < 26 && b.r - b.b > 8 && b.a > 60).sort((p, q) => p.x - q.x);
      if (towers.length >= 2) {
        const a = towers[0], z = towers[towers.length - 1], n = towers.length - 1;
        const L = Math.hypot(z.x - a.x, z.z - a.z), dx = (z.x - a.x) / L, dz = (z.z - a.z) / L, base = Math.min(...towers.map((t) => t.b)), top = towers.reduce((m, t) => m + t.r, 0) / towers.length;
        c.setHex(0xcdb09a);
        // la période des arches est fixée à 20,6 m dans le shader : l'échelle de u la fait tomber entre les tours
        const k = 20.6 / (L / n), H = top - base;
        for (const off of [-3.2, 3.2]) {
          const ax = a.x - dz * off, az = a.z + dx * off, o = pos.length / 3;
          for (const [t, y] of [[0, base - 1], [L, base - 1], [0, top], [L, top]]) vert(ax + dx * t, y, az + dz * t, -dz * Math.sign(off), 0, dx * Math.sign(off), t * k, y - base, 10, L * k, H);
          idx.push(o, o + 1, o + 3, o, o + 3, o + 2);
        }
      }
    }
    if (!idx.length) continue;
    const cx = ci % G, cz = Math.floor(ci / G);
    out.push({ tile: Math.floor(cz / SUB) * NT + Math.floor(cx / SUB), pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), col: new Float32Array(col), sty: new Float32Array(sty), dim: new Float32Array(dim), idx: new Uint32Array(idx) });
  }
  return out;
}

/** Triangles des pavés (neuf nombres chacun, monde du jeu) pour le BVH des balles. */
export function chunkTriangles(chunks: BuildingChunk[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.idx.length;
  const out = new Float32Array(n * 3);
  let o = 0;
  for (const c of chunks) for (let i = 0; i < c.idx.length; i++) { const k = c.idx[i] * 3; out[o++] = c.pos[k]; out[o++] = c.pos[k + 1]; out[o++] = c.pos[k + 2]; }
  return out;
}

const VERT = /* glsl */ `
attribute vec3 aCol; attribute float aSty; attribute vec2 aDim;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying float vSty; varying float vDist; varying vec2 vDim;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vUv = uv; vCol = aCol; vSty = aSty; vDim = aDim;
  vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
}`;

// Façades en aplats : mêmes dessins que la page d'origine. Pas d'ombre portée ni de brume ici (l'atmosphère du jeu
// s'en charge en post-traitement) ; la couleur sort en linéaire, multipliée par la lumière commune de la carte.
const FRAG = /* glsl */ `
uniform sampler2D sol; uniform vec3 sun; uniform vec3 uLight; uniform float size; uniform vec2 org;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying float vSty; varying float vDist; varying vec2 vDim;
${NOISE_GLSL}
float box(float a, float b, float x){ return step(a, x) * step(x, b); }
void main(){
  vec3 c;
  if (vSty < -0.5) {
    c = texture2D(sol, clamp(vec2((vW.x - org.x) / size, 1.0 - (vW.z - org.y) / size), 0.001, 0.999)).rgb;
    float lr = dot(c, vec3(0.33));                                    // toits : teintes calmées, ombres du dessin adoucies
    c = mix(vec3(lr), c, 0.45) * vec3(1.02, 1.0, 0.97);
    c = mix(c, vec3(0.56, 0.55, 0.53), 0.45 * (1.0 - smoothstep(0.10, 0.42, lr)));
    float nr = 1.0 - smoothstep(40.0, 320.0, vDist);                  // de près : gravillon et lés d'étanchéité
    c *= mix(1.0, 0.86 + 0.20 * vn(vW.xz * 6.0) + 0.08 * vn(vW.xz * 0.7) - 0.05 * step(0.96, fract(vW.x * 0.5 + vW.z * 0.13)), nr);
  } else {
    int s = int(vSty + 0.5);
    float L = vDim.x, Ht = vDim.y, v = vUv.y;
    // hauteur d'étage, travée, marge latérale de la baie, allège, linteau, part de travées à balcon, vitrine au rez-de-chaussée
    float fh = 2.85, bw = 3.0, wx = 0.27, wy0 = 0.33, wy1 = 0.82, balc = 0.0, shop = 0.0;
    vec3 glass = vec3(0.13, 0.17, 0.22), frame = vec3(0.90), rail = vec3(0.88);
    if (s == 0) { fh = 3.3; bw = 2.7; wx = 0.20; wy0 = 0.26; wy1 = 0.86; shop = 1.0; glass = vec3(0.09, 0.12, 0.16); frame = vec3(0.30); }
    else if (s == 1) { bw = 3.4; balc = 0.5; rail = vec3(0.62, 0.78, 0.72); }
    else if (s == 2) { bw = 3.2; wx = 0.25; balc = 0.35; }
    else if (s == 3) { bw = 3.6; wx = 0.20; wy0 = 0.30; wy1 = 0.88; balc = 0.7; }
    else if (s == 4) { bw = 2.8; wx = 0.30; wy0 = 0.38; wy1 = 0.80; balc = 0.15; rail = vCol * 0.9; }
    else if (s == 5) { fh = 4.4; bw = 6.0; wx = 0.10; wy0 = 0.08; wy1 = 0.62; shop = 1.0; frame = vec3(0.25); }
    else if (s == 7) { fh = 2.7; bw = 4.0; wx = 0.34; wy0 = 0.34; wy1 = 0.80; }
    else if (s == 8) { fh = 4.2; bw = 5.0; wx = 0.22; wy0 = 0.14; wy1 = 0.86; frame = vec3(0.22); glass = vec3(0.08, 0.10, 0.13); }
    else if (s == 9 || s == 10) { fh = 2.9; bw = 3.3; wx = 0.30; wy0 = 0.26; wy1 = 0.86; frame = vec3(0.42, 0.16, 0.17); }
    else if (s == 11) { fh = 3.5; bw = 1.5; wx = 0.04; wy0 = 0.26; wy1 = 0.97; frame = vec3(0.35, 0.37, 0.40); glass = vec3(0.16, 0.24, 0.32); }
    float nb = max(1.0, floor(L / bw));
    float mg = (L - nb * bw) * 0.5, ul = vUv.x - mg;
    float inb = step(0.0, ul) * step(ul, nb * bw) * step(bw * 0.75, L);
    float bay = floor(ul / bw), fu = fract(ul / bw), fl = floor(v / fh), fv = fract(v / fh);
    float top = step((fl + 1.0) * fh, Ht - 0.3) * step(0.0, v);
    float r = h21(vec2(bay, fl) + floor(vW.xz * 0.05));
    c = vCol * (0.95 + 0.07 * h21(floor(vec2(vUv.x * 1.3, v * 2.6)) + floor(vW.xz * 0.1)));
    // matière
    if (s == 1 || s == 2) c *= 0.92 + 0.08 * step(0.35, fract(v * 12.0)) * step(0.08, fract(vUv.x * 4.0 + floor(v * 12.0) * 0.5));
    if (s == 4) c *= 0.93 + 0.07 * step(0.03, fu) * step(0.035, fv);                         // joints de panneaux
    if (s == 3) c *= 0.95 + 0.05 * step(0.04, fv);
    if (s == 6) c *= 0.86 + 0.14 * step(0.5, fract(vUv.x * 1.6));                           // nervures du bardage
    if (s == 0 || s == 8) c *= 0.955 + 0.045 * step(0.05, fract(v / 1.15)) * step(0.02, fract(vUv.x / 2.3 + floor(v / 1.15) * 0.5));
    float win = box(wx, 1.0 - wx, fu) * box(wy0, wy1, fv) * inb * top;
    float bal = 0.0;
    if (s == 9 || s == 10) {
      // pilastres en carreaux de terre cuite, travées à balcons à balustres, baies étroites, attique au-dessus d'une corniche
      float pil = (1.0 - box(0.10, 0.90, fu)) * inb;
      vec3 tile = vec3(0.71, 0.47, 0.37) * (0.90 + 0.10 * step(0.12, fract(v * 5.0)) * step(0.12, fract(vUv.x * 5.0)));
      float wide = step(0.5, fract(bay * 0.5 + 0.25));                                       // une travée sur deux porte un balcon
      float wxa = mix(0.36, 0.20, wide);
      win = box(wxa, 1.0 - wxa, fu) * box(mix(0.30, 0.10, wide), 0.86, fv) * inb * top;
      bal = wide * box(0.14, 0.86, fu) * box(0.0, 0.36, fv) * inb * top * step(0.5, fl);
      float att = step(Ht - 3.3, v);
      if (att > 0.5) { win = box(0.34, 0.66, fu) * box(Ht - 2.4, Ht - 1.0, v) * inb; bal = 0.0; pil = 0.0; }
      c = mix(c, tile, pil * step(2.6, v));
      c *= 1.0 - 0.30 * box(Ht - 3.45, Ht - 3.15, v);                                        // ombre de la corniche
      if (v < 2.6) { c = vec3(0.60, 0.58, 0.52) * (0.9 + 0.1 * step(0.08, fract(v / 0.65))); win = 0.0; bal = 0.0; }
      if (s == 10) {                                                                        // grande arche entre deux tours
        float P = 20.6, x = (fract(vUv.x / P) - 0.5) * P, rr = 3.9, spring = Ht - 7.4;
        float inside = step(abs(x), rr) * step(2.4, v) * (v < spring ? 1.0 : step(length(vec2(x, v - spring)), rr));
        if (inside > 0.5) discard;
        win = 0.0; bal = 0.0;
        if (v > Ht - 3.3) win = box(Ht - 2.5, Ht - 0.9, v) * step(abs(x), 2.6) * step(0.25, fract(x / 1.7));
      }
      rail = vec3(0.83, 0.75, 0.66) * (0.72 + 0.28 * step(0.45, fract(ul * 3.2)));           // balustres
    } else if (balc > 0.0) {
      float on = step(h21(vec2(bay, 7.0) + floor(vW.xz * 0.03)), balc);
      bal = on * box(0.05, 0.95, fu) * box(0.0, 0.34, fv) * inb * top * step(0.5, fl);
      if (on > 0.5 && fl > 0.5) win = box(wx * 0.7, 1.0 - wx * 0.7, fu) * box(0.06, wy1, fv) * inb * top;   // porte-fenêtre
    }
    if (s == 6) win = 0.0;
    if (s == 8) win *= step(0.45, h21(vec2(bay, fl) + 3.0));
    if (s == 5 && fl > 0.5) win *= step(0.65, r);
    if (shop > 0.0 && fl < 0.5) win = box(0.05, 0.95, fu) * box(0.04, 0.84, fv) * inb * step(0.0, v);
    if (s == 7) { float sh = (box(wx - 0.09, wx, fu) + box(1.0 - wx, 1.0 - wx + 0.09, fu)) * box(wy0, wy1, fv) * inb * top; c = mix(c, vec3(0.42, 0.50, 0.46), sh * step(0.5, h21(vec2(bay, 2.0) + floor(vW.xz * 0.05)))); }
    // vitrage : reflet du ciel, rideaux, stores
    vec3 g = mix(glass, vec3(0.42, 0.55, 0.70), 0.18 + 0.30 * fv * (0.5 + r));
    if (r > 0.90) g = vec3(0.80, 0.77, 0.68);
    else if (r > 0.72) g = mix(g, vec3(0.74, 0.72, 0.68), 0.55 * step(fract(fu * 3.0 + r), 0.5));
    float edge = 1.0 - box(wx + 0.035, 1.0 - wx - 0.035, fu) * box(wy0 + 0.045, wy1 - 0.035, fv);
    if (s == 9 || s == 10 || balc > 0.0) edge *= 0.6;
    g = mix(g, frame, edge * 0.8);
    g *= 0.72 + 0.28 * smoothstep(wy1, wy1 - 0.16, fv);                                      // ombre du linteau
    c = mix(c, g, win);
    c = mix(c, vCol * 1.10, box(wx - 0.02, 1.0 - wx + 0.02, fu) * box(wy0 - 0.04, wy0, fv) * inb * top * (1.0 - bal) * step(0.5, 1.0 - win)); // appui
    c = mix(c, rail * (0.86 + 0.14 * step(0.05, fv)), bal);
    c *= 1.0 - 0.25 * bal * box(0.34, 0.345, fv);
    if (balc > 0.0 || s == 9) c *= 1.0 - 0.20 * box(0.94, 1.0, fv) * inb * top * (1.0 - win);   // ombre de la dalle du dessus
    // couronnement et soubassement
    c *= 1.0 + 0.07 * step(Ht - 0.35, v) - 0.16 * box(Ht - 0.48, Ht - 0.35, v);
    c *= 0.80 + 0.20 * smoothstep(0.0, 1.8, v);
    float dif = max(dot(normalize(vN), sun), 0.0);
    c *= 0.60 + 0.66 * dif;
  }
  gl_FragColor = vec4(c * uLight, 1.0);
}`;

/** Maillages des pavés : un matériau par dalle (texture des toits), un maillage par pavé. */
export function buildingMeshes(w: VilleWorld, chunks: BuildingChunk[], tiles: Texture[]): Group {
  const group = new Group();
  const mats = new Map<number, ShaderMaterial>();
  for (const c of chunks) {
    let mat = mats.get(c.tile);
    if (!mat) {
      const a = Math.floor(c.tile / w.NT), b = c.tile % w.NT;
      mat = new ShaderMaterial({
        side: DoubleSide,
        uniforms: { sol: { value: tiles[c.tile] }, sun: { value: SUN }, uLight, size: { value: w.TS }, org: { value: new Vector2(w.OX + b * w.TS, w.OZ + a * w.TS) } },
        vertexShader: VERT, fragmentShader: FRAG,
      });
      mats.set(c.tile, mat);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new BufferAttribute(c.nrm, 3));
    g.setAttribute('uv', new BufferAttribute(c.uv, 2));
    g.setAttribute('aCol', new BufferAttribute(c.col, 3));
    g.setAttribute('aSty', new BufferAttribute(c.sty, 1));
    g.setAttribute('aDim', new BufferAttribute(c.dim, 2));
    g.setIndex(new BufferAttribute(c.idx, 1));
    g.computeBoundingSphere();
    const m = new Mesh(g, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  return group;
}
