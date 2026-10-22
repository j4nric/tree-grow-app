/**
 * Spread: linke und rechte Seite mit Buchfalz (docs/ALBUM_UI.md, B.0). Auf der Doppelseite
 * liegen sie nebeneinander im Einband, mobil untereinander (die linke Seite ist dann
 * Polaroid, Etiketten und Stufenleiste über den Reitern).
 *
 * `main` ist die Hauptansicht: mobil dreht sich beim Umblättern genau sie weg, auf der
 * Doppelseite nur `right` (die linke Seite mit dem Polaroid bleibt stehen, G-2).
 */
import { el } from '../dom';

export interface Spread {
  /** Hauptansicht (mobil die umblätternde Seite). */
  readonly main: HTMLElement;
  /** Linke Seite: Polaroid, Etiketten, Stufenleiste, Rückkehr-Bericht. */
  readonly left: HTMLElement;
  /** Rechte Seite: Reiterseiten (Doppelseite: die umblätternde Seite). */
  readonly right: HTMLElement;
  /** Ablage der Unterseiten (liegt unter der umblätternden Seite). */
  readonly sub: HTMLElement;
}

export function createSpread(tabs: HTMLElement): Spread {
  const main = el('div', 'spread-main');
  const left = el('section', 'spread-left');
  left.setAttribute('aria-label', 'Dein Wald');
  const spine = el('div', 'spread-spine');
  spine.setAttribute('aria-hidden', 'true');
  const right = el('div', 'spread-right');
  main.append(left, spine, tabs, right);
  const sub = el('div', 'spread-sub');
  sub.hidden = true;
  return { main, left, right, sub };
}
