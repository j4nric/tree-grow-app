/**
 * Schwebende Zahlen und kurze Hinweise (Juice, docs/ALBUM_UI.md A.11): Samen über dem
 * Samen-Etikett, Kosten einer Aussaat, Name einer gesetzten Pflanze, Hinweissätze über der Szene. Die
 * Ebene liegt über der ganzen Seite (ui/feedback.ts) und ist für Screenreader verborgen –
 * Hinweissätze gehen darum zusätzlich in die unsichtbare Statuszeile `#live-status`.
 */
import { PLANTS_BY_ID } from '../../content/plants';
import { createFloatLayer } from '../feedback';
import { formatNumber } from '../format';
import { seedsLabel } from '../view-format';

export interface Floats {
  /** Hinweissatz über der Szene (Polaroid bzw. Vollbild) – auch für Screenreader. */
  sceneNote(text: string): void;
  /** „+12 🌰“ über dem Samen-Etikett. */
  seeds(amount: number): void;
  /** Aus einer Aussaat gesetzte Pflanze: Name über dem Pflanzring. */
  plant(plantId: string): void;
  /** „−35 🌰“ über dem Samen-Etikett (ausgegebene Samen, z. B. Säen). */
  spent(amount: number): void;
  /**
   * Hinweis an Bildschirm-Koordinaten (z. B. Bestätigung nach einem Kauf). Gehört zur Seite,
   * auf der er steht – `clearPage` nimmt ihn beim Seitenwechsel mit (Playtest Phase 11, F9).
   */
  note(text: string, x: number, y: number): void;
  /** Hinweise der bisherigen Seite entfernen (Reiter- bzw. Seitenwechsel). */
  clearPage(): void;
}

export function createFloats(canvas: HTMLCanvasElement): Floats {
  const layer = createFloatLayer(document.body);
  const liveStatus = document.querySelector<HTMLElement>('#live-status');
  /** Oberkante Mitte eines Elements; `visible`: nur, wenn es gerade ausgelegt ist. */
  const topCenter = (node: Element | null, visible = false): { x: number; y: number } | null => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return !visible || rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top } : null;
  };

  return {
    sceneNote(text) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) layer.spawn(text, rect.left + rect.width / 2, rect.top + rect.height * 0.3, 'note');
      if (liveStatus) {
        liveStatus.textContent = '';
        requestAnimationFrame(() => (liveStatus.textContent = text));
      }
    },
    seeds(amount) {
      const at = topCenter(document.querySelector('[data-ref="seeds"]'));
      // Gerundet wie der Knopf („Ablehnen (+144 🌰)“), damit beide dieselbe Zahl zeigen.
      if (at && amount > 0) layer.spawn(`+${seedsLabel(amount)} 🌰`, at.x, at.y);
    },
    spent(amount) {
      const seedsAt = topCenter(document.querySelector('[data-ref="seeds"]'));
      if (seedsAt && amount > 0) layer.spawn(`−${formatNumber(Math.ceil(amount))} 🌰`, seedsAt.x, seedsAt.y);
    },
    plant(plantId) {
      const ringAt = topCenter(document.querySelector('[data-ref="plant-ring"]'), true);
      if (ringAt) layer.spawn(`🌱 ${PLANTS_BY_ID.get(plantId)?.name ?? ''}`, ringAt.x, ringAt.y + 24);
    },
    note: (text, x, y) => layer.spawn(text, x, y, 'note', true),
    clearPage: () => layer.clearScoped(),
  };
}
