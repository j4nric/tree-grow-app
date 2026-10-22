/**
 * Texte und Symbol des Zettelstapels (docs/ALBUM_UI.md, A.6 #67 und C.7) – reine Funktionen
 * ohne DOM, mit Vitest geprüft. Ersetzt die Exporte aus dem alten `encounter-stack.ts`.
 */
import { EVENTS_BY_ID } from '../../content/events';
import { VISITORS_BY_ID } from '../../content/visitors';
import type { PendingEncounter } from '../../core/state';
import { formatNumber } from '../format';

/** Vorderste Begegnung, so weit der Stapel sie braucht. */
export type StackHead = Pick<PendingEncounter, 'type' | 'cards'>;

/** Symbol auf dem Stapel je Art der obersten Begegnung (Ersatz, wenn die Karte unbekannt ist). */
const STACK_ICONS = { animal: '🐾', plant: '🌱', event: '⛈️', visitor: '🦢' } as const;

/**
 * Symbol der vordersten Begegnung: bei Ereignis und Gast das eigene Symbol aus content
 * (🌩️ Sturmnacht, 🐝 Bienenschwarm, 🦢 Kranichzug …), sonst das der Art der Begegnung.
 */
export function stackIcon(head: StackHead | undefined): string {
  if (!head) return STACK_ICONS.animal;
  const id = head.cards[0] ?? '';
  if (head.type === 'event') return EVENTS_BY_ID.get(id)?.icon ?? STACK_ICONS.event;
  if (head.type === 'visitor') return VISITORS_BY_ID.get(id)?.icon ?? STACK_ICONS.visitor;
  return STACK_ICONS[head.type] ?? STACK_ICONS.animal;
}

/**
 * Zeile nach „2 Zettel:“ – je nach oberster Begegnung: „Besuch wartet!“ (Tier), „Etwas
 * keimt!“ (Pflanze), bei Ereignis und Gast deren Name („Sturmnacht!“, „Kranichzug!“).
 */
export function stackHeadline(head: StackHead | undefined): string {
  if (head?.type === 'plant') return 'Etwas keimt!';
  const id = head?.cards[0] ?? '';
  if (head?.type === 'event') return `${EVENTS_BY_ID.get(id)?.name ?? 'Ein Ereignis'}!`;
  if (head?.type === 'visitor') return `${VISITORS_BY_ID.get(id)?.name ?? 'Besuch auf der Durchreise'}!`;
  return 'Besuch wartet!';
}

/** „1 Zettel:“ bzw. „3 Zettel:“ (Zettel bleibt in der Mehrzahl gleich). */
export function stackCountText(count: number): string {
  return `${formatNumber(Math.max(0, Math.floor(count)))} Zettel:`;
}

/** Ganzer Text des Stapels, z. B. „2 Zettel: Besuch wartet!“. */
export function stackText(count: number, head: StackHead | undefined): string {
  return `${stackCountText(count)} ${stackHeadline(head)}`;
}

/** Wie viele Zettel der Schatten andeutet (1–3): ab 2 ein zweiter, ab 3 ein dritter (C.7). */
export function stackLayers(count: number): number {
  return Math.max(1, Math.min(3, Math.floor(count)));
}
