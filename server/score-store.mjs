// Classement enregistré dans un fichier JSON du serveur. Modules standard de Node seulement.
// - accès sérialisés : une opération à la fois (file d'attente), donc pas d'écritures concurrentes ;
// - écriture atomique : fichier temporaire dans le même dossier, puis renommage ;
// - fichier absent : classement vide ; fichier illisible : il est mis de côté (copie datée) et on repart de zéro ;
// - le fichier est relu à chaque opération : le supprimer suffit à remettre le classement à zéro, sans redémarrage.
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { addEntry, parseBoards, serializeBoards } from '../src/shared/scores-core.mjs';

export function createScoreStore(file, { now = () => new Date(), log = (m) => console.warn(m) } = {}) {
  let queue = Promise.resolve();
  const serial = (job) => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  async function load() {
    let text;
    try { text = await readFile(file, 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') return parseBoards('').boards;
      throw e;
    }
    const { boards, corrupt } = parseBoards(text);
    if (corrupt) {
      const aside = `${file}.illisible-${now().toISOString().replace(/[:.]/g, '-')}`;
      try { await copyFile(file, aside); log(`[scores] fichier illisible mis de côté : ${aside}`); } catch (e) { log(`[scores] fichier illisible, copie impossible : ${e.message}`); }
    }
    return boards;
  }

  async function save(boards) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(serializeBoards(boards) + '\n', 'utf8');
      await fh.sync();
    } finally { await fh.close(); }
    try { await rename(tmp, file); } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  }

  return {
    file,
    /** les trois classements */
    read: () => serial(load),
    /** inscrit une ligne déjà validée (validateSubmission) ; renvoie son rang (0 : hors des 20) et le classement du niveau */
    submit: (level, entry) => serial(async () => {
      const boards = await load();
      const { board, rank } = addEntry(boards[level], { ...entry, date: now().toISOString() });
      if (rank > 0) { boards[level] = board; await save(boards); }
      return { rank, board: boards[level] };
    }),
  };
}
