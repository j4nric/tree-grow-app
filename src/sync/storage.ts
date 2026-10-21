/**
 * Kleine localStorage-Helfer des Konto-Abgleichs (robust: kaputte Einträge → Startwerte,
 * blockierter Speicher → das Spiel läuft weiter). Storage kommt als Parameter (testbar).
 *
 * Zwei Dinge liegen hier:
 * - Die **Abgleich-Angaben zum lokalen Spielstand** (`vszw-sync-base`): zu welchem Konto er
 *   gehört und auf welcher Cloud-Version er beruht. Sie werden immer zusammen mit dem
 *   Spielstand geschrieben (controller.ts, persisted()), damit „Spielstand“ und „gehört zu X“
 *   nie auseinanderlaufen – auch nicht, wenn mehrere Tabs abwechselnd speichern.
 * - Der **Sicherungs-Ring** (`vszw-backups`): die letzten Stände, die ein Abgleich ersetzt hat.
 */
import type { SyncBase } from './engine';
import type { Progress } from './policy';

/** Abgleich-Angaben zum lokalen Spielstand: { user, version, pending } (version null = keine Grundlage). */
export const BASE_KEY = 'vszw-sync-base';
/** Übergang (nie veröffentlicht): Besitzer und Grundlage je Konto in eigenen Schlüsseln. */
export const OWNER_KEY = 'vszw-sync-owner';
export function baseKey(user: string): string {
  return `${BASE_KEY}:${user}`;
}
/** Zufällige Geräte-ID (Echo des eigenen Pushs erkennen). */
export const DEVICE_KEY = 'vszw-device-id';
/** Sicherungs-Ring. */
export const BACKUPS_KEY = 'vszw-backups';
/** Frühere Einzel-Sicherungen – werden beim Start in den Ring übernommen. */
export const BACKUP_KEY = 'vszw-backup-before-sync';
export const CLOUD_BACKUP_KEY = 'vszw-backup-cloud-before-sync';
export const RESTORE_UNDO_KEY = 'vszw-backup-before-restore';
const LEGACY_BACKUP_KEYS = [BACKUP_KEY, CLOUD_BACKUP_KEY, RESTORE_UNDO_KEY] as const;

/** Wem der lokale Stand gehört und worauf er beruht. */
export interface LocalMeta {
  /** Konto, mit dem er zuletzt abgeglichen wurde (bzw. dessen Sicherung geladen wurde); null = keinem. */
  owner: string | null;
  /** Grundlage für dieses Konto; null = unbekannt (dann wie eine erste Anmeldung). */
  base: SyncBase | null;
}

function parseVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Liest die Abgleich-Angaben; kaputte Werte → kein Besitzer. */
export function parseMeta(raw: string | null): LocalMeta | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.user !== 'string' || record.user === '') return null;
  const version = parseVersion(record.version);
  return { owner: record.user, base: version === null ? null : { version, pending: record.pending === true } };
}

export function readMeta(storage: Storage): LocalMeta {
  try {
    const meta = parseMeta(storage.getItem(BASE_KEY));
    if (meta) return meta;
    // Übergang: Besitzer und Grundlage in getrennten Schlüsseln.
    const owner = storage.getItem(OWNER_KEY);
    if (owner) return { owner, base: parseMeta(storage.getItem(baseKey(owner)))?.base ?? null };
  } catch {
    // unten
  }
  return { owner: null, base: null };
}

export function writeMeta(storage: Storage, meta: LocalMeta): void {
  try {
    if (meta.owner) {
      storage.setItem(
        BASE_KEY,
        JSON.stringify({ user: meta.owner, version: meta.base?.version ?? null, pending: meta.base?.pending ?? false }),
      );
    } else {
      storage.removeItem(BASE_KEY);
    }
    storage.removeItem(OWNER_KEY);
  } catch {
    // Speicher voll oder blockiert – der Abgleich klappt dann beim nächsten Start über den Fortschritt.
  }
}

/** Konto des lokalen Stands; null = keins. */
export function readOwner(storage: Storage): string | null {
  return readMeta(storage).owner;
}

/** Grundlage für `userId` – nur, wenn der lokale Stand zu genau diesem Konto gehört. */
export function readBase(storage: Storage, userId: string): SyncBase | null {
  const meta = readMeta(storage);
  return meta.owner === userId ? meta.base : null;
}

export function writeBase(storage: Storage, userId: string, base: SyncBase): void {
  writeMeta(storage, { owner: userId, base });
}

// --- Sicherungs-Ring --------------------------------------------------------------------

