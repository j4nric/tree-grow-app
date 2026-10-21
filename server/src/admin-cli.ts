/** Aufruf der Verwaltung (admin.ts) von der Kommandozeile – Einstellungen wie index.ts. */
import { runAdmin } from './admin';
import { openDb } from './db';

const db = openDb(process.env.DB_PATH ?? './data/saves.db');
const keep = Number(process.env.BACKUP_KEEP ?? 7);
runAdmin(db, process.argv.slice(2), (line) => console.log(line), {
  backupDir: process.env.BACKUP_DIR ?? './data/backups',
  backupKeep: Number.isSafeInteger(keep) && keep > 0 ? keep : 7,
  now: Date.now(),
}).then(
  (code) => {
    db.close();
    process.exit(code);
  },
  (error: unknown) => {
    console.error(error);
    db.close();
    process.exit(1);
  },
);
