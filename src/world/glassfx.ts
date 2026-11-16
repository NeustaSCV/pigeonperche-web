// Carreaux brisés : visuel posé sur la vitre touchée, éclats, bruit. L'effet dépend de l'énergie de la balle à
// l'impact : une .22 LR perce un trou étoilé, un calibre moyen fait tomber le carreau, un gros calibre le souffle.
import { CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { Fx } from './fx';
import type { Pane } from './glass';

/** sous ce seuil (J), la balle perce et fêle sans faire tomber le carreau */
export const GLASS_CRACK_J = 250;
/** au-dessus (J), le carreau est soufflé : éclats projetés loin, poussière du cadre */
export const GLASS_BLAST_J = 2500;
/** au-delà de cette taille (m), un vitrage ne tombe pas d'un bloc : seule une plage autour de l'impact se brise */
const WHOLE_MAX = 2.6;
const SLOTS = 64;

export type GlassLevel = 'crack' | 'break' | 'blast';
/** Effet d'une balle de `energy` joules sur un carreau dans l'état `state` (un carreau déjà fêlé cède au coup suivant). */
export function glassLevel(energy: number, state: 0 | 1 | 2): GlassLevel {
  if (energy >= GLASS_BLAST_J) return 'blast';
  return energy >= GLASS_CRACK_J || state >= 1 ? 'break' : 'crack';
}

const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

function canvas(draw: (c: CanvasRenderingContext2D, S: number) => void): CanvasTexture {
  const S = 256, el = document.createElement('canvas');
  el.width = el.height = S;
  draw(el.getContext('2d')!, S);
  const t = new CanvasTexture(el);
  t.colorSpace = SRGBColorSpace;
  return t;
}
const cracks = (c: CanvasRenderingContext2D, S: number, n: number, r0: number, r1: number): void => {
  c.strokeStyle = 'rgba(245,250,252,0.95)';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    let x = S / 2 + Math.cos(a) * r0, y = S / 2 + Math.sin(a) * r0, dir = a;
    c.lineWidth = 2.6;
    c.beginPath(); c.moveTo(x, y);
    const len = r0 + (r1 - r0) * (0.55 + rnd() * 0.45);
    for (let r = r0; r < len; r += 9) { dir += (rnd() - 0.5) * 0.5; x += Math.cos(dir) * 9; y += Math.sin(dir) * 9; c.lineTo(x, y); }
    c.stroke();
  }
};
/** trou net et étoile de fêlures */
const crackTex = (): CanvasTexture => canvas((c, S) => {
  // voile clair autour du trou : le verre étoilé blanchit
  const g = c.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.42);
  g.addColorStop(0, 'rgba(235,244,248,0.6)'); g.addColorStop(1, 'rgba(235,244,248,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  cracks(c, S, 11, 7, S * 0.47);
  c.strokeStyle = 'rgba(235,245,250,0.5)'; c.lineWidth = 1;
  for (const r of [22, 46]) { c.beginPath(); for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 2, q = r * (0.8 + rnd() * 0.4); c[i ? 'lineTo' : 'moveTo'](S / 2 + Math.cos(a) * q, S / 2 + Math.sin(a) * q); } c.stroke(); }
  c.fillStyle = 'rgba(8,10,12,0.95)'; c.beginPath(); c.arc(S / 2, S / 2, 9, 0, Math.PI * 2); c.fill();
});
/** carreau tombé : vide sombre, dents de verre restées au bord */
const brokenTex = (): CanvasTexture => canvas((c, S) => {
  // verre resté au cadre : dépoli clair, pour que le vide sombre se lise de loin, même sur une vitre déjà sombre
  c.fillStyle = 'rgba(226,238,243,0.34)';
  c.fillRect(0, 0, S, S);
  cracks(c, S, 9, S * 0.3, S * 0.7);
  c.fillStyle = 'rgba(4,5,6,0.97)';
  c.beginPath();
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    // contour en dents, proche du cadre (carré arrondi)
    const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const r = (S / 2) * Math.min(sq, 1.32) * (i % 2 ? 0.9 : 0.55 + rnd() * 0.2);
    c[i ? 'lineTo' : 'moveTo'](S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
  }
  c.closePath(); c.fill();
  c.lineWidth = 2.5; c.strokeStyle = 'rgba(245,250,252,0.95)'; c.stroke();
});

