/**
 * Umblättern (docs/ALBUM_UI.md, C.3): eine leichte 3D-Drehung um die linke Kante der Seite.
 *
 * - Vorwärts: Die neue Seite liegt schon **unter** der aktuellen. Die aktuelle Seite dreht
 *   sich `rotateY(0 → --turn-angle)` weg, ihr Schatten wächst auf `--sh-turn`; danach wird
 *   sie verborgen (`turned-away`) und zurückgesetzt.
 * - Zurück: genau umgekehrt – die verlassene Seite dreht sich über die Unterseite zurück.
 * - Reduzierte Bewegung: Überblenden in `--fade-ms`, ohne 3D.
 * - Während des Blätterns sind beide Seiten `inert`. Nur ein Element animiert, `will-change`
 *   nur für die Dauer der Animation.
 *
 * Die Werte kommen aus tokens.css (eine Quelle), mit den Prototyp-Werten als Ersatz.
 */

export interface PageTurn {
  /** `front` dreht sich weg und gibt `under` frei. */
  forward(front: HTMLElement, under: HTMLElement): Promise<void>;
  /** `front` (verborgen) dreht sich zurück über `under`; danach wird `under` verborgen. */
  back(front: HTMLElement, under: HTMLElement): Promise<void>;
  /** Läuft gerade eine Drehung? */
  readonly busy: boolean;
}

export interface PageTurnOptions {
  reducedMotion(): boolean;
}

/** Klasse an der weggedrehten Seite: unsichtbar, aber mit Layout (Scroll-Lage bleibt). */
export const TURNED_AWAY = 'turned-away';
/** Klasse während der Drehung (hebt die Seite über die Unterseite). */
export const TURNING = 'turning';

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function ms(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.endsWith('ms') ? n : value.endsWith('s') ? n * 1000 : n;
}

/** Ab wann eine Drehung als erledigt gilt, auch wenn `finished` ausbleibt (Hintergrund-Tab). */
const SAFETY_MS = 200;

export function createPageTurn(options: PageTurnOptions): PageTurn {
  let busy = false;

  /**
   * Senkrechte Drehachse: mitten im sichtbaren Teil der Seite. Bei einer langen, mit dem
   * Fenster gescrollten Seite (mobil) läge die Mitte sonst weit außerhalb des Bildes.
   */
  function origin(front: HTMLElement): string {
    const rect = front.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const middle = (visibleTop + visibleBottom) / 2 - rect.top;
    return `0 ${Math.round(Number.isFinite(middle) ? middle : rect.height / 2)}px`;
  }

  async function run(front: HTMLElement, under: HTMLElement, direction: 'forward' | 'back'): Promise<void> {
    busy = true;
    front.inert = true;
    under.inert = true;
    under.hidden = false;
    under.classList.remove(TURNED_AWAY);
    // Vorwärts: erst sichtbar machen, dann wegdrehen; zurück: sichtbar, dann zurückdrehen.
    front.classList.remove(TURNED_AWAY);
    front.classList.add(TURNING);
    const reduced = options.reducedMotion();
    const perspective = token('--turn-perspective', '1400px');
    const angle = token('--turn-angle', '-104deg');
    const shadow = token('--sh-turn', '30px 0 40px rgba(59,58,54,.35)');
    const duration = reduced ? ms(token('--fade-ms', '150ms'), 150) : ms(token('--turn-ms', '380ms'), 380);
    const easing = reduced ? 'ease' : token('--turn-ease', 'cubic-bezier(.3,.7,.3,1)');
    const flat: Keyframe = reduced
      ? { opacity: 1 }
      : { transform: `perspective(${perspective}) rotateY(0deg)`, boxShadow: '0 0 0 rgba(59,58,54,0)' };
    const turned: Keyframe = reduced
      ? { opacity: 0 }
      : { transform: `perspective(${perspective}) rotateY(${angle})`, boxShadow: shadow };
    const frames = direction === 'forward' ? [flat, turned] : [turned, flat];
    if (!reduced) {
      front.style.transformOrigin = origin(front);
      front.style.backfaceVisibility = 'hidden';
    }
    front.style.willChange = reduced ? 'opacity' : 'transform';
    try {
      if (typeof front.animate === 'function') {
        const animation = front.animate(frames, { duration, easing, fill: 'forwards' });
        await Promise.race([
          animation.finished.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, duration + SAFETY_MS)),
        ]);
        animation.cancel();
      }
    } finally {
      front.style.willChange = '';
      front.style.transformOrigin = '';
      front.style.backfaceVisibility = '';
      front.classList.remove(TURNING);
      if (direction === 'forward') {
        front.classList.add(TURNED_AWAY);
        under.inert = false;
      } else {
        under.hidden = true;
        front.inert = false;
        under.inert = false;
      }
      busy = false;
    }
  }

  return {
    forward: (front, under) => run(front, under, 'forward'),
    back: (front, under) => run(front, under, 'back'),
    get busy() {
      return busy;
    },
  };
}
