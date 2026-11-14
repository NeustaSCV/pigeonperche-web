// Toutes les données d'armes et de munitions du jeu, en un seul fichier.
// Vitesses, coefficients balistiques et masses : valeurs publiées par les fabricants de munitions
// (Lapua, Federal, Berger, Hornady, CheyTac, Barrett), relevées dans tests/reference-tables.json avec leurs sources.
// Carabines : modèles réels (capacités, masses, longueurs et pas de rayure des fiches constructeur).
//
// Trois familles (`tier`) :
//   - 'standard'      : les sept armes d'origine, du .22 LR au .338 Lapua Magnum ;
//   - 'intermediate'  : calibres de compétition modernes qui comblent les trous de la gamme (6 mm CM → .300 PRC) ;
//   - 'elr'           : tir à très longue distance, au-delà du .338 LM 250 gr (King of 1 Mile / King of 2 Miles).
import type { ShotProfile } from '../audio/types';
import type { DragModel } from '../ballistics/solver';

/** Description physique de la carabine, pour le modèle 3D (src/weapons/rifle-model.ts). */
export interface RifleBuild {
  /** longueur hors tout, mm (crosse dépliée, frein de bouche compris) */
  overallMm: number;
  /** architecture : classique, ou bullpup (culasse et chargeur derrière la poignée) */
  layout: 'classic' | 'bullpup';
  /** crosse : bois, composite moulé, châssis aluminium, crosse squelette, tube (type AR / M200) */
  stock: 'wood' | 'composite' | 'chassis' | 'skeleton' | 'tube';
  /** crosse repliable */
  folding: boolean;
  /** bouche : nue, frein à 2 ou 3 chambres, gros frein « tank » des calibres lourds, modérateur */
  muzzle: 'none' | 'brake2' | 'brake3' | 'tank' | 'suppressor';
  /** alimentation : chargeur amovible ou coup par coup */
  feed: 'magazine' | 'single';
  /** canon : profil chasse, lourd, lourd cannelé, gainé carbone */
  barrel: 'sporter' | 'heavy' | 'fluted' | 'carbon';
  /** bipied : rapporté (type Harris / Atlas) ou intégré à l'arme */
  bipod: 'attached' | 'integral';
  /** poignée de transport au-dessus du canon (M200) */
  carryHandle?: boolean;
}

export interface WeaponDef {
  id: string;
  /** famille de l'arme (voir en tête de fichier) */
  tier: 'standard' | 'intermediate' | 'elr';
  /** carabine */
  name: string;
  caliber: string;
  /** munition du commerce utilisée */
  ammo: string;
  bulletGr: number;
  /** vitesse initiale publiée, m/s */
  v0: number;
  /**
   * coefficient balistique G1 publié. Pour une arme en G7 il reste renseigné (affichage, et repli si le vol n'est
   * pas encore branché sur `stepFlight`), mais c'est `bcG7` qui fait foi.
   */
  bcG1: number;
  /** modèle de traînée utilisé par le solveur ; absent = G1 */
  dragModel?: DragModel;
  /** coefficient balistique G7 publié (obligatoire si dragModel vaut 'G7') */
  bcG7?: number;
  /** diamètre et longueur du projectile, mm : servent à la stabilité gyroscopique (Miller) */
  bulletDiaMm?: number;
  bulletLenMm?: number;
  /** pas de rayure, pouces par tour (positif : à droite, comme toutes les armes du jeu) */
  twistIn?: number;
  /** charge de poudre approximative en grains (sert au calcul du recul) */
  chargeGr: number;
  magazine: number;
  /** durée du cycle de verrou, s */
  boltTime: number;
  /** durée d'un changement de chargeur, s */
  reloadTime: number;
  weightKg: number;
  barrelMm: number;
  /** dispersion mécanique arme + munition, en minutes d'angle (diamètre moyen d'un groupement) */
  moa: number;
  /** dispersion supplémentaire subie au passage transsonique, MOA */
  transonicMoa: number;
  /** distance de zérotage, m */
  zero: number;
  /** grossissement de la lunette montée */
  scope: [number, number];
  /** course d'élévation utilisable à la tourelle depuis le zéro, mrad */
  turretMaxMil: number;
  /** lunette réelle montée, sa course d'élévation totale (mrad) et l'inclinaison de l'embase (MOA) : justifient turretMaxMil */
  optic?: { model: string; travelMil: number; railMoa: number };
  /** capacité de pénétration : 1 (.22 LR) à 6 (.338 LM et au-delà). Un bloc moteur exige 4. */
  penetration: number;
  /** points d'alerte ajoutés au campement par la seule détonation */
  alert: number;
  suppressed: boolean;
  sound: ShotProfile;
  /** portée pratique indicative, m */
  effective: number;
  note: string;
  /** apparence : couleur du châssis ou de la crosse, frein de bouche. `length` et `chassis` ne servent plus au modèle 3D
   *  (chaque arme a sa géométrie propre, à l'échelle réelle : src/weapons/rifle-model.ts). */
  look: { length: number; color: number; chassis: boolean; brake: boolean };
  /** description physique pour le modèle 3D ; absente sur une arme : voir `buildOf` */
  build?: RifleBuild;
}

