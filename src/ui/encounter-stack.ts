/**
 * Begegnungs-Stapel (Design v2, 11.1): ein ruhiger Kartenstapel am Rand der Szene.
 * Er zeigt, wie viele Begegnungen warten, und öffnet auf Wunsch den Kartenwahl-Dialog –
 * der Dialog drängt sich nie von selbst auf.
 *
 * Auf dem Handy liegt die Szene oben auf der Seite: Ist der Stapel aus dem Bild gescrollt,
 * schwebt er unten rechts am Bildschirmrand (Klasse `floating` am Dock, siehe CSS), damit
 * eine wartende Begegnung nie unsichtbar ist.
 *
 * `update()` darf jeden Frame laufen; es ändert nur bei neuer Anzahl etwas am DOM.
 */
import { el, setAttr, setText } from './dom';
import { restartAnimation } from './feedback';
import { waitingText } from './view-format';

export interface EncounterStack {
  /** `kind`: Typ der vordersten Begegnung – bestimmt das Symbol auf dem Stapel. */
  update(count: number, kind?: 'animal' | 'plant' | 'event' | 'visitor'): void;
  readonly element: HTMLButtonElement;
}

export { waitingText };

/** Symbol auf dem Stapel je Art der obersten Begegnung. */
const STACK_ICONS = { animal: '🐾', plant: '🌱', event: '⛈️', visitor: '🦢' } as const;

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
  watchScroll(root);

  let shown = -1;
  let shownKind = '';

  function update(count: number, kind: 'animal' | 'plant' | 'event' | 'visitor' = 'animal'): void {
    if (kind !== shownKind) {
      shownKind = kind;
      setText(icon, STACK_ICONS[kind]);
    }
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

/**
 * Beobachtet einen unsichtbaren Platzhalter an der Stelle des Stapels (oben in der Szene).
 * Ist er nicht mehr vollständig zu sehen, bekommt das Dock die Klasse `floating`. Ob das
 * Dock dann wirklich schwebt, entscheidet das CSS (nur im einspaltigen Mobil-Layout).
 */
function watchScroll(dock: HTMLElement): void {
  const scene = dock.parentElement;
  if (!scene || typeof IntersectionObserver !== 'function') return;
  const marker = el('span', 'scene-dock-marker');
  marker.setAttribute('aria-hidden', 'true');
  scene.append(marker);
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      if (entry) dock.classList.toggle('floating', entry.intersectionRatio < 0.99);
    },
    { threshold: [0, 0.99, 1] },
  );
  observer.observe(marker);
}
