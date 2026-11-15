// Mission du niveau « fete » : six séries de stand de tir, de la plaque à 68 m à la guirlande à 420 m.
// Les distances sont celles du poste conseillé (e2e/matrix.mjs --level fete).
import type { SeriesRule } from '../../game/extra/fair';
import type { Step } from '../../game/mission';

/** Poste conseillé par objectif (clé de POSTS), pour le repère de la boussole. */
export const STEP_POST: Record<string, string> = {
  plates: 'appui', balloons: 'appui', wheel: 'tapis', carousel: 'tapis', striker: 'tapis', garland: 'tapis',
};

/**
 * Règle de série de chaque objectif : deux touches à moins de `chainWindow` secondes s'enchaînent (+50 × rang), et
 * la série finie avant `par` secondes (comptées du premier tir) rapporte un bonus de rapidité. Rien n'est jamais retiré.
 * Total possible : 3 800 d'enchaînement + 1 900 de rapidité, sous le plafond de 6 000 (BONUS_MAX).
 */
export const SERIES: Record<string, SeriesRule> = {
  plates: { total: 2, chainWindow: 12, chainPoints: 50, par: 60, speedPoints: 200 },
  balloons: { total: 6, chainWindow: 6, chainPoints: 50, par: 60, speedPoints: 400 },
  // la roue s'arrête 6 s toutes les 8,6 s : la fenêtre laisse attendre l'arrêt suivant
  wheel: { total: 5, chainWindow: 10, chainPoints: 50, par: 75, speedPoints: 400 },
  carousel: { total: 6, chainWindow: 6, chainPoints: 50, par: 60, speedPoints: 400 },
  striker: { total: 1, chainWindow: 0, chainPoints: 0, par: 30, speedPoints: 100 },
  garland: { total: 6, chainWindow: 7, chainPoints: 50, par: 75, speedPoints: 400 },
};

export const STEPS: Step[] = [
  {
    id: 'plates', title: 'Réglage', targets: ['plate1', 'plate2'],
    brief: 'La fête est fermée, le stand est à vous. Deux plaques d’acier pour régler la lunette : la carrée au bord de l’esplanade, juste après les dunes, puis la ronde un peu plus loin, derrière le portique. Faites-les sonner toutes les deux. À chaque série, le chrono part à votre premier tir : enchaîner les touches rapporte des points, traîner n’en retire aucun.',
    intel: 'Plaque carrée de 45 cm, puis plaque ronde de 60 cm. Un fanion rouge flotte près de chacune.',
    zone: 'Nord, à 68 m en contrebas (le tir plonge de 17°), puis à 112 m.', posts: 'Bord nord de la terrasse (accroupi).', weapon: 'Le .22 LR suffit. À 112 m il tombe de 60 cm : montez l’élévation de 5 à 6 mrad, ou prenez le .223 Rem.',
  },
  {
    id: 'balloons', title: 'Les ballons', targets: ['balloon1', 'balloon2', 'balloon3', 'balloon4', 'balloon5', 'balloon6'],
    brief: 'Six ballons sont accrochés au-dessus des trois baraques, deux par stand. Éclatez-les tous. Ils ne bougent pas : c’est une série de vitesse. Deux touches à moins de six secondes l’une de l’autre s’enchaînent, et chaque enchaînement vaut plus que le précédent.',
    intel: 'Ballons de 50 cm, à 4,5 m du sol, espacés de 2,3 m sur chaque stand. Baraques de 4,4 m de large.',
    zone: 'Plein nord, à 135 m, sur l’esplanade.', posts: 'Bord nord de la terrasse (accroupi).', weapon: 'Calibre libre. Le .223 Rem tire à plat à cette distance et son chargeur de dix coups couvre la série.',
  },
  {
    id: 'wheel', title: 'La grande roue', targets: ['wheel1', 'wheel2', 'wheel3', 'wheel4', 'wheel5'],
    brief: 'La roue des cibles tourne encore, par à-coups : un huitième de tour, puis six secondes d’arrêt franc. Cinq de ses huit nacelles portent une plaque ronde. Attendez l’arrêt, tirez posément, et profitez de chaque arrêt pour en toucher plusieurs. C’est la seule cible de la fête qui bouge.',
    intel: 'Plaques rondes de 55 cm, pendues sous les nacelles. Roue de 21 m de diamètre, moyeu à 13 m. Arrêt de 6 s, rotation de 2,6 s.',
    zone: 'Nord, à 215 m, à gauche de l’esplanade, côté mer.', posts: 'Tapis de tir (couché).', weapon: '.223 Rem : un quart de seconde de vol, élévation de 1 mrad environ.',
  },
  {
    id: 'carousel', title: 'Le manège', targets: ['figure1', 'figure2', 'figure3', 'figure4', 'figure5', 'figure6'],
    brief: 'Le manège est à l’arrêt. Sur le bord de son plateau, six silhouettes d’acier de stand de tir : canards, étoiles et cibles rondes. Couchez-les toutes, dans l’ordre que vous voulez. Celles des côtés se présentent un peu de biais : visez la pastille orange.',
    intel: 'Silhouettes de 60 à 80 cm, à 2 m du sol. Plateau de 10 m de diamètre.',
    zone: 'Nord, à 260 m, à droite de la roue, devant la piscine.', posts: 'Tapis de tir (couché).', weapon: '6 mm Creedmoor ou .223 Rem. Élévation de 1 à 1,5 mrad.',
  },
  {
    id: 'striker', title: 'Le tape-fort', targets: ['bell'],
    brief: 'Le tape-fort attend son champion : un mât gradué de huit mètres, et tout en haut la cloche de bronze. Pas besoin de maillet. Faites-la sonner d’une balle, et regardez le curseur monter.',
    intel: 'Cloche de 70 cm, à 8 m du sol. Mât à bandes rouges, jaunes et blanches.',
    zone: 'Plein nord, à 300 m, au milieu de l’esplanade.', posts: 'Tapis de tir (couché).', weapon: 'Il faut 250 J à l’impact : pas de .22 LR. 6 mm Creedmoor ou .223 Rem.',
  },
  {
    id: 'garland', title: 'La guirlande', targets: ['bulb1', 'bulb2', 'bulb3', 'bulb4', 'bulb5', 'bulb6'],
    brief: 'Pour finir, éteignez la guirlande. Six globes allumés pendent entre deux mâts, au bout de l’esplanade. Ils s’éteignent dans l’ordre, de gauche à droite : le bon clignote. Un autre, touché avant son tour, vacille et reste allumé. Vous n’y perdez qu’une cartouche.',
    intel: 'Globes de 48 cm, espacés de 3 m, à 6 m du sol. Mâts distants de 19 m.',
    zone: 'Plein nord, à 420 m, devant le faubourg.', posts: 'Tapis de tir (couché).', weapon: '6.5 Creedmoor : une demi-seconde de vol, 2,5 mrad d’élévation. Le vent est presque nul.',
  },
];
