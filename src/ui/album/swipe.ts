/**
 * Wisch-Zurück (docs/ALBUM_UI.md, C.2): Auf einer Unterseite gilt ein waagerechter Wisch nach
 * rechts als „Zurück“ – derselbe Weg wie Lesezeichen und Escape (über den Verlauf).
 *
 * Oben die reine Erkennung (ohne DOM, Vitest), unten eine dünne DOM-Schicht mit Pointer
 * Events. Die Schicht liest Layout nur während einer laufenden Geste (über `follow()`).
 *
 * Regeln:
 * - Auslösen: nach rechts, waagerecht mindestens doppelt so weit wie senkrecht und entweder
 *   mindestens 60 px weit oder (ab 20 px) schneller als 0,5 px/ms.
 * - Richtung entscheidet sich nach 10 px: senkrecht oder nach links → die Geste ist für den
 *   Rest des Kontakts aus (Scrollen bleibt Scrollen).
 * - Nie aus `[data-no-swipe]`, Eingabefeldern, Canvas oder aus den linken 20 px des Bildschirms
 *   (dort gehört die Geste dem Browser, z. B. iOS-Rand-Wischen). Nur Finger und Stift, keine Maus.
 * - Ein zweiter Finger oder `pointercancel` (Browser übernimmt) bricht ab.
 */

/** Mindestweite eines Wischs (px). */
export const SWIPE_MIN_PX = 60;
/** Waagerecht mindestens so viel mal weiter als senkrecht. */
export const SWIPE_RATIO = 2;
/** Ab diesem Tempo (px/ms) reicht ein kurzer Wisch. */
export const SWIPE_MIN_VELOCITY = 0.5;
/** Auch ein schneller Wisch braucht so viel Weg (px) – sonst löst ein Zucken aus. */
export const SWIPE_FLICK_MIN_PX = 20;
/** Nach so viel Weg (px) steht die Richtung fest. */
export const SWIPE_SLOP_PX = 10;
/** Linker Bildschirmrand (px), der dem Browser gehört (iOS-Rand-Wischen). */
export const SWIPE_EDGE_PX = 20;
/** Zeitfenster (ms) für das Tempo am Ende. */
export const SWIPE_VELOCITY_WINDOW_MS = 100;
/** Weiter als bis zu diesem Winkel folgt die Seite dem Finger nicht (Grad). */
export const SWIPE_FOLLOW_MAX_DEG = -20;

export type SwipePhase = 'pending' | 'tracking' | 'rejected';

export interface SwipeSample {
  x: number;
  y: number;
  t: number;
}

export interface SwipeState {
  readonly start: SwipeSample;
  readonly phase: SwipePhase;
  /** Letzte Punkte (für das Tempo), höchstens aus dem Zeitfenster. */
  readonly samples: readonly SwipeSample[];
}

/** Darf an dieser Stelle (x in px vom linken Rand) eine Geste beginnen? */
export function swipeStartAllowed(x: number): boolean {
  return x > SWIPE_EDGE_PX;
}

export function startSwipe(x: number, y: number, t: number): SwipeState {
  const start = { x, y, t };
  return { start, phase: 'pending', samples: [start] };
}

/** Ist (dx, dy) waagerecht genug und nach rechts? */
function horizontal(dx: number, dy: number): boolean {
  return dx > 0 && dx >= SWIPE_RATIO * Math.abs(dy);
}

export function moveSwipe(state: SwipeState, x: number, y: number, t: number): SwipeState {
  if (state.phase === 'rejected') return state;
  const sample = { x, y, t };
  const samples = [...state.samples.filter((s) => t - s.t <= SWIPE_VELOCITY_WINDOW_MS), sample];
  let phase: SwipePhase = state.phase;
  if (phase === 'pending') {
    const dx = x - state.start.x;
    const dy = y - state.start.y;
    if (Math.hypot(dx, dy) >= SWIPE_SLOP_PX) phase = horizontal(dx, dy) ? 'tracking' : 'rejected';
  }
  return { start: state.start, phase, samples };
}

