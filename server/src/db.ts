/**
 * SQLite über Nodes eingebautes `node:sqlite` (keine nativen Abhängigkeiten).
 * Eine Datei auf einem Volume; `:memory:` für Tests.
 */
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  action_version INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 0
);
`;

/** Spalten, die ältere Datenbanken noch nicht haben (CREATE TABLE IF NOT EXISTS ergänzt sie nicht). */
function migrate(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(saves)').all() as { name: string }[];
  // Spielstand-Version (SAVE_VERSION des Spiels), die das schreibende Gerät gemeldet hat.
  if (!columns.some((c) => c.name === 'schema_version')) {
    db.exec('ALTER TABLE saves ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0');
  }
}

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    // WAL: Lesen und Schreiben blockieren sich nicht; die Online-Sicherung (backup.ts) bleibt konsistent.
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
