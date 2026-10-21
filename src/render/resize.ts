/**
 * Entprellt Größenänderungen des Canvas: Eine neue Größe wird erst übernommen, wenn sie
 * eine Weile stabil ist. Entscheidend ist die Zeit; nur solange sie seit der Änderung
 * steht (Pause, feste Demo-Zeit), zählen stattdessen Frames – so greift die Frame-Regel
 * nicht schon nach wenigen Millisekunden bei 144/240 Hz. Ungültige Zeit (NaN) übernimmt
 * sofort. Rein, ohne DOM – testbar.
 */

/** So lange (s) muss eine neue Größe stabil sein … */
export const RESIZE_SETTLE_SECONDS = 0.15;
/** … oder, solange die Zeit steht, so viele Frames hintereinander gleich bleiben. */
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
    return settled(time - this.since, RESIZE_SETTLE_SECONDS, ++this.frames, RESIZE_SETTLE_FRAMES) && this.done();
  }

  private done(): boolean {
    this.pendingKey = '';
    this.frames = 0;
    return true;
  }
}

/**
 * Gemeinsame Regel beider Entprellungen: Läuft die Zeit (`waited > 0`), entscheidet nur
 * sie; die Frame-Zählung gilt nur, solange sie seit der Änderung steht (`waited === 0`).
 * Zurückgesprungene Zeit übernimmt sofort. `frames` zählt alle Frames seit der Änderung.
 */
export function settled(waited: number, settleTime: number, frames: number, settleFrames: number): boolean {
  if (waited < 0) return true;
  if (waited === 0) return frames > settleFrames;
  return waited >= settleTime;
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
/** … oder, solange die Zeit steht, so viele Frames hintereinander gleich bleiben. */
export const CANVAS_SETTLE_FRAMES = 6;

/** Größe des Canvas in CSS-Pixeln und Gerätepixeln (Backing-Store). */
export interface CanvasSize {
  width: number;
  height: number;
  pw: number;
  ph: number;
  key: string;
}

/** Exakte Gerätepixel aus dem ResizeObserver (`devicePixelContentBoxSize`), falls bekannt. */
export interface DevicePixels {
  pw: number;
  ph: number;
}

/**
 * CSS-Größe und Pixeldichte → Backing-Store (wie bisher: gerundete Gerätepixel). Mit
 * `device` (vom Browser auf das Pixelraster gerundet) werden dessen Werte genommen –
 * dann ist das Bild auch bei gebrochener Pixeldichte genau pixelgleich. Ungültige oder
 * unplausible Gerätepixel (mehr als 1 px neben CSS-Größe × Pixeldichte) werden ignoriert.
 */
export function canvasSize(cssWidth: number, cssHeight: number, dpr: number, device?: DevicePixels | null): CanvasSize {
  const width = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 0;
  const height = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 0;
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  let pw = Math.round(width * d);
  let ph = Math.round(height * d);
  // Nur plausible Werte (höchstens 1 px Rundung): Bei emulierter Pixeldichte (DevTools,
  // Headless) meldet Chromium Gerätepixel ohne den Faktor – das gäbe ein unscharfes Bild.
  if (device && width > 0 && height > 0 && plausible(device.pw, width * d) && plausible(device.ph, height * d)) {
    pw = device.pw;
    ph = device.ph;
  }
  return { width, height, pw, ph, key: sizeKey(pw, ph, width, height) };
}

function plausible(n: number, expected: number): boolean {
  return Number.isInteger(n) && n > 0 && Math.abs(n - expected) <= 1;
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

  /**
   * Meldet die gemessene Größe; gibt die zu verwendende Größe zurück. `now` in ms,
   * `device` optional exakte Gerätepixel (siehe `canvasSize`).
   */
  update(cssWidth: number, cssHeight: number, dpr: number, now: number, device?: DevicePixels | null): CanvasSize {
    const target = canvasSize(cssWidth, cssHeight, dpr, device);
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
    return settled(now - this.since, CANVAS_SETTLE_MS, ++this.frames, CANVAS_SETTLE_FRAMES) ? this.apply(target) : applied;
  }

  private apply(size: CanvasSize): CanvasSize {
    this.applied = size;
    this.pendingKey = '';
    this.frames = 0;
    return size;
  }
}
