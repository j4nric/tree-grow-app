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
import { SAVE_KEY } from '../core/save';
import type { SyncBase } from './engine';
import type { Progress } from './policy';

/**
 * Abgleich-Angaben zum lokalen Spielstand: { user, version, pending, save, tab } (version null =
 * keine Grundlage; save = Prüfsumme des gespeicherten Spielstands, zu dem sie gehören; tab =
 * Kennung des Tabs, der beides geschrieben hat – fehlt bei älteren Einträgen).
 */
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

/** Prüfsumme (FNV-1a) eines Texts – für den gespeicherten Spielstand und Sicherungs-IDs. */
export function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Liest die Abgleich-Angaben samt Prüfsumme; kaputte Werte → null. */
export function parseMeta(raw: string | null): (LocalMeta & { save: string | null; tab: string | null }) | null {
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
  return {
    owner: record.user,
    base: version === null ? null : { version, pending: record.pending === true },
    save: typeof record.save === 'string' ? record.save : null,
    tab: typeof record.tab === 'string' && record.tab !== '' ? record.tab : null,
  };
}

/**
 * Abgleich-Angaben zum gespeicherten Spielstand. Passt die Prüfsumme nicht zum Spielstand
 * (Speichern scheiterte, Absturz zwischen den beiden Schreibvorgängen, anderer Tab), gilt die
 * Grundlage nicht – dann wie bei einer ersten Anmeldung, mit Sicherungen beider Seiten.
 */
export function readMeta(storage: Storage): LocalMeta {
  try {
    const meta = parseMeta(storage.getItem(BASE_KEY));
    if (!meta) return { owner: null, base: null };
    const save = storage.getItem(SAVE_KEY);
    const matches = save !== null && meta.save === checksum(save);
    return { owner: meta.owner, base: matches ? meta.base : null };
  } catch {
    return { owner: null, base: null };
  }
}

/**
 * Schreibt die Angaben zu dem Spielstand mit Prüfsumme `saveHash` (null = keiner bekannt);
 * `tab` = Kennung des schreibenden Tabs (siehe backupOtherTab).
 */
export function writeMeta(storage: Storage, meta: LocalMeta, saveHash: string | null, tab?: string): void {
  try {
    if (meta.owner) {
      storage.setItem(
        BASE_KEY,
        JSON.stringify({
          user: meta.owner,
          version: meta.base?.version ?? null,
          pending: meta.base?.pending ?? false,
          save: saveHash,
          ...(tab ? { tab } : {}),
        }),
      );
    } else {
      storage.removeItem(BASE_KEY);
    }
  } catch {
    // Speicher voll oder blockiert – die Prüfsumme passt dann nicht, die Grundlage gilt nicht.
  }
}

/**
 * Übergang (einmal beim Start): getrennte Schlüssel für Besitzer und Grundlage in den einen
 * Eintrag übernehmen – ohne Grundlage (ihre Zugehörigkeit zum Spielstand ist unbekannt).
 */
