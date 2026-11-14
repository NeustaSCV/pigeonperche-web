// Ciel : HDRI Poly Haven sur un dôme, soleil détecté dans l'image, éclairage ambiant par PMREM, cycle lent du soleil.
import {
  BackSide,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetUrl } from '../core/assets';
import type { Engine } from '../core/engine';
import type { SkySpec } from '../levels/types';

/**
 * Ciel dégagé de référence (SkySpec.clear), dans le repère de la photographie : bleu profond au zénith, clair à
 * l'horizon, réchauffé vers le soleil. Mêmes formules ici (table réduite du ciel) et dans le shader du dôme.
 */
function clearSky(dx: number, dy: number, dz: number, sun: Vector3, out: [number, number, number]): [number, number, number] {
  const up = Math.max(0, dy);
  const hz = Math.pow(1 - up, 4);
  const c = Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z);
  const g = Math.pow(c, 6) * 0.45 + Math.pow(c, 40) * 0.6;
  const low = dy < 0 ? Math.min(1, -dy * 6) : 0;
  out[0] = (0.13 + 0.56 * hz + 1.0 * g) * (1 - 0.45 * low);
  out[1] = (0.3 + 0.48 * hz + 0.78 * g) * (1 - 0.45 * low);
  out[2] = (0.8 + 0.14 * hz + 0.5 * g) * (1 - 0.45 * low);
  return out;
}
const CLEAR_GLSL = /* glsl */ `
vec3 clearSky(vec3 d, vec3 sun) {
  float up = max(0.0, d.y);
  float hz = pow(1.0 - up, 4.0);
  float c = max(0.0, dot(d, sun));
  float g = pow(c, 6.0) * 0.45 + pow(c, 40.0) * 0.6;
  float low = d.y < 0.0 ? min(1.0, -d.y * 6.0) : 0.0;
  return (vec3(0.13, 0.3, 0.8) + vec3(0.56, 0.48, 0.14) * hz + vec3(1.0, 0.78, 0.5) * g) * (1.0 - 0.45 * low);
}`;

const LUT_W = 64;
const LUT_H = 32;

