// Lots des bâtiments de la banque, SANS dépendance : ce fichier est lu par le jeu, par les niveaux (map.ts,
// scenery.ts) et par le générateur de relief sous Node (tools/terrain-lib.mjs). Pas d'import, pas de syntaxe
// TypeScript non effaçable. Il ne charge aucun modèle : il dit seulement quelle place prend chaque bâtiment.
//
// Clé : 'id' ou 'id:carte' (les mêmes que `BuildingSpot.id` et `BuildingSpot.carte`) ; 'id:*' = une halte entière.
//   l, p : largeur (x local) et profondeur (z local) du lot, m — relevées dans les fiches (src/buildings/catalog.ts ;
//          tests/buildings-lots.test.ts vérifie que les deux fichiers disent la même chose) ;
//   own  : le modèle fournit son sol (pelouse, quais, bassins) : il couvre tout le lot ;
//   dug  : profondeur maximale sous son y = 0 (bassin, bief, fosse), m — mesurée au banc (e2e/out/buildings/resultats.md).
// Repère local d'un bâtiment : origine au centre du lot, +x est, +z sud (façade principale), y = 0 au sol.
// Un lacet `yaw` (radians) tourne le bâtiment dans le sens trigonométrique vu de dessus.

export interface BuildingLot {
  l: number;
  p: number;
  own: boolean;
  dug: number;
}

