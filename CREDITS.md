# Credits — PIGEON PERCHÉ

All third-party assets below are released under **CC0 1.0 Universal** (public domain dedication) — no attribution is legally required; it is given here with thanks.

| In-game asset | Original title | Source id | Author(s) | Source | Licence |
|---|---|---|---|---|---|
| Sky HDRI (sky_2k.hdr, sky_1k.hdr) | Table Mountain 1 (Pure Sky) | `table_mountain_1_puresky` | Greg Zaal, Jarod Guest | https://polyhaven.com/a/table_mountain_1_puresky | CC0 1.0 |
| Texture `grass` (tex/grass_*.jpg) | Forest Ground 01 | `forrest_ground_01` | Rob Tuytel | https://polyhaven.com/a/forrest_ground_01 | CC0 1.0 |
| Texture `rock` (tex/rock_*.jpg) | Marble Cliff 05 | `marble_cliff_05` | Amal Kumar | https://polyhaven.com/a/marble_cliff_05 | CC0 1.0 |
| Texture `scree` (tex/scree_*.jpg) | Rocks Ground 01 | `rocks_ground_01` | Rob Tuytel | https://polyhaven.com/a/rocks_ground_01 | CC0 1.0 |
| Texture `forest` (tex/forest_*.jpg) | Forest Leaves 02 | `forest_leaves_02` | Rob Tuytel | https://polyhaven.com/a/forest_leaves_02 | CC0 1.0 |
| Texture `dirt` (tex/dirt_*.jpg) | Rocky Trail 02 | `rocky_trail_02` | Amal Kumar | https://polyhaven.com/a/rocky_trail_02 | CC0 1.0 |
| Texture `wall` (tex/wall_*.jpg) | Castle Wall Slates | `castle_wall_slates` | Rob Tuytel | https://polyhaven.com/a/castle_wall_slates | CC0 1.0 |
| Texture `flag` (tex/flag_*.jpg) | Stone Tiles 02 | `stone_tiles_02` | Charlotte Baglioni | https://polyhaven.com/a/stone_tiles_02 | CC0 1.0 |
| Texture `bark` (tex/bark_*.jpg) | Pine Bark | `pine_bark` | Dimitrios Savva | https://polyhaven.com/a/pine_bark | CC0 1.0 |
| Texture `wood` (tex/wood_*.jpg) | Weathered Planks | `weathered_planks` | Dario Barresi, Dimitrios Savva | https://polyhaven.com/a/weathered_planks | CC0 1.0 |
| Texture `plaster` (tex/plaster_*.jpg) | White Plaster 02 | `white_plaster_02` | Rob Tuytel | https://polyhaven.com/a/white_plaster_02 | CC0 1.0 |
| Texture `roof` (tex/roof_*.jpg) | Clay Roof Tiles 02 | `clay_roof_tiles_02` | Amal Kumar | https://polyhaven.com/a/clay_roof_tiles_02 | CC0 1.0 |
| Texture `metal` (tex/metal_*.jpg) | Worn Corrugated Iron | `worn_corrugated_iron` | Jenelle van Heerden, Dimitrios Savva | https://polyhaven.com/a/worn_corrugated_iron | CC0 1.0 |
| Texture `fabric` (tex/fabric_*.jpg) | Hessian 380 | `hessian_380` | colormass, Rico Cilliers | https://polyhaven.com/a/hessian_380 | CC0 1.0 |
| Texture `moss` (tex/moss_*.jpg) | Moss 002 | `Moss002` | Lennart Demes (ambientCG) | https://ambientcg.com/a/Moss002 | CC0 1.0 |
| Model `rock_a.glb` | Rock Moss Set 02 | `rock_moss_set_02` | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_02 | CC0 1.0 |
| Model `rock_b.glb` | Rock Moss Set 01 | `rock_moss_set_01` | Kless Gyzen | https://polyhaven.com/a/rock_moss_set_01 | CC0 1.0 |
| Model `rock_c.glb` | Boulder 01 | `boulder_01` | Rico Cilliers | https://polyhaven.com/a/boulder_01 | CC0 1.0 |
| Model `rock_d.glb` | Namaqualand Boulder 05 | `namaqualand_boulder_05` | Jenelle van Heerden, Dario Barresi | https://polyhaven.com/a/namaqualand_boulder_05 | CC0 1.0 |
| Model `conifer.glb` | Fir Tree 01 | `fir_tree_01` | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fir_tree_01 | CC0 1.0 |
| Model `conifer_b.glb` | Pine Sapling Medium | `pine_sapling_medium` | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/pine_sapling_medium | CC0 1.0 |
| Model `broadleaf.glb` | Tree Small 02 | `tree_small_02` | Rico Cilliers | https://polyhaven.com/a/tree_small_02 | CC0 1.0 |
| Model `deadwood.glb` | Dead Tree Trunk | `dead_tree_trunk` | Rob Tuytel | https://polyhaven.com/a/dead_tree_trunk | CC0 1.0 |
| Model `shrub.glb` | Fern 02 | `fern_02` | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fern_02 | CC0 1.0 |
| Model `clump.glb` | Grass Medium 02 | `grass_medium_02` | Rico Cilliers | https://polyhaven.com/a/grass_medium_02 | CC0 1.0 |

