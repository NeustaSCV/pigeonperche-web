// Salon d'attente du mode en ligne, porté de src/ville/reseau.js. Le joueur y choisit son pseudo, voit les classements
// (dernière partie, salle, classement global), puis rejoint la partie ou la regarde en spectateur. Le salon revient
// pendant la minute qui sépare deux manches, avec le vote de la manche suivante. Module autonome : son élément, sa
// feuille de style ; il lit l'état dans la session (src/online/session.ts) et ne connaît rien du jeu.
import './online.css';
import { fr, mmss, nom, NOMS, texteVent, type Ligne, type Niveau, type Session } from './session';

/** Le sol dessiné de la carte, en dalles carrées de `cote` mètres, sur un carré de `taille` mètres d'origine (ox, oz). */
export interface PlanCarte { dalles: { image: CanvasImageSource; x0: number; z0: number }[]; cote: number; ox: number; oz: number; taille: number }
export interface PlanEmplacement { n: number; nom: string; x: number; z: number }

/**
 * Fond du salon : la carte vue de dessus, traitée en plan tactique (sol assombri et teinté, carroyage de 500 m repéré
 * par lettres et chiffres, échelle, nord) avec les emplacements numérotés et nommés.
 */
export function drawTacticalPlan(cv: HTMLCanvasElement, { dalles, cote, ox, oz, taille }: PlanCarte, EMP: PlanEmplacement[]): void {
  const PX = 2400, k = PX / taille, x = cv.getContext('2d')!; cv.width = cv.height = PX;
  const X = (wx: number) => (wx - ox) * k, Z = (wz: number) => (wz - oz) * k;
  // sol dessiné, ramené à une seule teinte sombre
  x.filter = 'grayscale(1) contrast(1.3) brightness(0.9)';
  for (const d of dalles) x.drawImage(d.image, X(d.x0), Z(d.z0), cote * k + 1, cote * k + 1);
  x.filter = 'none';
  x.globalCompositeOperation = 'multiply'; x.fillStyle = '#5f8f86'; x.fillRect(0, 0, PX, PX);
  x.globalCompositeOperation = 'source-over';
  // carroyage de 500 m, lettres en abscisse, chiffres en ordonnée
  const PAS = 500 * k, n = Math.ceil(PX / PAS);
  x.lineWidth = 1; x.font = '500 17px "Avenir Next", Avenir, "Helvetica Neue", sans-serif'; x.textBaseline = 'top';
  for (let i = 0; i <= n; i++) {
    x.strokeStyle = 'rgba(231, 181, 101, 0.32)'; x.beginPath(); x.moveTo(i * PAS, 0); x.lineTo(i * PAS, PX); x.moveTo(0, i * PAS); x.lineTo(PX, i * PAS); x.stroke();
    x.fillStyle = 'rgba(231, 181, 101, 0.5)';
    for (let j = 0; j < n; j++) if (i < n) x.fillText(String.fromCharCode(65 + i) + (j + 1), i * PAS + 6, j * PAS + 5);
  }
  // croix de repérage aux intersections
  x.strokeStyle = 'rgba(242, 237, 227, 0.4)';
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) { x.beginPath(); x.moveTo(i * PAS - 7, j * PAS); x.lineTo(i * PAS + 7, j * PAS); x.moveTo(i * PAS, j * PAS - 7); x.lineTo(i * PAS, j * PAS + 7); x.stroke(); }
  // emplacements : repère en cible, numéro, nom ; chaque nom prend la première place libre autour de son repère
  x.font = '600 19px "Avenir Next", Avenir, "Helvetica Neue", sans-serif'; x.textBaseline = 'middle';
  type Rect = [number, number, number, number];
  const pris: Rect[] = EMP.map((e) => [X(e.x) - 16, Z(e.z) - 16, 32, 32]);
  const libre = (r: Rect) => r[0] > 4 && r[1] > 4 && r[0] + r[2] < PX - 4 && r[1] + r[3] < PX - 4 && !pris.some((p) => r[0] < p[0] + p[2] && p[0] < r[0] + r[2] && r[1] < p[1] + p[3] && p[1] < r[1] + r[3]);
  for (const e of EMP) {
    const cx = X(e.x), cz = Z(e.z), txt = `${e.n} ${e.nom.toUpperCase()}`, w = x.measureText(txt).width + 12, h = 24;
    const essais: [number, number][] = [[cx + 18, cz - h / 2], [cx - 18 - w, cz - h / 2], [cx - w / 2, cz - 20 - h], [cx - w / 2, cz + 20], [cx + 14, cz - 14 - h], [cx + 14, cz + 14], [cx - 14 - w, cz - 14 - h], [cx - 14 - w, cz + 14]];
    const r: Rect = essais.map((p): Rect => [p[0], p[1], w, h]).find(libre) ?? [cx + 18, cz - h / 2, w, h]; pris.push(r);
    x.strokeStyle = 'rgba(8, 12, 12, 0.9)'; x.lineWidth = 5; x.beginPath(); x.arc(cx, cz, 9, 0, 6.283); x.stroke();
    x.strokeStyle = '#e7b565'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cz, 9, 0, 6.283); x.moveTo(cx - 15, cz); x.lineTo(cx - 4, cz); x.moveTo(cx + 4, cz); x.lineTo(cx + 15, cz); x.moveTo(cx, cz - 15); x.lineTo(cx, cz - 4); x.moveTo(cx, cz + 4); x.lineTo(cx, cz + 15); x.stroke();
    x.fillStyle = 'rgba(8, 12, 12, 0.72)'; x.fillRect(r[0], r[1], w, h);
    x.fillStyle = '#f2ede3'; x.fillText(txt, r[0] + 6, r[1] + h / 2 + 1);
  }
  // échelle et nord
  x.strokeStyle = x.fillStyle = '#f2ede3'; x.lineWidth = 2; const ex = PX - 60 - PAS, ey = PX - 50;
  x.beginPath(); x.moveTo(ex, ey - 7); x.lineTo(ex, ey); x.lineTo(ex + PAS, ey); x.lineTo(ex + PAS, ey - 7); x.stroke();
  x.font = '500 18px "Avenir Next", Avenir, "Helvetica Neue", sans-serif'; x.textBaseline = 'bottom'; x.fillText('500 m', ex + 8, ey - 6);
  x.beginPath(); x.moveTo(PX - 60, 100); x.lineTo(PX - 60, 46); x.lineTo(PX - 68, 62); x.moveTo(PX - 60, 46); x.lineTo(PX - 52, 62); x.stroke(); x.fillText('N', PX - 66, 40);
}