export const BUILDING_LOTS: Record<string, BuildingLot> = {
  'villa-milliardaire': { l: 60, p: 48, own: false, dug: 0 },
  'chateau:parc': { l: 84, p: 84, own: false, dug: 0.3 },
  'chateau:interieur': { l: 54, p: 38, own: false, dug: 0.7 },
  'chateau:communs': { l: 70, p: 55, own: false, dug: 0 },
  'hopital:cour': { l: 68, p: 52, own: false, dug: 0 },
  'hopital:soins': { l: 56, p: 26, own: false, dug: 0 },
  'centrale-thermique:site': { l: 100, p: 70, own: false, dug: 0 },
  'centrale-thermique:turbines': { l: 70, p: 45, own: false, dug: 2.9 },
  'centrale-thermique:tour': { l: 50, p: 50, own: false, dug: 0 },
  'gare:voyageurs': { l: 84, p: 36, own: false, dug: 0 },
  'gare:halle': { l: 96, p: 40, own: false, dug: 0 },
  'siege-compagnie:parvis': { l: 45, p: 50, own: false, dug: 0 },
  'siege-compagnie:dispatching': { l: 60, p: 34, own: false, dug: 0 },
  'theatre:facade': { l: 36, p: 30, own: false, dug: 0 },
  'theatre:salle': { l: 46, p: 38, own: false, dug: 1 },
  'grand-hotel': { l: 64, p: 66, own: true, dug: 2.9 },
  'eglise': { l: 60, p: 50, own: false, dug: 0 },
  'mine:carreau': { l: 80, p: 52, own: false, dug: 3.9 },
  'mine:batiments': { l: 62, p: 34, own: false, dug: 3.9 },
  'sanatorium:galeries': { l: 94, p: 64, own: false, dug: 0 },
  'sanatorium:interieur': { l: 70, p: 22, own: false, dug: 0 },
  'mediatheque:rotonde': { l: 52, p: 46, own: false, dug: 0 },
  'mediatheque:magasins': { l: 50, p: 36, own: false, dug: 0 },
  'acierie:fourneau': { l: 78, p: 66, own: false, dug: 4.1 },
  'acierie:laminerie': { l: 80, p: 60, own: false, dug: 4.1 },
  'phare': { l: 60, p: 50, own: true, dug: 12 },
  'galerie-abondance:parking': { l: 72, p: 48, own: false, dug: 0 },
  'galerie-abondance:galerie': { l: 48, p: 62, own: false, dug: 0 },
  'parc-attractions:entree': { l: 66, p: 60, own: false, dug: 0 },
  'parc-attractions:maneges': { l: 66, p: 56, own: false, dug: 0 },
  'usine-chimique:installations': { l: 88, p: 72, own: false, dug: 0 },
  'usine-chimique:ateliers': { l: 64, p: 52, own: false, dug: 0 },
  'chateau-eau': { l: 56, p: 46, own: true, dug: 1.6 },
  'moulin': { l: 64, p: 54, own: true, dug: 2.4 },
  'sanatorium-marin:front': { l: 92, p: 70, own: true, dug: 2.6 },
  'sanatorium-marin:pavillons': { l: 76, p: 28, own: false, dug: 0 },
  'piscine-art-deco': { l: 60, p: 45, own: true, dug: 3.5 },
  'halte-aire-autoroute:entree': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-aire-autoroute:sanitaires': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-aire-autoroute:passerelle': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-aire-autoroute:poids-lourds': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-aire-autoroute:*': { l: 200, p: 70, own: true, dug: 0.6 },
  'halte-bois-joli:lisiere': { l: 50, p: 70, own: true, dug: 0.4 },
  'halte-bois-joli:pont': { l: 50, p: 70, own: true, dug: 0.4 },
  'halte-bois-joli:aire': { l: 50, p: 70, own: true, dug: 0.4 },
  'halte-bois-joli:clairiere': { l: 50, p: 70, own: true, dug: 0.4 },
  'halte-bois-joli:*': { l: 200, p: 70, own: true, dug: 0.4 },
  'halte-grand-bouchon:entree': { l: 50, p: 70, own: true, dug: 0 },
  'halte-grand-bouchon:carambolage': { l: 50, p: 70, own: true, dug: 0 },
  'halte-grand-bouchon:pont': { l: 50, p: 70, own: true, dug: 0 },
  'halte-grand-bouchon:controle': { l: 50, p: 70, own: true, dug: 0 },
  'halte-grand-bouchon:*': { l: 200, p: 70, own: true, dug: 0 },
  'halte-tunnel:montee': { l: 50, p: 70, own: true, dug: 12 },
  'halte-tunnel:tunnel-ouest': { l: 50, p: 70, own: true, dug: 12 },
  'halte-tunnel:tunnel-est': { l: 50, p: 70, own: true, dug: 12 },
  'halte-tunnel:tete-est': { l: 50, p: 70, own: true, dug: 12 },
  'halte-tunnel:*': { l: 200, p: 70, own: true, dug: 12 },
  'halte-peage:approche': { l: 50, p: 70, own: true, dug: 5.6 },
  'halte-peage:gare': { l: 50, p: 70, own: true, dug: 5.6 },
  'halte-peage:camp': { l: 50, p: 70, own: true, dug: 5.6 },
  'halte-peage:pont': { l: 50, p: 70, own: true, dug: 5.6 },
  'halte-peage:*': { l: 200, p: 70, own: true, dug: 5.6 },
  'halte-col:lacets': { l: 50, p: 70, own: true, dug: 18.7 },
  'halte-col:galerie': { l: 50, p: 70, own: true, dug: 18.7 },
  'halte-col:sommet': { l: 50, p: 70, own: true, dug: 18.7 },
  'halte-col:descente': { l: 50, p: 70, own: true, dug: 18.7 },
  'halte-col:*': { l: 200, p: 70, own: true, dug: 18.7 },
  'halte-passage-niveau:faubourg': { l: 50, p: 70, own: true, dug: 0 },
  'halte-passage-niveau:epicerie': { l: 50, p: 70, own: true, dug: 0 },
  'halte-passage-niveau:passage': { l: 50, p: 70, own: true, dug: 0 },
  'halte-passage-niveau:depot': { l: 50, p: 70, own: true, dug: 0 },
  'halte-passage-niveau:*': { l: 200, p: 70, own: true, dug: 0 },
  'halte-avenue-barricadee:entree': { l: 50, p: 70, own: true, dug: 4.3 },
  'halte-avenue-barricadee:barricade': { l: 50, p: 70, own: true, dug: 4.3 },
  'halte-avenue-barricadee:coeur': { l: 50, p: 70, own: true, dug: 4.3 },
  'halte-avenue-barricadee:controle': { l: 50, p: 70, own: true, dug: 4.3 },
  'halte-avenue-barricadee:*': { l: 200, p: 70, own: true, dug: 4.3 },
  'halte-route-pont:bourg': { l: 50, p: 70, own: true, dug: 11 },
  'halte-route-pont:pylone': { l: 50, p: 70, own: true, dug: 11 },
  'halte-route-pont:breche': { l: 50, p: 70, own: true, dug: 11 },
  'halte-route-pont:marins': { l: 50, p: 70, own: true, dug: 11 },
  'halte-route-pont:*': { l: 200, p: 70, own: true, dug: 11 },
  'halte-corniche:montee': { l: 50, p: 70, own: true, dug: 21 },
  'halte-corniche:tunnel': { l: 50, p: 70, own: true, dug: 21 },
  'halte-corniche:panoramique': { l: 50, p: 70, own: true, dug: 21 },
  'halte-corniche:eboulement': { l: 50, p: 70, own: true, dug: 21 },
  'halte-corniche:*': { l: 200, p: 70, own: true, dug: 21 },
  'halte-digue:entree': { l: 50, p: 70, own: true, dug: 3.6 },
  'halte-digue:breche': { l: 50, p: 70, own: true, dug: 3.6 },
  'halte-digue:ecluse': { l: 50, p: 70, own: true, dug: 3.6 },
  'halte-digue:carrelet': { l: 50, p: 70, own: true, dug: 3.6 },
  'halte-digue:*': { l: 200, p: 70, own: true, dug: 3.6 },
  'halte-gue:chemin': { l: 50, p: 70, own: true, dug: 3.3 },
  'halte-gue:rive': { l: 50, p: 70, own: true, dug: 3.3 },
  'halte-gue:gue': { l: 50, p: 70, own: true, dug: 3.3 },
  'halte-gue:sortie': { l: 50, p: 70, own: true, dug: 3.3 },
  'halte-gue:*': { l: 200, p: 70, own: true, dug: 3.3 },
  'halte-carrefour:relais': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-carrefour:rond-point': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-carrefour:jardinerie': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-carrefour:pont-cadre': { l: 50, p: 70, own: true, dug: 0.6 },
  'halte-carrefour:*': { l: 200, p: 70, own: true, dug: 0.6 },
  'halte-superchargeurs:file': { l: 50, p: 70, own: true, dug: 2.2 },
  'halte-superchargeurs:ombriere': { l: 50, p: 70, own: true, dug: 2.2 },
  'halte-superchargeurs:lounge': { l: 50, p: 70, own: true, dug: 2.2 },
  'halte-superchargeurs:transfo': { l: 50, p: 70, own: true, dug: 2.2 },
  'halte-superchargeurs:*': { l: 200, p: 70, own: true, dug: 2.2 },
};

