// Contrôleur du mode en ligne (contrat dans ./types.ts) : la manche de la Ville nouvelle jouée dans le moteur du solo.
// Il tient ensemble la session (protocole de la manche), le salon, le tableau, les autres tireurs (cibles du jeu),
// les effets, les sons et l'affichage propre au mode. Le jeu l'appelle à une dizaine de points ; lui ne touche au jeu
// que par `OnlineHost`.
//
//   index.html?level=ville               le salon, puis la manche
//   …&pseudo=Anna&auto                   rejoint sans clic (contrôles automatisés) ; `auto=spectateur` : en spectateur
//   …&poste=6                            visite sans réseau ni salon : seul sur l'emplacement n° 6, face aux silhouettes
//
// Règles d'affichage : src/online/hud.ts. À l'œil nu, la vue est à la première personne, l'arme tenue devant soi.
import { Group, Mesh, MeshStandardMaterial, Vector3, type PerspectiveCamera } from 'three';
import { GAME_AIR, firingSolution, splitElevation } from '../ballistics';
import { CLICK_MIL, SIGHT_HEIGHT, type WeaponDef } from '../config/weapons';
import { showError } from '../core/diag';
import type { Engine } from '../core/engine';
import type { Bullet, ImpactReport } from '../game/shots';
import { BASE_Y, DEFAULT_POSTE } from '../levels/ville/map';
import { Silhouette } from '../levels/ville/targets';
import type { VilleTerrain } from '../levels/ville/terrain';
import type { HudState } from '../ui/hud';
import type { TouchFrame } from '../ui/touch';
import { rifleBlueprint } from '../weapons/rifle-model';
import { OnlineEffects } from './effects';
import { OnlineHud, TURRET_HELP, correctionText, type HudView } from './hud';
import { Praise } from '../ui/praise';
import { CityAmbience } from './ambience';
import { Lobby, loadPlan, type PlanCarte } from './lobby';
import { EYE_Y, RemoteShooter, ShooterCrowd, zoneOnLine } from './remote-shooter';
import { Scoreboard } from './scoreboard';
import { Session, browserTransport, fr, nom, type MsgDiversion, type MsgTir, type MsgTouche, type MsgVise } from './session';
import { OnlineSounds } from './sounds';
import type { OnlineHost, OnlineMode } from './types';

/** Un emplacement, tel que le jeu le joue : œil du tireur debout (courbure de la carte cuite), cap vers le centre. */
export interface Place { n: number; nom: string; eye: Vector3; yaw: number }

/** course de la tourelle de dérive, de part et d'autre du zéro, mrad (celle de l'arme du solo) */
const WIND_MAX = 10;
/** délai entre deux diversions d'un même joueur, en secondes : celui du serveur (DIVERSION_MS, server/manche.mjs) */
const DIVERSION_WAIT = 10;
/**
 * Téléphone en portrait : hauteur réservée au-dessus du champ de la lunette (bloc de l'observateur à gauche ; tableau
 * replié puis bouton Pause à droite), et hauteur en plus sous lui (une ligne d'explication par tourelle), px CSS.
 */
const TOUCH_TOP = 100, TOUCH_BELOW = 30;
/** tactile : la ligne d'explication de chaque tourelle (les deux lignes de l'encart, mises bout à bout) */
const TOUCH_HELP = { elev: `${TURRET_HELP.elev[0]} · ${TURRET_HELP.elev[1].toLowerCase()}`, wind: `${TURRET_HELP.wind[0]} · ${TURRET_HELP.wind[1].toLowerCase()}` };
/** écart angulaire sous lequel un tireur est « dans la lunette » (rad), et pour « régler sur la cible » */
const HELD = 0.03, HELD_WIDE = 0.06;

/**
 * La carabine vue à la première personne : le modèle du solo (src/weapons/rifle-model.ts), attaché à la caméra. Sa
 * profondeur est écrasée tout contre le plan proche : elle ne traverse ni le garde-corps ni le plan de coupe, et
 * passe devant tout le décor.
 */
