// Catalogue de la banque côté jeu : ids, cartes et taille des lots (relevés dans les fiches de src/buildings/bank).
// Ce fichier ne charge aucun modèle : il sert à lister et à typer. La sélection commentée est dans selection.ts.

export interface CatalogEntry {
  id: BuildingId;
  name: string;
  /** halte routière : quatre tronçons de 50 × 70 m mis bout à bout d'ouest en est (carte '*' = la halte entière) */
  halte: boolean;
  /** cartes de la fiche : id, nom, lot (largeur x, profondeur z, en mètres), sol fourni par le modèle */
  cartes: { id: string; name: string; l: number; p: number; ownGround: boolean }[];
  /** milieu d'origine dans la banque (campagne, ville, montagne…) */
  setting: string;
  /** poids des sources du module (ko, non minifié) */
  sourceKb: number;
}

export const BUILDING_IDS = [
  'villa-milliardaire',
  'chateau',
  'hopital',
  'centrale-thermique',
  'gare',
  'siege-compagnie',
  'theatre',
  'grand-hotel',
  'eglise',
  'mine',
  'sanatorium',
  'mediatheque',
  'acierie',
  'phare',
  'galerie-abondance',
  'parc-attractions',
  'usine-chimique',
  'chateau-eau',
  'moulin',
  'sanatorium-marin',
  'piscine-art-deco',
  'halte-aire-autoroute',
  'halte-bois-joli',
  'halte-grand-bouchon',
  'halte-tunnel',
  'halte-peage',
  'halte-col',
  'halte-passage-niveau',
  'halte-avenue-barricadee',
  'halte-route-pont',
  'halte-corniche',
  'halte-digue',
  'halte-gue',
  'halte-carrefour',
  'halte-superchargeurs',
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

export const CATALOG: CatalogEntry[] = [
  { id: 'villa-milliardaire', name: "La villa du milliardaire", halte: false, setting: "campagne", sourceKb: 42, cartes: [{ id: "", name: "La villa du milliardaire", l: 60, p: 48, ownGround: false }] },
  { id: 'chateau', name: "Le château abandonné", halte: false, setting: "campagne", sourceKb: 140, cartes: [{ id: "parc", name: "Le parc et les façades", l: 84, p: 84, ownGround: false }, { id: "interieur", name: "L'intérieur", l: 54, p: 38, ownGround: false }, { id: "communs", name: "Les communs", l: 70, p: 55, ownGround: false }] },
  { id: 'hopital', name: "L'hôpital pavillonnaire", halte: false, setting: "ville", sourceKb: 108, cartes: [{ id: "cour", name: "La cour et l'entrée des urgences", l: 68, p: 52, ownGround: false }, { id: "soins", name: "L'aile des soins", l: 56, p: 26, ownGround: false }] },
  { id: 'centrale-thermique', name: "La centrale thermique", halte: false, setting: "zone industrielle", sourceKb: 105, cartes: [{ id: "site", name: "Le site", l: 100, p: 70, ownGround: false }, { id: "turbines", name: "La salle des turbines", l: 70, p: 45, ownGround: false }, { id: "tour", name: "Dans la tour", l: 50, p: 50, ownGround: false }] },
  { id: 'gare', name: "La gare à verrière", halte: false, setting: "ville", sourceKb: 130, cartes: [{ id: "voyageurs", name: "Le bâtiment voyageurs", l: 84, p: 36, ownGround: false }, { id: "halle", name: "La halle et les quais", l: 96, p: 40, ownGround: false }] },
  { id: 'siege-compagnie', name: "Le siège de la Compagnie", halte: false, setting: "ville", sourceKb: 129, cartes: [{ id: "parvis", name: "Le parvis et le hall", l: 45, p: 50, ownGround: false }, { id: "dispatching", name: "Le dispatching et les archives", l: 60, p: 34, ownGround: false }] },
  { id: 'theatre', name: "Le théâtre à l'italienne", halte: false, setting: "ville", sourceKb: 119, cartes: [{ id: "facade", name: "La façade, le hall et le foyer", l: 36, p: 30, ownGround: false }, { id: "salle", name: "La salle, la scène et les coulisses", l: 46, p: 38, ownGround: false }] },
  { id: 'grand-hotel', name: "Le Grand Hôtel des Flots", halte: false, setting: "littoral", sourceKb: 210, cartes: [{ id: "", name: "Le Grand Hôtel des Flots", l: 64, p: 66, ownGround: true }] },
  { id: 'eglise', name: "L'église du bourg", halte: false, setting: "campagne", sourceKb: 124, cartes: [{ id: "", name: "L'église du bourg", l: 60, p: 50, ownGround: false }] },
  { id: 'mine', name: "Le carreau de la mine et son chevalement", halte: false, setting: "montagne et forêt", sourceKb: 126, cartes: [{ id: "carreau", name: "Le carreau et le chevalement", l: 80, p: 52, ownGround: false }, { id: "batiments", name: "Les bains, la lampisterie et la forge", l: 62, p: 34, ownGround: false }] },
  { id: 'sanatorium', name: "Le sanatorium des Hauts-Soleils", halte: false, setting: "montagne", sourceKb: 124, cartes: [{ id: "galeries", name: "La façade et les galeries de cure", l: 94, p: 64, ownGround: false }, { id: "interieur", name: "L'intérieur", l: 70, p: 22, ownGround: false }] },
  { id: 'mediatheque', name: "La médiathèque à coupole", halte: false, setting: "ville", sourceKb: 127, cartes: [{ id: "rotonde", name: "La salle de lecture et le portique", l: 52, p: 46, ownGround: false }, { id: "magasins", name: "Les magasins et l'aile 2.0", l: 50, p: 36, ownGround: false }] },
  { id: 'acierie', name: "L'aciérie et son haut fourneau", halte: false, setting: "zone industrielle", sourceKb: 132, cartes: [{ id: "fourneau", name: "Le haut fourneau et le plancher de coulée", l: 78, p: 66, ownGround: false }, { id: "laminerie", name: "La laminerie et les bâtiments", l: 80, p: 60, ownGround: false }] },
  { id: 'phare', name: "Le phare du cap", halte: false, setting: "littoral", sourceKb: 237, cartes: [{ id: "", name: "Le phare du cap", l: 60, p: 50, ownGround: true }] },
  { id: 'galerie-abondance', name: "La Galerie de l'Abondance", halte: false, setting: "ville", sourceKb: 148, cartes: [{ id: "parking", name: "Le parking et l'entrée", l: 72, p: 48, ownGround: false }, { id: "galerie", name: "L'allée, l'atrium et les boutiques", l: 48, p: 62, ownGround: false }] },
  { id: 'parc-attractions', name: "Le parc d'attractions « Wattyland »", halte: false, setting: "ville", sourceKb: 148, cartes: [{ id: "entree", name: "L'entrée, la grande roue et le carrousel", l: 66, p: 60, ownGround: false }, { id: "maneges", name: "Les montagnes russes, le train fantôme et l'atelier", l: 66, p: 56, ownGround: false }] },
  { id: 'usine-chimique', name: "L'usine chimique", halte: false, setting: "zone industrielle", sourceKb: 136, cartes: [{ id: "installations", name: "Les installations et les bassins", l: 88, p: 72, ownGround: false }, { id: "ateliers", name: "Le laboratoire, la salle de contrôle et les ateliers", l: 64, p: 52, ownGround: false }] },
  { id: 'chateau-eau', name: "Le château d'eau", halte: false, setting: "campagne", sourceKb: 114, cartes: [{ id: "", name: "Le château d'eau", l: 56, p: 46, ownGround: true }] },
  { id: 'moulin', name: "Le moulin à eau", halte: false, setting: "marais et rivière", sourceKb: 151, cartes: [{ id: "", name: "Le moulin à eau", l: 64, p: 54, ownGround: true }] },
  { id: 'sanatorium-marin', name: "Le sanatorium marin des Courlis", halte: false, setting: "littoral", sourceKb: 138, cartes: [{ id: "front", name: "Le front de mer", l: 92, p: 70, ownGround: true }, { id: "pavillons", name: "Les pavillons", l: 76, p: 28, ownGround: false }] },
  { id: 'piscine-art-deco', name: "La piscine Art déco", halte: false, setting: "ville", sourceKb: 105, cartes: [{ id: "", name: "La piscine Art déco", l: 60, p: 45, ownGround: true }] },
  { id: 'halte-aire-autoroute', name: "Halte · L'aire d'autoroute", halte: true, setting: "zone industrielle", sourceKb: 111, cartes: [{ id: "entree", name: "L'entrée de l'aire", l: 50, p: 70, ownGround: true }, { id: "sanitaires", name: "Sanitaires et pique-nique", l: 50, p: 70, ownGround: true }, { id: "passerelle", name: "La passerelle", l: 50, p: 70, ownGround: true }, { id: "poids-lourds", name: "Les poids lourds et la sortie", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-bois-joli', name: "Halte · L'aire du Bois-Joli", halte: true, setting: "forêt de pins (départementale)", sourceKb: 121, cartes: [{ id: "lisiere", name: "La lisière et le Love Center", l: 50, p: 70, ownGround: true }, { id: "pont", name: "Le pont de bois", l: 50, p: 70, ownGround: true }, { id: "aire", name: "L'aire", l: 50, p: 70, ownGround: true }, { id: "clairiere", name: "La clairière", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-grand-bouchon', name: "Halte · Le grand bouchon", halte: true, setting: "ville", sourceKb: 123, cartes: [{ id: "entree", name: "L'entrée du bouchon", l: 50, p: 70, ownGround: true }, { id: "carambolage", name: "Le carambolage", l: 50, p: 70, ownGround: true }, { id: "pont", name: "Le pont et le campement", l: 50, p: 70, ownGround: true }, { id: "controle", name: "Le contrôle sanitaire", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-tunnel', name: "Halte · Le tunnel", halte: true, setting: "montagne", sourceKb: 132, cartes: [{ id: "montee", name: "1 · La montée et le péage", l: 50, p: 70, ownGround: true }, { id: "tunnel-ouest", name: "2 · Le tunnel (ouest) et l'abri", l: 50, p: 70, ownGround: true }, { id: "tunnel-est", name: "3 · Le tunnel (est) et l'éboulement", l: 50, p: 70, ownGround: true }, { id: "tete-est", name: "4 · La tête est, le barrage et le pont", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-peage', name: "Halte · Le péage", halte: true, setting: "zone industrielle (autoroute)", sourceKb: 133, cartes: [{ id: "approche", name: "1 · L'approche", l: 50, p: 70, ownGround: true }, { id: "gare", name: "2 · La gare de péage", l: 50, p: 70, ownGround: true }, { id: "camp", name: "3 · Le camp des Percepteurs", l: 50, p: 70, ownGround: true }, { id: "pont", name: "4 · Le pont", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-col', name: "Le col du Grand-Vent", halte: true, setting: "montagne et forêt", sourceKb: 123, cartes: [{ id: "lacets", name: "Les lacets", l: 50, p: 70, ownGround: true }, { id: "galerie", name: "La galerie paravalanche", l: 50, p: 70, ownGround: true }, { id: "sommet", name: "Le sommet du col", l: 50, p: 70, ownGround: true }, { id: "descente", name: "La descente", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-passage-niveau', name: "Halte · Le passage à niveau", halte: true, setting: "ville", sourceKb: 170, cartes: [{ id: "faubourg", name: "1 · L'entrée du faubourg", l: 50, p: 70, ownGround: true }, { id: "epicerie", name: "2 · La rue de l'épicerie", l: 50, p: 70, ownGround: true }, { id: "passage", name: "3 · Le passage à niveau", l: 50, p: 70, ownGround: true }, { id: "depot", name: "4 · Le dépôt et les jardins", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-avenue-barricadee', name: "Halte · L'avenue barricadée", halte: true, setting: "ville", sourceKb: 160, cartes: [{ id: "entree", name: "L'entrée du boulevard", l: 50, p: 70, ownGround: true }, { id: "barricade", name: "La grande barricade", l: 50, p: 70, ownGround: true }, { id: "coeur", name: "Le cœur de l'avenue", l: 50, p: 70, ownGround: true }, { id: "controle", name: "Le contrôle sanitaire", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-route-pont', name: "La route du pont", halte: true, setting: "littoral (estuaire)", sourceKb: 213, cartes: [{ id: "bourg", name: "Le bourg du pont", l: 50, p: 70, ownGround: true }, { id: "pylone", name: "Le pylône barricadé", l: 50, p: 70, ownGround: true }, { id: "breche", name: "La brèche", l: 50, p: 70, ownGround: true }, { id: "marins", name: "La rive des marins", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-corniche', name: "La corniche du Cap Rouge", halte: true, setting: "littoral (falaise sur la mer)", sourceKb: 182, cartes: [{ id: "montee", name: "La montée", l: 50, p: 70, ownGround: true }, { id: "tunnel", name: "Le tunnel du Cap Rouge", l: 50, p: 70, ownGround: true }, { id: "panoramique", name: "Le Panoramique", l: 50, p: 70, ownGround: true }, { id: "eboulement", name: "L'éboulement", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-digue', name: "La digue des Roselières", halte: true, setting: "marais et rivière", sourceKb: 142, cartes: [{ id: "entree", name: "L'entrée des marais", l: 50, p: 70, ownGround: true }, { id: "breche", name: "La brèche", l: 50, p: 70, ownGround: true }, { id: "ecluse", name: "L'écluse", l: 50, p: 70, ownGround: true }, { id: "carrelet", name: "La station et le carrelet", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-gue', name: "Le Gué-aux-Saules", halte: true, setting: "marais et rivière", sourceKb: 170, cartes: [{ id: "chemin", name: "Le chemin creux", l: 50, p: 70, ownGround: true }, { id: "rive", name: "La rive ouest", l: 50, p: 70, ownGround: true }, { id: "gue", name: "Le gué", l: 50, p: 70, ownGround: true }, { id: "sortie", name: "La remontée", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-carrefour', name: "Halte · Le carrefour", halte: true, setting: "campagne (bocage, départementale, rond-point)", sourceKb: 184, cartes: [{ id: "relais", name: "1 · Le relais routier", l: 50, p: 70, ownGround: true }, { id: "rond-point", name: "2 · Le grand rond-point", l: 50, p: 70, ownGround: true }, { id: "jardinerie", name: "3 · La jardinerie", l: 50, p: 70, ownGround: true }, { id: "pont-cadre", name: "4 · Le pont-cadre", l: 50, p: 70, ownGround: true }] },
  { id: 'halte-superchargeurs', name: "Halte · Les Superchargeurs Watty", halte: true, setting: "zone industrielle", sourceKb: 128, cartes: [{ id: "file", name: "1 · La bretelle et la file figée", l: 50, p: 70, ownGround: true }, { id: "ombriere", name: "2 · L'ombrière aux 24 bornes", l: 50, p: 70, ownGround: true }, { id: "lounge", name: "3 · Le Watty Lounge", l: 50, p: 70, ownGround: true }, { id: "transfo", name: "4 · Le transformateur et la sortie", l: 50, p: 70, ownGround: true }] },
];

export { SELECTION, type SelectionEntry } from './selection';
