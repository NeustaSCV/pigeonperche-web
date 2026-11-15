# Niveaux

Un niveau = un dossier `src/levels/<id>/` (`facile`, `standard`, `avance`) qui contient tout ce qui est propre à une
carte. Le moteur, le joueur, les types de cibles, le HUD et les constructeurs sont communs et lisent ces données.
Le registre (`index.ts`) reconnaît le dossier tout seul : **aucun fichier commun à modifier pour livrer une carte**.
Modèle à suivre : `standard/`. Types : `types.ts`.

## Conventions

- Mètres, Y vers le haut, nord = −Z, est = +X. Azimuts en degrés (0 = nord, sens horaire) ; `yaw` en radians.
- **Le site de tir est à l'origine (0, 0)**, sol à `site.baseY`. Le maillage du terrain, le relief de détail, l'herbe,
  les rochers et les ombres sont centrés dessus : plateau presque lisse jusqu'à 33 m, herbe jusqu'à 72 m, relief de
  détail jusqu'à 430 m. Les postes de tir sont à moins de ~45 m de l'origine.
- Textes et commentaires en français, identifiants en anglais. Aucune effusion de sang.
- Ne rien importer de `src/ballistics` ni de `src/buildings` dans un niveau.

## Fichiers à fournir

| Fichier | Rôle |
| --- | --- |
| `meta.ts` | `export const meta: LevelMeta` : titre, sous-titre, note du menu, préréglage d'aides, `ready`. Minuscule, sans import de code (seulement `import type`). Passer `ready: true` **à la livraison** : le bouton du menu devient cliquable (et `facile` devient le niveau par défaut). |
| `map.ts` | Données de carte, **sans import** et sans syntaxe TypeScript non effaçable (Node le charge tel quel pour le relief) : taille, sites, postes, lignes de visée, route, réglages. |
| `terrain.gen.mjs` | Générateur du relief (voir plus bas). |
| `index.ts` | `export const level: Level = { data, createScene }`. `data: LevelData` assemble `map.ts` ; `createScene()` renvoie une `LevelScene`. |
| le reste | Libre. `standard/` sépare `site.ts` (site praticable + `SiteNav`), `scenery.ts` (décor lointain), `targets.ts` (placement), `mission.ts` (objectifs). |

### `LevelData` (lu sans rien construire)

