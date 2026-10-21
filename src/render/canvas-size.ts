/**
 * Verfolgt die Größe des Szenen-Canvas per ResizeObserver statt jeden Frame per
 * `getBoundingClientRect()` – das erzwang nach DOM-Änderungen der Seitenleiste im selben
 * Frame ein Layout. Die Messung wird im nächsten requestAnimationFrame übernommen und
 * entprellt (`CanvasSizeDebouncer`, ~100 ms); erst dann wird der Backing-Store neu belegt.
 * Die Größe kommt damit schon entprellt bei `drawScene` an – der Game Loop setzt deshalb
 * `SceneInput.sizeSettled`, damit sich keine zweite Wartezeit (`ResizeGate`) addiert.
 *
 * Wo der Browser es kann (Chromium, Firefox), liefert der Observer mit
 * `devicePixelContentBoxSize` die exakten Gerätepixel – auch bei gebrochener Pixeldichte
 * pixelgenau, und er meldet sich auch, wenn sich nur die Pixeldichte ändert (Zoom,
 * anderer Bildschirm). Sonst – oder wenn die Werte nicht zu `devicePixelRatio` passen
 * (emulierte Pixeldichte) –: `contentRect` × `devicePixelRatio`.
 * Ohne ResizeObserver (alte Browser): Messung je Frame wie bisher.
 */

import { CanvasSizeDebouncer, type CanvasSize, type DevicePixels } from './resize';

export class CanvasSizer {
  private cssWidth = 0;
  private cssHeight = 0;
  /** Exakte Gerätepixel aus dem Observer (null = nicht verfügbar). */
  private device: DevicePixels | null = null;
  private observer: ResizeObserver | null;
  private readonly debouncer = new CanvasSizeDebouncer();

  constructor(private readonly canvas: HTMLCanvasElement) {
    // Startgröße einmal synchron messen, damit schon der erste Frame zeichnet.
    this.measure();
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        // Canvas ohne Rand/Innenabstand: content box = getBoundingClientRect (ohne Transform).
        this.cssWidth = entry.contentRect.width;
        this.cssHeight = entry.contentRect.height;
        const box = entry.devicePixelContentBoxSize?.[0];
        this.device = box ? { pw: box.inlineSize, ph: box.blockSize } : null;
      });
      try {
        this.observer.observe(canvas, { box: 'device-pixel-content-box' });
      } catch {
        // Safari kennt die Box nicht (TypeError): Rückfall auf contentRect.
        this.observer.observe(canvas);
      }
    } else {
      this.observer = null;
    }
  }

  /**
   * Größe für diesen Frame (CSS- und Gerätepixel); passt den Backing-Store an, wenn die
   * entprellte Größe sich geändert hat. `now` in ms (requestAnimationFrame-Zeit).
   */
  update(now: number): CanvasSize {
    if (!this.observer) this.measure();
    const size = this.debouncer.update(this.cssWidth, this.cssHeight, window.devicePixelRatio || 1, now, this.device);
    if (this.canvas.width !== size.pw || this.canvas.height !== size.ph) {
      this.canvas.width = size.pw;
      this.canvas.height = size.ph;
    }
    return size;
  }

  /** Beendet die Beobachtung (z. B. wenn das Canvas entfernt wird); danach wird je Frame gemessen. */
  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.device = null;
  }

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
  }
}
