// Mission du niveau « Le Phare » : empêcher un chargement de quitter la crique. Sept objectifs, que du matériel.
// Aides « standard » : télémètre et vent au tireur, pas de prédiction. Le vent de mer en rafales est l'adversaire.
import type { Step } from '../../game/mission';

/** Poste conseillé par objectif (clé de POSTS), pour le repère de la boussole. */
export const STEP_POST: Record<string, string> = {
  reglage: 'sud', chenal: 'est', treuil: 'est', caboteur: 'est', barge: 'digue', canot: 'est', passe: 'sud',
};

const DAY = 'Vent de sud-ouest, 5 m/s en moyenne, en rafales : il vient de la mer, par votre droite quand vous regardez la crique.';

export const STEPS: Step[] = [
  {
    id: 'reglage', title: 'Réglage sur l’îlot', targets: ['reglage'],
    brief: `Vous êtes sur la galerie du phare, 34 m au-dessus de la mer. Dans la crique, à l’est, un caboteur finit de charger : rien ne doit en sortir. ${DAY} Commencez par la plaque de réglage, sur l’îlot au pied du cap.`,
    intel: 'Plaque carrée de 45 cm, blanche à pastille orange, sur un portique de bois. Fanion rouge à sa gauche. Tir plongeant : 7° sous l’horizontale, il faut un peu moins d’élévation qu’à plat.',
    zone: 'Sud-sud-est (165°), 260 m, en contrebas.', posts: 'Galerie sud (accroupi, appuyé au garde-corps).', weapon: '6.5 Creedmoor ou .223 Rem.',
  },
  {
    id: 'chenal', title: 'Les feux du chenal', targets: ['bouee-rouge', 'bouee-verte'],
    brief: 'Deux bouées balisent le chenal de la crique. Éteignez leurs feux : sans eux, le caboteur ne trouvera pas la sortie à la tombée du jour. Elles sont tenues par leur corps-mort et bougent à peine.',
    intel: 'Feu de 40 cm au sommet de chaque bouée, à 3 m de l’eau. Bouée rouge cylindrique, bouée verte conique, flotteur de 2 m de diamètre.',
    zone: 'Sud-est : la rouge à 380 m (140°), la verte à 450 m (128°).', posts: 'Galerie est ou galerie sud.', weapon: '6.5 Creedmoor. Le vent pousse la balle vers la gauche : lisez-le, et tirez dans une accalmie.',
  },
  {
    id: 'treuil', title: 'Le treuil de la grue', targets: ['treuil'],
    brief: 'Sur le quai du port, la grue à portique charge les dernières caisses. Son treuil se commande d’un boîtier jaune, sur un poteau au pied du portique, côté phare. Détruisez-le : la grue restera bloquée.',
    intel: 'Boîtier jaune de 46 cm de large sur 56 cm de haut, à 1,75 m du quai. Portique jaune de 7,5 m, fanion rouge à sa gauche.',
    zone: 'Est-nord-est (75°), 575 m.', posts: 'Galerie est.', weapon: '.308 Win ou 6.5 Creedmoor. Vent presque dans le dos : peu de dérive, mais elle change avec les rafales.',
  },
  {
    id: 'caboteur', title: 'Le caboteur au mouillage', targets: ['antenne', 'projecteur'],
    brief: 'Le caboteur attend au mouillage, l’étrave dans le vent. Personne sur le pont. Faites taire sa radio — le boîtier gris au-dessus de la timonerie — et éteignez le projecteur de son mât de charge.',
    intel: 'Émetteur : boîtier gris de 50 cm sur 60, au sommet d’un mâtereau, à 8 m de l’eau. Projecteur de 60 cm sur le mât de charge. Coque bleue de 22 m ; elle roule à peine.',
    zone: 'Est-sud-est (109°), 700 m.', posts: 'Galerie est.', weapon: '.300 Win Mag ou 6.5 PRC. Vent de travers : plus d’un mètre de dérive.',
  },
  {
    id: 'barge', title: 'La barge de ravitaillement', targets: ['drum'],
    brief: 'Entre le port et le chenal, une barge sur pieux garde le carburant du canot. Son abri de tôle est fermé du côté du phare : d’ici, le bidon est caché. Descendez par la trappe de la galerie (restez dessus un instant) : vous arriverez sur le musoir de la digue, au ras de l’eau, face à l’ouverture de l’abri.',
    intel: 'Bidon rouge à bande jaune, 60 cm de diamètre, 90 cm de haut, sous l’abri, à gauche. Il faut une balle qui perce la tôle : pas de .223 à cette distance.',
    zone: 'Depuis le musoir : sud-est (136°), 330 m, tir à plat au ras de l’eau.', posts: 'Musoir (accroupi, appuyé au parapet). Retour au phare par le poteau, sur le caillebotis.', weapon: '.308 Win ou 6.5 Creedmoor.',
  },
  {
    id: 'canot', title: 'Le canot', targets: ['canot'],
    brief: 'Un canot à moteur emporte la dernière caisse vers le large. Il part de la barge et suit le chenal ; il marque un arrêt franc de plusieurs secondes à chaque bouée de sa route, moteur au ralenti : tirez pendant un arrêt. S’il passe la pointe, le chargement est perdu. Plus vous l’arrêtez tôt, plus il est près.',
    intel: 'Visez le capot noir du moteur hors-bord, à l’arrière : 50 cm de large, 75 cm de haut. Canot orange de 5,6 m, personne à bord. Le bandeau sous l’objectif dit s’il est à l’arrêt et combien de temps il reste.',
    zone: 'De l’est (99°, 560 m) au sud-sud-est (150°, 1 050 m), vers le large.', posts: 'Galerie est, puis galerie sud s’il s’éloigne. Remontez d’abord par le poteau du musoir.', weapon: '.300 Win Mag ou .338 Lapua Magnum : vol court, énergie suffisante.',
  },
  {
    id: 'passe', title: 'La tourelle de la passe', targets: ['passe'],
    brief: 'Dernier feu : la tourelle noire et rouge qui marque la passe, au large. Sa lanterne éteinte, plus rien ne guide un bateau hors de la crique. Le vent a forci.',
    intel: 'Lanterne de 72 cm de large sur 90 cm de haut, au sommet de la tourelle, à 8 m de l’eau. Tourelle de 4 m de diamètre, fanion rouge à mi-hauteur.',
    zone: 'Sud (171°), 1 200 m.', posts: 'Galerie sud.', weapon: '.338 Lapua Magnum ou .300 Win Mag. Près de deux secondes de vol : plusieurs mètres de dérive, attendez un vent établi.',
  },
];
