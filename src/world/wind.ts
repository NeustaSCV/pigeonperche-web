// Champ de vent unique : la même formule sert à la balistique (TypeScript), à la végétation (GLSL) et au son.
// Les rafales sont des ondes qui se propagent dans le sens du vent ; leur longueur d'onde (125 à 1 500 m)
// fait que le vent diffère réellement le long de la trajectoire d'une balle.
import { Vector2, type IUniform } from 'three';

export interface WindSample {
  /** composantes du vent en m/s (repère monde, plan horizontal) */
  x: number;
  z: number;
  speed: number;
  /** 0..1 intensité de rafale locale */
  gust: number;
}

export class Wind {
  /** temps de simulation du vent (s) */
  time = 0;
  /** vitesse moyenne de consigne (m/s) */
  baseSpeed = 3.5;
  /** azimut de consigne d'où souffle le vent (degrés, 0 = du nord) */
  fromBearing = 255;
  /** direction courante vers laquelle va le vent (unitaire) */
  dir = new Vector2(1, 0);
  speedNow = 3.5;
  private smoothBase = 3.5;
  private smoothBearing = 255;
  /** amplitude des rafales (1 = référence : le vent local va de 0,5 à 1,5 fois la moyenne ; 0 = vent régulier) */
  gusts = 1;
  /**
   * errance lente du cap et de la force moyenne (1 = référence : ±21° et ±32 % sur plusieurs minutes ; 0 = cap et
   * force constants). Avec `gusts` à 0 aussi, le vent est le même partout et à tout instant.
   */
  wander = 1;
  /** abri du fond de vallée : part du vent qui reste au fond (0,62), altitude du fond, hauteur où le vent est plein */
  private shelter = 0.62;
  private shelterGain = 0.38;
  private valleyY = 0;
  private shelterHeight = 200;

  /**
   * Vent d'un niveau (data.wind, data.atmosphere) : consigne appliquée d'emblée, sans la lente montée du lissage.
   * Sans appel, le vent d'origine : 3,5 m/s du 255°, abri de 62 % au niveau 0, plein vent à 200 m.
   */
  configure(w: { fromBearing?: number; speed?: number; gusts?: number; wander?: number; shelter?: number; shelterHeight?: number; valleyY?: number }): void {
    if (w.fromBearing !== undefined) this.fromBearing = this.smoothBearing = w.fromBearing;
    if (w.speed !== undefined) this.baseSpeed = this.smoothBase = this.speedNow = w.speed;
    if (w.gusts !== undefined) this.gusts = w.gusts;
    if (w.wander !== undefined) this.wander = w.wander;
    if (w.shelter !== undefined) { this.shelter = w.shelter; this.shelterGain = 1 - w.shelter; }
    if (w.shelterHeight !== undefined) this.shelterHeight = w.shelterHeight;
    if (w.valleyY !== undefined) this.valleyY = w.valleyY;
    this.update(0);
  }

  /** Uniformes partagés par tous les shaders animés par le vent. */
  uniforms: { [k: string]: IUniform } = {
    uWindDir: { value: this.dir },
    uWindTime: { value: 0 },
    uWindSpeed: { value: 3.5 },
  };

  update(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 0.08);
    this.smoothBase += (this.baseSpeed - this.smoothBase) * k;
    let db = this.fromBearing - this.smoothBearing;
    db = ((db + 540) % 360) - 180;
    this.smoothBearing += db * k;
    const t = this.time;
    // `w` vaut 1 en solo : les produits `w * 14`… sont alors exacts, le vent est celui d'origine au bit près
    const w = this.wander;
    const bearing = this.smoothBearing + w * 14 * Math.sin(t * 0.011) + w * 7 * Math.sin(t * 0.037 + 1.3);
    this.speedNow = this.smoothBase * (1 + w * 0.22 * Math.sin(t * 0.017 + 1) + w * 0.1 * Math.sin(t * 0.053));
    // le vent va à l'opposé de l'azimut d'où il vient
    const b = ((bearing + 180) * Math.PI) / 180;
    this.dir.set(Math.sin(b), -Math.cos(b));
    this.uniforms.uWindTime.value = t;
    this.uniforms.uWindSpeed.value = this.speedNow;
  }

  /** Intensité de rafale 0..1 au point (x, z) à l'instant t (par défaut : maintenant). */
  gustAt(x: number, z: number, t = this.time): number {
    const a = x * this.dir.x + z * this.dir.y;
    const b = -x * this.dir.y + z * this.dir.x;
    const g1 = Math.sin(a * 0.011 - t * 0.077 + 1.7 * Math.sin(b * 0.006 + t * 0.021));
    const g2 = Math.sin(a * 0.05 - t * 0.35 + b * 0.013);
    const g3 = Math.sin(a * 0.0041 - t * 0.03 + 2.0);
    const g = Math.min(1, Math.max(0, 0.5 + 0.28 * g1 + 0.14 * g2 + 0.22 * g3));
    return g * Math.sqrt(g);
  }

  sample(x: number, y: number, z: number, out: WindSample, t = this.time): WindSample {
    const g = this.gustAt(x, z, t);
    // le fond de vallée est plus abrité que le sommet
    const shelter = this.shelter + this.shelterGain * Math.min(1, Math.max(0, (y - this.valleyY) / this.shelterHeight));
    const s = this.speedNow * (1 - 0.5 * this.gusts + this.gusts * g) * shelter;
    out.x = this.dir.x * s;
    out.z = this.dir.y * s;
    out.speed = s;
    out.gust = g;
    return out;
  }
}

/** Version GLSL strictement identique de gustAt. Nécessite uWindDir (vec2) et uWindTime (float). */
export const WIND_GLSL = /* glsl */ `
uniform vec2 uWindDir;
uniform float uWindTime;
uniform float uWindSpeed;
float windGust(vec2 p) {
  float a = dot(p, uWindDir);
  float b = dot(p, vec2(-uWindDir.y, uWindDir.x));
  float t = uWindTime;
  float g1 = sin(a * 0.011 - t * 0.077 + 1.7 * sin(b * 0.006 + t * 0.021));
  float g2 = sin(a * 0.05 - t * 0.35 + b * 0.013);
  float g3 = sin(a * 0.0041 - t * 0.03 + 2.0);
  float g = clamp(0.5 + 0.28 * g1 + 0.14 * g2 + 0.22 * g3, 0.0, 1.0);
  return g * sqrt(g);
}
// ondulation fine, visuelle seulement (herbe proche)
float windRipple(vec2 p) {
  float a = dot(p, uWindDir);
  float b = dot(p, vec2(-uWindDir.y, uWindDir.x));
  return sin(a * 0.9 - uWindTime * 2.6 + sin(b * 0.7 + uWindTime * 0.5) * 1.3) * 0.5 + 0.5;
}
`;
