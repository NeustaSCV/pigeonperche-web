// Moteur de rendu : WebGL2, ombres en cascade, chaîne de post-traitement, préréglages, résolution dynamique.
import {
  ACESFilmicToneMapping,
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PCFShadowMap,
  BasicShadowMap,
  PerspectiveCamera,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { AOEffect, AtmosphereEffect, EdgeAAEffect, FinishEffect, LensEffect } from './post';
import { mulberry32 } from './noise';

export type QualityName = 'low' | 'medium' | 'high';
export interface Quality {
  name: QualityName;
  label: string;
  cascades: number;
  shadowSize: number;
  ao: boolean;
  msaa: number;
  grass: number;
  godrays: boolean;
  dof: boolean;
  mistSteps: number;
  maxHeight: number;
  anisotropy: number;
}
export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', label: 'Basse', cascades: 2, shadowSize: 1536, ao: false, msaa: 0, grass: 0.35, godrays: false, dof: false, mistSteps: 4, maxHeight: 1080, anisotropy: 2 },
  medium: { name: 'medium', label: 'Moyenne', cascades: 3, shadowSize: 2048, ao: true, msaa: 0, grass: 0.6, godrays: true, dof: false, mistSteps: 5, maxHeight: 1440, anisotropy: 4 },
  high: { name: 'high', label: 'Haute', cascades: 4, shadowSize: 2048, ao: true, msaa: 0, grass: 0.85, godrays: true, dof: true, mistSteps: 6, maxHeight: 1440, anisotropy: 4 },
};

/** Texture de bruit tuilable RGBA (trois fbm indépendants + bruit blanc), utilisée partout. */
function makeNoiseTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const rnd = mulberry32(99);
  for (let c = 0; c < 3; c++) {
    const acc = new Float32Array(size * size);
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < 6; o++) {
      const P = 4 << o;
      const g = new Float32Array(P * P);
      for (let i = 0; i < P * P; i++) g[i] = rnd();
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * P;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * P;
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const a = g[(y0 % P) * P + (x0 % P)];
          const b = g[(y0 % P) * P + ((x0 + 1) % P)];
          const cc = g[((y0 + 1) % P) * P + (x0 % P)];
          const d = g[((y0 + 1) % P) * P + ((x0 + 1) % P)];
          acc[y * size + x] += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy);
        }
      }
      norm += amp;
      amp *= 0.5;
    }
    // étirement du contraste pour occuper toute la plage
    let mn = 1e9;
    let mx = -1e9;
    for (let i = 0; i < acc.length; i++) {
      const v = acc[i] / norm;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + c] = Math.round((255 * (acc[i] / norm - mn)) / (mx - mn));
  }
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = Math.floor(rnd() * 256);
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Géométrie de la vue : taille utile, base du champ à l'œil nu, centre optique et rayon du champ de la lunette. */
export interface View {
  /** taille utile, en pixels CSS */
  w: number;
  h: number;
  /** mise en page portrait (appareil tactile tenu à la verticale) */
  portrait: boolean;
  /** champ vertical de la vue à l'œil nu (55° en paysage ; plus grand en portrait pour garder le champ horizontal) */
  baseFov: number;
  /** centre optique de la lunette, en pixels CSS depuis le coin haut gauche */
  cx: number;
  cy: number;
  /** rayon du champ circulaire de la lunette, en pixels CSS */
  R: number;
}
/** champ vertical de référence (écran paysage) : c'est par rapport à lui que se définit le grossissement */
export const REF_FOV = 55;
const TAN_REF = Math.tan((REF_FOV * Math.PI) / 360);
/** rayon du champ de la lunette sur l'écran paysage de référence, en fraction de la hauteur */
export const REF_SCOPE_R = 0.462;
/** champ horizontal visé en portrait, et plafond du champ vertical (au-delà, les bords se déforment trop) */
const PORTRAIT_HFOV = 52;
const PORTRAIT_MAX_VFOV = 88;

export class Engine {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera: PerspectiveCamera;
  composer!: EffectComposer;
  csm!: CSM;
  q: Quality;
  noiseTex: DataTexture;
  atmosphere!: AtmosphereEffect;
  lens!: LensEffect;
  finish!: FinishEffect;
  dof: DepthOfFieldEffect | null = null;
  dofPass: EffectPass | null = null;
  bloom!: BloomEffect;
  private passDirect!: EffectPass;
  private passScopeA!: EffectPass;
  private passScopeB!: EffectPass;
  private scopeChain = true;

