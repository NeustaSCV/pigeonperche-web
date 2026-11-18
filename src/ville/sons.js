// Ville nouvelle : les sons du multijoueur, tels qu'ils ont été choisis à l'écoute sur une maquette.
//  - son propre tir : le coup de feu du jeu solo pour ce calibre (attaque enregistrée, recette de src/audio/shot-bake.ts), puis la culasse ;
//  - tir d'un autre : le même coup de feu, rendu de façon réaliste à sa distance (très sourd et très faible au loin),
//    retardé par le trajet du son et placé à gauche ou à droite ;
//  - balle qui vous manque : un souffle bref, comme un bâton qui fend l'air, qui traverse d'une oreille à l'autre ;
//  - touche : une vraie voix (dix cris tirés au hasard), toute proche si c'est soi, amincie et un peu réverbérée si c'est un autre ;
//  - cran de tourelle, début et fin de manche, compte à rebours. Aucun son quand on est visé.
// Tout est préparé une fois, au premier geste du joueur (le navigateur n'autorise pas le son avant).
import { SR, st, rng, noise, bq, bqSweep, env, add, gain, norm, mix, thump, peak, smear } from '../audio/shot-dsp';
import { bakeShot } from '../audio/shot-bake';
import { shotSound } from '../audio/shot-params';
import { parseWav } from '../audio/samples';
import { weaponById } from '../config/weapons';

const VITESSE_SON = 340;        // m/s
const NB_VOIX = 10;

