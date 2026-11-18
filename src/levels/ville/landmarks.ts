// Ville nouvelle : repères et mobilier — horizon lointain, manège et passerelle du bassin, ponts, parapets et bacs du
// canal, portique, fontaine, lampadaires, voitures en stationnement, grues à tour. Formes et couleurs de la page
// d'origine ; les pièces d'une seule couleur sont fusionnées (shade.ts), le reste est instancié.
import {
  BackSide, BoxGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, PlaneGeometry,
  Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry, type Material, type Object3D, type ShaderMaterial,
} from 'three';
import type { Engine } from '../../core/engine';
import { BASSIN, BOMBE, CANAL, CANAL_W, CRANE_H, MANEGE, hash, inPoly, type VilleWorld } from './data';
import { bake, basic, flat, lit } from './shade';

const UP = new Vector3(0, 1, 0);
const L = flat;
const mesh = (parent: Object3D, geo: BufferGeometry, mat: Material | Material[], x: number, y: number, z: number): Mesh => { const m = new Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const box = (g: Object3D, w: number, h: number, d: number, mat: Material | Material[], px: number, py: number, pz: number): Mesh => mesh(g, new BoxGeometry(w, h, d), mat, px, py, pz);
function rod(g: Object3D, a: Vector3, b: Vector3, r = 0.07, color = 0x3a3a3a): void {
  const d = new Vector3().subVectors(b, a);
  const m = new Mesh(new CylinderGeometry(r, r, d.length(), 5), L(color));
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  g.add(m);
}
function canvas(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Ligne d'horizon boisée et silhouette de la tour lointaine, là où la photographie lointaine s'arrête. */
function horizon(w: VilleWorld, out: Group): void {
  const post = w.meta.postes.eiffel, ei = w.meta.eiffel;
  if (!post) return;
  const R = 8500, top = post[1] + ei.angleHorizon * R, hgt = 70;
  const tex = canvas(2048, 64, (x) => {
    x.fillStyle = '#8fa39d'; x.fillRect(0, 12, 2048, 52);
    for (let i = 0; i < 2048; i += 2) { const h = 4 + 8 * hash(i, 1) * hash(Math.floor(i / 24), 2); x.fillRect(i, 12 - h, 2, h + 1); }
  });
  tex.wrapS = RepeatWrapping; tex.repeat.x = 6;
  const ring = new Mesh(new CylinderGeometry(R, R, hgt, 96, 1, true), basic({ map: tex, transparent: true, alphaTest: 0.5, side: BackSide }));
  // si loin du centre, la courbure vaut partout sa valeur de bord
  ring.position.y = top - hgt / 2 + hgt * (12 / 64) - BOMBE;
  ring.renderOrder = -4;
  out.add(ring);

  const Dt = 9000, k = Dt / ei.distance, H = 330 * k, W = 125 * k;
  const tt = canvas(256, 640, (y) => {
    y.fillStyle = 'rgba(96,108,122,0.92)';
    const half = (v: number): number => { const t = v / 640; return 4 + 124 * Math.pow(t, 2.6) + 10 * t; };   // profil évasé
    y.beginPath(); y.moveTo(128, 0);
    for (let v = 0; v <= 640; v += 8) y.lineTo(128 + half(v), v);
    for (let v = 640; v >= 0; v -= 8) y.lineTo(128 - half(v), v);
    y.closePath(); y.fill();
    y.globalCompositeOperation = 'destination-out';
    y.beginPath(); y.ellipse(128, 640, 70, 150, 0, Math.PI, 0); y.fill();                    // arche entre les piliers
    y.globalCompositeOperation = 'source-over';
    for (const [v, ww, t] of [[530, 96, 9], [410, 52, 8], [150, 16, 7]]) y.fillRect(128 - ww, v, 2 * ww, t); // trois étages
    y.fillRect(126, 0, 4, 40);                                                                // antenne
  });
  const tour = new Mesh(new PlaneGeometry(W, H), basic({ map: tt, transparent: true, depthWrite: false }));
  const az = (ei.azimut * Math.PI) / 180;
  tour.position.set(Math.sin(az) * Dt + post[0], post[1] + ei.angleSommet * Dt - H / 2 - BOMBE, -Math.cos(az) * Dt + post[2]);
  tour.rotation.y = -az;
  tour.renderOrder = -5;
  out.add(tour);
}

/** Manège, passerelle, jardinières et margelle du bassin ; terrasse de restaurant ; ponts, parapets et bacs du canal ; portique ; fontaine. */
function centre(engine: Engine, w: VilleWorld, water: ShaderMaterial, g: Group): void {
  const { groundY } = w, y0 = w.LB;
  const [mx, mz, mr] = MANEGE;
  const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number): Mesh => mesh(g, geo, mat, x, y, z);
  add(new CylinderGeometry(mr + 0.6, mr + 0.8, 0.7, 28), L(0xb9b4a8), mx, y0 + 0.2, mz);                 // socle
  add(new CylinderGeometry(mr, mr, 0.25, 28), L(0x7a4a32), mx, y0 + 0.7, mz);                           // plancher
  add(new CylinderGeometry(1.1, 1.1, 4.0, 14), L(0xd9c9a0), mx, y0 + 2.8, mz);                          // fût central
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new CylinderGeometry(0.06, 0.06, 3.6, 5), L(0xd8b24a), mx + Math.cos(a) * (mr - 0.5), y0 + 2.6, mz + Math.sin(a) * (mr - 0.5)); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3, r = mr - 2 - (i % 2) * 1.4; add(new BoxGeometry(1.3, 0.9, 0.35), L([0xf1ece2, 0x8a5a3a, 0x2f2f33][i % 3]), mx + Math.cos(a) * r, y0 + 1.6 + (i % 2) * 0.3, mz + Math.sin(a) * r).rotation.y = -a + Math.PI / 2; }
  const stripes = lit(engine, { map: canvas(512, 8, (x) => { for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#f3ead8' : '#8c4a36'; x.fillRect(i * 32, 0, 32, 8); } }), side: DoubleSide }, 'toile');
  add(new ConeGeometry(mr + 0.9, 2.6, 32, 1, true), stripes, mx, y0 + 5.9, mz);                          // chapiteau rayé
  add(new CylinderGeometry(mr + 0.9, mr + 0.9, 0.5, 32, 1, true), stripes, mx, y0 + 4.5, mz);
  add(new SphereGeometry(0.35, 8, 6), L(0xd8b24a), mx, y0 + 7.4, mz);
  { // passerelle : du manège vers l'est, au-dessus de l'eau
    const A = new Vector3(1, 0, 79), B = new Vector3(39, 0, 84.5), d = new Vector3().subVectors(B, A), len = d.length(), ang = Math.atan2(d.z, d.x);
    const span = new Group();
    box(span, len, 0.3, 2.8, L(0xa39a8c), 0, 1.0, 0);
    for (const s of [-1.35, 1.35]) {
      box(span, len, 0.07, 0.07, L(0x4c5257), 0, 2.1, s);
      for (let i = 0; i <= 16; i++) box(span, 0.06, 1.0, 0.06, L(0x4c5257), -len / 2 + (i / 16) * len, 1.6, s);
    }
    for (let i = 1; i < 5; i++) box(span, 0.5, 1.6, 2.2, L(0x8f887c), -len / 2 + (i / 5) * len, 0.2, 0);
    span.position.set((A.x + B.x) / 2, y0, (A.z + B.z) / 2);
    span.rotation.y = -ang;
    g.add(span);
  }
  // jardinières fleuries posées dans le bassin
  const fleurs = [0xc2417a, 0xe0b23a, 0x8a4fb0, 0xd9d2e8, 0xc9482f];
  let nf = 0;
  for (const [jx, jz] of [[10, 68], [20, 66], [21, 75], [9.5, 76], [31, 74], [-5, 89.5], [-4.5, 95], [1, 88], [-18.5, 102], [-8, 104], [-5, 106], [4.5, 106], [-12, 110], [7, 114], [8, 117], [12, 121.5], [21, 120], [27.5, 88], [32.5, 88.5]]) {
    if (!inPoly(jx, jz, BASSIN)) continue;
    add(new CylinderGeometry(0.9, 1.0, 0.5, 10), L(0x4a4f48), jx, y0 + 0.2, jz);
    add(new ConeGeometry(0.85, 1.3, 9), L(0x3f6a38), jx, y0 + 1.05, jz);
    add(new SphereGeometry(0.55, 8, 6), L(fleurs[nf++ % fleurs.length]), jx, y0 + 0.75, jz).scale.set(1.5, 0.6, 1.5);
  }
  // margelle du bassin
  for (let i = 0; i < BASSIN.length; i++) {
    const a = BASSIN[i], b = BASSIN[(i + 1) % BASSIN.length], dx = b[0] - a[0], dz = b[1] - a[1];
    add(new BoxGeometry(Math.hypot(dx, dz), 0.45, 0.5), L(0xb7b1a5), (a[0] + b[0]) / 2, y0 + 0.1, (a[1] + b[1]) / 2).rotation.y = -Math.atan2(dz, dx);
  }
  // terrasse de restaurant au nord-est du bassin : parasols rouges, tables
  for (let i = 0; i < 7; i++) {
    const px = 31 + (i % 2) * 5.2 + Math.floor(i / 2) * 2.6, pz = 60.5 + Math.floor(i / 2) * 4.6, py = groundY(px, pz);
    add(new CylinderGeometry(0.05, 0.05, 2.6, 5), L(0x55585a), px, py + 1.3, pz);
    add(new ConeGeometry(2.6, 1.0, 4), L(0xc0271f), px, py + 3.0, pz).rotation.y = Math.PI / 4 + 0.5;
    add(new CylinderGeometry(0.55, 0.55, 0.06, 10), L(0x8a8d90), px + 0.9, py + 0.75, pz + 0.4);
    add(new CylinderGeometry(0.55, 0.55, 0.06, 10), L(0x8a8d90), px - 0.9, py + 0.75, pz - 0.5);
  }

  // canal : il passe sous les rues ouvertes à la circulation (pont routier à chaque croisement) ; parapets de quai,
  // bacs plantés et passerelles piétonnes en bois seulement en dehors de ces croisements
  const bois = L(0xb08a5e), beton = L(0xaaa69c), enrobe = L(0x46484d), trottoir = L(0xa6a39c);
  const cross: { x: number; z: number; ux: number; uz: number; w: number; half: number; len: number }[] = [];
  for (const r of w.raw.voirie) {
    for (let a = 0; a < r.p.length - 1; a++) {
      const p1 = r.p[a], p2 = r.p[a + 1];
      for (let i = 0; i < CANAL.length - 1; i++) {
        const q1 = CANAL[i], q2 = CANAL[i + 1];
        const rx = p2[0] - p1[0], rz = p2[1] - p1[1], sx = q2[0] - q1[0], sz = q2[1] - q1[1], den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((q1[0] - p1[0]) * sz - (q1[1] - p1[1]) * sx) / den, u = ((q1[0] - p1[0]) * rz - (q1[1] - p1[1]) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const L2 = Math.hypot(rx, rz), sinA = Math.abs(den) / (L2 * Math.hypot(sx, sz));
        cross.push({ x: p1[0] + rx * t, z: p1[1] + rz * t, ux: rx / L2, uz: rz / L2, w: r.w, half: (r.w / 2 + 2.2) / Math.max(0.35, sinA), len: Math.min(60, (CANAL_W + 26) / Math.max(0.35, sinA)) });
      }
    }
  }
  const underRoad = (x: number, z: number, extra = 0): boolean => cross.some((c) => Math.hypot(x - c.x, z - c.z) < c.half + extra);
  for (const c of cross) {                                       // pont routier : chaussée, trottoirs, garde-corps
    const y = Math.max(groundY(c.x + (c.ux * c.len) / 2, c.z + (c.uz * c.len) / 2), groundY(c.x - (c.ux * c.len) / 2, c.z - (c.uz * c.len) / 2), w.canalProj(c.x, c.z).lv + 1.6);
    const br = new Group();
    box(br, c.len, 0.7, c.w, enrobe, 0, -0.33, 0);
    for (const s of [-1, 1]) {
      box(br, c.len, 0.82, 1.7, trottoir, 0, -0.3, s * (c.w / 2 + 0.85));
      box(br, c.len * 0.5, 1.0, 0.22, beton, 0, 0.6, s * (c.w / 2 + 1.75));
    }
    br.position.set(c.x, y + 0.04, c.z);
    br.rotation.y = -Math.atan2(c.uz, c.ux);
    g.add(br);
  }
  let along = 0;
  for (let i = 0; i < CANAL.length - 1; i++) {
    const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len2 = Math.hypot(dx, dz), ux = dx / len2, uz = dz / len2, nx = -uz, nz = ux, rot = -Math.atan2(dz, dx);
    const n = Math.ceil(len2 / 4), step = len2 / n;
    for (let k = 0; k < n; k++) {                                  // parapets de quai par tronçons de 4 m, interrompus sous les ponts
      const t = (k + 0.5) * step, px = a[0] + ux * t, pz = a[1] + uz * t;
      if (underRoad(px, pz, 3)) continue;
      for (const s of [-1, 1]) {
        const cx = px + nx * s * (CANAL_W / 2 + 0.2), cz = pz + nz * s * (CANAL_W / 2 + 0.2);
        if (inPoly(cx, cz, BASSIN)) continue;
        add(new BoxGeometry(step + 0.05, 1.0, 0.4), beton, cx, Math.max(groundY(cx + nx * s * 12, cz + nz * s * 12), w.canalProj(px, pz).lv + 1.2) + 0.45, cz).rotation.y = rot;
      }
    }
    for (let t = 4; t < len2 - 2; t += 6.5) {
      const side = (Math.round((along + t) / 6.5) % 2 ? 1 : -1) * 2.1, px = a[0] + ux * t + nx * side, pz = a[1] + uz * t + nz * side, py = w.canalProj(px, pz).lv;
      if (underRoad(px, pz, 2)) continue;
      add(new BoxGeometry(1.9, 0.9, 1.9), bois, px, py + 0.4, pz).rotation.y = rot;
      add(new IcosahedronGeometry(1.15, 1), L([0x3f6a38, 0x55773a, 0x6a4a3a][Math.round(along + t) % 3]), px, py + 1.7, pz).scale.y = 1.25;
    }
    along += len2;
  }
  // passerelles piétonnes en bois (jamais sur une chaussée)
  for (const [bxp, bzp] of [[-144, 62], [-40, 126], [56, 158], [92, 171], [118, 181]]) {
    let best: { d: number; px: number; pz: number; rot: number; nx: number; nz: number } | null = null;
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((bxp - a[0]) * dx + (bzp - a[1]) * dz) / (dx * dx + dz * dz)));
      const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(bxp - px, bzp - pz);
      if (!best || d < best.d) best = { d, px, pz, rot: -Math.atan2(dz, dx), nx: -dz / Math.hypot(dx, dz), nz: dx / Math.hypot(dx, dz) };
    }
    if (!best || underRoad(best.px, best.pz, 8) || inPoly(best.px, best.pz, BASSIN)) continue;
    const { px, pz, rot, nx, nz } = best, py = Math.max(groundY(px + nx * (CANAL_W / 2 + 12), pz + nz * (CANAL_W / 2 + 12)), w.canalProj(px, pz).lv + 1.2) - 1.15;
    const br = new Group();
    box(br, 3.2, 0.2, CANAL_W + 3, bois, 0, 1.15, 0);
    for (const s of [-1.55, 1.55]) {
      for (const h of [1.7, 2.2]) box(br, 0.08, 0.08, CANAL_W + 3, bois, s, h, 0);
      for (let k = -3; k <= 3; k++) box(br, 0.1, 1.1, 0.1, bois, s, 1.7, (k * (CANAL_W + 2.6)) / 6);
    }
    br.position.set(px, py, pz);
    br.rotation.y = rot;
    g.add(br);
  }

  { // portique : poutre percée d'oculi portée par deux pylônes, arc métallique dessous (38 m, sommet à 24,6 m)
    const A = new Vector3(16, 0, -33), B = new Vector3(39, 0, -3), d = new Vector3().subVectors(B, A), len = d.length(), ang = Math.atan2(d.z, d.x);
    const gy = groundY(27, -18), HT = 24.6;
    const tex = canvas(1024, 64, (x) => {
      x.fillStyle = '#d9d5ca'; x.fillRect(0, 0, 1024, 64); x.strokeStyle = '#bdb8ac'; x.lineWidth = 2;
      for (let i = 0; i < 16; i++) { x.strokeRect(i * 64, 0, 64, 64); x.fillStyle = '#2a2d30'; x.beginPath(); x.arc(i * 64 + 32, 32, 13, 0, 7); x.fill(); x.fillStyle = '#d9d5ca'; }
    });
    tex.anisotropy = 8;
    const pg = new Group();
    const plain = (c: number): Material => lit(engine, { color: c }, 'uni'), oculi = lit(engine, { map: tex }, 'oculi');
    box(pg, len + 3, 3.2, 1.5, [plain(0xd9d5ca), plain(0xd9d5ca), plain(0xcfcabd), plain(0xb9b4a8), oculi, oculi], 0, HT - 1.6, 0);
    for (const s of [-1, 1]) {
      const py = mesh(pg, new CylinderGeometry(1.5, 2.6, HT - 3.2, 4), L(0xd3cec2), s * (len / 2), (HT - 3.2) / 2, 0);
      py.rotation.y = Math.PI / 4;
      box(pg, len + 3, 0.06, 0.06, L(0x4c5257), 0, HT + 1.1, s * 0.7);
    }
    mesh(pg, new TorusGeometry(len / 2 - 2.6, 0.22, 6, 40, Math.PI), L(0xe8e6e0), 0, 2.5, -1.6);
    pg.position.set((A.x + B.x) / 2, gy, (A.z + B.z) / 2);
    pg.rotation.y = -ang;
    g.add(pg);
    // fontaine : vasque annulaire en pierre, bassin central surélevé, couronne de jets
    const fx = 32, fz = -86, fy = groundY(fx, fz);
    add(new CylinderGeometry(11.5, 12, 0.7, 40), L(0xb5b0a4), fx, fy + 0.3, fz);
    add(new CylinderGeometry(10.6, 10.6, 0.1, 40), water, fx, fy + 0.68, fz).renderOrder = 3;
    add(new CylinderGeometry(5.2, 5.6, 1.5, 32), L(0xaaa59a), fx, fy + 0.9, fz);
    add(new CylinderGeometry(4.6, 4.6, 0.1, 32), water, fx, fy + 1.68, fz).renderOrder = 3;
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; add(new TorusGeometry(2.3, 0.05, 4, 10, Math.PI), L(0xf2f6f8), fx + Math.cos(a) * 7.9, fy + 0.7, fz + Math.sin(a) * 7.9).rotation.y = -a; }
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.2; add(new CylinderGeometry(0.14, 0.16, 0.9, 6), L(0x8f8a80), fx + Math.cos(a) * 14.5, fy + 0.45, fz + Math.sin(a) * 14.5); }
  }
}

