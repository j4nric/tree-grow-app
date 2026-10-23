/**
 * Stamps: Meldungsschicht über dem Album, auch über Unterseiten und Vollbild (docs/ALBUM_UI.md,
 * C.5). Ersetzt den alten Toast – Stempel und Zettel haben einen festen Platz, der keine
 * Navigation verdeckt: unten über der Seite; nur mobil oben auf der Hauptansicht und im
 * Vollbild oben über dem Bild (`setTop`, entscheidet album/index.ts). Liegt unten etwas, das
 * frei bleiben muss (Bestätigung, „Schließen“, fokussierter Knopf), rückt die Schicht darüber
 * (`setLift`). Wechselt sie die Seite, während sie zu sehen ist, blendet sie kurz über statt
 * zu springen.
 *
 * - **Stempel** (bis 90 Zeichen): Tintenrahmen, −3°, Caveat; „stempelt“ herein.
 * - **Zettel** (länger oder `keep`): gelber Zettel mit Tape und „×“, steht doppelt so lange
 *   bzw. bis zum Schließen.
 * - Höchstens zwei zugleich, die älteste weicht und steht bis dahin nur einzeilig und kleiner
 *   (`.stamp-older`) – zwei lange Meldungen verdecken so mobil nicht die halbe Seite.
 *   Dieselbe Meldung erneut ersetzt die alte.
 * - `role="status"` an der Schicht; Klicks gehen durch (außer auf „×“).
 * - Unter den Banderolen (`below`): Steht eine im Bild, rückt die Schicht darunter. Gerechnet
 *   wird nur beim Zeigen und wenn sich die Banderolen ändern – nie pro Frame.
 *
 * Jede Meldung ist ein eigenes kleines Element (Meldungen kommen selten, nie pro Frame).
 */
import { el, srOnly } from '../dom';
import { keepNumberWithIcon } from '../format';
import { toastDurationFor } from '../settings';
import { stampDuration, stampKind, stampsToDrop, type NotifyOptions } from './stamp-rules';
import './stamps.css';

export type { NotifyOptions } from './stamp-rules';

export interface Stamps {
  readonly element: HTMLElement;
  show(text: string, options?: NotifyOptions): void;
  /** Diese Meldung weg (z. B. Willkommen, sobald der Rückkehr-Bericht offen ist). */
  dismiss(text: string): void;
  /** Alle Meldungen weg (z. B. Spielstand ersetzt). */
  clear(): void;
  /**
   * Oben über dem Bild statt unten über der Seite (nur, wo oben keine Navigation liegt).
   * `animate`: Die Schicht ist zu sehen – kurz überblenden statt springen.
   */
  setTop(top: boolean, animate?: boolean): void;
  /** Unten: so viele px nach oben gerückt (über Bestätigung, „Schließen“ …). */
  setLift(px: number): void;
  /** Gerade oben (bzw. auf dem Weg dorthin)? */
  readonly top: boolean;
  /** Wie viele Meldungen zu sehen sind. */
  readonly count: number;
  /** Rechteck der Schicht ohne Verschiebung (`setLift`); null, wenn nichts zu sehen ist. */
  box(): DOMRect | null;
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
/** Halbe Höhe, um die eine gedrehte Meldung je Breite über- bzw. unterragt (sin 3° / 2, aufgerundet). */
const TILT_SLOPE = 0.03;
/** Seitenwechsel der sichtbaren Schicht: so lange ausblenden, dann am neuen Platz einblenden (CSS). */
const MOVE_MS = 140;

/**
 * Anzeige-Text: Zahl und folgendes Symbol bleiben zusammen („+24 🌰“ bricht nicht vor 🌰 um).
 * Vorgelesen wird derselbe Text (das geschützte Leerzeichen liest sich wie ein normales).
 */
export function stampDisplayText(text: string): string {
  return keepNumberWithIcon(text);
}

export function createStamps(
  toastMs: () => number,
  reducedMotion: () => boolean,
  below?: HTMLElement,
  /** Nach jeder neuen oder verschwundenen Meldung (Lage prüfen, album/index.ts). */
  onChange?: () => void,
): Stamps {
  const layer = el('div', 'stamps');
  layer.id = 'stamps';
  layer.dataset.ref = 'stamps';
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  let serial = 0;
  const shown: Shown[] = [];
  let top = false;
  let lift = 0;
  let moveTimer: ReturnType<typeof setTimeout> | undefined;

  /** Nur die jüngste Meldung steht ganz; ältere einzeilig (CSS .stamp-older). */
  function markOlder(): void {
    shown.forEach((item, i) => item.node.classList.toggle('stamp-older', i < shown.length - 1));
  }

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
    markOlder();
    if (!animate || reducedMotion()) {
      item.node.remove();
      onChange?.();
      return;
    }
    item.node.classList.add('stamp-out');
    setTimeout(() => {
      item.node.remove();
      onChange?.();
    }, OUT_MS);
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
    if (options.keepsake) {
      // Vollständige Chronik: das Andenken als runder Sticker vor dem Text (F4).
      node.classList.add('stamp-keepsake');
      const icon = el('span', 'stamp-keepsake-icon', options.keepsake);
      icon.setAttribute('aria-hidden', 'true');
      node.append(icon);
    }
    const body = el('p', 'stamp-text', stampDisplayText(text));
    // Steht der Rest woanders (Rückkehr-Zettel), hören Screenreader ihn trotzdem mit.
    if (options.spoken) body.append(srOnly(` ${options.spoken}`));
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
    markOlder();
    placeBelow();
    onChange?.();
  }

