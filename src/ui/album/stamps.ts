/**
 * Stamps: Meldungsschicht über dem Album, auch über Unterseiten und Vollbild (docs/ALBUM_UI.md,
 * C.5). Ersetzt den alten Toast – Stempel und Zettel haben einen festen Platz, der keine
 * Navigation verdeckt: unten über der Seite; nur mobil ganz oben auf der Hauptansicht und im
 * Vollbild oben über dem Bild (`setTop`, entscheidet album/index.ts).
 *
 * - **Stempel** (bis 90 Zeichen): Tintenrahmen, −3°, Caveat; „stempelt“ herein.
 * - **Zettel** (länger oder `keep`): gelber Zettel mit Tape und „×“, steht doppelt so lange
 *   bzw. bis zum Schließen.
 * - Höchstens zwei zugleich, die älteste weicht. Dieselbe Meldung erneut ersetzt die alte.
 * - `role="status"` an der Schicht; Klicks gehen durch (außer auf „×“).
 * - Unter den Banderolen (`below`): Steht eine im Bild, rückt die Schicht darunter. Gerechnet
 *   wird nur beim Zeigen und wenn sich die Banderolen ändern – nie pro Frame.
 *
 * Jede Meldung ist ein eigenes kleines Element (Meldungen kommen selten, nie pro Frame).
 */
import { el } from '../dom';
import { toastDurationFor } from '../settings';
import { stampDuration, stampKind, stampsToDrop, type NotifyOptions } from './stamp-rules';
import './stamps.css';

export type { NotifyOptions } from './stamp-rules';

export interface Stamps {
  readonly element: HTMLElement;
  show(text: string, options?: NotifyOptions): void;
  /** Alle Meldungen weg (z. B. Spielstand ersetzt). */
  clear(): void;
  /** Oben über dem Bild statt unten über der Seite (nur, wo oben keine Navigation liegt). */
  setTop(top: boolean): void;
}

interface Shown {
  serial: number;
  keep: boolean;
  text: string;
  node: HTMLElement;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Ausblenden dauert so lange (CSS .stamp-out). */
const OUT_MS = 180;

export function createStamps(toastMs: () => number, reducedMotion: () => boolean, below?: HTMLElement): Stamps {
  const layer = el('div', 'stamps');
  layer.id = 'stamps';
  layer.dataset.ref = 'stamps';
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  let serial = 0;
  const shown: Shown[] = [];

  /** Unterkante der Banderolen (falls im Bild) als `--stamps-below`. */
  function placeBelow(): void {
    if (!below) return;
    const rect = below.getBoundingClientRect();
    const bottom = rect.height > 0 && rect.bottom > 0 ? Math.round(rect.bottom + 16) : 0;
    const value = `${bottom}px`;
    if (layer.style.getPropertyValue('--stamps-below') !== value) layer.style.setProperty('--stamps-below', value);
  }
  if (below && typeof ResizeObserver === 'function') new ResizeObserver(placeBelow).observe(below);

  function remove(item: Shown, animate: boolean): void {
    const index = shown.indexOf(item);
    if (index < 0) return;
    shown.splice(index, 1);
    clearTimeout(item.timer);
    // Für Tests und Screenreader sofort keine Meldung mehr; das Ausblenden ist nur Optik.
    item.node.removeAttribute('data-ref');
    item.node.setAttribute('aria-hidden', 'true');
    if (!animate || reducedMotion()) {
      item.node.remove();
      return;
    }
    item.node.classList.add('stamp-out');
    setTimeout(() => item.node.remove(), OUT_MS);
  }

  function show(text: string, options: NotifyOptions = {}): void {
    if (!text) return;
    for (const item of [...shown]) if (item.text === text) remove(item, false);
    for (const drop of stampsToDrop(shown)) {
      const item = shown.find((s) => s.serial === drop);
      if (item) remove(item, true);
    }
    const kind = stampKind(text, options);
    const node = el('div', `stamp stamp-${kind}`);
    node.dataset.ref = 'stamp';
    node.dataset.kind = kind;
    if (options.error) node.classList.add('stamp-error');
    if (options.brief) node.classList.add('stamp-brief');
    const body = el('p', 'stamp-text', text);
    node.append(body);
    const item: Shown = { serial: ++serial, keep: Boolean(options.keep), text, node, timer: undefined };
    if (kind === 'slip') {
      const tape = el('span', 'stamp-tape');
      tape.setAttribute('aria-hidden', 'true');
      // „×“ kommt aus dem CSS: textContent der Meldung bleibt genau ihr Text.
      const close = el('button', 'stamp-close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Zettel schließen');
      close.title = 'Schließen';
      close.addEventListener('click', () => remove(item, true));
      node.prepend(tape);
      node.append(close);
    }
    const ms = stampDuration(kind, toastDurationFor(text, toastMs()), options);
    if (ms !== null) item.timer = setTimeout(() => remove(item, true), ms);
    shown.push(item);
    layer.append(node);
    placeBelow();
  }

  return {
    element: layer,
    show,
    clear() {
      for (const item of [...shown]) remove(item, false);
    },
    setTop(top) {
      if (layer.classList.contains('stamps-top') === top) return;
      layer.classList.toggle('stamps-top', top);
      placeBelow();
    },
  };
}