/** Ciel de secours entièrement procédural (dégradé doré + disque solaire) au format équirectangulaire. */
function proceduralSky(): { data: Float32Array; w: number; h: number } {
  const w = 512, h = 256;
  const data = new Float32Array(w * h * 4);
  const el = (14 * Math.PI) / 180;
  const sun = new Vector3(Math.cos(el), Math.sin(el), 0);
  const d = new Vector3();
  for (let y = 0; y < h; y++) {
    const e = (0.5 - (y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const a = ((x + 0.5) / w - 0.5) * Math.PI * 2;
      d.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
      const up = Math.max(0, d.y);
      const c = Math.max(0, d.dot(sun));
      const hz = Math.pow(1 - up, 5);
      let r = 0.25 + 0.75 * hz + 1.6 * Math.pow(c, 8);
      let g = 0.42 + 0.5 * hz + 0.9 * Math.pow(c, 8);
      let b = 0.75 + 0.15 * hz + 0.35 * Math.pow(c, 8);
      if (c > 0.9997) { r += 4000; g += 3000; b += 1800; }
      const k = (y * w + x) * 4;
      data[k] = r; data[k + 1] = g; data[k + 2] = b; data[k + 3] = 1;
    }
  }
  return { data, w, h };
}

export class Sky {
  dome!: Mesh;
  lut!: DataTexture;
  envMap!: Texture;
  /** direction vers le soleil (monde) */
  /** soleil au début de la partie (degrés ; azimut 0 = nord, sens horaire) : donné par le niveau avant load() */
  sun = { bearing: 250, elevation: 15 };
  /** ciel du niveau (part de ciel dégagé, exposition…) : donné par le niveau avant load() */
  spec: SkySpec = {};
  sunDir = new Vector3();
  sunColor = new Color(1, 0.78, 0.55);
  sunIntensity = 9;
  /** gain appliqué au HDRI pour normaliser sa luminance moyenne */
  gain = 1;
  /** progression du cycle 0..1 (fin d'après-midi → soleil rasant) */
  cycle = 0;
  private sunHdr = new Vector3(1, 0.25, 0).normalize();
  private rotWorldFromHdr = new Matrix4();
  private rot3 = new Matrix3();
  private mat!: ShaderMaterial;
  private tex!: Texture;
  private engine!: Engine;
  private lastEnvCycle = -1;
  private pmrem!: PMREMGenerator;

  async load(engine: Engine): Promise<void> {
    this.engine = engine;
    let tex: Texture | null = null;
    let w = 0, h = 0;
    let px: (i: number) => number = () => 0;
    const loader = new HDRLoader();
    loader.setDataType(HalfFloatType);
    for (const f of [engine.q.name === 'low' ? 'sky_1k.hdr' : 'sky_4k.hdr', 'sky_1k.hdr']) {
      try {
        const t = await loader.loadAsync(assetUrl('assets/sky/' + f));
        const d = t.image.data as Uint16Array;
        w = t.image.width;
        h = t.image.height;
        px = (i) => DataUtils.fromHalfFloat(d[i]);
        tex = t;
        break;
      } catch {
        /* essai suivant */
      }
    }
    if (!tex) {
      const p = proceduralSky();
      w = p.w;
      h = p.h;
      px = (i) => p.data[i];
      if (engine.renderer.extensions.has('OES_texture_float_linear')) tex = new DataTexture(p.data, w, h, RGBAFormat, FloatType);
      else {
        const half = new Uint16Array(p.data.length);
        for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat(Math.min(65000, p.data[i]));
        tex = new DataTexture(half, w, h, RGBAFormat, HalfFloatType);
      }
      tex.needsUpdate = true;
    }
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    this.tex = tex;
    // la première ligne des données correspond-elle au zénith ? (HDRLoader : flipY = true → oui)
    const topFirst = true;

    // table réduite du ciel (soleil écrêté) + recherche du soleil
    const lut = new Float32Array(LUT_W * LUT_H * 4);
    const cnt = new Float32Array(LUT_W * LUT_H);
    let best = -1, bx = 0, by = 0;
    const step = Math.max(1, Math.floor(w / 1024));
    const sc = new Vector3();
    let scW = 0;
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const k = (y * w + x) * 4;
        const r = px(k), g = px(k + 1), b = px(k + 2);
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        if (l > best) { best = l; bx = x; by = y; }
        const row = topFirst ? h - 1 - y : y;
        const li = Math.floor((row / h) * LUT_H) * LUT_W + Math.floor((x / w) * LUT_W);
        const cl = Math.min(1, 6 / Math.max(l, 1e-4));
        lut[li * 4] += r * cl; lut[li * 4 + 1] += g * cl; lut[li * 4 + 2] += b * cl;
        cnt[li]++;
      }
    // couleur du soleil : moyenne autour du pixel le plus brillant
    const rad = Math.max(2, Math.floor(w / 300));
    for (let y = by - rad; y <= by + rad; y++)
      for (let x = bx - rad; x <= bx + rad; x++) {
        if (y < 0 || y >= h) continue;
        const k = (y * w + ((x + w) % w)) * 4;
        sc.x += px(k); sc.y += px(k + 1); sc.z += px(k + 2);
        scW++;
      }
    const mx = Math.max(sc.x, sc.y, sc.z) || 1;
    this.sunColor.setRGB(sc.x / mx, sc.y / mx, sc.z / mx);
    // un soleil trop blanc dans le fichier : on le réchauffe légèrement pour l'heure dorée
    this.sunColor.lerp(new Color(1, 0.66, 0.34), 0.7 * (this.spec.warmth ?? 1));
    this.sunIntensity = 9 * (this.spec.sunIntensity ?? 1);
    const el = (0.5 - (by + 0.5) / h) * Math.PI * (topFirst ? 1 : -1);
    const az = ((bx + 0.5) / w - 0.5) * Math.PI * 2;
    this.sunHdr.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));

    let lum = 0, lw = 0;
    for (let i = 0; i < LUT_W * LUT_H; i++) {
      const c = cnt[i] || 1;
      lut[i * 4] /= c; lut[i * 4 + 1] /= c; lut[i * 4 + 2] /= c; lut[i * 4 + 3] = 1;
      const row = Math.floor(i / LUT_W);
      if (row >= LUT_H / 2) {
        const wgt = Math.cos(((row + 0.5) / LUT_H - 0.5) * Math.PI);
        lum += (lut[i * 4] * 0.2126 + lut[i * 4 + 1] * 0.7152 + lut[i * 4 + 2] * 0.0722) * wgt;
        lw += wgt;
      }
    }
    lum /= lw;
    this.gain = 0.62 / Math.max(lum, 1e-3);
    // ciel dégagé demandé par le niveau : la table (avant gain) est fondue dans le dégradé de référence
    const clear = Math.min(1, Math.max(0, this.spec.clear ?? 0));
    if (clear > 0) {
      const cs: [number, number, number] = [0, 0, 0];
      for (let y = 0; y < LUT_H; y++)
        for (let x = 0; x < LUT_W; x++) {
          const e = ((y + 0.5) / LUT_H - 0.5) * Math.PI, a = ((x + 0.5) / LUT_W - 0.5) * Math.PI * 2;
          clearSky(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a), this.sunHdr, cs);
          const k = (y * LUT_W + x) * 4;
          for (let c = 0; c < 3; c++) lut[k + c] += (cs[c] / this.gain - lut[k + c]) * clear;
        }
    }
    this.gain *= this.spec.exposure ?? 1;
    // flou horizontal circulaire
    for (let pass = 0; pass < 3; pass++) {
      const src = lut.slice();
      for (let y = 0; y < LUT_H; y++)
        for (let x = 0; x < LUT_W; x++)
          for (let c = 0; c < 3; c++) {
            const a = src[(y * LUT_W + ((x + LUT_W - 1) % LUT_W)) * 4 + c];
            const b = src[(y * LUT_W + x) * 4 + c];
            const d = src[(y * LUT_W + ((x + 1) % LUT_W)) * 4 + c];
            const u = src[(Math.max(0, y - 1) * LUT_W + x) * 4 + c];
            const v = src[(Math.min(LUT_H - 1, y + 1) * LUT_W + x) * 4 + c];
            lut[(y * LUT_W + x) * 4 + c] = (a + 2 * b + d + u + v) / 6;
          }
    }
    // Safari iOS n'a pas toujours OES_texture_float_linear : sans elle une texture flottante 32 bits filtrée est
    // « incomplète » (lue noire). Le filtrage des demi-flottants, lui, fait partie de WebGL2.
    if (engine.renderer.extensions.has('OES_texture_float_linear')) this.lut = new DataTexture(lut, LUT_W, LUT_H, RGBAFormat, FloatType);
    else {
      const half = new Uint16Array(lut.length);
      for (let i = 0; i < lut.length; i++) half[i] = DataUtils.toHalfFloat(Math.min(65000, lut[i]));
      this.lut = new DataTexture(half, LUT_W, LUT_H, RGBAFormat, HalfFloatType);
    }
    this.lut.wrapS = RepeatWrapping;
    this.lut.wrapT = ClampToEdgeWrapping;
    this.lut.minFilter = this.lut.magFilter = LinearFilter;
    this.lut.needsUpdate = true;

    this.mat = new ShaderMaterial({
      uniforms: { tSky: { value: tex }, uRot: { value: this.rot3 }, uGain: { value: this.gain }, uClamp: { value: 1e6 }, uFlip: { value: topFirst ? 1 : 0 }, uClear: { value: clear }, uExpo: { value: this.spec.exposure ?? 1 }, uSunH: { value: this.sunHdr } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999999; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSky; uniform mat3 uRot; uniform float uGain; uniform float uClamp; uniform float uFlip; uniform float uClear; uniform float uExpo; uniform vec3 uSunH;
        ${CLEAR_GLSL}
        varying vec3 vDir;
        void main(){
          vec3 d = uRot * normalize(vDir);
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 c = texture2D(tSky, uv).rgb * uGain;
          // le disque du soleil et son halo restent ceux de la photographie
          if (uClear > 0.0) c = mix(c, clearSky(d, uSunH) * uExpo, uClear * (1.0 - smoothstep(4.0, 12.0, dot(c, vec3(0.2126, 0.7152, 0.0722)))));
          gl_FragColor = vec4(min(c, vec3(uClamp)), 1.0);
        }`,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    this.dome = new Mesh(new SphereGeometry(1, 48, 24), this.mat);
    this.dome.scale.setScalar(9000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.pmrem = new PMREMGenerator(engine.renderer);
    this.update(0, true);
  }

  /** Avance le cycle et met à jour soleil, dôme et environnement. dtCycle : fraction du cycle écoulée. */
  update(dtCycle: number, force = false): void {
    this.cycle = Math.min(1, this.cycle + dtCycle);
    const c = this.cycle;
    const elev = ((this.sun.elevation - 7 * c) * Math.PI) / 180;
    const bearing = ((this.sun.bearing + 6 * c) * Math.PI) / 180;
    const target = new Vector3(Math.sin(bearing) * Math.cos(elev), Math.sin(elev), -Math.cos(bearing) * Math.cos(elev));
    // rotation rigide du ciel qui amène le soleil du HDRI sur la direction voulue, en gardant l'horizon presque horizontal
    const hz0 = new Vector3(this.sunHdr.x, 0, this.sunHdr.z).normalize();
    const hz1 = new Vector3(target.x, 0, target.z).normalize();
    const qy = new Quaternion().setFromUnitVectors(hz0, hz1);
    const s1 = this.sunHdr.clone().applyQuaternion(qy);
    const qt = new Quaternion().setFromUnitVectors(s1, target);
    const q = qt.multiply(qy);
    this.rotWorldFromHdr.makeRotationFromQuaternion(q);
    this.rot3.setFromMatrix4(this.rotWorldFromHdr).transpose(); // monde → HDRI
    this.sunDir.copy(target);
    // le soleil rougit et faiblit en descendant
    const warm = new Color().copy(this.sunColor).lerp(new Color(1, 0.5, 0.24), c * 0.45);
    const e = this.engine;
    const intensity = this.sunIntensity * (1 - 0.3 * c);
    e.setSun(this.sunDir, warm, intensity);
    if (e.atmosphere) {
      (e.atmosphere.u('uSkyRot').value as Matrix3).copy(this.rot3);
      e.atmosphere.u('uSkyGain').value = this.gain;
    }
    if (force || Math.abs(c - this.lastEnvCycle) > 0.12) {
      this.lastEnvCycle = c;
      this.bakeEnv();
    }
  }

  private bakeEnv(): void {
    const s = new Scene();
    const prevParent = this.dome.parent;
    const prevScale = this.dome.scale.x;
    const prevPos = this.dome.position.clone();
    this.mat.uniforms.uClamp.value = 9;
    this.dome.scale.setScalar(50);
    this.dome.position.set(0, 0, 0);
    s.add(this.dome);
    const old = this.envMap;
    this.envMap = this.pmrem.fromScene(s, 0, 0.1, 100).texture;
    this.mat.uniforms.uClamp.value = 1e6;
    this.dome.scale.setScalar(prevScale);
    this.dome.position.copy(prevPos);
    if (prevParent) prevParent.add(this.dome);
    this.engine.scene.environment = this.envMap;
    this.engine.scene.environmentIntensity = 1.0;
    if (old) old.dispose();
  }

  follow(cam: Vector3): void {
    this.dome.position.copy(cam);
  }
}
