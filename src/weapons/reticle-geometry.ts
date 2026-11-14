// Géométrie du réticule de la lunette, en milliradians : croix ouverte à point central flottant, graduations fines,
// arbre de contre-visée de 24 mrad sous le centre. C'est le réticule propre au jeu (aucun modèle du commerce n'est
// reproduit) ; ses proportions s'inspirent des réticules gravés « arbre de Noël » des lunettes de précision au premier
// plan focal : trait de 0,03 à 0,05 mrad, point central de 0,04 à 0,06 mrad, pas fin de 0,2 mrad près du centre,
// traits de longueurs distinctes au demi-mrad et au mrad, points de dérive fins sur des lignes de chute qui
// s'élargissent, barres épaisses extérieures. Ordres de grandeur relevés dans un manuel de réticule de ce type :
//   https://cdn.shopify.com/s/files/1/0604/4313/files/Vortex_EBR-7C_MRAD_Reticle_Manual.pdf
//
// Repère : x vers la droite, y vers le BAS (y > 0 = contre-visée, sous le centre), en mrad depuis le centre optique.
// Ce fichier ne dessine rien : `Reticle` (scope.ts) trace ces listes, les tests en vérifient les valeurs.

/** épaisseur du trait fin, mrad */
export const LINE_MIL = 0.035;
/** diamètre du point central, mrad */
export const CENTER_DOT_MIL = 0.06;
/** les quatre branches commencent à cette distance du centre (croix ouverte autour du point), mrad */
export const CENTER_GAP_MIL = 0.15;
/** étendue graduée des branches gauche, droite et haute, mrad */
export const AXIS_MIL = 10;
/** graduations fines de 0,2 mrad : sur la branche horizontale, jusqu'à cette distance du centre, mrad */
export const FINE_MIL = 4;
/** contre-visée graduée sous le centre : dernière ligne de l'arbre, mrad */
export const TREE_MIL = 24;
/** barres épaisses extérieures : épaisseur, et début à gauche, à droite et en haut ; en bas, sous l'arbre */
export const BAR_MIL = 0.4;
export const BAR_START_MIL = 10.5;
export const BAR_BOTTOM_START_MIL = 25;
/** points de dérive de l'arbre : un par mrad sur chaque ligne de chute */
export const DOT_MIL = 0.08;
/** hauteur des chiffres, mrad */
export const DIGIT_MIL = 0.3;

/** demi-largeur (mrad) de la ligne de points de dérive à `drop` mrad sous le centre : 2, 2, 3, 3, … puis 6 */
export const treeHalfWidth = (drop: number): number => Math.min(6, 1 + Math.ceil(drop / 2));

/**
 * Une graduation. `axis` 'h' : trait vertical posé sur la branche horizontale à x = `at`, de y = `from` à y = `to` ;
 * 'v' : trait horizontal posé sur la branche verticale à y = `at`, de x = `from` à x = `to`.
 * `pitch` : pas de la famille à laquelle elle appartient (0,2 ; 0,5 ; 1 pour un mrad impair ; 2 pour un pair) :
 * une famille dont le pas n'est plus séparable à l'écran n'est pas tracée, comme elle se fond sur un vrai réticule.
 */
export interface Tick { axis: 'h' | 'v'; at: number; from: number; to: number; pitch: number }
/** zone de graduations fines : rendue en grisé quand le pas `pitch` n'est plus séparable */
export interface Band { axis: 'h' | 'v'; a0: number; a1: number; from: number; to: number; pitch: number }
export interface Dot { x: number; y: number; d: number }
/**
 * Un chiffre. Le point (x, y) est le bord du chiffre tourné vers les graduations : milieu du bas ('bottom'), milieu
 * du bord gauche ('left') ou droit ('right'). Agrandi pour rester lisible, le chiffre s'écarte donc des graduations.
 */
export interface Label { text: string; value: number; x: number; y: number; anchor: 'bottom' | 'left' | 'right' }

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const intPitch = (n: number): number => (Math.round(n) % 2 === 0 ? 2 : 1);

export interface ReticleGeometry { ticks: Tick[]; bands: Band[]; dots: Dot[]; labels: Label[] }

