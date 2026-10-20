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
