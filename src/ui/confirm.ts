/**
 * Bestätigung per zweitem Klick (ohne confirm()): Der zweite Klick zählt nur, wenn er
 * bewusst kommt – nicht als Teil eines Doppelklicks (`detail > 1`) und nicht schneller als
 * CONFIRM_MIN_MS nach dem Scharfschalten (z. B. gehaltene Enter-Taste mit Tastenwiederholung).
 */

/** Frühestens so lange nach dem Scharfschalten gilt ein zweiter Klick als Bestätigung. */
export const CONFIRM_MIN_MS = 500;

/** Ist dieser Klick eine bewusste Bestätigung? `armedAt` und `now` in ms (performance.now). */
export function isDeliberateConfirm(event: Pick<MouseEvent, 'detail'>, armedAt: number, now: number): boolean {
  return event.detail <= 1 && now - armedAt >= CONFIRM_MIN_MS;
}
