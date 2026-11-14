// Terrain : carte de hauteur précalculée, maillage polaire à densité décroissante, shader de mélange de matières.
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  Sphere,
  UnsignedByteType,
  Vector3,
  ClampToEdgeWrapping,
} from 'three';
import { fetchBin, loadTexArray, assetUrl } from '../core/assets';
import { fbm2, makeNoise2D, smoothstep } from '../core/noise';
import type { Engine } from '../core/engine';
import type { PaletteSpec, TerrainSpec } from '../levels/types';
import { WIND_GLSL, type Wind } from './wind';

export interface TerrainMeta {
  res: number;
  size: number;
  min: number;
  max: number;
  siteHeights: Record<string, number>;
  road: [number, number, number][];
  river: [number, number, number][];
  /** bâtiments terrassés par le générateur (lib.flattenBuildings) : altitude du y = 0 de chacun */
  buildings?: { id: string; carte?: string; x: number; z: number; yaw: number; groundY: number }[];
}

/**
 * Le site de tir est à l'origine : maillage polaire, relief de détail, retouches (sculpt, clear) et ombres sont
 * centrés dessus. La taille, la résolution et le dossier des fichiers viennent du niveau.
 */
export class Terrain {
  H!: Float32Array;
  splat!: Uint8Array;
  meta!: TerrainMeta;
  group = new Group();
  material!: MeshStandardMaterial;
  /** couleur moyenne linéaire de la texture d'herbe (pour accorder les brins) */
  grassMean: [number, number, number] = [0.1, 0.13, 0.04];
  private nDetail = makeNoise2D(777);
  private N: number;
  private S: number;

  /** palette du niveau (teintes des matières) et altitude du fond de vallée (teinte d'altitude, étage des feuillus) */
  readonly palette: PaletteSpec;
  readonly valleyY: number;

  constructor(readonly spec: TerrainSpec, look: { palette?: PaletteSpec; valleyY?: number } = {}) {
    this.N = spec.res;
    this.S = spec.size;
    this.palette = look.palette ?? {};
    this.valleyY = look.valleyY ?? 0;
  }

  async load(): Promise<void> {
    const dir = `terrain/${this.spec.dir}/`;
    const [h, s, m] = await Promise.all([fetchBin(dir + 'height.bin'), fetchBin(dir + 'splat.bin'), fetch(assetUrl(dir + 'meta.json')).then((r) => r.json())]);
    this.H = new Float32Array(h);
    this.splat = new Uint8Array(s);
    this.meta = m;
    if (m.res !== this.N || m.size !== this.S || this.H.length !== this.N * this.N)
      throw new Error(`relief « ${this.spec.dir} » : ${m.res} points sur ${m.size} m, le niveau attend ${this.N} points sur ${this.S} m (relancer tools/gen-terrain.mjs)`);
  }

  /** Hauteur brute de la carte, interpolation bicubique de Catmull-Rom. */
  private baseHeight(x: number, z: number): number {
    const N = this.N, S = this.S;
    let fx = (x / S + 0.5) * (N - 1);
    let fz = (z / S + 0.5) * (N - 1);
    fx = fx < 1 ? 1 : fx > N - 2.001 ? N - 2.001 : fx;
    fz = fz < 1 ? 1 : fz > N - 2.001 ? N - 2.001 : fz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const H = this.H;
    const u2 = u * u, u3 = u2 * u;
    const wx0 = -0.5 * u3 + u2 - 0.5 * u, wx1 = 1.5 * u3 - 2.5 * u2 + 1, wx2 = -1.5 * u3 + 2 * u2 + 0.5 * u, wx3 = 0.5 * u3 - 0.5 * u2;
    const v2 = v * v, v3 = v2 * v;
    const wz0 = -0.5 * v3 + v2 - 0.5 * v, wz1 = 1.5 * v3 - 2.5 * v2 + 1, wz2 = -1.5 * v3 + 2 * v2 + 0.5 * v, wz3 = 0.5 * v3 - 0.5 * v2;
    let r = 0;
    for (let b = -1; b <= 2; b++) {
      const k = (j + b) * N + i;
      const row = H[k - 1] * wx0 + H[k] * wx1 + H[k + 1] * wx2 + H[k + 2] * wx3;
      r += row * (b === -1 ? wz0 : b === 0 ? wz1 : b === 1 ? wz2 : wz3);
    }
    return r;
  }