/** Lampadaires et voitures en stationnement le long des rues, près des emplacements. */
function street(engine: Engine, w: VilleWorld, out: Group): { lamps: number; cars: number } {
  const { groundY, bendY, raw } = w;
  const POSTS_XZ: [number, number][] = [[-40.5, 36.5], [314.5, 230.5], [-359.5, 357.5], ...raw.meta.grues.map((c): [number, number] => [c.x, c.z]), ...raw.emplacements.map((e): [number, number] => [e.x, e.z])];
  const lamps: [number, number, number][] = [], cars: [number, number, number, number][] = [];
  const okSpot = (x: number, z: number): boolean => POSTS_XZ.some((q) => Math.hypot(x - q[0], z - q[1]) < 300) && !inPoly(x, z, BASSIN) && !w.nearCanal(x, z, CANAL_W / 2 + 1.5);
  raw.voirie.forEach((r, ri) => {
    let acc = (ri * 7.3) % 20;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const ux = dx / len, uz = dz / len, nx = -uz, nz = ux, rot = Math.atan2(-uz, ux);
      for (let t = (28 - (acc % 28)) % 28; t < len; t += 28) {
        const side = Math.round((acc + t) / 28) % 2 ? 1 : -1, x = a[0] + ux * t + nx * side * (r.w / 2 + 1.3), z = a[1] + uz * t + nz * side * (r.w / 2 + 1.3);
        if (okSpot(x, z)) lamps.push([x, z, rot + (side > 0 ? Math.PI : 0)]);
      }
      if (r.n.startsWith('Route à 1') && r.i >= 5 && r.w >= 4.5) {
        for (let t = ((6.4 - (acc % 6.4)) % 6.4) + 3; t < len - 3; t += 6.4) {
          const h = hash(Math.round(a[0] + ux * t), Math.round(a[1] + uz * t), 4);
          if (h > 0.42) continue;
          const side = r.s === 'Double sens' ? (h > 0.21 ? 1 : -1) : 1, x = a[0] + ux * t + nx * side * (r.w / 2 + 0.25), z = a[1] + uz * t + nz * side * (r.w / 2 + 0.25);
          if (okSpot(x, z)) cars.push([x, z, rot, h]);
        }
      }
      acc += len;
    }
  });
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(1, 1, 1), t = new Vector3(), c = new Color();
  const inst = (geo: BufferGeometry, mat: Material, n: number): InstancedMesh => { const im = new InstancedMesh(geo, mat, Math.max(1, n)); im.count = n; out.add(im); return im; };
  const pm = inst(new CylinderGeometry(0.07, 0.11, 8, 6).translate(0, 4, 0), lit(engine, { color: 0x5c6166 }, 'uni'), lamps.length);
  const hm = inst(new BoxGeometry(1.5, 0.12, 0.3).translate(0.7, 8.0, 0), lit(engine, { color: 0x3d4145 }, 'uni'), lamps.length);
  lamps.forEach(([x, z, rot], i) => { t.set(x, groundY(x, z) + bendY(x, z), z); q.setFromAxisAngle(UP, rot + Math.PI / 2); m.compose(t, q, s); pm.setMatrixAt(i, m); hm.setMatrixAt(i, m); });
  const bm = inst(new BoxGeometry(4.2, 0.72, 1.76).translate(0, 0.62, 0), lit(engine, {}, 'uni'), cars.length);
  const cm = inst(new BoxGeometry(2.3, 0.56, 1.6).translate(-0.15, 1.24, 0), lit(engine, { color: 0x1c2228 }, 'uni'), cars.length);
  const wm = inst(new BoxGeometry(2.9, 0.5, 1.82).translate(0, 0.25, 0), lit(engine, { color: 0x17181a }, 'uni'), cars.length);
  const paint = [0xd8d9db, 0x2a2c30, 0x7d8388, 0xf0efec, 0x1f3552, 0x8a1f1f, 0x4a4d52, 0xb9b3a4];
  cars.forEach(([x, z, rot, h], i) => {
    t.set(x, groundY(x, z) + 0.03 + bendY(x, z), z); q.setFromAxisAngle(UP, rot + ((h * 97) % 1 > 0.5 ? Math.PI : 0)); m.compose(t, q, s);
    bm.setMatrixAt(i, m); cm.setMatrixAt(i, m); wm.setMatrixAt(i, m); bm.setColorAt(i, c.setHex(paint[Math.floor(h * 191) % paint.length]));
  });
  for (const im of [pm, hm, bm, cm, wm]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; }
  return { lamps: lamps.length, cars: cars.length };
}

