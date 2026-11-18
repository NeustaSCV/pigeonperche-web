import './ui/style.css';
import { Game } from './game/game';
import { installDiagnostics, report, showError } from './core/diag';
import { loadLevel, resolveLevelId } from './levels';

installDiagnostics();

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
canvas.tabIndex = 0;

report('boot');
// niveau : ?level=<id>, sinon le dernier choisi au menu, sinon le niveau par défaut ; seul son module est chargé
const levelId = resolveLevelId(params);
loadLevel(levelId)
  // le contrôleur du mode en ligne n'est chargé que pour une carte qui le déclare : rien de lui n'entre dans le solo
  .then(async (level) => ({ level, online: level.data.online ? (await import('./online/mode')).createOnlineMode : undefined }))
  .then(({ level, online }) => {
    const game = new Game(canvas, ui, params, level, online);
    report('game-created', { touch: game.touch, quality: game.engine.q.name, level: levelId });
    (window as any).hr = { game, engine: game.engine, ready: false, touch: game.touch, guards: game.guards, level: level.data };
    return game.init();
  })
  .then(() => {
    (window as any).hr.ready = true;
    report('ready');
    setTimeout(() => document.getElementById('loading')?.classList.remove('on'), 400);
  })
  .catch((e) => {
    console.error(e);
    showError('Erreur de chargement', String(e?.stack || e));
  });
