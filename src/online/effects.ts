// Mode en ligne : ce qui trahit un tireur, et ce qui montre une touche (recettes de src/ville/effets.js et tir.js,
// inchangées). Chaque coup de feu laisse une balle traçante le long de sa vraie trajectoire (`Shots.trace`) : une
// traînée seule, sans bille ni point au bout. Le tir d'un autre montre en plus une flamme à la bouche du canon et
// s'entend (src/online/sounds.ts) : détonation retardée par la distance, placée à gauche ou à droite, et souffle de
// la balle si elle passe tout près. Une touche fait une gerbe rouge, exagérée pour se voir de loin. Le tireur qui
// nous tient dans sa lunette se trahit par un reflet.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import { GAME_AIR, firingSolution } from '../ballistics';
import { SIGHT_HEIGHT, type WeaponDef } from '../config/weapons';
import { boreDirection, type Bullet, type ShotTrace, type Shots } from '../game/shots';
import type { Target } from '../game/targets';
import type { OnlineSounds } from './sounds';

/** durée de l'effacement de la traînée, une fois la balle arrivée, s */
export const TRAIL_FADE = 1.6;
/** sa propre traçante ne se dessine qu'à partir de cette distance, m : elle éblouirait dans la lunette */
export const OWN_TRAIL_FROM = 25;
/** durée de la flamme à la bouche, s */
export const FLASH_SEC = 0.14;
/** une balle qui passe à moins de cette distance s'entend, m */
export const PASS_RANGE = 20;
/** durée de la gerbe d'une touche, s */
export const SPRAY_SEC = 2.2;

interface Trail { line: Line<BufferGeometry, LineBasicMaterial>; tr: ShotTrace; from: number; t0: number }
interface Flash { m: Mesh<SphereGeometry, MeshBasicMaterial>; t0: number }
interface Spray {
  g: Group; mat: MeshBasicMaterial; veil: MeshBasicMaterial; cloud: Mesh; k: number; t0: number;
  parts: { m: Mesh; vx: number; vy: number; vz: number }[];
}

export interface OnlineEffectsDeps {
  /** où ajouter les effets (la scène du jeu) */
  scene: Object3D;
  camera: PerspectiveCamera;
  shots: Shots;
  /** sons du mode en ligne ; sans eux, les effets sont muets */
  sounds?: OnlineSounds | null;
}

export class OnlineEffects {
  private scene: Object3D;
  private camera: PerspectiveCamera;
  private shots: Shots;
  private sounds: OnlineSounds | null;
  /** horloge des effets, s : avancée par `update` */
  private time = 0;
  private trails: Trail[] = [];
  private flashes: Flash[] = [];
  private sprays: Spray[] = [];
  private glints = new Map<string, Mesh>();

