/**
 * Regeln der Meldungsschicht (docs/ALBUM_UI.md, C.5) – rein, ohne DOM (Vitest):
 * Stempel oder Zettel, Farbe, Standzeit und wer weichen muss.
 */

/** Ab so vielen Zeichen wird aus dem Stempel ein Zettel (G-23: etwa zwei Zeilen bei 360 px). */
export const SLIP_MIN_CHARS = 90;
/** Höchstens so viele Meldungen gleichzeitig; die älteste weicht. */
export const MAX_STAMPS = 2;

export type StampKind = 'stamp' | 'slip';

/** Wie eine Meldung erscheinen soll (`album.notify(text, options)`). */
export interface NotifyOptions {
  /** Fehlermeldung einer Aktion: roter Rahmen. */
  error?: boolean;
  /** Zettel, der bis zum Schließen bleibt (Landschaft frei, v1-Hinweis, angehaltener Tab). */
  keep?: boolean;
  /** Kurzfassung: höchstens drei Zeilen (Rückkehr). */
  brief?: boolean;
  /**
   * Immer in der Meldungsschicht – auch wenn noch ein alter Dialog mit eigenem Hinweisfeld
   * offen ist (bis Schritt 12; früher `showToast`).
   */
  direct?: boolean;
}

export function stampKind(text: string, options: NotifyOptions = {}): StampKind {
  return options.keep || [...text].length > SLIP_MIN_CHARS ? 'slip' : 'stamp';
}

/**
 * Standzeit in ms: Stempel so lange wie früher der Toast (`base` aus `toastDurationFor`),
 * Zettel doppelt so lange, bleibende Zettel ohne Ablauf (null).
 */
export function stampDuration(kind: StampKind, base: number, options: NotifyOptions = {}): number | null {
  if (options.keep) return null;
  return kind === 'slip' ? base * 2 : base;
}

export interface ShownStamp {
  /** Laufende Nummer (älter = kleiner). */
  serial: number;
  keep: boolean;
}

/**
 * Welche Meldungen müssen weichen, damit eine neue dazukommt? Zuerst die ältesten, die von
 * selbst gingen; bleibende Zettel erst, wenn nur noch sie da sind.
 */
export function stampsToDrop(shown: readonly ShownStamp[], max = MAX_STAMPS): number[] {
  const excess = shown.length + 1 - max;
  if (excess <= 0) return [];
  const byAge = [...shown].sort((a, b) => a.serial - b.serial);
  const order = [...byAge.filter((s) => !s.keep), ...byAge.filter((s) => s.keep)];
  return order.slice(0, excess).map((s) => s.serial);
}
