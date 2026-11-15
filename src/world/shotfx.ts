// Effets visuels du coup de feu : flamme de bouche (forme selon le frein) et son halo, fumée et poussière
// (particules de fx.ts : aucun appel de dessin de plus), recul de l'arme et du tireur,
// saut du bipied, douille éjectée, voile de souffle et éclair dans la lunette.
// Les intensités viennent de shotfx-params.ts (fonctions pures, par arme). Ici : géométrie, particules, minuterie.
//
// Coût : 1 appel de dessin pour la flamme (toutes les nappes et le halo dans un seul maillage) pendant une à deux
// images ; 1 par douille visible (3 au plus, 2 en version allégée). Pas de lumière ponctuelle : elle aurait ajouté une
// lumière à tous les matériaux éclairés, en permanence. Pas non plus de disque d'éclair posé au sol (essayé : sur un
// talus il coupait le relief en arêtes nettes et se lisait de jour comme une nappe pâle) : l'éclair est le halo de la
// flamme. Les programmes sont compilés au chargement (`warm`), pas au premier tir.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, ShaderMaterial, Vector3,
  type Material, type Object3D,
} from 'three';
import type { Fx } from './fx';
import { dustAt, recoilAt, shotFxParams, veilAt, type ShotFxParams, type ShotFxSource } from './shotfx-params';

export type GroundKind = 'soil' | 'stone' | 'wood';

/** ce que les effets demandent au jeu */
export interface ShotFxHost {
  /** enregistre un matériau éclairé (ombres en cascade) */
  setupMaterial<T extends Material>(m: T): T;
  /** hauteur du sol ou du plancher sous (x, z), au plus haut à `nearY` + une marche ; `out.kind` : sa nature */
  ground(x: number, z: number, nearY: number, out?: { kind: GroundKind }): number;
  /** teinte de la poussière du sol en (x, z), RVB linéaire (palette du niveau) */
  dustColor(x: number, z: number, out: [number, number, number]): [number, number, number];
}

/** nombre maximal de quadrilatères de la flamme : 1 jet axial + 2 × 3 jets latéraux, 3 nappes chacun, et le halo */
const MAXQ = 24;
/** luminance visée de la poussière (RVB linéaire, avant la teinte du soleil) : assez sombre pour trancher sur l'herbe éclairée */
const DUST_LUM = 0.27;
/** luminance d'un sol moyen (prairie verte) : un sol plus clair donne une poussière plus claire, dans la limite de ±30 % */
const GROUND_LUM = 0.19;
/** part de gris dans la poussière : une terre brun-rouge donnerait un nuage rougeâtre ; il doit rester terreux */
const DUST_GREY = 0.35;
/** teinte du souffle sans poussière : gaz de poudre, gris chaud */
const BLAST: [number, number, number] = [0.74, 0.72, 0.66];

interface Case { m: Mesh; v: Vector3; w: Vector3; t: number; rest: boolean; r: number }

export class ShotFx {
  group = new Group();
  /** paramètres du dernier tir (null avant le premier) */
  last: ShotFxParams | null = null;
  /** recul vu de l'extérieur à appliquer à l'arme et au tireur : mètres et radians (voir Game.placeRifle) */
  kick = { back: 0, rise: 0, hop: 0, body: 0 };
  /** voile de la lunette : teinte (RVB linéaire) et opacité ; `flash` : éclair d'une image dans le bas du champ */
  veil = { r: BLAST[0], g: BLAST[1], b: BLAST[2], a: 0, flash: 0 };
  /** dernier tir (tests, captures) : hauteur de la bouche au-dessus du sol, poussière soulevée 0..1, nature et teinte du sol */
  info = { height: 0, dust: 0, ground: 'soil' as GroundKind, rgb: [0, 0, 0] };
  /** nombre de tirs vus (tests) */
  shots = 0;

