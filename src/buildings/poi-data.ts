// Points d'intérêt nommés à la main pour les bâtiments de premier choix (selection.ts), en complément de ceux que
// poi.ts calcule. Positions dans le repère local (origine au centre du lot, +x est, +z sud, y = 0 au sol), relevées
// sur le banc d'essai (e2e/buildings.mjs, usure 0,7) : chacune est un plancher d'où un regard à hauteur de buste
// sort du bâtiment sans obstacle. Elles passent en tête de `pointsOfInterest(b).points`.
// Clé : 'id' ou 'id:carte'.
import type { Poi, PoiKind } from './poi';

/** (nx, nz) : direction horizontale vers l'extérieur ; (0, 0) si le point voit tout autour. */
function at(kind: PoiKind, x: number, y: number, z: number, nx: number, nz: number, width: number, depth: number, note: string): Poi {
  const l = Math.hypot(nx, nz) || 1;
  return {
    kind, x, y, z, nx: nx / l, nz: nz / l, bearing: nx || nz ? Math.atan2(nx, -nz) : 0, width, height: depth,
    stand: kind === 'summit' ? null : { x, y, z }, area: width * depth, note, source: 'manual',
  };
}

export const MANUAL_POI: Record<string, Poi[]> = {
  eglise: [
    at('gallery', -9.5, 13.3, 15.5, 1, 1, 2, 2, "chambre des cloches, angle sud-est : sentinelle derrière les abat-son crevés, ou poste de tir à 13 m"),
    at('gallery', -15.5, 13.3, 9.5, -1, -1, 2, 2, "chambre des cloches, angle nord-ouest"),
    at('roof', -15.5, 19.8, 12.5, 0, 0, 7, 7, "corniche du clocher au pied de la flèche : silhouette en plein ciel à 20 m"),
    at('summit', -12.5, 27.7, 13.5, 0, 0, 0, 0, "flèche du clocher (la croix et le coq montent à 34 m) : repère de réglage de la lunette"),
  ],
  'sanatorium:galeries': [
    at('gallery', -0.5, 10.2, -13.5, 0, 1, 51, 3, "galerie de cure du troisième niveau, plein sud, 51 m de long"),
    at('gallery', -5.5, 6.8, -10.5, 0, 1, 60, 3, "galerie de cure du deuxième niveau, 60 m"),
    at('gallery', -5.5, 3.4, -7.5, 0, 1, 60, 3, "galerie de cure du premier niveau, 60 m"),
    at('roof', -3.5, 13.6, -13.5, 0, 0, 60, 6, "toit-terrasse, 60 × 6 m : silhouettes en plein ciel"),
    at('roof', -5.5, 19.6, -18.5, 0, 0, 8, 5, "terrasse du pavillon central, le point le plus haut praticable"),
  ],
  'chateau-eau': [
    at('roof', -7.5, 29.6, -11.5, 0, 0, 16, 16, "dessus de la cuve (16 m de diamètre) : poste de tir dominant ou sentinelle en plein ciel"),
    at('roof', -6.5, 24, -2.5, 0, 1, 6, 1, "passerelle de la cuve, côté sud"),
    at('roof', 2.5, 24, -11.5, 1, 0, 1, 6, "passerelle de la cuve, côté est"),
    at('roof', -14.5, 24, -11.5, -1, 0, 1, 6, "passerelle de la cuve, côté ouest"),
    at('roof', -6.5, 24, -19.5, 0, -1, 6, 1, "passerelle de la cuve, côté nord"),
  ],
  'mine:batiments': [
    at('roof', 3.5, 21.1, -14.5, 0, 0, 6, 4, "plancher des molettes, en haut du chevalement"),
    at('roof', 27.5, 18.5, -17.5, 0, 0, 10, 2, "faîte de la salle des machines"),
    at('gallery', -14.5, 7, -15.5, 0, 1, 4, 4, "étage ouvert du triage, face sud"),
  ],
  'acierie:fourneau': [
    at('roof', 3.5, 33, -4.5, 0, 0, 14, 12, "plate-forme du gueulard, 152 m² à 33 m : le plus haut poste praticable de la banque"),
    at('roof', 2.5, 38.5, -6.5, 0, 0, 7, 6, "plate-forme haute du monte-charge"),
    at('gallery', 4.5, 27, -15.5, -1, 0, 12, 12, "passerelle de ceinture à 27 m, côté ouest"),
    at('gallery', 9.5, 21, -11.5, 0, 1, 10, 10, "passerelle de ceinture à 21 m, côté sud"),
  ],
  'siege-compagnie:parvis': [
    // en tête : le seul plancher du sommet visible d'un tireur placé plus haut que le toit (niveau avancé, 2 250 m)
    at('roof', 9.5, 36.25, -15, 0, 0, 2, 2, "dalle de l'édicule, au-dessus du toit de la tour : visible de partout, y compris d'un tireur plus haut (étendue non relevée : le portique de 2 m du niveau avancé y tient)"),
    at('roof', 9.5, 33, -12.5, 0, 0, 16, 14, "toit de la tour, 215 m² à 33 m — ceint d'un parapet : une cible posée dessus est masquée pour un tireur plus haut que le toit ; visible seulement d'en bas ou de niveau, sinon prendre la dalle de l'édicule"),
    at('gallery', 8.5, 29.4, -17.5, 0, 0, 16, 14, "plateau de bureaux éventré du dernier étage : silhouettes visibles en coupe"),
    at('gallery', 8.5, 22.6, -17.5, 0, 0, 16, 14, "plateau de bureaux éventré, mi-hauteur"),
  ],
  moulin: [
    at('gallery', -11.5, 10.5, -3.5, -1, 0, 12, 12, "troisième plancher de la minoterie, fenêtres ouest"),
    at('gallery', -11.5, 7.3, -4.5, 0, -1, 12, 12, "deuxième plancher, fenêtres nord"),
    at('gallery', -11.5, 4.1, -4.5, 0, 1, 12, 12, "premier plancher, fenêtres sud"),
  ],
  'hopital:soins': [
    at('roof', -0.5, 10.4, 2.5, 0, 0, 14, 10, "toit-terrasse du pavillon central"),
    at('gallery', 0.5, 7.1, 2.5, 0, 1, 20, 6, "salles du deuxième niveau, fenêtres sud"),
  ],
  'centrale-thermique:tour': [
    at('roof', 33.5, 26.3, -6.5, 0, 0, 24, 12, "toit de la salle des machines, 288 m² à 26 m"),
    at('summit', 59.5, 62.6, -19.5, 0, 0, 0, 0, "lèvre de la tour de refroidissement, 62 m : repère d'extrême distance"),
  ],
};