/** Grues à tour ; au sommet de chacune, la plateforme et le garde-corps en tube fin d'un emplacement. */
function cranes(engine: Engine, w: VilleWorld, root: Group): void {
  const cv = canvas(64, 64, (x) => {
    x.strokeStyle = '#e2b021'; x.lineWidth = 7; x.strokeRect(3, 3, 58, 58);
    x.lineWidth = 5; x.beginPath(); x.moveTo(4, 4); x.lineTo(60, 60); x.moveTo(60, 4); x.lineTo(4, 60); x.stroke();
  });
  const lattice = (ru: number, rv: number): Material => { const t = cv.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = 8; return lit(engine, { map: t, alphaTest: 0.4, side: DoubleSide }, 'treillis'); };
  const H = CRANE_H;
  const mats = { mast: lattice(1, H / 2), jib: lattice(37, 1), counter: lattice(14, 1), head: lattice(1, 6) };
  for (const c of w.grues) {
    const g = new Group();
    box(g, 6, 1.4, 6, L(0xb8b4aa), 0, 0.5, 0);
    box(g, 2, H, 2, mats.mast, 0, H / 2 + 1, 0);
    box(g, 2.8, 1.6, 2.8, L(0xd9a514), 0, H + 1.4, 0);
    box(g, 1.7, 2.1, 2.0, L(0xe9e6de), 1.3, H + 0.6, 2.3);          // cabine
    box(g, 1.75, 0.9, 2.05, L(0x1d2a33), 1.3, H + 1.0, 2.3);         // vitrage
    box(g, 56, 1.5, 1.3, mats.jib, 29, H + 3, 0);                    // flèche
    box(g, 17, 1.2, 1.3, mats.counter, -9.5, H + 3, 0);              // contre-flèche
    box(g, 4.5, 2.6, 1.8, L(0x9c9a94), -15.5, H + 1.3, 0);           // contrepoids
    box(g, 1.3, 8, 1.3, mats.head, 0, H + 7.5, 0);                   // porte-flèche
    rod(g, new Vector3(0, H + 11.4, 0), new Vector3(34, H + 3.7, 0));
    rod(g, new Vector3(0, H + 11.4, 0), new Vector3(-17, H + 3.6, 0));
    rod(g, new Vector3(40, H + 2.2, 0), new Vector3(40, H - 14, 0)); // câble de levage
    box(g, 0.8, 1.0, 0.8, L(0x2b2b2b), 40, H - 14.5, 0);
    box(g, 2.6, 0.12, 2.6, L(0x9a7a52), 0, H + 11.6, 0);             // plateforme au sommet, au-dessus de la cabine
    for (const [ax, az, bx, bz] of [[-1.3, -1.3, 1.3, -1.3], [1.3, -1.3, 1.3, 1.3], [1.3, 1.3, -1.3, 1.3], [-1.3, 1.3, -1.3, -1.3]]) {
      // garde-corps bas (0,6 m, comme perches.ts) en tube fin : il ne barre pas la vue du tireur et ne le masque pas de loin
      for (const hh of [0.6, 0.3]) rod(g, new Vector3(ax, H + 11.66 + hh, az), new Vector3(bx, H + 11.66 + hh, bz), 0.025);
      rod(g, new Vector3(ax, H + 11.66, az), new Vector3(ax, H + 12.26, az), 0.03);
    }
    g.position.set(c.x, c.sol, c.z);
    g.rotation.y = Math.PI / 2 - (c.cap * Math.PI) / 180;
    root.add(g);
  }
}

/** Tout le mobilier de la carte. `extras` : pièces d'une seule couleur venues d'ailleurs (murs de quai), fusionnées ici. */
export function buildLandmarks(engine: Engine, w: VilleWorld, water: ShaderMaterial, extras: Group): { group: Group; lamps: number; cars: number } {
  const group = new Group();
  horizon(w, group);
  // un maillage fusionné par ensemble (le centre, puis chaque grue), pour que chacun ait sa sphère englobante
  const c = new Group();
  c.add(extras);
  centre(engine, w, water, c);
  group.add(bake(engine, c, w.bendY));
  const all = new Group();
  cranes(engine, w, all);
  for (const one of [...all.children]) {
    const holder = new Group();
    holder.add(one);
    group.add(bake(engine, holder, w.bendY));
  }
  return { group, ...street(engine, w, group) };
}
