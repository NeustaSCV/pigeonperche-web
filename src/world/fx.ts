// Effets : particules en panneaux (fumée, poussière, étincelles, feu), traînée de vapeur de la balle,
// pollen et insectes dans la lumière, oiseaux en vol.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  Points,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { mulberry32 } from '../core/noise';
import type { Wind, WindSample } from './wind';

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  r: number; g: number; b: number; a: number;
  grav: number; drag: number; windK: number; glow: number;
}
export interface PuffOpts {
  count?: number;
  speed?: number;
  up?: number;
  spread?: number;
  life?: number;
  size?: [number, number];
  color?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  wind?: number;
  glow?: number;
  dir?: Vector3;
}
interface Emitter {
  pos: Vector3;
  rate: number;
  acc: number;
  opts: PuffOpts;
  on: boolean;
}

const MAX = 900;

export class Fx {
  group = new Group();
  private ps: P[] = [];
  private geo: InstancedBufferGeometry;
  private aPos: Float32Array;
  private aCol: Float32Array;
  private aSize: Float32Array;
  private emitters: Emitter[] = [];
  private ws: WindSample = { x: 0, z: 0, speed: 0, gust: 0 };
  private c = new Color();
  private trailGeo: BufferGeometry;
  private trailPos: Float32Array;
  private trailAlpha: Float32Array;
  private trailPts: { p: Vector3; t: number }[] = [];
  trail: Mesh;
  private motes: Points;
  private birds: InstancedMesh;
  private birdData: { cx: number; cz: number; r: number; h: number; sp: number; ph: number }[] = [];
  private dummy = new Object3D();
  private time = 0;

