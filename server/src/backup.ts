/**
 * Tägliche Sicherung der SQLite-Datenbank mit der Online-Backup-API von node:sqlite
 * (konsistent auch während geschrieben wird). Dateien `saves-JJJJ-MM-TT.db` im
 * Sicherungsordner; nur die neuesten `keep` bleiben.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import type { Db } from './db';

const PATTERN = /^saves-\d{4}-\d{2}-\d{2}\.db$/;

export function backupName(now: number): string {
  return `saves-${new Date(now).toISOString().slice(0, 10)}.db`;
}

/** Welche Sicherungen zu löschen sind (älteste zuerst über den Namen), damit `keep` bleiben. */
export function backupsToDelete(files: readonly string[], keep: number): string[] {
  const backups = files.filter((f) => PATTERN.test(f)).sort();
  const n = Math.max(0, Math.floor(Number.isFinite(keep) ? keep : 0));
  return backups.slice(0, Math.max(0, backups.length - Math.max(1, n)));
}

export async function runBackup(db: Db, dir: string, keep: number, now: number): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, backupName(now));
  await backup(db, target);
  for (const file of backupsToDelete(readdirSync(dir), keep)) unlinkSync(join(dir, file));
  return target;
}

/** Zwischendateien der Admin-Sicherung (GET /api/admin/backup). */
const TEMP_PATTERN = /^\.admin-backup-[0-9a-f]+\.db$/;

/**
 * Frische, konsistente Sicherung als offene Datei – für den Abruf über das Netz.
 * Die Datei entsteht in `dir` (auf dem Daten-Volume, nicht im kleinen /tmp) und ist beim
 * Rückgeben schon gelöscht: Der Inhalt bleibt über den Handle lesbar, bis er geschlossen
 * wird, und nichts bleibt liegen. Reste eines Absturzes mitten im Sichern räumt der nächste
 * Aufruf weg (Aufrufer sorgen dafür, dass nie zwei gleichzeitig laufen).
 */
export async function backupToHandle(db: Db, dir: string): Promise<FileHandle> {
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir)) if (TEMP_PATTERN.test(file)) unlinkSync(join(dir, file));
  const target = join(dir, `.admin-backup-${randomBytes(8).toString('hex')}.db`);
  try {
    await backup(db, target);
    return await open(target, 'r');
  } finally {
    try {
      unlinkSync(target);
    } catch {
      // schon weg (Sicherung gescheitert, bevor die Datei entstand)
    }
  }
}
