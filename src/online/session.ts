// Session du mode en ligne : le protocole de la manche (server/manche.mjs, server/manche-api.mjs) côté joueur.
// Machine à états pure : ni DOM, ni réseau, ni minuterie. Le transport est injecté (`browserTransport` en production :
// un flux d'événements du serveur vers la page, de petites requêtes POST dans l'autre sens ; un faux transport branché
// sur le vrai `createManche` dans tests/online-session.test.ts), l'horloge aussi.
//
// Les noms des champs échangés avec le serveur sont ceux du protocole (français) ; ils ne sont pas traduits.

export type Phase = 'jeu' | 'pause';
export type Niveau = 'facile' | 'standard' | 'avance';
export type Zone = 'tete' | 'corps';
export type Role = 'joueur' | 'spectateur';

/** Vent de la manche : force en m/s, azimut d'où il vient en degrés. */
export interface Vent { vitesse: number; de: number }
export interface Reglages { niveau: Niveau; vent: Vent | null }
export interface Decompte { vent: { oui: number; non: number }; niveau: Record<Niveau, number> }
export interface Choix { vent?: boolean; niveau?: Niveau }

/** Un tireur de la salle, tel que le serveur le diffuse. */
export interface Joueur {
  id: number; pseudo: string; robot: boolean;
  /** joue sur téléphone (appareil tactile), d'après son navigateur */
  tel?: boolean;
  /** nom de son emplacement */
  emp: string;
  vivant: boolean;
  /** points de vie : 2 au départ, 1 après une balle dans le corps, 0 abattu */
  vie: number;
  points: number; touches: number; tirs: number; subies: number;
}
/**
 * Une ligne de classement (partie précédente, salle vue du dehors, records). `tetes` : tirs à la tête réussis ;
 * `abattus` : adversaires abattus ; `plusLong` : plus long tir réussi, en mètres (0 : aucune touche). Ces trois-là
 * manquent aux lignes enregistrées avant leur ajout (fichier des records) : absentes, elles s'affichent d'un tiret.
 */
export interface Ligne { pseudo: string; robot: boolean; tel?: boolean; points: number; touches: number; tirs: number; subies: number; tetes?: number; abattus?: number; plusLong?: number; date?: number }

/** Réponse de GET /api/manche/etat : ce que le salon affiche sans entrer dans la salle. */
export interface Resume {
  phase: Phase; reste: number; reglages: Reglages; votes: Decompte;
  connectes: number; humains: number; spectateurs: number; robots: number; places: number;
  joueurs: Ligne[]; precedente: { fin: number; classement: Ligne[] } | null; meilleurs: Ligne[]; pires: Ligne[];
  /** meilleurs scores des joueurs sur téléphone (absent d'un serveur plus ancien) */
  telephone?: Ligne[];
}

// ---------- messages du serveur ----------
export interface MsgBienvenue { t: 'bienvenue'; id: number; jeton?: string; spectateur?: boolean; phase: Phase; reste: number; reglages: Reglages; votes: Decompte; joueurs: Joueur[] }
export interface MsgArrive { t: 'arrive'; joueur: Joueur }
export interface MsgPart { t: 'part'; id: number }
/** Tir d'un autre : `dir` (direction du canon) pour un humain, `vers` (emplacement visé) et `touche` pour un robot. */
export interface MsgTir { t: 'tir'; id: number; emp: string; dir?: [number, number, number]; vers?: string; touche?: boolean }
export interface MsgTouche { t: 'touche'; tireur: number; cible: number; emp: string; de: string; dist: number; points: number; zone: Zone; vie: number; abattu: boolean; scores: Joueur[] }
export interface MsgRetour { t: 'retour'; id: number; emp: string }
export interface MsgVotes { t: 'votes'; votes: Decompte }
/** Reflet de lunette : le tireur `par` nous tient (ou ne nous tient plus) dans sa lunette. */
export interface MsgVise { t: 'vise'; par: number; actif: boolean }
export interface MsgFin { t: 'fin'; phase: Phase; reste: number; classement: Ligne[] }
export interface MsgDebut { t: 'debut'; phase: Phase; reste: number; reglages: Reglages; joueurs: Joueur[] }
/** Diversion : le tireur `id` fait un bruit depuis l'emplacement `emp` ; `son` : numéro du son, de 1 à 5, tiré par le serveur. */
export interface MsgDiversion { t: 'diversion'; id: number; emp: string; son: number }
export interface MsgComplet { t: 'complet' }
export interface MsgVide { t: 'vide' }
export type ServerMsg = MsgBienvenue | MsgArrive | MsgPart | MsgTir | MsgTouche | MsgRetour | MsgVotes | MsgVise | MsgFin | MsgDebut | MsgDiversion | MsgComplet | MsgVide;

