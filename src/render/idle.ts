/**
 * Arbeit in Leerlaufzeit (zwischen den Frames): teure, aber nicht eilige Neuaufbauten der
 * gecachten Ebenen (Jahreszeit-Stufe, Tönung, Detail-Ebenen beim Zoom) laufen nicht mehr im
 * Frame, der sie bemerkt, sondern in Stücken danach – je Leerlauf-Rückruf genau ein Stück.
 * Bis ein Stück fertig ist, zeigt der Renderer den vorigen (vollständigen) Stand.
 *
 * `requestIdleCallback` mit Zeitlimit (damit die Arbeit bei Dauer-Animation nicht verhungert);
 * ohne (Safari) ein `setTimeout`. Der Renderer bekommt die Warteschlange über
 * `SceneInput.idle` – ohne Angabe bleibt alles synchron wie bisher (Tests, Demo).
 */

/** Plant einen Rückruf für die nächste Leerlaufzeit. */
export type IdlePost = (run: () => void) => void;

/** Spätestens nach so vielen ms läuft ein Stück auch ohne Leerlauf (requestIdleCallback). */
export const IDLE_TIMEOUT_MS = 250;

/** Standard: requestIdleCallback mit Zeitlimit, sonst setTimeout. */
export function defaultIdlePost(): IdlePost {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof g.requestIdleCallback === 'function') {
    const ric = g.requestIdleCallback.bind(globalThis);
    return (run) => void ric(run, { timeout: IDLE_TIMEOUT_MS });
  }
  return (run) => void setTimeout(run, 1);
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
