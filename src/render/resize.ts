/**
 * Entprellt Größenänderungen des Canvas: Eine neue Größe wird erst übernommen, wenn sie
 * eine Weile stabil ist – gemessen in Zeit UND in Frames. Die Frame-Zählung sorgt dafür,
 * dass die neue Größe auch bei stehender oder ungültiger Zeit (Pause, feste Demo-Zeit,
 * NaN) übernommen wird. Rein, ohne DOM – testbar.
 */

/** So lange (s) muss eine neue Größe stabil sein … */
export const RESIZE_SETTLE_SECONDS = 0.15;
/** … oder so viele Frames hintereinander gleich bleiben (≈ 150 ms bei 60 FPS). */
export const RESIZE_SETTLE_FRAMES = 9;

export class ResizeGate {
  private pendingKey = '';
  private since = 0;
  private frames = 0;

  /**
   * Meldet die aktuelle Größe (`key`) und ob die Szene jetzt neu aufgebaut werden soll.
   * `builtKey` ist die Größe des vorhandenen Caches (null = noch keiner → sofort bauen).
   */
  shouldRebuild(key: string, builtKey: string | null, time: number): boolean {
    if (builtKey === key) {
      this.pendingKey = '';
      return false;
    }
    if (builtKey === null || !Number.isFinite(time)) return this.done();
    if (this.pendingKey !== key) {
      this.pendingKey = key;
      this.since = time;
      this.frames = 0;
    }
    this.frames++;
    const waited = time - this.since;
    if (waited >= RESIZE_SETTLE_SECONDS || waited < 0 || this.frames > RESIZE_SETTLE_FRAMES) return this.done();
    return false;
  }

  private done(): boolean {
    this.pendingKey = '';
    this.frames = 0;
    return true;
  }
}

// --- Cache-Schlüssel ---------------------------------------------------------------------

/**
 * Schlüssel der Größen-Caches (Kulisse, Ebenen, Wolken): Gerätepixel UND CSS-Größe. So
 * führt auch eine geänderte Pixeldichte bei gleicher CSS-Größe (Zoom, anderer Bildschirm)
 * zu neuen Ebenen.
 */
export function sizeKey(pw: number, ph: number, width: number, height: number): string {
  return `${pw}x${ph}/${width}x${height}`;
}

/**
 * Jahreszeit-Stufe der Kulisse (Himmel, Hügel, Grasnarbe): der auf 0,05 gerundete Wert aus
 * `seasonLook`, −1 für Sommer bzw. ohne Angabe. Kulisse und Ebenen werden nur neu
 * gezeichnet, wenn sich dieser Wert ändert.
 */
export function seasonStepKey(look: { s: number; summer: boolean } | null): number {
  return look && !look.summer ? look.s : -1;
}

// --- Canvas-Größe (main.ts) --------------------------------------------------------------

/** So lange (ms) muss eine neue Canvas-Größe stabil sein, bevor der Backing-Store folgt … */
export const CANVAS_SETTLE_MS = 100;
/** … oder so viele Frames hintereinander gleich bleiben (falls die Zeit steht). */
export const CANVAS_SETTLE_FRAMES = 6;

/** Größe des Canvas in CSS-Pixeln und Gerätepixeln (Backing-Store). */
export interface CanvasSize {
  width: number;
  height: number;
  pw: number;
  ph: number;
  key: string;
}

/** CSS-Größe und Pixeldichte → Backing-Store (wie bisher: gerundete Gerätepixel). */
export function canvasSize(cssWidth: number, cssHeight: number, dpr: number): CanvasSize {
  const width = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0;
  const height = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 0;
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const pw = Math.round(width * d);
  const ph = Math.round(height * d);
  return { width, height, pw, ph, key: sizeKey(pw, ph, width, height) };
}

/**
 * Entprellt die Canvas-Größe für den Game Loop: Während die Größe sich ändert (Fenster
 * ziehen, Drehen, Zoom), bleibt der alte Backing-Store bestehen und die Szene wird in der
 * alten Größe gezeichnet – der Browser streckt sie per CSS. Erst wenn die Größe ~100 ms
 * stabil ist, wird sie übernommen. So wird der Speicher nicht in jedem Frame neu belegt
 * und die Szene nicht in jedem Frame skaliert gezeichnet. Rein, ohne DOM – testbar.
 */
export class CanvasSizeDebouncer {
  /** Übernommene Größe (null = noch keine). */
  applied: CanvasSize | null = null;
  private pendingKey = '';
  private since = 0;
  private frames = 0;

  /** Meldet die gemessene Größe; gibt die zu verwendende Größe zurück. `now` in ms. */
  update(cssWidth: number, cssHeight: number, dpr: number, now: number): CanvasSize {
    const target = canvasSize(cssWidth, cssHeight, dpr);
    const applied = this.applied;
    // Erste Messung oder bisher leeres Canvas: sofort übernehmen (nichts zu strecken).
    if (!applied || applied.pw === 0 || applied.ph === 0) return this.apply(target);
    if (applied.key === target.key) {
      this.pendingKey = '';
      return applied;
    }
    if (!Number.isFinite(now)) return this.apply(target);
    if (this.pendingKey !== target.key) {
      this.pendingKey = target.key;
      this.since = now;
      this.frames = 0;
    }
    this.frames++;
    const waited = now - this.since;
    if (waited >= CANVAS_SETTLE_MS || waited < 0 || this.frames > CANVAS_SETTLE_FRAMES) return this.apply(target);
    return applied;
  }

  private apply(size: CanvasSize): CanvasSize {
    this.applied = size;
    this.pendingKey = '';
    this.frames = 0;
    return size;
  }
}
