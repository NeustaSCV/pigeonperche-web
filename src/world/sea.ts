// Mer : grande nappe d'eau animée par la houle. La même houle est calculée dans le shader (sommets déplacés) et côté
// jeu (`Swell.height`), pour que bouées, balises et coques montent et descendent exactement avec l'eau dessinée.
//
//   const swell = new Swell([{ toward: 110, length: 64, amp: 0.55 }, { toward: 150, length: 38, amp: 0.22 }]);
//   const sea = buildSea(engine, group, { level: 0, x: 0, z: -900, w: 3200, d: 2600, swell });
//   sea.setTime(t);                    // à chaque image, avec le temps de jeu (celui de TargetCtx.time)
//   const y = level + swell.height(x, z, t);
//
// Une carte sans houle (mer d'huile au loin, simple fond de décor) passe `swell: null` : nappe plane, rides seules.
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2, Vector4 } from 'three';
import type { Engine } from '../core/engine';

/** Une onde de houle : cap vers lequel elle se propage (degrés, 0 = nord, sens horaire), longueur d'onde et amplitude (m). */
export interface SwellWave {
  toward: number;
  length: number;
  amp: number;
  /** vitesse relative à celle d'une onde de grand fond (défaut 1) ; phase à l'origine, rad (défaut 0) */
  speed?: number;
  phase?: number;
}

const MAX_WAVES = 4;

/** Houle : somme de quatre ondes au plus. Hauteur et pentes en un point, à un instant. */
export class Swell {
  /** par onde : direction (x, z), nombre d'onde, amplitude, pulsation, phase */
  readonly w: { dx: number; dz: number; k: number; a: number; om: number; ph: number }[];
  constructor(waves: SwellWave[]) {
    this.w = waves.slice(0, MAX_WAVES).map((v) => {
      const b = (v.toward * Math.PI) / 180;
      const k = (2 * Math.PI) / v.length;
      return { dx: Math.sin(b), dz: -Math.cos(b), k, a: v.amp, om: Math.sqrt(9.81 * k) * (v.speed ?? 1), ph: v.phase ?? 0 };
    });
  }
  /** hauteur de l'eau au-dessus de son niveau moyen (m) */
  height(x: number, z: number, t: number): number {
    let h = 0;
    for (const v of this.w) h += v.a * Math.sin(v.k * (v.dx * x + v.dz * z) - v.om * t + v.ph);
    return h;
  }
  /** pentes de la surface (dh/dx, dh/dz) : une coque posée dessus roule et tangue avec elles */
  slope(x: number, z: number, t: number, out: { sx: number; sz: number }): { sx: number; sz: number } {
    let sx = 0, sz = 0;
    for (const v of this.w) {
      const c = v.a * v.k * Math.cos(v.k * (v.dx * x + v.dz * z) - v.om * t + v.ph);
      sx += c * v.dx;
      sz += c * v.dz;
    }
    out.sx = sx;
    out.sz = sz;
    return out;
  }
  /** amplitude maximale (somme des amplitudes) */
  get maxAmp(): number {
    return this.w.reduce((s, v) => s + v.a, 0);
  }
  /** période de l'onde principale (s) */
  get period(): number {
    return this.w.length ? (2 * Math.PI) / this.w[0].om : 0;
  }
}

export interface SeaSpec {
  /** niveau moyen de la mer (m) : le `terrain.waterLevel` de la carte */
  level: number;
  /** rectangle de la nappe animée : centre et dimensions (m) */
  x: number;
  z: number;
  w: number;
  d: number;
  /** houle, ou null pour une nappe plane */
  swell: Swell | null;
  /** côté d'une maille de la nappe animée (m ; défaut : un sixième de la plus courte longueur d'onde, 8 m au moins) */
  cell?: number;
  /** nappe plane jusqu'à l'horizon autour de la nappe animée : demi-côté (m ; défaut 14 000 ; 0 : aucune) */
  horizon?: number;
  /** teinte de l'eau (défaut : bleu-vert sombre de pleine mer) */
  color?: number;
}

export interface Sea {
  material: MeshStandardMaterial;
  mesh: Mesh;
  /** temps de la houle (s) : le temps de jeu, à donner à chaque image */
  setTime(t: number): void;
}

