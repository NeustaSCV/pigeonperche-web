// Ville nouvelle : carte urbaine de 4,4 km de côté d'après les données ouvertes de l'IGN, vue depuis 39 emplacements en hauteur.
// Mode visite : on choisit un emplacement, on épaule et on tire sur les silhouettes fixes des autres emplacements.
import * as THREE from 'three';
import { buildPostes, FACADES } from './postes.js';
import { installTir } from './tir.js';
import { installReseau } from './reseau.js';
import { installEffets } from './effets.js';
import { installSons } from './sons.js';
import { installTactile } from './tactile.js';
import { isTouchDevice } from '../core/device';

const D = './ville/';
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const HAZE = new THREE.Color(0xb9c9d6);
const FOG = 0.00009;
scene.fog = new THREE.FogExp2(HAZE, FOG);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 22000)   // plan proche à 50 cm : on voit le plancher et le garde-corps du perchoir;
camera.rotation.order = 'YXZ';

const SUN = new THREE.Vector3(0.55, 0.62, 0.56).normalize(); // soleil au sud-est, comme sur la photo aérienne
scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x6b6a5c, 1.15));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.copy(SUN);
scene.add(sun);

const loadTex = (url) => new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
const [meta, bats, reliefBuf, arbresBuf, lointain] = await Promise.all([
  fetch(D + 'meta.json').then((r) => r.json()),
  fetch(D + 'batiments.json').then((r) => r.json()),
  fetch(D + 'relief.bin').then((r) => r.arrayBuffer()),
  fetch(D + 'arbres.bin').then((r) => r.arrayBuffer()),
  loadTex(D + 'lointain.jpg'),
]);
const N = meta.taille, OX = meta.ox, OZ = meta.oz, NT = meta.dalles, TS = N / NT;
// emplacements du mode multijoueur (dossier ../multijoueur)
const EMP = (await fetch(D + 'emplacements.json').then((r) => r.json())).emplacements;
// carte légèrement convexe : le centre reste en place, les bords descendent de BOMBE mètres. Les coordonnées du programme restent
// « à plat » ; la courbure est appliquée à l'affichage (tous les shaders) et à la position de l'œil.
const BOMBE = 16, BCX = OX + N / 2, BCZ = OZ + N / 2, BH = N / 2;
const bendY = (x, z) => { const u = Math.max(-1, Math.min(1, (x - BCX) / BH)), v = Math.max(-1, Math.min(1, (z - BCZ) / BH)); return -BOMBE * (1 - (1 - u * u) * (1 - v * v)); };
const BEND_GLSL = `float bendY(vec2 p){ vec2 u = clamp((p - vec2(${BCX.toFixed(1)}, ${BCZ.toFixed(1)})) / ${BH.toFixed(1)}, -1.0, 1.0); return -${BOMBE.toFixed(1)} * (1.0 - (1.0 - u.x * u.x) * (1.0 - u.y * u.y)); }\n`;
THREE.ShaderChunk.common = BEND_GLSL + THREE.ShaderChunk.common;
THREE.ShaderChunk.project_vertex = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
vec4 bendW = modelMatrix * mvPosition; bendW.y += bendY(bendW.xz);
mvPosition = viewMatrix * bendW;
gl_Position = projectionMatrix * mvPosition;
`;
const tiles = [];
for (let a = 0; a < NT; a++) for (let b = 0; b < NT; b++) tiles.push({ a, b, x0: OX + b * TS, z0: OZ + a * TS, bats: [] });
// sol dessiné en aplats d'après les couches de l'IGN (voirie, pelouses, terrains de sport, voies ferrées, ombres)
await Promise.all(tiles.map(async (t) => { t.tex = await loadTex(`${D}dessin_${t.a}${t.b}.jpg`); }));
for (const t of [lointain, ...tiles.map((t) => t.tex)]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }

// ---------- ciel ----------
{
  const g = new THREE.SphereGeometry(18000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { haze: { value: HAZE } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 haze; varying vec3 d; void main(){ float h = clamp(d.y, 0.0, 1.0); vec3 top = vec3(0.30, 0.52, 0.82); vec3 c = mix(haze, top, pow(h, 0.45)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(g, m);
  sky.renderOrder = -10;
  sky.onBeforeRender = () => sky.position.copy(camera.position);
  scene.add(sky);
}

const VOIRIE = await fetch(D + 'voirie.json').then((r) => r.json());   // rues ouvertes à la circulation près des postes
// ---------- emprises du premier plan (bassin du théâtre, canal) ----------
const BASSIN = [[22, 54.8], [40.5, 83], [40, 97], [28, 123.5], [-8.5, 130], [-38.5, 118], [-21.5, 84.5], [-12, 71.5], [1, 68.5]];
const MANEGE = [-6, 74.5, 6.5];
const CANAL = [[-200, 28], [-140, 66], [-80, 108], [-45, 132], [15, 150], [90, 170], [142, 190], [205, 217]], CANAL_W = 8.5;   // tracé : relief LiDAR et carte IGN
const nearCanal = (x, z, m) => CANAL.some((p, i) => i < CANAL.length - 1 && segDist2(x, z, p[0], p[1], CANAL[i + 1][0], CANAL[i + 1][1]) < m);
function segDist2(x, z, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - ax - t * dx, z - az - t * dz); }
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; };

// ---------- relief ----------
const relief = new Float32Array(reliefBuf);
const RN = N / meta.pas + 1;
const groundY = (x, z) => {
  const fx = Math.min(RN - 1.001, Math.max(0, (x - OX) / meta.pas)), fz = Math.min(RN - 1.001, Math.max(0, (z - OZ) / meta.pas));
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
  const h = (ii, jj) => relief[jj * RN + ii];
  return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b;
};
const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
const polyDist = (x, z, P) => Math.min(...P.map((p, i) => segDist2(x, z, p[0], p[1], P[(i + 1) % P.length][0], P[(i + 1) % P.length][1])));
const LB = median(BASSIN.map((p) => groundY(p[0], p[1])));                       // niveau de l'eau du bassin
const canalLv = CANAL.map((p) => { let m = 1e9; for (let a = -6; a <= 6; a += 3) for (let b = -6; b <= 6; b += 3) m = Math.min(m, groundY(p[0] + a, p[1] + b)); return m - 0.3; });
const canalProj = (x, z) => {                                                     // distance au canal et niveau de l'eau à cet endroit
  let best = { d: 1e9, lv: 0 };
  for (let i = 0; i < CANAL.length - 1; i++) {
    const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    if (d < best.d) best = { d, lv: canalLv[i] + (canalLv[i + 1] - canalLv[i]) * t };
  }
  return best;
};
const terrainY = (x, z) => {                                                      // relief affiché : creusé sous le bassin et le canal
  if (inPoly(x, z, BASSIN) || polyDist(x, z, BASSIN) < 9.5) return LB - 0.9;
  const c = canalProj(x, z);
  if (c.d < CANAL_W / 2 + 9.5) return c.lv - 0.8;
  return groundY(x, z);
};
const tileAt = (x, z) => tiles[Math.min(NT - 1, Math.max(0, Math.floor((z - OZ) / TS))) * NT + Math.min(NT - 1, Math.max(0, Math.floor((x - OX) / TS)))];
const hiRes = [];
// matière du sol : la dalle dessinée, avec un grain procédural qui n'apparaît que de près (herbe, enrobé)
const groundMat = (tex, fade = 0) => new THREE.ShaderMaterial({
  transparent: fade > 0, depthWrite: fade === 0, polygonOffset: fade > 0, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  uniforms: { sol: { value: tex }, haze: { value: HAZE }, fogK: { value: FOG }, fade: { value: fade } },
  vertexShader: BEND_GLSL + 'varying vec2 vUv; varying vec3 vW; varying float vDist; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); w.y += bendY(w.xz); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }',
  fragmentShader: `
    uniform sampler2D sol; uniform vec3 haze; uniform float fogK; uniform float fade; varying vec2 vUv; varying vec3 vW; varying float vDist;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      vec3 c = texture2D(sol, vUv).rgb;
      float grass = clamp((c.g - max(c.r, c.b)) * 10.0, 0.0, 1.0);
      float near = 1.0 - smoothstep(60.0, 420.0, vDist);
      float d = vn(vW.xz * 3.1) * 0.5 + vn(vW.xz * 0.9) * 0.3 + vn(vW.xz * 0.21) * 0.2;
      c *= mix(1.0, mix(0.90, 0.72, grass) + mix(0.20, 0.56, grass) * d, near);
      c = mix(c, haze, 1.0 - exp(-vDist * fogK));
      float al = fade > 0.0 ? smoothstep(0.0, fade, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y))) : 1.0;
      gl_FragColor = vec4(c, al);
      #include <colorspace_fragment>
    }`,
});
{
  const SEG = 184;
  for (const t of tiles) {
    const g = new THREE.PlaneGeometry(TS, TS, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    g.translate(t.x0 + TS / 2, 0, t.z0 + TS / 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, terrainY(p.getX(k), p.getZ(k)));
    scene.add(new THREE.Mesh(g, groundMat(t.tex)));
  }
  { // abords du bassin et quais du canal : le sol photographié est reposé à sa hauteur réelle autour des parties creusées
    const t0 = tileAt(0, 100), pos = [], uv = [], idx = [], wpos = [], widx = [];
    const v = (x, y, z) => { pos.push(x, y, z); uv.push((x - t0.x0) / TS, 1 - (z - t0.z0) / TS); return pos.length / 3 - 1; };
    const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d, a, c, b, a, d, c);
    const cx = BASSIN.reduce((m, p) => m + p[0], 0) / BASSIN.length, cz = BASSIN.reduce((m, p) => m + p[1], 0) / BASSIN.length;
    const ring = BASSIN.map((p) => { const d = Math.hypot(p[0] - cx, p[1] - cz); const q = [p[0] + ((p[0] - cx) / d) * 13, p[1] + ((p[1] - cz) / d) * 13]; return [v(p[0], LB + 0.04, p[1]), v(q[0], groundY(q[0], q[1]) + 0.03, q[1])]; });
    ring.forEach((r, i) => { const n = ring[(i + 1) % ring.length]; quad(r[0], n[0], n[1], r[1]); });
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux, n = Math.ceil(L / 6);
      for (const sd of [-1, 1]) {
        let prev = null;
        for (let k = 0; k <= n; k++) {
          const t = (k / n) * L, px = a[0] + ux * t, pz = a[1] + uz * t, lv = canalLv[i] + (canalLv[i + 1] - canalLv[i]) * (k / n);
          const ix = px + nx * sd * (CANAL_W / 2), iz = pz + nz * sd * (CANAL_W / 2), ox = px + nx * sd * (CANAL_W / 2 + 12), oz = pz + nz * sd * (CANAL_W / 2 + 12);
          if (inPoly(ix, iz, BASSIN)) { prev = null; continue; }
          const y = Math.max(groundY(ox, oz), lv + 1.2);
          const cur = [v(ix, y, iz), v(ox, groundY(ox, oz) + 0.02, oz)];
          const w = wpos.length / 3; wpos.push(ix, y, iz, ix, lv - 0.3, iz);
          if (prev) { quad(prev[0], cur[0], cur[1], prev[1]); widx.push(prev[2], w, w + 1, prev[2], w + 1, prev[2] + 1, prev[2], w + 1, w, prev[2], prev[2] + 1, w + 1); }
          prev = [...cur, w];
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    scene.add(new THREE.Mesh(g, groundMat(t0.tex)));
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); wg.setIndex(widx); wg.computeVertexNormals();
    scene.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x9a968c })));            // murs de quai
  }
  // (plus de premier plan photographié : la dalle dessinée suffit de près)
  // au-delà de la zone : photo aérienne à basse définition, à plat
  const F = meta.lointain, y = meta.altSol - 1;
  const fg = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  const quad = (xa, za, xb, zb) => {
    const o = pos.length / 3;
    for (const [x, z] of [[xa, za], [xb, za], [xb, zb], [xa, zb]]) { pos.push(x, y, z); uv.push(x / F + 0.5, 0.5 - z / F); }
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  };
  const f = F / 2, xa = OX, xb = OX + N, za = OZ, zb = OZ + N;
  quad(-f, -f, f, za); quad(-f, zb, f, f); quad(-f, za, xa, zb); quad(xb, za, f, zb);
  fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fg.setIndex(idx);
  scene.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: lointain })));
}

// ---------- plans d'eau ----------
const waterMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: 0 }, sun: { value: SUN }, haze: { value: HAZE }, fogK: { value: FOG }, eye: { value: new THREE.Vector3() } },
  vertexShader: BEND_GLSL + 'varying vec3 vW; varying float vDist; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); w.y += bendY(w.xz); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }',
  fragmentShader: `
    uniform float t; uniform vec3 sun; uniform vec3 haze; uniform float fogK; uniform vec3 eye; varying vec3 vW; varying float vDist;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float wave(vec2 p){ return vn(p * 0.55 + vec2(t * 0.35, t * 0.12)) * 0.6 + vn(p * 1.7 - vec2(t * 0.5, -t * 0.3)) * 0.3 + vn(p * 4.3 + t * 0.8) * 0.1; }
    void main(){
      float k = 1.0 - smoothstep(150.0, 1400.0, vDist);                    // les rides s'effacent au loin
      float e = 0.35;
      vec2 gxy = vec2(wave(vW.xz + vec2(e, 0.0)) - wave(vW.xz - vec2(e, 0.0)), wave(vW.xz + vec2(0.0, e)) - wave(vW.xz - vec2(0.0, e)));
      vec3 n = normalize(vec3(-gxy.x * 0.9 * k, 1.0, -gxy.y * 0.9 * k));
      vec3 v = normalize(eye - vW);
      float fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      vec3 r = reflect(-v, n);
      vec3 sky = mix(haze, vec3(0.30, 0.52, 0.82), pow(clamp(r.y, 0.0, 1.0), 0.45));
      vec3 deep = mix(vec3(0.07, 0.25, 0.36), vec3(0.11, 0.36, 0.42), wave(vW.xz * 0.2));
      vec3 c = mix(deep, sky, clamp(fr, 0.0, 0.92));
      c += vec3(1.0, 0.95, 0.85) * pow(max(dot(r, sun), 0.0), 180.0) * 1.6 * k;
      c = mix(c, haze, 1.0 - exp(-vDist * fogK));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
});
let waterArea = 0, waterCount = 0;
{
  const eau = await fetch(D + 'eau.json').then((r) => r.json());
  const pos = [], idx = [];
  for (const w of eau) {
    const contour = w.r[0].map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = w.r.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    const o = pos.length / 3;
    for (const p of w.r.flat()) pos.push(p[0], w.y + 0.3, p[1]);
    for (const t of tris) idx.push(o + t[0], o + t[2], o + t[1]);
    waterArea += w.a; waterCount++;
  }
  { // bassin au pied du théâtre (relevé sur la photo aérienne à 20 cm ; absent de la BD TOPO)
    const o = pos.length / 3, y = LB;
    const contour = BASSIN.map((p) => new THREE.Vector2(p[0], p[1]));
    for (const p of BASSIN) pos.push(p[0], y, p[1]);
    for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) idx.push(o + t[0], o + t[2], o + t[1]);
    waterCount++;
  }
  { // canal urbain (lit repéré dans le relief LiDAR) : ruban d'eau entre les quais
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = (-dz / L) * CANAL_W / 2, nz = (dx / L) * CANAL_W / 2;
      const o = pos.length / 3, ya = canalLv[i], yb = canalLv[i + 1];
      pos.push(a[0] + nx, ya, a[1] + nz, a[0] - nx, ya, a[1] - nz, b[0] - nx, yb, b[1] - nz, b[0] + nx, yb, b[1] + nz);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    waterCount++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, waterMat);
  m.frustumCulled = false;
  waterMat.side = THREE.DoubleSide;
  scene.add(m);
}

