/**
 * Kleine localStorage-Helfer des Konto-Abgleichs (robust: kaputte Einträge → Startwerte,
 * blockierter Speicher → das Spiel läuft weiter). Storage kommt als Parameter (testbar).
 */
import type { SyncBase } from './engine';

/**
 * Früher: eine gemeinsame Grundlage { user, version, pending } für alle Konten. Wird nur
 * noch gelesen (Übergang); geschrieben wird je Konto unter baseKey(user).
 */
export const BASE_KEY = 'vszw-sync-base';
/** Grundlage des lokalen Stands je Konto: { user, version, pending }. */
export function baseKey(user: string): string {
  return `${BASE_KEY}:${user}`;
}
/** Konto, mit dem der lokale Stand zuletzt abgeglichen wurde. */
export const OWNER_KEY = 'vszw-sync-owner';
/** Zufällige Geräte-ID (Echo des eigenen Pushs erkennen). */
export const DEVICE_KEY = 'vszw-device-id';
/** Sicherung des lokalen Stands (Text-Code), bevor ein Cloud-Stand ihn ersetzt. */
export const BACKUP_KEY = 'vszw-backup-before-sync';
/** Sicherung des Cloud-Stands (Text-Code) bei der ersten Anmeldung, bevor ein Stand den anderen ersetzt. */
export const CLOUD_BACKUP_KEY = 'vszw-backup-cloud-before-sync';
/** Konto, aus dem die Cloud-Sicherung stammt (nur diesem Konto wird sie angeboten). */
export const CLOUD_BACKUP_OWNER_KEY = 'vszw-backup-cloud-owner';
/** Stand vor dem letzten „Sicherung wiederherstellen“ (damit auch das rückgängig zu machen ist). */
export const RESTORE_UNDO_KEY = 'vszw-backup-before-restore';

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
    const owner = storage.getItem(OWNER_KEY);
    if (owner) return owner;
    return parseOwner(storage.getItem(BASE_KEY));
  } catch {
    return null;
  }
}

/**
 * Grundlage für `userId` – aber nur, wenn der lokale Stand zuletzt mit genau diesem Konto
 * abgeglichen wurde. Nach A → B → A gehört der lokale Stand zu B: Die alte Grundlage von A
 * passt nicht mehr zu ihm (sonst würde B's Spiel als Fortsetzung in A's Konto geschrieben).
 */
export function readBase(storage: Storage, userId: string): SyncBase | null {
  const owner = readOwner(storage);
  if (owner !== null && owner !== userId) return null;
  try {
    return parseBase(storage.getItem(baseKey(userId)), userId) ?? parseBase(storage.getItem(BASE_KEY), userId);
  } catch {
    return null;
  }
}

/** Grundlage je Konto schreiben (Tabs mit verschiedenen Konten stören sich nicht) und Besitzer merken. */
export function writeBase(storage: Storage, userId: string, base: SyncBase): void {
  try {
    storage.setItem(baseKey(userId), JSON.stringify({ user: userId, version: base.version, pending: base.pending }));
    storage.setItem(OWNER_KEY, userId);
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

/** Cloud-Stand sichern und merken, aus welchem Konto er stammt. */
export function writeCloudBackup(storage: Storage, code: string, owner: string): void {
  try {
    storage.setItem(CLOUD_BACKUP_KEY, code);
    storage.setItem(CLOUD_BACKUP_OWNER_KEY, owner);
  } catch {
    // ignorieren
  }
}

/** Konto der Cloud-Sicherung; null = unbekannt (ältere Sicherung ohne Angabe) oder unlesbar. */
export function readCloudBackupOwner(storage: Storage): string | null {
  try {
    return storage.getItem(CLOUD_BACKUP_OWNER_KEY);
  } catch {
    return null;
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
