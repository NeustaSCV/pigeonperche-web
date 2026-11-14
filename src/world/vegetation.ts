// Végétation : herbe instanciée animée, arbres (maillages proches + imposteurs croisés), rochers, fougères.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  HemisphereLight,
  DirectionalLight,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { loadModel } from '../core/assets';
import type { Engine } from '../core/engine';
import { hash01, mulberry32, smoothstep } from '../core/noise';
import type { PostDef, Sightline } from '../levels/types';
import type { Seg } from './colliders';
import type { Terrain } from './terrain';
import { WIND_GLSL, type Wind } from './wind';

interface Part {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  leaf: boolean;
}
interface Proto {
  parts: Part[];
  box: Box3;
}

/** Découpe un modèle en prototypes (un par nœud racine), recentrés sur leur base. */
function protosOf(model: Group | null): Proto[] {
  if (!model) return [];
  const out: Proto[] = [];
  model.updateMatrixWorld(true);
  for (const top of model.children) {
    const parts: Part[] = [];
    const inv = new Matrix4().makeTranslation(-top.position.x, -top.position.y, -top.position.z);
    top.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone();
      g.applyMatrix4(new Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const mat = m.material as MeshStandardMaterial;
      parts.push({ geometry: g, material: mat, leaf: mat.alphaTest > 0 || mat.transparent });
    });
    if (!parts.length) continue;
    const box = new Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    const c = box.getCenter(new Vector3());
    const t = new Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
    for (const p of parts) p.geometry.applyMatrix4(t);
    box.applyMatrix4(t);
    out.push({ parts, box });
  }
  return out;
}