  constructor(private wind: Wind, sunTint: Color) {
    // --- particules ---
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new Float32Array(MAX * 3);
    this.aCol = new Float32Array(MAX * 4);
    this.aSize = new Float32Array(MAX);
    const ap = new InstancedBufferAttribute(this.aPos, 3), ac = new InstancedBufferAttribute(this.aCol, 4), as = new InstancedBufferAttribute(this.aSize, 1);
    ap.setUsage(DynamicDrawUsage); ac.setUsage(DynamicDrawUsage); as.setUsage(DynamicDrawUsage);
    g.setAttribute('iPos', ap);
    g.setAttribute('iCol', ac);
    g.setAttribute('iSize', as);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new ShaderMaterial({
      uniforms: { uTint: { value: sunTint } },
      vertexShader: /* glsl */ `attribute vec3 iPos; attribute vec4 iCol; attribute float iSize; varying vec2 vUv; varying vec4 vCol;
        void main(){ vUv = position.xy; vCol = iCol; vec4 mv = viewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * iSize; gl_Position = projectionMatrix * mv;
          // plan proche adaptatif de la lunette : la poussière du départ du coup (à plus de 0,55 m) reste visible, collée au plan proche
          if (-mv.z > 0.55) gl_Position.z = max(gl_Position.z, -gl_Position.w * 0.9999); }`,
      fragmentShader: /* glsl */ `uniform vec3 uTint; varying vec2 vUv; varying vec4 vCol;
        void main(){ float d = dot(vUv, vUv); if (d > 1.0) discard; float a = (1.0 - d); a *= a; gl_FragColor = vec4(vCol.rgb * uTint, vCol.a * a); }`,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
    });
    const mesh = new Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    this.group.add(mesh);

    // --- traînée de vapeur ---
    const TN = 400;
    this.trailPos = new Float32Array(TN * 2 * 3);
    this.trailAlpha = new Float32Array(TN * 2);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(this.trailPos, 3).setUsage(DynamicDrawUsage));
    tg.setAttribute('aA', new BufferAttribute(this.trailAlpha, 1).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TN - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    tg.setIndex(idx);
    tg.setDrawRange(0, 0);
    this.trailGeo = tg;
    this.trail = new Mesh(
      tg,
      new ShaderMaterial({
        vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; if (-mv.z > 0.55) gl_Position.z = max(gl_Position.z, -gl_Position.w * 0.9999); }',
        fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(1.5, 1.45, 1.35), vA); }',
        transparent: true, depthWrite: false, side: DoubleSide, blending: NormalBlending,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 21;
    this.group.add(this.trail);

    // --- pollen et insectes : points qui dérivent dans une boîte recentrée sur la caméra ---
    const rnd = mulberry32(5);
    const MN = 420;
    const mp = new Float32Array(MN * 3), ms = new Float32Array(MN);
    for (let i = 0; i < MN; i++) {
      mp[i * 3] = rnd() * 40; mp[i * 3 + 1] = rnd() * 9; mp[i * 3 + 2] = rnd() * 40;
      ms[i] = rnd();
    }
    const mg = new BufferGeometry();
    mg.setAttribute('position', new BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new BufferAttribute(ms, 1));
    this.motes = new Points(
      mg,
      new ShaderMaterial({
        uniforms: { uT: { value: 0 }, uCam: { value: new Vector3() }, uOff: { value: new Vector3() }, uSun: { value: new Vector3(0, 1, 0) }, uTint: { value: sunTint }, uFade: { value: 1 }, uScale: { value: 900 } },
        vertexShader: /* glsl */ `attribute float aSeed; uniform float uT; uniform vec3 uCam; uniform vec3 uOff; uniform float uScale; varying float vS; varying vec3 vDir;
          void main(){
            vec3 box = vec3(40.0, 9.0, 40.0);
            vec3 p = position + uOff;
            // les insectes (une graine sur quatre) zigzaguent, le pollen flotte
            float bug = step(0.75, aSeed);
            p += vec3(sin(uT * (0.6 + aSeed * 2.0 + bug * 5.0) + aSeed * 40.0), sin(uT * (0.4 + bug * 4.0) + aSeed * 17.0) * 0.6, cos(uT * (0.5 + aSeed + bug * 6.0) + aSeed * 23.0)) * (0.5 + bug * 0.9);
            p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
            p.y = max(p.y, uCam.y - 4.5);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vS = aSeed; vDir = normalize(p - uCam);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uScale * (0.012 + 0.014 * fract(aSeed * 7.0) + bug * 0.012) / max(-mv.z, 0.5);
          }`,
        fragmentShader: /* glsl */ `uniform vec3 uSun; uniform vec3 uTint; uniform float uFade; varying float vS; varying vec3 vDir;
          void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
            float toSun = pow(max(dot(vDir, uSun), 0.0), 3.0);
            float a = (1.0 - d) * (0.10 + 0.9 * toSun) * uFade;
            gl_FragColor = vec4(uTint * (0.7 + 2.2 * toSun), a); }`,
        transparent: true, depthWrite: false, blending: AdditiveBlending,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 19;
    this.group.add(this.motes);

    // --- oiseaux ---
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0.25, 0, 0, -0.2, 0.75, 0.0, -0.05, 0, 0, 0.25, -0.75, 0.0, -0.05, 0, 0, -0.2]), 3));
    const bm = new MeshBasicMaterial({ color: 0x15171a, side: DoubleSide });
    bm.onBeforeCompile = (sh) => {
      sh.uniforms.uTB = this.birdTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTB;').replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
         float flap = sin(uTB * (5.0 + fract(instanceMatrix[3].x * 0.37) * 3.0) + instanceMatrix[3].z);
         transformed.y += abs(position.x) * (flap * 0.55 + 0.1);`,
      );
    };
    const NB = 14;
    this.birds = new InstancedMesh(bg, bm, NB);
    for (let i = 0; i < NB; i++) {
      const flock = i < 8 ? 0 : 1;
      this.birdData.push({ cx: flock ? -260 + rnd() * 40 : 120 + rnd() * 50, cz: flock ? -380 + rnd() * 40 : -160 + rnd() * 60, r: 60 + rnd() * 110, h: 215 + rnd() * 70, sp: (0.07 + rnd() * 0.05) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6.28 });
    }
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
  }
  private birdTime = { value: 0 };

  puff(pos: Vector3, o: PuffOpts = {}): void {
    const n = o.count ?? 8;
    this.c.set(o.color ?? 0xb8a890);
    for (let i = 0; i < n && this.ps.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * (o.spread ?? 1);
      const sp = (o.speed ?? 1) * (0.4 + Math.random() * 0.8);
      let vx = Math.cos(a) * Math.cos(e) * sp, vy = Math.abs(Math.sin(e)) * sp + (o.up ?? 0), vz = Math.sin(a) * Math.cos(e) * sp;
      if (o.dir) { vx += o.dir.x * (o.speed ?? 1); vy += o.dir.y * (o.speed ?? 1); vz += o.dir.z * (o.speed ?? 1); }
      const life = (o.life ?? 1.5) * (0.6 + Math.random() * 0.7);
      const k = 0.8 + Math.random() * 0.4;
      this.ps.push({
        x: pos.x, y: pos.y, z: pos.z, vx, vy, vz, life, max: life,
        s0: (o.size?.[0] ?? 0.15) * k, s1: (o.size?.[1] ?? 0.8) * k,
        r: this.c.r * k, g: this.c.g * k, b: this.c.b * k, a: o.alpha ?? 0.5,
        grav: o.gravity ?? 0, drag: o.drag ?? 1.2, windK: o.wind ?? 1, glow: o.glow ?? 0,
      });
    }
  }
  addEmitter(pos: Vector3, rate: number, opts: PuffOpts, on = true): Emitter {
    const e = { pos: pos.clone(), rate, acc: 0, opts, on };
    this.emitters.push(e);
    return e;
  }

  /** Ajoute un point à la traînée de vapeur. */
  trailPoint(p: Vector3): void {
    this.trailPts.push({ p: p.clone(), t: this.time });
    if (this.trailPts.length > 398) this.trailPts.shift();
  }
  clearTrail(): void {
    this.trailPts.length = 0;
  }

  update(dt: number, cam: PerspectiveCamera, sunDir: Vector3, zoomK: number, realDt: number, viewH = window.innerHeight): void {
    this.time += dt;
    this.birdTime.value += dt;
    for (const e of this.emitters) {
      if (!e.on) continue;
      e.acc += e.rate * dt;
      while (e.acc >= 1) { e.acc -= 1; this.puff(e.pos, { ...e.opts, count: 1 }); }
    }
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.ps[i] = this.ps[this.ps.length - 1]; this.ps.pop(); continue; }
      if (p.windK > 0) {
        this.wind.sample(p.x, p.y, p.z, this.ws);
        const k = Math.min(1, dt * 1.8) * p.windK;
        p.vx += (this.ws.x - p.vx) * k;
        p.vz += (this.ws.z - p.vz) * k;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vy = p.vy * dr - p.grav * dt;
      if (p.windK === 0) { p.vx *= dr; p.vz *= dr; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.ps) {
      const u = 1 - p.life / p.max;
      this.aPos[n * 3] = p.x; this.aPos[n * 3 + 1] = p.y; this.aPos[n * 3 + 2] = p.z;
      this.aSize[n] = p.s0 + (p.s1 - p.s0) * Math.sqrt(u);
      const fade = Math.min(1, u * 8) * (1 - u) * (1 - u);
      const gl = 1 + p.glow * (1 - u) * 6;
      this.aCol[n * 4] = p.r * gl; this.aCol[n * 4 + 1] = p.g * gl; this.aCol[n * 4 + 2] = p.b * gl; this.aCol[n * 4 + 3] = p.a * fade;
      n++;
    }
    this.geo.instanceCount = n;
    (this.geo.getAttribute('iPos') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iCol') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('iSize') as BufferAttribute).needsUpdate = true;

    // traînée : ruban face caméra, qui s'élargit et s'estompe avec l'âge
    const pts = this.trailPts;
    while (pts.length && this.time - pts[0].t > 2.2) pts.shift();
    const cp = cam.position;
    const side = new Vector3(), d = new Vector3(), v = new Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(pts.length - 1, i + 1)].p;
      d.copy(b).sub(a);
      v.copy(pts[i].p).sub(cp);
      const dist = v.length();
      side.crossVectors(d, v).normalize();
      const age = (this.time - pts[i].t) / 2.2;
      const w = (0.004 + age * 0.03) * (1 + dist * zoomK * 0.02);
      const o = i * 6;
      this.trailPos[o] = pts[i].p.x + side.x * w; this.trailPos[o + 1] = pts[i].p.y + side.y * w; this.trailPos[o + 2] = pts[i].p.z + side.z * w;
      this.trailPos[o + 3] = pts[i].p.x - side.x * w; this.trailPos[o + 4] = pts[i].p.y - side.y * w; this.trailPos[o + 5] = pts[i].p.z - side.z * w;
      const al = 0.2 * (1 - age) * (1 - age) * Math.min(1, i / 3) * Math.min(1, dist / 3);
      this.trailAlpha[i * 2] = this.trailAlpha[i * 2 + 1] = al;
    }
    this.trailGeo.setDrawRange(0, Math.max(0, (pts.length - 1) * 6));
    (this.trailGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.trailGeo.getAttribute('aA') as BufferAttribute).needsUpdate = true;

    // pollen
    const mu = (this.motes.material as ShaderMaterial).uniforms;
    mu.uT.value += realDt;
    mu.uCam.value.copy(cp);
    mu.uOff.value.x += this.wind.dir.x * this.wind.speedNow * dt * 0.35;
    mu.uOff.value.z += this.wind.dir.y * this.wind.speedNow * dt * 0.35;
    mu.uOff.value.y -= dt * 0.04;
    mu.uSun.value.copy(sunDir);
    mu.uFade.value = Math.min(1, Math.max(0, (zoomK - 0.35) * 3));
    mu.uScale.value = viewH * 0.9;

    // oiseaux
    const dm = this.dummy;
    this.birdData.forEach((b, i) => {
      const a = b.ph + this.time * b.sp;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r * 0.7;
      dm.position.set(x, b.h + Math.sin(a * 2.3 + i) * 9, z);
      dm.rotation.set(0, -a - (b.sp > 0 ? 0 : Math.PI), Math.sin(a * 1.7) * 0.25 * Math.sign(b.sp));
      dm.scale.setScalar(0.9);
      dm.updateMatrix();
      this.birds.setMatrixAt(i, dm.matrix);
    });
    this.birds.instanceMatrix.needsUpdate = true;
  }
}