export function buildSea(engine: Engine, group: Group, o: SeaSpec): Sea {
  const uT = { value: 0 };
  const sw = o.swell;
  const n = sw ? sw.w.length : 0;
  const uA = { value: Array.from({ length: MAX_WAVES }, (_, i) => (i < n ? new Vector4(sw!.w[i].dx, sw!.w[i].dz, sw!.w[i].k, sw!.w[i].a) : new Vector4(1, 0, 1, 0))) };
  const uB = { value: Array.from({ length: MAX_WAVES }, (_, i) => (i < n ? new Vector2(sw!.w[i].om, sw!.w[i].ph) : new Vector2(0, 0))) };
  const mat = new MeshStandardMaterial({ color: o.color ?? 0x1b3f4c, roughness: 0.09, metalness: 0, envMapIntensity: 1.4 });
  engine.setupMaterial(
    mat,
    (sh) => {
      sh.uniforms.tNoise = { value: engine.noiseTex };
      sh.uniforms.uSeaT = uT;
      sh.uniforms.uSeaA = uA;
      sh.uniforms.uSeaB = uB;
      const decl = /* glsl */ `
        uniform float uSeaT;
        uniform vec4 uSeaA[${MAX_WAVES}];
        uniform vec2 uSeaB[${MAX_WAVES}];
        varying vec3 vSeaP;
        varying vec2 vSeaS;`;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + decl)
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            // houle : mêmes ondes que Swell.height (src/world/sea.ts)
            vec2 wp = (modelMatrix * vec4(position, 1.0)).xz;
            float hh = 0.0; vec2 ss = vec2(0.0);
            for (int i = 0; i < ${MAX_WAVES}; i++) {
              float ph = uSeaA[i].z * dot(uSeaA[i].xy, wp) - uSeaB[i].x * uSeaT + uSeaB[i].y;
              hh += uSeaA[i].w * sin(ph);
              ss += uSeaA[i].w * uSeaA[i].z * cos(ph) * uSeaA[i].xy;
            }
            transformed.y += hh;
            vSeaS = ss;
            vSeaP = vec3(wp.x, hh, wp.y);
          }`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise;\nuniform float uSeaT;\nvarying vec3 vSeaP;\nvarying vec2 vSeaS;')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          {
            vec2 p = vSeaP.xz;
            float t = uSeaT;
            float e = 0.7;
            // clapot : trois couches de bruit qui glissent, par-dessus la pente de la houle
            #define SH(q) (texture2D(tNoise, (q) * 0.017 + vec2(t * 0.012, t * 0.008)).r + 0.5 * texture2D(tNoise, (q) * 0.071 - vec2(t * 0.021, -t * 0.015)).g + 0.25 * texture2D(tNoise, (q) * 0.27 + vec2(-t * 0.033, t * 0.024)).b)
            float h0 = SH(p), hx = SH(p + vec2(e, 0.0)), hz = SH(p + vec2(0.0, e));
            vec3 nw = normalize(vec3((h0 - hx) * 0.6 - vSeaS.x, 1.0, (h0 - hz) * 0.6 - vSeaS.y));
            normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
            // crêtes un peu plus claires, creux plus sombres : la houle se lit de loin
            diffuseColor.rgb *= 1.0 + 0.16 * clamp(vSeaP.y, -1.5, 1.5);
          }`,
        );
    },
    'sea' + (sw ? n : 0),
  );
  // nappe animée : grille régulière, déjà dans le plan horizontal (pas de rotation : le shader lit la position du monde)
  const minLen = sw && n ? Math.min(...sw.w.filter((v) => v.a > 0.08).map((v) => (2 * Math.PI) / v.k), 1e9) : 1e9;
  const cell = sw && n ? Math.max(8, o.cell ?? minLen / 6) : Math.max(o.w, o.d);
  const nx = Math.min(256, Math.max(1, Math.round(o.w / cell))), nz = Math.min(256, Math.max(1, Math.round(o.d / cell)));
  const geo = new PlaneGeometry(o.w, o.d, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, mat);
  mesh.position.set(o.x, o.level, o.z);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  // jusqu'à l'horizon : un anneau plan autour de la nappe (quatre bandes), au niveau moyen
  const H = o.horizon ?? 14000;
  if (H > 0) {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
    const quads: [number, number, number, number][] = [[-H, -H, H, z0], [-H, z1, H, H], [-H, z0, x0, z1], [x1, z0, H, z1]];
    const pos: number[] = [], nrm: number[] = [];
    for (const [ax, az, bx, bz] of quads) {
      if (bx <= ax || bz <= az) continue;
      pos.push(ax, 0, az, ax, 0, bz, bx, 0, az, bx, 0, az, ax, 0, bz, bx, 0, bz);
      for (let i = 0; i < 6; i++) nrm.push(0, 1, 0);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    // la houle y est éteinte : amplitude nulle à travers un second jeu d'uniformes serait un shader de plus ;
    // on garde la même matière et on laisse la houle courir jusqu'à l'horizon sur ces grandes mailles (invisible :
    // les sommets sont à des kilomètres, seule la normale du clapot compte)
    const far = new Mesh(g, mat);
    far.position.y = o.level - (sw ? Math.min(0.6, sw.maxAmp) : 0.02);
    far.receiveShadow = false;
    far.frustumCulled = false;
    group.add(far);
  }
  return { material: mat, mesh, setTime: (t) => { uT.value = t; } };
}