/**
 * Événements de la session. Chaque message du serveur est réémis sous son nom, une fois l'état mis à jour ;
 * `perdu` : le flux est tombé (retour au salon) ; `change` : l'état a changé, quelle qu'en soit la cause.
 */
export interface SessionEvents {
  bienvenue: MsgBienvenue; arrive: MsgArrive; part: MsgPart; tir: MsgTir; touche: MsgTouche; retour: MsgRetour;
  votes: MsgVotes; vise: MsgVise; fin: MsgFin; debut: MsgDebut; diversion: MsgDiversion; complet: MsgComplet; vide: MsgVide;
  perdu: undefined; change: undefined;
}

/** Annonce d'un tir du joueur. Sans `cible`, la balle n'a atteint personne. */
export interface Annonce { dir?: [number, number, number]; cible?: number; dist?: number; tof?: number; zone?: Zone }

export interface Flux { close(): void }
/** Ce que la session demande au réseau. */
export interface SessionTransport {
  /** GET etat */
  summary(): Promise<Resume>;
  /** GET flux : `onMessage` reçoit chaque message déjà décodé, `onError` la perte ou le refus de la connexion. */
  open(qui: { pseudo: string; tel?: boolean } | { spectateur: true }, onMessage: (m: unknown) => void, onError: () => void): Flux;
  /** POST tir, vise, vote ou diversion */
  post(action: 'tir' | 'vise' | 'vote' | 'diversion', corps: Record<string, unknown>): Promise<unknown>;
}

/** Transport de production : EventSource et fetch, sur l'API servie à côté de la page. */
export function browserTransport(base = './api/manche/'): SessionTransport {
  return {
    summary: () => fetch(base + 'etat').then((r) => (r.ok ? (r.json() as Promise<Resume>) : Promise.reject(new Error('etat')))),
    open(qui, onMessage, onError) {
      const flux = new EventSource(base + 'flux?' + ('pseudo' in qui ? 'pseudo=' + encodeURIComponent(qui.pseudo) + (qui.tel ? '&tel=1' : '') : 'role=spectateur'));
      flux.onmessage = (ev) => { let m: unknown; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
      flux.onerror = () => onError();
      return { close: () => flux.close() };
    },
    post: (action, corps) => fetch(base + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }).then((r) => r.json()),
  };
}

// ---------- textes communs au salon et au tableau ----------
export const fr = (v: number): string => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
/** Pseudo affiché (HTML) : les tireurs automatiques portent un robot devant leur nom. */
export const nom = (j: { pseudo: string; robot?: boolean; tel?: boolean } | null | undefined): string => (j?.robot ? '🤖 ' : '') + esc(j?.pseudo ?? '?') + (j?.tel ? ' 📱' : '');
/** Précision d'un tireur : touches / tirs, en pour cent arrondi (null : il n'a pas tiré). */
export const precision = (l: { touches: number; tirs: number }): number | null => (l.tirs > 0 ? Math.round((100 * l.touches) / l.tirs) : null);
/**
 * Le plus long tir réussi d'un classement, pour la ligne de synthèse : celui d'un joueur humain ; celui d'un robot
 * seulement si aucun humain n'a touché (null : personne n'a touché, ou lignes d'avant cette statistique).
 */