/**
 * Charge de quoi dessiner le plan sans attendre la carte du jeu : `meta.json`, `emplacements.json` et les dalles
 * `dessin_<ligne><colonne>.jpg` du dossier de la carte. Les emplacements sont ceux du fichier ; si le jeu en déplace
 * (grues, toits), mieux vaut lui passer les siens par `Lobby.setPlan`.
 */
export async function loadPlan(base = './ville/'): Promise<{ carte: PlanCarte; emplacements: PlanEmplacement[] }> {
  const json = <T>(f: string): Promise<T> => fetch(base + f).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(f))));
  const [meta, emp] = await Promise.all([json<{ taille: number; ox: number; oz: number; dalles: number }>('meta.json'), json<{ emplacements: PlanEmplacement[] }>('emplacements.json')]);
  const cote = meta.taille / meta.dalles, dalles: PlanCarte['dalles'] = [];
  const image = (url: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(url)); i.src = url; });
  await Promise.all(Array.from({ length: meta.dalles * meta.dalles }, async (_, q) => {
    const a = Math.floor(q / meta.dalles), b = q % meta.dalles;
    dalles.push({ image: await image(`${base}dessin_${a}${b}.jpg`), x0: meta.ox + b * cote, z0: meta.oz + a * cote });
  }));
  return { carte: { dalles, cote, ox: meta.ox, oz: meta.oz, taille: meta.taille }, emplacements: emp.emplacements };
}

