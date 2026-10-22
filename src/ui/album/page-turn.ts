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
  /**
   * Wisch-Zurück (swipe.ts): `front` (weggedreht) folgt dem Finger. Gibt `null` zurück, wenn
   * gerade eine Drehung läuft. Nach `release(true)` beginnt das folgende `back(front, …)` beim
   * gezogenen Winkel; kommt es nicht (Verlauf meldet sich nicht), schnappt die Seite zurück.
   */
  drag(front: HTMLElement): TurnDrag | null;
  /** Läuft gerade eine Drehung? */
  readonly busy: boolean;
}

export interface TurnDrag {
  /** Breite der drehenden Seite (px), zu Beginn gemessen. */
  readonly width: number;
  /** Abstand der Betrachtung (px) aus `--turn-perspective`. */
  readonly perspective: number;
  /** Drehwinkel setzen (Grad, zwischen `--turn-angle` und 0). */
  set(angle: number): void;
  /** Loslassen: `true` = `back()` folgt gleich, sonst zurückschnappen. */
  release(commit: boolean): void;
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
/** Losgelassene Seite (Wisch erkannt): so lange wartet sie auf `back()`, dann schnappt sie zurück. */
export const HELD_MS = 1200;
/** Dauer des Zurückschnappens (ms) über die volle Drehung; anteilig weniger. */
const SNAP_MS = 220;

export function createPageTurn(options: PageTurnOptions): PageTurn {
  let busy = false;
  /**
   * Zählt die Drehungen. Beginnt eine neue, während die alte noch läuft, wird die alte
   * abgebrochen und ihr Abschluss bleibt wirkungslos (sonst setzte er `turned-away` an
   * eine Seite, die die neue Drehung gerade zeigt).
   */
  let generation = 0;
  /** Abbruch der laufenden Drehung (Animation stoppen, Elemente aufräumen). */
  let abortCurrent: (() => void) | null = null;
  /** Nach einem Wisch losgelassene Seite und ihr Winkel: `back()` macht dort weiter. */
  let held: { front: HTMLElement; angle: number } | null = null;

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

  /** Inline-Stile und Drehklasse entfernen (Ende oder Abbruch einer Drehung). */
  function clean(front: HTMLElement): void {
    front.style.willChange = '';
    front.style.transformOrigin = '';
    front.style.backfaceVisibility = '';
    front.style.transform = '';
    front.classList.remove(TURNING);
  }

  /** Gezogene Seite wieder hinlegen (weggedreht, wie vor dem Wisch). */
  function restore(front: HTMLElement): void {
    clean(front);
    front.classList.add(TURNED_AWAY);
  }

  /**
   * Wirksamer Abstand der Betrachtung: Hat der Behälter selbst `perspective` (Doppelseite:
   * `.book`), wirken beide Projektionen nacheinander – wie eine mit 1/(1/P₁ + 1/P₂).
   */
  function viewDistance(front: HTMLElement, own: number): number {
    let parent = front.parentElement;
    while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
    const outer = parent ? Number.parseFloat(getComputedStyle(parent).perspective) : Number.NaN;
    return Number.isFinite(outer) && outer > 0 ? 1 / (1 / own + 1 / outer) : own;
  }

  function drag(front: HTMLElement): TurnDrag | null {
    if (busy) return null;
    abortCurrent?.();
    const mine = ++generation;
    const perspective = token('--turn-perspective', '1400px');
    const away = Number.parseFloat(token('--turn-angle', '-104deg')) || -104;
    // Erst hinlegen, dann messen: Eine weggedrehte Unterseite hat keine Höhe (album.css).
    front.classList.remove(TURNED_AWAY);
    front.classList.add(TURNING);
    const width = front.getBoundingClientRect().width;
    front.style.transformOrigin = origin(front);
    front.style.backfaceVisibility = 'hidden';
    front.style.willChange = 'transform';
    const apply = (angle: number) => (front.style.transform = `perspective(${perspective}) rotateY(${angle}deg)`);
    let current = away;
    apply(current);
    abortCurrent = () => {
      abortCurrent = null;
      held = null;
      restore(front);
    };

    function snapBack(): void {
      const frames = [{ transform: front.style.transform }, { transform: `perspective(${perspective}) rotateY(${away}deg)` }];
      const duration = SNAP_MS * Math.max(0.3, 1 - current / away);
      front.style.transform = '';
      const animation = typeof front.animate === 'function' ? front.animate(frames, { duration, easing: 'ease-out', fill: 'forwards' }) : null;
      const done = () => {
        if (mine !== generation || abortCurrent !== stop) return;
        abortCurrent = null;
        animation?.cancel();
        restore(front);
      };
      const stop = () => {
        abortCurrent = null;
        animation?.cancel();
        restore(front);
      };
      abortCurrent = stop;
      if (animation) void animation.finished.then(done, done);
      setTimeout(done, duration + SAFETY_MS);
    }

    return {
      width,
      perspective: viewDistance(front, Number.parseFloat(perspective) || 1400),
      set(angle) {
        if (mine !== generation || held) return;
        current = Math.min(0, Math.max(away, angle));
        apply(current);
      },
      release(commit) {
        if (mine !== generation || held) return;
        if (!commit) {
          snapBack();
          return;
        }
        held = { front, angle: current };
        setTimeout(() => {
          if (mine === generation && held?.front === front) {
            held = null;
            snapBack();
          }
        }, HELD_MS);
      },
    };
  }

  async function run(front: HTMLElement, under: HTMLElement, direction: 'forward' | 'back'): Promise<void> {
    // Nach einem Wisch: von dort weiterblättern, wo der Finger die Seite gelassen hat.
    const from = direction === 'back' && held?.front === front ? held.angle : null;
    held = null;
    abortCurrent?.();
    const mine = ++generation;
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
    let runDuration = duration;
    if (from !== null && !reduced) {
      // Rest der Drehung, anteilig kürzer.
      const away = Number.parseFloat(angle) || -104;
      frames[0] = { transform: `perspective(${perspective}) rotateY(${from}deg)`, boxShadow: shadow };
      runDuration = duration * Math.max(0.35, from / away);
    }
    if (!reduced) {
      front.style.transformOrigin = origin(front);
      front.style.backfaceVisibility = 'hidden';
    }
    front.style.willChange = reduced ? 'opacity' : 'transform';
    let animation: Animation | null = null;
    let wake: () => void = () => undefined;
    abortCurrent = () => {
      abortCurrent = null;
      animation?.cancel();
      clean(front);
      front.inert = false;
      under.inert = false;
      wake();
    };
    try {
      if (typeof front.animate === 'function') {
        animation = front.animate(frames, { duration: runDuration, easing, fill: 'forwards' });
        await Promise.race([
          animation.finished.catch(() => undefined),
          new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, runDuration + SAFETY_MS);
          }),
        ]);
        animation.cancel();
      }
    } finally {
      // Abgebrochen: Die neue Drehung bestimmt den Zustand.
      if (mine === generation) finish();
    }

    function finish(): void {
      abortCurrent = null;
      clean(front);
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
    drag,
    get busy() {
      return busy;
    },
  };
}
