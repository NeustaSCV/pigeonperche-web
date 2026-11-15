// Mission du niveau « facile » : huit objectifs d'initiation, de la plaque à 65 m au toit de l'hôpital à 600 m.
// Les distances sont celles du poste conseillé (e2e/matrix.mjs --level facile).
import type { Step } from '../../game/mission';

/** Poste conseillé par objectif (clé de POSTS), pour le repère de la boussole. */
export const STEP_POST: Record<string, string> = {
  plates: 'est', quarry: 'talus', balloon: 'est', mill: 'muret', runner: 'muret', bell: 'guet', tower: 'terrasse', roof: 'guet',
};

export const STEPS: Step[] = [
  {
    id: 'plates', title: 'Réglage', targets: ['plate1', 'plate2'],
    brief: 'Deux plaques d’acier vous attendent : l’une au bout de la croupe, juste devant le pas de tir, l’autre au pied du coteau, dans les prés de l’est. Faites-les sonner toutes les deux.',
    intel: 'Plaque carrée de 45 cm, puis plaque ronde de 60 cm. Un fanion rouge flotte près de chacune.',
    zone: 'Nord-est à 65 m, puis est-nord-est à 300 m, en contrebas.', posts: 'Pas de tir (couché), au bout du parapet.', weapon: 'Le .22 LR suffit à 65 m. À 300 m, il tombe de plus de six mètres : prenez le .223 Rem.',
  },
  {
    id: 'quarry', title: 'La sablière', targets: ['drum'],
    brief: 'Un bidon rouge à bande jaune traîne au fond de l’ancienne sablière, sous le flanc est du coteau. Percez-le. Le tir plonge de plus de vingt degrés : la distance qui compte pour la chute est la distance « à plat », affichée à côté de la mesure.',
    intel: 'Bidon de 60 cm de diamètre et 90 cm de haut. Le fond de la sablière est 37 m plus bas que vous.',
    zone: 'Est-nord-est, à 96 m (88 m à plat), très en contrebas.', posts: 'Talus est (couché), par le portillon du mur est.', weapon: 'Il faut 250 J à l’impact : pas de .22 LR. Le .223 Rem convient.',
  },
  {
    id: 'balloon', title: 'Le ballon', targets: ['balloon'],
    brief: 'Un ballon rouge est amarré au pied du coteau, plein nord. Il se couche sous le vent : regardez-le avant de tirer, c’est votre premier indice de dérive.',
    intel: 'Ballon de 48 cm de diamètre au bout d’une corde de 3 m.',
    zone: 'Nord, à 155 m, en contrebas.', posts: 'Pas de tir (couché).', weapon: 'Calibre libre. Au .22 LR, comptez près de 5 mrad d’élévation.',
  },
  {
    id: 'mill', title: 'Le moulin', targets: ['mill'],
    brief: 'Une silhouette d’acier blanche est dressée sur l’appui d’une fenêtre de la minoterie de brique, au bord de la rivière. Couchez-la.',
    intel: 'Silhouette de 54 × 90 cm, fenêtre du premier étage à droite de la façade tournée vers vous. Fenêtre de 1,2 × 1,8 m.',
    zone: 'Nord-nord-ouest, à 225 m.', posts: 'Parapet nord (accroupi, appuyé sur le muret).', weapon: '.223 Rem ou plus : il faut 150 J pour la faire basculer.',
  },
  {
    id: 'runner', title: 'La cible mobile', targets: ['runner'],
    brief: 'Dans le pré clos de la rive nord, un chariot fait la navette sur un rail et porte un disque d’acier. Il roule au pas et marque l’arrêt à chaque heurtoir : tirez à l’arrêt, ou visez un peu devant lui.',
    intel: 'Disque de 50 cm. Voie de 44 m, vitesse 1,4 m/s (5 km/h), arrêt de 8 s à chaque bout.',
    zone: 'Plein nord, à 315 m, entre la rivière et la route.', posts: 'Parapet nord (accroupi) ou plate-forme du guet.', weapon: '6 mm Creedmoor : 0,4 s de vol, le disque avance d’à peine 55 cm.',
  },
  {
    id: 'bell', title: 'Le timbre de l’horloge', targets: ['bell'],
    brief: 'L’horloge de l’église s’est arrêtée, mais son timbre est resté : une petite cloche de bronze sous une potence, au-dessus du cadran. Faites-la sonner.',
    intel: 'Cloche de bronze de 1 m, à 12 m du sol, sur la face du clocher tournée vers vous. Cadran de 1,4 m, clocher de 34 m.',
    zone: 'Nord-nord-est, à 385 m.', posts: 'Plate-forme du guet (couché), par l’escalier de bois.', weapon: '6.5 Creedmoor ou 6 mm Creedmoor : il faut 400 J pour l’ébranler.',
  },
  {
    id: 'tower', title: 'Le château d’eau', targets: ['tower'],
    brief: 'Une silhouette noire est suspendue au garde-corps de la passerelle du château d’eau, sous la cuve. Le tir monte, et le vent a forci : lisez la manche à air de la plate-forme et les fanions avant de régler la dérive.',
    intel: 'Silhouette de 56 × 94 cm, à 24 m du sol. Tour de 36 m, cuve de 16 m de diamètre.',
    zone: 'Ouest-nord-ouest, à 425 m, 48 m plus haut que vous.', posts: 'Terrasse ouest (couché), par le portillon du mur ouest.', weapon: '6.5 Creedmoor. Il faut 300 J à l’impact.',
  },
  {
    id: 'roof', title: 'Le toit de l’hôpital', targets: ['roof'],
    brief: 'Dernière cible : une grande silhouette noire debout sur l’acrotère du toit de l’hôpital, à droite du fronton de l’horloge. Six cents mètres, vent de travers : prenez votre temps.',
    intel: 'Silhouette de 68 × 112 cm, à 11 m du sol. Pavillon central de 12 m de large.',
    zone: 'Plein nord, à 600 m.', posts: 'Plate-forme du guet (couché).', weapon: '.308 Win ou 6.5 Creedmoor : près d’une seconde de vol. Il faut 300 J à l’impact.',
  },
];