  time = 0;
  /** facteur de zoom partagé par les shaders : 1 à 55° de champ, plus petit en vue lunette */
  uZoomK = { value: 1 };
  uTime = { value: 0 };
  /** temps de frame lissé (ms) */
  frameMs = 16;
  pixelRatio = 1;
  basePixelRatio = 1;
  dynamicRes = true;
  stats = { calls: 0, tris: 0 };
  /** distance de mise au point des cascades en vue lunette (0 = découpage normal) */
  shadowFocus = 0;
  private appliedFocus = -1;
  private appliedFov = -1;
  private frameNo = 0;
  private overT = 0;
  private underT = 0;
  private sunDir = new Vector3(0, 1, 0);

  /** plafond du ratio de pixels (2 sur ordinateur, plus bas sur appareil tactile) */
  maxDpr = 2;
  /** appareil tactile : le plafond de hauteur s'applique au petit côté, et un budget de pixels rendus s'ajoute */
  touchMode = false;
  /** nombre maximal de pixels rendus (0 = sans limite) */
  pixelBudget = 0;
  /** mise en page portrait demandée par le jeu (appareil tactile tenu à la verticale) */
  portraitMode = false;
  view: View = { w: 1600, h: 900, portrait: false, baseFov: REF_FOV, cx: 800, cy: 450, R: REF_SCOPE_R * 900 };
  /** le jeu y place le centre optique et le rayon du champ de la lunette (portrait) ; appelé à chaque recalage */
  layoutView: ((v: View) => void) | null = null;
  private offsetKey = '';
  private projDirty = false;

  constructor(public canvas: HTMLCanvasElement, quality: QualityName, maxDpr = 2) {
    this.maxDpr = maxDpr;
    this.q = { ...QUALITY[quality] };
    // surcharges de diagnostic par l'URL (?ao=0&msaa=0&mist=0&gr=0&dof=0)
    const sp = new URLSearchParams(location.search);
    if (sp.has('ao')) this.q.ao = sp.get('ao') === '1';
    if (sp.has('msaa')) this.q.msaa = Number(sp.get('msaa'));
    if (sp.has('mist')) this.q.mistSteps = Number(sp.get('mist'));
    if (sp.has('gr')) this.q.godrays = sp.get('gr') === '1';
    if (sp.has('casc')) this.q.cascades = Number(sp.get('casc'));
    if (sp.has('maxh')) this.q.maxHeight = Number(sp.get('maxh'));
    if (sp.has('dof')) this.q.dof = sp.get('dof') === '1';
    if (sp.has('grassd')) this.q.grass = Number(sp.get('grassd'));
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false, alpha: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = new URLSearchParams(location.search).get('sh') !== '0';
    this.renderer.shadowMap.type = new URLSearchParams(location.search).get('shtype') === 'basic' ? BasicShadowMap : PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(new Color(0x000000), 1);
    this.camera = new PerspectiveCamera(55, 1.6, 0.2, 14000);
    this.scene.add(this.camera);
    this.noiseTex = makeNoiseTexture();
    this.computePixelRatio();
  }

  private computePixelRatio(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    // sur appareil tactile, le plafond de hauteur vaut pour le petit côté (portrait comme paysage)
    const side = this.touchMode ? Math.min(w, h) : h;
    this.basePixelRatio = Math.min(dpr, this.q.maxHeight / Math.max(1, side), this.maxDpr);
    if (this.pixelBudget > 0) this.basePixelRatio = Math.min(this.basePixelRatio, Math.sqrt(this.pixelBudget / Math.max(1, w * h)));
    this.pixelRatio = Math.min(this.pixelRatio, this.basePixelRatio) || this.basePixelRatio;
    if (this.pixelRatio < this.basePixelRatio * 0.5) this.pixelRatio = this.basePixelRatio * 0.5;
  }

  /** Portée de rendu du niveau : plan lointain de la caméra, puis portée des ombres (lue par initShadows). */
  shadowFar = 2600;
  setRange(cameraFar: number, shadowFar: number): void {
    this.camera.far = cameraFar;
    this.camera.updateProjectionMatrix();
    this.shadowFar = shadowFar;
  }

