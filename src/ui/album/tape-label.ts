/**
 * TapeLabel: gestricheltes Vorratsschild auf der linken Seite (docs/ALBUM_UI.md, A.2
 * #25–28): Zahl in Caveat (Tintenfarbe je Vorrat), darunter die Beschriftung, ein kleines
 * 🌙 in der Ecke, solange eine Nachtwirkung gilt. `data-ref` der Zahl bleibt wie bisher
 * (`growth-rate`, `seeds`, `harmony`), das 🌙 heißt `<ref>-night`.
 */
import { el, setAttr, setText, srOnly } from '../dom';
import { restartAnimation } from '../feedback';
import './tape-label.css';

export type TapeLabelKind = 'growth' | 'seeds' | 'harmony';

export interface TapeLabel {
  readonly element: HTMLElement;
  readonly value: HTMLElement;
  setValue(text: string): void;
  /** Zusatz hinter der Beschriftung („+3,2/s“), leer = keiner. */
  setSub(text: string): void;
  /** Längere Erklärung als Tooltip und für Screenreader. */
  setTitle(text: string): void;
  /** Nachtwirkung („Nachtbonus: Waldkauz“), leer = keine. */
  setNight(text: string): void;
  /** Kurz hüpfen (z. B. Harmonie gestiegen). */
  pop(): void;
}

/** Ab so vielen Zeichen wird die Zahl kleiner gesetzt (ausgeschriebene Zahlen). */
const LONG_CHARS = 9;

export function createTapeLabel(kind: TapeLabelKind, label: string, ref: string): TapeLabel {
  const box = el('div', `tape-label tape-label-${kind}`);
  const value = el('b', 'tape-label-value');
  value.dataset.ref = ref;
  const caption = el('span', 'tape-label-caption');
  const name = el('span', 'tape-label-name', label);
  const sub = el('span', 'tape-label-sub');
  sub.hidden = true;
  caption.append(name, sub);
  const moon = el('span', 'tape-label-night', '🌙');
  moon.dataset.ref = `${ref}-night`;
  moon.setAttribute('aria-hidden', 'true');
  moon.hidden = true;
  const moonSr = srOnly();
  const titleSr = srOnly();
  box.append(value, caption, moon, moonSr, titleSr);

  return {
    element: box,
    value,
    setValue(text) {
      setText(value, text);
      value.classList.toggle('long', text.length >= LONG_CHARS);
    },
    setSub(text) {
      setText(sub, text ? ` · ${text}` : '');
      sub.hidden = !text;
    },
    setTitle(text) {
      setAttr(box, 'title', text);
      setText(titleSr, text ? ` (${text})` : '');
    },
    setNight(text) {
      const show = text !== '';
      if (moon.hidden === show) moon.hidden = !show;
      setAttr(moon, 'title', text);
      setText(moonSr, show ? ` (${text})` : '');
    },
    pop: () => restartAnimation(value, 'pop'),
  };
}
