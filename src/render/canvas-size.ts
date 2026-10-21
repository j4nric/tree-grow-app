/**
 * Verfolgt die Größe des Szenen-Canvas per ResizeObserver statt jeden Frame per
 * `getBoundingClientRect()` – das erzwang nach DOM-Änderungen der Seitenleiste im selben
 * Frame ein Layout. Die Messung wird im nächsten requestAnimationFrame übernommen und
 * entprellt (`CanvasSizeDebouncer`); erst dann wird der Backing-Store neu belegt.
 * Ohne ResizeObserver (alte Browser): Messung je Frame wie bisher.
 */

import { CanvasSizeDebouncer, type CanvasSize } from './resize';

export class CanvasSizer {
  private cssWidth = 0;
  private cssHeight = 0;
  private readonly observer: ResizeObserver | null;
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
      });
      this.observer.observe(canvas);
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
    const size = this.debouncer.update(this.cssWidth, this.cssHeight, window.devicePixelRatio || 1, now);
    if (this.canvas.width !== size.pw || this.canvas.height !== size.ph) {
      this.canvas.width = size.pw;
      this.canvas.height = size.ph;
    }
    return size;
  }

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
  }
}
