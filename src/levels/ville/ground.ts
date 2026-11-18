// Ville nouvelle : le sol (neuf dalles dessinées en aplats, drapées sur le relief), les abords reposés autour du
// bassin et du canal, la photographie lointaine au-delà de la carte, et les plans d'eau. Courbure cuite aux sommets.
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, PlaneGeometry, ShaderMaterial, ShapeUtils, Vector2, type Texture } from 'three';
import type { Engine } from '../../core/engine';
import { BASSIN, CANAL, CANAL_W, inPoly, type VilleWorld } from './data';
import { NOISE_GLSL, SUN, basic, flat, uLight } from './shade';

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vW; varying float vDist;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`;

/** Matière du sol : la dalle dessinée, avec un grain qui n'apparaît que de près (herbe, enrobé). */
function groundMat(tex: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { sol: { value: tex }, uLight },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D sol; uniform vec3 uLight; varying vec2 vUv; varying vec3 vW; varying float vDist;
      ${NOISE_GLSL}
      void main(){
        vec3 c = texture2D(sol, vUv).rgb;
        float grass = clamp((c.g - max(c.r, c.b)) * 10.0, 0.0, 1.0);
        float near = 1.0 - smoothstep(60.0, 420.0, vDist);
        float d = vn(vW.xz * 3.1) * 0.5 + vn(vW.xz * 0.9) * 0.3 + vn(vW.xz * 0.21) * 0.2;
        c *= mix(1.0, mix(0.90, 0.72, grass) + mix(0.20, 0.56, grass) * d, near);
        gl_FragColor = vec4(c * uLight, 1.0);
      }`,
  });
}