export const plusLongTir = (c: readonly Ligne[]): Ligne | null => {
  const meilleur = (l: Ligne[]) => l.reduce<Ligne | null>((m, x) => ((x.plusLong ?? 0) > (m?.plusLong ?? 0) ? x : m), null);
  return meilleur(c.filter((l) => !l.robot)) ?? meilleur(c.filter((l) => l.robot));
};
export const mmss = (ms: number): string => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const ROSE = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
export const NOMS: Record<Niveau, string> = { facile: 'facile (15 emplacements serrés)', standard: 'standard (25 emplacements)', avance: 'avancé (toute la carte)' };
/** « du nord », « de l'est », « de l'ouest » : l'article s'élide devant une voyelle. */
export const venantDe = (rose: string): string => (/^[aeiou]/.test(rose) ? 'de l’' : 'du ') + rose;
export const texteVent = (v: Vent | null | undefined): string => (v ? `vent de ${String(v.vitesse).replace('.', ',')} m/s venant ${venantDe(ROSE[Math.round(v.de / 45) % 8])}` : 'sans vent');

type Handlers = { [K in keyof SessionEvents]?: Set<(m: SessionEvents[K]) => void> };

export class Session {
  /** null : au salon, pas encore entré ; sinon le rôle demandé (dès la demande, avant même la réponse du serveur) */
  role: Role | null = null;
  /** le serveur a répondu « bienvenue » : on est dans la salle */
  welcomed = false;
  /** identifiant du joueur dans la salle (null : spectateur, ou pas entré) */
  me: number | null = null;
  phase: Phase = 'jeu';
  /** fin de la phase en cours, sur l'horloge `now` */
  deadline = 0;
  readonly players = new Map<number, Joueur>();
  settings: Reglages = { niveau: 'facile', vent: null };
  /** décompte des votes reçu par le flux (null hors de la minute de salon) */
  votes: Decompte | null = null;
  /** ce que le joueur a voté pour la manche suivante */
  readonly myVote: Choix = {};
  /** dernier résumé lu (`refresh`) */
  summary: Resume | null = null;
  /** le serveur de manche répond */
  server = true;
  /** dernière annonce, en clair (à échapper avant de l'afficher) */
  announce = '';
  /** les trois derniers tireurs abattus de la manche, du plus récent au plus ancien ; `moi` : j'y suis tireur ou cible */
  kills: { texte: string; moi: boolean }[] = [];
  /** classement de la manche qui vient de finir (null tant qu'aucune ne s'est finie sous nos yeux) */
  lastRanking: Ligne[] | null = null;

  private jeton = '';
  private flux: Flux | null = null;
  private held: number | null = null;
  private readonly handlers: Handlers = {};

  constructor(private readonly transport: SessionTransport, private readonly now: () => number = () => performance.now()) {}

  // ---------- lecture ----------
  /** Temps restant avant la fin de la phase, en ms. */
  remaining(): number { return this.deadline - this.now(); }
  /** Le joueur lui-même (null : spectateur ou pas entré). */
  get self(): Joueur | null { return this.me != null ? this.players.get(this.me) ?? null : null; }
  /** Points de vie du joueur : 2, 1, ou 0 s'il est abattu. */
  get life(): number { const j = this.self; return j ? (j.vivant ? j.vie ?? 2 : 0) : 0; }
  /** Le joueur est dans la salle, comme tireur : ses tirs partent au serveur. */
  get online(): boolean { return this.role === 'joueur' && this.welcomed && this.me != null; }
  /** Le salon est à l'écran : avant d'entrer, et pendant la minute qui sépare deux manches. */
  get inLobby(): boolean { return !this.welcomed || this.phase !== 'jeu'; }
  /** Les tireurs de la salle, du plus de points au moins de points. */
  ranking(): Joueur[] { return [...this.players.values()].sort((a, b) => b.points - a.points); }
  /** L'autre tireur debout sur cet emplacement. */
  playerAt(emp: string): Joueur | undefined { for (const j of this.players.values()) if (j.emp === emp && j.id !== this.me && j.vivant) return j; return undefined; }
  /** Son pseudo en clair, robot signalé ('' : personne). */
  nameAt(emp: string): string { const j = this.playerAt(emp); return j ? (j.robot ? '🤖 ' : '') + j.pseudo : ''; }
  /** Emplacements occupés par les autres tireurs debout. */
  occupied(): Set<string> { const s = new Set<string>(); for (const j of this.players.values()) if (j.id !== this.me && j.vivant) s.add(j.emp); return s; }

