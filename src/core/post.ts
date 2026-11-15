// Effets de post-traitement maison : atmosphère (perspective aérienne, brume, ombres de nuages),
// lentille (mirage, aberration), finition (étalonnage, vignettage, masque de lunette, grain).
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Matrix3, Matrix4, Uniform, Vector2, Vector3, Vector4, type PerspectiveCamera, type Texture } from 'three';

const atmosphereFrag = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform sampler2D uSkyLut;
uniform mat3 uSkyRot;
uniform sampler2D uNoise;
uniform vec2 uWindOff;
uniform float uHaze;
uniform float uMist;
uniform float uMistSteps;
uniform float uCloudCover;
uniform float uCloudShadow;
uniform float uSkyGain;
uniform vec2 uSunUv;
uniform float uShafts;
uniform float uShaftN;
uniform float uValleyY;
uniform vec2 uMistLayer;

vec3 skyLut(vec3 d) {
  vec3 h = uSkyRot * d;
  vec2 uv = vec2(atan(h.z, h.x) * 0.15915494 + 0.5, asin(clamp(h.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return texture2D(uSkyLut, uv).rgb * uSkyGain;
}

float cloudShadowAt(vec3 p) {
  vec2 q = (p.xz + uSunDir.xz * ((1500.0 - p.y) / max(uSunDir.y, 0.1)) + uWindOff) * 0.00021;
  float n = texture2D(uNoise, q).r * 0.62 + texture2D(uNoise, q * 2.7 + 0.31).g * 0.28 + texture2D(uNoise, q * 7.3).b * 0.1;
  return smoothstep(uCloudCover - 0.1, uCloudCover + 0.13, n);
}

float expFog(float rho, float hs, float y0, float camY, float dy, float L) {
  float k = dy * L / hs;
  float f = abs(k) > 0.001 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  return rho * exp(-(camY - y0) / hs) * L * f;
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * ndc;
  vp /= vp.w;
  vec3 wp = (uViewInv * vp).xyz;
  vec3 ray = wp - uCamPos;
  float L = length(ray);
  ray /= L;
  bool sky = depth > 0.999999;
  vec3 col = inputColor.rgb;

  // ombres de nuages projetées sur le décor
  if (!sky) {
    float cs = cloudShadowAt(wp) * uCloudShadow;
    col *= mix(vec3(1.0), vec3(0.50, 0.56, 0.68), cs);
  } else {
    L = 30000.0;
  }

  // couleur de diffusion : le ciel lui-même, pris à l'horizon dans la direction du regard
  vec3 hdir = normalize(vec3(ray.x, 0.06 + max(ray.y, 0.0) * 0.5, ray.z));
  vec3 horizon = skyLut(hdir);
  vec3 zen = skyLut(vec3(0.0, 1.0, 0.0));
  float sunAmt = max(dot(ray, uSunDir), 0.0);
  vec3 inscatter = mix(horizon, zen, 0.22) * vec3(0.92, 0.98, 1.1);
  inscatter += uSunColor * (pow(sunAmt, 6.0) * 0.10 + pow(sunAmt, 48.0) * 0.22);

  // les cotes de la brume se rapportent au fond de vallée du niveau (uValleyY ; 0 pour la carte d'origine)
  float camY = uCamPos.y - uValleyY;
  float tauA = expFog(1.15e-4 * uHaze, 950.0, 0.0, camY, ray.y, L);
  float tauB = expFog(3.5e-4 * uHaze * uMist, 55.0, 8.0, camY, ray.y, min(L, 9000.0));
  if (sky) { tauA *= 0.3; tauB *= 0.3; }

  // nappe de brume de vallée : marche de rayons courte dans une couche (4 à 110 m au-dessus du fond de vallée par défaut)
  float mist = 0.0;
  float mistLight = 0.0;
  if (uMistSteps > 0.5 && abs(ray.y) > 1e-4) {
    float yb = uValleyY + uMistLayer.x, yt = uValleyY + uMistLayer.y;
    float ta = (yb - uCamPos.y) / ray.y;
    float tb = (yt - uCamPos.y) / ray.y;
    float t0 = max(min(ta, tb), 0.0);
    float t1 = min(max(ta, tb), min(L, 7000.0));
    if (t1 > t0) {
      float steps = uMistSteps;
      float dtm = (t1 - t0) / steps;
      float j = ign(gl_FragCoord.xy);
      for (float i = 0.0; i < 8.0; i++) {
        if (i >= steps) break;
        vec3 p = uCamPos + ray * (t0 + (i + j) * dtm);
        float hh = (p.y - yb) / (yt - yb);
        float prof = smoothstep(0.0, 0.12, hh) * (1.0 - hh) * (1.0 - hh);
        float n = texture2D(uNoise, p.xz * 0.00075 + uWindOff * 0.0006).r * 0.65 + texture2D(uNoise, p.xz * 0.0031 - uWindOff * 0.001).g * 0.35;
        float d = smoothstep(0.46, 0.82, n) * prof;
        float lit = 1.0 - 0.75 * smoothstep(uCloudCover - 0.1, uCloudCover + 0.13, texture2D(uNoise, (p.xz + uSunDir.xz * ((1500.0 - p.y) / max(uSunDir.y, 0.1)) + uWindOff) * 0.00021).r * 1.05);
        mist += d * dtm;
        mistLight += d * dtm * lit;
      }
    }
  }
  float tauM = mist * 0.9e-3 * uMist * uHaze;
  float litM = mist > 0.0 ? mistLight / mist : 1.0;

  float tau = tauA + tauB + tauM;
  vec3 T = exp(-tau * vec3(0.82, 1.0, 1.32));
  float Ts = exp(-tau);
  vec3 mistCol = (horizon * 0.9 + uSunColor * (0.05 + 0.3 * pow(sunAmt, 4.0))) * litM;
  float wM = tauM / max(tau, 1e-5);
  vec3 scatterCol = mix(inscatter, mistCol, wM);
  col = col * T + scatterCol * (1.0 - Ts);
  // rayons de soleil : on marche vers le soleil à l'écran et on compte le ciel dégagé
  if (uShafts > 0.001) {
    vec2 stepv = (uSunUv - uv) / uShaftN * 0.92;
    float j2 = ign(gl_FragCoord.xy + 17.0);
    float acc = 0.0;
    float w = 1.0;
    for (float i = 0.0; i < 20.0; i++) {
      if (i >= uShaftN) break;
      vec2 q = uv + stepv * (i + j2);
      float open = step(0.999999, readDepth(q)) * step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
      acc += open * w;
      w *= 0.94;
    }
    float fall = 1.0 - smoothstep(0.0, 0.85, distance(uv, uSunUv));
    col += uSunColor * (acc / uShaftN) * fall * fall * uShafts * 0.04;
  }
  outputColor = vec4(col, inputColor.a);
}
`;

export class AtmosphereEffect extends Effect {
  private cam: PerspectiveCamera;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  /** 0 = rayons désactivés */
  shaftStrength = 1;
  constructor(cam: PerspectiveCamera, skyLut: Texture, noise: Texture) {
    super('AtmosphereEffect', atmosphereFrag, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uProjInv', new Uniform(new Matrix4())],
        ['uViewInv', new Uniform(new Matrix4())],
        ['uCamPos', new Uniform(new Vector3())],
        ['uSunDir', new Uniform(new Vector3(0, 1, 0))],
        ['uSunColor', new Uniform(new Vector3(1, 0.8, 0.6))],
        ['uSkyLut', new Uniform(skyLut)],
        ['uSkyRot', new Uniform(new Matrix3())],
        ['uNoise', new Uniform(noise)],
        ['uWindOff', new Uniform(new Vector2())],
        ['uHaze', new Uniform(1)],
        ['uMist', new Uniform(1)],
        ['uMistSteps', new Uniform(6)],
        ['uCloudCover', new Uniform(0.56)],
        ['uCloudShadow', new Uniform(0.85)],
        ['uSkyGain', new Uniform(1)],
        ['uSunUv', new Uniform(new Vector2(0.5, 0.5))],
        ['uShafts', new Uniform(0)],
        ['uShaftN', new Uniform(12)],
        ['uValleyY', new Uniform(0)],
        ['uMistLayer', new Uniform(new Vector2(4, 110))],
      ]),
    });
    this.cam = cam;
  }
  u(name: string): Uniform {
    return this.uniforms.get(name)!;
  }
  update(): void {
    const c = this.cam;
    (this.u('uProjInv').value as Matrix4).copy(c.projectionMatrixInverse);
    (this.u('uViewInv').value as Matrix4).copy(c.matrixWorld);
    (this.u('uCamPos').value as Vector3).setFromMatrixPosition(c.matrixWorld);
    // position du soleil à l'écran
    const sd = this.u('uSunDir').value as Vector3;
    const v = this.tmp.copy(sd).multiplyScalar(5000).add(this.u('uCamPos').value as Vector3).project(c);
    const front = this.tmp2.copy(sd).transformDirection(c.matrixWorldInverse).z < -0.05;
    (this.u('uSunUv').value as Vector2).set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(v.x), Math.abs(v.y));
    this.u('uShafts').value = front ? this.shaftStrength * Math.max(0, Math.min(1, (1.7 - off) / 0.5)) : 0;
  }
}

const lensFrag = /* glsl */ `
uniform float uScope;
uniform float uMirage;
uniform vec2 uMirageFlow;
uniform float uCA;
uniform float uTimeL;
uniform sampler2D uNoiseL;
uniform float uAspectL;
uniform vec2 uCenterL;
uniform float uRkL;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 p = uv;
  // centre optique de la lunette (centre de l'écran en paysage, plus haut en portrait)
  vec2 c = (uv - uCenterL) * vec2(uAspectL, 1.0);
  float r0 = length(c);
  // distance au centre en unités du champ de référence (rayon 0,462 × hauteur)
  float r = r0 * uRkL;
  if (uMirage > 0.0001) {
    // mirage : cellules qui bouillonnent vers le haut sans vent, couchées et filantes avec le vent latéral
    vec2 cm = c * uRkL;
    vec2 q = cm * vec2(5.0, 9.0) - uMirageFlow * uTimeL;
    float n1 = texture2D(uNoiseL, q * 0.11).r - 0.5;
    float n2 = texture2D(uNoiseL, q * 0.27 + 0.4).g - 0.5;
    float band = 0.55 + 0.45 * smoothstep(0.25, -0.35, cm.y);
    p += vec2(n1 + n2 * 0.5, (n2 - n1 * 0.4)) * uMirage * band / uRkL;
  }
  float ca = uCA * r * r / uRkL;
  vec2 dir = r0 > 1e-4 ? c / r0 / vec2(uAspectL, 1.0) : vec2(0.0);
  vec3 col;
  if (ca > 0.00002) {
    col.r = texture2D(inputBuffer, p + dir * ca).r;
    col.g = texture2D(inputBuffer, p).g;
    col.b = texture2D(inputBuffer, p - dir * ca).b;
  } else {
    col = texture2D(inputBuffer, p).rgb;
  }
  outputColor = vec4(col, 1.0);
}
`;

export class LensEffect extends Effect {
  constructor(noise: Texture) {
    super('LensEffect', lensFrag, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uScope', new Uniform(0)],
        ['uMirage', new Uniform(0)],
        ['uMirageFlow', new Uniform(new Vector2(0, 1))],
        ['uCA', new Uniform(0.0012)],
        ['uTimeL', new Uniform(0)],
        ['uNoiseL', new Uniform(noise)],
        ['uAspectL', new Uniform(1.6)],
        ['uCenterL', new Uniform(new Vector2(0.5, 0.5))],
        ['uRkL', new Uniform(1)],
      ]),
    });
  }
  u(name: string): Uniform {
    return this.uniforms.get(name)!;
  }
}

const finishFrag = /* glsl */ `
uniform float uScopeF;
uniform vec2 uEye;
uniform float uAspectF;
uniform float uTimeF;
uniform float uVignette;
uniform float uSat;
uniform float uContrast;
uniform float uFade;
uniform float uBlackout;
uniform vec4 uVeil;
uniform float uFlashF;
uniform vec2 uCenterF;
uniform float uScopeR;
uniform float uVigK;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb * vec3(1.075, 1.0, 0.86);
  // étalonnage : contraste doux, ombres froides, hautes lumières chaudes
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
  l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += (1.0 - smoothstep(0.0, 0.45, l)) * vec3(-0.012, 0.004, 0.022);
  col += smoothstep(0.5, 1.0, l) * vec3(0.028, 0.010, -0.022);

  vec2 c = (uv - 0.5) * vec2(uAspectF, 1.0);
  float r = length(c) * uVigK;
  // vignettage général
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);

  float flashK = 0.0;
  if (uScopeF > 0.001) {
    // champ circulaire centré sur le centre optique (centre de l'écran en paysage, moitié haute en portrait)
    float R = uScopeR;
    c = (uv - uCenterF) * vec2(uAspectF, 1.0);
    vec2 e = uEye * (R / 0.462);
    float rr = length(c - e * 0.25);
    float rs = length(c - e);
    // assombrissement vers le bord du champ, ombre de l'oculaire qui se déplace avec l'œil
    float inside = 1.0 - smoothstep(R - 0.012, R, rr);
    float shade = 1.0 - smoothstep(R * 0.62, R * 1.06, rs) * 0.92;
    float tube = 1.0 - smoothstep(R * 0.55, R * 1.0, rr) * 0.35;
    vec3 img = col;
    if (uVeil.a + uFlashF > 0.001) {
      // départ du coup : voile de souffle et de poussière devant l'objectif (plus dense vers le bas du champ, d'où
      // monte la poussière ; il roule un peu), éclair de la flamme d'une image dans le bas du champ (ajouté plus bas)
      vec2 q = c / R;
      float low = 1.0 - smoothstep(-0.9, 0.9, q.y);
      float roll = 0.5 + 0.5 * sin(q.x * 3.1 + uTimeF * 5.0 + sin(q.y * 4.3 - uTimeF * 3.0) * 1.3);
      float va = clamp(uVeil.a * (0.62 + 0.3 * low + 0.16 * roll), 0.0, 0.96);
      img = mix(img, uVeil.rgb, va);
      flashK = uFlashF * (0.25 + 0.75 * low * low) * uScopeF;
    }
    flashK *= inside * shade;
    vec3 sc = img * inside * shade * tube;
    // liseré de la bague d'oculaire
    float ring = smoothstep(R + 0.004, R + 0.008, rr) * (1.0 - smoothstep(R + 0.012, R + 0.03, rr));
    sc += vec3(0.012, 0.012, 0.014) * ring;
    col = mix(col, sc, uScopeF);
  }
  col += (hash12(gl_FragCoord.xy + fract(uTimeF) * 61.0) - 0.5) * 0.014;
  col *= 1.0 - uBlackout;
  // l'éclair de la flamme passe par-dessus le noir du départ
  col += vec3(1.0, 0.72, 0.4) * flashK;
  col = mix(col, vec3(0.0), uFade);
  outputColor = vec4(max(col, 0.0), 1.0);
}
`;

export class FinishEffect extends Effect {
  constructor() {
    super('FinishEffect', finishFrag, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, Uniform>([
        ['uScopeF', new Uniform(0)],
        ['uEye', new Uniform(new Vector2())],
        ['uAspectF', new Uniform(1.6)],
        ['uTimeF', new Uniform(0)],
        ['uVignette', new Uniform(0.32)],
        ['uSat', new Uniform(1.12)],
        ['uContrast', new Uniform(0.35)],
        ['uFade', new Uniform(0)],
        ['uBlackout', new Uniform(0)],
        ['uVeil', new Uniform(new Vector4(0.74, 0.72, 0.66, 0))],
        ['uFlashF', new Uniform(0)],
        ['uCenterF', new Uniform(new Vector2(0.5, 0.5))],
        ['uScopeR', new Uniform(0.462)],
        ['uVigK', new Uniform(1)],
      ]),
    });
  }
  u(name: string): Uniform {
    return this.uniforms.get(name)!;
  }
}


// Occlusion ambiante légère : quelques lectures de profondeur en spirale, normale reconstruite par dérivées.
// Fusionnée dans la même passe que l'atmosphère (aucune cible de rendu supplémentaire).
const aoFrag = /* glsl */ `
uniform mat4 uProjInvA;
uniform vec2 uProjScale;
uniform float uAoRadius;
uniform float uAoStrength;
uniform float uAoN;

