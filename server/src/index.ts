/**
 * Start des Sync-Servers. Einstellungen über Umgebungsvariablen:
 *   PORT             (Standard 8787)
 *   DB_PATH          (Standard ./data/saves.db)
 *   ALLOWED_ORIGINS  kommagetrennt (Standard https://j4nric.github.io)
 *   TRUST_PROXY      "1" hinter einem Reverse-Proxy (Client-IP aus X-Forwarded-For, nur von privaten Adressen)
 *   BACKUP_DIR       Ordner für die tägliche Sicherung (leer = keine; Standard ./data/backups)
 *   BACKUP_KEEP      so viele Sicherungen behalten (Standard 7)
 *   MAX_ACCOUNTS     höchstens so viele Konten (Standard 1000)
 *   MIN_FREE_MB      darunter freier Platz auf dem Daten-Volume → 507 (Standard 512)
 *   REGISTRATIONS_PER_IP_HOUR  neue Konten je IP (IPv6: je /64) und Stunde (Standard 3)
 *   AUTH_PER_IP_15MIN  Anmeldungen und Registrierungen je IP in 15 Minuten (Standard 20)
 *   ADMIN_BACKUP_TOKEN  geheimes Token (mind. 32 Zeichen) für GET /api/admin/backup (leer = Endpunkt aus)
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { createApp } from './app';
import { parseAdminToken } from './auth';
import { runBackup } from './backup';
import { openDb } from './db';
import { DEFAULT_MIN_FREE_BYTES, DiskGuard, freeBytesOf } from './disk';
import { createSyncServer } from './http';

/** Ganze Zahl > 0 aus der Umgebung, sonst `fallback`. */
function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// Letzte Verteidigung: Ein Fehler außerhalb eines Handlers wird geloggt, beendet aber nie
// den Prozess (alle Datenbank-Zugriffe sind synchron und damit nie halb ausgeführt).
process.on('uncaughtException', (error) => console.error('Unbehandelter Fehler:', error));
process.on('unhandledRejection', (error) => console.error('Unbehandelte Ablehnung:', error));

const port = envInt('PORT', 8787);
const dbPath = process.env.DB_PATH ?? './data/saves.db';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://j4nric.github.io')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const disk =
  dbPath === ':memory:'
    ? null
    : new DiskGuard(freeBytesOf(dirname(dbPath)), envInt('MIN_FREE_MB', DEFAULT_MIN_FREE_BYTES / 1024 / 1024) * 1024 * 1024);
void disk?.refresh();
const rawAdminToken = process.env.ADMIN_BACKUP_TOKEN ?? '';
const adminToken = parseAdminToken(rawAdminToken);
if (rawAdminToken.trim() && !adminToken) {
  console.error('ADMIN_BACKUP_TOKEN ist zu kurz (mindestens 32 Zeichen) oder enthält Leerzeichen – /api/admin/backup bleibt aus.');
}
const app = createApp({
  db,
  allowedOrigins,
  trustProxy: process.env.TRUST_PROXY === '1',
  authLimit: { limit: envInt('AUTH_PER_IP_15MIN', 20), windowMs: 15 * 60_000 },
  limits: {
    maxAccounts: envInt('MAX_ACCOUNTS', 1000),
    registrationsPerIp: { limit: envInt('REGISTRATIONS_PER_IP_HOUR', 3), windowMs: 60 * 60_000 },
  },
  storageOk: () => disk?.ok() ?? true,
  // Zwischendatei auf dem Daten-Volume (/tmp im Container ist nur 16 MB groß).
  adminBackup: adminToken ? { token: adminToken, dir: dbPath === ':memory:' ? tmpdir() : dirname(dbPath) } : null,
});
if (adminToken) console.log('Admin-Sicherung über /api/admin/backup ist eingeschaltet.');
// requestTimeout 30 s / headersTimeout 20 s: nur für das Empfangen der Anfrage –
// Event-Streams bleiben offen (siehe http.ts).
const server = createSyncServer(app);
server.listen(port, () => console.log(`Sync-Server auf Port ${port}, erlaubte Herkunft: ${allowedOrigins.join(', ')}`));

const backupDir = process.env.BACKUP_DIR ?? './data/backups';
const backupKeep = envInt('BACKUP_KEEP', 7);
const DAY_MS = 24 * 60 * 60 * 1000;
function backupNow(): void {
  if (!backupDir || dbPath === ':memory:') return;
  if (disk && !disk.ok()) {
    console.error('Sicherung übersprungen: zu wenig freier Platz.');
    return;
  }
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
  // Offene Keep-Alive-Verbindungen nicht abwarten.
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