/** Lot d'un bâtiment (carte absente : la première de la fiche). `undefined` si l'identifiant est inconnu. */
export function lotOf(id: string, carte?: string): BuildingLot | undefined {
  if (carte) return BUILDING_LOTS[id + ':' + carte];
  if (BUILDING_LOTS[id]) return BUILDING_LOTS[id];
  const first = Object.keys(BUILDING_LOTS).find((k) => k.startsWith(id + ':') && !k.endsWith(':*'));
  return first ? BUILDING_LOTS[first] : undefined;
}

export interface LotSpot {
  id: string;
  carte?: string;
  x: number;
  z: number;
  yaw: number;
}

/** Point du repère local d'un bâtiment posé → monde (x, z). */
export function lotToWorld(spot: LotSpot, lx: number, lz: number): [number, number] {
  const c = Math.cos(spot.yaw), s = Math.sin(spot.yaw);
  return [spot.x + lx * c + lz * s, spot.z - lx * s + lz * c];
}

/**
 * Distance (m) d'un point du monde au lot d'un bâtiment posé : 0 dans le lot, positive dehors.
 * Sert à écarter maisons, meules, arbres et cibles de l'emprise : `lotDistance(spot, x, z) < marge`.
 * Un identifiant inconnu renvoie l'infini (rien n'est écarté).
 */
export function lotDistance(spot: LotSpot, x: number, z: number): number {
  const lot = lotOf(spot.id, spot.carte);
  if (!lot) return Infinity;
  const c = Math.cos(spot.yaw), s = Math.sin(spot.yaw);
  const dx = x - spot.x, dz = z - spot.z;
  const u = Math.abs(dx * c - dz * s) - lot.l / 2, v = Math.abs(dx * s + dz * c) - lot.p / 2;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

/** Les quatre coins du lot dans le monde (x, z), dans l'ordre NO, NE, SE, SO du repère local. */
export function lotCorners(spot: LotSpot): [number, number][] {
  const lot = lotOf(spot.id, spot.carte);
  if (!lot) return [];
  const hx = lot.l / 2, hz = lot.p / 2;
  return [lotToWorld(spot, -hx, -hz), lotToWorld(spot, hx, -hz), lotToWorld(spot, hx, hz), lotToWorld(spot, -hx, hz)];
}