/** Balancement en espace monde inséré entre instanceMatrix et la vue. */
function swayPatch(wind: Wind, height: number, leaf: number, strength = 1) {
  return (sh: any): void => {
    Object.assign(sh.uniforms, wind.uniforms);
    sh.uniforms.uSwayH = { value: height };
    sh.uniforms.uLeaf = { value: leaf };
    sh.uniforms.uSwayK = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uSwayH;\nuniform float uLeaf;\nuniform float uSwayK;`)
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 wo = vec3(instanceMatrix[3]);
          float sH = uSwayH * length(instanceMatrix[1].xyz);
        #else
          vec3 wo = vec3(modelMatrix[3]);
          float sH = uSwayH;
        #endif
        {
          float hgt = max(mvPosition.y - wo.y, 0.0);
          float g = windGust(wo.xz);
          float sp = uWindSpeed * (0.45 + g) * uSwayK;
          float rad = length(mvPosition.xz - wo.xz);
          float ph = wo.x * 0.37 + wo.z * 0.23;
          float hn = hgt / sH;
          float trunk = hn * hn * sH * 0.0042 * sp * (1.0 + 0.6 * sin(uWindTime * 1.1 + ph));
          float branch = rad * 0.014 * sp * sin(uWindTime * 2.7 + ph * 3.0 + hgt * 0.9);
          float flutter = uLeaf * 0.0045 * sp * sin(uWindTime * 9.0 + dot(mvPosition.xyz, vec3(7.1, 5.3, 6.7)));
          mvPosition.xz += uWindDir * (trunk + branch) + flutter;
          mvPosition.y += branch * 0.35 + flutter;
        }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
}

const bearingOf = (x: number, z: number): number => ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;

/**
 * Ce que la végétation doit savoir du site de tir (à l'origine) et de ses lignes de visée. Tout est donné par le
 * niveau ; les semis aléatoires (herbe, rochers, touffes, forêts lointaines) sont communs.
 */
export interface VegetationSpec {
  /** altitude du sol du site */
  baseY: number;
  /** rayon planté d'arbres autour du site (m) */
  treeRange: number;
  posts: Record<string, PostDef>;
  /** aucun arbre ne masque une ligne poste → cible */
  sightlines: Sightline[];
  /** secteurs de tir à garder dégagés près du site : [azimut, demi-largeur] en degrés */
  corridors: [number, number][];
  /**
   * arbres détaillés posés à la main (sp : 0 conifère, 1 conifère clair, 2 feuillu) ; complétés au hasard jusqu'à
   * `trees.nearCount` (13 par défaut)
   */
  nearTrees: { x: number; z: number; s: number; sp: number }[];
  /**
   * Arbres (facultatif). `nearMix` : poids des essences des arbres détaillés tirés au hasard [conifère, conifère
   * clair, feuillu] (défaut [0,6 ; 0,4 ; 0]) ; `nearCount` : nombre d'arbres détaillés (défaut 13) ; `density` :
   * densité des forêts lointaines (défaut 1) ; `broadleaf` : part de feuillus dans l'étage bas (défaut 0,7).
   */
  trees?: { nearMix?: [number, number, number]; nearCount?: number; density?: number; broadleaf?: number };
  /**
   * Rochers semés d'office (facultatif) : `count` (défaut 300), dont `near` à moins de 30 m du site (défaut 26),
   * les autres jusqu'à `radius` (défaut 180 m). `count: 0` : aucun (restent `rubble` et `boulders`).
   */
  rocks?: { count?: number; near?: number; radius?: number };
  /** touffes semées autour du site (défaut 60) */
  clumps?: number;
  /** zones dallées (x, z, rayon) : ni herbe ni rochers */
  paved: [number, number, number][];
  /** emprises des murs : pas d'herbe dessous */
  footprints: { ax: number; az: number; bx: number; bz: number; r: number }[];
  /** gravats (au sol ou sur l'arase des murs) rendus en rochers */
  rubble: { x: number; y: number; z: number; s: number }[];
  /** pieds de murs : fougères et touffes */
  wallFeet: { x: number; z: number }[];
  /** autre zone sans herbe (planchers, escaliers) */
  grassBlocked?(x: number, z: number): boolean;
  /** passages gardés libres de rochers : disques (x, z, rayon) et couloirs (ax, az, bx, bz, rayon) */
  lanes: [number, number, number][];
  laneSegs: [number, number, number, number, number][];
  /** gros blocs en bord de plateau : [azimut, distance, échelle] */
  boulders: [number, number, number][];
  /** bois mort : [x, z, rotation, échelle] */
  deadwood: [number, number, number, number][];
}

export class Vegetation {
  group = new Group();
  /** positions des arbres proches (pour le bruissement) */
  nearTrees: Vector3[] = [];
  /** collisions des rochers du sommet, à ajouter aux collisions du joueur */
  rockSegs: Seg[] = [];
  /** sphères englobantes de ce qui se dresse à moins de 170 m du site (arbres, rochers, touffes, bois mort) : lues par le plan proche de la lunette */
  obstacles: { x: number; y: number; z: number; r: number }[] = [];
  private chunks: { mesh: Mesh; geo: InstancedBufferGeometry; total: number; center: Vector3 }[] = [];
  private grassUniforms = { uPlayer: { value: new Vector3(0, -999, 0) }, uFlat: { value: 0 }, uAim: { value: new Vector3(0, 0, -1) } };
  private tmp = new Vector3();
  private site!: VegetationSpec;

  private inCorridor(x: number, z: number): boolean {
    const b = bearingOf(x, z);
    for (const [c, w] of this.site.corridors) {
      const d = Math.abs(((b - c + 540) % 360) - 180);
      if (d < w) return true;
    }
    return false;
  }

  async build(engine: Engine, terrain: Terrain, wind: Wind, site: VegetationSpec): Promise<void> {
    this.site = site;
    const ruin = site;
    const [conifer, coniferB, broadleaf, rockA, rockB, rockC, rockD, shrub, clump, dead] = await Promise.all(
      ['conifer', 'conifer_b', 'broadleaf', 'rock_a', 'rock_b', 'rock_c', 'rock_d', 'shrub', 'clump', 'deadwood'].map(loadModel),
    );
    this.buildGrass(engine, terrain, wind, ruin);
    this.buildTrees(engine, terrain, wind, protosOf(conifer)[0], protosOf(coniferB)[0], protosOf(broadleaf)[0]);
    this.buildRocks(engine, terrain, ruin, [...protosOf(rockA), ...protosOf(rockB)], protosOf(rockC)[0], protosOf(rockD)[0]);
    this.buildUnderstory(engine, terrain, wind, ruin, protosOf(shrub), protosOf(clump), protosOf(dead)[0]);
  }

  // ------------------------------------------------------------------ herbe
  private buildGrass(engine: Engine, terrain: Terrain, wind: Wind, ruin: VegetationSpec): void {
    const base = new BufferGeometry();
    // brin : x = côté (-1..1), y = t (0..1). Deux niveaux + pointe.
    base.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 0.5, 0, 1, 0.5, 0, 0, 1, 0]), 3));
    base.setAttribute('normal', new BufferAttribute(new Float32Array(15), 3));
    base.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const gm = terrain.grassMean;
    const bl = terrain.palette.blades ?? {};
    const bt = bl.tint ?? [1, 1, 1];
    const root = new Color(gm[0] * 0.55 * bt[0], gm[1] * 0.75 * bt[1], gm[2] * 0.35 * bt[2]);
    const tip = new Color((gm[0] * 1.9 + 0.03) * bt[0], (gm[1] * 2.1 + 0.05) * bt[1], gm[2] * 0.9 * bt[2]);
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: DoubleSide });
    engine.setupMaterial(
      mat,
      (sh) => {
        Object.assign(sh.uniforms, wind.uniforms, this.grassUniforms);
        sh.uniforms.uRoot = { value: root };
        sh.uniforms.uTip = { value: tip };
        sh.uniforms.uFlower = { value: 1 - 0.03 * (bl.flowers ?? 1) };
        sh.vertexShader = sh.vertexShader
          .replace(
            '#include <common>',
            `#include <common>\n${WIND_GLSL}\nattribute vec3 iPos;\nattribute vec4 iData;\nuniform vec3 uPlayer;\nuniform float uFlat;\nuniform vec3 uAim;\nvarying float vT;\nvarying float vTint;\nvec2 gBend;`,
          )
          .replace(
            '#include <beginnormal_vertex>',
            /* glsl */ `
            float gt = position.y;
            float gH = iData.y;
            // herbe couchée devant le tireur en position : le champ de la lunette reste dégagé
            // (rayon court tout autour, long couloir dans l'axe de visée : les brins lointains masquaient encore la cible)
            vec2 gTo = iPos.xz - uPlayer.xz;
            float gDist = length(gTo);
            float gAxis = max(0.0, dot(gTo / max(gDist, 1e-3), normalize(uAim.xz)));
            float gReach = mix(4.5, 26.0, smoothstep(0.9, 0.985, gAxis));
            gH *= mix(1.0, 0.12, uFlat * (1.0 - smoothstep(gReach * 0.3, gReach, gDist)));
            vec2 gFwd = vec2(cos(iData.x), sin(iData.x));
            float gG = windGust(iPos.xz);
            float gR = windRipple(iPos.xz + iData.z * 3.0);
            float gLean = (0.12 + 0.6 * gG + 0.3 * gR * (0.25 + gG)) * uWindSpeed * 0.13;
            gBend = uWindDir * gLean + gFwd * (0.22 + 0.25 * iData.z);
            vec2 gDp = iPos.xz - uPlayer.xz;
            float gPd = length(gDp);
            gBend += (gDp / max(gPd, 0.001)) * (1.0 - smoothstep(0.25, 1.0, gPd)) * step(abs(iPos.y - uPlayer.y), 1.4) * 1.3;
            vec3 objectNormal = normalize(vec3(-gBend.x * gt * 0.9, 1.0, -gBend.y * gt * 0.9));`,
          )
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            vec2 gSd = vec2(-gFwd.y, gFwd.x);
            float gC = gt * gt;
            float gW = 0.014 + 0.012 * iData.z;
            vec3 transformed = iPos + vec3(gSd.x, 0.0, gSd.y) * position.x * gW * (1.0 - gt * 0.8)
              + vec3(gBend.x, 0.0, gBend.y) * gC * gH
              + vec3(0.0, gH * gt * (1.0 - 0.3 * gC * min(dot(gBend, gBend), 1.5)), 0.0);
            vT = gt;
            vTint = iData.w;`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRoot;\nuniform vec3 uTip;\nuniform float uFlower;\nvarying float vT;\nvarying float vTint;')
          .replace(
            '#include <map_fragment>',
            /* glsl */ `
            vec3 gc = mix(uRoot, uTip, vT * vT);
            gc *= mix(vec3(0.8, 0.95, 0.75), vec3(1.35, 1.2, 0.8), fract(vTint * 7.0));
            // fleurs : quelques pointes claires
            gc = mix(gc, vTint > 0.985 ? vec3(0.9, 0.85, 0.5) : vec3(0.85, 0.85, 0.8), step(uFlower, vTint) * smoothstep(0.82, 0.95, vT));
            diffuseColor.rgb = gc * mix(0.35, 1.0, vT);`,
          )
          .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
      },
      'grass',
    );

    // côté d'un pavé d'herbe (un appel de dessin chacun) : 8 m ; une herbe clairsemée se contente de pavés plus grands
    const CH = bl.chunk ?? 8;
    const R = 72;
    const dens = engine.q.grass * (bl.density ?? 1);
    const hk = bl.height ?? 1;
    const rnd = mulberry32(1234);
    const nrm = new Vector3();
    const blocked = (x: number, z: number): boolean => {
      for (const f of ruin.footprints) {
        const dx = f.bx - f.ax, dz = f.bz - f.az;
        let t = ((x - f.ax) * dx + (z - f.az) * dz) / (dx * dx + dz * dz);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - f.ax - dx * t, z - f.az - dz * t) < f.r) return true;
      }
      for (const [px, pz, pr] of ruin.paved) if (Math.hypot(x - px, z - pz) < pr * 0.8) return true;
      return ruin.grassBlocked?.(x, z) ?? false;
    };
    for (let cz = -R; cz < R; cz += CH)
      for (let cx = -R; cx < R; cx += CH) {
        const mx = cx + CH / 2, mz = cz + CH / 2;
        const rc = Math.hypot(mx, mz);
        if (rc > R) continue;
        const perM2 = (rc < 36 ? 85 : 85 * (1 - smoothstep(34, 70, rc)) + 14) * dens;
        const n = Math.floor(perM2 * CH * CH);
        const pos = new Float32Array(n * 3);
        const dat = new Float32Array(n * 4);
        let k = 0;
        let ymin = 1e9, ymax = -1e9;
        for (let i = 0; i < n; i++) {
          const x = cx + rnd() * CH, z = cz + rnd() * CH;
          const r = Math.hypot(x, z);
          if (r > 34) {
            terrain.normalAt(x, z, nrm, 0.4);
            if (nrm.y < 0.74 + rnd() * 0.1) continue;
          }
          if (r < 34 && blocked(x, z)) continue;
          const y = terrain.heightAt(x, z);
          // taches de hauteur : herbes hautes par plaques
          const patch = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2.0) * Math.cos(z * 0.19 + 1.3);
          const h = (0.16 + 0.34 * patch + rnd() * 0.16) * (r > 34 ? 1.25 : 1) * hk;
          pos[k * 3] = x; pos[k * 3 + 1] = y - 0.02; pos[k * 3 + 2] = z;
          dat[k * 4] = rnd() * Math.PI * 2; dat[k * 4 + 1] = h; dat[k * 4 + 2] = rnd(); dat[k * 4 + 3] = rnd();
          if (y < ymin) ymin = y;
          if (y > ymax) ymax = y;
          k++;
        }
        if (k < 8) continue;
        const g = new InstancedBufferGeometry();
        g.index = base.index;
        g.setAttribute('position', base.getAttribute('position'));
        g.setAttribute('normal', base.getAttribute('normal'));
        g.setAttribute('iPos', new InstancedBufferAttribute(pos.subarray(0, k * 3), 3));
        g.setAttribute('iData', new InstancedBufferAttribute(dat.subarray(0, k * 4), 4));
        g.instanceCount = k;
        const center = new Vector3(mx, (ymin + ymax) / 2, mz);
        g.boundingSphere = new Sphere(center, Math.hypot(CH * 0.75, (ymax - ymin) / 2 + 1));
        const m = new Mesh(g, mat);
        m.receiveShadow = true;
        m.castShadow = false;
        m.matrixAutoUpdate = false;
        this.group.add(m);
        this.chunks.push({ mesh: m, geo: g, total: k, center });
      }
  }

  // ------------------------------------------------------------------ arbres
  private bakeImpostor(engine: Engine, proto: Proto): { tex: Texture; w: number; h: number } {
    const size = proto.box.getSize(new Vector3());
    const w = Math.max(size.x, size.z) * 1.04;
    const h = size.y * 1.02;
    const rt = new WebGLRenderTarget(1024, 2048, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, depthBuffer: true });
    const sc = new Scene();
    for (const p of proto.parts) {
      const m = new Mesh(p.geometry, new MeshLambertMaterial({ map: p.material.map, alphaTest: p.leaf ? 0.4 : 0, side: DoubleSide, color: p.leaf ? 0xffffff : 0xb0a090 }));
      sc.add(m);
    }
    // éclairage neutre venu du haut : donne du volume à la couronne sans figer la direction du soleil
    sc.add(new HemisphereLight(0xffffff, 0x556048, 2.2));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.4, 1, 0.8);
    sc.add(key);
    const cam = new OrthographicCamera(-w / 2, w / 2, h, 0, 0.1, 100);
    cam.position.set(0, 0, 40);
    cam.lookAt(0, 0, 0);
    cam.position.set(0, 0, 40);
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld();
    const r = engine.renderer;
    const prev = r.getRenderTarget();
    const cc = new Color();
    r.getClearColor(cc);
    const ca = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(new Color(0.03, 0.05, 0.02), 0);
    r.clear();
    r.render(sc, cam);
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
    return { tex: rt.texture, w, h };
  }

  private impostorGeometry(w: number, h: number): BufferGeometry {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let v = 0;
    for (let a = 0; a < 2; a++) {
      const dx = a === 0 ? 1 : 0, dz = a === 0 ? 0 : 1;
      for (let side = 0; side < 1; side++) {
        const s = side === 0 ? 1 : -1;
        pos.push(-dx * w / 2 * s, 0, -dz * w / 2 * s, dx * w / 2 * s, 0, dz * w / 2 * s, dx * w / 2 * s, h, dz * w / 2 * s, -dx * w / 2 * s, h, -dz * w / 2 * s);
        const u0 = side === 0 ? 0 : 1, u1 = 1 - u0;
        uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
        if (a === 0 ? side === 0 : side === 1) idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        else idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
        v += 4;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    return g;
  }

  private buildTrees(engine: Engine, terrain: Terrain, wind: Wind, conifer?: Proto, coniferB?: Proto, broadleaf?: Proto): void {
    const species = [conifer, coniferB, broadleaf].filter(Boolean) as Proto[];
    if (!species.length) return;
    const d = new Object3D();
    const col = new Color();
    const rnd = mulberry32(77);

    // --- arbres détaillés autour de la ruine ---
    const lines = this.site.sightlines, posts = this.site.posts, baseY = this.site.baseY;
    const near: { x: number; z: number; s: number; sp: number }[] = this.site.nearTrees.map((n) => ({ ...n }));
    const tr = this.site.trees ?? {};
    const mix = tr.nearMix ?? [0.6, 0.4, 0];
    const mixSum = mix[0] + mix[1] + mix[2] || 1;
    const fol = terrain.palette.foliage ?? [1, 1, 1];
    const valleyY = terrain.valleyY;
    // le modèle de feuillu est petit : même échelle de base que ses imposteurs
    const baseScale = (sp: number): number => (sp === 2 ? 2.2 : 1);
    for (let tries = 0; tries < 400 && near.length < (tr.nearCount ?? 13); tries++) {
      const a = rnd() * Math.PI * 2, r = 42 + rnd() * 80;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      if (this.inCorridor(x, z)) continue;
      if (terrain.normalAt(x, z, this.tmp, 1).y < 0.62) continue;
      if (near.some((n) => Math.hypot(n.x - x, n.z - z) < 7)) continue;
      const s = 0.8 + rnd() * 0.7, u = rnd() * mixSum;
      near.push({ x, z, s, sp: u < mix[0] ? 0 : u < mix[0] + mix[1] ? 1 : 2 });
    }
    for (const n of near) if (n.sp >= species.length) n.sp = species.length - 1;
    for (let si = 0; si < species.length; si++) {
      const proto = species[si];
      const list = near.filter((n) => n.sp === si || species.length === 1);
      if (!list.length && si >= 2) continue;
      const H = proto.box.max.y;
      for (const part of proto.parts) {
        const mat = part.material.clone();
        if (part.leaf) {
          mat.alphaTest = 0.42;
          mat.side = DoubleSide;
          mat.transparent = false;
          (mat as any).alphaToCoverage = engine.q.msaa > 0;
          mat.color.setRGB(0.82 * fol[0], 0.9 * fol[1], 0.72 * fol[2]);
          mat.roughness = 0.8;
        }
        engine.setupMaterial(mat, swayPatch(wind, H, part.leaf ? 1 : 0), 'tree' + si + (part.leaf ? 'L' : 'B'));
        const im = new InstancedMesh(part.geometry, mat, list.length);
        list.forEach((n, i) => {
          d.position.set(n.x, terrain.heightAt(n.x, n.z) - 0.25, n.z);
          d.rotation.set(0, hash01(i, si * 7 + 3) * 6.28, 0);
          d.scale.setScalar(n.s * baseScale(si));
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        });
        im.castShadow = false;
        im.receiveShadow = true;
        im.frustumCulled = false;
        this.group.add(im);
      }
      for (const n of list) {
        this.nearTrees.push(new Vector3(n.x, terrain.heightAt(n.x, n.z) + 6, n.z));
        const hh = (H * n.s * baseScale(si)) / 2;
        this.obstacles.push({ x: n.x, y: terrain.heightAt(n.x, n.z) + hh, z: n.z, r: hh + 0.5 });
      }
    }

    // --- imposteurs : forêts de versant et feuillus de vallée ---
    const lineTargetY = (L: { x: number; z: number; y: number }): number => terrain.heightAt(L.x, L.z) + L.y;
    const lists: Matrix4[][] = species.map(() => []);
    const tints: Color[][] = species.map(() => []);
    const CELL = 11;
    const LIM = this.site.treeRange;
    // les arbres détaillés projettent leur ombre par un imposteur invisible (4 triangles au lieu de 29 000)
    const proxies: Matrix4[][] = species.map(() => []);
    for (const n of near) {
      d.position.set(n.x, terrain.heightAt(n.x, n.z) - 0.25, n.z);
      d.rotation.set(0, 0.6, 0);
      d.scale.setScalar(n.s * baseScale(n.sp));
      d.updateMatrix();
      proxies[Math.min(n.sp, species.length - 1)].push(d.matrix.clone());
    }
    for (let z = -LIM; z < LIM; z += CELL)
      for (let x = -LIM; x < LIM; x += CELL) {
        const jx = x + hash01(x, z) * CELL, jz = z + hash01(z, x + 99) * CELL;
        const r = Math.hypot(jx, jz);
        if (r < 46 || r > LIM) continue;
        if (r < 125 && near.some((n) => Math.hypot(n.x - jx, n.z - jz) < 9)) continue;
        const f = terrain.splatAt(jx, jz, 2);
        // près du sommet : bosquets hors des secteurs de tir
        const local = r < 150 ? (this.inCorridor(jx, jz) ? 0 : 0.5) : 0;
        const p = Math.max(f * (r > 1500 ? 0.4 : 0.7), local) * (tr.density ?? 1);
        if (hash01(x * 3 + 1, z * 5 + 7) > p) continue;
        const y = terrain.heightAt(jx, jz);
        // rive du lac de la carte d'origine (fond de vallée à 0) ; ailleurs, seulement s'il y a un plan d'eau
        if (y - valleyY < 9.5 && (valleyY === 0 || terrain.spec.waterLevel !== null)) continue;
        // aucun arbre ne doit masquer une ligne de visée poste → cible
        let masks = false;
        for (const L of lines) {
          const P = posts[L.post];
          const dx = L.x - P.x, dz = L.z - P.z;
          const len = Math.hypot(dx, dz);
          const t = ((jx - P.x) * dx + (jz - P.z) * dz) / len;
          if (t < 20 || t > len + 30) continue;
          const lat = Math.abs(((jx - P.x) * dz - (jz - P.z) * dx) / len);
          if (lat > 9 + t * 0.022) continue;
          const eyeY = baseY + (P.y ?? 0) + 0.5;
          const los = eyeY + ((lineTargetY(L) - eyeY) * Math.min(t, len)) / len;
          if (los - y < 30) { masks = true; break; }
        }
        if (masks) continue;
        let sp = 0;
        const lowland = y - valleyY < 70 + hash01(x, z * 3) * 50;
        if (species.length >= 3 && lowland && hash01(x + 5, z) < (tr.broadleaf ?? 0.7)) sp = 2;
        else if (species.length >= 2 && hash01(x, z + 13) < 0.35) sp = 1;
        const baseS = sp === 2 ? 2.2 : 1.0;
        d.position.set(jx, y - 0.3, jz);
        d.rotation.set(0, hash01(x, z + 1) * 6.28, 0);
        d.scale.setScalar(baseS * (0.75 + hash01(x + 2, z) * 0.75));
        d.updateMatrix();
        lists[sp].push(d.matrix.clone());
        if (r < 170) { const hh = (species[sp].box.max.y * d.scale.y) / 2; this.obstacles.push({ x: jx, y: y + hh, z: jz, r: hh + 0.5 }); }
        const v = 0.78 + hash01(x, z + 5) * 0.4;
        tints[sp].push(sp === 2 ? col.clone().setRGB(v * 1.05 * fol[0], v * 1.02 * fol[1], v * 0.72 * fol[2]) : col.clone().setRGB(v * 0.92 * fol[0], v * fol[1], v * 0.86 * fol[2]));
      }
    species.forEach((proto, si) => {
      if (!lists[si].length) return;
      const bk = this.bakeImpostor(engine, proto);
      const H = bk.h;
      const mat = new MeshStandardMaterial({ map: bk.tex, alphaTest: 0.36, roughness: 0.9, metalness: 0, side: DoubleSide });
      (mat as any).alphaToCoverage = engine.q.msaa > 0;
      const sway = swayPatch(wind, H, 0, 1.4);
      engine.setupMaterial(
        mat,
        (sh) => {
          sway(sh);
          // normales « sphériques » : chaque arbre a un côté éclairé et un côté ombre
          sh.vertexShader = sh.vertexShader.replace(
            '#include <beginnormal_vertex>',
            `vec3 objectNormal = normalize(vec3(position.x * 1.25, (uv.y - 0.3) * ${H.toFixed(2)} * 0.45 + 0.6, position.z * 1.25));`,
          );
          sh.fragmentShader = sh.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>\ndiffuseColor.rgb *= 0.62 * mix(0.6, 1.1, smoothstep(0.0, 0.9, vMapUv.y));`,
          ).replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
        },
        'impostor' + si,
      );
      const geoI = this.impostorGeometry(bk.w, bk.h);
      const SEC = 10;
      const buckets: number[][] = Array.from({ length: SEC * 3 }, () => []);
      const pv = new Vector3();
      lists[si].forEach((m, i) => {
        pv.setFromMatrixPosition(m);
        const a = Math.floor(((Math.atan2(pv.x, pv.z) + Math.PI) / (Math.PI * 2)) * SEC) % SEC;
        const rr = Math.hypot(pv.x, pv.z);
        // trois couronnes : les cascades d'ombre proches ne dessinent que les arbres proches
        buckets[a + (rr > 900 ? SEC * 2 : rr > 260 ? SEC : 0)].push(i);
      });
      let im!: InstancedMesh;
      for (const bkt of buckets) {
        if (!bkt.length) continue;
        im = new InstancedMesh(geoI, mat, bkt.length);
        bkt.forEach((src, i) => {
          im.setMatrixAt(i, lists[si][src]);
          im.setColorAt(i, tints[si][src]);
        });
        im.computeBoundingSphere();
        im.castShadow = true;
        im.receiveShadow = true;
        this.group.add(im);
      }
      if (proxies[si].length) {
        const pm = mat.clone();
        pm.colorWrite = false;
        pm.depthWrite = false;
        const px = new InstancedMesh(im.geometry, pm, proxies[si].length);
        proxies[si].forEach((m, i) => px.setMatrixAt(i, m));
        px.castShadow = true;
        px.frustumCulled = false;
        this.group.add(px);
      }
    });
  }

  // ------------------------------------------------------------------ rochers
  private buildRocks(engine: Engine, terrain: Terrain, ruin: VegetationSpec, sets: Proto[], boulderC?: Proto, boulderD?: Proto): void {
    const baseY = ruin.baseY;
    const d = new Object3D();
    const rnd = mulberry32(909);
    const n = new Vector3();
    const rt = terrain.palette.rocks;
    const rockTint = rt ? new Color(rt[0], rt[1], rt[2]) : null;
    const rk = ruin.rocks ?? {};
    const rockCount = rk.count ?? 300, rockNear = rk.near ?? 26, rockSpan = (rk.radius ?? 180) - 30;
    const place = (proto: Proto, items: { x: number; y: number; z: number; s: number; sink?: number }[], key: string, tint?: number): void => {
      if (!items.length) return;
      for (const part of proto.parts) {
        const mat = part.material.clone();
        if (tint !== undefined) mat.color.set(tint);
        if (rockTint) mat.color.multiply(rockTint);
        engine.setupMaterial(mat, undefined, 'rock' + key);
        const im = new InstancedMesh(part.geometry, mat, items.length);
        items.forEach((it, i) => {
          d.position.set(it.x, it.y - (it.sink ?? 0.12) * it.s, it.z);
          d.rotation.set((hash01(i, 1) - 0.5) * 0.5, hash01(i, 2) * 6.28, (hash01(i, 3) - 0.5) * 0.5);
          d.scale.setScalar(it.s);
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        });
        im.castShadow = im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
      const br = proto.box.getSize(new Vector3()).length() / 2;
      for (const it of items) if (Math.hypot(it.x, it.z) < 170) this.obstacles.push({ x: it.x, y: it.y + br * it.s * 0.4, z: it.z, r: br * it.s });
      // collision du joueur : un rocher du sommet qui dépasse 0,45 m ne se traverse pas (capsule couchée sur son grand axe)
      const bs = proto.box.getSize(new Vector3()), bc = proto.box.getCenter(new Vector3());
      items.forEach((it, i) => {
        if (Math.hypot(it.x, it.z) > 50) return;
        const top = (proto.box.max.y - (it.sink ?? 0.12)) * it.s;
        const short = Math.min(bs.x, bs.z) * it.s * 0.5 * 0.8;
        if (top < 0.45 || short < 0.22 || it.y > baseY + 0.5) return;
        const yaw = hash01(i, 2) * 6.28;
        const half = Math.max(0.005, (Math.max(bs.x, bs.z) - Math.min(bs.x, bs.z)) * it.s * 0.5 * 0.8);
        // grand axe du rocher (X ou Z local) et centre de sa boîte, tournés comme l'instance
        const lx = bs.x >= bs.z ? 1 : 0, lz = 1 - lx;
        const ux = lx * Math.cos(yaw) + lz * Math.sin(yaw), uz = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
        const cx = it.x + (bc.x * Math.cos(yaw) + bc.z * Math.sin(yaw)) * it.s, cz = it.z + (-bc.x * Math.sin(yaw) + bc.z * Math.cos(yaw)) * it.s;
        this.rockSegs.push({ ax: cx - ux * half, az: cz - uz * half, bx: cx + ux * half, bz: cz + uz * half, r: short, y0: it.y - 1.5, y1: it.y + top });
      });
    };
    // passages gardés libres : brèches et postes, escaliers, point de départ, portes et arcades
    const lanes = ruin.lanes;
    const inLane = (x: number, z: number, m: number): boolean => {
      if (lanes.some(([lx, lz, lr]) => Math.hypot(x - lx, z - lz) < lr + m)) return true;
      for (const [ax, az, bx, bz, cr] of ruin.laneSegs) {
        const dx = bx - ax, dz = bz - az;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < cr + m) return true;
      }
      return false;
    };
    // rochers moussus dispersés sur le sommet et ses pentes
    if (sets.length) {
      const per: { x: number; y: number; z: number; s: number }[][] = sets.map(() => []);
      for (let i = 0; i < rockCount; i++) {
        const a = rnd() * Math.PI * 2;
        const r = i < rockNear ? 6 + rnd() * 24 : 30 + Math.pow(rnd(), 1.4) * rockSpan;
        const x = Math.sin(a) * r, z = -Math.cos(a) * r;
        if (r < 30 && ruin.footprints.some((f) => Math.hypot(x - (f.ax + f.bx) / 2, z - (f.az + f.bz) / 2) < 2)) continue;
        if (r < 30 && ruin.paved.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr)) continue;
        terrain.normalAt(x, z, n, 0.6);
        const s = (r < 30 ? 0.3 + rnd() * 0.5 : 0.5 + Math.pow(rnd(), 3) * 2.2) * (n.y < 0.8 ? 1.3 : 1);
        const set = Math.floor(rnd() * sets.length);
        if (r < 48 && inLane(x, z, s * 0.9)) continue;
        per[set].push({ x, y: terrain.heightAt(x, z), z, s });
      }
      // gravats des murs
      ruin.rubble.forEach((rb, i) => (rb.y <= baseY + 0.5 && inLane(rb.x, rb.z, 0)) || per[i % sets.length].push({ x: rb.x, y: rb.y > baseY + 0.5 ? rb.y : terrain.heightAt(rb.x, rb.z), z: rb.z, s: rb.s * 0.8 }));
      sets.forEach((p, i) => place(p, per[i], 's' + (i < 7 ? 0 : 1), 0xb4b2ac));
    }
    // gros blocs en bord de plateau
    const big: { x: number; y: number; z: number; s: number; sink: number }[] = [];
    for (const [b, r, s] of ruin.boulders) {
      const x = Math.sin((b * Math.PI) / 180) * r, z = -Math.cos((b * Math.PI) / 180) * r;
      big.push({ x, y: terrain.heightAt(x, z), z, s, sink: 0.3 });
    }
    if (boulderC) place(boulderC, big.filter((_, i) => i % 2 === 0), 'c', 0x77756f);
    if (boulderD) place(boulderD, big.filter((_, i) => i % 2 === 1).map((b) => ({ ...b, s: b.s * 1.3 })), 'd', 0x7d7b76);
  }

  // ------------------------------------------------------------------ fougères, touffes, bois mort
  private buildUnderstory(engine: Engine, terrain: Terrain, wind: Wind, ruin: VegetationSpec, ferns: Proto[], clumps: Proto[], dead?: Proto): void {
    const d = new Object3D();
    const rnd = mulberry32(4711);
    const ut = terrain.palette.understory ?? terrain.palette.foliage;
    const under = ut ? new Color(ut[0], ut[1], ut[2]) : null;
    const scatter = (protos: Proto[], items: { x: number; z: number; s: number }[], key: string, h: number, tint: number): void => {
      protos.forEach((proto, pi) => {
        const mine = items.filter((_, i) => i % protos.length === pi);
        if (!mine.length) return;
        for (const part of proto.parts) {
          const mat = part.material.clone();
          mat.alphaTest = 0.45;
          mat.transparent = false;
          mat.side = DoubleSide;
          mat.color.set(tint);
          if (under) mat.color.multiply(under);
          (mat as any).alphaToCoverage = engine.q.msaa > 0;
          engine.setupMaterial(mat, swayPatch(wind, h, 1, 2.2), key);
          const im = new InstancedMesh(part.geometry, mat, mine.length);
          mine.forEach((it, i) => {
            d.position.set(it.x, terrain.heightAt(it.x, it.z) - 0.03, it.z);
            d.rotation.set(0, hash01(i, pi + 11) * 6.28, 0);
            d.scale.setScalar(it.s);
            d.updateMatrix();
            im.setMatrixAt(i, d.matrix);
          });
          im.receiveShadow = true;
          im.castShadow = false;
          im.frustumCulled = false;
          this.group.add(im);
        }
        const br = proto.box.getSize(new Vector3()).length() / 2;
        for (const it of mine) this.obstacles.push({ x: it.x, y: terrain.heightAt(it.x, it.z) + br * it.s * 0.5, z: it.z, r: br * it.s });
      });
    };
    const fernSpots: { x: number; z: number; s: number }[] = [];
    const clumpSpots: { x: number; z: number; s: number }[] = [];
    ruin.wallFeet.forEach((f, i) => {
      const h = hash01(i, 41);
      if (h < 0.12) fernSpots.push({ x: f.x + (rnd() - 0.5) * 0.5, z: f.z + (rnd() - 0.5) * 0.5, s: 0.7 + rnd() * 0.8 });
      else if (h < 0.32) clumpSpots.push({ x: f.x + (rnd() - 0.5) * 0.4, z: f.z + (rnd() - 0.5) * 0.4, s: 1.6 + rnd() * 1.8 });
    });
    for (const t of this.nearTrees)
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28, r = 0.8 + rnd() * 4;
        fernSpots.push({ x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r, s: 0.8 + rnd() * 1.0 });
      }
    for (let i = 0; i < (ruin.clumps ?? 60); i++) {
      const a = rnd() * 6.28, r = 3 + rnd() * 40;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r > 32 && terrain.normalAt(x, z, this.tmp, 0.5).y < 0.75) continue;
      if (ruin.paved.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr * 0.8)) continue;
      clumpSpots.push({ x, z, s: 1.5 + rnd() * 2.2 });
    }
    scatter(ferns, fernSpots, 'fern', 0.5, 0x9db070);
    scatter(clumps, clumpSpots, 'clump', 0.35, 0xb9c487);
    if (dead && ruin.deadwood.length) {
      const spots = ruin.deadwood;
      for (const part of dead.parts) {
        const mat = part.material.clone();
        engine.setupMaterial(mat, undefined, 'dead');
        const im = new InstancedMesh(part.geometry, mat, spots.length);
        spots.forEach(([x, z, ry, s], i) => {
          if (part === dead.parts[0]) this.obstacles.push({ x, y: terrain.heightAt(x, z) + 0.3 * s, z, r: (dead.box.getSize(new Vector3()).length() / 2) * s });
          d.position.set(x, terrain.heightAt(x, z) + 0.12 * s, z);
          d.rotation.set(0, ry, 0);
          d.scale.setScalar(s);
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        });
        im.castShadow = im.receiveShadow = true;
        im.frustumCulled = false;
        this.group.add(im);
      }
    }
  }

  setGrassVisible(v: boolean): void {
    for (const c of this.chunks) c.mesh.visible = v;
  }

  /** 0..1 : proximité d'arbres au point donné (bruissement audio). */
  treeProximity(x: number, z: number): number {
    let best = 1e9;
    for (const t of this.nearTrees) best = Math.min(best, Math.hypot(t.x - x, t.z - z));
    return 1 - smoothstep(4, 40, best);
  }

  update(camera: PerspectiveCamera, player: Vector3, zoomK: number, flat = 0): void {
    this.grassUniforms.uPlayer.value.copy(player);
    this.grassUniforms.uFlat.value = flat;
    camera.getWorldDirection(this.grassUniforms.uAim.value);
    const cp = camera.position;
    for (const c of this.chunks) {
      const dist = Math.hypot(c.center.x - cp.x, c.center.z - cp.z) * Math.min(1, zoomK * 2.5 + 0.3);
      const f = dist < 14 ? 1 : dist < 30 ? 0.5 : dist < 55 ? 0.24 : 0.12;
      c.geo.instanceCount = Math.floor(c.total * f);
    }
  }
}

export type { Material };
void DynamicDrawUsage;