vec3 aoViewPos(vec2 uv, float d) {
  vec4 p = uProjInvA * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float aoIgn(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth > 0.999999 || uAoStrength < 0.001) { outputColor = inputColor; return; }
  vec3 P = aoViewPos(uv, depth);
  // rayon projeté en coordonnées d'écran ; au-dessous de quelques pixels l'effet n'apporte rien
  vec2 sr = uAoRadius * uProjScale / max(-P.z, 0.01) * 0.5;
  float px = sr.y * resolution.y;
  if (px < 2.5) { outputColor = inputColor; return; }
  sr = min(sr, vec2(0.07));
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  float a0 = aoIgn(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (float i = 0.0; i < 10.0; i++) {
    if (i >= uAoN) break;
    float r = sqrt((i + 0.5) / uAoN);
    float a = a0 + i * 2.3999632;
    vec2 q = uv + vec2(cos(a), sin(a)) * r * sr;
    vec3 S = aoViewPos(q, readDepth(q));
    vec3 v = S - P;
    float d2 = dot(v, v);
    float nv = dot(N, v) * inversesqrt(d2 + 1e-4);
    occ += max(nv - 0.12, 0.0) * (uAoRadius * uAoRadius) / (d2 + uAoRadius * uAoRadius);
  }
  float ao = 1.0 - uAoStrength * occ / uAoN;
  ao = mix(1.0, clamp(ao, 0.0, 1.0), smoothstep(2.5, 6.0, px));
  // l'ombre d'occlusion reste légèrement bleutée, comme l'ombre portée
  outputColor = vec4(inputColor.rgb * mix(vec3(0.05, 0.06, 0.09), vec3(1.0), ao), inputColor.a);
}
`;

export class AOEffect extends Effect {
  private cam: PerspectiveCamera;
  constructor(cam: PerspectiveCamera, samples: number) {
    super('AOEffect', aoFrag, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uProjInvA', new Uniform(new Matrix4())],
        ['uProjScale', new Uniform(new Vector2(1, 1))],
        ['uAoRadius', new Uniform(1.1)],
        ['uAoStrength', new Uniform(1.55)],
        ['uAoN', new Uniform(samples)],
      ]),
    });
    this.cam = cam;
  }
  update(): void {
    const c = this.cam;
    (this.uniforms.get('uProjInvA')!.value as Matrix4).copy(c.projectionMatrixInverse);
    (this.uniforms.get('uProjScale')!.value as Vector2).set(c.projectionMatrix.elements[0], c.projectionMatrix.elements[5]);
  }
}


// Anticrénelage de contours (famille FXAA) appliqué en tête de la passe principale, sur l'image HDR.
// Les luminances sont comprimées avant comparaison et mélange ; une passe plein écran séparée coûtait 2 ms en 1440p.
const aaFrag = /* glsl */ `
vec3 aaC(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 aaE(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 0.02); }
float aaL(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 m = aaC(inputColor.rgb);
  vec3 nw = aaC(texture2D(inputBuffer, uv + vec2(-1.0, -1.0) * texelSize).rgb);
  vec3 ne = aaC(texture2D(inputBuffer, uv + vec2(1.0, -1.0) * texelSize).rgb);
  vec3 sw = aaC(texture2D(inputBuffer, uv + vec2(-1.0, 1.0) * texelSize).rgb);
  vec3 se = aaC(texture2D(inputBuffer, uv + vec2(1.0, 1.0) * texelSize).rgb);
  float lM = aaL(m), lNW = aaL(nw), lNE = aaL(ne), lSW = aaL(sw), lSE = aaL(se);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.02, lMax * 0.09)) { outputColor = inputColor; return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * texelSize;
  vec3 a = 0.5 * (aaC(texture2D(inputBuffer, uv + dir * (1.0 / 3.0 - 0.5)).rgb) + aaC(texture2D(inputBuffer, uv + dir * (2.0 / 3.0 - 0.5)).rgb));
  vec3 b = a * 0.5 + 0.25 * (aaC(texture2D(inputBuffer, uv - dir * 0.5).rgb) + aaC(texture2D(inputBuffer, uv + dir * 0.5).rgb));
  float lB = aaL(b);
  outputColor = vec4(aaE(lB < lMin || lB > lMax ? a : b), inputColor.a);
}
`;

export class EdgeAAEffect extends Effect {
  constructor() {
    super('EdgeAAEffect', aaFrag, { blendFunction: BlendFunction.SET, attributes: EffectAttribute.CONVOLUTION });
  }
}
