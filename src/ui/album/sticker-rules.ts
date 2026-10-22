/**
 * Regeln der Album-Sticker (docs/ALBUM_UI.md, D.4) – reine Funktionen ohne DOM (Vitest).
 *
 * - Neigung: fest aus der Art-ID und der Platznummer, −6° bis +6°. Derselbe Sticker liegt so
 *   immer gleich schief, auch nach dem Neuladen.
 * - Variante des Bilds: matt, solange die Art ruht (Winterschlaf) oder ausgezogen ist.
 */
import type { StickerVariant } from '../../render/sticker';

/** Größte Neigung eines Stickers in Grad (beide Richtungen). */
export const STICKER_TILT_MAX = 6;

/** FNV-1a über die UTF-16-Zeichen (32 Bit, ohne Vorzeichen). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Neigung in ganzen Grad (−6 … +6) für Art `id` auf Platz `index`. 0° kommt nicht vor
 * (ein ganz gerader Sticker wirkt im Album wie ein Fehler).
 */
export function stickerTilt(id: string, index = 0): number {
  const slot = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const h = hash(`${id}#${slot}`);
  const magnitude = 1 + (h % STICKER_TILT_MAX); // 1 … 6
  return (h >>> 8) % 2 === 0 ? magnitude : -magnitude;
}

/** Bild-Variante eines Tier-Stickers: matt bei ruhenden (Winterschlaf) oder ausgezogenen Arten. */
export function stickerVariant(animal: { night?: { resting: boolean } | undefined; gone?: boolean }): StickerVariant {
  return animal.gone || animal.night?.resting ? 'muted' : 'color';
}

/** Zufriedenheit 0–1 als Winkel des Bogens im weißen Rand (NaN → 0). */
export function happinessArc(happiness: number): number {
  const h = Number.isFinite(happiness) ? Math.min(1, Math.max(0, happiness)) : 0;
  return Math.round(h * 360);
}