  on<K extends keyof SessionEvents>(type: K, fn: (m: SessionEvents[K]) => void): () => void {
    const set = ((this.handlers[type] as Set<(m: SessionEvents[K]) => void> | undefined) ??= new Set()) as Set<(m: SessionEvents[K]) => void>;
    (this.handlers as Record<string, unknown>)[type] = set;
    set.add(fn);
    return () => { set.delete(fn); };
  }
  private emit<K extends keyof SessionEvents>(type: K, m: SessionEvents[K]): void {
    const set = this.handlers[type] as Set<(m: SessionEvents[K]) => void> | undefined;
    if (set) for (const fn of [...set]) fn(m);
  }

  // ---------- actions ----------
  /** Relit le résumé de la salle (connectés, classements). Hors de la salle, c'est lui qui donne l'horloge. */
  refresh(): Promise<void> {
    return this.transport.summary().then((e) => {
      this.server = true; this.summary = e;
      if (!this.role) { this.phase = e.phase; this.deadline = this.now() + e.reste; }
    }).catch(() => { this.server = false; }).then(() => this.emit('change', undefined));
  }
  /** ce joueur est sur téléphone (appareil tactile) : dit au serveur en rejoignant la partie */
  tel = false;
  /** Rejoint la partie sous ce pseudo. */
  join(pseudo: string): void { this.enter('joueur', { pseudo, tel: this.tel }); }
  /** Regarde la partie en spectateur (refusé par le serveur s'il n'y a aucun joueur humain). */
  watch(): void { this.enter('spectateur', { spectateur: true }); }
  private enter(role: Role, qui: { pseudo: string; tel?: boolean } | { spectateur: true }): void {
    if (this.role) return;
    this.role = role;
    let flux: Flux | null = null; let ferme = false;
    const vivant = (): boolean => !ferme && (flux === null || this.flux === flux);
    const f = this.transport.open(qui, (m) => { if (vivant()) this.receive(m); }, () => {
      // connexion perdue ou refusée : retour au salon
      if (!vivant()) return;
      this.quit(); this.announce = 'Connexion à la manche perdue.';
      this.emit('perdu', undefined); this.emit('change', undefined); void this.refresh();
    });
    flux = f;
    // le transport a pu répondre pendant l'ouverture (« complet », « vide ») : la session a déjà quitté
    if (this.role === role && this.flux === null) this.flux = f; else { ferme = true; f.close(); }
    this.emit('change', undefined);
  }
  /** Quitte la salle (ou renonce à y entrer) : retour à l'état du salon. */
  leave(): void { this.quit(); this.emit('change', undefined); }
  private quit(): void {
    const f = this.flux; this.flux = null; f?.close();
    this.role = null; this.welcomed = false; this.me = null; this.jeton = ''; this.held = null; this.players.clear();
  }
  /** Un tir du joueur : il part au serveur ; s'il atteint un tireur, avec la distance, le temps de vol et la zone. */
  shoot(a: Annonce = {}): void {
    if (!this.online) return;
    const corps: Record<string, unknown> = { id: this.me, jeton: this.jeton, dir: a.dir };
    if (a.cible != null) { corps.cible = a.cible; corps.dist = a.dist; corps.tof = a.tof; corps.zone = a.zone; }
    const moi = this.me;
    // son propre tir n'est pas rediffusé au tireur : il le compte lui-même, dès que le serveur l'a accepté
    this.transport.post('tir', corps).then((x) => {
      if ((x as { r?: unknown } | null)?.r !== 'ok' || this.me !== moi) return;
      const j = this.self; if (j) { j.tirs++; this.emit('change', undefined); }
    }).catch(() => {});
  }
  /**
   * Diversion : un bruit que tous les autres entendent depuis notre emplacement. Le serveur n'en accepte qu'une toutes
   * les dix secondes ; acceptée, elle revient par l'événement `diversion`, à nous comme aux autres.
   */
  divert(): void {
    if (!this.online) return;
    this.transport.post('diversion', { id: this.me, jeton: this.jeton }).catch(() => {});
  }
  /** Le tireur que le joueur tient dans sa lunette (null : personne) : lui seul verra le reflet. N'envoie que les changements. */
  aim(cible: number | null): void {
    if (!this.online) { this.held = null; return; }
    if (cible === this.held) return;
    this.held = cible;
    this.transport.post('vise', { id: this.me, jeton: this.jeton, cible }).catch(() => {});
  }
  /** Vote pour la manche suivante, pendant la minute de salon. */
  vote(choix: Choix): void {
    Object.assign(this.myVote, choix);
    this.emit('change', undefined);
    this.transport.post('vote', { id: this.me, jeton: this.jeton, ...choix }).catch(() => {});
  }

