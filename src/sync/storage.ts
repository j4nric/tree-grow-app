/**
 * Kleine localStorage-Helfer des Konto-Abgleichs (robust: kaputte Einträge → Startwerte,
 * blockierter Speicher → das Spiel läuft weiter). Storage kommt als Parameter (testbar).
 */
import type { SyncBase } from './engine';

/** Grundlage des lokalen Stands je Konto: { user, version, pending }. */
export const BASE_KEY = 'vszw-sync-base';
/** Zufällige Geräte-ID (Echo des eigenen Pushs erkennen). */
export const DEVICE_KEY = 'vszw-device-id';
/** Sicherung des lokalen Stands (Text-Code), bevor ein Cloud-Stand ihn ersetzt. */
export const BACKUP_KEY = 'vszw-backup-before-sync';
/** Sicherung des Cloud-Stands (Text-Code) bei der ersten Anmeldung, bevor ein Stand den anderen ersetzt. */
export const CLOUD_BACKUP_KEY = 'vszw-backup-cloud-before-sync';

/** Liest die Grundlage für `userId`; fremdes Konto, kaputte Werte → null. */
export function parseBase(raw: string | null, userId: string): SyncBase | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.user !== userId) return null;
  const version = record.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) return null;
  return { version, pending: record.pending === true };
}

/**
 * Konto, mit dem der lokale Stand zuletzt abgeglichen wurde (steht mit in der Grundlage);
 * null = keins bekannt oder unlesbar.
 */
export function parseOwner(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    const user = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).user : undefined;
    return typeof user === 'string' && user !== '' ? user : null;
  } catch {
    return null;
  }
}

export function readOwner(storage: Storage): string | null {
  try {
    return parseOwner(storage.getItem(BASE_KEY));
  } catch {
    return null;
  }
}

export function readBase(storage: Storage, userId: string): SyncBase | null {
  try {
    return parseBase(storage.getItem(BASE_KEY), userId);
  } catch {
    return null;
  }
}

export function writeBase(storage: Storage, userId: string, base: SyncBase): void {
  try {
    storage.setItem(BASE_KEY, JSON.stringify({ user: userId, version: base.version, pending: base.pending }));
  } catch {
    // Speicher voll oder blockiert – der Abgleich klappt dann beim nächsten Start über den Fortschritt.
  }
}

export function writeBackup(storage: Storage, code: string, key: string = BACKUP_KEY): void {
  try {
    storage.setItem(key, code);
  } catch {
    // ignorieren
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