Sources: [Poly Haven](https://polyhaven.com) (HDRI, textures, models) and [ambientCG](https://ambientcg.com) (moss texture).

Modifications: models were decimated and repacked as GLB with glTF-Transform; tree foliage was re-baked into alpha-tested branch cards; alpha maps were packed into base-colour PNGs; the moss AO/roughness maps were packed into one ARM texture. Machine-readable details: `public/assets/manifest.json`.

## Bibliothèques

| Bibliothèque | Usage | Licence |
|---|---|---|
| [three.js](https://threejs.org) 0.187 | moteur de rendu WebGL2, ombres en cascade (addon CSM), chargeurs HDR et glTF | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) 6.39 | chaîne d'effets (bloom, profondeur de champ, AgX) | Zlib |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.9 | lancers de rayons rapides (balles, lignes de visée, caméra) | MIT |
| Vite, TypeScript, Vitest, Playwright | outillage, tests | MIT / Apache-2.0 |

## Contenu créé pour le jeu

- **Sons** : synthétisés à l'exécution avec Web Audio (`src/audio/`), sauf huit courts enregistrements libres (attaque du coup de feu, culasse, douille), listés à la section « Sons enregistrés ». Le grave, la queue et les échos du tir, l'ambiance, les impacts et le chargeur sont synthétisés.
- **Relief** : généré par `tools/gen-terrain.mjs` (bruit, érosion hydraulique, sites).
- **Ruine, village, campement, pont, relais, mirador, personnages, carabines, herbe, lierre, fanions, eau** : géométrie et shaders procéduraux (`src/world/`, `src/player/`, `src/weapons/`).
- **Cartes « Lieux oubliés »** (La Fête foraine, Le Phare, Le Château d'eau) : aucun asset ajouté. Attractions de foire, terrasses et plates-formes, mer et houle, bouées, caboteur, canot, grue, convoi, signal, vannes, drone, lunette et horloge sont de la géométrie et des shaders procéduraux (`src/levels/fete|phare|plaine/`, `src/game/extra/`, `src/world/sea.ts`) ; les bâtiments viennent de la banque ci-dessous.
- **Arbres** : les modèles Poly Haven comptent plus de deux millions de triangles ; leur feuillage a été recuit en cartes alpha (`tools/assets/bake_cards.py`) et les troncs décimés avec glTF-Transform (`tools/assets/build-models.mjs`).

## Carte « Ville nouvelle » (`public/ville/`, `src/ville/`)

Relief, emprises et hauteurs des bâtiments, arbres, voirie, plans d'eau et photos aériennes proviennent de données publiques de l'[IGN](https://geoservices.ign.fr/) (LiDAR HD : modèles numériques de surface et de terrain à 1 m ; BD ORTHO à 20 cm ; BD TOPO), diffusées sous [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) (Etalab). Source : IGN. Les données ont été rééchantillonnées, simplifiées et recadrées pour le jeu, et la carte a été légèrement bombée.

Les perchoirs, enseignes, équipements de toiture et silhouettes sont de la géométrie procédurale créée pour le jeu. Les noms de rues, de lieux et d'enseignes sont cités en texte simple, sans logo, à titre descriptif : le jeu n'est ni affilié à leurs propriétaires ni approuvé par eux.

## Banque de bâtiments (`src/buildings/bank/`)

Les 21 bâtiments abandonnés et les 14 haltes routières de `src/buildings/bank/` viennent de la banque de bâtiments créée par l'auteur du jeu pour un autre de ses projets, « Watt Now? » (dossier `batiment/` : modules JavaScript procéduraux, géométrie à facettes, couleur par sommet, textures dessinées au canvas ; aucun fichier 3D ni image tiers). Copie du 2026-11-14, sans la visionneuse ni le dossier `vendor/` ; les modifications faites dans la copie sont marquées « PIGEON PERCHÉ » dans le code (import des utilitaires de géométrie depuis le paquet `three` du jeu, relevé des ouvertures dans `commun/atelier.js`). L'adaptateur `src/buildings/` (fusion par matière, niveaux de détail, collisions, points d'intérêt) est écrit pour ce jeu.

La banque ne dépend que de [three.js](https://threejs.org) (licence MIT), dont elle utilise `BufferGeometryUtils` (addon, MIT).

## Données balistiques

Vitesses initiales, coefficients balistiques et tables de tir : Lapua (Center-X, Scenar-L 136 gr et 175 gr, Scenar 185 gr et 250 gr, Subsonic B416) et Federal Premium (Gold Medal 77 gr SMK). Sources et tables complètes dans `tests/reference-tables.json`. Les noms d'armes et de munitions sont cités à titre descriptif ; le jeu n'est affilié à aucun fabricant.

## Carabines

Les sept carabines du jeu (`src/weapons/rifle-model.ts`, `rifle-parts.ts`, `rifle-mesh.ts`) sont modélisées entièrement en code, géométrie et matériaux, d'après des photos de référence des armes réelles consultées pendant le travail. Aucune de ces images n'est embarquée dans le jeu ni copiée dans `public/` ; aucun modèle 3D, aucune texture, aucun logo tiers n'est utilisé et aucun marquage de marque n'est reproduit sur les modèles.

Les noms « CZ 457 Varmint », « Tikka T3x Tac A1 », « Ruger Precision Rifle », « Sako TRG 42 » et « PGM 338 » sont cités à titre descriptif, pour désigner les armes réelles qui ont inspiré les modèles. Le jeu n'est ni affilié à leurs fabricants (Česká zbrojovka, Sako/Tikka, Sturm, Ruger & Co., PGM Précision) ni approuvé par eux ; ces noms et marques appartiennent à leurs propriétaires respectifs.

Liste des références visuelles consultées et cotes relevées : `native/tools/weapons-ref/SOURCES.md` et `native/CREDITS.md` (section carabines).

## Sons enregistrés (`public/assets/audio/`)

Huit extraits, tous sous **CC0 1.0** (domaine public ; attribution non requise, donnée ici par courtoisie). Ils sont recoupés et convertis par `tools/gen-shot-audio.py` (une voie, WAV PCM 16 bits, 0,15 à 0,64 s, 222 Ko au total). Si un fichier manque, le jeu synthétise le son correspondant.

| Fichier | Emploi | Titre d'origine | Auteur | Source | Licence |
|---|---|---|---|---|---|
| `shot-small.wav` | attaque du tir, petit calibre (.22 LR) | The Free Firearm Sound Library — Ruger Mark III (R_35P.wav) | Still North Media | https://opengameart.org/content/the-free-firearm-sound-library | CC0 1.0 |
| `shot-intermediate.wav` | attaque du tir, calibre intermédiaire (.223) | The Free Firearm Sound Library — AR-15 (D_32P.wav) | Still North Media | https://opengameart.org/content/the-free-firearm-sound-library | CC0 1.0 |
| `shot-medium.wav` | attaque du tir, calibres moyens (6 mm à .308) | The Free Firearm Sound Library — Tikka (W_29P.wav) | Still North Media | https://opengameart.org/content/the-free-firearm-sound-library | CC0 1.0 |
| `shot-magnum.wav` | attaque du tir, magnums et gros calibres (7 mm PRC à .50 BMG, abaissée selon la charge) | The Free Firearm Sound Library — 1917 (B_24P.wav) | Still North Media | https://opengameart.org/content/the-free-firearm-sound-library | CC0 1.0 |
| `shot-suppressed.wav` | attaque du tir avec modérateur (.308 subsonique) | Silenced Sniper Rifle.flac | qubodup | https://freesound.org/s/182815/ | CC0 1.0 |
| `bolt-open.wav` | culasse ouverte | Mosin Nagant Bolt Action Cycle | Zott820 | https://freesound.org/s/370345/ | CC0 1.0 |
| `bolt-close.wav` | culasse refermée | Mosin Nagant Bolt Action Cycle | Zott820 | https://freesound.org/s/370345/ | CC0 1.0 |
| `casing.wav` | douille qui touche le sol | Cartridge case 7.62mm on concrete #1 | Joseph Sardin (BigSoundBank.com) | https://bigsoundbank.com/s1367.html | CC0 1.0 |

Il n'existe pas d'enregistrement libre de .338 Lapua Magnum ni de .50 BMG dans cette banque : leur attaque est celle d'un .30-06, relue plus bas, et leur poids est synthétisé d'après la charge de poudre.

### Voix de la touche (`public/ville/voix/`)

Dix cris brefs joués au hasard dans le multijoueur « Ville nouvelle », quand un tireur est touché. Ils sont extraits du lot « Male Grunt/Yelling sounds » de **HaelDB** (quatre voix d'hommes), publié sur OpenGameArt sous **CC0 1.0** (domaine public ; attribution non requise, donnée ici par courtoisie) et sous OGA-BY 3.0 au choix : c'est la CC0 qui est retenue. Source : https://opengameart.org/content/male-gruntyelling-sounds. Les fichiers ont été convertis (une voie, 48 kHz, WAV PCM 16 bits), débarrassés de leurs silences et mis au même niveau ; 0,45 à 0,8 s, 600 Ko au total.

| Fichier | Fichier d'origine |
|---|---|
| `voix-01.wav` | 1yell15.wav |
| `voix-02.wav` | 3grunt3.wav |
| `voix-03.wav` | 1yell14.wav |
| `voix-04.wav` | yell12.wav |
| `voix-05.wav` | 2yell1.wav |
| `voix-06.wav` | 1yell11.wav |
| `voix-07.wav` | yell13.wav |
| `voix-08.wav` | 3grunt2.wav |
| `voix-09.wav` | 2yell9.wav |
| `voix-10.wav` | yell3.wav |

## Police du titre

| Fichier | Police | Auteur | Source | Licence |
|---|---|---|---|---|
| `public/assets/fonts/RockSalt.ttf` | Rock Salt | Font Diner | https://github.com/google/fonts/tree/main/apache/rocksalt | Apache 2.0 |