function eyeRifle(engine: Engine, def: WeaponDef): Group {
  const mat = engine.setupMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }), (sh: { vertexShader: string }) => {
    // profondeur d'une projection de 3 cm à 8 m, ramenée dans le premier centième de la plage : l'ordre des faces de
    // l'arme est gardé, et rien du décor ne passe devant
    const n = 0.03, f = 8, A = (f + n) / (f - n), B = (-2 * f * n) / (f - n);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\ngl_Position.z = 0.01 * (${A.toFixed(6)} * gl_Position.w + (${B.toFixed(6)})) - 0.99 * gl_Position.w;`);
  }, 'ol-arme');
  const mesh = new Mesh(rifleBlueprint(def, 1).merged, mat);
  mesh.rotation.y = Math.PI;                         // le modèle a le canon vers +Z ; la caméra regarde vers −Z
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const g = new Group();
  g.add(mesh);
  // tenue basse, à droite : la détente (origine du modèle) à 17 cm à droite, 21 cm sous l'œil, 40 cm devant
  g.position.set(0.17, -0.21, -0.4);
  g.rotation.set(0.035, 0.075, -0.045);
  g.visible = false;
  return g;
}

class Mode implements OnlineMode {
  readonly session: Session;
  /** les autres tireurs de la salle, par identifiant */
  readonly shooters = new Map<number, RemoteShooter>();
  /** emplacements de la carte, par nom (vide tant que la carte n'est pas chargée) */
  readonly places = new Map<string, Place>();
  /** emplacement occupé ('' : aucun) */
  place = '';
  /** abattu : en attente du retour */
  down = false;
  panel: OnlineHud | null = null;
  /** annonce d'une touche réussie : le bandeau doré du solo */
  private notice: Praise | null = null;
  lobby: Lobby | null = null;
  board: Scoreboard | null = null;
  sounds: OnlineSounds;
  /** rumeur de ville, et au plus un klaxon et une sirène au loin par manche */
  ambience: CityAmbience;
  fx: OnlineEffects | null = null;
  /** nombre de diversions entendues (contrôles automatisés) */
  diversions = 0;

  private readonly params = new URLSearchParams(location.search);
  /** visite sans réseau : numéro de l'emplacement demandé par `?poste=N`, sinon null */
  private readonly visit: number | null;
  private crowd: ShooterCrowd | null = null;
  private rifle: Group | null = null;
  private mapReady = false;
  private wantRound = false;
  private lastTop = 0;
  /** instant de notre dernière diversion acceptée par le serveur (performance.now()) */
  private divertAt = -1e9;
  private aimT = 0;
  private pressed: { code: string; until: number } | null = null;
  private held: RemoteShooter | null = null;
  private readonly view: HudView = { shown: false, scope: false, list: false, life: null, observer: null, elev: 0, wind: 0, elevMax: 0, windMax: WIND_MAX, pressed: null, labels: [], fieldLeft: 0, w: 0, h: 0 };
  private readonly solutions = new Map<string, { range: number; elev: number; dial: number; hold: number; wind: number } | null>();
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private right = new Vector3();

  constructor(private host: OnlineHost) {
    const asked = this.params.has('poste') ? Number(this.params.get('poste')) : NaN;
    this.visit = this.params.has('poste') ? (Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_POSTE) : null;
    this.session = new Session(browserTransport());
    this.sounds = new OnlineSounds(host.audio);
    this.ambience = new CityAmbience(host.audio);
  }

  // ------------------------------------------------------------------ démarrage
  async init(): Promise<void> {
    const h = this.host, s = this.session, root = document.getElementById('ui') ?? document.body;
    h.ui.setOnline();
    // Maj + flèche : 1 mrad sur les deux tourelles
    h.scope.coarseBoth = !!h.data.online?.coarseBothTurrets;
    // tactile : le champ de la lunette se cale sous la place réservée (`scopeInset`, `scopeBelow`)
    if (h.touch) h.engine.updateView();
    void this.sounds.load();
    void this.ambience.load();
    const loaded = h.loadMap().then(() => this.onMap());
    if (this.visit !== null) {
      // visite : pas de salon, la carte d'abord
      await loaded;
      this.goTo([...this.places.values()].find((p) => p.n === this.visit)?.nom ?? '');
      h.setState('play');
      return;
    }
    loaded.catch((e) => { console.error(e); showError('Erreur de chargement', String((e as Error)?.stack || e)); });
    this.panel = new OnlineHud(root, { touch: h.touch, onPlace: (n) => this.goTo(n) });
    this.board = new Scoreboard(root, s, { touch: h.touch, menuHref: './index.html' });
    this.lobby = new Lobby(root, s, { touch: h.touch, pseudo: this.params.get('pseudo') ?? undefined, menuHref: './index.html' });
    // le plan du salon sans attendre la carte ; elle le redessinera avec ses emplacements à leur place définitive
    void loadPlan(import.meta.env.BASE_URL + 'ville/').then((p) => { if (!this.mapReady) this.lobby?.setPlan(p.carte, p.emplacements); }).catch(() => {});

    s.on('bienvenue', (m) => { this.syncShooters(); if (m.spectateur) this.panel?.setPlaces([...this.places.values()], this.place); if (s.phase === 'jeu') { this.ambience.newRound(s.remaining()); this.enterRound(); } });
    s.on('debut', () => {
      this.ambience.newRound(s.remaining());
      // le top de départ, puis les trois notes
      if (s.role) { this.sounds.countdown(true); setTimeout(() => this.sounds.roundStart(), 600); }
      this.syncShooters(); this.enterRound();
    });
    s.on('fin', () => { if (s.role) this.sounds.roundEnd(); this.ambience.endRound(); this.toLobby(); });
    for (const k of ['perdu', 'complet', 'vide'] as const) s.on(k, () => { this.ambience.endRound(); this.toLobby(); this.syncShooters(); });
    s.on('arrive', () => this.syncShooters());
    s.on('part', (m) => { this.fx?.setGlint(String(m.id), null); this.syncShooters(); });
    s.on('retour', (m) => {
      this.fx?.setGlint(String(m.id), null);
      this.syncShooters();
      if (m.id === s.me) { this.down = false; this.panel?.clearVeil(); if (!s.inLobby) this.enterRound(); }
    });
    s.on('tir', (m) => this.onShot(m));
    s.on('touche', (m) => this.onHit(m));
    s.on('vise', (m) => this.onGlint(m));
    s.on('diversion', (m) => this.onDiversion(m));

    // contrôles automatisés : entrer dans la salle sans passer par le salon
    const auto = this.params.get('auto'), pseudo = (this.params.get('pseudo') ?? '').trim();
    if (auto === 'spectateur') s.watch();
    else if (auto !== null && pseudo.length >= 2) s.join(pseudo);
  }

  /** La carte est chargée : emplacements, mannequins, effets, arme à la première personne, plan du salon. */
  private onMap(): void {
    const h = this.host, terrain = h.terrain as VilleTerrain, w = terrain.world;
    for (const e of w.emp) { const eye = w.eyeOf(e); this.places.set(e.nom, { n: e.n, nom: e.nom, eye: new Vector3(eye.x, eye.y, eye.z), yaw: w.yawToCentre(e) }); }
    const pl = h.player;
    pl.locked = true;
    // debout contre le garde-corps : le tremblement est celui d'un tireur appuyé
    pl.braced = true;
    // première personne : on ne voit pas son propre corps
    pl.char.group.visible = false;
    this.fx = new OnlineEffects({ scene: h.engine.scene, camera: h.engine.camera, shots: h.shots, sounds: this.sounds });
    this.rifle = eyeRifle(h.engine, h.rifle.def);
    h.engine.camera.add(this.rifle);
    this.mapReady = true;
    if (this.visit !== null) return;
    // en manche, les silhouettes de la visite laissent la place aux tireurs de la salle
    for (const t of h.targets.values()) if (t instanceof Silhouette) t.setActive(false);
    this.crowd = new ShooterCrowd(h.engine, h.rifle.def);
    h.engine.scene.add(this.crowd.group);
    const carte: PlanCarte = { dalles: terrain.tiles.map((t, i) => ({ image: t.image as CanvasImageSource, x0: w.OX + (i % w.NT) * w.TS, z0: w.OZ + Math.floor(i / w.NT) * w.TS })), cote: w.TS, ox: w.OX, oz: w.OZ, taille: w.N };
    this.lobby?.setPlan(carte, [...this.places.values()].map((p) => ({ n: p.n, nom: p.nom, x: p.eye.x, z: p.eye.z })));
    h.setState('lobby');
    h.ui.show(null);
    this.syncShooters();
    if (this.session.role && !this.session.inLobby) this.enterRound();
  }

  // ------------------------------------------------------------------ états
  /** Entre dans la manche (ou y revient) : sur son emplacement, vent de la manche, vue levée. */
  private enterRound(): void {
    const h = this.host, s = this.session;
    if (!this.mapReady) {
      // la carte n'est pas encore là : écran de chargement du jeu, et on entrera dès qu'elle l'est (`onMap`)
      if (!this.wantRound) { this.wantRound = true; h.ui.show('loading'); }
      return;
    }
    this.wantRound = false;
    const v = s.settings.vent;
    // vent voté, régulier : ni rafales ni errance ; « sans vent » : calme plat
    h.wind.configure({ wander: 0, gusts: 0, speed: v ? v.vitesse : 0, ...(v ? { fromBearing: v.de } : {}) });
    this.solutions.clear();
    const me = s.self;
    this.down = !!me && !me.vivant;
    if (!this.down) this.panel?.clearVeil();
    this.fx?.clear();
    if (me) this.goTo(me.emp);
    else {
      // spectateur : sur un emplacement que personne n'occupe (il en changera aux flèches ou par la liste). On s'y poste
      // même si l'on y était déjà : c'est ce qui place la caméra et lève le fondu d'entrée (sinon l'image restait noire).
      const pris = s.occupied(), garde = !!this.place && !pris.has(this.place);
      this.goTo(garde ? this.place : [...this.places.values()].find((p) => p.n === DEFAULT_POSTE && !pris.has(p.nom))?.nom ?? [...this.places.keys()].find((n) => !pris.has(n)) ?? '');
    }
    if (s.role === 'spectateur') this.panel?.setPlaces([...this.places.values()], this.place);
    else this.panel?.setPlaces([]);
    h.ui.show(null);
    h.setState(this.down ? 'down' : 'play');
  }

  /** Retour au salon : fin de manche, connexion perdue, sortie volontaire. */
  private toLobby(): void {
    const h = this.host;
    this.down = false;
    this.wantRound = false;
    this.held = null;
    this.panel?.clearVeil();
    this.panel?.hide();
    this.fx?.clear();
    if (!this.mapReady) { h.ui.show(null); return; }
    h.scope.exit();
    h.setState('lobby');
    h.ui.show(null);
  }

  /** Pause, « Quitter la manche » : on sort de la salle, retour au salon. */
  leave(): void {
    if (this.visit !== null) { location.reload(); return; }
    this.session.leave();
    this.toLobby();
    this.syncShooters();
    void this.session.refresh();
  }

  /** Se poster sur l'emplacement `nom` (à défaut, celui de départ), debout, face au centre de la carte. */
  /** Spectateur : passe à l'emplacement libre suivant (`d` = 1) ou précédent (−1), dans l'ordre des numéros, en boucle. */
  stepPlace(d: 1 | -1): void {
    const pris = this.session.occupied(), libres = [...this.places.values()].filter((p) => !pris.has(p.nom) || p.nom === this.place).sort((a, b) => a.n - b.n);
    if (libres.length < 2) return;
    const i = libres.findIndex((p) => p.nom === this.place), suivant = libres[(Math.max(0, i) + d + libres.length) % libres.length];
    this.host.scope.exit();
    this.goTo(suivant.nom);
    this.panel?.setPlaces([...this.places.values()], this.place);
  }

  goTo(nom: string): void {
    const h = this.host;
    const p = this.places.get(nom) ?? [...this.places.values()].find((q) => q.n === DEFAULT_POSTE) ?? [...this.places.values()][0];
    if (!p) return;
    this.place = p.nom;
    const pl = h.player;
    h.scope.exit();
    pl.teleport(p.eye.x, p.eye.z, p.yaw, 'stand', p.eye.y - EYE_Y - BASE_Y);
    pl.pitch = -0.06;
    // nouvel emplacement : tourelles à zéro, plus aucun reflet
    h.rifle.elevClicks = 0;
    h.rifle.windClicks = 0;
    this.fx?.clearGlints();
    this.held = null;
    this.solutions.clear();
    if (this.visit !== null) for (const t of h.targets.values()) if (t instanceof Silhouette) t.setActive(t.n !== p.n);
    h.fadeIn();
  }

  // ------------------------------------------------------------------ les autres tireurs
  /** Accorde les cibles du jeu aux tireurs de la salle : un mannequin par tireur, à sa place, debout ou abattu. */
  private syncShooters(): void {
    if (!this.crowd) return;
    const h = this.host, s = this.session;
    for (const [id, t] of this.shooters) {
      if (s.players.has(id) && id !== s.me) continue;
      h.removeTarget(t);
      this.crowd.give(t);
      this.shooters.delete(id);
      if (this.held === t) this.held = null;
    }
    for (const j of s.players.values()) {
      if (j.id === s.me) continue;
      let t = this.shooters.get(j.id);
      if (!t) {
        const made = this.crowd.take(j.id, j.pseudo);
        if (!made) continue;
        t = made;
        this.shooters.set(j.id, t);
        h.addTarget(t);
      }
      const p = this.places.get(j.emp);
      if (p && t.emp !== j.emp) t.place(j.emp, this.v1.set(p.eye.x, p.eye.y - EYE_Y, p.eye.z), p.yaw);
      if (t.down === j.vivant) t.setDown(!j.vivant);
    }
    this.crowd.sync();
  }

  /** Placement gauche / droite d'un point du monde pour l'oreille : −1 à gauche … 1 à droite. */
  private pan(p: Vector3): number {
    const cam = this.host.engine.camera;
    const to = this.v2.subVectors(p, cam.position).normalize();
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    return Math.max(-1, Math.min(1, to.dot(this.right) * 1.2));
  }
  private get inRound(): boolean {
    return this.mapReady && !!this.session.role && !this.session.inLobby;
  }

  // tir d'un autre : traçante, flamme et détonation depuis son emplacement
  private onShot(m: MsgTir): void {
    if (!this.inRound || !this.fx) return;
    const from = this.places.get(m.emp);
    if (!from) return;
    const def = this.host.rifle.def, self = this.shooters.get(m.id) ?? null;
    if (m.dir) { self?.aimAlong(m.dir[0], m.dir[2]); this.fx.remoteShot(from.eye, this.v1.set(m.dir[0], m.dir[1], m.dir[2]), def, self); }
    else if (m.vers) { const to = this.places.get(m.vers); if (to) { self?.aimAt(to.eye); this.fx.robotShot(from.eye, to.eye, !!m.touche, def, self); } }
  }

  private onHit(m: MsgTouche): void {
    this.syncShooters();
    if (!this.inRound) return;
    const s = this.session, abattu = m.abattu !== false, ou = m.zone === 'tete' ? 'à la tête' : 'au corps';
    const par = nom(s.players.get(m.tireur));
    if (m.cible === s.me) {
      // la voix de celui qui encaisse : toute proche
      this.sounds.hitSelf();
      if (abattu) {
        this.down = true;
        this.host.scope.exit();
        this.host.ui.show(null);
        this.host.setState('down');
        this.panel?.hit('down', `Abattu par <b>${par}</b><br>${ou}, à ${fr(m.dist)} m<br><small>Retour dans 5 secondes, sur un autre emplacement.</small>`);
      } else this.panel?.hit('flash', `Touché ${ou} par <b>${par}</b>`);      // encore debout : un éclair rouge
      return;
    }
    const t = this.shooters.get(m.cible);
    if (!t) return;
    const p = m.zone === 'tete' ? t.head(this.v1) : t.aimPoint(this.v1);
    this.fx?.hitSpray(p);
    // sa propre touche : la voix, au loin, et l'annonce à l'écran, dans le bandeau doré du solo (rien pour les touches des autres)
    if (m.tireur === s.me) {
      this.sounds.hitFar(m.dist, this.pan(p));
      const cible = s.players.get(m.cible);
      const titre = m.abattu ? (m.zone === 'tete' ? 'Abattu, en pleine tête' : 'Abattu') : 'Touché';
      (this.notice ??= new Praise(document.getElementById('ui') ?? document.body)).show(titre, `${cible ? (cible.robot ? '🤖 ' : '') + cible.pseudo : '?'} · ${fr(m.dist)} m · +${fr(m.points)} points`);
    }
  }

  // reflet de lunette : ce tireur nous tient (ou ne nous tient plus) dans sa lunette
  private onGlint(m: MsgVise): void {
    const t = this.shooters.get(m.par);
    // il nous tient dans sa lunette : il est tourné vers nous
    if (m.actif && t) t.aimAt(this.host.player.pos);
    this.fx?.setGlint(String(m.par), m.actif && t && this.inRound ? t.eye(this.v1) : null);
  }

  private onDiversion(m: MsgDiversion): void {
    if (!this.inRound) return;
    this.diversions++;
    if (m.id === this.session.me) { this.divertAt = performance.now(); this.sounds.diversionSelf(m.son); return; }
    const p = this.places.get(m.emp);
    if (!p) return;
    this.sounds.diversionFar(m.son, p.eye.distanceTo(this.host.engine.camera.position), this.pan(p.eye));
  }

  // ------------------------------------------------------------------ appels du jeu
  /** Spectateur ou tireur abattu : la détente ne fait rien. */
  holdFire(): boolean {
    return this.down || this.session.role === 'spectateur';
  }
  /** Cran de tourelle : celui de la maquette, à la place de celui du solo. */
  turretClick(): void {
    this.sounds.turretClick();
  }

  /**
   * Commandes tactiles : celles du solo (src/ui/touch.ts), sans ce qui n'a pas cours ici (postures, râtelier, télémètre,
   * carnet, briefing, manette : le tireur est fixe), avec « Régler sur la cible » et « Diversion ».
   */
  touchFrame(f: TouchFrame): void {
    const spect = this.session.role === 'spectateur';
    f.online = true;
    f.fixed = true;
    f.unarmed = spect;
    if (spect) f.canReload = false;
    f.divertIn = Math.max(0, DIVERSION_WAIT - (performance.now() - this.divertAt) / 1000);
    f.turretHelp = TOUCH_HELP;
  }
  scopeInset(): number {
    return TOUCH_TOP;
  }
  scopeBelow(): number {
    return TOUCH_BELOW;
  }

  localShot(bullet: Bullet, _boreDir: Vector3): void {
    if (!this.fx) return;
    // la traçante suit la vraie trajectoire de la balle : elle dit aussi, dès le départ, qui elle atteindra
    const tr = this.fx.localShot(bullet);
    const s = this.session;
    if (!s.online) return;
    const sp = bullet.s, v = Math.hypot(sp.vx, sp.vy, sp.vz) || 1;
    const dir: [number, number, number] = [sp.vx / v, sp.vy / v, sp.vz / v];
    const t = tr.target instanceof RemoteShooter ? tr.target : null;
    if (!t || tr.n < 2) { s.shoot({ dir }); return; }
    const P = tr.pts, a = (tr.n - 2) * 4, b = (tr.n - 1) * 4;
    const zone = zoneOnLine(t.feet, this.v1.set(P[a], P[a + 1], P[a + 2]), this.v2.set(P[b], P[b + 1], P[b + 2]));
    s.shoot({ dir, cible: t.playerId, dist: t.aimPoint(this.v3).distanceTo(this.host.player.eye(this.v1)), tof: tr.tof, zone });
  }

  /** L'impact est déjà sonné et dessiné par le jeu ; la touche, elle, viendra du serveur à l'arrivée de la balle. */
  impact(_r: ImpactReport): void { /* rien */ }

  frame(_dt: number, dtReal: number): void {
    const h = this.host, s = this.session, pl = h.player, sc = h.scope, cam = h.engine.camera;
    const scoped = sc.amount > 0.5;
    // --- vue à l'œil nu : première personne, la caméra sur l'œil du tireur (à la place de la caméra par-dessus l'épaule) ---
    if (h.state !== 'menu' && !scoped) {
      const cp = Math.cos(pl.pitch);
      pl.eye(cam.position);
      cam.up.set(0, 1, 0);
      cam.lookAt(cam.position.x + Math.sin(pl.yaw) * cp, cam.position.y + Math.sin(pl.pitch), cam.position.z - Math.cos(pl.yaw) * cp);
    }
    if (this.rifle) this.rifle.visible = !scoped && (h.state === 'play' || h.state === 'pause') && !this.down && s.role !== 'spectateur';
    this.fx?.update(dtReal, scoped);
    this.crowd?.sync();
    document.documentElement.classList.toggle('ol-lunette', scoped && h.state === 'play');

    // --- commandes propres au mode ---
    const now = performance.now(), inp = h.input;
    if (h.state === 'play' && !this.holdFire()) {
      for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) if (sc.active && inp.hit(code)) this.pressed = { code, until: now + 130 };
      if (inp.hit('KeyG') && sc.active) { this.setOnTarget(); this.pressed = { code: 'KeyG', until: now + 130 }; }
      if (inp.hit('KeyV')) { s.divert(); this.pressed = { code: 'KeyV', until: now + 130 }; }
    }
    // --- spectateur : flèche droite ou gauche, emplacement libre suivant ou précédent ---
    if (h.state === 'play' && s.role === 'spectateur') { const d = inp.hit('ArrowRight') ? 1 : inp.hit('ArrowLeft') ? -1 : 0; if (d) this.stepPlace(d); }
    // --- ambiance de ville : dès qu'on est entré (salon ou manche) ---
    this.ambience.frame(!!s.role);
    // --- tops des trois dernières secondes du salon ---
    if (!s.role || s.phase !== 'pause') this.lastTop = 0;
    else { const k = Math.ceil(s.remaining() / 1000); if (k >= 1 && k <= 3 && k !== this.lastTop) { this.lastTop = k; this.sounds.countdown(false); } }
    // --- on signale au serveur le tireur qu'on tient dans sa lunette : lui seul verra notre reflet ---
    this.aimT -= dtReal;
    if (this.aimT <= 0) { this.aimT = 0.3; s.aim(this.held && h.state === 'play' && !this.down ? this.held.playerId : null); }
  }

  /** Le tireur le plus proche de la ligne de visée (à moins de `max` radians), ou null. Vaut aussi pour les silhouettes de la visite. */
  private aimed(cam: PerspectiveCamera, max: number): { nom: string; centre: Vector3; shooter: RemoteShooter | null } | null {
    const los = cam.getWorldDirection(this.v1);
    let best: { nom: string; centre: Vector3; shooter: RemoteShooter | null } | null = null, ba = max;
    const tryOne = (nomEmp: string, c: Vector3, shooter: RemoteShooter | null): void => {
      const dx = c.x - cam.position.x, dy = c.y - cam.position.y, dz = c.z - cam.position.z, d = Math.hypot(dx, dy, dz);
      if (d < 30) return;
      const a = Math.acos(Math.min(1, (dx * los.x + dy * los.y + dz * los.z) / d));
      if (a < ba) { ba = a; best = { nom: nomEmp, centre: c.clone(), shooter }; }
    };
    if (this.visit !== null) { for (const t of this.host.targets.values()) if (t instanceof Silhouette && t.active) tryOne(t.label, t.aimPoint(this.v2), null); }
    else for (const t of this.shooters.values()) if (!t.down) tryOne(t.emp, t.aimPoint(this.v2), t);
    return best;
  }

  /** Solution de tir pour un tireur dont le centre est en `c` : distance, élévation (tourelle et contre-visée), dérive. */
  private solution(key: string, c: Vector3): { range: number; elev: number; dial: number; hold: number; wind: number } | null {
    const h = this.host, wind = h.wind, def = h.rifle.def;
    const k = `${this.place}>${key}>${wind.baseSpeed}@${wind.fromBearing}`;
    let s = this.solutions.get(k);
    if (s === undefined) {
      const eye = h.player.eye(this.v3), range = c.distanceTo(eye);
      const azimuthDeg = ((Math.atan2(c.x - eye.x, -(c.z - eye.z)) * 180) / Math.PI + 360) % 360;
      const sol = firingSolution(def, { range, heightDiff: c.y - eye.y, air: GAME_AIR, sightHeight: SIGHT_HEIGHT, azimuthDeg, ...(wind.baseSpeed > 0 ? { windSpeed: wind.baseSpeed, windFromDeg: wind.fromBearing } : {}) });
      const split = sol ? splitElevation(sol.elevMil, def.turretMaxMil, CLICK_MIL) : null;
      s = sol && split ? { range, elev: sol.elevMil, dial: split.dialMil, hold: split.holdMil, wind: Math.round(sol.windMil * 10) / 10 } : null;
      if (this.solutions.size > 200) this.solutions.clear();
      this.solutions.set(k, s);
    }
    return s;
  }

  /** Touche G : règle les deux tourelles sur le tireur visé (élévation dans la course de la tourelle, dérive). */
  setOnTarget(): void {
    const h = this.host, a = this.aimed(h.engine.camera, HELD_WIDE), s = a && this.solution(a.nom, a.centre);
    if (!s) return;
    const r = h.rifle;
    r.elevClicks = Math.min(Math.round(r.def.turretMaxMil / CLICK_MIL), Math.max(0, Math.round(s.dial / CLICK_MIL)));
    r.windClicks = Math.min(WIND_MAX / CLICK_MIL, Math.max(-WIND_MAX / CLICK_MIL, Math.round(s.wind / CLICK_MIL)));
  }

  hud(hs: HudState): void {
    const h = this.host, s = this.session, cam = h.engine.camera, view = h.engine.view;
    // ce que le solo affiche et qui n'a pas cours ici : objectif, guide, boussole de cible, télémètre, contre-visée, posture
    hs.objective = null;
    hs.guide = null;
    hs.targetBearing = null;
    hs.scopeArrow = null;
    hs.range = null;
    hs.rangeFlat = null;
    hs.hold = '';
    hs.stance = '';
    hs.post = null;
    // à l'œil nu, pas de rappel des postures ni du carnet : le tireur est fixe
    if (!hs.scope && !hs.promptBig) hs.prompt = '';      // à l'œil nu, pas d'invite du solo, sauf le chargeur vide, signalé en grand

    const v = this.view;
    v.shown = h.state === 'play';
    v.scope = hs.scope;
    v.list = h.state === 'play' || h.state === 'pause';
    v.life = s.role === 'joueur' ? s.life : null;
    v.elev = h.rifle.elevMil;
    v.wind = h.rifle.windMil;
    v.elevMax = h.rifle.def.turretMaxMil;
    v.pressed = this.pressed && performance.now() < this.pressed.until ? this.pressed.code : null;
    v.fieldLeft = view.cx - view.R;
    v.w = view.w;
    v.h = view.h;
    v.labels.length = 0;
    v.observer = null;
    this.held = null;
    if (v.shown && hs.scope) {
      // la vue de l'observateur n'apparaît que lunette à l'œil : à l'œil nu, rien ne trahit un tireur
      const a = this.aimed(cam, HELD);
      if (a) {
        const sol = this.solution(a.nom, a.centre);
        v.observer = { place: a.nom, range: sol ? sol.range : a.centre.distanceTo(h.player.eye(this.v3)), correction: correctionText(sol) };
        this.held = a.shooter;
      }
    }
    if (v.shown) {
      cam.updateMatrixWorld();
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      // le pseudo du tireur visé, au-dessus de sa tête, lunette à l'œil ; le spectateur, lui, voit tout le monde
      const all = s.role === 'spectateur';
      for (const t of this.shooters.values()) {
        if (t.down || !(all || (hs.scope && t === this.held))) continue;
        const j = s.players.get(t.playerId);
        if (!j) continue;
        const p = this.v2.set(t.feet.x, t.feet.y + EYE_Y + 0.75, t.feet.z).project(cam);
        if (p.z > 1 || Math.abs(p.x) > 1.02 || Math.abs(p.y) > 1.02) continue;
        v.labels.push({ x: ((p.x + 1) / 2) * view.w, y: ((1 - p.y) / 2) * view.h, text: (j.robot ? '🤖 ' : '') + j.pseudo });
      }
    }
    this.panel?.update(v);
  }
}

export function createOnlineMode(host: OnlineHost): OnlineMode {
  return new Mode(host);
}
