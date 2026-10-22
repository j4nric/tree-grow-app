/**
 * Page: Grundgerüst einer Album-Seite (docs/ALBUM_UI.md, B.0 und D.1) – Kopf mit
 * Caveat-Überschrift (als Frage) und kurzer Kennzahl rechts, Inhalt, Seitenzahl unten rechts.
 * Die Überschrift ist per Skript fokussierbar (`tabindex=-1`): Nach dem Umblättern bekommt
 * sie den Fokus.
 *
 * DOM einmal bauen; `setTitle`/`setMeta`/`setNumber` ändern nur bei neuem Text.
 */
import { el, setText } from '../dom';
import './page.css';

export interface PageOptions {
  /** Art der Seite, wird zu `data-ref="page-<kind>"`. */
  kind: string;
  title: string;
  meta?: string;
  number?: number;
  /** Weitere Klassen (z. B. `album-tabpanel`). */
  className?: string;
}

export interface Page {
  readonly element: HTMLElement;
  readonly header: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly meta: HTMLElement;
  /** Inhalt der Seite. */
  readonly body: HTMLElement;
  setTitle(text: string): void;
  setMeta(text: string): void;
  setNumber(n: number | null): void;
  /** Fokus auf die Überschrift, ohne die Seite zu verschieben. */
  focusTitle(): void;
}

export function createPage(options: PageOptions): Page {
  const element = el('section', `album-page${options.className ? ` ${options.className}` : ''}`);
  element.dataset.ref = `page-${options.kind}`;
  const header = el('header', 'page-head');
  const title = el('h2', 'page-title', options.title);
  title.tabIndex = -1;
  title.id = `page-title-${options.kind}`;
  element.setAttribute('aria-labelledby', title.id);
  const meta = el('span', 'page-meta', options.meta ?? '');
  meta.hidden = !options.meta;
  header.append(title, meta);
  const body = el('div', 'page-body');
  const number = el('span', 'page-number');
  number.setAttribute('aria-hidden', 'true');
  element.append(header, body, number);

  const setNumber = (n: number | null) => {
    setText(number, n === null ? '' : `S. ${n}`);
    number.hidden = n === null;
  };
  setNumber(options.number ?? null);

  return {
    element,
    header,
    title,
    meta,
    body,
    setTitle: (text) => setText(title, text),
    setMeta(text) {
      setText(meta, text);
      meta.hidden = !text;
    },
    setNumber,
    focusTitle: () => title.focus({ preventScroll: true }),
  };
}