  initShadows(sunDir: Vector3): void {
    this.sunDir.copy(sunDir);
    const q = this.q;
    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: q.cascades,
      maxFar: this.shadowFar,
      mode: 'custom',
      shadowMapSize: q.shadowSize,
      lightDirection: sunDir.clone().negate(),
      lightIntensity: 1,
      lightNear: 1,
      lightFar: 7000,
      lightMargin: 1600,
      shadowBias: -0.00012,
      customSplitsCallback: (n: number, _near: number, far: number, target: number[]) => this.splits(n, far, target),
    });
    this.csm.fade = true;
    const nb = [0.03, 0.1, 0.5, 2.0];
    this.csm.lights.forEach((l, i) => {
      l.shadow.normalBias = nb[Math.min(3, i + (4 - q.cascades))];
      l.shadow.radius = 1.6;
    });
    this.pixelRatio = this.basePixelRatio;
  }

  private splits(n: number, far: number, target: number[]): void {
    const d = this.shadowFocus;
    if (d > 150) {
      const a = Math.max(0.02, (d - 80) / far);
      const b = Math.min(0.9, (d + 90) / far);
      if (n >= 4) target.push(a, b, Math.min(0.97, b + 500 / far), 1);
      else if (n === 3) target.push(a, b, 1);
      else target.push(b, 1);
    } else if (n >= 4) target.push(0.011, 0.05, 0.24, 1);
    else if (n === 3) target.push(0.016, 0.12, 1);
    else target.push(0.03, 1);
  }

  setSun(dir: Vector3, color: Color, intensity: number): void {
    this.sunDir.copy(dir);
    this.csm.lightDirection.copy(dir).negate();
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
    if (this.atmosphere) {
      (this.atmosphere.u('uSunDir').value as Vector3).copy(dir);
      (this.atmosphere.u('uSunColor').value as Vector3).set(color.r, color.g, color.b).multiplyScalar(intensity);
    }
  }

  /** Enregistre un matériau pour les ombres en cascade, avec un patch de shader optionnel. */
  setupMaterial<T extends Material>(mat: T, patch?: (shader: any) => void, key = ''): T {
    this.csm.setupMaterial(mat);
    const csmCb = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader: any, r: any) => {
      csmCb.call(mat, shader, r);
      if (patch) patch(shader);
    };
    mat.customProgramCacheKey = () => 'csm:' + key;
    return mat;
  }

  initPost(skyLut: Texture): void {
    const q = this.q;
    const r = this.renderer;
    this.composer = new EffectComposer(r, { frameBufferType: HalfFloatType, multisampling: q.msaa });
    this.composer.autoRenderToScreen = false;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const sp = new URLSearchParams(location.search);
    this.atmosphere = new AtmosphereEffect(this.camera, skyLut, this.noiseTex);
    this.atmosphere.u('uMistSteps').value = q.mistSteps;
    this.atmosphere.shaftStrength = q.godrays ? 1 : 0;
    this.atmosphere.u('uShaftN').value = q.name === 'high' ? 10 : 8;
    // bloom classique à basse résolution : le flou par mipmaps coûtait près de 6 ms en 1440p sur M2
    this.bloom = new BloomEffect({ mipmapBlur: false, kernelSize: KernelSize.MEDIUM, luminanceThreshold: 1.6, luminanceSmoothing: 0.7, intensity: 0.5, resolutionScale: 0.25 } as any);
    this.lens = new LensEffect(this.noiseTex);
    this.finish = new FinishEffect();
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const pre: any[] = [];
    if (sp.get('smaa') !== '0') pre.push(new EdgeAAEffect());
    if (q.ao) pre.push(new AOEffect(this.camera, q.name === 'high' ? 7 : 6));
    pre.push(this.atmosphere);
    if (sp.get('bloom') !== '0') pre.push(this.bloom);
    // Deux chaînes, une seule active à la fois.
    // Hors lunette : tout tient dans une passe plein écran (occlusion, atmosphère, bloom, tons, finition).
    // En lunette : la lentille (mirage, aberration) rééchantillonne l'image et exige sa propre passe.
    this.passDirect = new EffectPass(this.camera, ...pre, tone, this.finish);
    this.passScopeA = new EffectPass(this.camera, ...pre);
    this.passScopeB = new EffectPass(this.camera, this.lens, tone, this.finish);
    this.composer.addPass(this.passDirect);
    this.composer.addPass(this.passScopeA);
    if (q.dof) {
      this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 500, focusRange: 300, bokehScale: 2.0, resolutionScale: 0.3 });
      this.dofPass = new EffectPass(this.camera, this.dof);
      this.dofPass.enabled = false;
      this.composer.addPass(this.dofPass);
    }
    this.composer.addPass(this.passScopeB);
    this.setScopeChain(false);
    this.resize();
  }

  /** Bascule entre la chaîne directe (une passe) et la chaîne lunette (lentille séparée). */
  setScopeChain(on: boolean): void {
    if (on === this.scopeChain) return;
    this.scopeChain = on;
    this.passDirect.enabled = !on;
    this.passScopeA.enabled = on;
    this.passScopeB.enabled = on;
    // le compositeur ne réattribue pas seul la sortie écran quand on active ou coupe des passes
    this.passDirect.renderToScreen = !on;
    this.passScopeB.renderToScreen = on;
    if (this.dofPass && !on) this.dofPass.enabled = false;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.computePixelRatio();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.updateView(w, h);
    this.offsetKey = '';
    this.camera.clearViewOffset();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setSize(w, h);
      this.lens.u('uAspectL').value = w / h;
      this.finish.u('uAspectF').value = w / h;
      this.applyViewUniforms();
    }
    if (this.csm) this.csm.updateFrustums();
    this.appliedFov = this.camera.fov;
  }

  /** Recalcule la géométrie de la vue : paysage de référence par défaut, puis ce que le jeu impose en portrait. */
  updateView(w = this.view.w, h = this.view.h): void {
    const v = this.view;
    v.w = w;
    v.h = h;
    v.portrait = this.portraitMode && h > w;
    v.cx = w / 2;
    v.cy = h / 2;
    v.R = REF_SCOPE_R * h;
    v.baseFov = REF_FOV;
    if (v.portrait) {
      // champ horizontal confortable : le champ vertical s'agrandit avec l'allongement de l'écran, jusqu'au plafond
      const tanV = Math.tan((PORTRAIT_HFOV * Math.PI) / 360) / (w / h);
      v.baseFov = Math.min(PORTRAIT_MAX_VFOV, (Math.atan(tanV) * 360) / Math.PI);
      v.R = 0.465 * w;
      v.cy = v.R + 6;
      this.layoutView?.(v);
    }
    if (this.finish) this.applyViewUniforms();
    this.offsetKey = '';
  }

  private applyViewUniforms(): void {
    const v = this.view;
    const a = v.w / v.h;
    // les effets travaillent en coordonnées d'image (origine en bas à gauche), en unités de hauteur
    (this.finish.u('uCenterF').value as Vector2).set(v.cx / v.w, 1 - v.cy / v.h);
    this.finish.u('uScopeR').value = v.R / v.h;
    // vignettage : en portrait, la distance au centre est ramenée à celle d'un écran 16:9
    this.finish.u('uVigK').value = v.portrait ? 1.02 / Math.hypot(a / 2, 0.5) : 1;
    (this.lens.u('uCenterL').value as Vector2).set(v.cx / v.w, 1 - v.cy / v.h);
    this.lens.u('uRkL').value = (REF_SCOPE_R * v.h) / v.R;
  }

  /**
   * Champ vertical de la caméra en lunette. Le grossissement se définit par rapport à la vue à l'œil nu d'un écran
   * paysage de référence (55° de haut, champ circulaire de rayon 0,462 × hauteur) : le champ réel vu dans le cercle
   * est le même quel que soit l'écran, seul le cadrage change.
   */
  scopeFov(mag: number): number {
    const v = this.view;
    return (Math.atan((TAN_REF / mag) * ((REF_SCOPE_R * v.h) / v.R)) * 360) / Math.PI;
  }
  /** pixels CSS par milliradian au centre optique, pour le champ courant de la caméra */
  pxPerMil(fovDeg = this.camera.fov): number {
    return this.view.h / 2 / Math.tan((fovDeg * Math.PI) / 360) / 1000;
  }
  /** facteur de zoom : 1 à l'œil nu, plus petit en lunette */
  zoomK(): number {
    return Math.tan((this.camera.fov * Math.PI) / 360) / Math.tan((this.view.baseFov * Math.PI) / 360);
  }
  /** champ d'une caméra de mise en scène (menu, caméra de balle) réglée pour le paysage : élargi en portrait */
  cineFov(fov: number): number {
    if (!this.view.portrait) return fov;
    return (Math.atan(Math.tan((fov * Math.PI) / 360) * 1.55) * 360) / Math.PI;
  }
  /**
   * Décale le rendu pour que le centre de projection tombe sur le centre optique de la lunette (portrait : champ
   * placé en haut de l'écran). C'est la projection elle-même qui est décentrée (`setViewOffset`) : l'axe de la
   * caméra reste la ligne de visée, la balistique et le réticule ne changent pas.
   */
  setScopeOffset(on: boolean): void {
    const v = this.view;
    const ox = v.w / 2 - v.cx, oy = v.h / 2 - v.cy;
    const use = on && (Math.abs(ox) > 0.25 || Math.abs(oy) > 0.25);
    const key = use ? `${v.w}x${v.h}:${ox.toFixed(2)}:${oy.toFixed(2)}` : '';
    if (key === this.offsetKey) return;
    this.offsetKey = key;
    if (use) this.camera.setViewOffset(v.w, v.h, ox, oy, v.w, v.h);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    this.projDirty = true;
  }

  /**
   * Plan proche de la caméra. La précision du tampon de profondeur à la distance d vaut environ d² / (proche × 2²⁴) :
   * 0,7 m à 2 500 m pour un plan proche à 0,55 m, 1 cm à 40 m. Le jeu l'éloigne donc en lunette, aussi loin que le
   * permet le premier obstacle du champ (voir Game.scopeNear). Les cascades d'ombre sont recalées au changement.
   */
  setNear(near: number): void {
    if (Math.abs(near - this.camera.near) < 1e-4) return;
    this.camera.near = near;
    this.projDirty = true;
  }

  private adaptResolution(dt: number): void {
    if (!this.dynamicRes) return;
    if (this.frameMs > 17.8) {
      this.overT += dt;
      this.underT = 0;
    } else if (this.frameMs < 13.2) {
      this.underT += dt;
      this.overT = 0;
    } else {
      this.overT = Math.max(0, this.overT - dt);
      this.underT = 0;
    }
    let pr = this.pixelRatio;
    if (this.overT > 0.8 && pr > this.basePixelRatio * 0.5) {
      pr = Math.max(this.basePixelRatio * 0.5, pr * 0.88);
      this.overT = 0;
    } else if (this.underT > 4 && pr < this.basePixelRatio) {
      pr = Math.min(this.basePixelRatio, pr / 0.92);
      this.underT = 0;
    }
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  render(dt: number, rawFrameMs: number): void {
    this.time += dt;
    this.uTime.value = this.time;
    this.frameMs += (rawFrameMs - this.frameMs) * 0.08;
    this.adaptResolution(rawFrameMs / 1000);
    const cam = this.camera;
    if (this.projDirty || Math.abs(cam.fov - this.appliedFov) > 0.01 || Math.abs(this.shadowFocus - this.appliedFocus) > 12) {
      this.projDirty = false;
      cam.updateProjectionMatrix();
      this.appliedFov = cam.fov;
      this.appliedFocus = this.shadowFocus;
      this.csm.updateFrustums();
    }
    this.uZoomK.value = this.zoomK();
    cam.updateMatrixWorld();
    this.csm.update();
    // seule la cascade proche est rafraîchie à chaque image ; les suivantes le sont à tour de rôle,
    // de plus en plus rarement (elles couvrent des zones où l'ombre bouge peu à l'écran)
    this.frameNo++;
    const ls = this.csm.lights;
    for (let i = 0; i < ls.length; i++) {
      const every = i === 0 ? 1 : i === 1 ? 2 : 4;
      ls[i].shadow.autoUpdate = every === 1;
      if (every > 1 && (this.frameNo + i) % every === 0) ls[i].shadow.needsUpdate = true;
    }
    this.atmosphere.update();
    this.lens.u('uTimeL').value = this.time;
    this.finish.u('uTimeF').value = this.time;
    this.renderer.info.reset();
    this.composer.render(dt);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
  }
}

export const tmpV2 = new Vector2();