/** Matière de l'eau : rides, reflet du ciel et du soleil. Partagée avec la fontaine (landmarks.ts). */
export function waterMat(engine: Engine): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: { t: engine.uTime, sun: { value: SUN }, uLight },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float t; uniform vec3 sun; uniform vec3 uLight; varying vec3 vW; varying float vDist;
      ${NOISE_GLSL}
      float wave(vec2 p){ return vn(p * 0.55 + vec2(t * 0.35, t * 0.12)) * 0.6 + vn(p * 1.7 - vec2(t * 0.5, -t * 0.3)) * 0.3 + vn(p * 4.3 + t * 0.8) * 0.1; }
      void main(){
        float k = 1.0 - smoothstep(150.0, 1400.0, vDist);                    // les rides s'effacent au loin
        float e = 0.35;
        vec2 gxy = vec2(wave(vW.xz + vec2(e, 0.0)) - wave(vW.xz - vec2(e, 0.0)), wave(vW.xz + vec2(0.0, e)) - wave(vW.xz - vec2(0.0, e)));
        vec3 n = normalize(vec3(-gxy.x * 0.9 * k, 1.0, -gxy.y * 0.9 * k));
        vec3 v = normalize(cameraPosition - vW);
        float fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(vec3(0.485, 0.584, 0.672), vec3(0.30, 0.52, 0.82), pow(clamp(r.y, 0.0, 1.0), 0.45));
        vec3 deep = mix(vec3(0.07, 0.25, 0.36), vec3(0.11, 0.36, 0.42), wave(vW.xz * 0.2));
        vec3 c = mix(deep, sky, clamp(fr, 0.0, 0.92));
        c += vec3(1.0, 0.95, 0.85) * pow(max(dot(r, sun), 0.0), 180.0) * 1.6 * k;
        gl_FragColor = vec4(c * uLight, 1.0);
      }`,
  });
}

/**
 * Sol et eau. `tiles` : textures des dalles, dans l'ordre ligne × colonne ; `far` : photographie lointaine.
 * `extras` reçoit les pièces d'une seule couleur (murs de quai), à fusionner par l'appelant.
 */
export function buildGround(w: VilleWorld, tiles: Texture[], far: Texture, water: ShaderMaterial, extras: Group): Group {
  const { NT, TS, OX, OZ, N, bendY, groundY } = w;
  const group = new Group();
  const add = (g: BufferGeometry, mat: ShaderMaterial | ReturnType<typeof basic>): Mesh => { g.computeBoundingSphere(); const m = new Mesh(g, mat); m.matrixAutoUpdate = false; group.add(m); return m; };
  const bend = (pos: number[]): number[] => { for (let i = 0; i < pos.length; i += 3) pos[i + 1] += bendY(pos[i], pos[i + 2]); return pos; };

  // dalles : 184 mailles de 8 m par côté, le pas du relief
  const SEG = 184;
  for (let a = 0; a < NT; a++) for (let b = 0; b < NT; b++) {
    const g = new PlaneGeometry(TS, TS, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    g.translate(OX + b * TS + TS / 2, 0, OZ + a * TS + TS / 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k); p.setY(k, w.terrainY(x, z) + bendY(x, z)); }
    g.deleteAttribute('normal');
    add(g, groundMat(tiles[a * NT + b]));
  }

  { // abords du bassin et quais du canal : le sol dessiné est reposé à sa hauteur réelle autour des parties creusées
    const ti = w.tileIndex(0, 100), x0 = OX + (ti % NT) * TS, z0 = OZ + Math.floor(ti / NT) * TS;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], wpos: number[] = [], widx: number[] = [];
    const v = (x: number, y: number, z: number): number => { pos.push(x, y, z); uv.push((x - x0) / TS, 1 - (z - z0) / TS); return pos.length / 3 - 1; };
    const quad = (a: number, b: number, c: number, d: number): void => { idx.push(a, b, c, a, c, d, a, c, b, a, d, c); };
    const cx = BASSIN.reduce((m, p) => m + p[0], 0) / BASSIN.length, cz = BASSIN.reduce((m, p) => m + p[1], 0) / BASSIN.length;
    const ring = BASSIN.map((p) => { const d = Math.hypot(p[0] - cx, p[1] - cz); const q = [p[0] + ((p[0] - cx) / d) * 13, p[1] + ((p[1] - cz) / d) * 13]; return [v(p[0], w.LB + 0.04, p[1]), v(q[0], groundY(q[0], q[1]) + 0.03, q[1])]; });
    ring.forEach((r, i) => { const n = ring[(i + 1) % ring.length]; quad(r[0], n[0], n[1], r[1]); });
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux, n = Math.ceil(L / 6);
      for (const sd of [-1, 1]) {
        let prev: number[] | null = null;
        for (let k = 0; k <= n; k++) {
          const t = (k / n) * L, px = a[0] + ux * t, pz = a[1] + uz * t, lv = w.canalLv[i] + (w.canalLv[i + 1] - w.canalLv[i]) * (k / n);
          const ix = px + nx * sd * (CANAL_W / 2), iz = pz + nz * sd * (CANAL_W / 2), ox = px + nx * sd * (CANAL_W / 2 + 12), oz = pz + nz * sd * (CANAL_W / 2 + 12);
          if (inPoly(ix, iz, BASSIN)) { prev = null; continue; }
          const y = Math.max(groundY(ox, oz), lv + 1.2);
          const cur = [v(ix, y, iz), v(ox, groundY(ox, oz) + 0.02, oz)];
          const q = wpos.length / 3;
          wpos.push(ix, y, iz, ix, lv - 0.3, iz);
          if (prev) { quad(prev[0], cur[0], cur[1], prev[1]); widx.push(prev[2], q, q + 1, prev[2], q + 1, prev[2] + 1, prev[2], q + 1, q, prev[2], prev[2] + 1, q + 1); }
          prev = [...cur, q];
        }
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(bend(pos), 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    add(g, groundMat(tiles[ti]));
    // murs de quai : pièce d'une seule couleur (la courbure y est ajoutée à la fusion, d'un bloc : au centre de la carte, elle est nulle)
    const wg = new BufferGeometry();
    wg.setAttribute('position', new Float32BufferAttribute(wpos, 3));
    wg.setIndex(widx);
    wg.computeVertexNormals();
    extras.add(new Mesh(wg, flat(0x9a968c)));
  }

  { // au-delà de la carte : photographie aérienne à basse définition, à plat
    const F = w.meta.lointain, y = w.meta.altSol - 1;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const quad = (xa: number, za: number, xb: number, zb: number): void => {
      const o = pos.length / 3;
      for (const [x, z] of [[xa, za], [xb, za], [xb, zb], [xa, zb]]) { pos.push(x, y, z); uv.push(x / F + 0.5, 0.5 - z / F); }
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    };
    const f = F / 2, xa = OX, xb = OX + N, za = OZ, zb = OZ + N;
    quad(-f, -f, f, za); quad(-f, zb, f, f); quad(-f, za, xa, zb); quad(xb, za, f, zb);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(bend(pos), 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    add(g, basic({ map: far }));
  }

  { // plans d'eau des données, bassin, canal
    const pos: number[] = [], idx: number[] = [];
    for (const e of w.raw.eau) {
      const contour = e.r[0].map((p) => new Vector2(p[0], p[1]));
      const holes = e.r.slice(1).map((r) => r.map((p) => new Vector2(p[0], p[1])));
      const tris = ShapeUtils.triangulateShape(contour, holes);
      const o = pos.length / 3;
      for (const p of e.r.flat()) pos.push(p[0], e.y + 0.3, p[1]);
      for (const t of tris) idx.push(o + t[0], o + t[2], o + t[1]);
    }
    {
      const o = pos.length / 3;
      for (const p of BASSIN) pos.push(p[0], w.LB, p[1]);
      for (const t of ShapeUtils.triangulateShape(BASSIN.map((p) => new Vector2(p[0], p[1])), [])) idx.push(o + t[0], o + t[2], o + t[1]);
    }
    for (let i = 0; i < CANAL.length - 1; i++) {
      const a = CANAL[i], b = CANAL[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = ((-dz / L) * CANAL_W) / 2, nz = ((dx / L) * CANAL_W) / 2;
      const o = pos.length / 3, ya = w.canalLv[i], yb = w.canalLv[i + 1];
      pos.push(a[0] + nx, ya, a[1] + nz, a[0] - nx, ya, a[1] - nz, b[0] - nx, yb, b[1] - nz, b[0] + nx, yb, b[1] + nz);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(bend(pos), 3));
    g.setIndex(idx);
    add(g, water);
  }
  return group;
}