/** Waagerechtes Tempo (px/ms, nach rechts positiv) über das letzte Zeitfenster. */
export function swipeVelocity(state: SwipeState): number {
  const last = state.samples[state.samples.length - 1]!;
  const first = state.samples.find((s) => last.t - s.t <= SWIPE_VELOCITY_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

/** Weg seit dem Aufsetzen. */
export function swipeDelta(state: SwipeState): { dx: number; dy: number } {
  const last = state.samples[state.samples.length - 1]!;
  return { dx: last.x - state.start.x, dy: last.y - state.start.y };
}

/** Loslassen bei (x, y, t): Zählt die Geste als „Zurück“? */
export function endSwipe(state: SwipeState, x: number, y: number, t: number): boolean {
  const done = moveSwipe(state, x, y, t);
  if (done.phase !== 'tracking') return false;
  const { dx, dy } = swipeDelta(done);
  if (!horizontal(dx, dy)) return false;
  if (dx >= SWIPE_MIN_PX) return true;
  return dx >= SWIPE_FLICK_MIN_PX && swipeVelocity(done) > SWIPE_MIN_VELOCITY;
}

/**
 * Winkel der zurückkommenden Seite (Grad), wenn der Finger `dx` px gewischt hat: Ihre rechte
 * Kante liegt unter dem Finger, höchstens bis −20°. Bei 0 px steht sie hochkant (−90°,
 * unsichtbar). `perspective` (px) ist der Abstand der Betrachtung wie in `perspective()`: Die
 * zum Betrachter gedrehte Kante erscheint weiter rechts, darum wird nach der Projektion gesucht.
 */
export function followAngle(dx: number, width: number, perspective = Number.POSITIVE_INFINITY): number {
  if (!(width > 0) || dx <= 0) return -90;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  /** Wo die rechte Kante bei `deg` auf dem Bildschirm liegt (px ab der Drehachse). */
  const edge = (deg: number) => {
    const x = width * Math.cos(rad(deg));
    const z = -width * Math.sin(rad(deg));
    return Number.isFinite(perspective) ? (x * perspective) / Math.max(perspective - z, 1) : x;
  };
  if (edge(SWIPE_FOLLOW_MAX_DEG) <= dx) return SWIPE_FOLLOW_MAX_DEG;
  // Halbieren zwischen −90° (Kante an der Achse) und −20°.
  let low = -90;
  let high = SWIPE_FOLLOW_MAX_DEG;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (edge(mid) < dx) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// --- DOM-Schicht ------------------------------------------------------------------------

/** Die Seite, die dem Finger folgt (page-turn.ts `drag`). */
export interface SwipeFollow {
  /** Breite der drehenden Seite (px), einmal zu Beginn gemessen. */
  readonly width: number;
  /** Abstand der Betrachtung (px, `--turn-perspective`). */
  readonly perspective: number;
  /** Drehwinkel setzen (Grad). */
  set(angle: number): void;
  /** Loslassen: `true` = gleich blättert die Seite zu Ende, sonst schnappt sie zurück. */
  release(commit: boolean): void;
}

export interface SwipeBackOptions {
  /** Darf eine Geste auf diesem Element beginnen (Unterseite offen, nichts animiert …)? */
  canStart(target: Element): boolean;
  /** Seite zum Mitführen, sobald die Richtung feststeht; `null` = ohne (reduzierte Bewegung). */
  follow(): SwipeFollow | null;
  /** Eine Ebene zurück (über den Verlauf). */
  back(): void;
}

/** Hier beginnt nie eine Wisch-Zurück-Geste. */
const EXCLUDED = '[data-no-swipe], input, textarea, select, canvas, [contenteditable=""], [contenteditable="true"]';

/** Wisch-Zurück an `root` anbringen; gibt eine Abmelde-Funktion zurück. */
export function attachSwipeBack(root: HTMLElement, options: SwipeBackOptions): () => void {
  let active: { id: number; state: SwipeState; follow: SwipeFollow | null; followed: boolean } | null = null;
  const passive = { passive: true } as const;

  function stop(commit: boolean): void {
    const gesture = active;
    if (!gesture) return;
    active = null;
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    gesture.follow?.release(commit);
    if (commit) options.back();
  }

  function onDown(event: PointerEvent): void {
    if (active) {
      // Zweiter Finger: Das ist kein Wisch mehr.
      stop(false);
      return;
    }
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(EXCLUDED)) return;
    if (!swipeStartAllowed(event.clientX) || !options.canStart(target)) return;
    active = { id: event.pointerId, state: startSwipe(event.clientX, event.clientY, event.timeStamp), follow: null, followed: false };
    root.addEventListener('pointermove', onMove, passive);
    root.addEventListener('pointerup', onUp, passive);
    root.addEventListener('pointercancel', onCancel, passive);
  }

  function onMove(event: PointerEvent): void {
    if (!active || event.pointerId !== active.id) return;
    const state = moveSwipe(active.state, event.clientX, event.clientY, event.timeStamp);
    active.state = state;
    if (state.phase === 'rejected') {
      stop(false);
      return;
    }
    if (state.phase !== 'tracking') return;
    if (!active.followed) {
      active.followed = true;
      active.follow = options.follow();
    }
    active.follow?.set(followAngle(swipeDelta(state).dx, active.follow.width, active.follow.perspective));
  }

  function onUp(event: PointerEvent): void {
    if (!active || event.pointerId !== active.id) return;
    stop(endSwipe(active.state, event.clientX, event.clientY, event.timeStamp));
  }

  function onCancel(event: PointerEvent): void {
    if (active && event.pointerId === active.id) stop(false);
  }

  root.addEventListener('pointerdown', onDown, passive);
  return () => {
    stop(false);
    root.removeEventListener('pointerdown', onDown);
  };
}
