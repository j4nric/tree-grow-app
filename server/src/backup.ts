/**
 * Tägliche Sicherung der SQLite-Datenbank mit der Online-Backup-API von node:sqlite
 * (konsistent auch während geschrieben wird). Dateien `saves-JJJJ-MM-TT.db` im
 * Sicherungsordner; nur die neuesten `keep` bleiben.
 */
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
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
