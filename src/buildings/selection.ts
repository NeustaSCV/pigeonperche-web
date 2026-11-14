// Sélection commentée de la banque pour un jeu de tir à longue distance (80 à 2 500 m, décor de montagne et de vallée).
// Établie d'après le banc d'essai (e2e/buildings.mjs, captures et mesures du 2026-11-14) : hauteur, silhouette,
// ouvertures qu'une balle traverse, planchers en hauteur d'où l'on voit dehors, coût, dépendance à un sol creusé.
// Les hauteurs et les positions sont dans le repère local du bâtiment (y = 0 au sol).
import type { BuildingId } from './catalog';

export interface SelectionEntry {
  id: BuildingId;
  /** carte conseillée ('*' : la halte entière) ; absente si le bâtiment n'a qu'une carte */
  carte?: string;
  /**
   * 'target' : décor de cible (silhouette lisible, ouvertures, hauteur) ; 'post' : poste de tir possible ;
   * 'both' : les deux ; 'backup' : utilisable mais second choix ; 'avoid' : à écarter.
   */
  role: 'target' | 'post' | 'both' | 'backup' | 'avoid';
  /** pourquoi */
  note: string;
}

export const SELECTION: SelectionEntry[] = [
  // ---------- premier choix ----------
  { id: 'eglise', role: 'both', note: "Le meilleur repère de vallée : clocher de 34 m visible de très loin, chambre des cloches ouverte à 13 m (sentinelle ou poste de tir), corniche au pied de la flèche à 20 m, 48 ouvertures traversables, mur de cimetière à brèches, presbytère. Lot de 60 × 50 m à plat, aucun sol creusé." },
  { id: 'sanatorium', carte: 'galeries', role: 'target', note: "Fait pour la montagne. Trois galeries de cure de 60 m, ouvertes plein sud, à 3,4, 6,8 et 10,2 m : des dizaines de places de sentinelle visibles d'un seul côté, plus les toits-terrasses à 13,6 et 20 m. Silhouette longue et claire (95 × 65 m, 25 m de haut), à plat. Orienter la face sud vers le tireur." },
  { id: 'chateau-eau', role: 'both', note: "Tour de 36 m : passerelle circulaire à 24 m et dessus de cuve à 29,6 m (188 m², poste de tir ou sentinelle en plein ciel), station de pompage en brique à côté. Le modèle fournit son sol (bassins creusés de 1,6 m) : terrasser le relief 1,9 m sous son y = 0, ou accepter sa pelouse." },
  { id: 'mine', carte: 'batiments', role: 'both', note: "Chevalement de 28 m, plates-formes des molettes à 21 et 22 m, passerelles à 13,5 m, bâtiments de brique à nombreuses baies (45 ouvertures traversables). Décor « montagne et forêt ». Préférer cette carte à « carreau », qui ajoute trois sommets enneigés de décor et un terril (138 × 161 m). Le puits descend à 3,9 m : le relief du jeu le recouvre." },
  { id: 'moulin', role: 'target', note: "Minoterie de brique de cinq niveaux (19,5 m) : 48 fenêtres toutes praticables, planchers à 4,1, 7,3, 10,5 et 13,7 m, façades très lisibles. À poser au bord de la rivière du jeu. Le modèle fournit son sol (bief creusé de 2,4 m) : terrasser le relief 2,7 m sous son y = 0." },
  { id: 'hopital', carte: 'soins', role: 'target', note: "Pavillon de brique et béton compact (56 × 28 m, 15 m) : 48 ouvertures toutes praticables, étages à 3,8 et 7,1 m, toit-terrasse de 147 m² à 10,4 m. À plat. La carte « cour » ajoute l'enceinte, la chapelle et le porche (70 × 54 m)." },
  { id: 'chateau', carte: 'interieur', role: 'target', note: "Le château seul (56 × 41 m, tours à 25 m) : croisées à meneau de pierre (une balle passe par les carreaux, pas au centre), lucarnes, toitures en poivrière très reconnaissables. « parc » (84 × 84 m) ajoute chapelle, maison du gardien et grille : un domaine entier pour une carte avancée. « communs » : écuries basses autour d'une cour, bon objectif secondaire." },
  { id: 'acierie', carte: 'fourneau', role: 'both', note: "Haut fourneau de 52 m ceinturé de passerelles : passerelles couvertes à 15, 21 et 27 m, plates-formes à 33 m (152 m²), 38,5 et 41,6 m, cheminées de brique. La plus haute structure praticable de la banque, lisible à 2 000 m. Structure métallique fine : c'est le bâtiment qui profite le plus du niveau lointain. La fosse de coulée descend à 4,1 m, recouverte par le relief." },
  { id: 'centrale-thermique', carte: 'tour', role: 'target', note: "Tour de refroidissement de 62 m et cheminée : le repère d'extrême distance (2 500 m), masse pleine, peu d'ouvertures (7), toit de la salle des machines à 26 m. « site » ajoute la salle des machines de brique et ses grandes verrières (20 ouvertures, 103 × 97 m)." },
  { id: 'siege-compagnie', carte: 'parvis', role: 'both', note: "Tour de bureaux de 42 m aux étages éventrés : cinq plateaux ouverts de 15,8 à 29,4 m qui se lisent en coupe, toit de 215 m² à 33 m (poste de tir dominant). Urbain : à réserver à un bourg ou à une zone d'activité de la carte avancée." },

  // ---------- haltes utilisables (elles fournissent leur sol : bande de 200 × 70 m, route d'ouest en est) ----------
  { id: 'halte-passage-niveau', carte: '*', role: 'target', note: "La meilleure halte : aucun creusement, grue portuaire de 25 m, wagons, citerne, passerelle à 6 m, maisons de faubourg (48 ouvertures praticables). 155 000 triangles en entier : charger un seul tronçon (« passage » ou « depot », 50 × 70 m) si la carte est chargée." },
  { id: 'halte-grand-bouchon', carte: '*', role: 'target', note: "Embouteillage figé, pont routier à 8,7 m, poste de contrôle : des dizaines de véhicules comme couverts et comme cibles d'opportunité. Aucun creusement. S'aligne sur la route du jeu." },
  { id: 'halte-carrefour', carte: '*', role: 'target', note: "Relais routier, rond-point, jardinerie, pont-cadre : décor de campagne varié, creusement négligeable (0,6 m)." },
  { id: 'halte-aire-autoroute', carte: '*', role: 'backup', note: "Aire de repos et passerelle piétonne à 8,4 m (sentinelle). Beaucoup d'arbres devant les bâtiments : cibles souvent masquées." },
  { id: 'halte-peage', carte: '*', role: 'backup', note: "Barrière de péage et camp : silhouettes basses mais nettes. Le pont enjambe un creux de 5,6 m : terrasser le relief dessous." },
  { id: 'halte-superchargeurs', carte: '*', role: 'backup', note: "Ombrières et local technique, très horizontaux ; creusement de 2,2 m." },

  // ---------- second choix ----------
  { id: 'villa-milliardaire', role: 'backup', note: "Villa moderne basse (11 m), toits-terrasses à 6,8 m, grandes baies : la moins chère de la banque (41 000 triangles, 9 000 de loin). Bon poste d'observation à mi-pente, cible peu marquante." },
  { id: 'sanatorium-marin', carte: 'pavillons', role: 'backup', note: "Longs pavillons à tuiles rouges (76 × 28 m), 48 ouvertures praticables, à plat. La carte « front » dépend d'une dune et d'une plage creusées (2,6 m) : à écarter." },
  { id: 'mediatheque', carte: 'rotonde', role: 'backup', note: "Portique à colonnes et coupole de verre, 19 m : lisible, mais urbain et peu haut." },
  { id: 'gare', carte: 'voyageurs', role: 'backup', note: "Belle façade à grande arche, mais 180 m de voies et de quais : emprise énorme pour peu de hauteur (27 m), et aucune ouverture relevée (verrières faites à la main dans le modèle)." },
  { id: 'theatre', carte: 'facade', role: 'backup', note: "Portique à colonnes sur une face ; les trois autres sont des murs aveugles (74 % de plein) : à montrer de face seulement." },
  { id: 'halte-avenue-barricadee', carte: '*', role: 'backup', note: "Une avenue entière entre deux rangs d'immeubles de 25 m (48 ouvertures) : excellent couloir de tir urbain, mais bloc de ville isolé et creusé de 4,3 m, étranger à une vallée." },

  // ---------- à écarter ----------
  { id: 'phare', role: 'avoid', note: "La tour (32 m, galerie de lanterne à 26 m) serait idéale, mais elle tient à une falaise de 12 m et à une mer de 200 × 205 m fournies par le modèle." },
  { id: 'grand-hotel', role: 'avoid', note: "Front de mer : plage, digue et mer fournies par le modèle (156 × 168 m, creusé de 2,9 m), 60 000 triangles." },
  { id: 'piscine-art-deco', role: 'avoid', note: "L'intérêt est le bassin, à l'intérieur et creusé de 3,5 m ; de dehors, une halle de brique sans relief." },
  { id: 'parc-attractions', role: 'avoid', note: "Grande roue, montagnes russes : structures filaires qui disparaissent au niveau lointain et scintillent au niveau complet (18 % de plein)." },
  { id: 'usine-chimique', role: 'avoid', note: "Tuyauteries et colonnes fines sur 120 × 79 m (20 % de plein) : illisible de loin pour 56 000 triangles." },
  { id: 'galerie-abondance', role: 'avoid', note: "Centre commercial bas (13 m) et parking : silhouette plate, peu d'ouvertures utiles." },
  { id: 'halte-bois-joli', role: 'avoid', note: "Une forêt de pins : 171 000 triangles, encore 101 000 de loin, cibles invisibles sous les arbres." },
  { id: 'halte-col', role: 'avoid', note: "Apporte sa propre montagne (creusé de 18,7 m, parois de 28 m) : entre en conflit avec le relief du jeu." },
  { id: 'halte-tunnel', role: 'avoid', note: "Apporte sa propre colline et son tunnel (creusé de 12 m)." },
  { id: 'halte-corniche', role: 'avoid', note: "Falaise rouge et mer : 900 × 435 m de décor prolongé, 170 000 triangles, creusé de 21 m." },
  { id: 'halte-route-pont', role: 'avoid', note: "Pont suspendu sur un estuaire : 305 × 187 m d'eau fournie par le modèle, creusé de 11 m." },
  { id: 'halte-gue', role: 'avoid', note: "Rivière et gué fournis par le modèle (290 × 160 m), très boisé." },
  { id: 'halte-digue', role: 'avoid', note: "Marais et écluse : tout repose sur l'eau du modèle (creusé de 3,6 m), 169 000 triangles." },
];
