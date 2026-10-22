/**
 * Schwebende Zahlen und kurze Hinweise (Juice, docs/ALBUM_UI.md A.11): Samen über dem
 * Samen-Etikett, Kosten und Name einer gesetzten Pflanze, Hinweissätze über der Szene. Die
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
  /** Gesetzte Pflanze: Kosten über dem Samen-Etikett, Name über dem Pflanzring. */
  plant(cost: number, plantId: string): void;
  /** Hinweis an Bildschirm-Koordinaten (z. B. Bestätigung nach einem Kauf). */
  note(text: string, x: number, y: number): void;
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
    plant(cost, plantId) {
      const seedsAt = topCenter(document.querySelector('[data-ref="seeds"]'));
      if (seedsAt) layer.spawn(`−${formatNumber(Math.ceil(cost))} 🌰`, seedsAt.x, seedsAt.y);
      const ringAt = topCenter(document.querySelector('[data-ref="plant-ring"]'), true);
      if (ringAt) layer.spawn(`🌱 ${PLANTS_BY_ID.get(plantId)?.name ?? ''}`, ringAt.x, ringAt.y + 24);
    },
    note: (text, x, y) => layer.spawn(text, x, y, 'note'),
  };
}