/** Warum ein Stand gesichert wurde. */
export type BackupReason =
  /** Lokaler Stand vor der ersten Anmeldung mit einem Konto. */
  | 'first-login-local'
  /** Cloud-Stand vor der ersten Anmeldung (der lokale hätte ihn ersetzen können). */
  | 'first-login-cloud'
  /** Eigene, noch nicht gesendete Aktion, die ein anderes Gerät überholt hat. */
  | 'lost-action'
  /** Sicherheitsnetz: lokaler Stand vor dem Übernehmen beim Start. */
  | 'before-take'
  /** Stand vor „Sicherung wiederherstellen“. */
  | 'before-restore'
  /** Aus den früheren Einzel-Sicherungen übernommen. */
  | 'legacy';

export interface BackupEntry {
  id: string;
  /** Text-Code (über „Importieren“ ladbar). */
  code: string;
  /** Konto, zu dem der Stand gehörte; null = rein lokal. */
  owner: string | null;
  /** Zeitpunkt (ms). */
  at: number;
  reason: BackupReason;
  progress: Progress | null;
}

/** Höchstens so viele Sicherungen … */
export const MAX_BACKUPS = 10;
/** … und zusammen höchstens so viele Zeichen (localStorage hat meist 5 MB). */
export const MAX_BACKUP_CHARS = 1_500_000;

const REASONS: readonly BackupReason[] = ['first-login-local', 'first-login-cloud', 'lost-action', 'before-take', 'before-restore', 'legacy'];

function validEntry(value: unknown): value is BackupEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.code === 'string' &&
    e.code !== '' &&
    (e.owner === null || typeof e.owner === 'string') &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at) &&
    REASONS.includes(e.reason as BackupReason)
  );
}

/** Alle Sicherungen, älteste zuerst; kaputte Einträge fallen weg. */
export function readBackups(storage: Storage): BackupEntry[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(BACKUPS_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter(validEntry).map((e) => ({ ...e, progress: e.progress ?? null })) : [];
  } catch {
    return [];
  }
}

/**
 * Welche Sicherung bei Platzmangel zuerst weicht: das Sicherheitsnetz („before-take“, meist
 * ohne Verlust) vor allen anderen, jeweils die älteste. Rückgabe: Index oder -1.
 */
function evictIndex(entries: readonly BackupEntry[], keep: string): number {
  const safety = entries.findIndex((e) => e.reason === 'before-take' && e.id !== keep);
  if (safety >= 0) return safety;
  return entries.findIndex((e) => e.id !== keep);
}

function totalChars(entries: readonly BackupEntry[]): number {
  return entries.reduce((sum, e) => sum + e.code.length, 0);
}

/**
 * Legt eine Sicherung im Ring ab. Denselben Code gibt es nur einmal (die vorhandene bleibt).
 * Zu viele bzw. zu große Sicherungen: die unwichtigste älteste weicht. Rückgabe: die ID.
 */
export function addBackup(storage: Storage, entry: Omit<BackupEntry, 'id'>): string | null {
  const entries = readBackups(storage);
  const same = entries.find((e) => e.code === entry.code);
  if (same) return same.id;
  const id = `${Math.max(0, Math.floor(entry.at)).toString(36)}-${entries.length.toString(36)}-${checksum(entry.code)}`;
  entries.push({ ...entry, id });
  while (entries.length > MAX_BACKUPS || (totalChars(entries) > MAX_BACKUP_CHARS && entries.length > 1)) {
    const index = evictIndex(entries, id);
    if (index < 0) break;
    entries.splice(index, 1);
  }
  // Speicher voll: weitere ältere weichen lassen, bis es passt.
  for (;;) {
    try {
      storage.setItem(BACKUPS_KEY, JSON.stringify(entries));
      return id;
    } catch {
      const index = evictIndex(entries, id);
      if (index < 0) return null;
      entries.splice(index, 1);
    }
  }
}

/** Kurze Prüfsumme (FNV-1a) für die ID. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Frühere Einzel-Sicherungen (mit ihrem Konto) in den Ring übernehmen und entfernen. */
export function migrateLegacyBackups(storage: Storage, now: number): void {
  for (const key of LEGACY_BACKUP_KEYS) {
    try {
      const code = storage.getItem(key);
      if (code) {
        const owner = storage.getItem(`${key}:owner`) || null;
        if (addBackup(storage, { code, owner, at: now, reason: 'legacy', progress: null }) === null) continue;
      }
      storage.removeItem(key);
      storage.removeItem(`${key}:owner`);
    } catch {
      // ignorieren
    }
  }
}

/**
 * Geräte-ID: einmal zufällig erzeugt und gespeichert. `random` liefert eine neue ID (z. B.
 * crypto.randomUUID). Gültig sind 8–64 Zeichen aus Buchstaben, Ziffern und „-“.
 */
export function deviceId(storage: Storage, random: () => string): string {
  try {
    const stored = storage.getItem(DEVICE_KEY);
    if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) return stored;
  } catch {
    // ohne Speicher: jedes Mal eine neue ID (Echo-Erkennung klappt trotzdem je Seite)
  }
  const id = random();
  try {
    storage.setItem(DEVICE_KEY, id);
  } catch {
    // ignorieren
  }
  return id;
}
