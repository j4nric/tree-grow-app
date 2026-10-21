/**
 * Einstellungen der Oberfläche (nicht Teil des Spielstands): Bewegung, Zahlenformat,
 * Dauer der Hinweise, Klang. Gespeichert in localStorage unter eigenem Schlüssel – „Spielstand
 * löschen“ und Export/Import berühren sie nicht.
 *
 * Reine Funktionen (plus robustes Laden/Speichern) – getestet in tests/settings.test.ts.
 */
import type { NumberStyle } from './format';

/** Bewegung reduzieren: automatisch (prefers-reduced-motion), immer an oder immer aus. */
export type MotionSetting = 'auto' | 'on' | 'off';

/** Klangkulisse: aus (Standard), leise oder normal. */
export type SoundLevel = 'off' | 'quiet' | 'normal';

export interface Settings {
  motion: MotionSetting;
  numbers: NumberStyle;
  /** Hinweise (Toasts) länger anzeigen. */
  longToasts: boolean;
  sound: SoundLevel;
}

export const SETTINGS_KEY = 'tree-grow-settings';
/** Merker: Der Hinweis „Neu hier? Spielanleitung öffnen“ wurde schon gezeigt. */
export const GUIDE_HINT_KEY = 'tree-grow-guide-hint-seen';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  motion: 'auto',
  numbers: 'short',
  longToasts: false,
  sound: 'off',
};

/** Anzeigedauer der Hinweise (Toasts) in ms. */
export const TOAST_MS = 6000;
export const LONG_TOAST_MS = 12000;

const MOTIONS: readonly MotionSetting[] = ['auto', 'on', 'off'];
const NUMBER_STYLES: readonly NumberStyle[] = ['short', 'long'];
export const SOUND_LEVELS: readonly SoundLevel[] = ['off', 'quiet', 'normal'];

/** Liest gespeicherte Einstellungen; Unbekanntes oder Kaputtes → Standard (feldweise). */
export function parseSettings(raw: string | null | undefined): Settings {
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const record = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    motion: MOTIONS.includes(record.motion as MotionSetting) ? (record.motion as MotionSetting) : DEFAULT_SETTINGS.motion,
    numbers: NUMBER_STYLES.includes(record.numbers as NumberStyle) ? (record.numbers as NumberStyle) : DEFAULT_SETTINGS.numbers,
    longToasts: typeof record.longToasts === 'boolean' ? record.longToasts : DEFAULT_SETTINGS.longToasts,
    sound: SOUND_LEVELS.includes(record.sound as SoundLevel) ? (record.sound as SoundLevel) : DEFAULT_SETTINGS.sound,
  };
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify({
    motion: settings.motion,
    numbers: settings.numbers,
    longToasts: settings.longToasts,
    sound: settings.sound,
  });
}

/** Wirksame Einstellung „weniger Bewegung“: „auto“ folgt dem System. */
export function effectiveReducedMotion(motion: MotionSetting, systemPrefersReduced: boolean): boolean {
  if (motion === 'on') return true;
  if (motion === 'off') return false;
  return systemPrefersReduced;
}

export function toastDuration(settings: Pick<Settings, 'longToasts'>): number {
  return settings.longToasts ? LONG_TOAST_MS : TOAST_MS;
}

/** Lädt die Einstellungen; ohne localStorage (privater Modus) einfach die Standardwerte. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Speichert die Einstellungen; Fehler (voll, gesperrt) werden ignoriert. */
export function saveSettings(settings: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, serializeSettings(settings));
  } catch {
    // ignorieren – dann gelten die Einstellungen nur bis zum Neuladen
  }
}

/**
 * Erster Start: Soll der Hinweis „Neu hier?“ erscheinen? Merkt sich das Zeigen gleich,
 * damit er nur beim allerersten Start kommt. Ohne Speicher: nicht zeigen (sonst käme er
 * bei jedem Laden wieder).
 */
export function takeFirstStartHint(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): boolean {
  try {
    if (!storage || storage.getItem(GUIDE_HINT_KEY) === '1') return false;
    storage.setItem(GUIDE_HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