export function migrateLegacyMeta(storage: Storage): void {
  try {
    const owner = storage.getItem(OWNER_KEY);
    if (owner === null) return;
    if (!storage.getItem(BASE_KEY) && owner) writeMeta(storage, { owner, base: null }, null);
    storage.removeItem(OWNER_KEY);
    storage.removeItem(baseKey(owner));
  } catch {
    // ignorieren
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

/** Grundlage für `userId` zum gerade gespeicherten Spielstand schreiben (Tests, Werkzeuge). */
export function writeBase(storage: Storage, userId: string, base: SyncBase): void {
  let save: string | null = null;
  try {
    save = storage.getItem(SAVE_KEY);
  } catch {
    save = null;
  }
  writeMeta(storage, { owner: userId, base }, save === null ? null : checksum(save));
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
  /** Stand vor „Spielstand löschen“ bzw. „Importieren“. */
  | 'before-replace'
  /** Gespeicherter Stand eines anderen Tabs mit noch nicht gesendeter Aktion, bevor dieser Tab darüber speichert. */
  | 'other-tab'
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
  /**
   * Nur bei 'other-tab': Tab, dessen Stand das ist. Je Tab gibt es höchstens eine solche
   * Sicherung (die neuere ersetzt die ältere); der Tab entfernt sie, sobald seine Aktionen
   * in der Cloud sind.
   */
  writer?: string;
}

/** Höchstens so viele Sicherungen … */
export const MAX_BACKUPS = 10;
/** … und zusammen höchstens so viele Zeichen (localStorage hat meist 5 MB – Reserve für den Spielstand). */
export const MAX_BACKUP_CHARS = 500_000;

const REASONS: readonly BackupReason[] = [
  'first-login-local',
  'first-login-cloud',
  'lost-action',
  'before-take',
  'before-restore',
  'before-replace',
  'other-tab',
  'legacy',
];

/** Wie wichtig eine Sicherung ist: Das Sicherheitsnetz (meist ohne Verlust) zählt am wenigsten. */
export function backupPriority(reason: BackupReason): number {
  if (reason === 'before-take') return 0;
  if (reason === 'legacy') return 1;
  return 2;
}

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
    REASONS.includes(e.reason as BackupReason) &&
    (e.writer === undefined || typeof e.writer === 'string')
  );
}

/** Zuletzt gelesener Ring je Storage (nur neu parsen, wenn sich der Text geändert hat). */
const ringCache = new WeakMap<Storage, { raw: string | null; entries: BackupEntry[] }>();

/** Alle Sicherungen, älteste zuerst; kaputte Einträge fallen weg. */
export function readBackups(storage: Storage): BackupEntry[] {
  let raw: string | null;
  try {
    raw = storage.getItem(BACKUPS_KEY);
  } catch {
    return [];
  }
  const cached = ringCache.get(storage);
  if (cached && cached.raw === raw) return cached.entries.map((e) => ({ ...e }));
  let entries: BackupEntry[] = [];
  try {
    const data: unknown = JSON.parse(raw ?? '[]');
    entries = Array.isArray(data) ? data.filter(validEntry).map((e) => ({ ...e, progress: e.progress ?? null })) : [];
  } catch {
    entries = [];
  }
  ringCache.set(storage, { raw, entries });
  return entries.map((e) => ({ ...e }));
}

/** Die Sicherung, die bei Platzmangel zuerst weicht: unwichtigste, davon die älteste. */
function evictIndex(entries: readonly BackupEntry[]): number {
  let best = -1;
  for (let i = 0; i < entries.length; i++) {
    if (best < 0 || backupPriority(entries[i]!.reason) < backupPriority(entries[best]!.reason)) best = i;
  }
  return best;
}

function totalChars(entries: readonly BackupEntry[]): number {
  return entries.reduce((sum, e) => sum + e.code.length, 0);
}

