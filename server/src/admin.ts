/**
 * Kleine Verwaltung ohne sqlite3 im Image – im Container aufrufen:
 *   docker exec vszw-sync node --disable-warning=ExperimentalWarning dist/admin-cli.js <befehl>
 * Befehle:
 *   users                 Konten auflisten (Name, angelegt, Größe des Spielstands)
 *   delete-user <name>    Konto samt Sitzungen und Spielstand löschen
 *   backup                sofort eine Sicherung nach BACKUP_DIR schreiben
 */
import { runBackup } from './backup';
import type { Db } from './db';

/** Führt einen Befehl aus; Ausgabe über `out`. Rückgabe: Exit-Code. */
export async function runAdmin(
  db: Db,
  args: readonly string[],
  out: (line: string) => void,
  env: { backupDir: string; backupKeep: number; now: number },
): Promise<number> {
  const [command, arg] = args;
  switch (command) {
    case 'users': {
      const rows = db
        .prepare(
          'SELECT u.username AS username, u.created_at AS createdAt, length(s.data) AS bytes, s.version AS version FROM users u LEFT JOIN saves s ON s.user_id = u.id ORDER BY u.id',
        )
        .all() as { username: string; createdAt: number; bytes: number | null; version: number | null }[];
      for (const r of rows) {
        out(`${r.username}\t${new Date(r.createdAt).toISOString()}\t${r.bytes ?? 0} Bytes\tVersion ${r.version ?? '-'}`);
      }
      out(`${rows.length} Konten`);
      return 0;
    }
    case 'delete-user': {
      if (!arg) {
        out('Benutzername fehlt: delete-user <name>');
        return 2;
      }
      const changes = Number(db.prepare('DELETE FROM users WHERE username = ?').run(arg.trim().toLowerCase()).changes);
      out(changes > 0 ? `Konto „${arg}“ gelöscht.` : `Konto „${arg}“ gibt es nicht.`);
      return changes > 0 ? 0 : 1;
    }
    case 'backup': {
      if (!env.backupDir) {
        out('BACKUP_DIR ist leer.');
        return 2;
      }
      out(`Sicherung: ${await runBackup(db, env.backupDir, env.backupKeep, env.now)}`);
      return 0;
    }
    default:
      out('Befehle: users | delete-user <name> | backup');
      return 2;
  }
}