  // ---------- messages du serveur ----------
  private clock(m: { phase: Phase; reste: number; reglages?: Reglages; votes?: Decompte }): void {
    this.phase = m.phase; this.deadline = this.now() + m.reste;
    if (m.reglages) this.settings = m.reglages;
    if (m.votes) this.votes = m.votes;
  }
  private load(l: Joueur[]): void { this.players.clear(); for (const j of l) this.players.set(j.id, j); }
  private nameOf(id: number): string { return this.players.get(id)?.pseudo ?? '?'; }

  private receive(brut: unknown): void {
    const m = brut as ServerMsg;
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
    switch (m.t) {
      case 'bienvenue':
        this.load(m.joueurs); this.clock(m); this.lastRanking = null; this.welcomed = true; this.held = null;
        if (m.spectateur) { this.me = null; this.jeton = ''; this.announce = 'Vous regardez la partie : choisissez un emplacement dans la liste.'; }
        else { this.me = m.id; this.jeton = m.jeton ?? ''; this.announce = this.players.size > 1 ? 'Trouvez les autres tireurs.' : 'Seul pour l’instant : en attente d’un autre tireur.'; }
        break;
      case 'arrive': this.players.set(m.joueur.id, m.joueur); this.announce = `${m.joueur.pseudo} entre dans la salle.`; break;
      case 'part': this.announce = `${this.nameOf(m.id)} quitte la salle.`; this.players.delete(m.id); break;
      case 'tir': { const j = this.players.get(m.id); if (j) j.tirs++; break; }
      case 'touche': {
        for (const s of m.scores) { const j = this.players.get(s.id); if (j) Object.assign(j, s); }
        const ou = m.zone === 'tete' ? 'à la tête' : 'au corps', abattu = m.abattu !== false;
        this.announce = m.tireur === this.me ? `${abattu ? 'Abattu' : 'Touché'} ${ou} : ${this.nameOf(m.cible)} à ${fr(m.dist)} m, +${m.points} points.`
          : `${this.nameOf(m.tireur)} ${abattu ? 'abat' : 'touche'} ${this.nameOf(m.cible)} à ${fr(m.dist)} m.`;
        if (abattu) {
          const qui = (id: number): string => { const j = this.players.get(id); return (j?.robot ? '🤖 ' : '') + (j?.pseudo ?? '?'); };
          this.kills.unshift({ texte: `${qui(m.tireur)} abat ${qui(m.cible)}${m.zone === 'tete' ? ', en pleine tête' : ''} · ${fr(m.dist)} m`, moi: m.tireur === this.me || m.cible === this.me });
          this.kills.length = Math.min(this.kills.length, 3);
        }
        break;
      }
      case 'retour': { const j = this.players.get(m.id); if (!j) return; j.emp = m.emp; j.vivant = true; j.vie = 2; break; }
      case 'votes': this.votes = m.votes; break;
      case 'vise': case 'diversion': break;
      // fin de manche : retour au salon pour une minute, avec le classement qui vient de tomber
      case 'fin': this.clock(m); this.lastRanking = m.classement; this.held = null; this.kills = []; this.announce = 'Manche terminée.'; break;
      case 'debut':
        this.load(m.joueurs); this.clock(m); this.votes = null; this.held = null; this.kills = []; delete this.myVote.vent; delete this.myVote.niveau;
        this.announce = `Nouvelle manche : ${NOMS[this.settings.niveau]}, ${texteVent(this.settings.vent)}.`;
        break;
      case 'complet': this.quit(); this.announce = 'La salle est complète (10 tireurs).'; break;
      case 'vide': this.quit(); this.announce = 'Plus aucun joueur dans la salle.'; break;
      default: return;
    }
    (this.emit as (t: string, m: unknown) => void).call(this, m.t, m);
    this.emit('change', undefined);
    if (m.t === 'fin') void this.refresh();
  }
}