function build(): ReticleGeometry {
  const ticks: Tick[] = [];
  const bands: Band[] = [];
  const dots: Dot[] = [];
  const labels: Label[] = [];

  // ---- branche horizontale, des deux côtés ----
  for (const s of [-1, 1]) {
    for (let i = 1; i <= AXIS_MIL * 10; i++) {
      const m = r3(i / 10);
      // mrad entier : trait long traversant ; demi-mrad : trait moyen sous le trait ; 0,2 mrad : trait court au-dessus
      if (i % 10 === 0) ticks.push({ axis: 'h', at: s * m, from: -0.3, to: 0.3, pitch: intPitch(m) });
      else if (i % 5 === 0) ticks.push({ axis: 'h', at: s * m, from: 0, to: 0.2, pitch: 0.5 });
      else if (i % 2 === 0 && m < FINE_MIL) ticks.push({ axis: 'h', at: s * m, from: -0.14, to: 0, pitch: 0.2 });
    }
    bands.push({ axis: 'h', a0: s * 0.2, a1: s * (FINE_MIL - 0.2), from: -0.14, to: 0, pitch: 0.2 });
    // chiffres pairs au-dessus des traits longs
    for (const n of [2, 4, 6, 8, 10]) labels.push({ text: String(n), value: n, x: s * n, y: -0.42, anchor: 'bottom' });
  }

  // ---- branche haute : mrad (± 0,25) et demi-mrad (± 0,12), chiffres pairs à droite ----
  for (let i = 1; i <= AXIS_MIL * 2; i++) {
    const m = i / 2;
    const half = i % 2 === 0 ? 0.25 : 0.12;
    ticks.push({ axis: 'v', at: -m, from: -half, to: half, pitch: i % 2 === 0 ? intPitch(m) : 0.5 });
  }
  for (const n of [2, 4, 6, 8, 10]) labels.push({ text: String(n), value: n, x: 0.4, y: -n, anchor: 'left' });

  // ---- branche basse et arbre de contre-visée ----
  for (let i = 1; i <= TREE_MIL * 2; i++) {
    const m = i / 2;
    const half = i % 2 === 0 ? 0.2 : 0.1;
    ticks.push({ axis: 'v', at: m, from: -half, to: half, pitch: i % 2 === 0 ? intPitch(m) : 0.5 });
  }
  for (let drop = 1; drop <= TREE_MIL; drop++) {
    const e = treeHalfWidth(drop);
    for (const s of [-1, 1]) {
      // un point de dérive par mrad, de plus en plus loin à mesure que la chute augmente
      for (let k = 1; k <= e; k++) dots.push({ x: s * k, y: drop, d: DOT_MIL });
      // les lignes paires portent leur chute en mrad à chaque bout
      if (drop % 2 === 0) labels.push({ text: String(drop), value: drop, x: s * (e + 0.35), y: drop, anchor: s < 0 ? 'right' : 'left' });
    }
  }
  return { ticks, bands, dots, labels };
}

/** le réticule, calculé une fois */
export const RETICLE: ReticleGeometry = build();

/**
 * Seuils de lisibilité à `ppm` pixels CSS par mrad. Les positions ne changent jamais ; seuls changent l'épaisseur
 * minimale des traits (un trait de 0,035 mrad fait moins d'un pixel à presque tous les grossissements du jeu), la
 * taille minimale des points et des chiffres, et les familles tracées : un pas trop serré pour l'écran se fond en grisé.
 */
export interface ReticleLod {
  /** épaisseur des branches et des graduations, px CSS */
  axisW: number;
  tickW: number;
  /** plus petit pas de graduation tracé trait par trait, mrad (Infinity : aucune graduation) */
  minPitch: number;
  /** points de dérive tracés un par un ? (sinon : un trait gris par ligne de l'arbre) */
  dots: boolean;
  /** diamètre tracé des points de dérive, px CSS */
  dotPx: number;
  /** lignes de l'arbre tracées : toutes (1) ou une sur deux (2) quand elles se toucheraient */
  rowStep: number;
  /** chiffres : tous ; 'sparse' : seulement les lignes 4, 8, 12… de l'arbre ; ou aucun. Taille de la police, px CSS */
  labels: 'all' | 'sparse' | 'none';
  fontPx: number;
}

export function reticleLod(ppm: number, dpr: number): ReticleLod {
  const fine = dpr >= 2;
  const tickW = Math.max(LINE_MIL * ppm, fine ? 0.75 : 1);
  const axisW = Math.max(LINE_MIL * ppm, fine ? 0.75 : 1);
  const dotPx = Math.max(DOT_MIL * ppm, fine ? 1.2 : 1.6);
  let minPitch = Infinity;
  for (const p of [2, 1, 0.5, 0.2]) if (p * ppm >= 2 * tickW) minPitch = p;
  const minFont = fine ? 7 : 8;
  return {
    axisW, tickW, minPitch, dotPx,
    dots: ppm >= 3.2 * dotPx,
    rowStep: ppm >= 4.5 * dotPx ? 1 : 2,
    labels: ppm >= 4.4 ? 'all' : ppm >= 2.2 ? 'sparse' : 'none',
    fontPx: Math.max((DIGIT_MIL / 0.72) * ppm, minFont),
  };
}
