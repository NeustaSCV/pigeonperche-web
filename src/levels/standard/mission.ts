// Mission du niveau « standard » : dix objectifs, du réglage à 100 m à la place du marché à 950 m.
import type { Step } from '../../game/mission';
import { HOSTILE_DESC } from '../../game/targets';

/** Poste conseillé par objectif (clé de POSTS), pour le repère de la boussole. */
export const STEP_POST: Record<string, string> = {
  plates: 'est', balloon: 'est', relay: 'tour', searchlight: 'ouest', drum: 'ouest',
  padlock: 'eboulis', drone: 'eboulis', sentinel: 'tour', vehicle: 'nord', hostile: 'nord',
};

export const STEPS: Step[] = [
  {
    id: 'plates', title: 'Réglage', targets: ['plate1', 'plate2'],
    brief: 'Deux plaques d’acier ont été posées sur l’éperon est pour vérifier vos réglages. Faites-les sonner toutes les deux.',
    intel: 'Plaque carrée de 45 cm, puis plaque ronde de 60 cm. Un fanion rouge flotte près de chacune.',
    zone: 'Éperon est, vers 100 m puis 300 m.', posts: 'Brèche est (couché).', weapon: 'Le .22 LR suffit à 100 m. À 300 m, il tombe de plus de six mètres : prenez plus tendu.',
  },
  {
    id: 'balloon', title: 'Le ballon', targets: ['balloon'],
    brief: 'Un ballon rouge est amarré plus bas sur le versant. Il se couche sous le vent : c’est votre premier indice de dérive.',
    intel: 'Ballon de 48 cm de diamètre au bout d’une corde de 3 m.',
    zone: 'Est-sud-est, vers 220 m, en contrebas.', posts: 'Brèche est (couché).', weapon: 'Calibre libre. Le .22 LR reste possible mais demande près de 11 mrad.',
  },
  {
    id: 'relay', title: 'Le relais radio', targets: ['relay'],
    brief: 'Le piton voisin porte un relais. Détruisez le boîtier émetteur fixé sur le pylône, sous la parabole : le voyant rouge clignote dessus.',
    intel: 'Boîtier de 50 × 62 cm, à 13,6 m du sol. Pylône de 19 m.',
    zone: 'Est-nord-est, vers 520 m, presque à votre hauteur.', posts: 'Étage de la tour (couché), par l’escalier ouest.', weapon: '.223 Rem ou plus. Il faut au moins 120 J à l’impact.',
  },
  {
    id: 'searchlight', title: 'Le projecteur', targets: ['searchlight'],
    brief: 'Le campement s’éclaire d’un projecteur monté sur un mât. Éteignez-le. Chaque détonation et chaque impact proche du campement fait monter l’alerte.',
    intel: 'Optique de 60 cm de diamètre, à 7 m du sol.',
    zone: 'Ouest, vers 660 m, sur une terrasse du versant. Contre-jour.', posts: 'Brèche ouest (couché).', weapon: 'Du 6.5 Creedmoor au .308. Les magnums réveillent tout le campement.',
  },
  {
    id: 'drum', title: 'Le carburant', targets: ['drum'],
    brief: 'Un bidon rouge à bande jaune est posé près du camion bâché. Percez-le.',
    intel: 'Bidon de 60 cm de diamètre et 90 cm de haut.',
    zone: 'Campement, vers 670 m, à droite du camion.', posts: 'Brèche ouest (couché).', weapon: 'Il faut 250 J à l’impact : pas de .22 LR.',
  },
  {
    id: 'padlock', title: 'Le treuil du pont', targets: ['padlock'],
    brief: 'La barrière du pont est tenue levée par un treuil. Faites sauter son cadenas, la barrière retombera et coupera la route.',
    intel: 'Cadenas de 26 × 30 cm, laiton, sur le boîtier du treuil à l’entrée sud du pont. Poteaux du portique : 3,3 m.',
    zone: 'Nord-ouest, vers 800 m, au bord de la rivière.', posts: 'Rebord d’éboulis (couché), par l’angle nord-ouest effondré.', weapon: '6.5 Creedmoor ou plus : petite cible, il faut de la précision et 280 J.',
  },
  {
    id: 'drone', title: 'Le drone', targets: ['drone'],
    brief: 'Un drone d’observation tient un point fixe au-dessus du versant nord-ouest. Petit et sombre, il n’est pas facile à trouver : vu d’ici, il se détache sur les maisons situées entre le château d’eau et la rivière. Il oscille lentement et penche contre le vent.',
    intel: 'Envergure de 80 cm rotors compris.',
    zone: 'Nord-nord-ouest, vers 460 m, bien en dessous de vous : cherchez-le au-dessus des maisons, entre le château d’eau et la rivière.', posts: 'Rebord d’éboulis ou créneau nord.', weapon: 'Calibre libre : temps de vol court conseillé.',
  },
  {
    id: 'sentinel', title: 'La sentinelle', targets: ['sentinel'],
    brief: 'Un homme armé garde le mirador de la rive du lac. Il fait les cent pas le long du garde-corps et s’arrête quelques secondes à chaque bout.',
    intel: 'Homme de 1,75 m. Plateforme à 6 m du sol, garde-corps à 0,95 m.',
    zone: 'Nord-est, vers 1 250 m, au bord du lac.', posts: 'Étage de la tour (couché).', weapon: '.338 Lapua Magnum ou .300 Win Mag. Près de deux secondes de vol.',
  },
  {
    id: 'vehicle', title: 'Le véhicule', targets: ['vehicle'],
    brief: 'Un pick-up rouge fait la navette entre le campement et le village. Immobilisez-le : bloc moteur ou pneu. Il roule à 27 km/h et marque l’arrêt à chaque bout.',
    intel: 'Longueur 4,9 m, roues de 80 cm. Le moteur est sous le capot, à l’avant.',
    zone: 'Route de la rive nord, entre 750 et 950 m.', posts: 'Créneau nord (appuyé) ou rebord d’éboulis.', weapon: 'Bloc moteur : .308 Win au minimum. Un pneu cède à tout calibre à percussion centrale.',
  },
  {
    id: 'hostile', title: 'La place du marché', targets: ['hostile'],
    brief: `Votre cible traverse le marché du village, au milieu des passants. ${HOSTILE_DESC} Un civil touché, et la mission est perdue.`,
    intel: 'Homme de 1,80 m. D’autres portent une veste rouge, un sac vert ou une casquette noire : il faut les trois indices et la boiterie.',
    zone: 'Plein nord, vers 950 m, devant l’église.', posts: 'Créneau nord (accroupi, appuyé sur le mur).', weapon: 'Calibre tendu et précis : 6.5 Creedmoor, .300 Win Mag ou .338 LM.',
  },
];