export class GlassFx {
  group = new Group();
  private slots: Mesh[] = [];
  private owner: (Pane | null)[] = [];
  private next = 0;
  private crack: MeshBasicMaterial;
  private broken: MeshBasicMaterial;
  private p = new Vector3();
  private back = new Vector3();
  /** nombre de carreaux touchés, par effet (tests, statistiques) */
  count = { crack: 0, break: 0, blast: 0 };

  constructor(private fx: Fx) {
    const mk = (map: CanvasTexture): MeshBasicMaterial =>
      new MeshBasicMaterial({ map, transparent: true, side: DoubleSide, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    this.crack = mk(crackTex());
    this.broken = mk(brokenTex());
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < SLOTS; i++) {
      const m = new Mesh(geo, this.crack);
      m.visible = false;
      m.matrixAutoUpdate = false;
      m.renderOrder = 2;
      this.slots.push(m);
      this.owner.push(null);
      this.group.add(m);
    }
  }

  /** Une balle traverse `pane` au point `point`, direction `dir` (unitaire), avec `energy` joules. Renvoie l'effet. */
  hit(pane: Pane, point: Vector3, dir: Vector3, energy: number): GlassLevel {
    const level = glassLevel(energy, pane.state);
    this.count[level]++;
    const big = pane.hu * 2 > WHOLE_MAX || pane.hv * 2 > WHOLE_MAX;
    // un grand vitrage garde son visuel par impact ; un carreau n'en a qu'un, remplacé quand il cède
    let slot = big ? -1 : pane.slot;
    if (slot < 0) {
      slot = this.next;
      this.next = (this.next + 1) % SLOTS;
      const old = this.owner[slot];
      if (old && old.slot === slot) old.slot = -1;
      this.owner[slot] = big ? null : pane;
      if (!big) pane.slot = slot;
    }
    const m = this.slots[slot];
    // point d'impact ramené dans le plan du carreau
    const p = this.p.copy(point).addScaledVector(pane.n, pane.center.clone().sub(point).dot(pane.n));
    let w: number, h: number;
    if (level === 'crack') {
      w = h = Math.min(0.7, 1.7 * Math.min(pane.hu, pane.hv) + 0.15);
      m.material = this.crack;
    } else if (big) {
      w = h = level === 'blast' ? 1.9 : 1.2;
      m.material = this.broken;
    } else {
      p.copy(pane.center);
      w = pane.hu * 2; h = pane.hv * 2;
      m.material = this.broken;
    }
    // un rien devant la vitre, des deux côtés possibles : le visuel est double face, on le décolle vers le tireur
    const side = dir.dot(pane.n) > 0 ? -1 : 1;
    const depth = Math.abs(pane.center.clone().sub(point).dot(pane.n)) + 0.012;
    p.addScaledVector(pane.n, side * depth);
    m.matrix.makeBasis(pane.u.clone().multiplyScalar(w), pane.v.clone().multiplyScalar(h), pane.n);
    m.matrix.setPosition(p);
    m.matrixWorldNeedsUpdate = true;
    m.visible = true;
    if (level !== 'crack') pane.state = 2;
    else if (pane.state === 0) pane.state = 1;
    // éclats : surtout dans le sens de la balle, un peu en retour vers le tireur
    const k = level === 'crack' ? 0.35 : level === 'break' ? 1 : 2.2;
    const shard = { life: 1.1, size: [0.035, 0.02] as [number, number], color: 0xdff1f6, alpha: 0.95, gravity: 9.8, drag: 0.5, wind: 0, glow: 0.35, fade: 0.6 };
    this.fx.puff(point, { ...shard, count: Math.round(14 * k), speed: 2.2 + 1.6 * k, dir, spread: 1.2 });
    this.fx.puff(point, { ...shard, count: Math.round(6 * k), speed: 1.2 + 0.6 * k, dir: this.back.copy(dir).multiplyScalar(-0.6), spread: 1.4 });
    if (level === 'blast') this.fx.puff(point, { count: 10, speed: 1.6, life: 1.6, size: [0.2, 1.3], color: 0xcfc8ba, alpha: 0.4, drag: 1.6, wind: 0.6 });
    return level;
  }
}
