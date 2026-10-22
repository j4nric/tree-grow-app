/**
 * Lage einer Haftnotiz (docs/ALBUM_UI.md, C.4) – reine Rechnung ohne DOM, damit sie sich
 * mit Vitest prüfen lässt. Unter dem Auslöser, rechtsbündig an ihm, nie über den Rand des
 * Fensters hinaus; ist unten kein Platz, kommt sie darüber. Kein CSS-Anchor-Positioning.
 */

export interface NoteRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NoteSize {
  width: number;
  height: number;
}

export interface NotePlacement {
  left: number;
  top: number;
  /** Liegt über dem Auslöser (unten war kein Platz). */
  above: boolean;
}

/** Abstand zum Fensterrand. */
export const NOTE_EDGE = 12;
/** Abstand zum Auslöser (Platz für den Washi-Streifen oben). */
export const NOTE_GAP = 14;

export function notePosition(anchor: NoteRect, note: NoteSize, viewport: NoteSize): NotePlacement {
  const maxLeft = Math.max(NOTE_EDGE, viewport.width - NOTE_EDGE - note.width);
  const left = Math.round(Math.min(maxLeft, Math.max(NOTE_EDGE, anchor.right - note.width)));
  const below = anchor.bottom + NOTE_GAP;
  const aboveTop = anchor.top - NOTE_GAP - note.height;
  const fitsBelow = below + note.height <= viewport.height - NOTE_EDGE;
  if (fitsBelow || aboveTop < NOTE_EDGE) {
    // Passt sie nirgends ganz, bleibt sie unten (oben abgeschnitten wäre schlimmer) – aber im Bild.
    const top = fitsBelow ? below : Math.max(NOTE_EDGE, Math.min(below, viewport.height - NOTE_EDGE - note.height));
    return { left, top: Math.round(top), above: false };
  }
  return { left, top: Math.round(aboveTop), above: true };
}