  private flash: Mesh;
  private fGeo: BufferGeometry;
  private fMat: ShaderMaterial;
  private fPos: Float32Array;
  private fUv: Float32Array;
  private fK: Float32Array;
  private q = 0;
  private cases: Case[] = [];
  private nextCase = 0;
  private age = 99;
  private frames = 99;
  private fresh = false;
  private prone = false;
  private dustNow = 0;
  private ejectPending = false;
  private warm = 4;
  private later: { t: number; f: () => void }[] = [];
  private muzzle = new Vector3();
  private fwd = new Vector3();
  private right = new Vector3();
  private up = new Vector3();
  private tmp = new Vector3();
  private o0 = new Vector3();
  private gp = new Vector3();
  private dir = new Vector3();
  private side = new Vector3();
  private A = new Vector3();
  private B = new Vector3();
  private C = new Vector3();
  private D = new Vector3();
  private sd = [new Vector3(), new Vector3()];
  private kind: { kind: GroundKind } = { kind: 'soil' };
  private kind2: { kind: GroundKind } = { kind: 'soil' };
  private rgb: [number, number, number] = [0, 0, 0];
  private dustRgb: [number, number, number] = [0.3, 0.24, 0.16];

  constructor(private fx: Fx, private host: ShotFxHost, readonly lite: boolean) {
    this.group.name = 'shot_fx';
    // ------------------------------------------------------------------ flamme de bouche
    // Un seul maillage : des nappes croisées le long de chaque jet + un halo face caméra.
    this.fPos = new Float32Array(MAXQ * 4 * 3);
    this.fUv = new Float32Array(MAXQ * 4 * 2);
    this.fK = new Float32Array(MAXQ * 4 * 2);
    const fGeo = new BufferGeometry();
    fGeo.setAttribute('position', new BufferAttribute(this.fPos, 3));
    fGeo.setAttribute('uv', new BufferAttribute(this.fUv, 2));
    // x : 1 = halo face caméra (taille dans y), 0 = nappe ; y : taille ou graine
    fGeo.setAttribute('aK', new BufferAttribute(this.fK, 2));
    const idx: number[] = [];
    for (let i = 0; i < MAXQ; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    fGeo.setIndex(idx);
    fGeo.setDrawRange(0, 6);
    this.fGeo = fGeo;
    this.fMat = new ShaderMaterial({
      uniforms: { uI: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: /* glsl */ `attribute vec2 aK; varying vec2 vUv; varying vec2 vK;
        void main(){ vUv = uv; vK = aK; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          if (aK.x > 0.5) mv.xy += (uv * 2.0 - 1.0) * aK.y;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uI; uniform float uSeed; varying vec2 vUv; varying vec2 vK;
        float h(float x){ return fract(sin(x * 91.7 + uSeed * 13.1) * 43758.5); }
        void main(){
          vec3 col; float a;
          if (vK.x > 0.5) {
            // halo : disque doux
            vec2 c = vUv * 2.0 - 1.0; float d = dot(c, c); if (d > 1.0) discard;
            a = pow(1.0 - d, 3.0) * 0.3;
            col = vec3(1.0, 0.72, 0.38);
          } else {
            // nappe : u le long du jet, v en travers. Langue de feu en goutte : étroite à la bouche, ventrue, effilée au bout
            float u = vUv.x, v = vUv.y * 2.0 - 1.0;
            float len = 0.62 + 0.38 * h(vK.y * 3.0);
            float t = clamp(u / len, 0.0, 1.0);
            float w = (0.1 + 0.9 * pow(t, 0.6)) * pow(1.0 - t, 0.75) * (0.8 + 0.35 * h(floor(u * 14.0) + vK.y * 5.0));
            float core = exp(-(v * v) / (w * w * 0.5 + 0.0004));
            float tip = 1.0 - smoothstep(0.55, 1.0, t);
            a = core * tip * smoothstep(0.0, 0.03, u) * step(u, len);
            // cœur presque blanc, bords orangés qui s'éteignent
            col = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.9, 0.66), smoothstep(0.35, 0.95, a));
            a *= 0.55 + 0.45 * tip;
          }
          gl_FragColor = vec4(col * a * uI * 2.3, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.flash = new Mesh(fGeo, this.fMat);
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 22;
    this.group.add(this.flash);

    // ------------------------------------------------------------------ douilles
    const brass = host.setupMaterial(new MeshStandardMaterial({ color: 0xc19a45, metalness: 1, roughness: 0.32 }));
    const cg = new CylinderGeometry(1, 0.92, 1, lite ? 6 : 10, 1);
    cg.rotateX(Math.PI / 2);
    for (let i = 0; i < (lite ? 2 : 3); i++) {
      const m = new Mesh(cg, brass);
      m.frustumCulled = false;
      // une douille de quelques millimètres : son ombre ne se voit pas, et coûterait un appel de dessin par cascade
      m.castShadow = false;
      m.scale.setScalar(0.001);
      this.group.add(m);
      this.cases.push({ m, v: new Vector3(), w: new Vector3(), t: 0, rest: true, r: 0.006 });
    }
    // préchauffage : flamme et douilles sont dessinées (invisibles : intensité nulle, taille d'un millimètre)
    // pendant les premières images, derrière le rideau de chargement ; leurs programmes sont donc compilés avant le jeu
  }

  /** Repère de la bouche dans le monde, d'après le modèle de l'arme (canon vers +Z, côté droit = −X). */
  aim(rifle: Object3D, muzzleLocal: Vector3): void {
    rifle.updateWorldMatrix(true, false);
    this.muzzle.copy(muzzleLocal);
    rifle.localToWorld(this.muzzle);
    this.fwd.set(0, 0, 1).transformDirection(rifle.matrixWorld);
    this.right.set(-1, 0, 0).transformDirection(rifle.matrixWorld);
    this.up.set(0, 1, 0).transformDirection(rifle.matrixWorld);
  }

  private quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, bill: number, kk: number): void {
    if (this.q >= MAXQ) return;
    const o = this.q * 12, u = this.q * 8;
    const ps = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      const p = ps[i];
      this.fPos[o + i * 3] = p.x; this.fPos[o + i * 3 + 1] = p.y; this.fPos[o + i * 3 + 2] = p.z;
      this.fK[u + i * 2] = bill; this.fK[u + i * 2 + 1] = kk;
    }
    this.fUv.set([0, 0, 1, 0, 1, 1, 0, 1], u);
    this.q++;
  }
  /** Un jet de flamme : des nappes croisées autour de son axe, pour qu'il ait du volume sous tous les angles. */
  private jet(origin: Vector3, d: Vector3, len: number, width: number): void {
    const { dir, side, tmp, A, B, C, D } = this;
    dir.copy(d).normalize();
    side.set(0, 1, 0).cross(dir);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const seed = Math.random();
    const n = this.lite ? 2 : 3;
    for (let i = 0; i < n; i++) {
      tmp.copy(side).applyAxisAngle(dir, (i * Math.PI) / n + seed).multiplyScalar(width);
      A.copy(origin).sub(tmp); B.copy(origin).addScaledVector(dir, len).sub(tmp);
      C.copy(origin).addScaledVector(dir, len).add(tmp); D.copy(origin).add(tmp);
      this.quad(A, B, C, D, 0, seed + i * 0.31);
    }
  }
  /** directions des deux gerbes latérales d'un frein (rabattues vers l'arrière, davantage pour le gros frein) */
  private sideDirs(tank: boolean): Vector3[] {
    const back = tank ? -0.36 : -0.18;
    for (let i = 0; i < 2; i++) this.sd[i].copy(this.right).multiplyScalar(i === 0 ? 1 : -1).addScaledVector(this.fwd, back).addScaledVector(this.up, 0.12).normalize();
    return this.sd;
  }

  /**
   * Départ du coup. À appeler après `aim()`. `prone` : tir couché sur bipied ; `nearY` : altitude des pieds du tireur
   * (pour trouver le sol ou le plancher sous la bouche).
   */
  fire(def: ShotFxSource, prone: boolean, nearY: number): ShotFxParams {
    const p = shotFxParams(def, this.lite);
    const { fx, host, muzzle, fwd, o0, tmp } = this;
    this.last = p;
    this.shots++;
    this.age = 0;
    this.frames = 0;
    this.fresh = true;
    this.prone = prone;
    this.ejectPending = true;
    // sol sous la bouche ; devant un ressaut (pas de tir en bord de talus) le souffle atteint encore le sol plus haut,
    // en retrait et sur les côtés : on retient le point le plus proche de l'empreinte du souffle
    let gy = host.ground(muzzle.x, muzzle.z, nearY + 0.5, this.kind);
    for (const [df, dr] of [[-0.7, 0], [-0.35, 0.6], [-0.35, -0.6]]) {
      const x = muzzle.x + fwd.x * df + this.right.x * dr, z = muzzle.z + fwd.z * df + this.right.z * dr;
      const g = host.ground(x, z, nearY + 0.5, this.kind2);
      if (g > gy && g < muzzle.y) { gy = g; this.kind.kind = this.kind2.kind; }
    }
    const hgt = Math.max(0, muzzle.y - gy);
    const e = p.energy;
    const tank = p.shape === 'tank';
    const brake = p.shape === 'side' || tank;

    // --- flamme ---
    this.q = 0;
    if (p.flame > 0) {
      const f = p.flame;
      this.jet(muzzle, fwd, (brake ? 0.22 : 0.45) * f, (brake ? 0.05 : 0.085) * f);
      if (brake) {
        const big = tank ? 1.35 : 1;
        for (let i = 0; i < p.ports; i++) {
          o0.copy(muzzle).addScaledVector(fwd, -0.012 - i * 0.03 * big);
          for (const d of this.sideDirs(tank)) this.jet(o0, d, 0.3 * f * big * (1 - i * 0.18), 0.075 * f * big);
        }
      }
      // halo face caméra : l'éclair du départ du coup
      this.quad(muzzle, muzzle, muzzle, muzzle, 1, 0.12 + 0.4 * p.glow);
    }
    for (const n of ['position', 'uv', 'aK']) (this.fGeo.getAttribute(n) as BufferAttribute).needsUpdate = true;
    this.fGeo.setDrawRange(0, this.q * 6);
    this.fMat.uniforms.uSeed.value = Math.random() * 100;
    this.fMat.uniforms.uI.value = 1;
    // --- fumée à la bouche : dérive avec le vent ---
    const smoke = (d: Vector3, sp: number, n: number, size: number, alpha: number, life: number): void => {
      fx.puff(muzzle, { count: Math.max(0, Math.round(n)), speed: sp, spread: 0.5, life, size: [0.05 + size * 0.15, size], color: 0xd2d0c8, alpha, drag: 3.2, wind: 0.9, dir: d });
    };
    const s = p.smoke;
    if (p.muzzle === 'suppressor' || !brake) smoke(fwd, p.muzzle === 'suppressor' ? 0.8 : 5 * (0.4 + e), p.smokeCount, 0.2 + 0.95 * s, 0.2 + 0.3 * s, 1.4 + 1.8 * s);
    else {
      smoke(fwd, 2 * (0.4 + e), p.smokeCount * 0.4, 0.2 + 0.95 * s, 0.2 + 0.3 * s, 1.4 + 1.8 * s);
      for (const d of this.sideDirs(tank)) smoke(d, 5 * (0.4 + e), p.smokeCount * 0.3, 0.2 + 0.85 * s, 0.2 + 0.28 * s, 1.2 + 1.6 * s);
    }

    // --- poussière soulevée : seulement si la bouche est près du sol ; teinte du sol, moins sur la pierre, à peine sur le bois ---
    const surfK = this.kind.kind === 'wood' ? 0.25 : this.kind.kind === 'stone' ? 0.6 : 1;
    const dE = dustAt(p, hgt) * surfK;
    this.dustNow = dE;
    this.dustColorAt(muzzle.x + fwd.x * 0.5, muzzle.z + fwd.z * 0.5, this.kind.kind);
    this.info = { height: hgt, dust: dE, ground: this.kind.kind, rgb: [...this.dustRgb] };
    if (dE > 0.04) {
      const rgb: [number, number, number] = [this.dustRgb[0], this.dustRgb[1], this.dustRgb[2]];
      const count = (p.dustCount * dE) / p.dust * 1.5;
      const dust = (at: Vector3, d: Vector3, sp: number, n: number, size: number, alpha: number, life: number, lift: number): void => {
        this.gp.copy(at);
        this.gp.y = host.ground(at.x, at.z, nearY + 0.5) + 0.12;
        // version allégée : moins de particules, donc plus grosses et plus légères, pour qu'elles se fondent en un nuage
        fx.puff(this.gp, { count: Math.max(0, Math.round(n)), speed: sp, up: lift, spread: 0.3, life, size: [0.12, size * (this.lite ? 1.3 : 1)], rgb, alpha: alpha * (this.lite ? 0.85 : 1), gravity: 0.3, drag: 3.0, wind: 0.5, fade: 1.4, dir: tmp.copy(d).setY(0) });
      };
      const reach = 0.5 + 1.6 * dE;
      const a0 = 0.58 + 0.16 * dE;
      if (brake) {
        // le frein rabat le souffle sur les côtés : deux gerbes au sol, puis (seconde vague) le nuage qui se lève plus loin
        for (const d of this.sideDirs(tank)) {
          const d2 = new Vector3(d.x, 0, d.z).normalize();
          dust(o0.copy(muzzle).addScaledVector(d2, 0.35), d2, 5.5 * dE + 1, count * 0.3, 0.35 + 0.9 * dE, a0, 1.1 + 0.9 * dE, 1.0 + 1.6 * dE);
          if (p.dustWaves > 1) {
            const m0 = muzzle.clone();
            this.later.push({ t: 0.06, f: () => dust(o0.copy(m0).addScaledVector(d2, reach), d2, 2.2 * dE + 0.5, count * 0.3, 0.5 + 1.2 * dE, a0 - 0.08, 1.5 + 1.2 * dE, 1.8 + 2.6 * dE) });
          }
        }
        dust(o0.copy(muzzle).addScaledVector(fwd, 0.3), fwd, 2.5 * dE + 0.5, count * 0.2, 0.35 + 0.9 * dE, a0, 1.2 + 0.9 * dE, 1.0 + 1.6 * dE);
      } else {
        // canon nu : le souffle part dans l'axe et rase le sol devant la bouche
        dust(o0.copy(muzzle).addScaledVector(fwd, 0.35), fwd, 6 * dE + 1, count * 0.5, 0.35 + 0.9 * dE, a0, 1.1 + 0.9 * dE, 1.0 + 1.6 * dE);
        if (p.dustWaves > 1) {
          const m0 = muzzle.clone(), f0 = fwd.clone();
          this.later.push({ t: 0.06, f: () => dust(o0.copy(m0).addScaledVector(f0, reach), f0, 2.4 * dE + 0.5, count * 0.5, 0.5 + 1.2 * dE, a0 - 0.08, 1.5 + 1.2 * dE, 1.8 + 2.6 * dE) });
        }
      }
    }

    // --- lunette : teinte du voile (souffle gris, poussière du sol si elle vole) ---
    const k = p.dust > 0 ? Math.min(1, dE / p.dust) : 0;
    this.veil.r = BLAST[0] + (this.dustRgb[0] * 2.4 - BLAST[0]) * k;
    this.veil.g = BLAST[1] + (this.dustRgb[1] * 2.4 - BLAST[1]) * k;
    this.veil.b = BLAST[2] + (this.dustRgb[2] * 2.4 - BLAST[2]) * k;
    return p;
  }

  /** teinte de la poussière sous la bouche, ramenée à une luminance fixe (la poussière garde la couleur du sol, pas sa clarté) */
  private dustColorAt(x: number, z: number, kind: GroundKind): void {
    const c = this.rgb;
    if (kind === 'stone') { c[0] = 0.25; c[1] = 0.24; c[2] = 0.22; }
    else if (kind === 'wood') { c[0] = 0.25; c[1] = 0.21; c[2] = 0.16; }
    else this.host.dustColor(x, z, c);
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const want = DUST_LUM * Math.min(1.3, Math.max(0.75, lum / GROUND_LUM));
    const k = want / Math.max(0.01, lum);
    for (let i = 0; i < 3; i++) this.dustRgb[i] = Math.min(1, c[i] * k * (1 - DUST_GREY) + want * DUST_GREY);
  }

  /** Éjecte la douille par la fenêtre d'éjection (côté droit), à l'ouverture de la culasse. `port` : repère de l'arme. */
  private eject(rifle: Object3D, port: Vector3, p: ShotFxParams): void {
    const c = this.cases[this.nextCase++ % this.cases.length];
    this.aim(rifle, this.tmp.copy(port));
    c.m.scale.set(p.caseR, p.caseR, p.caseLen);
    c.r = p.caseR;
    c.m.position.copy(port).add(this.tmp.set(-0.02, 0.012, 0.03));
    rifle.localToWorld(c.m.position);
    c.v.copy(this.right).multiplyScalar(1.5 + Math.random() * 0.5).addScaledVector(this.up, 1.3 + Math.random() * 0.4).addScaledVector(this.fwd, -0.25);
    c.w.set(Math.random() * 18 - 9, Math.random() * 14 - 7, Math.random() * 18 - 9);
    rifle.getWorldQuaternion(c.m.quaternion);
    c.t = 0; c.rest = false;
    c.m.visible = true;
  }

  /**
   * Une image. `exterior` : le tireur est vu de l'extérieur (flamme visible ; dans la lunette, c'est l'éclair du
   * voile qui la rend) ; `boltPhase` : avancement du réarmement (la douille part quand la culasse recule) ;
   * `rifle`, `port` : modèle de l'arme et position de repos du verrou ; `nearY` : altitude des pieds du tireur.
   */
  update(dt: number, exterior: boolean, boltPhase: number, rifle: Object3D | null, port: Vector3 | null, nearY: number): void {
    const p = this.last;
    if (this.fresh) this.fresh = false;
    else { this.age += dt; this.frames++; }
    // la flamme tient une image, deux au plus (la seconde très atténuée), et jamais plus de 40 ms
    const on = !!p && this.frames < p.flameFrames && this.age < 0.04;
    const warm = this.warm > 0;
    if (warm) this.warm--;
    this.flash.visible = warm || (on && exterior && this.q > 0);
    if (on && this.frames === 1) this.fMat.uniforms.uI.value = 0.2;
    for (const c of this.cases) if (warm) c.m.visible = true; else if (c.rest && c.t === 0) c.m.visible = false;

    for (let j = this.later.length - 1; j >= 0; j--) {
      this.later[j].t -= dt;
      if (this.later[j].t <= 0) { const f = this.later[j].f; this.later.splice(j, 1); f(); }
    }
    // recul vu de l'extérieur et voile de la lunette
    const k = this.kick, v = this.veil;
    if (p && this.age < 1.6) {
      const r = recoilAt(this.age);
      k.back = 0.06 * p.recoil * r.back;
      k.rise = 0.04 * p.recoil * r.back * (this.prone ? 0.6 : 1);
      k.hop = this.prone ? 0.018 * p.recoil * r.hop : 0;
      k.body = p.recoil * r.body;
      v.a = veilAt(p, this.age, this.dustNow);
      v.flash = this.frames === 0 ? p.scopeFlash : 0;
    } else { k.back = k.rise = k.hop = k.body = 0; v.a = 0; v.flash = 0; }

    // douille : éjectée quand la culasse recule (phase 0,17 à 0,38 du réarmement)
    if (this.ejectPending && p && rifle && port && boltPhase > 0.3) { this.ejectPending = false; this.eject(rifle, port, p); }
    for (const c of this.cases) {
      if (!c.m.visible || warm) continue;
      c.t += dt;
      if (c.t > 20) { c.m.visible = false; c.t = 0; c.rest = true; continue; }
      if (c.rest) continue;
      c.v.y -= 9.81 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotateX(c.w.x * dt); c.m.rotateY(c.w.y * dt);
      const gy = this.host.ground(c.m.position.x, c.m.position.z, Math.max(nearY, c.m.position.y) + 0.3) + c.r;
      if (c.m.position.y < gy) {
        c.m.position.y = gy;
        if (c.v.y > -0.6) { c.rest = true; c.m.rotation.set(0, Math.random() * 6.28, 0); } else { c.v.y *= -0.28; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5); }
      }
    }
  }

  /** Efface les effets en cours (changement d'arme, reprise d'un objectif, captures). */
  reset(): void {
    for (const c of this.cases) { c.m.visible = false; c.t = 0; c.rest = true; }
    this.later.length = 0;
    this.age = 99; this.frames = 99; this.fresh = false; this.ejectPending = false;
  }

  /** maillages propres aux effets visibles à l'instant (tests : appels de dessin ajoutés) */
  get drawn(): number {
    return (this.flash.visible ? 1 : 0) + this.cases.filter((c) => c.m.visible).length;
  }
}