export const SIGHT_HEIGHT = 0.05;
export const CLICK_MIL = 0.1;

export const WEAPONS: WeaponDef[] = [
  {
    id: '22lr', tier: 'standard', twistIn: 16, name: 'CZ 457 Varmint', caliber: '.22 LR', ammo: 'Lapua Center-X 40 gr', bulletGr: 40, v0: 327, bcG1: 0.172, chargeGr: 1.2,
    magazine: 5, boltTime: 0.75, reloadTime: 2.2, weightKg: 3.3, barrelMm: 525, moa: 1.1, transonicMoa: 0, zero: 50, scope: [4, 16], turretMaxMil: 32,
    penetration: 1, alert: 0, suppressed: false,
    sound: { loudness: 0.12, bass: 0.05, brightness: 0.55, tail: 0.12, supersonic: false, suppressed: false },
    effective: 200, note: 'Subsonique, très discret. Tir en cloche dès 150 m, sensible au vent.',
    look: { length: 0.92, color: 0x6a4a2e, chassis: false, brake: false },
    build: { overallMm: 920, layout: 'classic', stock: 'wood', folding: false, muzzle: 'none', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    id: '223', tier: 'standard', bulletDiaMm: 5.69, bulletLenMm: 25.25, twistIn: 8, name: 'Tikka T3x Tac A1', caliber: '.223 Rem', ammo: 'Federal Gold Medal 77 gr SMK', bulletGr: 77, v0: 829, bcG1: 0.372, chargeGr: 24,
    magazine: 10, boltTime: 0.85, reloadTime: 2.6, weightKg: 5.1, barrelMm: 600, moa: 0.6, transonicMoa: 1.4, zero: 100, scope: [5, 25], turretMaxMil: 26,
    penetration: 2, alert: 4, suppressed: false,
    sound: { loudness: 0.5, bass: 0.3, brightness: 0.85, tail: 0.35, supersonic: true, suppressed: false },
    effective: 600, note: 'Recul léger, on observe ses impacts. Peu d’énergie au-delà de 500 m.',
    look: { length: 1.0, color: 0x2b2d2f, chassis: true, brake: true },
    build: { overallMm: 1000, layout: 'classic', stock: 'chassis', folding: true, muzzle: 'brake3', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    id: '65cm', tier: 'standard', bulletDiaMm: 6.71, bulletLenMm: 34.21, twistIn: 8, name: 'Tikka T3x Tac A1', caliber: '6.5 Creedmoor', ammo: 'Lapua Scenar-L 136 gr', bulletGr: 136, v0: 835, bcG1: 0.545, chargeGr: 41,
    magazine: 10, boltTime: 0.95, reloadTime: 2.6, weightKg: 5.1, barrelMm: 600, moa: 0.5, transonicMoa: 0.9, zero: 100, scope: [5, 25], turretMaxMil: 26,
    penetration: 3, alert: 6, suppressed: false,
    sound: { loudness: 0.62, bass: 0.45, brightness: 0.8, tail: 0.45, supersonic: true, suppressed: false },
    effective: 1100, note: 'Tendu et peu sensible au vent pour un recul modéré. Le meilleur compromis.',
    look: { length: 1.0, color: 0x3a3d34, chassis: true, brake: true },
    build: { overallMm: 1000, layout: 'classic', stock: 'chassis', folding: true, muzzle: 'brake3', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    id: '308', tier: 'standard', bulletDiaMm: 7.82, bulletLenMm: 33.43, twistIn: 10, name: 'Ruger Precision Rifle', caliber: '.308 Win', ammo: 'Lapua Scenar-L 175 gr', bulletGr: 175, v0: 793, bcG1: 0.49, chargeGr: 43,
    magazine: 10, boltTime: 1.0, reloadTime: 2.6, weightKg: 4.45, barrelMm: 508, moa: 0.6, transonicMoa: 1.6, zero: 100, scope: [5, 25], turretMaxMil: 26,
    penetration: 4, alert: 8, suppressed: false,
    sound: { loudness: 0.7, bass: 0.6, brightness: 0.7, tail: 0.5, supersonic: true, suppressed: false },
    effective: 800, note: 'Le classique. Perce un bloc moteur, mais chute et dérive marquées au-delà de 700 m.',
    look: { length: 0.97, color: 0x26282a, chassis: true, brake: false },
    build: { overallMm: 970, layout: 'classic', stock: 'chassis', folding: true, muzzle: 'none', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    id: '308sub', tier: 'standard', bulletDiaMm: 7.82, bulletLenMm: 36.07, twistIn: 10, name: 'Ruger Precision Rifle + modérateur', caliber: '.308 Win subsonique', ammo: 'Lapua B416 Subsonic 200 gr', bulletGr: 200, v0: 325, bcG1: 0.518, chargeGr: 9,
    magazine: 10, boltTime: 1.0, reloadTime: 2.6, weightKg: 4.9, barrelMm: 508, moa: 1.0, transonicMoa: 0, zero: 100, scope: [5, 25], turretMaxMil: 26,
    penetration: 2, alert: 0, suppressed: true,
    sound: { loudness: 0.1, bass: 0.2, brightness: 0.2, tail: 0.15, supersonic: false, suppressed: true },
    effective: 250, note: 'Presque inaudible : ni détonation ni claquement. Trajectoire très courbe.',
    look: { length: 1.12, color: 0x26282a, chassis: true, brake: false },
    build: { overallMm: 1120, layout: 'classic', stock: 'chassis', folding: true, muzzle: 'suppressor', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    id: '300wm', tier: 'standard', bulletDiaMm: 7.82, bulletLenMm: 33.4, twistIn: 11, name: 'Sako TRG 42', caliber: '.300 Win Mag', ammo: 'Lapua Scenar 185 gr', bulletGr: 185, v0: 900, bcG1: 0.482, chargeGr: 73,
    magazine: 7, boltTime: 1.2, reloadTime: 2.9, weightKg: 5.3, barrelMm: 690, moa: 0.5, transonicMoa: 1.2, zero: 100, scope: [5, 25], turretMaxMil: 28,
    penetration: 5, alert: 14, suppressed: false,
    sound: { loudness: 0.86, bass: 0.82, brightness: 0.75, tail: 0.65, supersonic: true, suppressed: false },
    effective: 1100, note: 'Magnum : beaucoup d’énergie, recul sec, détonation qui porte loin.',
    look: { length: 1.1, color: 0x4b4d3a, chassis: false, brake: true },
    build: { overallMm: 1100, layout: 'classic', stock: 'composite', folding: false, muzzle: 'brake3', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    id: '338lm', tier: 'standard', bulletDiaMm: 8.59, bulletLenMm: 39.4, twistIn: 10, name: 'PGM 338', caliber: '.338 Lapua Magnum', ammo: 'Lapua Scenar 250 gr', bulletGr: 250, v0: 905, bcG1: 0.648, chargeGr: 90,
    magazine: 10, boltTime: 1.5, reloadTime: 3.2, weightKg: 6.6, barrelMm: 690, moa: 0.45, transonicMoa: 0.8, zero: 100, scope: [6, 30], turretMaxMil: 30,
    penetration: 6, alert: 18, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.7, tail: 0.8, supersonic: true, suppressed: false },
    effective: 1500, note: 'Tendu à 1 000 m et encore supersonique à 1 300 m. Recul massif, réarmement lent.',
    look: { length: 1.18, color: 0x3b3a36, chassis: true, brake: true },
    build: { overallMm: 1180, layout: 'classic', stock: 'skeleton', folding: true, muzzle: 'brake3', feed: 'magazine', barrel: 'fluted', bipod: 'attached' },
  },

  // ------------------------------------------------------------------------------------------------------------
  // Calibres intermédiaires : cartouches de compétition modernes (PRS, F-Class, chasse à longue distance).
  // Balles longues publiées en G7 : c'est ce modèle que le solveur utilise (dragModel), le G1 publié reste indiqué.
  // Longueurs de projectile : fiches Berger (Quick Reference Sheets) et liste JBM Ballistics des longueurs.
// Optique : Nightforce ATACR 5-25x56 F1 (35 mrad de course) sur embase rapportée de 30 MOA : 26 mrad utilisables.
  // ------------------------------------------------------------------------------------------------------------
  {
    // Munition : Berger Match Grade Target 6 mm Creedmoor 109 gr LRHT, réf. 20030 — 2 950 ft/s, G7 0,292, G1 0,568
    //   (catalogue Berger 2026) ; balle réf. 24485 longue de 1,277 po (Berger Quick Reference Sheets).
    // Carabine : Savage 110 Elite Precision 6 mm Creedmoor — canon 26 po, pas 1:7,5, 12,6 lb, 44 po, chargeur AICS 10
    //   (fiche Savage, essais Gun Tests et American Rifleman), châssis MDT ACC.
    id: '6cm', tier: 'intermediate', name: 'Savage 110 Elite Precision', caliber: '6 mm Creedmoor', ammo: 'Berger LRHT 109 gr', bulletGr: 109, v0: 899,
    bcG1: 0.568, dragModel: 'G7', bcG7: 0.292, bulletDiaMm: 6.17, bulletLenMm: 32.44, twistIn: 7.5, chargeGr: 41,
    magazine: 10, boltTime: 0.9, reloadTime: 2.6, weightKg: 5.7, barrelMm: 660, moa: 0.4, transonicMoa: 0.9, zero: 100, scope: [5, 25], turretMaxMil: 26,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 30 },
    penetration: 3, alert: 5, suppressed: false,
    sound: { loudness: 0.58, bass: 0.38, brightness: 0.88, tail: 0.42, supersonic: true, suppressed: false },
    effective: 1100, note: 'Le calibre des compétitions PRS : recul infime, trajectoire très tendue, mais peu d’énergie à l’arrivée.',
    look: { length: 1.12, color: 0x55585c, chassis: true, brake: true },
    build: { overallMm: 1118, layout: 'classic', stock: 'chassis', folding: false, muzzle: 'brake2', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    // Munition : Hornady Match 6.5 PRC 147 gr ELD Match, réf. 81620 — 2 910 ft/s en canon de 24 po (hornady.com) ;
    //   G7 0,351 / G1 0,697 à Mach 2,25 (hornady.com/bc) ; balle longue de 1,440 po (liste JBM).
    // Carabine : Bergara B-14 HMR 6.5 PRC — canon 24 po, pas 1:8, 9,7 lb, 44 po, chargeur AICS de 3 coups (fiche Bergara :
    //   « A 5-round AICS detachable magazine is standard with our HMR rifle (3 round mag: 6.5 PRC) »).
    id: '65prc', tier: 'intermediate', name: 'Bergara B-14 HMR', caliber: '6.5 PRC', ammo: 'Hornady ELD Match 147 gr', bulletGr: 147, v0: 887,
    bcG1: 0.697, dragModel: 'G7', bcG7: 0.351, bulletDiaMm: 6.71, bulletLenMm: 36.58, twistIn: 8, chargeGr: 56,
    magazine: 3, boltTime: 1.0, reloadTime: 2.7, weightKg: 4.4, barrelMm: 610, moa: 0.5, transonicMoa: 0.8, zero: 100, scope: [5, 25], turretMaxMil: 26,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 30 },
    penetration: 4, alert: 8, suppressed: false,
    sound: { loudness: 0.7, bass: 0.52, brightness: 0.82, tail: 0.5, supersonic: true, suppressed: false },
    effective: 1300, note: 'Un 6.5 Creedmoor qui aurait pris 50 m/s : encore supersonique à 1 500 m pour un recul raisonnable.',
    look: { length: 1.12, color: 0x5b4a3a, chassis: false, brake: false },
    build: { overallMm: 1118, layout: 'classic', stock: 'composite', folding: false, muzzle: 'none', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    // Munition : Hornady Match 7 mm PRC 180 gr ELD Match, réf. 80711 — 2 975 ft/s en canon de 24 po (hornady.com) ;
    //   G7 0,391 en pas de 1:8,75 et 0,411 en pas de 1:7,5 à Mach 2,25 (hornady.com/bc) : 0,401 retenu pour le pas
    //   de 1:8 de cette arme (G1 0,777 à 0,816 → 0,796) ; balle longue de 1,538 po (liste JBM).
    // Carabine : Seekins Precision Havak PH2 7 mm PRC — canon cannelé 26 po, pas 1:8, 7,2 lb, chargeur 3 (fiches revendeurs).
    //   Longueur hors tout non publiée dans les sources consultées : estimée.
    id: '7prc', tier: 'intermediate', name: 'Seekins Havak PH2', caliber: '7 mm PRC', ammo: 'Hornady ELD Match 180 gr', bulletGr: 180, v0: 907,
    bcG1: 0.796, dragModel: 'G7', bcG7: 0.401, bulletDiaMm: 7.21, bulletLenMm: 39.07, twistIn: 8, chargeGr: 67,
    magazine: 3, boltTime: 1.05, reloadTime: 2.8, weightKg: 3.3, barrelMm: 660, moa: 0.6, transonicMoa: 0.7, zero: 100, scope: [5, 25], turretMaxMil: 26,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 30 },
    penetration: 4, alert: 11, suppressed: false,
    sound: { loudness: 0.8, bass: 0.68, brightness: 0.8, tail: 0.58, supersonic: true, suppressed: false },
    effective: 1600, note: 'Carabine de montagne légère pour une cartouche très tendue : le recul est vif, trois coups seulement.',
    look: { length: 1.18, color: 0x4a4f45, chassis: false, brake: true },
    build: { overallMm: 1180, layout: 'classic', stock: 'composite', folding: false, muzzle: 'brake2', feed: 'magazine', barrel: 'fluted', bipod: 'attached' },
  },
  {
    // Munition : Hornady Match .300 PRC 225 gr ELD Match, réf. 82162 — 2 810 ft/s en canon de 24 po (hornady.com) ;
    //   G7 0,391 / G1 0,777 à Mach 2,25 (hornady.com/bc) ; balle longue de 1,656 po (liste JBM).
    // Carabine : Barrett MRAD .300 PRC — canon cannelé 26 po, pas 1:8, 49,4 po, 13,8 lb, chargeur 10 (fiches Barrett / revendeurs).
    id: '300prc', tier: 'intermediate', name: 'Barrett MRAD', caliber: '.300 PRC', ammo: 'Hornady ELD Match 225 gr', bulletGr: 225, v0: 856,
    bcG1: 0.777, dragModel: 'G7', bcG7: 0.391, bulletDiaMm: 7.82, bulletLenMm: 42.06, twistIn: 8, chargeGr: 77,
    magazine: 10, boltTime: 1.25, reloadTime: 2.9, weightKg: 6.3, barrelMm: 660, moa: 0.45, transonicMoa: 0.7, zero: 100, scope: [5, 25], turretMaxMil: 26,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 30 },
    penetration: 5, alert: 15, suppressed: false,
    sound: { loudness: 0.9, bass: 0.86, brightness: 0.74, tail: 0.68, supersonic: true, suppressed: false },
    effective: 1450, note: 'Le .30 des tireurs à 1 500 m : balle lourde de 225 gr qui porte loin, dans une arme lourde qui encaisse.',
    look: { length: 1.25, color: 0x6b6250, chassis: true, brake: true },
    build: { overallMm: 1255, layout: 'classic', stock: 'chassis', folding: true, muzzle: 'brake2', feed: 'magazine', barrel: 'fluted', bipod: 'attached' },
  },

  // ------------------------------------------------------------------------------------------------------------
  // Tir à très longue distance (ELR). Calibres réellement engagés au King of 1 Mile et au King of 2 Miles :
  // le .375 CheyTac et le .416 Barrett occupent 8 des 10 premières places du KO2M 2018 (Precision Rifle Blog,
  // « What the pros use: King of 2 Miles edition ») ; le .338 LM à balle de 300 gr et le .33 XC de David Tubb sont
// les cartouches de la catégorie en dessous (pas de classement publié retrouvé pour le King of 1 Mile).
  // CheyTac ne publie que le G1 de ses balles « Balanced Flight », Hornady que le G1 de la 750 gr A-MAX :
  // ces trois armes restent donc en G1 (optimiste dans le transsonique pour une balle aussi effilée).
// Optique : Nightforce ATACR 5-25x56 F1 (35 mrad de course d'élévation, fiche Nightforce ; c'est la lunette des 2e et
// 3e du KO2M 2018) sur embase de 60 MOA (option d'usine du M200) : 34 mrad utilisables depuis le zéro à 100 m, soit
// un tir à 2 500 m entièrement réglable à la tourelle pour le .33 XC, le .375 CheyTac et le .50 BMG (31,8, 30,7 et
// 32,4 mrad nécessaires dans l'air du jeu) ; il manque 0,4 mrad au .416 Barrett (34,4) et 3,6 mrad au .408 CheyTac
// (37,6), à prendre en contre-visée.
// Les 24 mrad du sapin du réticule couvrent le reste, comme le font en vrai les prismes type Charlie TARAC.
  // ------------------------------------------------------------------------------------------------------------
  {
    // Munition : Berger Match Grade Tactical .338 Lapua Magnum 300 gr Hybrid OTM, réf. 81110 — 2 725 ft/s,
    //   G7 0,421, G1 0,822 (catalogue Berger 2026) ; balle réf. 33109 longue de 1,819 po (Berger Quick Reference Sheets).
    // Carabine : Accuracy International AXSR .338 LM — canon 27 po, pas 1:9,35, 7,39 kg, 1 265 mm, chargeur 10,
    //   embase 30 MOA (tarif AI 2024 et fiche AXSR). Lunette ATACR 7-35x56 F1 (29 mrad de course) : 23 mrad
    //   utilisables, de quoi régler le mile (18,5 mrad) ; à 2 500 m il faut 45 mrad, donc 22 mrad de contre-visée.
    id: '338lm300', tier: 'elr', name: 'Accuracy International AXSR', caliber: '.338 Lapua Magnum', ammo: 'Berger Hybrid OTM 300 gr', bulletGr: 300, v0: 831,
    bcG1: 0.822, dragModel: 'G7', bcG7: 0.421, bulletDiaMm: 8.59, bulletLenMm: 46.2, twistIn: 9.35, chargeGr: 90,
    magazine: 10, boltTime: 1.45, reloadTime: 3.1, weightKg: 7.4, barrelMm: 686, moa: 0.4, transonicMoa: 0.6, zero: 100, scope: [7, 35], turretMaxMil: 23,
    optic: { model: 'Nightforce ATACR 7-35x56 F1', travelMil: 29, railMoa: 30 },
    penetration: 6, alert: 18, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.68, tail: 0.82, supersonic: true, suppressed: false },
    effective: 1650, note: 'Le .338 des épreuves au mile : balle de 300 gr plus lente au départ, mais qui garde sa vitesse bien plus loin.',
    look: { length: 1.27, color: 0x4f5340, chassis: true, brake: true },
    build: { overallMm: 1265, layout: 'classic', stock: 'chassis', folding: true, muzzle: 'brake2', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    // Munition : rechargement publié par David Tubb, créateur du .33 XC — 300 gr Berger, 120 gr de H50BMG,
    //   3 160 ft/s en canon Schneider de 33 po au pas de 1:9 (davidtubb.com, « 33XC 37XC 41XC writeup », 2023) ;
    //   balle Berger 300 gr Hybrid OTM : G7 0,421, longueur 1,819 po.
    // Carabine : Tubb Adaptive Target Rifle (ATR), vendue sans canon, 7,2 lb nue (davidtubb.com). Masse en ordre de
    //   tir, longueur et capacité du chargeur : estimées (non publiées).
    id: '33xc', tier: 'elr', name: 'Tubb Adaptive Target Rifle', caliber: '.33 XC', ammo: 'Berger Hybrid OTM 300 gr (Tubb)', bulletGr: 300, v0: 963,
    bcG1: 0.822, dragModel: 'G7', bcG7: 0.421, bulletDiaMm: 8.59, bulletLenMm: 46.2, twistIn: 9, chargeGr: 120,
    magazine: 5, boltTime: 1.5, reloadTime: 3.2, weightKg: 9.5, barrelMm: 838, moa: 0.35, transonicMoa: 0.6, zero: 100, scope: [5, 25], turretMaxMil: 34,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 60 },
    penetration: 6, alert: 20, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.74, tail: 0.9, supersonic: true, suppressed: false },
    effective: 2000, note: 'La même balle que le .338 LM lancée 130 m/s plus vite : supersonique jusqu’à deux kilomètres.',
    look: { length: 1.42, color: 0x2c2f33, chassis: true, brake: true },
    build: { overallMm: 1420, layout: 'classic', stock: 'tube', folding: false, muzzle: 'brake3', feed: 'magazine', barrel: 'heavy', bipod: 'attached' },
  },
  {
    // Munition : CheyTac .375 CheyTac 350 gr Balanced Flight — 2 950 ft/s en canon de 29,5 po au pas de 1:9,5,
    //   G1 0,988 (catalogue CheyTac USA 2026 ; G7 non publié) ; balle longue de 2,083 po (liste JBM, mesure Litz).
    // Carabine : Desert Tech HTI .375 CheyTac — bullpup, canon 29 po, pas 1:10,5, 44 3/8 po (1 127 mm), 19,9 lb
    //   (9,03 kg), chargeur 5 (fiches revendeurs Desert Tech).
    id: '375ct', tier: 'elr', name: 'Desert Tech HTI', caliber: '.375 CheyTac', ammo: 'CheyTac Balanced Flight 350 gr', bulletGr: 350, v0: 899,
    bcG1: 0.988, bulletDiaMm: 9.525, bulletLenMm: 52.91, twistIn: 10.5, chargeGr: 135,
    magazine: 5, boltTime: 1.6, reloadTime: 3.3, weightKg: 9.0, barrelMm: 737, moa: 0.45, transonicMoa: 0.6, zero: 100, scope: [5, 25], turretMaxMil: 34,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 60 },
    penetration: 6, alert: 22, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.7, tail: 0.95, supersonic: true, suppressed: false },
    effective: 2300, note: 'Le calibre roi du King of 2 Miles, ici en bullpup : un canon de 74 cm dans une arme de 1,13 m.',
    look: { length: 1.13, color: 0x8a7a5c, chassis: true, brake: true },
    build: { overallMm: 1127, layout: 'bullpup', stock: 'chassis', folding: false, muzzle: 'tank', feed: 'magazine', barrel: 'fluted', bipod: 'attached' },
  },
  {
    // Munition : CheyTac .408 CheyTac 419 gr Balanced Flight — 2 750 ft/s en canon de 29,5 po au pas de 1:10,
    //   G1 0,949 « en moyenne sur 3 500 yards » (catalogue CheyTac USA 2026 ; G7 non publié) ; balle longue de
    //   2,173 po (liste JBM, mesure Litz).
    // Carabine : CheyTac M200 Intervention — canon 29,5 po cannelé, 56 po (1 422 mm), 31 lb (14 kg) sans optique,
    //   chargeur 7, embase 40 MOA (50 et 60 MOA en option), bipied intégré (catalogue CheyTac USA 2026).
    //   Longueur crosse sortie : 56 po sur la fiche produit CheyTac (cheytac.com), 55 po au catalogue 2024 ; les 53 po
    //   (1 346 mm) de l'encadré Wikipédia ne sont pas sourcés et le corps du même article dit 56 po. La crosse du modèle
    //   3D suit build.overallMm (rifle-model.ts, m200) : changer la cote ici suffit à le recaler.
    id: '408ct', tier: 'elr', name: 'CheyTac M200 Intervention', caliber: '.408 CheyTac', ammo: 'CheyTac Balanced Flight 419 gr', bulletGr: 419, v0: 838,
    bcG1: 0.949, bulletDiaMm: 10.36, bulletLenMm: 55.19, twistIn: 10, chargeGr: 135,
    magazine: 7, boltTime: 1.7, reloadTime: 3.5, weightKg: 14, barrelMm: 749, moa: 0.5, transonicMoa: 0.6, zero: 100, scope: [5, 25], turretMaxMil: 34,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 60 },
    penetration: 6, alert: 24, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.66, tail: 1.0, supersonic: true, suppressed: false },
    effective: 2000, note: 'L’Intervention : quatorze kilos, bipied et poignée intégrés. Balle de 419 gr, lente mais insensible au vent.',
    look: { length: 1.42, color: 0x3a3c3e, chassis: true, brake: true },
    build: { overallMm: 1422, layout: 'classic', stock: 'tube', folding: false, muzzle: 'tank', feed: 'magazine', barrel: 'fluted', bipod: 'integral', carryHandle: true },
  },
  {
    // Munition : Barrett .416 Barrett, Hornady 500 gr A-Tip Match — 2 850 ft/s en canon de 36 po, G7 0,492,
    //   G1 0,976, pas recommandé 1:12 (barrett.net). Longueur de la balle non publiée : estimée à 52,3 mm par
    //   similitude avec la 300 gr A-Tip de .338 (même construction, même rapport masse / calibre³).
    // Carabine : Barrett Model 99 .416 Barrett — bullpup à un coup, canon lourd 32 po, pas 1:12, 50 po (1 270 mm),
    //   25 lb (11,3 kg) (barrett.net). La vitesse publiée l'est en canon de 36 po : non corrigée pour les 32 po.
    id: '416b', tier: 'elr', name: 'Barrett M99', caliber: '.416 Barrett', ammo: 'Barrett / Hornady A-Tip 500 gr', bulletGr: 500, v0: 869,
    bcG1: 0.976, dragModel: 'G7', bcG7: 0.492, bulletDiaMm: 10.57, bulletLenMm: 52.3, twistIn: 12, chargeGr: 200,
    magazine: 1, boltTime: 1.8, reloadTime: 2.4, weightKg: 11.3, barrelMm: 813, moa: 0.5, transonicMoa: 0.6, zero: 100, scope: [5, 25], turretMaxMil: 34,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 60 },
    penetration: 6, alert: 27, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.64, tail: 1.05, supersonic: true, suppressed: false },
    effective: 2100, note: 'Vainqueur du King of 2 Miles 2018. Un seul coup : chaque cartouche se glisse à la main dans la culasse.',
    look: { length: 1.27, color: 0x7d7461, chassis: true, brake: true },
    build: { overallMm: 1270, layout: 'bullpup', stock: 'chassis', folding: false, muzzle: 'tank', feed: 'single', barrel: 'heavy', bipod: 'attached' },
  },
  {
    // Munition : Hornady Match .50 BMG 750 gr A-MAX, réf. 8270 — 2 815 ft/s en canon d'essai de 36 po (hornady.com),
    //   G1 1,050 (valeur Hornady reprise par les revendeurs ; G7 non publié) ; balle longue de 2,540 po (liste JBM).
    // Carabine : Steyr HS .50 M1 — canon forgé à froid 35 po, pas 1:15, 28,7 lb (13 kg), chargeur latéral 5,
    //   bipied intégré (fiches revendeurs Steyr Arms). Longueur hors tout : 57,5 po / 1 460 mm (fiche Steyr Arms USA,
    //   steyr-arms.us, qui donne aussi 35,4 po / 900 mm de canon et 13,8 kg : canon et masse laissés aux valeurs des revendeurs).
    id: '50bmg', tier: 'elr', name: 'Steyr HS .50 M1', caliber: '.50 BMG', ammo: 'Hornady A-MAX Match 750 gr', bulletGr: 750, v0: 858,
    bcG1: 1.05, bulletDiaMm: 12.95, bulletLenMm: 64.52, twistIn: 15, chargeGr: 230,
    magazine: 5, boltTime: 1.9, reloadTime: 3.8, weightKg: 13, barrelMm: 889, moa: 0.7, transonicMoa: 0.9, zero: 100, scope: [5, 25], turretMaxMil: 34,
    optic: { model: 'Nightforce ATACR 5-25x56 F1', travelMil: 35, railMoa: 60 },
    penetration: 6, alert: 30, suppressed: false,
    sound: { loudness: 1, bass: 1, brightness: 0.6, tail: 1.15, supersonic: true, suppressed: false },
    effective: 2300, note: 'Le calibre antimatériel : 18 000 joules à la bouche. Le souffle du frein s’entend dans toute la vallée.',
    look: { length: 1.46, color: 0x2a2c2e, chassis: true, brake: true },
    build: { overallMm: 1460, layout: 'classic', stock: 'chassis', folding: false, muzzle: 'tank', feed: 'magazine', barrel: 'fluted', bipod: 'integral' },
  },
];