function writeRing(storage: Storage, entries: readonly BackupEntry[]): boolean {
  try {
    storage.setItem(BACKUPS_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/**
 * Legt eine Sicherung im Ring ab. Denselben Code gibt es nur einmal (Grund wird auf den
 * wichtigeren angehoben, Zeitpunkt erneuert). Zu viele bzw. zu große Sicherungen: die
 * unwichtigste älteste weicht – ist das die neue, wird sie verworfen (sie verdrängt keine
 * wichtigeren). Rückgabe: die ID, null = nicht gesichert.
 */
export function addBackup(storage: Storage, entry: Omit<BackupEntry, 'id'>): string | null {
  // Die neue Sicherung eines Tabs ersetzt seine ältere (sein Spiel wächst nur weiter).
  const entries = readBackups(storage).filter((e) => entry.writer === undefined || e.writer !== entry.writer || e.code === entry.code);
  const same = entries.find((e) => e.code === entry.code);
  if (same) {
    if (backupPriority(entry.reason) > backupPriority(same.reason)) same.reason = entry.reason;
    if (entry.owner !== null && same.owner === null) same.owner = entry.owner;
    // Eine gewöhnliche Sicherung desselben Stands bleibt – auch wenn der Tab ihn später sendet.
    if (entry.writer === undefined && same.writer !== undefined) {
      delete same.writer;
      if (same.reason === 'other-tab') same.reason = entry.reason;
    }
    same.at = entry.at;
    writeRing(storage, entries);
    return same.id;
  }
  const id = `${Math.max(0, Math.floor(entry.at)).toString(36)}-${entries.length.toString(36)}-${checksum(entry.code)}`;
  entries.push({ ...entry, id });
  // Zu viele oder zu groß: die unwichtigste älteste weicht (ist es die neue: verwerfen).
  while (entries.length > MAX_BACKUPS || (totalChars(entries) > MAX_BACKUP_CHARS && entries.length > 1)) {
    const index = evictIndex(entries);
    if (index < 0 || entries[index]!.id === id) return null;
    entries.splice(index, 1);
  }
  // Speicher voll: nur weniger wichtige weichen lassen – nie eine gleich wichtige oder
  // wichtigere für die neue opfern; dann lieber nicht sichern (der Aufrufer hält an).
  while (!writeRing(storage, entries)) {
    const index = evictIndex(entries);
    if (index < 0 || backupPriority(entries[index]!.reason) >= backupPriority(entry.reason)) return null;
    entries.splice(index, 1);
  }
  return id;
}

/**
 * Bevor ein Tab den gemeinsamen Spielstand überschreibt: Stammt der gespeicherte Stand von
 * einem anderen Tab (Angaben nicht zu `savedHash`, dem zuletzt hier gespeicherten) und könnte
 * er Aktionen enthalten, die noch nicht in der Cloud sind, wären sie verloren, sobald jener Tab
 * geschlossen ist (z. B. offline). „Könnte“ heißt: Er gehört zu einem Konto und hat laut seinen
 * Angaben eine offene Aktion, keine bekannte Grundlage (z. B. nach einem Absturz) oder Angaben,
 * die nicht zu ihm passen. Dann diesen Stand als 'other-tab' sichern – je Tab nur die neueste.
 * Rein lokale Stände (keine Angaben) bleiben wie bisher. Rückgabe: false = es gab so einen
 * Stand, er ließ sich aber nicht sichern.
 */
export function backupOtherTab(
  storage: Storage,
  savedHash: string | null,
  now: number,
  progressOf: (code: string) => Progress | null,
): boolean {
  try {
    const meta = parseMeta(storage.getItem(BASE_KEY));
    // Schneller Weg (Normalfall): keine Angaben oder die zum eigenen, zuletzt gespeicherten Stand.
    if (!meta || (meta.save !== null && meta.save === savedHash)) return true;
    const code = storage.getItem(SAVE_KEY);
    if (code === null) return true;
    const hash = checksum(code);
    if (hash === savedHash) return true;
    const paired = meta.save === hash;
    if (paired && meta.base && !meta.base.pending) return true;
    const writer = paired && meta.tab ? meta.tab : `save-${hash}`;
    return addBackup(storage, { code, owner: meta.owner, at: now, reason: 'other-tab', progress: progressOf(code), writer }) !== null;
  } catch {
    return false;
  }
}

/** Die 'other-tab'-Sicherungen von `writer` entfernen (seine Aktionen sind jetzt in der Cloud). */
export function dropWriterBackups(storage: Storage, writer: string): void {
  const entries = readBackups(storage);
  const rest = entries.filter((e) => e.writer !== writer);
  if (rest.length === entries.length) return;
  writeRing(storage, rest);
}

/**
 * Platz für den Spielstand schaffen (Speicher voll): die unwichtigste Sicherung entfernen.
 * false = es gibt keine mehr.
 */
export function dropOneBackup(storage: Storage): boolean {
  const entries = readBackups(storage);
  const index = evictIndex(entries);
  if (index < 0) return false;
  entries.splice(index, 1);
  try {
    if (entries.length > 0) storage.setItem(BACKUPS_KEY, JSON.stringify(entries));
    else storage.removeItem(BACKUPS_KEY);
    return true;
  } catch {
    return false;
  }
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
