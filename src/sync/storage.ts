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
  // Kein (bekannter) Besitzer → keine Grundlage: dann entscheidet die erste Anmeldung (mit Sicherungen).
  if (readOwner(storage) !== userId) return null;
  try {
    return parseBase(storage.getItem(baseKey(userId)), userId) ?? parseBase(storage.getItem(BASE_KEY), userId);
  } catch {
    return null;
  }
}

/**
 * Grundlage je Konto schreiben (Tabs mit verschiedenen Konten stören sich nicht) und Besitzer
 * merken – den Besitzer zuerst: Scheitert das Schreiben dazwischen, gilt keine falsche Grundlage.
 */
export function writeBase(storage: Storage, userId: string, base: SyncBase): void {
  try {
    storage.setItem(OWNER_KEY, userId);
    storage.setItem(baseKey(userId), JSON.stringify({ user: userId, version: base.version, pending: base.pending }));
  } catch {
    // Speicher voll oder blockiert – der Abgleich klappt dann beim nächsten Start über den Fortschritt.
  }
}

/** Besitzer des lokalen Stands setzen (null = keiner bekannt, z. B. nach dem Laden einer Sicherung ohne Konto). */
export function writeOwner(storage: Storage, owner: string | null): void {
  try {
    if (owner) storage.setItem(OWNER_KEY, owner);
    else storage.removeItem(OWNER_KEY);
    // Der alte gemeinsame Eintrag nennt sonst weiter einen Besitzer.
    storage.removeItem(BASE_KEY);
  } catch {
    // ignorieren
  }
}

/**
 * Lokale Änderung ohne laufenden Abgleich (abgemeldet): die Grundlage des Besitzers als
 * „offen“ markieren. Beim nächsten Anmelden mit diesem Konto wird sie dann gesendet bzw. vor
 * dem Übernehmen eines anderen Stands gesichert.
 */
export function markPending(storage: Storage): void {
  const owner = readOwner(storage);
  if (!owner) return;
  const base = readBase(storage, owner);
  if (base && !base.pending) writeBase(storage, owner, { version: base.version, pending: true });
}

/** Schlüssel für das Konto, zu dem eine Sicherung gehört. */
export function backupOwnerKey(key: string): string {
  return `${key}:owner`;
}

/**
 * Text-Code sichern und dazu, zu welchem Konto er gehört (null = zu keinem, rein lokal).
 * Der Code selbst bleibt ein normaler Export-Code (über „Importieren“ ladbar).
 */
export function writeBackup(storage: Storage, code: string, key: string = BACKUP_KEY, owner: string | null = null): void {
  try {
    storage.setItem(key, code);
    if (owner) storage.setItem(backupOwnerKey(key), owner);
    else storage.removeItem(backupOwnerKey(key));
  } catch {
    // ignorieren
  }
}

/** Gesicherter Code und sein Konto; null = keine Sicherung. */
export function readBackup(storage: Storage, key: string): { code: string; owner: string | null } | null {
  try {
    const code = storage.getItem(key);
    return code ? { code, owner: storage.getItem(backupOwnerKey(key)) || null } : null;
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
