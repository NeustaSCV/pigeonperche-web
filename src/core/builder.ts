// Petit constructeur de géométrie : boîtes orientées et quads à UV métriques, fusionnés en un seul maillage.
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const p = new Vector3();

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  useColor = false;
  color: [number, number, number] = [1, 1, 1];

  private vert(v: Vector3, n: Vector3, u: number, w: number): void {
    this.pos.push(v.x, v.y, v.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, w);
    this.col.push(this.color[0], this.color[1], this.color[2]);
  }

  /** Quad a-b-c-d (sens trigonométrique vu de face), UV fournis par coin. */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3, uvs: number[]): void {
    this.vert(a, n, uvs[0], uvs[1]);
    this.vert(b, n, uvs[2], uvs[3]);
    this.vert(c, n, uvs[4], uvs[5]);
    this.vert(a, n, uvs[0], uvs[1]);
    this.vert(c, n, uvs[4], uvs[5]);
    this.vert(d, n, uvs[6], uvs[7]);
  }

  /**
   * Boîte orientée : centre c, axes unitaires ax/ay/az, demi-dimensions. UV = coordonnées locales / uvS
   * décalées par (uo, vo) pour que des boîtes voisines partagent la même texture continue.
   */
  obox(c: Vector3, ax: Vector3, ay: Vector3, az: Vector3, hx: number, hy: number, hz: number, uvS = 1, uo = 0, vo = 0, skipBottom = false): void {
    const faces: [Vector3, Vector3, Vector3, number, number, number, number][] = [
      // normale, axe u, axe v, demi u, demi v, demi n, signe
      [az, ax, ay, hx, hy, hz, 1],
      [az, ax, ay, hx, hy, hz, -1],
      [ax, az, ay, hz, hy, hx, 1],
      [ax, az, ay, hz, hy, hx, -1],
      [ay, ax, az, hx, hz, hy, 1],
      [ay, ax, az, hx, hz, hy, -1],
    ];
    const n = new Vector3();
    const co: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    for (let f = 0; f < 6; f++) {
      const [fn, fu, fv, hu, hv, hn, sg] = faces[f];
      if (skipBottom && f === 5) continue;
      n.copy(fn).multiplyScalar(sg);
      const cu = c.dot(fu), cv = c.dot(fv);
      const corners = sg > 0 === (f < 2 || f >= 4 ? true : false) ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[1, -1], [-1, -1], [-1, 1], [1, 1]];
      const uvs: number[] = [];
      for (let k = 0; k < 4; k++) {
        const [su, sv] = corners[k];
        co[k].copy(c).addScaledVector(fn, hn * sg).addScaledVector(fu, hu * su).addScaledVector(fv, hv * sv);
        uvs.push((cu + hu * su) / uvS + uo, (cv + hv * sv) / uvS + vo);
      }
      // vérifie l'orientation : la normale géométrique doit suivre n
      p.copy(co[1]).sub(co[0]).cross(new Vector3().copy(co[2]).sub(co[0]));
      if (p.dot(n) < 0) this.quad(co[0], co[3], co[2], co[1], n, [uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3]]);
      else this.quad(co[0], co[1], co[2], co[3], n, uvs);
    }
  }

  /** Boîte alignée sur les axes du monde, éventuellement tournée autour de Y. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, uvS = 1, rotY = 0, skipBottom = false): void {
    if (rotY === 0) this.obox(new Vector3(cx, cy, cz), X, Y, Z, sx / 2, sy / 2, sz / 2, uvS, 0, 0, skipBottom);
    else {
      const ax = new Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
      const az = new Vector3(Math.sin(rotY), 0, Math.cos(rotY));
      this.obox(new Vector3(cx, cy, cz), ax, Y, az, sx / 2, sy / 2, sz / 2, uvS, 0, 0, skipBottom);
    }
  }

  /** Cylindre vertical (ou tronc de cône) à n côtés, avec couvercle supérieur. */
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, sides = 12, uvS = 1, cap = true): void {
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3(), n = new Vector3();
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2, t1 = ((i + 1) / sides) * Math.PI * 2;
      a.set(cx + Math.cos(t0) * r0, y0, cz + Math.sin(t0) * r0);
      b.set(cx + Math.cos(t1) * r0, y0, cz + Math.sin(t1) * r0);
      c.set(cx + Math.cos(t1) * r1, y0 + h, cz + Math.sin(t1) * r1);
      d.set(cx + Math.cos(t0) * r1, y0 + h, cz + Math.sin(t0) * r1);
      n.set(Math.cos((t0 + t1) / 2), 0, Math.sin((t0 + t1) / 2));
      const u0 = (t0 * r0) / uvS, u1 = (t1 * r0) / uvS;
      this.quad(b, a, d, c, n, [u1, y0 / uvS, u0, y0 / uvS, u0, (y0 + h) / uvS, u1, (y0 + h) / uvS]);
      if (cap) {
        const top = new Vector3(cx, y0 + h, cz);
        this.quad(top, c, d, top, Y, [cx / uvS, cz / uvS, c.x / uvS, c.z / uvS, d.x / uvS, d.z / uvS, cx / uvS, cz / uvS]);
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    if (this.useColor) g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
