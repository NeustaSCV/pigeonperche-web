// Maçonnerie de ruine, commune à tous les niveaux : murs de pierre irréguliers percés d'ouvertures, dallages, lierre,
// abri du râtelier. Le site d'un niveau (src/levels/<id>/site.ts) crée une Masonry, monte ses murs, puis complète.
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { GeoBuilder } from '../core/builder';
import { loadTexSet } from '../core/assets';
import { hash01, makeNoise2D, mulberry32 } from '../core/noise';
import type { Engine } from '../core/engine';
import type { Colliders } from './colliders';
import type { Terrain } from './terrain';
import { WIND_GLSL, type Wind } from './wind';

const UP = new Vector3(0, 1, 0);

export interface Opening {
  /** abscisse du centre le long du mur (m depuis a) */
  s: number;
  w: number;
  /** hauteur de l'appui (0 = brèche jusqu'au sol) */
  sill: number;
  /** hauteur du linteau ; absent = ouvert jusqu'en haut */
  top?: number;
}
export interface WallDef {
  a: [number, number];
  b: [number, number];
  t: number;
  h: number;
  /** 0..1 : irrégularité de l'arase */
  rag: number;
  openings?: Opening[];
  /** hauteur plancher minimale de l'arase */
  minH?: number;
  /** profil imposé : hauteur en fonction de l'abscisse normalisée 0..1 */
  profile?: [number, number][];
}

export interface RubbleSpot {
  x: number; y: number; z: number; s: number;
}