  private ball = new SphereGeometry(1, 8, 6);
  private shard = new IcosahedronGeometry(1, 0);
  private cloudGeo = new SphereGeometry(1, 12, 8);
  private glintGeo = new SphereGeometry(1, 10, 8);
  private flashMat = new MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 1, depthTest: false, blending: AdditiveBlending });
  private glintMat = new MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.95, depthTest: false, blending: AdditiveBlending });
  private right = new Vector3();
  private v = new Vector3();

  constructor(d: OnlineEffectsDeps) {
    this.scene = d.scene;
    this.camera = d.camera;
    this.shots = d.shots;
    this.sounds = d.sounds ?? null;
  }

  /** Bouche du canon d'un tireur dont l'œil est en `eye`. */
  static muzzle(eye: Vector3, out = new Vector3()): Vector3 {
    return out.set(eye.x, eye.y - SIGHT_HEIGHT, eye.z);
  }

  // ---------- coups de feu ----------

  /**
   * Son propre tir : la traçante seule (ni flamme, elle emplirait la lunette, ni son : le coup de feu et la culasse
   * du solo sont joués par l'arme). À appeler à l'instant du coup, avec la balle que `Shots.fire` vient de rendre :
   * la traînée part de sa bouche dans sa direction, dispersion comprise, et s'arrête là où la balle s'arrêtera.
   */
  localShot(bullet: Bullet, maxT = 8): ShotTrace {
    const s = bullet.s;
    const tr = this.shots.trace(bullet.origin, this.v.set(s.vx, s.vy, s.vz), bullet.def, maxT);
    this.addTrail(tr, true);
    return tr;
  }

  /**
   * Tir d'un autre joueur : œil en `eye`, direction de son canon `dir` (celle qu'il a annoncée), arme `def`.
   * Flamme, détonation à sa distance, souffle si la balle passe près, traçante. `self` : sa cible dans le jeu, que
   * sa propre balle ne doit pas heurter au départ.
   */
  remoteShot(eye: Vector3, dir: Vector3, def: WeaponDef, self: Target | null = null, maxT = 8): ShotTrace {
    return this.shot(OnlineEffects.muzzle(eye), dir, def, maxT, self);
  }

  /**
   * Tir d'un robot, de l'œil `eye` vers le tireur dont l'œil est en `targetEye` : visée réglée pour la distance,
   * déviée s'il manque (`hit` faux).
   */
  robotShot(eye: Vector3, targetEye: Vector3, hit: boolean, def: WeaponDef, self: Target | null = null): ShotTrace {
    const o = OnlineEffects.muzzle(eye), c = OnlineEffects.muzzle(targetEye);
    c.y -= 0.55; // il vise le buste
    const range = o.distanceTo(c);
    const sol = firingSolution(def, { range, heightDiff: c.y - o.y, air: GAME_AIR, sightHeight: SIGHT_HEIGHT });
    const los = c.sub(o).normalize(), miss = hit ? 0 : 1.5 + Math.random() * 3; // mrad
    const a = Math.random() * 6.283;
    const dir = boreDirection(los, def, (sol ? sol.elevMil : 0) + Math.sin(a) * miss, Math.cos(a) * miss, new Vector3());
    return this.shot(o, dir, def, hit && sol ? sol.tof : 8, self);
  }

  private shot(o: Vector3, dir: Vector3, def: WeaponDef, maxT: number, self: Target | null): ShotTrace {
    this.flash(o);
    this.report(o, def);
    const tr = this.shots.trace(o, dir, def, maxT, self);
    this.pass(tr);
    this.addTrail(tr, false);
    return tr;
  }

  /** Balle traçante : une traînée qui suit la trajectoire puis s'efface. Pas de bille au bout. */
  private addTrail(tr: ShotTrace, own: boolean): void {
    if (tr.n < 2) return;
    const P = tr.pts;
    let from = 0;
    if (own) while (from < tr.n - 2 && Math.hypot(P[from * 4] - P[0], P[from * 4 + 1] - P[1], P[from * 4 + 2] - P[2]) < OWN_TRAIL_FROM) from++;
    const pos = new Float32Array(tr.n * 3);
    for (let i = 0; i < tr.n; i++) { pos[i * 3] = P[i * 4]; pos[i * 3 + 1] = P[i * 4 + 1]; pos[i * 3 + 2] = P[i * 4 + 2]; }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setDrawRange(0, 0);
    const line = new Line(g, new LineBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    this.scene.add(line);
    this.trails.push({ line, tr, from, t0: this.time });
  }

  /** Flamme à la bouche : un éclat orangé très bref, grossi avec la distance pour se voir de loin. */
  private flash(o: Vector3): void {
    const m = new Mesh(this.ball, this.flashMat.clone());
    m.frustumCulled = false;
    m.renderOrder = 12;
    m.position.copy(o);
    m.scale.setScalar(0);
    this.scene.add(m);
    this.flashes.push({ m, t0: this.time });
  }

  /** Détonation d'un tir parti de `o` : retardée par la distance, placée à gauche ou à droite. */
  private report(o: Vector3, def: WeaponDef): void {
    if (!this.sounds) return;
    const cam = this.camera;
    const d = o.distanceTo(cam.position), to = this.v.subVectors(o, cam.position).normalize();
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.sounds.distantShot(def, d, Math.max(-1, Math.min(1, to.dot(this.right) * 1.2)));
  }

  /** Si la balle d'un autre passe à moins de 20 m sans nous toucher, on entend son souffle au moment où elle passe. */
  private pass(tr: ShotTrace): void {
    if (!this.sounds) return;
    const P = tr.pts, c = this.camera.position;
    let best = 1e9, k = -1;
    for (let i = 0; i < tr.n; i++) {
      const d = Math.hypot(P[i * 4] - c.x, P[i * 4 + 1] - c.y, P[i * 4 + 2] - c.z);
      if (d < best) { best = d; k = i; }
    }
    if (k < 1 || best > PASS_RANGE || best < 1.2) return; // trop loin, ou en plein sur nous : c'est une touche, la voix suffit
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const a = (k - 1) * 4, b = Math.min(tr.n - 1, k + 1) * 4;
    this.sounds.bulletPass((P[b] - P[a]) * this.right.x + (P[b + 2] - P[a + 2]) * this.right.z, P[k * 4 + 3]);
  }

  // ---------- touche ----------

  /** Gerbe rouge d'une touche au point `p` : un nuage qui gonfle et des éclats projetés, grossis avec la distance. */
  hitSpray(p: Vector3): void {
    const k = Math.max(0.14, p.distanceTo(this.camera.position) * 0.0011), g = new Group();
    g.position.copy(p);
    // Les éclats écrivent la profondeur (sinon la brume du jeu, calculée sur la profondeur, les traite comme le fond
    // derrière eux) et se dessinent après le nuage : ils restent rouge franc au lieu d'être voilés de rose sur un ciel clair.
    const mat = new MeshBasicMaterial({ color: 0xc40d0d, transparent: true, opacity: 0.95, depthWrite: true });
    const veil = new MeshBasicMaterial({ color: 0xe01616, transparent: true, opacity: 0.6, depthWrite: false });
    const cloud = new Mesh(this.cloudGeo, veil);
    cloud.frustumCulled = false;
    cloud.scale.setScalar(k * 2.5);
    cloud.renderOrder = 1;
    g.add(cloud);
    const parts: Spray['parts'] = [];
    for (let i = 0; i < 40; i++) {
      const m = new Mesh(this.shard, mat);
      m.frustumCulled = false;
      m.scale.setScalar(k * (0.35 + Math.random() * 0.9));
      m.renderOrder = 2;
      g.add(m);
      const a = Math.random() * 6.283, h = Math.random() * 1.3 - 0.25, v = k * (5 + Math.random() * 11);
      parts.push({ m, vx: Math.cos(a) * v, vy: (0.6 + h) * v, vz: Math.sin(a) * v });
    }
    this.scene.add(g);
    this.sprays.push({ g, mat, veil, cloud, parts, k, t0: this.time });
  }

  // ---------- reflet de lunette ----------

  /**
   * Allume (œil du tireur en `eye`) ou éteint (`eye` nul) le reflet du tireur `id`, qui nous tient dans sa lunette.
   * Le serveur ne l'annonce qu'au joueur visé : lui seul le voit.
   */
  setGlint(id: string, eye: Vector3 | null): void {
    let m = this.glints.get(id);
    if (!eye) {
      if (m) { this.scene.remove(m); this.glints.delete(id); }
      return;
    }
    if (!m) {
      m = new Mesh(this.glintGeo, this.glintMat);
      m.frustumCulled = false;
      m.renderOrder = 11;
      m.scale.setScalar(0);
      this.scene.add(m);
      this.glints.set(id, m);
    }
    m.position.copy(eye);
  }
  clearGlints(): void {
    for (const id of [...this.glints.keys()]) this.setGlint(id, null);
  }

  // ---------- chaque image ----------

  /** `dt` : temps écoulé, s (temps réel : la manche ne se met pas en pause). `scoped` : lunette à l'œil. */
  update(dt: number, scoped: boolean): void {
    this.time += dt;
    const now = this.time, cam = this.camera, half = Math.tan((cam.fov * Math.PI) / 360);

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i], age = Math.max(0, now - f.t0);
      if (age > FLASH_SEC) { this.scene.remove(f.m); f.m.material.dispose(); this.flashes.splice(i, 1); continue; }
      // taille réglée sur le champ : une quinzaine de pixels à l'écran, à l'œil nu comme en lunette
      f.m.scale.setScalar(Math.max(0.12, f.m.position.distanceTo(cam.position) * half * 0.016) * (1 - (age / FLASH_SEC) * 0.5));
      f.m.material.opacity = 1 - age / FLASH_SEC;
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const a = this.trails[i], age = Math.max(0, now - a.t0), P = a.tr.pts, n = a.tr.n, end = a.tr.tof;
      if (age > end + TRAIL_FADE) { this.scene.remove(a.line); a.line.geometry.dispose(); a.line.material.dispose(); this.trails.splice(i, 1); continue; }
      // dernier point déjà atteint par la balle
      let k = Math.min(n - 1, Math.floor(age * 100));
      while (k > 0 && P[k * 4 + 3] > age) k--;
      while (k < n - 1 && P[(k + 1) * 4 + 3] <= age) k++;
      a.line.geometry.setDrawRange(a.from, Math.max(0, k + 1 - a.from));
      a.line.material.opacity = 0.85 * (age < end ? 1 : Math.max(0, 1 - (age - end) / TRAIL_FADE));
    }

    // l'éclat scintille et garde une taille apparente à peu près constante, pour rester « léger » à toute distance
    const flicker = 0.75 + 0.35 * Math.sin(now * 19) + 0.2 * Math.sin(now * 47);
    for (const m of this.glints.values()) m.scale.setScalar(m.position.distanceTo(cam.position) * (scoped ? 0.0009 : 0.0022) * flicker);

    for (let i = this.sprays.length - 1; i >= 0; i--) {
      const b = this.sprays[i], age = now - b.t0;
      if (age > SPRAY_SEC) { this.scene.remove(b.g); b.mat.dispose(); b.veil.dispose(); this.sprays.splice(i, 1); continue; }
      const f = age * (1 - 0.18 * age);
      for (const q of b.parts) q.m.position.set(q.vx * f, q.vy * f - 5 * b.k * age * age, q.vz * f);
      b.cloud.scale.setScalar(b.k * (2.5 + 9 * Math.sqrt(age)));
      b.veil.opacity = 0.6 * Math.max(0, 1 - age / 1.2);
      b.mat.opacity = 0.95 * Math.max(0, 1 - Math.max(0, age - 1.2) / (SPRAY_SEC - 1.2));
    }
  }

  /** nombre d'effets en cours (tests, mise au point) */
  get active(): { trails: number; flashes: number; sprays: number; glints: number } {
    return { trails: this.trails.length, flashes: this.flashes.length, sprays: this.sprays.length, glints: this.glints.size };
  }

  /** Retire tout de la scène (changement de poste, fin de manche) ; les effets pourront resservir. */
  clear(): void {
    for (const a of this.trails) { this.scene.remove(a.line); a.line.geometry.dispose(); a.line.material.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.m); f.m.material.dispose(); }
    for (const b of this.sprays) { this.scene.remove(b.g); b.mat.dispose(); b.veil.dispose(); }
    this.trails.length = this.flashes.length = this.sprays.length = 0;
    this.clearGlints();
  }

  /** Libère aussi les géométries et matières partagées : l'objet ne doit plus servir. */
  dispose(): void {
    this.clear();
    for (const x of [this.ball, this.shard, this.cloudGeo, this.glintGeo, this.flashMat, this.glintMat]) x.dispose();
  }
}
