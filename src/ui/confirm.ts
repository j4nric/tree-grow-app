/**
 * Bestätigung per zweitem Klick (ohne confirm()): Der zweite Klick zählt nur, wenn er
 * bewusst kommt – nicht als Teil eines Doppelklicks (`detail > 1`) und nicht schneller als
 * CONFIRM_MIN_MS nach dem Scharfschalten (z. B. gehaltene Enter-Taste mit Tastenwiederholung).
 */

/** Frühestens so lange nach dem Scharfschalten gilt ein zweiter Klick als Bestätigung. */
export const CONFIRM_MIN_MS = 500;

/**
 * Sperre nach einem Kauf (z. B. Pflege-Rang): So schnell danach zählt ein weiterer Klick
 * auf denselben Knopf nicht – ein Doppelklick kauft keinen zweiten Rang.
 */
export const REPEAT_GUARD_MS = 400;

/**
 * Ist dieser Klick eine bewusste Bestätigung? `armedAt` und `now` in ms (performance.now).
 * `minMs` ist der Mindestabstand (Standard CONFIRM_MIN_MS, für Käufe REPEAT_GUARD_MS).
 */
export function isDeliberateConfirm(event: Pick<MouseEvent, 'detail'>, armedAt: number, now: number, minMs = CONFIRM_MIN_MS): boolean {
  return event.detail <= 1 && now - armedAt >= minMs;
}

/**
 * Tastenwiederholung einer gehaltenen Enter-/Leertaste? Enter löst den Klick auf einem
 * Knopf schon beim Drücken aus – Wiederholungen (`repeat`) sollen nichts mehr kaufen.
 */
export function isKeyRepeat(event: Pick<KeyboardEvent, 'key' | 'repeat'>): boolean {
  return event.repeat && (event.key === 'Enter' || event.key === ' ');
}

/** Verb der zweiten Bestätigung je nach Eingabe: „tippen“ (Touch) oder „klicken“ (Maus, Tastatur). */
export type ConfirmVerb = 'tippen' | 'klicken';

/**
 * Hauptsächlich Touch (grober Zeiger ohne Hover)? Ohne `matchMedia` (Tests): nein. Gilt für die
 * ganze Sitzung – ein Tablet mit Maus wird zur Maus, sobald der Browser das meldet.
 */
export function confirmVerb(win: Pick<Window, 'matchMedia'> | undefined = typeof window !== 'undefined' ? window : undefined): ConfirmVerb {
  return win?.matchMedia?.('(pointer: coarse)').matches ? 'tippen' : 'klicken';
}

/**
 * Text eines scharfen Knopfs, z. B. „Wirklich neu beginnen? Zum Bestätigen erneut tippen“ –
 * überall dieselbe Wendung (Neuer Zyklus, Korridor, Spielstand löschen, Import).
 */
export function confirmAgainText(question: string, verb: ConfirmVerb = confirmVerb()): string {
  return `${question} Zum Bestätigen erneut ${verb}`;
}
