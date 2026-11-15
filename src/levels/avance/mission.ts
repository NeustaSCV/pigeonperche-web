// Mission du niveau « avancé » : neuf plaques d'acier, de 800 à 2 500 m, dans l'esprit des épreuves de tir à très
// longue distance. Aucune aide : la distance se lit au réticule (dimensions ci-dessous), le vent dans le décor.
import type { Step } from '../../game/mission';

/** Poste conseillé par objectif (clé de POSTS), pour le repère de la boussole. */
export const STEP_POST: Record<string, string> = {
  zero: 'nord', chateau: 'est', mover: 'nord', mine: 'ouest', mile: 'est', fourneau: 'mirador', deuxMille: 'ouest', siege: 'mirador', extreme: 'mirador',
};

/** Conditions du jour, rappelées au premier objectif : le carnet de tir en a besoin. */
const DAY = 'Poste à 900 m d’altitude, 44° de latitude nord, 24 °C. Vent d’ouest-nord-ouest, 4 m/s en moyenne, en rafales.';

export const STEPS: Step[] = [
  {
    id: 'zero', title: 'Réglage à 800 m', targets: ['zero'],
    brief: `Bienvenue sur le Rebord. ${DAY} Tout compte ici : densité de l’air, rotation de la Terre, dérive gyroscopique, saut dû au vent. Commencez par la plaque de réglage, sur la première terrasse du talus.`,
    intel: 'Plaque carrée de 50 cm, blanche à pastille orange, fanion rouge à sa droite. Elle est 248 m plus bas que vous : pente de 18°.',
    zone: 'Nord (352°), 800 m, en contrebas.', posts: 'Dalle nord (couché).', weapon: '.300 PRC, 7 mm PRC ou 6.5 PRC. Le tir plongeant demande moins d’élévation qu’à plat : fiez-vous au carnet.',
  },
  {
    id: 'chateau', title: 'Le château d’eau', targets: ['chateau'],
    brief: 'La conduite forcée de la station descend jusqu’au château d’eau. Un gong orange est accroché sur la passerelle de la cuve, côté tireur.',
    intel: 'Gong rond de 60 cm. Passerelle à 24 m du sol, tour de 36 m, cuve de 16 m de diamètre.',
    zone: 'Est-nord-est (78°), 1 000 m, 185 m plus bas.', posts: 'Dalle est (couché).', weapon: '.300 PRC ou .338 Lapua Magnum. Vent presque dans le dos : peu de dérive, mais elle varie avec les rafales.',
  },
  {
    id: 'mover', title: 'La cible mobile', targets: ['mover'],
    brief: 'Au pied du talus, un chariot porte une plaque le long de 36 m de rail, en travers de votre ligne de visée. Il roule à 1,2 m/s et marque dix secondes d’arrêt à chaque butoir : attendez-le là.',
    intel: 'Plaque orange de 75 cm de large sur 1 m de haut. Deux fanions, un à chaque bout du rail. Près de deux secondes de vol : tirez à l’arrêt, au butoir ; en plein mouvement il faudrait plus de deux mètres d’avance.',
    zone: 'Nord-ouest (318°), 1 100 m, 300 m plus bas.', posts: 'Dalle nord (couché).', weapon: '.338 Lapua Magnum 300 gr ou .33 XC : temps de vol court.',
  },
  {
    id: 'mine', title: 'Le chevalement', targets: ['mine'],
    brief: 'La mine s’accroche à une terrasse du versant ouest. Le gong est suspendu sur le plancher des molettes, tout en haut du chevalement.',
    intel: 'Gong rond de 75 cm, orange, devant la grande molette. Plancher des molettes à 21 m du sol, chevalement de 28 m.',
    zone: 'Ouest-nord-ouest (285°), 1 250 m, 216 m plus bas. Soleil bas sur votre gauche.', posts: 'Dalle ouest (couché).', weapon: '.338 Lapua Magnum 300 gr. Vent de face : presque pas de dérive, un peu plus de chute.',
  },
  {
    id: 'mile', title: 'Le mile', targets: ['mile'],
    brief: 'Un mile exactement : 1 609 m. La plaque est posée sur la butte témoin, à l’est, presque à votre hauteur. Vous tirez plein est : la rotation de la Terre relève l’impact, et le vent arrive par l’arrière gauche.',
    intel: 'Plaque de 91 × 61 cm (24 × 36 pouces, le format du King of 2 Miles), orange à pastille blanche. Fanion rouge de 7 m à sa droite, cairn de 2 m à sa gauche.',
    zone: 'Plein est (90°), 1 609 m, 13 m plus bas.', posts: 'Dalle est (couché).', weapon: '.33 XC, .375 CheyTac ou .338 LM 300 gr. Le .300 PRC y arrive en transsonique.',
  },
  {
    id: 'fourneau', title: 'Le haut fourneau', targets: ['fourneau'],
    brief: 'L’aciérie de la plaine. La plaque est dressée sur la plate-forme du gueulard, aux deux tiers du haut fourneau. La fumée du gueulard vous donne le vent là-bas.',
    intel: 'Plaque carrée de 91 cm, blanche. Plate-forme à 33 m du sol, haut fourneau de 52 m.',
    zone: 'Nord (8°), 1 800 m, 278 m plus bas.', posts: 'Plate-forme du mirador (couché), par l’escalier ouest.', weapon: '.375 CheyTac ou .408 CheyTac. Vent plein travers : plusieurs mètres de dérive.',
  },
  {
    id: 'deuxMille', title: 'Deux kilomètres', targets: ['deuxMille'],
    brief: 'Plein ouest, sur l’épaulement du versant, la plaque dans l’ombre de son portique. À l’ouest la rotation de la Terre abaisse l’impact : l’inverse du mile.',
    intel: 'Plaque de 122 × 91 cm, orange. Fanion rouge de 8 m à sa droite.',
    zone: 'Plein ouest (270°), 2 000 m, 167 m plus bas.', posts: 'Dalle ouest (couché).', weapon: '.375 CheyTac, .416 Barrett ou .50 BMG. Plus de trois secondes de vol.',
  },
  {
    id: 'siege', title: 'Le siège de la Compagnie', targets: ['siege'],
    brief: 'La tour de bureaux éventrée du bourg. La plaque est dressée sur l’édicule du toit, le point le plus haut de la tour côté tireur.',
    intel: 'Plaque carrée de 122 cm, orange. Édicule à 36 m du sol, tour de 42 m, plateaux de bureaux espacés de 3,4 m.',
    zone: 'Nord-nord-ouest (335°), 2 250 m, 277 m plus bas.', posts: 'Plate-forme du mirador (couché).', weapon: '.375 CheyTac ou .50 BMG, encore supersoniques à l’arrivée. Le .416 Barrett et le .33 XC y passent le mur du son : dispersion accrue.',
  },
  {
    id: 'extreme', title: 'Deux mille cinq cents', targets: ['extreme'],
    brief: 'La dernière plaque est au pied de la tour de refroidissement de la centrale. Près de cinq secondes de vol et trente milliradians d’élévation : presque toute la course de la tourelle. Le panache de la tour vous montre le vent.',
    intel: 'Plaque de 152 × 122 cm (48 × 60 pouces), orange. Deux fanions de 9 m l’encadrent, à 14 m l’un de l’autre. Tour de refroidissement de 62 m, 150 m derrière.',
    zone: 'Nord-nord-est (20°), 2 500 m, 315 m plus bas.', posts: 'Plate-forme du mirador (couché).', weapon: '.375 CheyTac ou .50 BMG, tout juste supersoniques à l’arrivée. Avec le .416 Barrett, comptez 32 mrad et une balle subsonique.',
  },
];