export const weaponById = (id: string): WeaponDef => WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];

/** Vitesse de recul libre de l'arme (m/s) : quantité de mouvement du projectile et des gaz / masse de l'arme. */
export function recoilVelocity(w: WeaponDef): number {
  const mb = w.bulletGr * 6.479891e-5;
  const mp = w.chargeGr * 6.479891e-5;
  const gas = w.v0 > 400 ? 1200 : 500;
  return ((mb * w.v0 + mp * gas) / w.weightKg) * (w.look.brake ? 0.72 : 1) * (w.suppressed ? 0.8 : 1);
}

/** Armes d'une famille (pour composer l'arsenal d'une carte). */
export const weaponsOfTier = (...tiers: WeaponDef['tier'][]): WeaponDef[] => WEAPONS.filter((w) => tiers.includes(w.tier));

/** Description physique d'une arme pour le modèle 3D : celle de la fiche, sinon déduite de `look`. */
export function buildOf(w: WeaponDef): RifleBuild {
  return w.build ?? {
    overallMm: Math.round(w.look.length * 1000), layout: 'classic', stock: w.look.chassis ? 'chassis' : 'composite', folding: false,
    muzzle: w.suppressed ? 'suppressor' : w.look.brake ? 'brake3' : 'none', feed: w.magazine > 1 ? 'magazine' : 'single', barrel: 'heavy', bipod: 'attached',
  };
}

const MOA_MIL = 0.2908882;
/**
 * Course d'élévation utilisable depuis un zéro à 100 m, mrad : une embase inclinée décale le zéro vers le bas de la
 * course de la lunette, ce qui libère de la marge vers le haut — dans la limite de la course totale.
 */
export function usableElevation(travelMil: number, railMoa: number): number {
  return Math.min(travelMil, travelMil / 2 + railMoa * MOA_MIL);
}

/** Élévation accessible en contre-visée sous le centre du réticule (sapin gradué de src/weapons/scope.ts), mrad. */
export const RETICLE_HOLD_MIL = 24;
