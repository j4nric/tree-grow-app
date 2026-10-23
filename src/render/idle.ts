/**
 * Arbeit in Leerlaufzeit (zwischen den Frames): teure, aber nicht eilige Neuaufbauten der
 * gecachten Ebenen (Jahreszeit-Stufe, Tönung, Detail-Ebenen beim Zoom) laufen nicht mehr im
 * Frame, der sie bemerkt, sondern in Stücken danach – je Leerlauf-Rückruf genau ein Stück.
 * Bis ein Stück fertig ist, zeigt der Renderer den vorigen (vollständigen) Stand.
 *
 * `requestIdleCallback` mit Zeitlimit (damit die Arbeit bei Dauer-Animation nicht verhungert);
 * ohne (Safari) ein `setTimeout`. Der Renderer bekommt die Warteschlange über
 * `SceneInput.idle` – ohne Angabe bleibt alles synchron wie bisher (Tests, Demo).
 *
 * **Safari** kennt `requestIdleCallback` nicht (auch iOS nicht). Ein bloßes `setTimeout(…, 1)`
 * wartet nicht auf Leerlauf: Die Stücke liefen im Abstand von etwa 1 ms, mehrere vor demselben
 * Frame – auf Arten legte der Browser dann mehrere aufgedeckte Blöcke in einem Frame aus
 * (längster Task im Median 155 statt 118 ms, Ausreißer bis 356 ms; Chromium ohne
 * `requestIdleCallback`, 4× Drosselung, docs/ALBUM_UI.md R3). Darum wartet der Ersatz auf den
 * nächsten Frame und läuft gleich danach (`requestAnimationFrame` → `setTimeout(…, 0)`): ein
 * Stück je Frame wie beim Leerlauf-Rückruf. Ohne Frames (Hintergrund-Tab) läuft es spätestens
 * nach `IDLE_TIMEOUT_MS`; ganz ohne `requestAnimationFrame` (Tests) nach 1 ms.
 */

/** Plant einen Rückruf für die nächste Leerlaufzeit. */
export type IdlePost = (run: () => void) => void;

/** Spätestens nach so vielen ms läuft ein Stück auch ohne Leerlauf (requestIdleCallback). */
export const IDLE_TIMEOUT_MS = 250;

/** Standard: requestIdleCallback mit Zeitlimit, sonst nach dem nächsten Frame (Safari), sonst setTimeout. */
export function defaultIdlePost(): IdlePost {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    requestAnimationFrame?: (cb: () => void) => number;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const ric = g.requestIdleCallback.bind(globalThis);
    return (run) => void ric(run, { timeout: IDLE_TIMEOUT_MS });
  }
  if (typeof g.requestAnimationFrame === 'function') return afterFramePost(g.requestAnimationFrame.bind(globalThis));
  return (run) => void setTimeout(run, 1);
}

/**
 * Ersatz ohne requestIdleCallback: Rückruf als eigener Task gleich nach dem nächsten Frame,
 * spätestens nach `IDLE_TIMEOUT_MS` (ohne Frames, z. B. im Hintergrund) – genau einmal.
 * Exportiert für Tests (Frame-Planer austauschbar).
 */
export function afterFramePost(raf: (cb: () => void) => unknown): IdlePost {
  return (run) => {
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      run();
    };
    const fallback = setTimeout(go, IDLE_TIMEOUT_MS);
    raf(() => void setTimeout(go, 0));
  };
}

/**
 * Warteschlange benannter Aufgaben: je Schlüssel höchstens eine (eine neue ersetzt die
 * wartende), abgearbeitet in Reihenfolge des ersten Eintrags, ein Stück je Rückruf.
 */
export class IdleQueue {
  private readonly tasks = new Map<string, () => void>();
  private posted = false;
  private readonly post: IdlePost;

  constructor(post: IdlePost = defaultIdlePost()) {
    this.post = post;
  }

  /** Aufgabe `key` einplanen bzw. die wartende ersetzen. */
  schedule(key: string, task: () => void): void {
    this.tasks.set(key, task);
    this.ensurePosted();
  }

  has(key: string): boolean {
    return this.tasks.has(key);
  }

  cancel(key: string): void {
    this.tasks.delete(key);
  }

  get size(): number {
    return this.tasks.size;
  }

  /** Führt die älteste Aufgabe aus; false, wenn keine wartet. */
  runNext(): boolean {
    const first = this.tasks.entries().next();
    if (first.done) return false;
    const [key, task] = first.value;
    this.tasks.delete(key);
    task();
    return true;
  }

  /** Arbeitet alles ab (auch während dessen eingeplante Folge-Stücke) – für Tests. */
  flush(limit = 1000): number {
    let n = 0;
    while (n < limit && this.runNext()) n++;
    return n;
  }

  private ensurePosted(): void {
    if (this.posted) return;
    this.posted = true;
    this.post(() => {
      this.posted = false;
      try {
        this.runNext();
      } finally {
        if (this.tasks.size > 0) this.ensurePosted();
      }
    });
  }
}

/** 1×1-Hilfsfläche, über die frisch gezeichnete Ebenen vorab gerastert werden. */
let warmTarget: CanvasRenderingContext2D | null | undefined;

/**
 * Erzwingt das Rastern einer gerade gezeichneten Ebene jetzt (in Leerlaufzeit) statt beim
 * ersten Zusammensetzen im Frame: Chromium zeichnet in Canvas aufgezeichnete Befehle erst,
 * wenn das Bild gebraucht wird. Eine 1-Pixel-Kopie braucht das ganze Bild.
 */
export function warmCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (!c || c.width <= 0 || c.height <= 0) return;
  if (warmTarget === undefined) {
    const t = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (t) {
      t.width = 1;
      t.height = 1;
    }
    warmTarget = t ? t.getContext('2d') : null;
  }
  if (!warmTarget) return;
  warmTarget.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
}
