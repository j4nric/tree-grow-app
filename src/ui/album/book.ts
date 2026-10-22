/**
 * Book: Rahmen des Albums (docs/ALBUM_UI.md, B.0) – Kopf mit Umschlag-Knopf, Titel
 * „Naturtagebuch · ‹Wald›“ und Zettelstapel, darunter der Einband mit der Doppelseite bzw.
 * mobil die Einzelseite. Die Doppelseite gilt im Querformat ab 760 px Breite (G-7); das
 * Layout steht als `data-layout="spread|single"` am Album.
 */
import { el, setText } from '../dom';
import type { Spread } from './spread';
import './tokens.css';
import './album.css';

export type BookLayout = 'spread' | 'single';

/** Doppelseite: Querformat und mindestens 760 px breit. */
export const SPREAD_QUERY = '(min-width: 761px) and (orientation: landscape)';

export interface Book {
  readonly element: HTMLElement;
  /** Kopfzeile links: Umschlag-Knopf (und der Hinweis „Neu hier?“). */
  readonly headStart: HTMLElement;
  /** Kopfzeile rechts: Zettelstapel der Begegnungen. */
  readonly dock: HTMLElement;
  /** Banderolen über dem Buch (Update-Hinweis, neuerer Spielstand). */
  readonly banners: HTMLElement;
  readonly coverButton: HTMLButtonElement;
  readonly layout: BookLayout;
  setForestName(name: string): void;
  onLayoutChange(listener: (layout: BookLayout) => void): void;
}

export function createBook(spread: Spread, cover: HTMLElement, onCover: () => void): Book {
  const root = el('div', 'album');
  root.dataset.ref = 'album';
  const head = el('header', 'album-head');
  const headStart = el('div', 'album-head-start');
  const coverButton = el('button', 'album-cover-button');
  coverButton.type = 'button';
  coverButton.dataset.ref = 'cover-open';
  coverButton.setAttribute('aria-controls', cover.id);
  coverButton.setAttribute('aria-expanded', 'false');
  const coverIcon = el('span', 'album-cover-icon', '☰');
  coverIcon.setAttribute('aria-hidden', 'true');
  coverButton.append(coverIcon, el('span', 'album-cover-text', 'Umschlag'));
  coverButton.addEventListener('click', onCover);
  headStart.append(coverButton);
  const title = el('p', 'album-title');
  const titleText = el('span', '', 'Naturtagebuch');
  const titleForest = el('span', 'album-title-forest');
  title.append(titleText, titleForest);
  const dock = el('div', 'album-dock');
  dock.id = 'scene-dock';
  head.append(headStart, title, dock);
  const banners = el('div', 'album-banners');
  const book = el('div', 'book');
  book.append(spread.main, spread.sub, cover);
  root.append(head, banners, book);

  const query = typeof matchMedia === 'function' ? matchMedia(SPREAD_QUERY) : null;
  let layout: BookLayout = query?.matches ? 'spread' : 'single';
  root.dataset.layout = layout;
  const listeners: ((layout: BookLayout) => void)[] = [];
  query?.addEventListener('change', () => {
    layout = query.matches ? 'spread' : 'single';
    root.dataset.layout = layout;
    for (const listener of listeners) listener(layout);
  });

  return {
    element: root,
    headStart,
    dock,
    banners,
    coverButton,
    get layout() {
      return layout;
    },
    setForestName: (name) => setText(titleForest, name ? ` · ${name}` : ''),
    onLayoutChange: (listener) => listeners.push(listener),
  };
}
