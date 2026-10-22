/**
 * Bookmark: Lesezeichen-Zurück-Knopf „‹ Nischen“ oben an jeder Unterseite (docs/ALBUM_UI.md,
 * C.1). Er nennt die Herkunft und führt über den Verlauf zurück (`history.back()` im
 * Album), damit Verlauf und Stapel nie auseinanderlaufen.
 */
import { el, setAttr, setText } from '../dom';
import './bookmark.css';

export interface Bookmark {
  readonly element: HTMLButtonElement;
  /** Name der Herkunft, z. B. „Nischen“ oder „Umschlag“. */
  setLabel(label: string): void;
}

export function createBookmark(onBack: () => void): Bookmark {
  const button = el('button', 'bookmark');
  button.type = 'button';
  button.dataset.ref = 'bookmark';
  const text = el('span', 'bookmark-text');
  button.append(text);
  button.addEventListener('click', onBack);
  return {
    element: button,
    setLabel(label) {
      setText(text, `‹ ${label}`);
      setAttr(button, 'aria-label', `Zurück zu ${label}`);
    },
  };
}
