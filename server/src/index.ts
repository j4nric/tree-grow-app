/**
 * Start des Sync-Servers. Einstellungen über Umgebungsvariablen:
 *   PORT             (Standard 8787)
 *   DB_PATH          (Standard ./data/saves.db)
 *   ALLOWED_ORIGINS  kommagetrennt (Standard https://j4nric.github.io)
 *   TRUST_PROXY      "1" hinter einem Reverse-Proxy (Client-IP aus X-Forwarded-For für das Rate-Limit)
 *   BACKUP_DIR       Ordner für die tägliche Sicherung (leer = keine; Standard ./data/backups)
 *   BACKUP_KEEP      so viele Sicherungen behalten (Standard 14)
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { createApp } from './app';
import { runBackup } from './backup';
import { openDb } from './db';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DB_PATH ?? './data/saves.db';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://j4nric.github.io')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const app = createApp({ db, allowedOrigins, trustProxy: process.env.TRUST_PROXY === '1' });
const server = createServer(app.handle);
// Server-Sent Events laufen lange: kein Timeout für offene Anfragen.
server.requestTimeout = 0;
server.listen(port, () => console.log(`Sync-Server auf Port ${port}, erlaubte Herkunft: ${allowedOrigins.join(', ')}`));

const backupDir = process.env.BACKUP_DIR ?? './data/backups';
const backupKeep = Number(process.env.BACKUP_KEEP ?? 14);
const DAY_MS = 24 * 60 * 60 * 1000;
function backupNow(): void {
  if (!backupDir || dbPath === ':memory:') return;
  runBackup(db, backupDir, backupKeep, Date.now()).then(
    (file) => console.log(`Sicherung: ${file}`),
    (error: unknown) => console.error('Sicherung fehlgeschlagen:', error),
  );
}
// Kurz nach dem Start und dann täglich (eine Datei je Tag, gleicher Tag wird überschrieben).
setTimeout(backupNow, 60_000).unref();
setInterval(backupNow, DAY_MS).unref();

function shutdown(): void {
  app.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