/** Patch commun aux pierres : mousse sur le dessus et au pied (baseY = sol du site), salissures, lichen. */
export function stonePatch(engine: Engine, mossColor: [number, number, number], baseY: number) {
  return (sh: any): void => {
    sh.uniforms.tNoise = { value: engine.noiseTex };
    sh.uniforms.uMoss = { value: new Color(mossColor[0], mossColor[1], mossColor[2]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise;\nuniform vec3 uMoss;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          vec2 q = vWPos.xz * 0.09 + vWPos.y * vec2(0.07, 0.05);
          float n1 = texture2D(tNoise, q).r;
          float n2 = texture2D(tNoise, q * 4.3).g;
          float hh = vWPos.y - ${baseY.toFixed(1)};
          float m = smoothstep(0.52, 0.78, n1 * 0.75 + n2 * 0.25 + max(vWNrm.y, 0.0) * 0.42 - clamp(hh, 0.0, 6.0) * 0.035 + 0.08);
          vec3 moss = uMoss * (0.55 + 0.9 * n2);
          diffuseColor.rgb = mix(diffuseColor.rgb, moss, m * 0.88);
          // pied de mur humide et sombre, lichen clair en hauteur
          diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(-0.2, 1.1, hh + n2 * 0.6));
          float lich = smoothstep(0.7, 0.82, texture2D(tNoise, q * 2.1 + 0.37).b) * (1.0 - m);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.58, 0.36), lich * 0.35);
          diffuseColor.rgb *= vec3(0.9, 0.87, 0.82);
        }`,
      );
  };
}

function ivyLeafTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 70);
  const grad = g.createRadialGradient(0, -10, 4, 0, 0, 60);
  grad.addColorStop(0, '#5d7d2c');
  grad.addColorStop(1, '#2c4416');
  g.fillStyle = grad;
  g.beginPath();
  // feuille de lierre à cinq lobes
  const pts = [[0, 52], [-16, 30], [-52, 34], [-38, 4], [-56, -26], [-22, -22], [0, -58], [22, -22], [56, -26], [38, 4], [52, 34], [16, 30]];
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i % pts.length], b = pts[(i + 1) % pts.length];
    g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  g.fill();
  g.strokeStyle = 'rgba(190,210,130,0.55)';
  g.lineWidth = 2;
  for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
    g.beginPath();
    g.moveTo(0, 46);
    g.lineTo(Math.sin(a) * 44, 46 - Math.cos(a) * 80);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Masonry {
  group = new Group();
  rubble: RubbleSpot[] = [];
  /** points d'ancrage d'herbe haute au pied des murs */
  wallFeet: { x: number; z: number }[] = [];
  /** segments (x0,z0,x1,z1,épaisseur) pour exclure l'herbe sous les murs */
  footprints: { ax: number; az: number; bx: number; bz: number; r: number }[] = [];
  wallMat!: MeshStandardMaterial;
  /** dalles (sols, dallages) */
  flagMat!: MeshStandardMaterial;
  woodMat!: MeshStandardMaterial;
  /** bois calciné */
  charMat!: MeshStandardMaterial;
  noise = makeNoise2D(4242);
  private ivyFaces: { o: Vector3; dir: Vector3; n: Vector3; len: number; h: number }[] = [];

  /** baseY : altitude du sol du site (les murs en partent). */
  constructor(readonly baseY: number) {}

  /** Charge les textures et crée les quatre matières. */
  async init(engine: Engine): Promise<void> {
    const H0 = this.baseY;
    const an = engine.q.anisotropy;
    const [wall, flag, wood, moss] = await Promise.all([loadTexSet('wall', an), loadTexSet('flag', an), loadTexSet('wood', an), loadTexSet('moss', 2)]);
    void moss;
    const mossCol: [number, number, number] = [0.085, 0.13, 0.03];
    this.wallMat = engine.setupMaterial(
      new MeshStandardMaterial({ map: wall.map, normalMap: wall.normalMap, roughnessMap: wall.arm, aoMap: wall.arm, roughness: 1, metalness: 0 }),
      stonePatch(engine, mossCol, H0),
      'stone',
    );
    this.wallMat.normalScale.set(1.6, 1.6);
    this.flagMat = engine.setupMaterial(
      new MeshStandardMaterial({ map: flag.map, normalMap: flag.normalMap, roughnessMap: flag.arm, aoMap: flag.arm, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      stonePatch(engine, mossCol, H0),
      'stone',
    );
    this.woodMat = engine.setupMaterial(new MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.arm, roughness: 1, color: 0x8a7a68 }), undefined, 'wood');
    this.charMat = engine.setupMaterial(new MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughness: 0.95, color: 0x1c1815 }), undefined, 'char');
    this.charMat.normalScale.set(2.5, 2.5);
  }

  /** Dallages irréguliers posés sur le terrain : [x, z, rayon]. */
  paving(terrain: Terrain, list: [number, number, number][]): void {
    const noise = this.noise;
    for (const [x, z, r] of list) {
      const n = 26;
      const b2 = new GeoBuilder();
      const c0 = new Vector3(x, terrain.heightAt(x, z) + 0.035, z);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const r0 = r * (0.82 + 0.3 * noise(Math.cos(a0) * 1.7 + x, Math.sin(a0) * 1.7 + z));
        const r1 = r * (0.82 + 0.3 * noise(Math.cos(a1) * 1.7 + x, Math.sin(a1) * 1.7 + z));
        const p0 = new Vector3(x + Math.cos(a0) * r0, 0, z + Math.sin(a0) * r0);
        const p1 = new Vector3(x + Math.cos(a1) * r1, 0, z + Math.sin(a1) * r1);
        p0.y = terrain.heightAt(p0.x, p0.z) + 0.03;
        p1.y = terrain.heightAt(p1.x, p1.z) + 0.03;
        b2.quad(c0, p1, p0, c0, UP, [x / 1.8, z / 1.8, p1.x / 1.8, p1.z / 1.8, p0.x / 1.8, p0.z / 1.8, x / 1.8, z / 1.8]);
      }
      const m = new Mesh(b2.build(), this.flagMat);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /**
   * Abri du râtelier dans `wb` (bois) : quatre poteaux, deux pannes, chevrons, planches de toit partielles ; râtelier
   * adossé côté sud (z plus grand), caisse de munitions et banc. `rack` : centre de l'abri. Le jeu y pose les armes.
   */
  rackShelter(wb: GeoBuilder, col: Colliders, rack: { x: number; z: number }): void {
    const H0 = this.baseY;
    const R = rack;
    for (const [dx, dz, h] of [[-2.6, -2.4, 2.5], [2.6, -2.4, 2.5], [-2.6, 1.6, 2.9], [2.6, 1.6, 2.9]]) wb.box(R.x + dx, H0 + h / 2 - 0.1, R.z + dz, 0.18, h + 0.2, 0.18, 1.1);
    wb.box(R.x, H0 + 2.5, R.z - 2.4, 5.8, 0.16, 0.2, 1.1);
    wb.box(R.x, H0 + 2.9, R.z + 1.6, 5.8, 0.16, 0.2, 1.1);
    for (let i = 0; i < 7; i++) {
      const x = R.x - 2.7 + i * 0.9;
      const ax = new Vector3(0, -0.1, -1).normalize();
      wb.obox(new Vector3(x, H0 + 2.78, R.z - 0.4), new Vector3(1, 0, 0), new Vector3(0, 1, 0.1).normalize(), ax, 0.05, 0.06, 2.4, 1.1);
    }
    for (let i = 0; i < 12; i++) {
      if (i === 3 || i === 8 || i === 9) continue; // planches manquantes
      const x = R.x - 2.75 + i * 0.5;
      wb.obox(new Vector3(x, H0 + 2.86 + (i % 2) * 0.012, R.z - 0.4), new Vector3(1, 0, 0), new Vector3(0, 1, 0.1).normalize(), new Vector3(0, -0.1, -1).normalize(), 0.23, 0.014, 2.5 - hash01(i, 5) * 0.5, 1.1);
    }
    // râtelier : montants, lisses, tablette
    wb.box(R.x - 1.5, H0 + 0.75, R.z + 1.15, 0.08, 1.5, 0.3, 1);
    wb.box(R.x + 1.5, H0 + 0.75, R.z + 1.15, 0.08, 1.5, 0.3, 1);
    wb.box(R.x, H0 + 0.25, R.z + 1.1, 3.1, 0.06, 0.34, 1);
    wb.box(R.x, H0 + 1.25, R.z + 1.22, 3.1, 0.1, 0.06, 1);
    // caisse de munitions et banc
    wb.box(R.x - 2.0, H0 + 0.2, R.z - 0.6, 0.9, 0.42, 0.5, 1, 0.3);
    wb.box(R.x + 2.0, H0 + 0.42, R.z - 1.0, 1.6, 0.06, 0.4, 1);
    wb.box(R.x + 1.4, H0 + 0.2, R.z - 1.0, 0.08, 0.4, 0.36, 1);
    wb.box(R.x + 2.6, H0 + 0.2, R.z - 1.0, 0.08, 0.4, 0.36, 1);
    col.segs.push({ ax: R.x - 1.5, az: R.z + 1.15, bx: R.x + 1.5, bz: R.z + 1.15, r: 0.3, y0: H0 - 1, y1: H0 + 1.5 });
  }

  /** Monte un mur dans `gb` (wi : numéro du mur, graine de son irrégularité) et pose ses collisions. */
  wall(gb: GeoBuilder, w: WallDef, wi: number, col: Colliders): void {
    const H0 = this.baseY;
    const noise = this.noise;
    const ax = new Vector3(w.b[0] - w.a[0], 0, w.b[1] - w.a[1]);
    const L = ax.length();
    ax.divideScalar(L);
    const az = new Vector3(-ax.z, 0, ax.x);
    const colW = 0.62;
    const n = Math.max(1, Math.round(L / colW));
    const cw = L / n;
    const prof = (u: number): number => {
      if (!w.profile) return 1;
      const p = w.profile;
      for (let i = 0; i < p.length - 1; i++) if (u <= p[i + 1][0]) return p[i][1] + ((p[i + 1][1] - p[i][1]) * (u - p[i][0])) / (p[i + 1][0] - p[i][0]);
      return p[p.length - 1][1];
    };
    const c = new Vector3();
    this.footprints.push({ ax: w.a[0], az: w.a[1], bx: w.b[0], bz: w.b[1], r: w.t / 2 + 0.05 });
    this.ivyFaces.push({ o: new Vector3(w.a[0], H0, w.a[1]).addScaledVector(az, w.t / 2 + 0.03), dir: ax.clone(), n: az.clone(), len: L, h: (w.minH ?? w.h * 0.5) * (w.profile ? 0.6 : 0.95) });
    this.ivyFaces.push({ o: new Vector3(w.a[0], H0, w.a[1]).addScaledVector(az, -w.t / 2 - 0.03), dir: ax.clone(), n: az.clone().negate(), len: L, h: (w.minH ?? w.h * 0.5) * (w.profile ? 0.6 : 0.95) });
    let runStart = -1;
    let runTop = 0;
    const flush = (i: number): void => {
      if (runStart < 0) return;
      // aux deux bouts du mur, la collision couvre l'angle ; aux embrasures, elle s'arrête net
      const s0 = runStart === 0 ? -w.t / 2 : runStart * cw, s1 = i === n ? L + w.t / 2 : i * cw;
      col.segs.push({ ax: w.a[0] + ax.x * s0, az: w.a[1] + ax.z * s0, bx: w.a[0] + ax.x * s1, bz: w.a[1] + ax.z * s1, r: w.t / 2, y0: H0 - 2, y1: H0 + runTop, box: true });
      runStart = -1;
    };
    let runOpen = false;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * cw;
      const f = prof(s / L);
      const nz = 0.5 + 0.5 * noise(s * 0.33 + wi * 13.7, wi * 3.1) + 0.25 * noise(s * 1.3, wi * 7.7);
      let h = w.h * f * (1 - w.rag * Math.min(1, Math.max(0, nz)));
      h = Math.max(Math.min(w.minH ?? 0, w.h * f), h);
      h = Math.round(h / 0.3) * 0.3;
      const jt = (hash01(i, wi * 31) - 0.5) * 0.07;
      const half = w.t / 2 + jt;
      const emit = (y0: number, y1: number): void => {
        if (y1 - y0 < 0.05) return;
        c.set(w.a[0] + ax.x * s, H0 + (y0 + y1) / 2, w.a[1] + ax.z * s);
        gb.obox(c, ax, UP, az, cw / 2 + 0.004, (y1 - y0) / 2, half, 2.6, wi * 0.37, 0);
      };
      let blockTop = h;
      const op = w.openings?.find((o) => Math.abs(s - o.s) < o.w / 2);
      if (op) {
        emit(-0.6, op.sill);
        if (op.top !== undefined && h > op.top + 0.2) emit(op.top, h);
        blockTop = op.sill;
        if (op.sill < 0.1 && (i % 2 === 0)) {
          // gravats d'une brèche ou d'une porte : au pied des jambages, de part et d'autre du mur, jamais dans le passage
          const along = op.s + (hash01(i, 3) < 0.5 ? -1 : 1) * (op.w / 2 + 0.35 + hash01(i, 6) * 0.5);
          const across = (hash01(i, 4) < 0.5 ? -1 : 1) * (w.t / 2 + 0.2 + hash01(i, 5) * 0.7);
          this.rubble.push({ x: w.a[0] + ax.x * along + az.x * across, y: H0, z: w.a[1] + ax.z * along + az.z * across, s: 0.35 + hash01(i, 9) * 0.4 });
        }
      } else emit(-0.6, h);
      // collisions du joueur : tout ce qui dépasse 0,45 m bloque
      if (blockTop > 0.45) {
        // une baie à appui (porte d'étage, créneau) ne bloque que jusqu'à son appui : tronçon séparé
        if (runStart >= 0 && runOpen !== !!op) flush(i);
        runOpen = !!op;
        if (runStart < 0) { runStart = i; runTop = blockTop; } else runTop = Math.max(runTop, blockTop);
      } else flush(i);
      // gravats au pied des parties basses, pierres sur l'arase
      if (hash01(i, wi * 17 + 1) < 0.16) {
        const side = hash01(i, wi) < 0.5 ? 1 : -1;
        const d = w.t / 2 + 0.3 + hash01(i, wi + 5) * 1.3;
        this.rubble.push({ x: w.a[0] + ax.x * s + az.x * d * side, y: H0, z: w.a[1] + ax.z * s + az.z * d * side, s: 0.25 + hash01(i, wi + 8) * 0.55 });
      }
      if (!op && hash01(i, wi * 5 + 2) < 0.22 && h < 5) this.rubble.push({ x: w.a[0] + ax.x * s + az.x * (hash01(i, 77) - 0.5) * 0.5, y: H0 + h - 0.05, z: w.a[1] + ax.z * s + az.z * (hash01(i, 77) - 0.5) * 0.5, s: 0.18 + hash01(i, wi + 2) * 0.22 });
      if (i % 2 === 0) for (const side of [1, -1]) this.wallFeet.push({ x: w.a[0] + ax.x * s + az.x * (w.t / 2 + 0.22) * side, z: w.a[1] + ax.z * s + az.z * (w.t / 2 + 0.22) * side });
    }
    flush(n);
  }

  /**
   * Lierre sur les faces des murs montés (à appeler en dernier). `col` : les touffes y sont déclarées comme objets
   * visibles non solides (`col.soft`), pour que le plan proche de la lunette ne les coupe pas devant une ouverture.
   */
  ivy(engine: Engine, wind: Wind, soft?: Colliders): void {
    const rnd = mulberry32(555);
    const mat = engine.setupMaterial(
      new MeshStandardMaterial({ map: ivyLeafTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 0.7, color: 0xb8c8a0 }),
      (sh) => {
        Object.assign(sh.uniforms, wind.uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\n${WIND_GLSL}`)
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec3 io = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float ig = windGust(io.xz);
            transformed.z += uv.y * 0.6 * (0.02 + 0.05 * ig) * sin(uWindTime * (4.0 + ig * 3.0) + io.x * 5.0 + io.y * 7.0 + io.z * 3.0);`,
          );
      },
      'ivy',
    );
    (mat as any).alphaToCoverage = engine.q.msaa > 0;
    const COUNT = 16000;
    const cells = new Set<string>();
    const mesh = new InstancedMesh(new PlaneGeometry(0.085, 0.085), mat, COUNT);
    const d = new Object3D();
    const col = new Color();
    const m4 = new Matrix4();
    let k = 0;
    const patches = 26;
    for (let pi = 0; pi < patches && k < COUNT; pi++) {
      const f = this.ivyFaces[Math.floor(rnd() * this.ivyFaces.length)];
      const s0 = rnd() * f.len;
      const spread = 1.2 + rnd() * 2.6;
      const top = Math.max(0.4, Math.min(f.h, 1.2 + rnd() * 3.8));
      const per = Math.floor(COUNT / patches);
      m4.lookAt(new Vector3(), f.n, UP);
      for (let i = 0; i < per && k < COUNT; i++) {
        // densité plus forte en bas et au centre de la touffe
        const y = top * Math.pow(rnd(), 1.5);
        const s = s0 + (rnd() + rnd() - 1) * spread * (1 - (y / top) * 0.55);
        if (s < 0 || s > f.len) continue;
        d.position.copy(f.o).addScaledVector(f.dir, s).addScaledVector(f.n, rnd() * 0.07);
        d.position.y += y - 0.1;
        d.quaternion.setFromRotationMatrix(m4);
        d.rotateZ((rnd() - 0.5) * 2.4 + Math.PI);
        d.rotateX((rnd() - 0.5) * 0.9);
        d.rotateY((rnd() - 0.5) * 0.9);
        d.scale.setScalar(0.6 + rnd() * 0.9);
        d.updateMatrix();
        mesh.setMatrixAt(k, d.matrix);
        col.setHSL(0.24 + rnd() * 0.05, 0.45 + rnd() * 0.2, 0.2 + rnd() * 0.16);
        mesh.setColorAt(k, col);
        k++;
        if (soft) cells.add(`${Math.round(d.position.x * 2)},${Math.round(d.position.y * 2)},${Math.round(d.position.z * 2)}`);
      }
    }
    for (const c of cells) { const [x, y, z] = c.split(',').map(Number); soft!.soft.push({ x: x / 2, y: y / 2, z: z / 2, r: 0.5 }); }
    mesh.count = k;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }
}