// ---------- bâtiments ----------
// Styles : 0 pierre (bureaux), 1 brique rose, 2 brique rouge, 3 blanc à balcons, 4 panneaux beiges, 5 commerce bas, 6 bardage métal,
// 7 maison, 8 béton, 9 Arcades du Lac (Bofill), 10 arche du viaduc, 11 mur-rideau vitré
const PAL = [
  [0xd8cdb8, 0xcfc4ae, 0xe0d6c4], [0xc98f7c, 0xd09a86, 0xbd8572], [0xb5563c, 0xa94e38, 0xc0624a], [0xeceae4, 0xe2e0da, 0xf2f0ea],
  [0xcdbfa8, 0xc6b7a2, 0xd6c9b6, 0xcbb3a4], [0xb9bcc0, 0xc8c5bd, 0xa9adb2], [0x9aa3ab, 0xc0c4c8, 0xaeb4b8], [0xe6dcc6, 0xded2ba, 0xeee6d4], [0xd2cec4, 0xc8c4ba],
  [0xcdb09a, 0xc9ab94, 0xd2b6a0], [0xcdb09a], [0x8e9aa4, 0x9aa6ae, 0x7f8c98],
];
const hash = (x, z, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
const labels = await fetch(D + 'styles.json').then((r) => r.json());
const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - ax - t * dx, z - az - t * dz); };
const VIADUC = [130, 1732, 232, 1797];
// lieux emblématiques : [x, z, rayon, style, couleur ou null, hauteur minimale]
const ZONES = [
  [64, 1688, 185, 9, null, 6],          // Arcades du Lac
  [0, 0, 62, 8, 0xdcd6c8, 6],           // théâtre et médiathèque : béton clair
  [42, -84, 78, 3, 0xf0eee8, 12],       // hôtel en arc de la place Georges-Pompidou : façade blanche (photo libre)
  [-520, -515, 95, 6, 0xb46a35, 5],     // vélodrome : bardage cuivré
  [-75, -78, 70, 11, 0x8a96a0, 8],      // Sky Ouest
  [-190, 2150, 260, 3, 0xe9e7e1, 7],    // quartier neuf autour du centre aquatique : enduit blanc
  [80, 2190, 200, 3, 0xcfc8ba, 7],      // idem, enduit gris-beige
  [-400, 350, 240, 4, 0xcdb5a6, 12],    // plots des Prés : panneaux beige rosé
];
for (const [nom, R, sty, col, hmin] of FACADES) { const e = EMP.find((q) => q.nom === nom); if (e) ZONES.unshift([e.x, e.z, R, sty, col, hmin]); }
const heur = (b) => {
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
const styleStats = { photo: 0, voisin: 0, lieu: 0, regle: 0 };
const styleOf = (b) => {
  const h = b.r - b.b;
  if (segDist(b.x, b.z, ...VIADUC) < 26 && h > 8) { styleStats.lieu++; return [9, null]; }
  for (const [x, z, R, s, c, hmin] of ZONES) if (h >= hmin && Math.hypot(b.x - x, b.z - z) < R) { styleStats.lieu++; return [s, c]; }
  let best = null, bd = 1e9;
  for (const l of labels) {
    const d = Math.hypot(b.x - l.x, b.z - l.z);
    if (d < bd && (d < 14 || (d < 230 && Math.abs(h - l.h) < 8 && (l.s === 7) === (h < 8)))) { bd = d; best = l; }
  }
  if (best && (b.u !== 'Spo' && b.u !== 'Rel')) {
    if (bd < 14) styleStats.photo++; else styleStats.voisin++;
    if (bd >= 14 && (b.u === 'Com') !== (best.s === 11 || best.s === 0 || best.s === 5)) { styleStats.voisin--; styleStats.regle++; return [heur(b), null]; }
    return [best.s, best.c];
  }
  styleStats.regle++;
  return [heur(b), null];
};
const POSTS_XZ = [[-40.5, 36.5], [314.5, 230.5], [-359.5, 357.5], ...meta.grues.map((c) => [c.x, c.z]), ...EMP.map((e) => [e.x, e.z])];
let wallTris = 0, roofTris = 0;
{ // centre aquatique : toiture en voûte relevée au LiDAR (maillage au mètre) à la place des volumes en gradins
  const buf = await fetch(D + 'dome_piscine.bin').then((r) => r.arrayBuffer());
  for (const b of bats) if (Math.hypot(b.x + 197, b.z - 2124) < 55 && b.a > 300) { b.k = []; b.r = Math.min(b.r, b.b + 3.5); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf), 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xdcdcd6, side: THREE.DoubleSide })));
}
for (const b of bats) {
  const ti = Math.min(NT - 1, Math.max(0, Math.floor((b.z - OZ) / TS))) * NT + Math.min(NT - 1, Math.max(0, Math.floor((b.x - OX) / TS)));
  tiles[ti].bats.push(b);
}
const FACADE_FRAG = `
  uniform sampler2D sol; uniform vec3 sun; uniform vec3 haze; uniform float fogK; uniform float size; uniform vec2 org;
  varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying float vSty; varying float vDist; varying vec2 vDim;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float box(float a, float b, float x){ return step(a, x) * step(x, b); }
  void main(){
    vec3 c;
    if (vSty < -0.5) {
      c = texture2D(sol, clamp(vec2((vW.x - org.x) / size, 1.0 - (vW.z - org.y) / size), 0.001, 0.999)).rgb;
      float lr = dot(c, vec3(0.33));                                    // toits : teintes calmées, ombres de la photo adoucies
      c = mix(vec3(lr), c, 0.45) * vec3(1.02, 1.0, 0.97);
      c = mix(c, vec3(0.56, 0.55, 0.53), 0.45 * (1.0 - smoothstep(0.10, 0.42, lr)));
      float nr = 1.0 - smoothstep(40.0, 320.0, vDist);                  // de près : gravillon et lés d'étanchéité
      c *= mix(1.0, 0.86 + 0.20 * vn(vW.xz * 6.0) + 0.08 * vn(vW.xz * 0.7) - 0.05 * step(0.96, fract(vW.x * 0.5 + vW.z * 0.13)), nr);
    } else {
      int s = int(vSty + 0.5);
      float L = vDim.x, Ht = vDim.y, v = vUv.y;
      // paramètres : hauteur d'étage, travée, marge latérale de la baie, allège, linteau, part de travées à balcon, vitrine au rez-de-chaussée
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
        // Arcades du Lac : pilastres en carreaux de terre cuite, travées à balcons à balustres, baies étroites, attique au-dessus d'une corniche
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
        if (s == 10) {                                                                        // grande arche entre deux tours du viaduc
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
    float f = 1.0 - exp(-vDist * fogK);
    gl_FragColor = vec4(mix(c, haze, f), 1.0);
    #include <colorspace_fragment>
  }`;