export interface LobbyOptions {
  /** appareil tactile : saisie du pseudo au-dessus du clavier virtuel, défilement au doigt */
  touch?: boolean;
  /** pseudo proposé (par défaut : le dernier utilisé sur cet appareil) */
  pseudo?: string;
  /** adresse du bouton « ← Menu principal » */
  menuHref?: string;
  /** le salon vient d'apparaître ou de disparaître */
  onShow?: (visible: boolean) => void;
}

const CLE_PSEUDO = 'pp-pseudo';

export class Lobby {
  readonly el: HTMLElement;
  private readonly S: Record<string, HTMLElement> = {};
  private readonly pseudo: HTMLInputElement;
  private shown = false;
  private readonly timers: number[] = [];
  private readonly off: (() => void)[] = [];

  constructor(root: HTMLElement, private readonly session: Session, private readonly opt: LobbyOptions = {}) {
    const salon = (this.el = document.createElement('div')); salon.id = 'ol-salon'; salon.style.display = 'none';
    if (opt.touch) salon.classList.add('scroll');                  // le solo ne laisse défiler au doigt que les éléments .scroll (src/core/device.ts)
    // même charte que l'accueil du jeu : titre en capitales, cadre d'entrée, classements dessous ; le cadre du vote est un
    // enfant direct du salon, que la feuille de style place à droite sur ordinateur et entre les deux en colonne unique
    salon.innerHTML = `<canvas class="ol-plan"></canvas><div class="ol-gauche">
    <h1>Ville nouvelle</h1>
    <div class="ol-sub"><span>Multijoueur</span></div>
    <div class="ol-horloge" data-s="horloge"><div class="ol-temps" data-s="temps">–:––</div><div class="ol-quoi"><div class="ol-phase" data-s="phase">Connexion au serveur…</div><div class="ol-legende" data-s="etat"></div></div></div>
    <div class="ol-cadre"><span class="ol-cadre-t">Salon</span>
      <div class="ol-opt"><span>Pseudo</span><input data-s="pseudo" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Votre nom de tireur" /></div>
      <div class="ol-rang">
        <button class="ol-go" data-s="jouer">Rejoindre la partie</button>
        <button class="ol-lien" data-s="voir">Regarder en spectateur</button>
        <a class="ol-lien ol-menu" data-s="menu">← Menu principal</a>
      </div>
      <div class="ol-note" data-s="note"></div>
    </div>
  </div>
  <div class="ol-cadre ol-vote" data-s="vote"><span class="ol-cadre-t">Vote · manche suivante</span>
    <div class="ol-opt"><span>Vent</span><div class="ol-seg" data-s="vVent"><button data-v="non">Sans</button><button data-v="oui">Avec</button></div></div>
    <div class="ol-opt"><span>Étalement</span><div class="ol-seg" data-s="vNiveau"><button data-v="facile">Facile</button><button data-v="standard">Standard</button><button data-v="avance">Avancé</button></div></div>
    <div class="ol-note" data-s="vNote"></div>
  </div>
  <div class="ol-boards">
    <div class="ol-boards-h"><span>Classements</span></div>
    <div class="ol-boards-g">
      <section class="ol-derniere"><h3>Dernière partie</h3><div class="ol-entete"><span>Tireur</span><b>Points</b><i>Touches / tirs</i><u>Touché</u></div><ol data-s="pm"></ol></section>
      <section class="ol-salle"><h3 data-s="salleT">Dans la salle</h3><ol data-s="salle"></ol></section>
      <section class="ol-toujours"><h3>Classement global</h3><div><h4>Meilleurs scores</h4><ol data-s="tm"></ol></div><div><h4>Pires scores</h4><ol data-s="tp"></ol></div></section>
    </div>
  </div>
  <p class="ol-avert">Avertissement : ce jeu vous est proposé à but ludique uniquement. Dans la vraie vie, ne tirez pas sur vos amis.</p>`;
    for (const e of salon.querySelectorAll<HTMLElement>('[data-s]')) this.S[e.dataset.s!] = e;
    const S = this.S, pseudo = (this.pseudo = S.pseudo as HTMLInputElement);
    (S.menu as HTMLAnchorElement).href = opt.menuHref ?? './index.html';
    let connu = opt.pseudo ?? '';
    try { connu ||= localStorage.getItem(CLE_PSEUDO) || ''; } catch { /* stockage indisponible */ }
    pseudo.value = connu;
    root.appendChild(salon);

    S.vVent.onclick = (ev) => { const v = (ev.target as HTMLElement).dataset?.v; if (v) session.vote({ vent: v === 'oui' }); };
    S.vNiveau.onclick = (ev) => { const v = (ev.target as HTMLElement).dataset?.v; if (v) session.vote({ niveau: v as Niveau }); };
    pseudo.addEventListener('input', () => this.draw());
    // les touches tapées dans le champ ne doivent pas atteindre le jeu
    pseudo.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && !(S.jouer as HTMLButtonElement).disabled) S.jouer.click(); });
    pseudo.addEventListener('keyup', (ev) => ev.stopPropagation());
    S.jouer.onclick = () => { const p = pseudo.value.trim(); try { localStorage.setItem(CLE_PSEUDO, p); } catch { /* sans importance */ } session.join(p); };
    S.voir.onclick = () => session.watch();

    if (opt.touch) {
      // saisie du pseudo sans que le clavier virtuel masque le champ ni le bouton
      for (const [k, v] of [['enterkeyhint', 'go'], ['autocapitalize', 'words'], ['autocorrect', 'off']]) pseudo.setAttribute(k, v);
      let fin = 0;
      // pendant la saisie, le salon ne garde que le cadre d'entrée, remonté en haut de l'écran
      pseudo.addEventListener('focus', () => { clearTimeout(fin); salon.classList.add('saisie'); salon.scrollTop = 0; });
      // on attend la fin du toucher en cours avant de tout remettre en place : le bouton visé ne doit pas se dérober
      pseudo.addEventListener('blur', () => { fin = window.setTimeout(() => salon.classList.remove('saisie'), 350); });
      pseudo.addEventListener('keydown', (e) => { if (e.key === 'Enter') pseudo.blur(); });
    }

    this.off.push(session.on('change', () => { this.show(session.inLobby); this.draw(); }));
    void session.refresh();
    this.timers.push(window.setInterval(() => { if (this.shown) void session.refresh(); }, 3000), window.setInterval(() => this.draw(), 500));
    this.show(session.inLobby);
    this.draw();
  }

  get visible(): boolean { return this.shown; }

  /** Affiche ou masque le salon. Il suit de lui-même la session (`session.inLobby`) à chacun de ses changements. */
  show(oui: boolean): void {
    if (oui === this.shown) return;
    if (oui && document.pointerLockElement) document.exitPointerLock();      // le salon se manie au pointeur : on libère la souris
    this.shown = oui; this.el.style.display = oui ? '' : 'none';
    this.opt.onShow?.(oui);
  }

  /** Dessine le plan tactique en fond (dès que les dalles de la carte sont chargées). */
  setPlan(carte: PlanCarte, emplacements: PlanEmplacement[]): void {
    try { drawTacticalPlan(this.el.querySelector<HTMLCanvasElement>('.ol-plan')!, carte, emplacements); } catch (e) { console.warn('plan du salon :', e); }
  }

  draw(): void {
    if (!this.shown) return;
    const s = this.session, S = this.S, resume = s.summary, role = s.role, phase = s.phase, serveur = s.server;
    const reste = s.remaining(), n = resume?.connectes ?? 0;
    this.pseudo.disabled = role !== null;
    // l'horloge : le temps en grand, et ce qu'il compte, pour qu'on voie tout de suite si une partie est en cours
    const tireurs = `${n} tireur${n > 1 ? 's' : ''}`;
    S.horloge.className = 'ol-horloge ' + (!serveur ? 'hors' : phase);
    S.temps.textContent = serveur ? mmss(reste) : '–:––';
    S.phase.textContent = !serveur ? 'Serveur de manche indisponible' : phase === 'jeu' ? 'Partie en cours' : 'Entre deux parties';
    S.etat.textContent = !serveur ? '' : phase === 'jeu' ? `avant la fin de la partie · ${tireurs} en jeu` : `avant la prochaine partie · ${tireurs} dans la salle`;
    S.salleT.textContent = phase === 'jeu' ? 'Partie en cours' : 'Dans la salle';
    const p = this.pseudo.value.trim(), humains = (resume?.humains ?? 0) >= 1;
    (S.jouer as HTMLButtonElement).disabled = !serveur || role !== null || p.length < 2 || (!!resume && resume.places < 1);
    (S.voir as HTMLButtonElement).disabled = !serveur || role !== null || !humains;
    S.jouer.textContent = role === 'joueur' ? 'Inscrit' : 'Rejoindre la partie';
    S.voir.textContent = role === 'spectateur' ? 'Spectateur' : 'Regarder en spectateur';
    S.note.textContent = role === 'joueur' ? `Vous êtes inscrit : la manche commence dans ${mmss(reste)}.`
      : role === 'spectateur' ? `Vous regarderez la manche qui commence dans ${mmss(reste)}.`
      : !serveur ? '' : resume && resume.places < 1 ? 'La salle est complète (10 tireurs).'
      : p.length < 2 ? 'Choisissez un pseudo pour rejoindre la partie.'
      : !humains ? 'Le mode spectateur s’ouvre dès qu’un joueur est dans la salle.' : '';
    // vote : offert aux joueurs inscrits, pendant la minute de salon ; sans voix sur le vent, la manche se joue sans
    // (server/manche.mjs) : « Sans » est donc montré comme le choix par défaut tant que le joueur n'a pas voté
    const vote = role === 'joueur' && phase === 'pause'; S.vote.style.display = vote ? 'flex' : 'none'; this.el.classList.toggle('vote', vote);
    if (vote) {
      const d = s.votes ?? resume?.votes;
      for (const b of S.vVent.children as HTMLCollectionOf<HTMLElement>) { const k = d?.vent?.[b.dataset.v as 'oui' | 'non'] ?? 0; b.classList.toggle('sel', s.myVote.vent === (b.dataset.v === 'oui')); b.classList.toggle('defaut', s.myVote.vent === undefined && b.dataset.v === 'non'); b.dataset.n = k ? String(k) : ''; }
      for (const b of S.vNiveau.children as HTMLCollectionOf<HTMLElement>) { const k = d?.niveau?.[b.dataset.v as Niveau] ?? 0; b.classList.toggle('sel', s.myVote.niveau === b.dataset.v); b.classList.toggle('defaut', s.myVote.niveau === undefined && b.dataset.v === 'facile'); b.dataset.n = k ? String(k) : ''; }
      S.vNote.textContent = `En cours : ${NOMS[s.settings.niveau]}, ${texteVent(s.settings.vent)}. La majorité l’emporte ; à égalité, rien ne change. Sans vote : facile, sans vent.`;
    }
    const c = s.lastRanking ?? resume?.precedente?.classement ?? [];
    // la dernière partie : le tableau complet, du meilleur au pire, avec le nombre de fois où chacun a été touché
    html(S.pm, c.length ? c.map((j) => `<li><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i><u>${j.subies ?? 0} fois</u></li>`).join('') : '<li class="vide">Aucune partie jouée pour l’instant.</li>');
    liste(S.tm, resume?.meilleurs, 'Aucun score enregistré.'); liste(S.tp, resume?.pires, '—');
    liste(S.salle, role ? s.ranking() : resume?.joueurs, 'Personne pour l’instant.');
  }

  destroy(): void {
    for (const t of this.timers) clearInterval(t);
    for (const f of this.off) f();
    this.el.remove();
  }
}

/** Ne réécrit l'élément que si son contenu change (le salon est redessiné deux fois par seconde). */
const ecrit = new WeakMap<HTMLElement, string>();
const html = (el: HTMLElement, h: string): void => { if (ecrit.get(el) !== h) { ecrit.set(el, h); el.innerHTML = h; } };
const liste = (el: HTMLElement, l: Ligne[] | null | undefined, vide: string): void =>
  html(el, l?.length ? l.map((j) => `<li><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i></li>`).join('') : `<li class="vide">${vide}</li>`);