`terrain` (dossier, `size`, `res`, `waterLevel`, `pads`, `sculpt`, `clear`) · `render` (`cameraFar`, `shadowFar`, `haze`,
`treeRange`) · `sun` · `weapons` (ids de `src/config/weapons.ts`, un id inconnu est ignoré) + `startWeapon` ·
`difficulty` (`facile` → `assist`, `standard` → `standard`, `avance` → `real`) · `rangeLimit`, `dopeLimit` ·
`physics` (latitude, altitude, température, Coriolis… : **lue par le vol des balles, le carnet et l'impact prédit**,
voir « Ajouts d'intégration ») · `buildings` (`[{ id, carte?, x, z, yaw, usure?, … }]`, **posés par `buildings.ts`**,
voir « Ajouts d'intégration ») ·
`site` (`baseY`, `start`, `rack`) · `posts` · `sightlines` · `steps` + `stepPost` · `alertZone` / `alertLabel` ·
`failNote` · `tutorial` (ou `null`) · `testPlan`, `testWalk?`, `testTouch?`, `testViews?` (tests automatisés) ·
`wind?`, `atmosphere?`, `sky?`, `palette?`, `echo?` (voir « Corrections du socle »).

### `LevelScene` (construit, dans cet ordre)

1. `buildSite(h)` : murs, planchers, abri du râtelier ; pose ses collisions (`h.col`) ; renvoie son groupe et la
   `VegetationSpec` (emprises, dallages, passages à garder libres, arbres posés à la main, couloirs dégagés).
2. `buildScenery(h)` : décor lointain ; renvoie son groupe.
3. `buildTargets(h, fx)` : cibles déjà placées (le jeu les ajoute à la scène). Chaque `id` de `steps[].targets` doit exister.

Plus : `nav` (`allowed`, `surfaceAt`, `waypoint?` : zone praticable, sol, passages vers les postes), `menuCamera`,
`landmarks` (rumeur du `village`, cloche `bell`, sirène du `camp`, `lake` : **chaque repère est facultatif**, un repère
absent ou `null` ne produit aucun son ; l'ancienne astuce du repère placé très loin reste valable),
et en option `addEmitters`, `audioFrame`, `onImpact` (règle d'échec propre à la carte), `retry`, `testPrepare` /
`testReady`.

### Communs réutilisables

`game/targets.ts` (plaque, ballon, relais, projecteur, bidon, cadenas, drone, sentinelle, véhicule, marché) ·
`world/masonry.ts` (murs `WallDef`, dallages, lierre, **abri du râtelier** : le jeu pose les armes sur
`site.rack`) · `world/kit.ts` (maisons, toits, tentes, matières) · `world/water.ts` (lac, rivière) ·
`world/flags.ts` (fanions = indices de vent) · `world/vegetation.ts`, `world/terrain.ts` (paramétrés par le niveau).
Le tutoriel (`tutorial`) suppose deux cibles fixes, une plaque carrée proche puis une ronde plus loin, et le .22 LR en main.

## Relief

```
node tools/gen-terrain.mjs <id>          # ou : npm run gen:terrain -- <id>
```

écrit `public/terrain/<id>/{height.bin, splat.bin, meta.json}`. `terrain.gen.mjs` exporte `size`, `res` (les mêmes que
`data.terrain`) et `default function generate(lib, log)` qui renvoie `{ T, splat, meta: { siteHeights, road, river },
sites, sightlines, posts, baseY }`. `lib` = `tools/terrain-lib.mjs` : `createGrid`, bruits, `catmull`, `erode`,
`carveLake`, `carveRiver`, `flattenSites`, `carveRoad`, `carveWays`, `carveSightlines`, `paint`, `roundLine`. Sans route ni rivière :
`road: []`, `river: []`.

Taille : 6 144 m / 1 024 points pour `standard` (cibles à 1 251 m ; `cameraFar` 14 000, `shadowFar` 2 600, `haze` 1,
`treeRange` 2 600, `rangeLimit` 2 600, `dopeLimit` 1 600). Pour des tirs à 2 500 m : ~10 km de côté (le terrain est
dessiné jusqu'à 0,72 × le côté et le dôme du ciel est à 9 000 m : ne pas dépasser 12 km, garder `cameraFar` ≥ 14 000),
`rangeLimit` et `treeRange` au-delà de la cible la plus lointaine, `dopeLimit` à la portée voulue du carnet,
`haze` < 1 si la brume masque les cibles. 2 048 points coûtent 16 Mo par fichier : à éviter sur téléphone.
Budget : 60 i/s en 1440p sur M2, jamais sous 45 (`npm run e2e:perf`).

Le relief de `standard` est figé : `shasum -a 256 public/terrain/standard/height.bin` doit commencer par
`c17ec1beb40e847e` (refait une seconde fois le 2026-11-14 pour ses voies secondaires : 408 cellules changées, de
0,94 m au plus, toutes à moins de 20 m d'une voie ; voir « Voies, cours d'eau, terrain libre »). État précédent :
`d4ecf510…ff4c4e5e` (refait le 2026-11-14 pour terrasser ses quatre bâtiments ; avant : `6752bb98…c221352c`. 2 494 cellules sur 1 048 576
ont changé, de 6,4 m au plus, toutes à moins de 112 m du centre d'un lot ; partout ailleurs le relief est identique
au bit près, et la route, la rivière et les altitudes des sites de `meta.json` n'ont pas bougé.)

## Lignes de visée

Trois garde-fous, tous pilotés par `posts` et `sightlines` (`{ post, x, z, y }`, `y` au-dessus du sol de la cible) :

1. `lib.carveSightlines` rabote le relief sous chaque ligne (au-delà de 40 m du poste) ; le générateur affiche
   ensuite « lignes de visée : n sur n dégagées ».
2. Près du site (< 110 m), ce sont `terrain.clear` (cône devant un poste) et `terrain.sculpt` qui dégagent la vue.
3. La végétation ne plante aucun arbre sous une ligne, ni dans les `corridors` de la `VegetationSpec`.

Œil d'un poste : sol (`ground` ou `site.baseY`) + `y` (plancher) + 1,0 m accroupi ou 0,2 m couché.
Déclarer une ligne par couple poste → cible prévu par la mission, puis vérifier **en jeu**, murs et décor compris.

## Tests à lancer (serveur lancé, ou `HR_URL`)

```
npx tsc --noEmit && npm test && npm run build
npm run e2e:matrix -- --level <id>     # matrice poste × cible : chaque cible vue d'au moins un poste
npm run e2e:mission -- --level <id>    # tireur automatique selon data.testPlan : toutes les cibles neutralisées
npm run e2e:mission:portrait -- --level <id>
npm run e2e:walk -- --level <id>       # parcours à pied : départ → chaque poste par le guide, point de tir exact
npm run e2e:smoke -- --level <id>
npm run e2e:mobile -- --level <id>     # demande data.testTouch (sans data.tutorial : contrôles du tutoriel sautés)
npm run e2e:tutorial -- --level <id>   # demande data.testTouch et data.tutorial
npm run e2e:perf -- --level <id>       # cadence des vues de data.testViews (ou `depart` et `lunette` par défaut)
npm run e2e:integration -- --level <id>   # captures : bâtiments (œil nu, téléobjectif, lunette), râtelier, carnet
npm run e2e:physics -- --level <id>       # tir réel contre solveur, physique avancée forcée (1 000 et 2 000 m)
```

`HR_QUERY='phys=full&alt=1800'` ajoute des paramètres d'essai à l'URL de tous ces scripts (ex. jouer `e2e:mission`
avec la physique avancée).

Sans `--level`, tous restent sur `standard`. Un serveur de développement recharge la page à chaque fichier modifié :
pendant que d'autres écrivent, tester une copie figée
(`npx vite build --outDir .tmp/dist-x && npx vite preview --outDir .tmp/dist-x --port 5181`, puis `HR_URL=http://127.0.0.1:5181/`).
En jeu : `?level=<id>` charge un niveau, même en chantier (`ready: false`) ; `?d=assist|standard|real` force les aides.
Un niveau incohérent (cible d'objectif absente, poste inconnu…) refuse de démarrer et dit pourquoi.

## Ajouts d'intégration (2026-11-14)

Tout est rétrocompatible : champs facultatifs, valeurs par défaut = comportement d'avant. Rien à changer dans une
carte déjà écrite ; ce qui suit dit ce qu'elle peut maintenant demander.

### Physique du tir (`data.physics`) — branchée

Le vol réel des balles (`game/shots.ts`), le zérotage, le point d'impact prédit des modes assistés, le tireur
automatique des tests et le carnet de tir utilisent le même solveur (`ballistics/flight.ts`) dans l'environnement
du niveau. Les armes en G7 volent en G7 sur tous les niveaux.

- Tout à `false` : balistique d'origine (air du jeu uniforme). Le carnet garde sa table simple.
- Un seul de `coriolis`, `spinDrift`, `aeroJump`, `densityFromAltitude` à `true` : le carnet passe en **table
  décomposée** (chute, Coriolis vertical, dérive gyroscopique, Coriolis horizontal, vent de 5 m/s, saut aérodynamique,
  temps de vol, Mach, passage transsonique), calculée pour l'azimut de tir courant ; au-delà de la course de tourelle
  il indique la part à prendre en contre-visée.
- `densityFromAltitude` lit `altitudeM` et `temperatureC` (air plus léger en altitude : moins de chute à longue
  distance). Champs facultatifs ajoutés : `pressureHPa`, `humidityPct`, `powderTempSens` (m/s par °C d'écart à 15 °C).
- Le zérotage reste fait dans l'air du jeu (zéro « d'usine ») : avec `densityFromAltitude`, l'élévation au zéro
  n'est donc pas exactement 0,0 — c'est voulu, le carnet l'affiche.
- Portée : une balle vit 14 s ; les aides prévoient `rangeLimit / 420` s de vol (4,5 s au moins, 11 s au plus).
- Essais sans toucher au niveau, **en mode test seulement** (`?test`) : `?phys=full` (ou une liste parmi
  `coriolis,spin,jump,air`, ou `none`), avec `?lat=`, `?alt=`, `?temp=` ; `?arsenal=id,id,…` remplace les armes du
  râtelier ; `?dope=<m>` la portée du carnet. Sans `?test`, ces paramètres sont ignorés.
- Preuve : `tests/shots.test.ts` (tir réel du jeu contre `firingSolution` à 1 000 et 2 000 m, armes G7 et ELR, écart
  < 0,05 mrad) et `npm run e2e:physics` (même contrôle dans le jeu, par le tireur automatique).

### Arsenal (`data.weapons`)

Douze armes au plus (`RACK_MAX`) ; au-delà les dernières sont écartées avec un avertissement dans la console : c'est
au niveau de choisir. Jusqu'à huit, le râtelier et la liste sont ceux d'avant ; de neuf à douze, les armes se serrent
sur le râtelier (pivotées, lunette vers la cour) et la liste se resserre. Clavier : `1`–`9`, `0` pour la dixième, les
deux touches à droite du `0` pour la onzième et la douzième, ou `↑` `↓`. `weaponsOfTier('standard', 'elr')` de
`src/config/weapons.ts` donne les ids d'une famille (`.map((w) => w.id)`), mais `map.ts` ne peut rien importer :
y écrire la liste des ids.

### Bâtiments (`data.buildings`)

```ts
{ id, carte?, x, z, yaw, usure?,          // inchangé ; yaw en radians, à 0 la façade principale (sud) regarde +z
  name?,                                  // pour le retrouver : h.buildings.get(name) (défaut : id)
  groundY?,                               // altitude de son y = 0 (défaut : celle du terrassement)
  ground?: 'paved' | 'keep' | 'none',     // sol du lot (défaut : 'keep' si le modèle fournit son sol, sinon 'paved')
  lod?: 'auto' | 'full' | 'far', glassStops?, walkable?, show?, hide? }
```

- **Catalogue sans dépendance** : `src/levels/building-lots.ts` (ids, cartes, taille de lot, sol fourni, creusement ;
  `lotOf`, `lotDistance(spot, x, z)`, `lotCorners`). Un niveau peut l'importer (c'est `src/buildings` qu'il ne doit
  pas importer). La sélection commentée (quel bâtiment pour quel usage) est dans `src/buildings/selection.ts`.
- **Terrasser le relief** dans `terrain.gen.mjs`, après la route et les sites, avant `carveSightlines` et `paint` :

  ```js
  const buildings = lib.flattenBuildings(T, W.BUILDINGS, {           // lot à plat + bande de 20 m + raccord de 36 m
    keep: (k) => ss(RW / 2 + 2, RW / 2 + 12, riverD[k]) * ss(5, 15, roadD[k]),   // ne comble ni la rivière ni la route
  });
  …
  const splat = lib.paint(T, { …, forestExtra: lib.buildingClearing(W.BUILDINGS) });   // pas d'arbres dans les lots
  const cut = lib.checkBuildingSightlines(T, buildings, W.SIGHTLINES, W.POSTS, baseY); // doit être vide
  return { T, splat, meta: { siteHeights, road, river, buildings }, … };               // meta.buildings : altitudes
  ```

  Le jeu pose chaque bâtiment à l'altitude écrite dans `meta.json` (`buildings`). Sans terrassement il est posé sur
  le relief en place, avec un avertissement. Loin du site le terrain a des mailles de 12 à 20 m : sur un versant, un lot
  de 60 m demande un replat (compter `(lot + 40 m) × pente` de déblai). Un modèle creusé qui fournit son sol (moulin,
  château d'eau : `own`, `dug` dans le catalogue) reçoit une fosse sous son lot.
- **Écarter le décor du lot** : `lotDistance(spot, x, z) < marge` dans `scenery.ts` (maisons, meules…).
- **Collisions** : les bâtiments arrêtent les balles et coupent les lignes de visée (`e2e:matrix` les voit). Les
  vitres laissent passer les balles sauf `glassStops`.
- **Cibles accrochées** : dans `buildTargets(h, fx)`, `h.buildings?.get('eglise')` renvoie un `BuildingHandle` :
  `points('gallery', 'roof', 'window'…)` (points d'intérêt dans le monde : `position`, `stand` où poser les pieds,
  `bearing` vers l'extérieur ; les points relevés à la main viennent en premier), `toWorld(x, y, z)` (repère local →
  monde), `groundY`, `height`. `h.buildings` n'existe pas encore dans `buildSite` ni `buildScenery`.
- Niveau de détail complet / lointain automatique (distance apparente, grossissement compris), atlas réduit sur
  téléphone, mémoire rendue au changement de niveau : rien à faire côté carte.
- Coût mesuré : voir `e2e/out/buildings/resultats.md` (un bâtiment complet : 1 à 2 appels, 30 à 60 k triangles, plus
  les ombres ; lointain : 1 appel, 7 à 20 k).

### Ambiance et textes

- `landmarks()` : `{ village?, bell?, camp?, lake? }`, tous facultatifs. Pas de `village` : pas de rumeur de marché.
  `bell` absent : la cloche sonne au village s'il y en a un ; `bell: null` : pas de cloche ; `bell: [x, y, z]` : cloche
  à cet endroit (un clocher sans village). Pas de `camp` : pas de sirène. `landmarks()` est appelé après la pose des
  bâtiments (on peut y lire `h.buildings` gardé depuis `buildTargets`).
- `data.alertTexts?: { raised?, raisedSub?, endRaised?, endQuiet? }` : phrases de l'alerte (message quand la jauge est
  pleine, ligne « Discrétion » du bilan). Par défaut : « L’alerte est donnée », « L’alerte a été donnée. », « Aucune
  alerte donnée ». `alertLabel` reste le libellé de la jauge ; `alertZone: null` supprime jauge, sirène et ligne du bilan.

## Corrections du socle (2026-11-14)

Tout est rétrocompatible : champs facultatifs, défaut = comportement d'avant. Le niveau `standard` ne déclare que son
vent (aux valeurs d'origine) et ses vues de mesure : son aspect, son relief (`d4ecf510…`) et ses appels de dessin au
menu (565 / 394 / 250 / 485 en moyenne sur les quatre plans) sont inchangés.

### Profondeur à grande distance : plan proche adaptatif en lunette

Le tampon de profondeur sépare environ `d² / (proche × 2²⁴)` : avec un plan proche à 0,55 m, 0,7 m à 2 500 m — les
mâts, les plaques et les façades lointaines scintillaient. En lunette, le jeu repousse maintenant le plan proche à
`1,6 m × grossissement` (40 m au plus : 1 cm à 2 500 m à ×25), **sans jamais dépasser 0,6 fois la distance du premier
obstacle du champ** (`Game.scopeNear`, réévalué huit fois par seconde sur un cône élargi) : sol et herbe, tout ce qui
est dans les collisions (`h.col`, objets minces compris), cibles, arbres, rochers, touffes, râtelier, lierre. Rien de
visible n'est coupé ; seules les arêtes d'ombre bougent d'un texel (la première cascade suit le plan proche).
La profondeur inversée (EXT_clip_control) et la profondeur logarithmique ont été écartées : la première n'existe pas
partout et demandait de reprendre chaque effet qui lit la profondeur ; la seconde coûte l'élimination précoce des
fragments, sur téléphone surtout. À l'œil nu rien ne change (0,2 m).

Ce qu'une carte doit savoir :
- un objet **visible, proche du site et absent des collisions** (fanion, manche à air, décor non solide) doit être
  déclaré, sinon la lunette peut voir à travers quand on le vise de près : `h.col.soft.push({ x, y, z, r })` (sphère
  englobante) ou `LevelScene.viewObstacles()`. Le lierre de `Masonry.ivy(engine, wind, col)` le fait seul si on lui
  passe `col` ;
- deux surfaces presque confondues (pastille peinte sur une plaque) gardent leur `polygonOffset` : à ×5 la résolution
  à 2 500 m est encore de 5 cm, et de 1,9 m à l'œil nu ;
- `?near=fixed` rend le plan proche d'origine (diagnostic).

### Atmosphère, vent, ciel (`data.atmosphere`, `data.wind`, `data.sky`)

```ts
atmosphere?: { valleyY?, mistBase?, mistTop?, mist? }   // défaut : 0, 4, 110, 1
wind?: { fromBearing, speed, gusts?, steps?: { [idObjectif]: { speed?, fromBearing? } }, shelter?, shelterHeight? }
sky?: { clear?, exposure?, sunIntensity?, cloudShadow?, warmth? }
```

- `atmosphere.valleyY` : altitude du fond de vallée. Le voile d'altitude, la brume basse, la nappe de brume
  (`mistBase` à `mistTop` au-dessus), l'abri du vent, la teinte d'altitude de l'herbe et l'étage des feuillus se
  comptaient en altitude absolue (carte d'origine : fond à 0) ; ils se comptent maintenant à partir d'elle. Une carte
  en altitude (plaine à 590 m) doit le donner, sinon elle n'a ni brume de fond ni abri du vent. `render.haze` reste le
  réglage général : le baisser si la cible la plus lointaine se voile.
- `wind` : vent de la carte dès la première image (plus besoin d'écrire `h.wind.baseSpeed` dans `buildSite`, ni les
  champs privés du lissage). `gusts` : amplitude des rafales (1 = de 0,5 à 1,5 fois la moyenne). `steps` : vent propre
  à un objectif, installé en une dizaine de secondes. `shelter` / `shelterHeight` : part du vent qui reste au fond de la
  vallée (0,62) et hauteur où il est plein (200 m) — le vol des balles lit ce vent, plus faible en bas.
- `sky` : `clear` fond la photographie du ciel (la seule de `public/assets/sky`) dans un ciel dégagé calculé, de 0 à 1 ;
  le disque du soleil reste celui de la photographie. `cloudShadow` atténue les ombres de nuages sur le décor,
  `warmth` le doré du soleil, `exposure` le gain du ciel et de la lumière ambiante. Pas d'autre ciel photographié sans
  nouveau fichier.

Réglages livrés : `avance` — fond à 590 m, nappe de 2 à 60 m (densité 0,55), `haze` 0,62, vent 4 m/s du 290° abrité à
62 % dans la plaine, ciel dégagé à 0,8 ; `facile` — vent 1,2 m/s du 265° (2,6 m/s aux deux derniers objectifs), ciel
dégagé à 0,85 ; `standard` — vent d'origine déclaré (3,5 m/s du 255°).

### Écho du tir (`data.echo`)

```ts
echo?: {
  reliefs: { distance, bearing, size }[],   // reliefs qui renvoient la détonation, vus du site de tir (six au plus)
  tail?,                                     // queue diffuse : 1 vallée, 0,5 terrain ouvert, 1,3 cirque fermé (défaut 1)
}
```

Chaque relief donne un écho : `distance` en mètres (le retour arrive après 2 × distance / 343 s, plus sourd et plus
faible avec la distance : −9 dB par doublement), `bearing` son azimut vu du site (0 = nord, sens horaire ; l'écho
reste de ce côté-là quand le joueur tourne la tête), `size` sa taille apparente (0,2 une lisière ou une butte,
0,5 un versant, 1 une paroi ou un grand versant proche). Repère de niveau : un versant de taille 0,6 à 230 m revient
27 dB sous la détonation. Facultatif : sans ce champ, une vallée moyenne (`DEFAULT_ECHO` dans
`src/audio/shot-params.ts`). Un plateau ou une plaine déclare peu de reliefs, petits et lointains, et `tail` vers 0,5.
Pour relever les reliefs d'une carte : chercher autour du site, sur la carte de hauteur, les pentes tournées vers lui.

### Palette et végétation (`data.palette`, `VegetationSpec.trees / rocks / clumps`)

```ts
palette?: { grass?, rock?, scree?, forest?, dirt?, moss?,        // teintes RVB linéaires multipliées aux matières du relief
            dryness?, mossAmount?,                               // taches d'herbe sèche (−0,5 à +0,5), mousse (0 à 1)
            blades?: { tint?, density?, height?, flowers?, chunk? },   // brins d'herbe ; chunk : côté des pavés (12 m)
            foliage?, understory?, rocks? }                      // arbres (ceux des bâtiments compris), touffes, rochers
```

Dans la `VegetationSpec` rendue par `buildSite` : `nearTrees[].sp` accepte `2` (feuillu détaillé) ; `trees: { nearMix,
nearCount, density, broadleaf }` règle les essences tirées au hasard près du site, le nombre d'arbres détaillés, la
densité des forêts et la part de feuillus de l'étage bas ; `rocks: { count, near, radius }` les rochers semés d'office
(300, dont 26 à moins de 30 m, jusqu'à 180 m — `count: 0` pour aucun) ; `clumps` les touffes (60).
Les arbres propres aux modèles de bâtiments (verts vifs, mélèzes dorés) sont désaturés et teintés comme ceux du jeu,
puis multipliés par `palette.foliage`.

`avance` : pays sec (herbe rase jaunie en pavés de 12 m, calcaire clair, terre) ; `facile` : feuillus autour de la
cour, 30 rochers au lieu de 300.

### Relief

- `lib.carveSightlines(T, lines, posts, baseY, { smooth, reach, protect })` : rabotage adouci (`smooth` passes de
  lissage sur les cellules rabotées et `reach` cellules autour ; jamais au-dessus du plafond des couloirs ;
  `protect(x, z)` → 0 sur les terrasses à garder). Sans le cinquième argument : rabotage d'origine. `avance` :
  `{ smooth: 10, reach: 5 }`, relief régénéré (2 465 cellules changées, 11 lignes sur 11 dégagées, altitudes des sites
  et des bâtiments inchangées).
- `terrain.clear[]` : `drop`, `dropLen` (ressaut au pied du tireur, défaut 0,58 sur 6 m) et `soft` (rayon de raccord,
  défaut 0 = arête vive). `facile` : `soft: 1,4` sur ses quatre cônes.

### Lunette, carnet, essais

- HUD de lunette : ligne « Contre-visée » sous l'élévation — `+ x,x mrad` quand la distance mesurée demande plus que
  la course de tourelle, `butée` quand la tourelle est au bout de sa course (au doigt : rappel à côté de la valeur).
- Carnet avancé en portrait : le titre passe sur deux lignes au lieu d'être tronqué.
- `?phys`, `?lat`, `?alt`, `?temp`, `?arsenal`, `?dope` n'agissent qu'avec `?test`.

### Son

- Nature d'impact `bell` (cloche, timbre d'horloge) : `onHit` peut renvoyer `{ kind: 'bell' }`.

### Tests

- `data.testViews` : vues nommées lues par `e2e/perf.mjs` (`{ at, pitch? }` à l'œil nu, `{ at, scope: { weapon, zoom,
  target } }` en lunette, tourelle réglée). Sans ce champ : `depart` et `lunette` (dernier objectif du plan).
- `game.testDial(id)` règle les tourelles pour la cible (contre-visée au-delà de la course) : `e2e/mission.mjs
  --shots` s'en sert, la cible reste dans le champ au-delà de 1 500 m.
- `data.testTouch` : `weapon` (arme des mesures optiques), `rackWalk` (points de passage du poste au râtelier),
  `postKey` et `near` (poste et cible proche d'un niveau sans tutoriel). `e2e/mobile.mjs` tourne sans `data.tutorial`
  (contrôles du tutoriel sautés) ; `e2e/tutorial.mjs` lit le poste dans `data.tutorial.post` et la touche du .223 dans
  l'ordre du râtelier.
- `Sentinel.predict` déroule le vrai va-et-vient de la sentinelle (marche, demi-tour, pause) au lieu d'une ligne
  droite plafonnée à 1,5 s : le tireur automatique ne dépend plus de l'instant du tir pour la toucher à 1 250 m.
- Points d'intérêt : le « toit à 33 m » du siège de la Compagnie est annoté (masqué par son parapet pour un tireur
  plus haut) ; la dalle de l'édicule, visible de partout, passe en tête.

## Voies, cours d'eau, terrain libre (2026-11-14)

Tout est rétrocompatible : champs facultatifs, défaut = comportement d'avant (une carte sans `WAYS` se régénère à
l'identique, au bit près).

### Voies secondaires (`WAYS` dans `map.ts`, `data.ways`)

Chaque bâtiment doit être relié au réseau de la carte. Le socle ne traçait qu'une route (`ROAD`, `lib.carveRoad`) ;
les autres voies se déclarent maintenant dans `map.ts` :

```ts
export const WAYS = [
  { name: 'chemin du moulin', kind: 'chemin', width: 3, to: 'moulin',       // to : BuildingSpot.name (ou id)
    pts: [[62, -484], …, [-133, -209]],                                      // du raccord au réseau à l'entrée desservie
    maxSlope?: 0.12,                                                         // si différente de celle de la nature
    bridges?: [{ x, z, deck, length, kind?: 'pierre' | 'bois' | 'beton', width? }] },
];
```

| nature | emploi | pente max | raccord au relief | matière |
| --- | --- | --- | --- | --- |
| `route` | rue, route industrielle | 10 % | 12 m | terre battue |
| `chemin` | chemin de terre (moulin, château d'eau, sanatorium) | 14 % | 7 m | terre battue, un peu moins marquée |
| `allee` | allée d'un château | 10 % | 8 m | gravier (canal des éboulis) |

- **Générateur**, après la route, les sites et `flattenBuildings`, avant `carveSightlines` et `paint` :

  ```js
  const net = lib.carveWays(T, W.WAYS.map((w) => ({ ...w, endY: w.to ? solDe(w.to) : undefined })), {
    skip: (k) => riverD[k] < RW / 2 + 3 || dansUnLot(k),          // ni dans le lit de la rivière, ni dans un lot
  });
  const splat = lib.paint(T, { …, wayEdge: net.edge, wayDirt: net.dirt, wayGravel: net.gravel });
  return { …, meta: { …, riverWidth: W.RIVER_WIDTH, ways: net.ways } };
  ```

  Pour chaque voie : tracé lissé et rééchantillonné tous les 4 m, profil en long tenu aux deux bouts (le réseau au
  départ, le sol du bâtiment à l'arrivée), adouci puis ramené sous la pente maximale (déblai et remblai), tablier
  imposé aux ponts ; plate-forme nivelée, ni arbres ni haie à moins de 2,5 m, chaussée peinte dans la carte de
  matières (jamais plus étroite qu'une maille : sinon elle se lit en pointillé). Aucune géométrie ajoutée, aucun appel
  de dessin. Une voie branchée sur une autre vient après elle dans la liste.
- `tools/gen-terrain.mjs` affiche pour chaque voie longueur, pente maximale (sur 12 m), plus grand déblai et remblai,
  et le nombre de cellules changées par rapport au relief en place (`--diff <dossier>` pour une autre référence).
  Un déblai de plus de 5 m dit que le tracé coupe une bosse : le reprendre (lacet plus large, courbe de niveau).
- **Décor** : `nearWay(terrain.meta.ways, x, z, marge)` (`src/world/ways.ts`) écarte maisons, hangars et meules de la
  chaussée ; `buildWayBridges(kit, terrain)` pose les ponts dans le Kit du décor (pas d'appel de dessin de plus).
- `meta.json` : `ways: [{ name, kind, width, to?, line: [[x, z, y]…], bridges?, length, maxSlope, cut, fill }]`.

### Cours d'eau

- `meta.riverWidth` (écrit par le générateur) : avec lui, une balle qui tombe dans le lit de `meta.river` fait une
  gerbe (`terrain.waterSurfaceAt`), comme dans un lac (`terrain.waterLevel`). Les trois cartes le déclarent.
- `buildWater(…, { river: { points, width, drape: (x, z) => terrain.meshHeightAt(x, z) } })` : ruban **drapé**. Loin
  du site le maillage dessiné du relief a des mailles de 10 à 45 m, plus larges que le lit : sans `drape`, l'eau
  n'apparaît que par plaques. Avec, le ruban est découpé tous les 6 m et posé sur le maillage là où il dépasse le
  niveau de l'eau. `avance` l'utilise (rivière à 2 600 m) ; `facile` et `standard` gardent le ruban d'origine.
- Une rivière vue de haut et de loin doit avoir des abords en pente douce : derrière une berge plus raide que l'angle
  de vue (7° depuis le Rebord, soit 12 %), l'eau est cachée. `avance` taille un lit majeur à 7 %.

### Terrain libre autour du site (`src/world/roam.ts`, `SiteNav.limit`)

Le joueur n'est plus arrêté par une limite invisible en terrain dégagé. Chaque site garde son **cœur** dessiné à la
main (cour, dalles, brèches, postes) et y ajoute le **terrain libre** :

```ts
roam = makeRoam(h.terrain, baseY, { radius: 64, maxSlope?: 0.45, drop?: 9 }, core, depart);
buildRoamFence(boisDuSite, h.terrain, h.col, roam);            // clôture, seulement là où rien de naturel n'arrête
const allowed = (x, z) => roam.allowed(x, z) || (core(x, z) && !roam.cliff(x, z));
export const nav: SiteNav = { allowed, limit: (x, z) => roam?.limit(x, z) ?? null, … };
```

- praticable : à moins de `radius` de l'origine, pente ≤ `maxSlope` (le rebord d'une corniche, d'un coteau : on
  s'arrête là où la pente casse, sans glisser ni tomber), au plus `drop` mètres sous le site, et **joignable à pied**
  depuis le cœur (un replat isolé derrière le ressaut d'un cône de vue ne l'est pas) ;
- les murs, rochers et troncs restent des collisions (`h.col.segs`) : ce sont eux qui arrêtent, pas la zone. Tout
  décor solide proche du site doit y entrer (les maisons de `world/kit.ts` n'ont pas de collision de marche :
  `facile` ajoute celles de la ferme, `avance` la conduite forcée) ;
- là où le cercle traverse un terrain encore praticable (plateau derrière le site), `buildRoamFence` pose une clôture
  (piquets, trois fils, collision) dans le maillage de bois du site — aucun appel de dessin de plus ;
- `SiteNav.limit(x, z)` dit pourquoi un point est interdit (`'pente'`, `'cloture'`) : le jeu affiche un message
  discret quand on insiste plus d'une demi-seconde contre la limite (au plus toutes les huit secondes).
- Tests : `e2e/walk.mjs` (partie 1 bis : huit caps depuis le départ et chaque poste, arrêt sur obstacle ou rebord,
  pas de chute) ; `node e2e/zone.mjs --level <id> [--bord <cap>]` dessine la zone et la nature de sa limite
  (`e2e/out/routes/<id>-zone.png`), et échoue s'il reste plus de 1 % de limite invisible.
  Totaux : `facile` 21/21, `standard` 89/89, `avance` 17/17.
- `node e2e/routes.mjs --level <id>` : captures de chaque bâtiment avec sa voie (vue plongeante, arrivée, lunette),
  des cours d'eau et des ponts, dans `e2e/out/routes/`.
