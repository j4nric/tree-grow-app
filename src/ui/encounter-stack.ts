/**
 * Begegnungs-Stapel (Design v2, 11.1): ein ruhiger Kartenstapel am Rand der Szene.
 * Er zeigt, wie viele Begegnungen warten, und öffnet auf Wunsch den Kartenwahl-Dialog –
 * der Dialog drängt sich nie von selbst auf.
 *
 * `update()` darf jeden Frame laufen; es ändert nur bei neuer Anzahl etwas am DOM.
 */
import { el, setAttr, setText } from './dom';
import { restartAnimation } from './feedback';
import { formatNumber } from './format';

export interface EncounterStack {
  update(count: number): void;
  readonly element: HTMLButtonElement;
}

/** „1 Begegnung wartet“ / „3 Begegnungen warten“. */
export function waitingText(count: number): string {
  return count === 1 ? '1 Begegnung wartet' : `${formatNumber(count)} Begegnungen warten`;
}

export function createEncounterStack(root: HTMLElement, onOpen: () => void): EncounterStack {
  const button = el('button', 'encounter-stack');
  button.type = 'button';
  button.dataset.ref = 'encounter-stack';
  button.hidden = true;

  const cards = el('span', 'stack-cards');
  cards.setAttribute('aria-hidden', 'true');
  const icon = el('span', 'stack-icon', '🐾');
  cards.append(el('span', 'stack-card'), el('span', 'stack-card'), el('span', 'stack-card'), icon);
  const text = el('span', 'stack-text');
  button.append(cards, text);
  // Ansage für Screenreader, wenn eine Begegnung dazukommt (außerhalb des Knopfs,
  // damit sie auch beim ersten Erscheinen gelesen wird).
  const live = el('span', 'sr-only');
  live.setAttribute('role', 'status');
  root.append(button, live);

  button.addEventListener('click', onOpen);

  let shown = -1;

  function update(count: number): void {
    if (count === shown) return;
    const grew = shown >= 0 && count > shown;
    shown = count;
    button.hidden = count <= 0;
    if (count <= 0) return;
    setText(text, waitingText(count));
    setAttr(button, 'aria-label', `${waitingText(count)} – ansehen`);
    button.dataset.count = String(Math.min(count, 3));
    // Neue Begegnung: kurz anstupsen (bei reduzierter Bewegung nur Aufleuchten, siehe CSS)
    if (grew) {
      restartAnimation(button, 'nudge');
      live.textContent = `Neue Begegnung: ${waitingText(count)}`;
    }
  }

  return { update, element: button };
}