for (const tile of tiles) {
  const list = tile.bats;
  if (!list.length) continue;
  const pos = [], nrm = [], uv = [], col = [], sty = [], dim = [], idx = [];
  const c = new THREE.Color();
  const vert = (x, y, z, nx, ny, nz, u, v, s, L, H) => { pos.push(x, y, z); nrm.push(nx, ny, nz); uv.push(u, v); col.push(c.r, c.g, c.b); sty.push(s); dim.push(L, H); return pos.length / 3 - 1; };
  const wall = (ax, az, bx, bz, y0, y1, nx, nz, s, vb, u0 = 0) => {
    const L = Math.hypot(bx - ax, bz - az), H = y1 - vb;
    const a = vert(ax, y0, az, nx, 0, nz, u0, y0 - vb, s, L, H), b = vert(bx, y0, bz, nx, 0, nz, u0 + L, y0 - vb, s, L, H);
    const d = vert(ax, y1, az, nx, 0, nz, u0, y1 - vb, s, L, H), e = vert(bx, y1, bz, nx, 0, nz, u0 + L, y1 - vb, s, L, H);
    idx.push(a, b, e, a, e, d); wallTris += 2;
  };
  const flat = (pts, y, tris) => { const o = pos.length / 3; for (const p of pts) vert(p[0], y, p[1], 0, 1, 0, 0, 0, -1, 0, 0); for (const t of tris) { idx.push(o + t[0], o + t[2], o + t[1]); roofTris++; } };
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
      const contour = rings[0].map((p) => new THREE.Vector2(p[0], p[1]));
      const holes = rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
      flat(rings.flat(), y1, THREE.ShapeUtils.triangulateShape(contour, holes));
      if (s !== 7 && s !== 10 && y1 - b.b > 7 && POSTS_XZ.some((q) => Math.hypot(b.x - q[0], b.z - q[1]) < 260)) {   // acrotère : relevé de 55 cm au bord du toit
        const ring = rings[0];
        for (let i = 0; i < ring.length; i++) {
          const a2 = ring[i], b2 = ring[(i + 1) % ring.length], dx = b2[0] - a2[0], dz = b2[1] - a2[1], L2 = Math.hypot(dx, dz);
          if (L2 < 0.3) continue;
          wall(a2[0], a2[1], b2[0], b2[1], y1, y1 + 0.55, dz / L2, -dx / L2, s, b.b - 0.55);
        }
      }
    }
    for (const k of b.k) {
      const [X, Z, w, d, th, top] = k, ct = Math.cos(th), st = Math.sin(th), hw = w / 2, hd = d / 2;
      const cs = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, e]) => [X + a * ct - e * st, Z + a * st + e * ct]);
      for (let i = 0; i < 4; i++) {
        const p = cs[i], q = cs[(i + 1) % 4], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
        wall(p[0], p[1], q[0], q[1], y1 - 0.3, top, dz / L, -dx / L, s, b.b);
      }
      flat(cs, top, [[0, 1, 2], [0, 2, 3]]);
    }
  }
  // viaduc des Arcades : mur à grandes arches reliant les tours
  if (VIADUC[0] >= tile.x0 && VIADUC[0] < tile.x0 + TS && VIADUC[1] >= tile.z0 && VIADUC[1] < tile.z0 + TS) {
    const towers = bats.filter((b) => segDist(b.x, b.z, ...VIADUC) < 26 && b.r - b.b > 8 && b.a > 60).sort((p, q) => p.x - q.x);
    if (towers.length >= 2) {
      const a = towers[0], z = towers[towers.length - 1], n = towers.length - 1;
      const L = Math.hypot(z.x - a.x, z.z - a.z), dx = (z.x - a.x) / L, dz = (z.z - a.z) / L, base = Math.min(...towers.map((t) => t.b)), top = towers.reduce((m, t) => m + t.r, 0) / towers.length;
      c.setHex(0xcdb09a);
      const P = L / n;
      for (const off of [-3.2, 3.2]) {
        const ax = a.x - dz * off, az = a.z + dx * off;
        const o = pos.length / 3, H = top - base;
        // la période des arches est fixée à 20,6 m dans le rendu : on règle l'échelle de u pour qu'elle tombe entre les tours
        const k = 20.6 / P;
        for (const [t, y] of [[0, base - 1], [L, base - 1], [0, top], [L, top]]) vert(ax + dx * t, y, az + dz * t, -dz * Math.sign(off), 0, dx * Math.sign(off), t * k, y - base, 10, L * k, H);
        idx.push(o, o + 1, o + 3, o, o + 3, o + 2); wallTris += 2;
      }
      window.__viaduc = { tours: towers.length, pas: P, haut: top - base };
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSty', new THREE.Float32BufferAttribute(sty, 1));
  g.setAttribute('aDim', new THREE.Float32BufferAttribute(dim, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { sol: { value: tile.tex }, sun: { value: SUN }, haze: { value: HAZE }, fogK: { value: FOG }, size: { value: TS }, org: { value: new THREE.Vector2(tile.x0, tile.z0) } },
    vertexShader: BEND_GLSL + `
      attribute vec3 aCol; attribute float aSty; attribute vec2 aDim;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying float vSty; varying float vDist; varying vec2 vDim;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0); w.y += bendY(w.xz); vW = w.xyz; vN = normal; vUv = uv; vCol = aCol; vSty = aSty; vDim = aDim;
        vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: FACADE_FRAG,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
}

// ---------- arbres ----------
const trees = new Float32Array(arbresBuf);
const nTrees = trees.length / 8;
let treesDropped = 0;
{
  // houppier irrégulier, plus sombre en dessous ; tronc pour les arbres proches des postes
  const crown = (detail) => {
    const g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
    const p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.80 + 0.40 * hash(Math.round(x * 50), Math.round(z * 50), Math.round(y * 50));
      const yy = y < 0 ? y * 0.72 : y;
      p.setXYZ(i, x * k, yy * (0.9 + 0.2 * k), z * k);
      const sh = 0.50 + 0.50 * Math.min(1, Math.max(0, (y + 0.9) / 1.6));
      col.push(sh, sh, sh);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    // normales lissées : moyenne par position, pour éviter l'effet « boule à facettes »
    const acc = new Map(), n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; const a = acc.get(key) ?? [0, 0, 0]; a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(key, a); }
    for (let i = 0; i < p.count; i++) { const a = acc.get(`${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`); const l = Math.hypot(a[0], a[1], a[2]) || 1; n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
    return g;
  };
  const posts = [...Object.values(meta.postes).map((p) => [p[0], p[2]]), ...meta.grues.map((c) => [c.x, c.z])];
  const nearIdx = [], farIdx = [];
  for (let i = 0; i < nTrees; i++) { const x = trees[i * 8], z = trees[i * 8 + 2];
    const r = trees[i * 8 + 4], g = trees[i * 8 + 5], b = trees[i * 8 + 6];
    if (((r + g + b) / 3 > 0.42 && !(g > r && g > b)) || (r > g * 1.25 && r > 0.35) || inPoly(x, z, BASSIN) || Math.hypot(x - MANEGE[0], z - MANEGE[1]) < MANEGE[2] + 3 || nearCanal(x, z, CANAL_W / 2 + 0.5)) { treesDropped++; continue; }
    if (EMP.some((e) => Math.hypot(x - e.x, z - e.z) < (e.type === 'arbre' ? 7 : 16) + trees[i * 8 + 3] * 0.3 && trees[i * 8 + 1] + trees[i * 8 + 3] > e.y - 5)) { treesDropped++; continue; }
    (posts.some((p) => Math.hypot(x - p[0], z - p[1]) < 650) || EMP.some((e) => Math.hypot(x - e.x, z - e.z) < 230) ? nearIdx : farIdx).push(i); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), c = new THREE.Color();
  const greens = [new THREE.Color(0x4c6b34), new THREE.Color(0x5f7d3a), new THREE.Color(0x3f5f33), new THREE.Color(0x6b8540)];
  const trunk = new THREE.CylinderGeometry(0.5, 0.7, 1, 6, 1, true).translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x4a3c30 }), nearIdx.length);
  for (const [list, detail] of [[nearIdx, 1], [farIdx, 0]]) {
    const im = new THREE.InstancedMesh(crown(detail), new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    list.forEach((i, n) => {
      const x = trees[i * 8], y = trees[i * 8 + 1], z = trees[i * 8 + 2], h = trees[i * 8 + 3];
      const r = Math.max(1.8, h * (0.27 + 0.10 * hash(x, z)));
      const ch = Math.min(h * 0.58, r * 1.55);
      t.set(x, y + h - ch * 0.95, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash(x, z, 3) * 6.28);
      s.set(r, ch, r);
      im.setMatrixAt(n, m.compose(t, q, s));
      c.setRGB(trees[i * 8 + 4], trees[i * 8 + 5], trees[i * 8 + 6], THREE.SRGBColorSpace).lerp(greens[Math.floor(hash(x, z, 9) * 4)], 0.6).multiplyScalar(0.95 + 0.35 * hash(x, z, 5));
      im.setColorAt(n, c);
      if (detail === 1) { t.set(x, y - 0.3, z); s.set(0.16 + h * 0.012, Math.max(1, h - ch * 1.6), 0.16 + h * 0.012); trunks.setMatrixAt(n, m.compose(t, q, s)); }
    });
    im.frustumCulled = false;
    scene.add(im);
  }
  trunks.frustumCulled = false;
  scene.add(trunks);
}

// ---------- horizon et tour Eiffel ----------
const post = meta.postes.eiffel;
{
  const R = 8500, top = post[1] + meta.eiffel.angleHorizon * R, hgt = 70;
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 64;
  const x = cv.getContext('2d');
  x.fillStyle = '#8fa39d'; x.fillRect(0, 12, 2048, 52);
  for (let i = 0; i < 2048; i += 2) { const h = 4 + 8 * hash(i, 1) * hash(Math.floor(i / 24), 2); x.fillRect(i, 12 - h, 2, h + 1); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 6;
  const g = new THREE.CylinderGeometry(R, R, hgt, 96, 1, true);
  const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.BackSide, fog: false }));
  ring.position.y = top - hgt / 2 + hgt * (12 / 64);
  scene.add(ring);

  const Dt = 9000, k = Dt / meta.eiffel.distance, H = 330 * k, W = 125 * k;
  const c2 = document.createElement('canvas'); c2.width = 256; c2.height = 640;
  const y = c2.getContext('2d');
  y.fillStyle = 'rgba(96,108,122,0.92)';
  const half = (v) => { const t = v / 640; return 4 + 124 * Math.pow(t, 2.6) + 10 * t; };   // profil évasé
  y.beginPath(); y.moveTo(128, 0);
  for (let v = 0; v <= 640; v += 8) y.lineTo(128 + half(v), v);
  for (let v = 640; v >= 0; v -= 8) y.lineTo(128 - half(v), v);
  y.closePath(); y.fill();
  y.globalCompositeOperation = 'destination-out';
  y.beginPath(); y.ellipse(128, 640, 70, 150, 0, Math.PI, 0); y.fill();                    // arche entre les piliers
  y.globalCompositeOperation = 'source-over';
  for (const [v, w, t] of [[530, 96, 9], [410, 52, 8], [150, 16, 7]]) y.fillRect(128 - w, v, 2 * w, t); // trois étages
  y.fillRect(126, 0, 4, 40);                                                                // antenne
  const tt = new THREE.CanvasTexture(c2); tt.colorSpace = THREE.SRGBColorSpace;
  const tour = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tt, transparent: true, fog: false, depthWrite: false }));
  const az = (meta.eiffel.azimut * Math.PI) / 180;
  tour.position.set(Math.sin(az) * Dt + post[0], post[1] + meta.eiffel.angleSommet * Dt - H / 2, -Math.cos(az) * Dt + post[2]);
  tour.rotation.y = -az;
  tour.renderOrder = -5;
  ring.renderOrder = -4;
  scene.add(tour);
}

// ---------- manège et passerelle du bassin du théâtre ----------
{
  const y0 = LB, L = (c) => new THREE.MeshLambertMaterial({ color: c });
  const g = new THREE.Group();
  const [mx, mz, mr] = MANEGE;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.CylinderGeometry(mr + 0.6, mr + 0.8, 0.7, 28), L(0xb9b4a8), mx, y0 + 0.2, mz);                 // socle
  add(new THREE.CylinderGeometry(mr, mr, 0.25, 28), L(0x7a4a32), mx, y0 + 0.7, mz);                           // plancher
  add(new THREE.CylinderGeometry(1.1, 1.1, 4.0, 14), L(0xd9c9a0), mx, y0 + 2.8, mz);                          // fût central
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 5), L(0xd8b24a), mx + Math.cos(a) * (mr - 0.5), y0 + 2.6, mz + Math.sin(a) * (mr - 0.5)); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3, r = mr - 2 - (i % 2) * 1.4; add(new THREE.BoxGeometry(1.3, 0.9, 0.35), L([0xf1ece2, 0x8a5a3a, 0x2f2f33][i % 3]), mx + Math.cos(a) * r, y0 + 1.6 + (i % 2) * 0.3, mz + Math.sin(a) * r).rotation.y = -a + Math.PI / 2; }
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 8;
  const x = cv.getContext('2d');
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#f3ead8' : '#8c4a36'; x.fillRect(i * 32, 0, 32, 8); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.ConeGeometry(mr + 0.9, 2.6, 32, 1, true), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), mx, y0 + 5.9, mz);   // chapiteau rayé
  add(new THREE.CylinderGeometry(mr + 0.9, mr + 0.9, 0.5, 32, 1, true), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), mx, y0 + 4.5, mz);
  add(new THREE.SphereGeometry(0.35, 8, 6), L(0xd8b24a), mx, y0 + 7.4, mz);
  // passerelle : du manège vers l'est, au-dessus de l'eau
  const A = new THREE.Vector3(1, 0, 79), B = new THREE.Vector3(39, 0, 84.5), d = new THREE.Vector3().subVectors(B, A), len = d.length(), ang = Math.atan2(d.z, d.x);
  const span = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 2.8), L(0xa39a8c)); deck.position.y = 1.0; span.add(deck);
  for (const s of [-1.35, 1.35]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), L(0x4c5257)); rail.position.set(0, 2.1, s); span.add(rail);
    for (let i = 0; i <= 16; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), L(0x4c5257)); p.position.set(-len / 2 + (i / 16) * len, 1.6, s); span.add(p); }
  }
  for (let i = 1; i < 5; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 2.2), L(0x8f887c)); p.position.set(-len / 2 + (i / 5) * len, 0.2, 0); span.add(p); }
  span.position.set((A.x + B.x) / 2, y0, (A.z + B.z) / 2);
  span.rotation.y = -ang;
  g.add(span);
  // jardinières fleuries posées dans le bassin (taches sombres sur la photo aérienne)
  const fleurs = [0xc2417a, 0xe0b23a, 0x8a4fb0, 0xd9d2e8, 0xc9482f];
  let nf = 0;
  for (const [jx, jz] of [[10, 68], [20, 66], [21, 75], [9.5, 76], [31, 74], [-5, 89.5], [-4.5, 95], [1, 88], [-18.5, 102], [-8, 104], [-5, 106], [4.5, 106], [-12, 110], [7, 114], [8, 117], [12, 121.5], [21, 120], [27.5, 88], [32.5, 88.5]]) {
    if (!inPoly(jx, jz, BASSIN)) continue;
    add(new THREE.CylinderGeometry(0.9, 1.0, 0.5, 10), L(0x4a4f48), jx, y0 + 0.2, jz);
    add(new THREE.ConeGeometry(0.85, 1.3, 9), L(0x3f6a38), jx, y0 + 1.05, jz);
    add(new THREE.SphereGeometry(0.55, 8, 6), L(fleurs[nf++ % fleurs.length]), jx, y0 + 0.75, jz).scale.set(1.5, 0.6, 1.5);
  }
  // margelle du bassin
  for (let i = 0; i < BASSIN.length; i++) {
    const a = BASSIN[i], b = BASSIN[(i + 1) % BASSIN.length], dx = b[0] - a[0], dz = b[1] - a[1], len2 = Math.hypot(dx, dz);
    const m = add(new THREE.BoxGeometry(len2, 0.45, 0.5), L(0xb7b1a5), (a[0] + b[0]) / 2, y0 + 0.1, (a[1] + b[1]) / 2); m.rotation.y = -Math.atan2(dz, dx);
  }
  // terrasse de restaurant au nord-est du bassin : parasols rouges, tables
  for (let i = 0; i < 7; i++) {
    const px = 31 + (i % 2) * 5.2 + Math.floor(i / 2) * 2.6, pz = 60.5 + Math.floor(i / 2) * 4.6, py = groundY(px, pz);
    add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), L(0x55585a), px, py + 1.3, pz);
    const top = add(new THREE.ConeGeometry(2.6, 1.0, 4), L(0xc0271f), px, py + 3.0, pz); top.rotation.y = Math.PI / 4 + 0.5;
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 10), L(0x8a8d90), px + 0.9, py + 0.75, pz + 0.4);
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 10), L(0x8a8d90), px - 0.9, py + 0.75, pz - 0.5);
  }
  // canal : il passe SOUS les rues ouvertes à la circulation (pont routier à chaque croisement) ;
  // parapets de quai, bacs plantés et passerelles piétonnes en bois seulement en dehors de ces croisements
  const bois = L(0xb08a5e), beton = L(0xaaa69c), enrobe = L(0x46484d), trottoir = L(0xa6a39c);
  const cross = [];
  for (const r of VOIRIE) {
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
  const underRoad = (x, z, extra = 0) => cross.some((c) => Math.hypot(x - c.x, z - c.z) < c.half + extra);
  for (const c of cross) {                                       // pont routier : chaussée, trottoirs, garde-corps
    const y = Math.max(groundY(c.x + c.ux * c.len / 2, c.z + c.uz * c.len / 2), groundY(c.x - c.ux * c.len / 2, c.z - c.uz * c.len / 2), canalProj(c.x, c.z).lv + 1.6);
    const br = new THREE.Group();
    const dk = new THREE.Mesh(new THREE.BoxGeometry(c.len, 0.7, c.w), enrobe); dk.position.y = -0.33; br.add(dk);
    for (const s of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(c.len, 0.82, 1.7), trottoir); tr.position.set(0, -0.3, s * (c.w / 2 + 0.85)); br.add(tr);
      const gc = new THREE.Mesh(new THREE.BoxGeometry(c.len * 0.5, 1.0, 0.22), beton); gc.position.set(0, 0.6, s * (c.w / 2 + 1.75)); br.add(gc);
    }
    br.position.set(c.x, y + 0.04, c.z); br.rotation.y = -Math.atan2(c.uz, c.ux); g.add(br);
  }
  let along = 0;
  for (let i = 0; i < CANAL.length - 1; i++) {
    const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len2 = Math.hypot(dx, dz), ux = dx / len2, uz = dz / len2, nx = -uz, nz = ux, rot = -Math.atan2(dz, dx);
    const n = Math.ceil(len2 / 4), step = len2 / n;
    for (let k = 0; k < n; k++) {                                  // parapets de quai par tronçons de 4 m, interrompus sous les ponts
      const t = (k + 0.5) * step, mx = a[0] + ux * t, mz = a[1] + uz * t;
      if (underRoad(mx, mz, 3)) continue;
      for (const s of [-1, 1]) {
        const cx = mx + nx * s * (CANAL_W / 2 + 0.2), cz = mz + nz * s * (CANAL_W / 2 + 0.2);
        if (inPoly(cx, cz, BASSIN)) continue;
        const m = add(new THREE.BoxGeometry(step + 0.05, 1.0, 0.4), beton, cx, Math.max(groundY(cx + nx * s * 12, cz + nz * s * 12), canalProj(mx, mz).lv + 1.2) + 0.45, cz); m.rotation.y = rot;
      }
    }
    for (let t = 4; t < len2 - 2; t += 6.5) {
      const side = (Math.round((along + t) / 6.5) % 2 ? 1 : -1) * 2.1, px = a[0] + ux * t + nx * side, pz = a[1] + uz * t + nz * side, py = canalProj(px, pz).lv;
      if (underRoad(px, pz, 2)) continue;
      const bx = add(new THREE.BoxGeometry(1.9, 0.9, 1.9), bois, px, py + 0.4, pz); bx.rotation.y = rot;
      add(new THREE.IcosahedronGeometry(1.15, 1), L([0x3f6a38, 0x55773a, 0x6a4a3a][Math.round(along + t) % 3]), px, py + 1.7, pz).scale.y = 1.25;
    }
    along += len2;
  }
  // passerelles piétonnes en bois, aux emplacements de la carte IGN (jamais sur une chaussée)
  for (const [bxp, bzp] of [[-144, 62], [-40, 126], [56, 158], [92, 171], [118, 181]]) {
    let best = null;
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((bxp - a[0]) * dx + (bzp - a[1]) * dz) / (dx * dx + dz * dz)));
      const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(bxp - px, bzp - pz);
      if (!best || d < best.d) best = { d, px, pz, rot: -Math.atan2(dz, dx), nx: -dz / Math.hypot(dx, dz), nz: dx / Math.hypot(dx, dz) };
    }
    if (!best || underRoad(best.px, best.pz, 8) || inPoly(best.px, best.pz, BASSIN)) continue;
    const { px, pz, rot, nx, nz } = best, py = Math.max(groundY(px + nx * (CANAL_W / 2 + 12), pz + nz * (CANAL_W / 2 + 12)), canalProj(px, pz).lv + 1.2) - 1.15;
    const br = new THREE.Group();
    const dk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, CANAL_W + 3), bois); dk.position.y = 1.15; br.add(dk);
    for (const s of [-1.55, 1.55]) {
      for (const h of [1.7, 2.2]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, CANAL_W + 3), bois); r.position.set(s, h, 0); br.add(r); }
      for (let k = -3; k <= 3; k++) { const q = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), bois); q.position.set(s, 1.7, (k * (CANAL_W + 2.6)) / 6); br.add(q); }
    }
    br.position.set(px, py, pz); br.rotation.y = rot; g.add(br);
  }
  window.__canal = { croisements: cross.map((c) => [Math.round(c.x), Math.round(c.z), c.w]) };
  { // portique du théâtre : poutre percée d'oculi portée par deux pylônes, arc métallique dessous (relevé LiDAR : 38 m, sommet à 24,6 m)
    const A = new THREE.Vector3(16, 0, -33), B = new THREE.Vector3(39, 0, -3), d = new THREE.Vector3().subVectors(B, A), len = d.length(), ang = Math.atan2(d.z, d.x);
    const gy = groundY(27, -18), top = gy + 24.6;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 64;
    const x = cv.getContext('2d'); x.fillStyle = '#d9d5ca'; x.fillRect(0, 0, 1024, 64); x.strokeStyle = '#bdb8ac'; x.lineWidth = 2;
    for (let i = 0; i < 16; i++) { x.strokeRect(i * 64, 0, 64, 64); x.fillStyle = '#2a2d30'; x.beginPath(); x.arc(i * 64 + 32, 32, 13, 0, 7); x.fill(); x.fillStyle = '#d9d5ca'; }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const pg = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(len + 3, 3.2, 1.5), [L(0xd9d5ca), L(0xd9d5ca), L(0xcfcabd), L(0xb9b4a8), new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex })]);
    beam.position.y = top - 1.6; pg.add(beam);
    for (const s of [-1, 1]) {
      const py = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.6, 24.6 - 3.2, 4), L(0xd3cec2)); py.rotation.y = Math.PI / 4; py.position.set(s * (len / 2), (24.6 - 3.2) / 2 - 24.6 + 24.6, 0); py.position.y = gy + (24.6 - 3.2) / 2 - gy; pg.add(py);
      for (const h of [top + 0.5]) { const r = new THREE.Mesh(new THREE.BoxGeometry(len + 3, 0.06, 0.06), L(0x4c5257)); r.position.set(0, h - gy + 0.6, s * 0.7); pg.add(r); }
    }
    const arc = new THREE.Mesh(new THREE.TorusGeometry(len / 2 - 2.6, 0.22, 6, 40, Math.PI), L(0xe8e6e0)); arc.position.set(0, 2.5, -1.6); pg.add(arc);
    pg.position.set((A.x + B.x) / 2, gy, (A.z + B.z) / 2); pg.rotation.y = -ang;
    beam.position.y = 24.6 - 1.6;
    g.add(pg);
    // fontaine de la place Georges-Pompidou : vasque annulaire en pierre, bassin central surélevé, couronne de jets
    const fx = 32, fz = -86, fy = groundY(fx, fz);
    add(new THREE.CylinderGeometry(11.5, 12, 0.7, 40), L(0xb5b0a4), fx, fy + 0.3, fz);
    const w1 = add(new THREE.CylinderGeometry(10.6, 10.6, 0.1, 40), waterMat, fx, fy + 0.68, fz); w1.renderOrder = 3;
    add(new THREE.CylinderGeometry(5.2, 5.6, 1.5, 32), L(0xaaa59a), fx, fy + 0.9, fz);
    const w2 = add(new THREE.CylinderGeometry(4.6, 4.6, 0.1, 32), waterMat, fx, fy + 1.68, fz); w2.renderOrder = 3;
    const jet = new THREE.MeshBasicMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; const j = add(new THREE.TorusGeometry(2.3, 0.05, 4, 10, Math.PI), jet, fx + Math.cos(a) * 7.9, fy + 0.7, fz + Math.sin(a) * 7.9); j.rotation.y = -a; }
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.2; add(new THREE.CylinderGeometry(0.14, 0.16, 0.9, 6), L(0x8f8a80), fx + Math.cos(a) * 14.5, fy + 0.45, fz + Math.sin(a) * 14.5); }
    meta.reperes['Fontaine, place Georges-Pompidou'] = [fx, fz, fy + 2];
    meta.reperes['Portique du théâtre'] = [27.5, -18, top - 2];
  }
  scene.add(g);
  meta.reperes['Manège et bassin du théâtre'] = [mx, mz, y0 + 3];
}

// ---------- mobilier de rue près des postes : lampadaires, voitures en stationnement ----------
let nLamps = 0, nCars = 0;
{
  const voirie = VOIRIE;
  const lamps = [], cars = [];
  const okSpot = (x, z) => POSTS_XZ.some((q) => Math.hypot(x - q[0], z - q[1]) < 300) && !inPoly(x, z, BASSIN) && !nearCanal(x, z, CANAL_W / 2 + 1.5);
  voirie.forEach((r, ri) => {
    let acc = (ri * 7.3) % 20;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.5) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux, rot = Math.atan2(-uz, ux);
      for (let t = (28 - (acc % 28)) % 28; t < L; t += 28) {
        const side = Math.round((acc + t) / 28) % 2 ? 1 : -1, x = a[0] + ux * t + nx * side * (r.w / 2 + 1.3), z = a[1] + uz * t + nz * side * (r.w / 2 + 1.3);
        if (okSpot(x, z)) lamps.push([x, z, rot + (side > 0 ? Math.PI : 0)]);
      }
      if (r.n.startsWith('Route à 1') && r.i >= 5 && r.w >= 4.5) {
        for (let t = (6.4 - (acc % 6.4)) % 6.4 + 3; t < L - 3; t += 6.4) {
          const h = hash(Math.round(a[0] + ux * t), Math.round(a[1] + uz * t), 4);
          if (h > 0.42) continue;
          const side = r.s === 'Double sens' ? (h > 0.21 ? 1 : -1) : 1, x = a[0] + ux * t + nx * side * (r.w / 2 + 0.25), z = a[1] + uz * t + nz * side * (r.w / 2 + 0.25);
          if (okSpot(x, z)) cars.push([x, z, rot, h]);
        }
      }
      acc += L;
    }
  });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), t = new THREE.Vector3(), c = new THREE.Color();
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 8, 6).translate(0, 4, 0);
  const head = new THREE.BoxGeometry(1.5, 0.12, 0.3).translate(0.7, 8.0, 0);
  const pm = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x5c6166 }), lamps.length), hm = new THREE.InstancedMesh(head, new THREE.MeshLambertMaterial({ color: 0x3d4145 }), lamps.length);
  lamps.forEach(([x, z, rot], i) => { t.set(x, groundY(x, z), z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot + Math.PI / 2); m.compose(t, q, s); pm.setMatrixAt(i, m); hm.setMatrixAt(i, m); });
  const body = new THREE.BoxGeometry(4.2, 0.72, 1.76).translate(0, 0.62, 0), cab = new THREE.BoxGeometry(2.3, 0.56, 1.6).translate(-0.15, 1.24, 0), wheels = new THREE.BoxGeometry(2.9, 0.5, 1.82).translate(0, 0.25, 0);
  const bm = new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial(), cars.length), cm = new THREE.InstancedMesh(cab, new THREE.MeshLambertMaterial({ color: 0x1c2228 }), cars.length), wm = new THREE.InstancedMesh(wheels, new THREE.MeshLambertMaterial({ color: 0x17181a }), cars.length);
  const paint = [0xd8d9db, 0x2a2c30, 0x7d8388, 0xf0efec, 0x1f3552, 0x8a1f1f, 0x4a4d52, 0xb9b3a4];
  cars.forEach(([x, z, rot, h], i) => { t.set(x, groundY(x, z) + 0.03, z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot + (h * 97 % 1 > 0.5 ? Math.PI : 0)); m.compose(t, q, s); bm.setMatrixAt(i, m); cm.setMatrixAt(i, m); wm.setMatrixAt(i, m); bm.setColorAt(i, c.setHex(paint[Math.floor(h * 191) % paint.length])); });
  for (const im of [pm, hm, bm, cm, wm]) { im.frustumCulled = false; scene.add(im); }
  nLamps = lamps.length; nCars = cars.length;
}

// ---------- grues à tour (postes en cabine) ----------
const CRANE_H = 46;
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  x.strokeStyle = '#e2b021'; x.lineWidth = 7; x.strokeRect(3, 3, 58, 58);
  x.lineWidth = 5; x.beginPath(); x.moveTo(4, 4); x.lineTo(60, 60); x.moveTo(60, 4); x.lineTo(4, 60); x.stroke();
  const lattice = (ru, rv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ru, rv); t.anisotropy = 8; return new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }); };
  const solid = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (g, w, h, d, mat, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(px, py, pz); g.add(m); return m; };
  const rod = (g, a, b, r = 0.07) => { const d = new THREE.Vector3().subVectors(b, a); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 5), solid(0x3a3a3a)); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d.normalize()); g.add(m); };
  for (const e of EMP) if (e.type === 'grue') {         // grues des emplacements : on reprend celles déjà posées, on ajoute les autres
    const c = meta.grues.find((q) => Math.hypot(q.x - e.x, q.z - e.z) < 15);
    if (c) c.nom = e.nom; else meta.grues.push({ nom: e.nom, x: e.x + 24, z: e.z + 10, sol: groundY(e.x + 24, e.z + 10), cap: 200 });
  }
  for (const c of meta.grues) {
    const g = new THREE.Group(), H = CRANE_H;
    box(g, 6, 1.4, 6, solid(0xb8b4aa), 0, 0.5, 0);
    box(g, 2, H, 2, lattice(1, H / 2), 0, H / 2 + 1, 0);
    box(g, 2.8, 1.6, 2.8, solid(0xd9a514), 0, H + 1.4, 0);
    box(g, 1.7, 2.1, 2.0, solid(0xe9e6de), 1.3, H + 0.6, 2.3);          // cabine
    box(g, 1.75, 0.9, 2.05, solid(0x1d2a33), 1.3, H + 1.0, 2.3);         // vitrage
    box(g, 56, 1.5, 1.3, lattice(37, 1), 29, H + 3, 0);                  // flèche
    box(g, 17, 1.2, 1.3, lattice(14, 1), -9.5, H + 3, 0);                // contre-flèche
    box(g, 4.5, 2.6, 1.8, solid(0x9c9a94), -15.5, H + 1.3, 0);           // contrepoids
    box(g, 1.3, 8, 1.3, lattice(1, 6), 0, H + 7.5, 0);                   // porte-flèche
    rod(g, new THREE.Vector3(0, H + 11.4, 0), new THREE.Vector3(34, H + 3.7, 0));
    rod(g, new THREE.Vector3(0, H + 11.4, 0), new THREE.Vector3(-17, H + 3.6, 0));
    rod(g, new THREE.Vector3(40, H + 2.2, 0), new THREE.Vector3(40, H - 14, 0)); // câble de levage
    box(g, 0.8, 1.0, 0.8, solid(0x2b2b2b), 40, H - 14.5, 0);
    g.position.set(c.x, c.sol, c.z);
    g.rotation.y = Math.PI / 2 - (c.cap * Math.PI) / 180;
    g.updateMatrixWorld(true);
    scene.add(g);
    box(g, 2.6, 0.12, 2.6, solid(0x9a7a52), 0, H + 11.6, 0);             // plateforme au sommet de la grue, au-dessus de la cabine
    for (const [ax, az, bx, bz] of [[-1.3, -1.3, 1.3, -1.3], [1.3, -1.3, 1.3, 1.3], [1.3, 1.3, -1.3, 1.3], [-1.3, 1.3, -1.3, -1.3]]) {
      // garde-corps en tube fin : de loin, il ne doit pas masquer le tireur
      for (const hh of [1.05, 0.55]) rod(g, new THREE.Vector3(ax, H + 11.66 + hh, az), new THREE.Vector3(bx, H + 11.66 + hh, bz), 0.025);
      rod(g, new THREE.Vector3(ax, H + 11.66, az), new THREE.Vector3(ax, H + 12.71, az), 0.03);
    }
    const eye = g.localToWorld(new THREE.Vector3(0, H + 13.26, 0));     // debout au sommet : rien ne masque le tour d'horizon
    meta.postes[c.nom] = [eye.x, eye.y, eye.z];
    meta.reperes[c.nom] = [c.x, c.z, c.sol + H];
    const e = EMP.find((q) => q.nom === c.nom); if (e) { e.x = eye.x; e.z = eye.z; e.y = eye.y; e.grue = true; }
  }
}

// ---------- emplacements du mode multijoueur : perchoirs, enseignes, repères ----------
{ const anciens = { 'La Médiathèque': 'theatre', 'Immeuble Édison': 'edison', 'Immeuble des Prés': 'pres' };
  meta.postes.edison = [314.5, 183.4, 230.5];
  for (const e of EMP) if (anciens[e.nom]) { const p = meta.postes[anciens[e.nom]]; e.x = p[0]; e.y = p[1] + 1.5; e.z = p[2]; }   // même place, sur le petit échafaudage
  // toits-terrasses : on se place sur le toit du modèle le plus haut à moins de 8 m, à 90 cm au moins d'un bord,
  // et l'œil est à 3,1 m au-dessus (échafaudage de 1,5 m + 1,6 m)
  const toitM = (x, z) => { let best = -1e9; for (const b of bats) { if (Math.abs(b.x - x) > 200 || Math.abs(b.z - z) > 200) continue;
    for (const rings of b.p || []) if (inPoly(x, z, rings[0]) && !rings.slice(1).some((h) => inPoly(x, z, h))) best = Math.max(best, b.r);
    for (const k of b.k) { const dx = x - k[0], dz = z - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]); if (Math.abs(dx * ct + dz * st) <= k[2] / 2 && Math.abs(-dx * st + dz * ct) <= k[3] / 2) best = Math.max(best, k[5]); } } return best; };
  const stable = (x, z, t) => [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]].every(([a, b]) => Math.abs(toitM(x + a, z + b) - t) < 0.3);
  for (const e of EMP) if (e.type === 'toit' && !e.grue) {
    let best = [toitM(e.x, e.z), e.x, e.z]; if (best[0] > -1e8 && !stable(e.x, e.z, best[0])) best[0] = -1e9;
    for (let r = 1; r <= 8; r++) for (let a = 0; a < 12; a++) { const x = e.x + Math.cos(a * 0.5236) * r, z = e.z + Math.sin(a * 0.5236) * r, t = toitM(x, z); if (t > best[0] + 0.3 && stable(x, z, t)) best = [t, x, z]; }
    if (best[0] > -1e8) { e.x = best[1]; e.z = best[2]; e.y = best[0] + 3.1; }
  }
}
const { figures } = buildPostes({ scene, EMP: EMP.filter((e) => !e.grue), groundY, bats, hash, centre: [BCX, BCZ], voirie: VOIRIE });
for (const e of EMP) meta.postes[e.nom] = [e.x + (e.ox || 0), e.y, e.z + (e.oz || 0)];

// ---------- caméra, lunette, commandes ----------
const state = { yaw: 0, pitch: -0.05, scope: false, mag: 8, fly: false, post: 'theatre', tags: true };
// appareil tactile (même détection que le jeu solo, ?touch=1 ou ?touch=0 pour forcer) : commandes au doigt de tactile.js
const TACTILE = isTouchDevice(new URLSearchParams(location.search));
state.tactile = TACTILE; document.documentElement.classList.toggle('touch', TACTILE);
const keys = new Set();
const SCOPE_FOV = 24; // champ vertical apparent rapporté au grossissement
const aim = (x, y, z) => { const d = new THREE.Vector3(x, y + bendY(x, z), z).sub(camera.position); state.yaw = Math.atan2(-d.x, -d.z); state.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); };
const goPost = (name) => { const p = meta.postes[name]; camera.position.set(p[0], p[1] + bendY(p[0], p[2]), p[2]); state.post = name; state.fly = false; for (const e of EMP) { if (e.figure) e.figure.visible = e.nom !== name && (!state.occupes || state.occupes.has(e.nom)); if (e.detail) e.detail.visible = Math.hypot(e.x - p[0], e.z - p[2]) < 450; } };
const aimAt = (name) => {
  if (name === 'Tour Eiffel') { const az = (meta.eiffel.azimut * Math.PI) / 180; state.yaw = -az; state.pitch = 0.004; return; }
  const p = meta.reperes[name]; aim(p[0], p.length > 2 ? p[2] : groundY(p[0], p[1]) + 8, p[1]);
};
meta.postes.edison = [314.5, 183.4, 230.5];                 // immeuble Édison, bord du toit côté parc de l'université (calcul LiDAR)
meta.reperes["Parc de l'université"] = [492, 315];
{ // l'œil ne doit jamais être sous un volume de toit du modèle : on le remonte au besoin
  for (const [nomPoste, p] of Object.entries(meta.postes)) {
    const ep = EMP.find((e) => e.nom === nomPoste); if (ep && ep.type !== 'toit') continue;
    for (const b of bats) {
      if (Math.abs(b.x - p[0]) > 150 || Math.abs(b.z - p[2]) > 150) continue;
      for (const k of b.k) {
        const dx = p[0] - k[0], dz = p[2] - k[1], ct = Math.cos(k[4]), st = Math.sin(k[4]);
        const u = dx * ct + dz * st, v = -dx * st + dz * ct;
        if (Math.abs(u) <= k[2] / 2 + 0.5 && Math.abs(v) <= k[3] / 2 + 0.5) p[1] = Math.max(p[1], k[5] + 1.7);
      }
    }
  }
}

const bar = document.getElementById('bar');
// outils du prototype (étiquettes de tous les emplacements, vol libre, planche de contrôle, diagnostic) : réservés à
// la mise au point, avec ?outils ou ?solo ; un joueur ne voit que sa lunette, le tableau de la manche et son encart de tir
const OUTILS = ['outils', 'solo'].some((k) => new URLSearchParams(location.search).get(k) !== null);
document.body.classList.toggle('outils', OUTILS);
const btn = (label, fn, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = () => { fn(); b.blur(); }; bar.appendChild(b); };
const lab = (t, cls = '') => { const s = document.createElement('span'); s.textContent = t; s.className = cls; bar.appendChild(s); };
const tir = installTir({ scene, camera, view, state, EMP, meta, bendY, groundY, bats, inPoly });
lab('Emplacement :');
const sel = document.createElement('select');
EMP.forEach((e) => { const o = document.createElement('option'); o.value = e.nom; o.textContent = `${e.n}. ${e.nom}`; sel.appendChild(o); });
const allerA = (nom, force = false) => {             // se poster, regarder vers le centre de la carte, un peu sous l'horizon
  if (state.enLigne && !force) return;               // en manche, c'est le serveur qui place les tireurs
  goPost(nom); sel.value = nom; tir.changerPoste(); const p = meta.postes[nom];
  for (const e of EMP) if (e.figure) e.figure.position.y = meta.postes[e.nom][1] - 1.6;
  state.yaw = Math.atan2(-(BCX - p[0]), -(BCZ - p[2])); state.pitch = -0.06; state.scope = false;
};
sel.onchange = () => { allerA(sel.value); sel.blur(); };
bar.appendChild(sel);
const voisin = (d) => { const i = EMP.findIndex((e) => e.nom === sel.value); allerA(EMP[(i + d + EMP.length) % EMP.length].nom); };
btn('◀ précédent', () => voisin(-1)); btn('suivant ▶', () => voisin(1));
btn('Étiquettes (T)', () => (state.tags = !state.tags), 'b-dev'); btn('Vol libre', () => { state.fly = true; camera.position.y += 60; }, 'b-dev');
lab('Lunette :', 'b-dev'); btn('Œil nu / lunette (E)', () => (state.scope = !state.scope), 'b-dev');
// étiquettes des autres emplacements : un point numéroté, et le nom avec la distance quand on vise près de lui
const tagsBox = document.getElementById('tags');
const tags = EMP.map((e) => { const d = document.createElement('div'); d.className = 'tag'; tagsBox.appendChild(d); return d; });
const tv = new THREE.Vector3();
const drawTags = () => {
  const w = view.clientWidth, h = view.clientHeight;
  EMP.forEach((e, i) => {
    const d = tags[i], p = meta.postes[e.nom];
    // en manche, rien n'indique où sont les tireurs : seule l'étiquette de celui qu'on vise apparaît (le spectateur les voit tous)
    const manche = state.enLigne || state.spectateur;
    if (!state.tags || e.nom === state.post || (manche && !(state.occupes && state.occupes.has(e.nom)))) { d.style.display = 'none'; return; }
    tv.set(p[0], p[1] + bendY(p[0], p[2]) + (manche ? 0.75 : -0.5), p[2]);      // en manche : le nom flotte au-dessus de la tête, sans masquer le tireur
    const dist = tv.distanceTo(camera.position); tv.project(camera);
    if (tv.z > 1 || Math.abs(tv.x) > 1.02 || Math.abs(tv.y) > 1.02) { d.style.display = 'none'; return; }
    // tactile : la lunette peut être plus petite et décentrée (state.lunette) ; l'écart se mesure depuis son centre
    const lu = state.scope && state.lunette, ax = lu ? (lu.cx / w) * 2 - 1 : 0, ay = lu ? 1 - (lu.cy / h) * 2 : 0;
    const pres = state.spectateur || Math.hypot((tv.x - ax) * camera.aspect, tv.y - ay) < (state.scope ? 0.5 * (lu ? lu.R / (0.47 * h) : 1) : 0.16);
    if (manche && !pres) { d.style.display = 'none'; return; }
    d.style.display = 'block'; d.style.left = `${((tv.x + 1) / 2) * w}px`; d.style.top = `${((1 - tv.y) / 2) * h}px`;
    const qui = state.pseudoA ? state.pseudoA(e.nom) : '';
    d.className = manche ? 'tag nom' : pres ? 'tag pres' : 'tag';
    d.textContent = manche ? qui : !pres ? e.n : `${e.n}. ${e.nom} · ${Math.round(dist)} m · ${tir.texteCorrection(e)}`;
  });
};
// Regard à la souris, comme dans le jeu solo : un clic sur l'image capture la souris, Échap la libère. Souris capturée,
// bouger regarde (même sensibilité que le solo, réduite avec le grossissement), clic gauche tire, clic droit épaule ou
// quitte la lunette, la molette règle le grossissement.
const SENS_SOURIS = 0.0022, FOV_REF = 55;
let capture = false;
const aideCapture = document.createElement('div'); aideCapture.id = 'capture'; aideCapture.textContent = 'Clic pour capturer la souris, Échap pour la libérer.'; document.body.appendChild(aideCapture);
view.addEventListener('click', () => { if (!TACTILE && !capture && !state.salon && !state.fly) { try { view.requestPointerLock()?.catch?.(() => {}); } catch { /* refusé par le navigateur */ } } });
document.addEventListener('pointerlockchange', () => { capture = document.pointerLockElement === view; state.capture = capture; document.body.classList.toggle('capture', capture); });
document.addEventListener('mousemove', (e) => {
  if (!capture) return;
  const s = state.scope ? SENS_SOURIS * (camera.fov / FOV_REF) * 0.9 : SENS_SOURIS;
  state.yaw -= e.movementX * s; state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch - e.movementY * s));
});
document.addEventListener('mousedown', (e) => { if (!capture) return; if (e.button === 0) tir.tirer(); else if (e.button === 2) state.scope = !state.scope; });
view.addEventListener('wheel', (e) => { e.preventDefault(); if (state.scope) state.mag = Math.max(4, Math.min(25, state.mag * (e.deltaY < 0 ? 1.18 : 1 / 1.18))); }, { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => { keys.add(e.code); if ((e.code === 'KeyF' || e.code === 'KeyE') && !state.salon) state.scope = !state.scope;   // F comme en solo (E gardé)
  if (OUTILS && e.code === 'KeyT') state.tags = !state.tags; if (OUTILS && e.code === 'KeyP') state.quad = !state.quad; if (!state.scope && e.code === 'ArrowRight' && e.shiftKey) voisin(1); if (!state.scope && e.code === 'ArrowLeft' && e.shiftKey) voisin(-1); });
window.addEventListener('keyup', (e) => keys.delete(e.code));

const sc = document.getElementById('scope'), sx = sc.getContext('2d');
const resize = () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  sc.width = w * devicePixelRatio; sc.height = h * devicePixelRatio;
};
window.addEventListener('resize', resize); resize();

const drawScope = () => {
  const w = sc.width, h = sc.height;
  sx.clearRect(0, 0, w, h);
  if (!state.scope || state.fovOverride) return;
  // tactile : centre et rayon réservés par tactile.js (en pixels CSS) ; sinon la lunette de toujours, au centre
  const lu = state.lunette, dpr = w / window.innerWidth;
  const cx = lu ? lu.cx * dpr : w / 2, cy = lu ? lu.cy * dpr : h / 2, R = lu ? lu.R * dpr : h * 0.47;
  sx.fillStyle = '#000'; sx.beginPath(); sx.rect(0, 0, w, h); sx.arc(cx, cy, R, 0, Math.PI * 2, true); sx.fill('evenodd');
  const g = sx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
  sx.fillStyle = g; sx.beginPath(); sx.arc(cx, cy, R, 0, Math.PI * 2); sx.fill();
  const mrad = h / 2 / Math.tan((camera.fov * Math.PI) / 360) / 1000;   // pixels par mrad (réticule au premier plan focal)
  sx.strokeStyle = 'rgba(0,0,0,0.9)'; sx.lineWidth = Math.max(1, devicePixelRatio);
  sx.beginPath(); sx.moveTo(cx - R, cy); sx.lineTo(cx + R, cy); sx.moveTo(cx, cy - R); sx.lineTo(cx, cy + R); sx.stroke();
  sx.beginPath();
  for (let i = -30; i <= 30; i++) {
    if (!i) continue; const d = i * mrad; if (Math.abs(d) > R * 0.92) continue; const t = (i % 5 === 0 ? 0.45 : 0.22) * mrad;
    sx.moveTo(cx + d, cy - t); sx.lineTo(cx + d, cy + t); sx.moveTo(cx - t, cy + d); sx.lineTo(cx + t, cy + d);
  }
  sx.stroke();
};

const info = document.getElementById('info');
const fps = { n: 0, t: 0, avg: 0, min: 999, worst: 0 };
let last = performance.now();
const fwd = new THREE.Vector3();
const draw = (now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state.fly) {
    const v = (keys.has('ShiftLeft') ? 220 : 60) * dt;
    camera.getWorldDirection(fwd);
    if (keys.has('KeyW') || keys.has('KeyZ')) camera.position.addScaledVector(fwd, v);
    if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -v);
    fwd.set(-fwd.z, 0, fwd.x).normalize();
    if (keys.has('KeyD')) camera.position.addScaledVector(fwd, v);
    if (keys.has('KeyA') || keys.has('KeyQ')) camera.position.addScaledVector(fwd, -v);
    if (keys.has('Space')) camera.position.y += v;
    if (keys.has('KeyC')) camera.position.y -= v;
  }
  // flèches : regarder à l'œil nu ; lunette à l'œil, elles tournent les tourelles (tir.js) et l'on vise à la souris
  { const k = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0), kv = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0), v = dt * (state.scope ? 0.9 / state.mag : 0.9); if (!state.scope && !keys.has('ShiftLeft') && !keys.has('ShiftRight')) { state.yaw += k * v; state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch + kv * v)); } }
  camera.rotation.set(state.pitch, state.yaw, 0);
  camera.fov = state.fovOverride ?? (state.scope ? SCOPE_FOV / state.mag : 60);
  { // tactile : la lunette garde son champ réel quel que soit son rayon à l'écran, et la visée passe par son centre
    const lu = state.scope && !state.fovOverride && !state.quad ? state.lunette : null, w = window.innerWidth, h = window.innerHeight;
    if (lu) camera.fov = (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * ((0.47 * h) / lu.R)) * 180) / Math.PI;
    if (lu && (Math.abs(lu.cx - w / 2) > 0.5 || Math.abs(lu.cy - h / 2) > 0.5)) camera.setViewOffset(w, h, w / 2 - lu.cx, h / 2 - lu.cy, w, h);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
  waterMat.uniforms.t.value = now / 1000; waterMat.uniforms.eye.value.copy(camera.position);
  if (state.quad) {                                   // planche de contrôle : les quatre directions d'un coup (touche P)
    const w = view.clientWidth, h = view.clientHeight; camera.fov = 90; camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    for (let k = 0; k < 4; k++) { camera.rotation.set(state.pitch, state.yaw - (k * Math.PI) / 2, 0); camera.updateMatrixWorld(); const x = (k % 2) * (w / 2), y = k < 2 ? h / 2 : 0; renderer.setViewport(x, y, w / 2, h / 2); renderer.setScissor(x, y, w / 2, h / 2); renderer.render(scene, camera); }
    renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
  } else renderer.render(scene, camera);
  tir.update(now); effets?.update(now); tactile?.update(now);
  drawScope(); if (!state.quad) drawTags(); else tags.forEach((d) => (d.style.display = 'none'));
  fps.n++; fps.t += dt; fps.worst = Math.max(fps.worst, dt);
  if (fps.t >= 0.5) {
    fps.avg = fps.n / fps.t; fps.min = 1 / fps.worst; fps.n = 0; fps.t = 0; fps.worst = 0;
    const az = ((-state.yaw * 180) / Math.PI % 360 + 360) % 360;
    const r = renderer.info.render;
    info.textContent = `${fps.avg.toFixed(0)} i/s (pire image : ${fps.min.toFixed(0)})   ${(r.triangles / 1e6).toFixed(2)} M triangles, ${r.calls} appels\n` +
      `azimut ${az.toFixed(1)}°  site ${((state.pitch * 180) / Math.PI).toFixed(2)}°  ${state.scope ? '×' + state.mag.toFixed(1) : 'œil nu'}\n` +
      `${bats.length} bâtiments, ${nTrees - treesDropped} arbres — glisser ou flèches : regarder, clic droit ou E : lunette (flèches : tourelles), molette : grossissement, Maj+flèches : emplacement suivant${state.fly ? ', ZQSD/espace/C : voler' : ''}`;
  }
};
const frame = (now) => { draw(now); requestAnimationFrame(frame); };
allerA(new URLSearchParams(location.search).get('poste') || 'La Médiathèque');
const sons = installSons();
tir.etat.surCran = () => sons.cran();
const effets = installEffets({ scene, camera, state, EMP, meta, bendY, groundY, tir, sons });
const reseau = installReseau({ EMP, state, allerA, tir, sel, effets, sons, carte: { dalles: tiles.map((t) => ({ image: t.tex.image, x0: t.x0, z0: t.z0 })), cote: TS, ox: OX, oz: OZ, taille: N } });
// la courbure est appliquée à l'affichage : on élargit les sphères englobantes d'autant, sinon les petits objets sont écartés à tort
scene.traverse((o) => { const g = o.geometry; if (!g || !o.frustumCulled || g.userData.elargi) return; g.computeBoundingSphere(); g.boundingSphere.radius += BOMBE + 1; g.userData.elargi = true; });
const tactile = TACTILE ? installTactile({ view, state, tir, camera, reseau, redessine: () => resize() }) : null;
document.getElementById('load').remove();
requestAnimationFrame(frame);

const bench = (n = 60) => { const gl = renderer.getContext(), px = new Uint8Array(4); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < n; i++) { camera.rotation.y += 0.002; camera.updateMatrixWorld(); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t0) / n; };
const plan = (x, z, demi = 200) => { state.fly = true; camera.position.set(x, 1700, z); state.yaw = 0; state.pitch = -Math.PI / 2 + 1e-4; state.fovOverride = (2 * Math.atan(demi / (1700 - 160)) * 180) / Math.PI; document.getElementById('bar').style.display = 'none'; };
window.ville = { tir, reseau, effets, sons, tactile, bats, draw: () => draw(performance.now()), plan, bench, EMP, allerA, bendY, eau: () => ({ plans: waterCount, surface: waterArea }), styleStats,  state, camera, renderer, scene, meta, goPost, aimAt, fps, counts: () => ({ lampadaires: nLamps, voitures: nCars, premiersPlans: hiRes, wallTris, roofTris, trees: nTrees - treesDropped, ecartes: treesDropped, bats: bats.length }) };