  heightAt(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    const r = Math.hypot(x, z);
    if (r < 430) {
      let amp = (0.07 + 1.25 * smoothstep(33, 75, r)) * (1 - smoothstep(240, 430, r));
      for (const p of this.spec.pads) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r1) amp *= smoothstep(p.r0 * 0.6, p.r1, d);
      }
      h += amp * (fbm2(this.nDetail, x / 9, z / 9, 3) + 0.35 * fbm2(this.nDetail, x / 2.3 + 40, z / 2.3, 2));
      if (r < 60)
        for (const s of this.spec.sculpt) {
          const d = Math.hypot(x - s.x, z - s.z);
          if (d < s.r1) h += (s.h - h) * (1 - smoothstep(s.r0, s.r1, d));
        }
      if (r < 110)
        for (const c of this.spec.clear) {
          const dx = x - c.x, dz = z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < c.start || d > 90) continue;
          let b = (Math.atan2(dx, -dz) * 180) / Math.PI;
          if (b < c.b0 - 20) b += 360;
          if (b < c.b0 - 9 || b > c.b1 + 9) continue;
          const edge = Math.min(smoothstep(c.b0 - 9, c.b0, b), 1 - smoothstep(c.b1, c.b1 + 9, b));
          // ressaut marqué sur les six premiers mètres (le tireur est au bord), puis pente douce
          const dd = d - c.start;
          const dl = c.dropLen ?? 6;
          const lim = c.y - 0.2 - Math.min(dd, dl) * (c.drop ?? 0.58) - Math.max(0, dd - dl) * c.slope;
          const k = edge * smoothstep(c.start, c.start + 0.25, d) * (1 - smoothstep(60, 90, d));
          if (c.soft) {
            // raccord arrondi : minimum lissé du sol en place et du plan, sur `soft` mètres de part et d'autre
            const e = Math.max(0, c.soft - Math.abs(h - lim)) / c.soft;
            h += (Math.min(h, lim) - e * e * c.soft * 0.25 - h) * k;
          } else if (h > lim) h += (lim - h) * k;
        }
    }
    return h;
  }

  normalAt(x: number, z: number, out: Vector3, eps = 0.5): Vector3 {
    const hx = this.heightAt(x + eps, z) - this.heightAt(x - eps, z);
    const hz = this.heightAt(x, z + eps) - this.heightAt(x, z - eps);
    return out.set(-hx, 2 * eps, -hz).normalize();
  }

  /** Valeur de la carte de matières (0..1) : 0 roche, 1 éboulis, 2 forêt, 3 terre. */
  splatAt(x: number, z: number, ch: number): number {
    const N = this.N, S = this.S;
    const i = Math.min(N - 1, Math.max(0, Math.round((x / S + 0.5) * (N - 1))));
    const j = Math.min(N - 1, Math.max(0, Math.round((z / S + 0.5) * (N - 1))));
    return this.splat[(j * N + i) * 4 + ch] / 255;
  }

  /** Premier point du segment a→b sous le terrain (marche par pas), ou null. */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: Vector3, step = 2): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const n = Math.max(1, Math.ceil(len / step));
    let pt = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (y < this.heightAt(x, z)) {
        // dichotomie
        let lo = pt, hi = t;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) / 2;
          if (ay + dy * m < this.heightAt(ax + dx * m, az + dz * m)) hi = m;
          else lo = m;
        }
        out.set(ax + dx * hi, ay + dy * hi, az + dz * hi);
        return true;
      }
      pt = t;
    }
    return false;
  }

  async build(engine: Engine, wind: Wind): Promise<void> {
    const N = this.N, S = this.S;
    // sans plan d'eau, la « rive mouillée » est repoussée sous tout relief
    const water = this.spec.waterLevel ?? -1e4;
    const names = ['grass', 'rock', 'scree', 'forest', 'dirt', 'moss'];
    const an = engine.q.anisotropy;
    const [alb, nor] = await Promise.all([loadTexArray(names, 'diff', 1024, an), loadTexArray(names, 'nor', 1024, an)]);
    this.grassMean = alb.mean[0];

    // carte de normales globale (monde) issue de la grille
    const nm = new Uint8Array(N * N * 4);
    const cell = S / (N - 1);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const hx = this.H[j * N + Math.min(N - 1, i + 1)] - this.H[j * N + Math.max(0, i - 1)];
        const hz = this.H[Math.min(N - 1, j + 1) * N + i] - this.H[Math.max(0, j - 1) * N + i];
        const nx = -hx, ny = 2 * cell, nz = -hz;
        const l = Math.hypot(nx, ny, nz);
        nm[k * 4] = Math.round((nx / l) * 127.5 + 127.5);
        nm[k * 4 + 1] = Math.round((ny / l) * 127.5 + 127.5);
        nm[k * 4 + 2] = Math.round((nz / l) * 127.5 + 127.5);
        nm[k * 4 + 3] = 255;
      }
    const mk = (data: Uint8Array) => {
      const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      return t;
    };
    const tNmap = mk(nm);
    const tSplat = mk(this.splat);

    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    engine.setupMaterial(
      mat,
      (sh) => {
        sh.uniforms.tAlb = { value: alb.tex };
        sh.uniforms.tNor = { value: nor.tex };
        sh.uniforms.tSplat = { value: tSplat };
        sh.uniforms.tNmap = { value: tNmap };
        sh.uniforms.tNoise = { value: engine.noiseTex };
        sh.uniforms.uZoomK = engine.uZoomK;
        sh.uniforms.uMean = { value: alb.mean.map((m) => new Vector3(m[0], m[1], m[2])) };
        // palette du niveau : teinte par matière (herbe, roche, éboulis, forêt, terre, mousse) ; sécheresse, mousse, fond de vallée
        const pal = this.palette;
        sh.uniforms.uPal = { value: [pal.grass, pal.rock, pal.scree, pal.forest, pal.dirt, pal.moss].map((c) => new Vector3(...(c ?? [1, 1, 1]))) };
        sh.uniforms.uPalK = { value: new Vector3(pal.dryness ?? 0, pal.mossAmount ?? 1, this.valleyY) };
        Object.assign(sh.uniforms, wind.uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
          .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
        sh.fragmentShader = sh.fragmentShader
          .replace(
            '#include <common>',
            /* glsl */ `#include <common>
            precision highp sampler2DArray;
            uniform sampler2DArray tAlb;
            uniform sampler2DArray tNor;
            uniform sampler2D tSplat;
            uniform sampler2D tNmap;
            uniform sampler2D tNoise;
            uniform float uZoomK;
            uniform vec3 uMean[6];
            uniform vec3 uPal[6];
            uniform vec3 uPalK;
            varying vec3 vWPos;
            varying vec3 vWNormal;
            ${WIND_GLSL}
            vec3 gNw;
            float gRough;`,
          )
          .replace(
            '#include <map_fragment>',
            /* glsl */ `
            {
              vec2 tuv = vWPos.xz / ${S.toFixed(1)} + 0.5;
              vec4 sp = texture2D(tSplat, tuv);
              float rxz = length(vWPos.xz);
              float camD = length(vWPos - cameraPosition);
              float wFar = smoothstep(110.0, 360.0, rxz);
              vec3 Nmap = texture2D(tNmap, tuv).xyz * 2.0 - 1.0;
              vec3 Nb = normalize(mix(normalize(vWNormal), Nmap, wFar));
              vec3 mac = texture2D(tNoise, vWPos.xz * 0.0011).rgb;
              vec3 mac2 = texture2D(tNoise, vWPos.xz * 0.013).rgb;
              vec3 mac3 = texture2D(tNoise, vWPos.xz * 0.11).rgb;

              float slopeRock = smoothstep(0.72, 0.58, Nb.y + (mac2.r - 0.5) * 0.2 + (mac3.g - 0.5) * 0.1);
              float wRock = clamp(max(sp.r * (0.4 + 0.6 * wFar), slopeRock), 0.0, 1.0);
              float wScree = sp.g;
              float wDirt = sp.a;
              float wForest = sp.b * 0.9;
              // mousse sur le sommet, à l'ombre des ruines et dans les creux
              float wMoss = (1.0 - wFar) * smoothstep(0.56, 0.72, mac2.g + mac3.b * 0.25) * 0.7 * uPalK.y;

              vec2 p = vWPos.xz;
              float effD = camD * uZoomK;
              float fNear = 1.0 - smoothstep(170.0, 250.0, effD);
              vec2 dpx = dFdx(p), dpy = dFdy(p);
              vec3 dqx = dFdx(vWPos), dqy = dFdy(vWPos);
              // version lointaine : deux échantillons et des couleurs moyennes
              vec3 aG = textureGrad(tAlb, vec3(p * 0.043, 0.0), dpx * 0.043, dpy * 0.043).rgb;
              vec3 aR = textureGrad(tAlb, vec3(p * 0.017 + vWPos.y * 0.011, 1.0), dpx * 0.017, dpy * 0.017).rgb;
              vec3 aS = uMean[2], aF = uMean[3], aD = uMean[4], aM = uMean[5];
              vec3 nAdd = vec3(0.0);
              vec3 addR = vec3(0.0);
              vec3 nS = vec3(0.0), nF = vec3(0.0), nD = vec3(0.0);
              vec3 tw = pow(abs(Nb), vec3(4.0));
              tw /= tw.x + tw.y + tw.z;
              if (fNear > 0.0) {
                vec3 aGn = textureGrad(tAlb, vec3(p * 0.31, 0.0), dpx * 0.31, dpy * 0.31).rgb;
                aG = mix(aG, aGn, fNear * (1.0 - smoothstep(30.0, 140.0, effD) * 0.75));
                aM = mix(aM, textureGrad(tAlb, vec3(p * 0.45, 5.0), dpx * 0.45, dpy * 0.45).rgb, fNear);
                vec3 nG = textureGrad(tNor, vec3(p * 0.31, 0.0), dpx * 0.31, dpy * 0.31).xyz * 2.0 - 1.0;
                nAdd = vec3(nG.x, 0.0, nG.y);
                nS = nG; nF = nG; nD = nG;
                // les autres couches ne sont échantillonnées que là où elles apparaissent
                if (wScree > 0.02) {
                  aS = mix(aS, textureGrad(tAlb, vec3(p * 0.27, 2.0), dpx * 0.27, dpy * 0.27).rgb, fNear);
                  nS = textureGrad(tNor, vec3(p * 0.27, 2.0), dpx * 0.27, dpy * 0.27).xyz * 2.0 - 1.0;
                }
                if (wForest > 0.02) aF = mix(aF, textureGrad(tAlb, vec3(p * 0.23, 3.0), dpx * 0.23, dpy * 0.23).rgb, fNear);
                if (wDirt > 0.02) aD = mix(aD, textureGrad(tAlb, vec3(p * 0.33, 4.0), dpx * 0.33, dpy * 0.33).rgb, fNear);
                if (wRock > 0.02) {
                  // roche en triplanaire
                  float rs = 0.11;
                  vec3 q = vWPos * rs;
                  vec3 gx = dqx * rs, gy = dqy * rs;
                  vec3 aRn = textureGrad(tAlb, vec3(q.zy, 1.0), gx.zy, gy.zy).rgb * tw.x + textureGrad(tAlb, vec3(q.xz, 1.0), gx.xz, gy.xz).rgb * tw.y + textureGrad(tAlb, vec3(q.xy, 1.0), gx.xy, gy.xy).rgb * tw.z;
                  aR = mix(aR, aRn, fNear * (1.0 - smoothstep(60.0, 250.0, effD) * 0.6));
                  vec3 nRx = textureGrad(tNor, vec3(q.zy, 1.0), gx.zy, gy.zy).xyz * 2.0 - 1.0;
                  vec3 nRy = textureGrad(tNor, vec3(q.xz, 1.0), gx.xz, gy.xz).xyz * 2.0 - 1.0;
                  vec3 nRz = textureGrad(tNor, vec3(q.xy, 1.0), gx.xy, gy.xy).xyz * 2.0 - 1.0;
                  addR = vec3(0.0, nRx.y, nRx.x) * tw.x + vec3(nRy.x, 0.0, nRy.y) * tw.y + vec3(nRz.x, nRz.y, 0.0) * tw.z;
                }
              }
              aG = mix(aG, aM * vec3(0.9, 0.95, 0.7), 0.38) * vec3(0.86, 1.0, 0.7);

              // variété de l'herbe : taches sèches, vert plus dense dans les creux, altitude
              float dry = smoothstep(0.42, 0.78, mac.r + (mac2.g - 0.5) * 0.3 + uPalK.x);
              aG *= mix(vec3(0.92, 1.0, 0.82), vec3(1.42, 1.22, 0.74), dry);
              aG *= mix(1.0, 0.8, smoothstep(0.5, 0.8, mac.b));
              aG = mix(aG, aG * vec3(1.18, 1.08, 0.8), smoothstep(150.0, 420.0, vWPos.y - uPalK.z));
              // rafales visibles sur les prairies
              float gust = windGust(vWPos.xz);
              aG *= 1.0 + 0.3 * (gust - 0.35) * smoothstep(25.0, 120.0, effD);
              aR *= mix(0.36, 0.56, mac.g) * vec3(1.0, 0.99, 0.97);
              aF *= vec3(0.5, 0.52, 0.4);
              aG *= uPal[0]; aR *= uPal[1]; aS *= uPal[2]; aF *= uPal[3]; aD *= uPal[4]; aM *= uPal[5];

              float hb = dot(aG, vec3(0.33));
              wScree = clamp(wScree * (1.0 + (mac3.r - 0.5) * 1.6), 0.0, 1.0);
              wForest = clamp(wForest * (1.0 + (mac3.g - 0.5) * 1.2), 0.0, 1.0);
              vec3 alb = aG;
              alb = mix(alb, aM * vec3(0.95, 1.0, 0.8), wMoss * (1.0 - wDirt));
              alb = mix(alb, aF, wForest); nAdd = mix(nAdd, vec3(nF.x, 0.0, nF.y), wForest);
              alb = mix(alb, aD, wDirt); nAdd = mix(nAdd, vec3(nD.x, 0.0, nD.y), wDirt);
              alb = mix(alb, aS, wScree); nAdd = mix(nAdd, vec3(nS.x, 0.0, nS.y) * 1.3, wScree);
              float wR2 = smoothstep(0.35, 0.65, wRock + (hb - 0.25) * 0.5 * (1.0 - wFar));
              alb = mix(alb, aR, wR2); nAdd = mix(nAdd, addR * 1.4, wR2);
              nAdd *= fNear;
              // rive mouillée
              float wet = 1.0 - smoothstep(${(water - 0.3).toFixed(1)}, ${(water + 1.6).toFixed(1)}, vWPos.y);
              alb *= mix(1.0, 0.55, wet);
              float fade = 1.0;
              gNw = normalize(Nb + nAdd * 0.85 * fade);
              gRough = mix(mix(0.93, 0.8, wR2), 0.35, wet);
              diffuseColor.rgb *= alb;
            }`,
          )
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
          .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNw, 0.0)).xyz);');
      },
      'terrain',
    );
    this.material = new URLSearchParams(location.search).get('tm') === '0' ? engine.setupMaterial(new MeshStandardMaterial({ color: 0x778866 }), undefined, 'plain') : mat;
    this.buildMesh();
  }

  /** Maillage grossier, invisible, qui seul projette l'ombre du relief (bien moins de triangles par cascade). */
  private buildShadowProxy(): void {
    const S = this.S;
    const SECT = 160;
    const radii: number[] = [];
    let r = 60;
    while (r < S * 0.62) {
      radii.push(r);
      r = r * 1.045 + 2;
    }
    const pos = new Float32Array(radii.length * (SECT + 1) * 3);
    for (let k = 0; k < radii.length; k++)
      for (let c = 0; c <= SECT; c++) {
        const a = (c / SECT) * Math.PI * 2;
        const x = Math.sin(a) * radii[k], z = -Math.cos(a) * radii[k];
        const o = (k * (SECT + 1) + c) * 3;
        pos[o] = x;
        pos[o + 1] = this.heightAt(x, z) - 1.5 - radii[k] * 0.004;
        pos[o + 2] = z;
      }
    const idx: number[] = [];
    for (let k = 0; k < radii.length - 1; k++)
      for (let c = 0; c < SECT; c++) {
        const a = k * (SECT + 1) + c, b = a + 1, cc = a + SECT + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(idx);
    const mat = new MeshStandardMaterial({ colorWrite: false, depthWrite: false });
    const m = new Mesh(g, mat);
    m.castShadow = true;
    m.frustumCulled = false;
    m.renderOrder = -5;
    this.group.add(m);
  }

  private buildMesh(): void {
    this.buildShadowProxy();
    // anneaux à croissance géométrique
    const S = this.S;
    const radii: number[] = [0];
    let r = 0.6;
    const RMAX = S * 0.5 * 1.45;
    while (r < RMAX) {
      radii.push(r);
      r = r * 1.017 + 0.3;
    }
    radii.push(RMAX);
    const SECT = 512;
    const WEDGES = 16;
    const bands = [0, 0, 0, 0];
    // limites radiales des bandes (indices d'anneaux)
    const lim = [140, 900, 1e9];
    let bi = 0;
    const bandIdx: number[] = [0];
    for (let k = 1; k < radii.length; k++) {
      if (radii[k] > lim[bi]) {
        bandIdx.push(k);
        bi++;
      }
    }
    bandIdx.push(radii.length - 1);
    void bands;
    const tmp = new Vector3();
    const perW = SECT / WEDGES;
    for (let b = 0; b < bandIdx.length - 1; b++) {
      const k0 = bandIdx[b], k1 = bandIdx[b + 1];
      for (let w = 0; w < WEDGES; w++) {
        const rings = k1 - k0 + 1;
        const cols = perW + 1;
        const pos = new Float32Array(rings * cols * 3);
        const nrm = new Float32Array(rings * cols * 3);
        let minY = 1e9, maxY = -1e9;
        for (let kr = 0; kr < rings; kr++) {
          const rad = radii[k0 + kr];
          const eps = Math.max(0.35, rad * 0.006);
          for (let c = 0; c < cols; c++) {
            const a = ((w * perW + c) / SECT) * Math.PI * 2;
            const x = Math.sin(a) * rad, z = -Math.cos(a) * rad;
            const y = this.heightAt(x, z);
            const o = (kr * cols + c) * 3;
            pos[o] = x;
            pos[o + 1] = y;
            pos[o + 2] = z;
            this.normalAt(x, z, tmp, eps);
            nrm[o] = tmp.x;
            nrm[o + 1] = tmp.y;
            nrm[o + 2] = tmp.z;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const idx = new Uint32Array((rings - 1) * (cols - 1) * 6);
        let q = 0;
        for (let kr = 0; kr < rings - 1; kr++)
          for (let c = 0; c < cols - 1; c++) {
            const a = kr * cols + c, bq = a + 1, cq = a + cols, d = cq + 1;
            idx[q++] = a; idx[q++] = bq; idx[q++] = cq;
            idx[q++] = bq; idx[q++] = d; idx[q++] = cq;
          }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(pos, 3));
        g.setAttribute('normal', new BufferAttribute(nrm, 3));
        g.setIndex(new BufferAttribute(idx, 1));
        g.computeBoundingBox();
        g.boundingSphere = new Sphere();
        g.boundingBox!.getBoundingSphere(g.boundingSphere);
        const m = new Mesh(g, this.material);
        m.receiveShadow = true;
        m.castShadow = false;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
  }
}
