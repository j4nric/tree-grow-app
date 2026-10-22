/**
 * Lage des Hinweis-Toasts im einspaltigen Layout (≤ 760 px, Playtest Phase 6): Er steht
 * oben fest – aber nie über dem, was dort gerade liegt: Update-Hinweis (oben fest),
 * Begegnungs-Stapel (oben rechts in der Szene, solange er nicht schwebt) und Stufen-Banner
 * (oben in der Szene, solange es zu sehen ist). Am Desktop liegt der Toast unten in der
 * Szene (CSS) – dort gibt es nichts auszuweichen.
 *
 * `update()` darf jeden Frame laufen: Es misst nur bei sichtbarem Toast und schreibt die
 * CSS-Variable `--toast-top` nur bei neuem Wert (das CSS nimmt das Maximum mit dem Rand).
 */

/** Abstand zwischen Toast und dem, dem er ausweicht. */
export const TOAST_GAP = 8;

/** Senkrechte Lage eines Elements im Bildschirm (getBoundingClientRect). */
export interface Band {
  top: number;
  bottom: number;
}

/**
 * Oberkante des Toasts: unter allen Hindernissen in der oberen Bildschirmhälfte
 * (`limit` = halbe Höhe); was aus dem Bild gescrollt ist oder tiefer liegt, zählt nicht.
 * 0 = kein Hindernis (dann gilt der Rand aus dem CSS).
 */
export function toastTopFor(obstacles: readonly Band[], limit: number): number {
  let top = 0;
  for (const o of obstacles) {
    if (o.bottom <= 0 || o.top >= limit || o.bottom <= o.top) continue;
    top = Math.max(top, Math.ceil(o.bottom + TOAST_GAP));
  }
  return top;
}

/** Was oben liegen kann – nur, solange es zu sehen ist. */
const OBSTACLES = [
  '.update-hint:not([hidden])',
  '.scene-dock:not(.floating) .encounter-stack:not([hidden])',
  '.stage-banner.visible',
].join(', ');

export interface ToastPlacement {
  update(): void;
}

export function createToastPlacement(toast: HTMLElement, single = matchMedia('(max-width: 760px)')): ToastPlacement {
  let shown = '';
  const set = (value: string) => {
    if (value === shown) return;
    shown = value;
    if (value) toast.style.setProperty('--toast-top', value);
    else toast.style.removeProperty('--toast-top');
  };
  return {
    update() {
      if (toast.hidden || !single.matches) return set('');
      const bands = [...document.querySelectorAll<HTMLElement>(OBSTACLES)].map((el) => el.getBoundingClientRect());
      const top = toastTopFor(bands, window.innerHeight / 2);
      set(top > 0 ? `${top}px` : '');
    },
  };
}