export function installSons({ arme = '375ct', base = './assets/audio/', dossierVoix = './ville/voix/' } = {}) {
  let ctx = null, sortie = null, pret = false, enCours = null;
  const B = {};                 // sons préparés : { l, r } à 48 kHz
  const lointains = new Map();  // coup de feu rendu à une distance, par tranche de 50 m

  const stereo = (x) => ({ l: x, r: x });
  const mono = (s) => { const y = new Float32Array(s.l.length); for (let i = 0; i < y.length; i++) y[i] = (s.l[i] + s.r[i]) * 0.5; return y; };
  const fondu = (x, sec = 0.05) => { const n = Math.round(sec * SR); for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n; return x; };
  const charge = async (nom, dossier = base) => { try { const r = await fetch(dossier + nom); return r.ok ? parseWav(await r.arrayBuffer()) : null; } catch { return null; } };
  const pcm = (p) => (p ? { l: p.l ?? p.data, r: p.r ?? p.data } : null);

  // ---------- fabrication ----------
  /** Coup de feu d'un autre à `d` mètres : l'air retire l'aigu, le niveau suit la distance. */
  const lointain = (d) => {
    const cle = Math.max(50, Math.round(d / 50) * 50); let s = lointains.get(cle);
    if (!s) {
      const coupure = 400 + 11000 * Math.exp(-cle / 650), force = Math.min(1, 28 / cle);
      const y = bq(bq(B.sec, 'lowpass', coupure, 0.6), 'highpass', 45, 0.7);
      s = stereo(fondu(gain(norm(y), force))); lointains.set(cle, s);
    }
    return s;
  };
  const enCloche = (x, pic, largeur) => { for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= Math.exp(-(((t - pic) / largeur) ** 2)); } return x; };
  /** Souffle bref dont la hauteur monte puis retombe, et qui traverse d'une oreille à l'autre (sens > 0 : de gauche à droite). */
  const fouet = (dur, f0, f1, q, sens) => {
    const rnd = rng(21 + Math.round(dur * 100)), pic = dur * 0.45;
    const monte = bqSweep(noise(dur, rnd), 'bandpass', f0, f1, dur * 0.3, q), aigu = bqSweep(noise(dur, rnd), 'bandpass', f0 * 2.3, f1 * 1.7, dur * 0.25, q * 1.3);
    const y = norm(add(enCloche(monte, pic, dur * 0.2), enCloche(aigu, pic * 0.95, dur * 0.13), 0.45));
    const l = new Float32Array(y.length), r = new Float32Array(y.length);
    for (let i = 0; i < y.length; i++) { const u = Math.max(0, Math.min(1, (i / y.length - 0.15) / 0.7)), a = ((sens > 0 ? u : 1 - u) * Math.PI) / 2; l[i] = y[i] * Math.cos(a); r[i] = y[i] * Math.sin(a); }
    return { l, r };
  };
  /** Voix entendue à `d` mètres : l'air mange l'aigu, la voix s'amincit, une petite réverbération et rien de plus. */
  const voixAuLoin = (son, d) => {
    const k = Math.min(1, d / 1000), rnd = rng(1000 + Math.round(d)), src = son.l;
    const direct = bq(bq(bq(src, 'highpass', 180 + 260 * k, 0.7), 'lowpass', 9000 * Math.exp(-d / 620) + 1500, 0.6), 'highshelf', 3000, 0.7, -3 - 9 * k);
    const out = st(src.length / SR + 0.5 + 0.2 * k);
    mix(out, direct, 0, 1, 0);
    const diffus = bq(smear(direct, rnd, 0.22 + 0.16 * k, 30, 0.07 + 0.05 * k), 'lowpass', 2200 - 700 * k, 0.6);
    mix(out, diffus, 0.02, 0.07 + 0.11 * k, -0.35); mix(out, diffus, 0.03, 0.07 + 0.11 * k, 0.35);
    const pic = Math.max(peak(out.l), peak(out.r)) || 1, niveau = Math.min(0.8, (45 / Math.max(d, 45)) ** 0.5) / pic;
    return { l: gain(out.l, niveau), r: gain(out.r, niveau) };
  };
  const cloche = (f, tau, g = 1) => gain(norm(add(add(thump(f, f, 1, tau, tau * 5), thump(f * 2.01, f * 2.01, 1, tau * 0.6, tau * 5), 0.35), thump(f * 2.99, f * 2.99, 1, tau * 0.35, tau * 5), 0.15)), g);
  const suite = (notes, pas, tau) => { const out = st(notes.length * pas + 1.2); notes.forEach((f, i) => mix(out, cloche(f, tau, 0.7), i * pas, 1, 0)); return out; };

  const prepare = async () => {
    const [magnum, ouvre, ferme, ...voix] = await Promise.all([charge('shot-magnum.wav'), charge('bolt-open.wav'), charge('bolt-close.wav'), ...Array.from({ length: NB_VOIX }, (_, i) => charge(`voix-${String(i + 1).padStart(2, '0')}.wav`, dossierVoix))]);
    const cuit = bakeShot(shotSound(weaponById(arme)), magnum);
    B.tir = { l: cuit.l, r: cuit.r }; B.sec = mono(B.tir).slice(0, Math.round(3.2 * SR));
    B.ouvre = pcm(ouvre); B.ferme = pcm(ferme); B.voix = voix.map(pcm).filter(Boolean);
    B.fouetD = fouet(0.34, 600, 2800, 1.8, 1); B.fouetG = fouet(0.34, 600, 2800, 1.8, -1);
    B.cran = stereo(gain(norm(add(env(bq(noise(0.01, rng(2)), 'highpass', 3000, 0.7), 0.0001, 0.0012), thump(3100, 3100, 1, 0.004, 0.03), 0.5)), 0.45));
    B.debut = suite([392, 523, 659], 0.16, 0.3); B.fin = suite([659, 523, 392], 0.2, 0.35);
    B.top = stereo(cloche(660, 0.07, 0.5)); B.depart = stereo(cloche(990, 0.4, 0.8));
    pret = true;
  };
  /** Ouvre le son : à appeler sur un geste du joueur. Sans effet les fois suivantes. */
  const ouvrir = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); sortie = ctx.createGain(); sortie.gain.value = 0.8; sortie.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    enCours ??= prepare().catch((e) => console.warn('sons du multijoueur :', e));
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, ouvrir, { once: true, passive: true });

  /** Joue un son préparé après `delai` secondes, placé à `pan` (−1 gauche … 1 droite), au niveau `g`. */
  const joue = (son, { delai = 0, pan = 0, g = 1 } = {}) => {
    if (!pret || !son || !ctx || ctx.state !== 'running') return false;
    const b = ctx.createBuffer(2, son.l.length, SR); b.copyToChannel(son.l, 0); b.copyToChannel(son.r, 1);
    const src = ctx.createBufferSource(); src.buffer = b; const gn = ctx.createGain(); gn.gain.value = g; src.connect(gn);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); gn.connect(p); p.connect(sortie); } else gn.connect(sortie);
    src.start(ctx.currentTime + Math.max(0, delai)); return true;
  };
  const voixAuHasard = () => (B.voix?.length ? B.voix[Math.floor(Math.random() * B.voix.length)] : null);

  return {
    ouvrir,
    pret: () => pret,
    /** Son propre tir, puis la culasse. */
    tirLocal() { joue(B.tir); joue(B.ouvre, { delai: 0.55, g: 0.8 }); joue(B.ferme, { delai: 1.05, g: 0.8 }); },
    /** Tir d'un autre à `d` mètres, entendu du côté `pan` ; il arrive après le trajet du son. */
    tirDistant(d, pan) { if (pret) joue(lointain(d), { delai: d / VITESSE_SON, pan }); },
    /** Une balle passe tout près : `sens` > 0 si elle traverse de gauche à droite ; `delai` en secondes. */
    ballePasse(sens, delai = 0) { joue(sens > 0 ? B.fouetD : B.fouetG, { delai }); },
    /** On est touché : une voix toute proche. */
    touche() { joue(voixAuHasard(), { g: 0.85 }); },
    /** On touche quelqu'un à `d` mètres : la voix, au loin, du côté `pan`. */
    toucheAuLoin(d, pan = 0) { const v = pret && voixAuHasard(); if (v) joue(voixAuLoin(v, d), { pan }); },
    cran() { joue(B.cran); },
    debutManche() { joue(B.debut); },
    finManche() { joue(B.fin); },
    /** Un top du compte à rebours ; `dernier` : le top de départ, plus aigu et plus long. */
    top(dernier = false) { joue(dernier ? B.depart : B.top); },
  };
}
