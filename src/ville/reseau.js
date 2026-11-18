// Ville nouvelle : liaison avec la manche multijoueur du serveur (server/manche.mjs). Flux d'événements dans un sens,
// petites requêtes POST dans l'autre. Sans serveur de manche, la page reste en mode visite (toutes les silhouettes).
const fr = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function installReseau({ EMP, state, allerA, tir, sel }) {
  const params = new URLSearchParams(location.search);
  if (params.get('solo') !== null) return null;
  let pseudo = params.get('pseudo') || '';
  try { pseudo ||= localStorage.getItem('pp-pseudo') || ''; } catch { /* stockage indisponible */ }
  const joueurs = new Map(); let moi = null, jeton = '';
  const box = document.createElement('div'); box.id = 'manche'; document.body.appendChild(box);
  const voile = document.createElement('div'); voile.id = 'couche'; voile.style.display = 'none'; document.body.appendChild(voile);
  let annonce = 'Connexion à la manche…';

  const majOccupes = () => {
    state.occupes = new Set([...joueurs.values()].filter((j) => j.id !== moi && j.vivant).map((j) => j.emp));
    for (const e of EMP) if (e.figure) e.figure.visible = e.nom !== state.post && state.occupes.has(e.nom);
  };
  const tableau = () => {
    const l = [...joueurs.values()].sort((a, b) => b.points - a.points);
    box.innerHTML = `<b>Manche</b> · ${l.length} tireur${l.length > 1 ? 's' : ''}` + l.map((j) => `<div class="${j.id === moi ? 'moi' : ''}${j.vivant ? '' : ' hs'}"><span>${j.pseudo}</span><b>${fr(j.points)}</b><i>${j.touches}/${j.tirs}</i></div>`).join('') + `<small>${annonce}</small>`;
  };
  const nomDe = (id) => joueurs.get(id)?.pseudo ?? '?';
  const joueurA = (emp) => [...joueurs.values()].find((j) => j.emp === emp && j.id !== moi && j.vivant);
  state.pseudoA = (emp) => joueurA(emp)?.pseudo ?? '';

  const sur = {
    bienvenue(m) {
      moi = m.id; jeton = m.jeton; joueurs.clear(); for (const j of m.joueurs) joueurs.set(j.id, j);
      state.enLigne = true; sel.disabled = true; annonce = joueurs.size > 1 ? 'Trouvez les autres tireurs.' : 'Seul pour l’instant : en attente d’un autre tireur.';
      allerA(joueurs.get(moi).emp, true); majOccupes();
    },
    arrive(m) { joueurs.set(m.joueur.id, m.joueur); annonce = `${m.joueur.pseudo} entre dans la manche.`; majOccupes(); },
    part(m) { annonce = `${nomDe(m.id)} quitte la manche.`; joueurs.delete(m.id); majOccupes(); },
    tir(m) { const j = joueurs.get(m.id); if (j) j.tirs++; },
    touche(m) {
      for (const s of m.scores) { const j = joueurs.get(s.id); if (j) Object.assign(j, s); }
      tir.effetTouche(m.emp, m.dist);
      if (m.cible === moi) { state.couche = true; state.scope = false; voile.style.display = 'grid'; voile.innerHTML = `<div>Touché par <b>${nomDe(m.tireur)}</b><br>à ${fr(m.dist)} m<br><small>Retour dans 5 secondes, sur un autre emplacement.</small></div>`; }
      annonce = m.tireur === moi ? `Touché : ${nomDe(m.cible)} à ${fr(m.dist)} m, +${m.points} points.` : `${nomDe(m.tireur)} touche ${nomDe(m.cible)} à ${fr(m.dist)} m.`;
      if (m.tireur === moi) tir.etat.msg = `Touché · ${nomDe(m.cible)} · ${fr(m.dist)} m · +${m.points} points`;
      majOccupes();
    },
    retour(m) {
      const j = joueurs.get(m.id); if (!j) return; j.emp = m.emp; j.vivant = true;
      if (m.id === moi) { state.couche = false; voile.style.display = 'none'; allerA(m.emp, true); }
      majOccupes();
    },
    complet() { annonce = 'La manche est complète (10 tireurs) : mode visite.'; state.enLigne = false; },
  };

  const flux = new EventSource('./api/manche/flux?pseudo=' + encodeURIComponent(pseudo));
  flux.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } sur[m.t]?.(m); tableau(); };
  flux.onerror = () => {
    // pas de serveur de manche, ou connexion perdue : retour au mode visite
    if (state.enLigne || moi === null) { flux.close(); state.enLigne = false; state.occupes = null; state.couche = false; voile.style.display = 'none'; sel.disabled = false; for (const e of EMP) if (e.figure) e.figure.visible = e.nom !== state.post; annonce = 'Hors ligne : mode visite.'; joueurs.clear(); tableau(); }
  };

  // chaque tir part au serveur ; s'il atteint un joueur, on l'annonce avec la distance et le temps de vol
  tir.etat.surTir = (res) => {
    if (!state.enLigne) return;
    const c = res.touche ? joueurA(res.touche.nom) : null;
    fetch('./api/manche/tir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: moi, jeton, ...(c ? { cible: c.id, dist: res.dist, tof: res.tof } : {}) }) }).catch(() => {});
  };
  tableau();
  return { joueurs, moi: () => moi, majOccupes };
}