  function applyTop(): void {
    moveTimer = undefined;
    layer.classList.remove('stamps-moving');
    if (layer.classList.contains('stamps-top') === top) return;
    layer.classList.toggle('stamps-top', top);
    placeBelow();
  }

  return {
    element: layer,
    show,
    dismiss(text) {
      for (const item of [...shown]) if (item.text === text) remove(item, true);
    },
    clear() {
      for (const item of [...shown]) remove(item, false);
    },
    setTop(next, animate = false) {
      if (top === next) return;
      top = next;
      if (!animate || reducedMotion() || shown.length === 0) {
        clearTimeout(moveTimer);
        applyTop();
        return;
      }
      // Ausblenden, am neuen Platz einblenden (läuft schon ein Wechsel, gilt das neue Ziel).
      if (moveTimer === undefined) {
        layer.classList.add('stamps-moving');
        moveTimer = setTimeout(applyTop, MOVE_MS);
      }
    },
    setLift(px) {
      const value = Math.max(0, Math.round(px));
      if (value === lift) return;
      lift = value;
      layer.style.setProperty('--stamps-lift', `${value}px`);
    },
    get top() {
      return top;
    },
    get count() {
      return shown.length;
    },
    box() {
      if (shown.length === 0) return null;
      const rect = layer.getBoundingClientRect();
      // Die Meldungen selbst ohne ihre Animation (Aufstempeln mit scale) – gedreht ragen sie
      // aber ein paar Pixel über die Schicht hinaus (−3° auf 370 px ≈ 10 px).
      let top = Infinity;
      let bottom = -Infinity;
      for (const item of shown) {
        if (item.node.offsetHeight === 0) continue;
        const tilt = Math.ceil(item.node.offsetWidth * TILT_SLOPE);
        top = Math.min(top, item.node.offsetTop - tilt);
        bottom = Math.max(bottom, item.node.offsetTop + item.node.offsetHeight + tilt);
      }
      if (!Number.isFinite(top)) return null;
      // Verschiebung herausrechnen (während des Übergangs gilt der aktuelle Wert).
      const shift = parseFloat(getComputedStyle(layer).translate.split(' ')[1] ?? '0') || 0;
      return new DOMRect(rect.left, rect.top - shift + top, rect.width, bottom - top);
    },
  };
}
