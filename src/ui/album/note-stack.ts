/**
 * Zettelstapel der Begegnungen (docs/ALBUM_UI.md, C.7 und A.6 #67) – ersetzt den alten
 * Begegnungs-Stapel am Rand der Szene. Ein gelber Zettel mit „2 Zettel: Besuch wartet!“,
 * dahinter je nach Anzahl ein zweiter und dritter (Schatten). Er drängt sich nie auf: Erst
 * ein Tipp blättert zu U:Begegnung um. Kommt ein Zettel dazu, wackelt er einmal (bei
 * reduzierter Bewegung nur ein kurzer Farbblitz).
 *
 * Mobil liegt er fest unten rechts, am Desktop im Kopf rechts (CSS über `data-layout`).
 * Auf U:Begegnung selbst ist er verborgen (`setAway`).
 *
 * `update()` darf jeden Frame laufen; es ändert das DOM nur bei neuer Anzahl bzw. neuer
 * oberster Begegnung.
 */
import { el, setAttr, setText } from '../dom';
import { restartAnimation } from '../feedback';
import { hyphenate } from '../hyphenate';
import { waitingText } from '../view-format';
import { stackCountText, stackHeadline, stackIcon, stackLayers, type StackHead } from './note-stack-view';
import './note-stack.css';

export interface NoteStack {
  readonly element: HTMLButtonElement;
  /** Anzahl wartender Begegnungen und die vorderste (Symbol und Text). */
  update(count: number, head?: StackHead): void;
  /** Verbergen, solange U:Begegnung aufgeschlagen ist. */
  setAway(away: boolean): void;
}

export function createNoteStack(root: HTMLElement, onOpen: () => void): NoteStack {
  const button = el('button', 'note-stack');
  button.type = 'button';
  button.dataset.ref = 'encounter-stack';
  button.hidden = true;
  const icon = el('span', 'note-stack-icon stack-icon', '🐾');
  icon.setAttribute('aria-hidden', 'true');
  const text = el('span', 'note-stack-text');
  text.setAttribute('aria-hidden', 'true');
  const count = el('span', 'note-stack-count');
  const headline = el('span', 'note-stack-headline');
  text.append(count, ' ', headline);
  button.append(icon, text);
  // Ansage für Screenreader, wenn ein Zettel dazukommt (außerhalb des Knopfs, damit sie
  // auch beim ersten Erscheinen gelesen wird).
  const live = el('span', 'sr-only');
  live.setAttribute('role', 'status');
  root.append(button, live);
  button.addEventListener('click', onOpen);

  let shown = -1;
  let away = false;
  let headKey = '';

  function setVisible(): void {
    const hide = shown <= 0 || away;
    if (button.hidden !== hide) button.hidden = hide;
  }

  return {
    element: button,
    update(n, head) {
      const key = head ? `${head.type}:${head.cards[0] ?? ''}` : '';
      if (key !== headKey) {
        headKey = key;
        setText(icon, stackIcon(head));
        setText(headline, hyphenate(stackHeadline(head)));
      }
      if (n === shown) return;
      const grew = shown >= 0 && n > shown;
      shown = n;
      setVisible();
      if (n <= 0) return;
      setText(count, stackCountText(n));
      setAttr(button, 'aria-label', `${waitingText(n)} – ansehen`);
      button.dataset.count = String(stackLayers(n));
      if (grew) {
        // Neuer Zettel: einmal wackeln (CSS: bei reduzierter Bewegung nur Farbblitz).
        restartAnimation(button, 'note-stack-wobble');
        live.textContent = `Neue Begegnung: ${waitingText(n)}`;
      }
    },
    setAway(next) {
      if (away === next) return;
      away = next;
      setVisible();
    },
  };
}
