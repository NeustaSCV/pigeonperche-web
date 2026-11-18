// Ville nouvelle : salon d'attente et liaison avec la manche multijoueur du serveur (server/manche.mjs).
// Le joueur arrive dans le salon : il choisit son pseudo, voit les classements (partie précédente, records de
// toujours), puis rejoint la partie ou la regarde en spectateur (la carte hors ligne reste accessible par ?solo). Le salon revient pendant la minute qui sépare deux
// manches. Flux d'événements du serveur vers la page, petites requêtes POST dans l'autre sens.
const fr = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Pseudo affiché : les tireurs automatiques portent un robot devant leur nom. */
const nom = (j) => (j?.robot ? '🤖 ' : '') + esc(j?.pseudo ?? '?');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * Fond du salon : la carte vue de dessus, traitée en plan tactique (sol assombri et teinté, carroyage de 500 m repéré
 * par lettres et chiffres, échelle, nord) avec les emplacements numérotés et nommés.
 */
function planTactique(cv, { dalles, cote, ox, oz, taille }, EMP) {
  const PX = 2400, k = PX / taille, x = cv.getContext('2d'); cv.width = cv.height = PX;
  const X = (wx) => (wx - ox) * k, Z = (wz) => (wz - oz) * k;
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
  const pris = EMP.map((e) => [X(e.x) - 16, Z(e.z) - 16, 32, 32]);
  const libre = (r) => r[0] > 4 && r[1] > 4 && r[0] + r[2] < PX - 4 && r[1] + r[3] < PX - 4 && !pris.some((p) => r[0] < p[0] + p[2] && p[0] < r[0] + r[2] && r[1] < p[1] + p[3] && p[1] < r[1] + r[3]);
  for (const e of EMP) {
    const cx = X(e.x), cz = Z(e.z), txt = `${e.n} ${e.nom.toUpperCase()}`, w = x.measureText(txt).width + 12, h = 24;
    const essais = [[cx + 18, cz - h / 2], [cx - 18 - w, cz - h / 2], [cx - w / 2, cz - 20 - h], [cx - w / 2, cz + 20], [cx + 14, cz - 14 - h], [cx + 14, cz + 14], [cx - 14 - w, cz - 14 - h], [cx - 14 - w, cz + 14]];
    const r = essais.map((p) => [p[0], p[1], w, h]).find(libre) ?? [cx + 18, cz - h / 2, w, h]; pris.push(r);
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

export function installReseau({ EMP, state, allerA, tir, sel, carte, effets, sons = null }) {
  const params = new URLSearchParams(location.search);
  if (params.get('solo') !== null) return null;
  let pseudo = params.get('pseudo') || '';
  try { pseudo ||= localStorage.getItem('pp-pseudo') || ''; } catch { /* stockage indisponible */ }
  const joueurs = new Map(); let moi = null, jeton = '', flux = null, role = null;       // role : null (salon), 'joueur', 'spectateur'
  let phase = 'jeu', echeance = 0, resume = null, serveur = true, annonce = '', dernierClassement = null;
  let reglages = { niveau: 'standard', vent: null }, votes = null; const monVote = {};
  const ROSE = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  const NOMS = { facile: 'facile (15 emplacements serrés)', standard: 'standard (25 emplacements)', avance: 'avancé (toute la carte)' };
  const texteVent = (v) => (v ? `vent de ${String(v.vitesse).replace('.', ',')} m/s venant du ${ROSE[Math.round(v.de / 45) % 8]}` : 'sans vent');

  // ---------- éléments ----------
  const box = document.createElement('div'); box.id = 'manche'; box.style.display = 'none'; document.body.appendChild(box);
  const jauge = document.createElement('div'); jauge.id = 'vie'; jauge.style.display = 'none'; document.body.appendChild(jauge);
  const voile = document.createElement('div'); voile.id = 'couche'; voile.style.display = 'none'; document.body.appendChild(voile);
  const salon = document.createElement('div'); salon.id = 'salon'; document.body.appendChild(salon);
  // même mise en page que l'accueil du jeu : titre en capitales, cadre d'entrée à gauche, panneau des classements à droite
  salon.innerHTML = `<canvas class="s-plan"></canvas><div class="s-gauche">
    <h1>Ville nouvelle</h1>
    <div class="s-sub"><span>Multijoueur</span></div>
    <div class="s-horloge" data-s="horloge"><div class="s-temps" data-s="temps">–:––</div><div class="s-quoi"><div class="s-phase" data-s="phase">Connexion au serveur…</div><div class="s-legende" data-s="etat"></div></div></div>
    <div class="s-cadre"><span class="s-cadre-t">Salon</span>
      <div class="s-opt"><span>Pseudo</span><input data-s="pseudo" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Votre nom de tireur" /></div>
      <div class="s-rang">
        <button class="s-go" data-s="jouer">Rejoindre la partie</button>
        <button class="s-lien" data-s="voir">Regarder en spectateur</button>
      </div>
      <div class="s-note" data-s="note"></div>
    </div>
    <div class="s-cadre s-vote" data-s="vote"><span class="s-cadre-t">Vote · manche suivante</span>
      <div class="s-opt"><span>Vent</span><div class="s-seg" data-s="vVent"><button data-v="non">Sans</button><button data-v="oui">Avec</button></div></div>
      <div class="s-opt"><span>Étalement</span><div class="s-seg" data-s="vNiveau"><button data-v="facile">Facile</button><button data-v="standard">Standard</button><button data-v="avance">Avancé</button></div></div>
      <div class="s-note" data-s="vNote"></div>
    </div>
  </div>
  <div class="s-boards">
    <div class="s-boards-h"><span>Classements</span></div>
    <div class="s-boards-g">
      <section class="s-derniere"><h3>Dernière partie</h3><div class="s-entete"><span>Tireur</span><b>Points</b><i>Touches / tirs</i><u>Touché</u></div><ol data-s="pm"></ol></section>
      <section class="s-salle"><h3 data-s="salleT">Dans la salle</h3><ol data-s="salle"></ol></section>
      <section class="s-toujours"><h3>Classement global</h3><div><h4>Meilleurs scores</h4><ol data-s="tm"></ol></div><div><h4>Pires scores</h4><ol data-s="tp"></ol></div></section>
    </div>
  </div>
  <p class="s-avert">Avertissement : ce jeu vous est proposé à but ludique uniquement. Dans la vraie vie, ne tirez pas sur vos amis.</p>`;
  if (carte) { try { planTactique(salon.querySelector('.s-plan'), carte, EMP); } catch (e) { console.warn('plan du salon :', e); } }
  const S = Object.fromEntries([...salon.querySelectorAll('[data-s]')].map((e) => [e.dataset.s, e]));
  S.pseudo.value = pseudo;

  // ---------- salon ----------
  const liste = (el, l, vide) => { el.innerHTML = l?.length ? l.map((j) => `<li><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i></li>`).join('') : `<li class="vide">${vide}</li>`; };
  const salonVisible = () => salon.style.display !== 'none';
  const montreSalon = (oui) => { if (oui && document.pointerLockElement) document.exitPointerLock();      // le salon se manie au pointeur : on libère la souris
    salon.style.display = oui ? 'grid' : 'none'; document.body.classList.toggle('au-salon', oui); state.salon = oui; if (oui) { state.scope = false; S.pseudo.disabled = role !== null; } };
  const dessineSalon = () => {
    if (!salonVisible()) return;
    const reste = echeance - performance.now(), n = resume?.connectes ?? 0;
    // l'horloge : le temps en grand, et ce qu'il compte, pour qu'on voie tout de suite si une partie est en cours
    const tireurs = `${n} tireur${n > 1 ? 's' : ''}`;
    S.horloge.className = 's-horloge ' + (!serveur ? 'hors' : phase);
    S.temps.textContent = serveur ? mmss(reste) : '–:––';
    S.phase.textContent = !serveur ? 'Serveur de manche indisponible' : phase === 'jeu' ? 'Partie en cours' : 'Entre deux parties';
    S.etat.textContent = !serveur ? '' : phase === 'jeu' ? `avant la fin de la partie · ${tireurs} en jeu` : `avant la prochaine partie · ${tireurs} dans la salle`;
    S.salleT.textContent = phase === 'jeu' ? 'Partie en cours' : 'Dans la salle';
    const p = S.pseudo.value.trim();
    S.jouer.disabled = !serveur || role !== null || p.length < 2 || (resume && resume.places < 1);
    S.voir.disabled = !serveur || role !== null || !(resume?.humains >= 1);
    S.jouer.textContent = role === 'joueur' ? 'Inscrit' : 'Rejoindre la partie';
    S.voir.textContent = role === 'spectateur' ? 'Spectateur' : 'Regarder en spectateur';
    S.note.textContent = role === 'joueur' ? `Vous êtes inscrit : la manche commence dans ${mmss(reste)}.`
      : role === 'spectateur' ? `Vous regarderez la manche qui commence dans ${mmss(reste)}.`
      : !serveur ? '' : resume && resume.places < 1 ? 'La salle est complète (10 tireurs).'
      : p.length < 2 ? 'Choisissez un pseudo pour rejoindre la partie.'
      : !(resume?.humains >= 1) ? 'Le mode spectateur s’ouvre dès qu’un joueur est dans la salle.' : '';
    // vote : offert aux joueurs inscrits, pendant la minute de salon
    const vote = role === 'joueur' && phase === 'pause'; S.vote.style.display = vote ? 'flex' : 'none';
    if (vote) {
      const d = votes ?? resume?.votes;
      for (const b of S.vVent.children) { const n = d?.vent?.[b.dataset.v] ?? 0; b.classList.toggle('sel', monVote.vent === (b.dataset.v === 'oui')); b.dataset.n = n || ''; }
      for (const b of S.vNiveau.children) { const n = d?.niveau?.[b.dataset.v] ?? 0; b.classList.toggle('sel', monVote.niveau === b.dataset.v); b.dataset.n = n || ''; }
      S.vNote.textContent = `En cours : ${NOMS[reglages.niveau]}, ${texteVent(reglages.vent)}. La majorité l’emporte ; à égalité, rien ne change.`;
    }
    const c = dernierClassement ?? resume?.precedente?.classement ?? [];
    // la dernière partie : le tableau complet, du meilleur au pire, avec le nombre de fois où chacun a été touché
    S.pm.innerHTML = c.length ? c.map((j) => `<li><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i><u>${j.subies ?? 0} fois</u></li>`).join('') : '<li class="vide">Aucune partie jouée pour l’instant.</li>';
    liste(S.tm, resume?.meilleurs, 'Aucun score enregistré.'); liste(S.tp, resume?.pires, '—');
    liste(S.salle, role ? [...joueurs.values()].sort((a, b) => b.points - a.points) : resume?.joueurs, 'Personne pour l’instant.');
  };
  const lisEtat = () => fetch('./api/manche/etat').then((r) => (r.ok ? r.json() : Promise.reject())).then((e) => {
    serveur = true; resume = e; if (!role) { phase = e.phase; echeance = performance.now() + e.reste; }
  }).catch(() => { serveur = false; }).then(dessineSalon);
  lisEtat(); setInterval(() => { if (salonVisible()) lisEtat(); }, 3000); setInterval(() => { dessineSalon(); tableau(); }, 500);
  // compte à rebours des trois dernières secondes du salon, pour ceux qui sont inscrits
  let dernierTop = 0; setInterval(() => { if (!role || phase !== 'pause') { dernierTop = 0; return; } const s = Math.ceil((echeance - performance.now()) / 1000); if (s >= 1 && s <= 3 && s !== dernierTop) { dernierTop = s; sons?.top(false); } }, 100);
  const voter = (choix) => { Object.assign(monVote, choix); dessineSalon(); fetch('./api/manche/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: moi, jeton, ...choix }) }).catch(() => {}); };
  S.vVent.onclick = (ev) => { const v = ev.target.dataset?.v; if (v) voter({ vent: v === 'oui' }); };
  S.vNiveau.onclick = (ev) => { const v = ev.target.dataset?.v; if (v) voter({ niveau: v }); };
  S.pseudo.addEventListener('input', dessineSalon);
  S.pseudo.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && !S.jouer.disabled) S.jouer.click(); });
  S.pseudo.addEventListener('keyup', (ev) => ev.stopPropagation());
  S.jouer.onclick = () => { pseudo = S.pseudo.value.trim(); try { localStorage.setItem('pp-pseudo', pseudo); } catch { /* sans importance */ } rejoindre('joueur'); };
  S.voir.onclick = () => rejoindre('spectateur');

  // ---------- manche ----------
  const majOccupes = () => {
    state.occupes = new Set([...joueurs.values()].filter((j) => j.id !== moi && j.vivant).map((j) => j.emp));
    for (const e of EMP) if (e.figure) e.figure.visible = e.nom !== state.post && state.occupes.has(e.nom);
  };
  function tableau() {
    // jauge de vie du joueur : deux points (corps : un point, tête : les deux)
    const m0 = role === 'joueur' ? joueurs.get(moi) : null;
    jauge.style.display = m0 && !state.salon ? 'flex' : 'none';
    if (m0) jauge.innerHTML = '<span>Vie</span>' + [1, 2].map((k) => `<i class="${(m0.vivant ? m0.vie ?? 2 : 0) >= k ? 'on' : ''}"></i>`).join('');
    if (!role) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    const l = [...joueurs.values()].sort((a, b) => b.points - a.points);
    if (state.tactile) { box.innerHTML = tableauTactile(l); return; }
    box.innerHTML = `<b>${phase === 'jeu' ? 'Manche' : 'Salon'}</b> · ${mmss(echeance - performance.now())}${role === 'spectateur' ? ' · spectateur' : ''}` +
      l.map((j) => `<div class="${j.id === moi ? 'moi' : ''}${j.vivant ? '' : ' hs'}"><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i></div>`).join('') + `<small>${esc(texteVent(reglages.vent))[0].toUpperCase() + esc(texteVent(reglages.vent)).slice(1)}.<br>${esc(annonce)}</small>`;
  }
  // Au doigt, le tableau est replié : une ligne pour le temps restant et ses propres points, une pour le vent. Un toucher
  // le déplie (classement complet, dernière annonce, retour au menu), un autre le replie (tactile.js).
  const tableauTactile = (l) => {
    const v = reglages.vent, vent = v ? `Vent ${String(v.vitesse).replace('.', ',')} m/s · ${ROSE[Math.round(v.de / 45) % 8]}` : 'Sans vent', m = joueurs.get(moi);
    const tete = `<button class="m-resume" data-tb="manche" aria-expanded="${!!state.mancheOuverte}"><span><b>${phase === 'jeu' ? 'Manche' : 'Salon'}</b> · ${mmss(echeance - performance.now())}</span><u>${m ? fr(m.points) + ' pts' : role === 'spectateur' ? 'spectateur' : ''}</u><i>${state.mancheOuverte ? '▴' : '▾'}</i><em>${vent}</em></button>`;
    if (!state.mancheOuverte) return tete;
    return tete + `<div class="m-corps">` + l.map((j) => `<div class="${j.id === moi ? 'moi' : ''}${j.vivant ? '' : ' hs'}"><span>${nom(j)}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i></div>`).join('')
      + `<small>${esc(annonce)}</small><a class="m-menu" href="./index.html">← Menu du jeu</a></div>`;
  };
  const nomDe = (id) => joueurs.get(id)?.pseudo ?? '?';
  const joueurA = (emp) => [...joueurs.values()].find((j) => j.emp === emp && j.id !== moi && j.vivant);
  state.pseudoA = (emp) => { const j = joueurA(emp); return j ? (j.robot ? '🤖 ' : '') + j.pseudo : ''; };
  const horloge = (m) => { phase = m.phase; echeance = performance.now() + m.reste; state.pause = phase !== 'jeu'; if (m.reglages) { reglages = m.reglages; state.vent = reglages.vent; } if (m.votes) votes = m.votes; };
  const charge = (l) => { joueurs.clear(); for (const j of l) joueurs.set(j.id, j); };
  const releve = () => { state.couche = false; voile.style.display = 'none'; };

  const sur = {
    bienvenue(m) {
      charge(m.joueurs); horloge(m); dernierClassement = null;
      document.body.classList.toggle('spectateur', !!m.spectateur);
      if (m.spectateur) { moi = null; state.enLigne = false; state.spectateur = true; sel.disabled = false; annonce = 'Vous regardez la partie : choisissez un emplacement dans la liste.'; }
      else { moi = m.id; jeton = m.jeton; state.enLigne = true; state.spectateur = false; sel.disabled = true; annonce = joueurs.size > 1 ? 'Trouvez les autres tireurs.' : 'Seul pour l’instant : en attente d’un autre tireur.'; allerA(joueurs.get(moi).emp, true); }
      majOccupes(); montreSalon(phase !== 'jeu');
    },
    arrive(m) { joueurs.set(m.joueur.id, m.joueur); annonce = `${m.joueur.pseudo} entre dans la salle.`; majOccupes(); },
    part(m) { annonce = `${nomDe(m.id)} quitte la salle.`; joueurs.delete(m.id); majOccupes(); },
    // tir d'un autre : traçante, flamme et détonation depuis son emplacement
    tir(m) {
      const j = joueurs.get(m.id); if (j) j.tirs++;
      if (!effets || !m.emp || state.salon) return;
      if (m.dir) effets.tirDistant(m.emp, m.dir); else if (m.vers) effets.tirRobot(m.emp, m.vers, m.touche);
    },
    touche(m) {
      for (const s of m.scores) { const j = joueurs.get(s.id); if (j) Object.assign(j, s); }
      tir.effetTouche(m.emp, m.dist, m.abattu !== false);
      // la voix de celui qui encaisse : toute proche si c'est nous, au loin si c'est notre touche (rien pour les touches des autres)
      if (m.cible === moi) sons?.touche(); else if (m.tireur === moi) sons?.toucheAuLoin(m.dist);
      const ou = m.zone === 'tete' ? 'à la tête' : 'au corps';
      if (m.cible === moi && m.abattu !== false) { state.couche = true; state.scope = false; if (document.pointerLockElement) document.exitPointerLock(); voile.className = ''; voile.style.display = 'grid'; voile.innerHTML = `<div>Abattu par <b>${nom(joueurs.get(m.tireur))}</b><br>${ou}, à ${fr(m.dist)} m<br><small>Retour dans 5 secondes, sur un autre emplacement.</small></div>`; }
      else if (m.cible === moi) { voile.className = 'eclair'; voile.style.display = 'grid'; voile.innerHTML = `<div>Touché ${ou} par <b>${nom(joueurs.get(m.tireur))}</b></div>`; setTimeout(() => { if (!state.couche) voile.style.display = 'none'; }, 900); }      // encore debout : un éclair rouge
      const fait = m.abattu !== false ? 'abat' : 'touche';
      annonce = m.tireur === moi ? `${m.abattu !== false ? 'Abattu' : 'Touché'} ${ou} : ${nomDe(m.cible)} à ${fr(m.dist)} m, +${m.points} points.` : `${nomDe(m.tireur)} ${fait} ${nomDe(m.cible)} à ${fr(m.dist)} m.`;
      if (m.tireur === moi) tir.etat.msg = `${m.abattu !== false ? 'Abattu' : 'Touché'} ${ou} · ${nomDe(m.cible)} · ${fr(m.dist)} m · +${m.points} points`;
      majOccupes();
    },
    retour(m) {
      const j = joueurs.get(m.id); if (!j) return; j.emp = m.emp; j.vivant = true; j.vie = 2;
      if (m.id === moi) { releve(); allerA(m.emp, true); }
      majOccupes();
    },
    // reflet de lunette : ce tireur nous tient (ou ne nous tient plus) dans sa lunette
    votes(m) { votes = m.votes; },
    vise(m) { const j = joueurs.get(m.par); if (j) tir.reflet(j.emp, m.actif); },
    // fin de manche : retour au salon pour une minute, avec le classement qui vient de tomber
    fin(m) { if (role) sons?.finManche(); tir.eteindreReflets(); horloge(m); dernierClassement = m.classement; releve(); annonce = 'Manche terminée.'; montreSalon(true); lisEtat(); },
    debut(m) {
      if (role) { sons?.top(true); setTimeout(() => sons?.debutManche(), 600); }      // le top de départ, puis les trois notes
      charge(m.joueurs); horloge(m); releve(); votes = null; delete monVote.vent; delete monVote.niveau;
      annonce = `Nouvelle manche : ${NOMS[reglages.niveau]}, ${texteVent(reglages.vent)}.`;
      if (moi != null && joueurs.get(moi)) allerA(joueurs.get(moi).emp, true);      // chacun est replacé au hasard dans la zone
      majOccupes(); montreSalon(false);
    },
    complet() { annonce = 'La salle est complète (10 tireurs).'; quitter(); },
    vide() { annonce = 'Plus aucun joueur dans la salle.'; quitter(); },
  };

  function quitter() {
    if (flux) { flux.close(); flux = null; }
    document.body.classList.remove('spectateur'); role = null; moi = null; state.vent = null; state.enLigne = false; state.spectateur = false; state.occupes = null; state.pause = false; releve(); sel.disabled = false; joueurs.clear();
    for (const e of EMP) if (e.figure) e.figure.visible = e.nom !== state.post;
    tableau();
  }
  function rejoindre(r) {
    if (role) return;
    role = r;
    flux = new EventSource('./api/manche/flux?' + (r === 'spectateur' ? 'role=spectateur' : 'pseudo=' + encodeURIComponent(pseudo)));
    flux.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } sur[m.t]?.(m); tableau(); dessineSalon(); };
    // connexion perdue ou refusée : retour au salon
    flux.onerror = () => { quitter(); annonce = 'Connexion à la manche perdue.'; montreSalon(true); lisEtat(); };
    dessineSalon();
  }

  // chaque tir part au serveur ; s'il atteint un joueur, on l'annonce avec la distance et le temps de vol
  const annonceTir = (res, dir) => {
    if (!state.enLigne) return;
    const c = res.touche ? joueurA(res.touche.nom) : null;
    fetch('./api/manche/tir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: moi, jeton, dir, ...(c ? { cible: c.id, dist: res.dist, tof: res.tof, zone: res.zone } : {}) }) }).catch(() => {});
  };
  if (effets) effets.surTirReseau = annonceTir; else tir.etat.surTir = (res) => annonceTir(res);
  // on signale au serveur le joueur qu'on tient dans sa lunette : lui seul verra notre reflet
  let tenu = null;
  setInterval(() => {
    if (!state.enLigne) { tenu = null; return; }
    const e = state.scope && !state.couche && !state.pause ? tir.vise() : null, c = e ? joueurA(e.nom) : null, id = c ? c.id : null;
    if (id === tenu) return; tenu = id;
    fetch('./api/manche/vise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: moi, jeton, cible: id }) }).catch(() => {});
  }, 300);
  montreSalon(true);
  if (params.get('auto') !== null && pseudo) rejoindre(params.get('auto') === 'spectateur' ? 'spectateur' : 'joueur');   // contrôles automatisés
  return { joueurs, tableau, moi: () => moi, role: () => role, phase: () => phase, majOccupes, rejoindre, quitter };
}
