// Mission du niveau « Le Château d'eau » : sept sabotages en chaîne, dans l'ordre, sans donner l'alerte.
// Aucune aide : la distance se vérifie au réticule (dimensions exactes ci-dessous), le vent se lit dans le décor
// (manches à air, fanions, fumées, vapeur des vannes). Rien ne se tire en mouvement : le convoi s'arrête.
import type { Step } from '../../game/mission';

/** Poste conseillé par objectif (clé de POSTS), pour le repère de la boussole. */
export const STEP_POST: Record<string, string> = {
  relais: 'ouest', vannes: 'ouest', signal: 'est', wagon: 'est', drone: 'sud', lunette: 'nord', horloge: 'nord',
};

/** Conditions du jour et règle de l'alerte, rappelées au premier objectif. */
const DAY = 'Plate-forme à 226 m d’altitude, 48° de latitude nord, 21 °C. Vent de nord-nord-ouest (330°), 3 m/s en moyenne, rafales modérées.';
const RULE = 'Chaque tir qui ne neutralise rien fait monter l’alerte ; elle retombe lentement. Au quatrième tir manqué de suite elle est donnée, et l’objectif est à reprendre.';

export const STEPS: Step[] = [
  {
    id: 'relais', title: 'Le relais radio', targets: ['relay'],
    brief: `Vous êtes sur la plate-forme du château d’eau, trente mètres au-dessus de la plaine. Sept sabotages, dans l’ordre, tout autour de vous. ${DAY} ${RULE} Commencez par couper leurs communications : l’émetteur du relais, sur le toit de la médiathèque.`,
    intel: 'Boîtier gris de 50 cm de large sur 62 cm de haut, à voyant rouge, devant un panneau blanc carré de 1,10 m, en haut d’un mât de 4 m planté sur le toit-terrasse de l’aile droite. Manche à air orange sur le même toit. Coupole de la médiathèque : 20 m de diamètre.',
    zone: 'Nord-ouest (314°), 900 m, 35 m plus bas.', posts: 'Poste ouest (couché), au garde-corps.', weapon: '.300 PRC, 7 mm PRC ou 6.5 PRC. Vent presque de face : très peu de dérive, de quoi vérifier votre réglage.',
  },
  {
    id: 'vannes', title: 'Les vannes de l’usine', targets: ['vanne1', 'vanne2', 'vanne3'],
    brief: 'L’usine chimique, au sud-ouest. Son collecteur d’entrée est à découvert devant les sphères de stockage : trois vannes côte à côte. Arrachez les trois volants, dans l’ordre que vous voulez : la première vapeur qui s’échappe vous montrera le vent là-bas.',
    intel: 'Trois volants rouges à moyeu blanc de 60 cm de diamètre, espacés de 2,40 m, à 4,20 m du sol sur un collecteur bleu. Fanion rouge de 6 m à droite du collecteur.',
    zone: 'Sud-ouest (235°), 1 100 m, 42 m plus bas.', posts: 'Poste ouest (couché), au garde-corps.', weapon: '.300 PRC ou .338 Lapua Magnum. Vent plein travers, de droite à gauche : plus de deux mètres de dérive.',
  },
  {
    id: 'signal', title: 'Le signal', targets: ['signal'],
    brief: 'À l’est, un convoi de wagons-citernes manœuvre sur la voie ferrée, au pas, derrière les entrepôts. Abattez le signal de manœuvre : voie fermée, le mécanicien rangera son train et l’immobilisera. Vous ne tirerez sur rien qui roule.',
    intel: 'Cible noire de 90 cm de large sur 1,50 m de haut, à large liseré blanc, feu vert allumé, centre à 7 m du sol sur un mât en treillis. Fanion jaune de 6 m au pied du mât.',
    zone: 'Est-nord-est (75°), 1 300 m, 39 m plus bas.', posts: 'Poste est (couché), au garde-corps.', weapon: '.338 Lapua Magnum 300 gr ou .33 XC. Vent de travers, de gauche à droite.',
  },
  {
    id: 'wagon', title: 'La citerne', targets: ['wagon'],
    brief: 'Le convoi se range, le wagon-citerne dans la trouée entre les deux entrepôts, puis ne bouge plus. Attendez l’arrêt complet, prenez votre temps, et percez la citerne à sa plaque de danger.',
    intel: 'Plaque orange carrée de 1 m de côté, barrée de noir, au flanc de la citerne grise, centre à 2,25 m du rail. Trouée de 22 m entre deux entrepôts de 9,5 m de haut. Fanion rouge sur le toit de l’entrepôt nord.',
    zone: 'Est (100°), 1 500 m, 43 m plus bas.', posts: 'Poste est (couché), au garde-corps.', weapon: '.338 Lapua Magnum 300 gr ou .33 XC : gardez le réglage de vent du signal, à peine moins.',
  },
  {
    id: 'drone', title: 'Le drone d’escorte', targets: ['drone'],
    brief: 'La villa, au sud-sud-est. Un drone lourd tient un point fixe au-dessus du toit et surveille l’allée : il ne bouge pas d’un centimètre. Descendez-le. Vous tirez presque dans le lit du vent : la dérive est faible, c’est la distance qui compte.',
    intel: 'Drone lourd de 2,20 m d’envergure, rotors compris ; corps sombre à bandeau clair de 1,40 m de large sur 70 cm de haut. Il vole à 24 m du sol, à l’aplomb des toits-terrasses de la villa, qui sont à 7 m.',
    zone: 'Sud-sud-est (150°), 1 700 m, 22 m plus bas.', posts: 'Poste sud (couché), au garde-corps.', weapon: '.33 XC ou .375 CheyTac. Vent arrière : presque pas de dérive due au vent, un peu moins de chute.',
  },
  {
    id: 'lunette', title: 'Le reflet', targets: ['lunette'],
    brief: 'Vos coups de feu ont fini par intriguer. Tout en haut du théâtre, une lunette de surveillance automatique balaie la plaine : son reflet vous la montre. Vous avez deux minutes et demie avant qu’elle ne vous trouve, et un seul tir : manqué, elle vous aura localisé. Le vent vient droit de là-bas : il ne déporte presque pas la balle. Mesurez, réglez, tirez posément.',
    intel: 'Caisson clair de 70 cm de large sur trépied, 1,75 m au-dessus du faîtage de la cage de scène, le toit le plus haut du théâtre (24,50 m du sol, 30 m de large). En contrebas, la façade à six colonnes fait 24 m de large.',
    zone: 'Nord-nord-ouest (330°), 1 250 m, 20 m plus bas.', posts: 'Poste nord (couché), au garde-corps.', weapon: '.338 Lapua Magnum 300 gr ou .33 XC. Vent de face : pas de dérive due au vent, un peu plus de chute ; restent la dérive gyroscopique et Coriolis, que le carnet vous donne.',
  },
  {
    id: 'horloge', title: 'L’horloge de la gare', targets: ['horloge'],
    brief: 'Dernier acte : la gare, plein nord, au bout de l’avenue. Arrêtez l’horloge du pavillon central. Deux mille quatre cents mètres, quatre secondes et demie de vol, presque toute la course de la tourelle. La fumée du dépôt, à droite de la gare, vous donne le vent là-bas.',
    intel: 'Cadran blanc de 2,70 m de diamètre, cerclé de noir, centre à 16 m du sol sur l’attique du pavillon central. Pavillon central : 20 m de large ; la gare entière : 76 m.',
    zone: 'Plein nord (0°), 2 400 m, 30 m plus bas.', posts: 'Poste nord (couché), au garde-corps.', weapon: '.375 CheyTac, .408 CheyTac ou .50 BMG. Vent de trois quarts face, de gauche à droite : une demi-dérive, plusieurs mètres tout de même.',
  },
];
