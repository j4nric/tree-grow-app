/**
 * Wind als günstige Verschiebung statt echter Scherung.
 *
 * Eine gescherte drawImage-Kopie (schiefe Transformation) muss jeden Zielpixel einzeln
 * filtern – mit Software-Canvas (schwache Handys, headless Chromium) der teuerste Teil
 * eines Frames. Stattdessen wird die Ebene in waagerechte Streifen zerlegt, die jeweils
 * nur verschoben werden. Ein Streifen umfasst genau die Zeilen, deren Scherung auf
 * dasselbe Vielfache von `quantum` (Gerätepixel) rundet:
 *  - Quantum 1 (ab `WIND_WHOLE_PIXEL_DPR`): ganzzahlige Verschiebung = reine Kopie ohne
 *    Filter (in Messungen ~7× schneller als die Scherung). Benachbarte Streifen
 *    unterscheiden sich um höchstens einen Gerätepixel – bei hoher Pixeldichte unsichtbar.
 *  - Quantum ¼ (geringe Pixeldichte): Viertelpixel-Schritte, damit das Wiegen weich bleibt;
 *    gefiltert, aber immer noch gut doppelt so schnell wie die Scherung.
 * Bei Scherung 0 (reduzierte Bewegung) ist es genau eine unverschobene Kopie.
 * Rein, ohne DOM – testbar.
 */

/** Ab dieser Pixeldichte wird ganzzahlig verschoben (Quantum 1), darunter in Vierteln. */
export const WIND_WHOLE_PIXEL_DPR = 1.5;

/** Schrittweite der Streifen-Verschiebung in Gerätepixeln für eine Pixeldichte. */
export function windQuantum(dpr: number): number {
  return dpr >= WIND_WHOLE_PIXEL_DPR ? 1 : 0.25;
}

/** Sanftes, unregelmäßiges Wiegen als Scherfaktor (oben verschoben, Fuß fest). */
export function windSkew(time: number, phase: number): number {
  return (
    0.009 * Math.sin(time * 0.55 + phase) +
    0.004 * Math.sin(time * 1.37 + phase * 1.7) +
    0.0015 * Math.sin(time * 3.1 + phase * 0.6)
  );
}

/**
 * Streifen einer gescherten Ebene, wiederverwendbar (keine Allokation pro Frame).
 * Streifen i: Zeilen `y[i]` … `y[i] + h[i] − 1`, horizontal um `dx[i]` verschoben.
 */
export class ShearBands {
  readonly y: number[] = [];
  readonly h: number[] = [];
  readonly dx: number[] = [];
  count = 0;

  /**
   * Zerlegt die Zeilen `y0` … `y0 + rows − 1` (ganzzahlig, Gerätepixel) für die Scherung
   * x' = x + k · (y − ground). Jede Zeile wird um die Scherung ihrer Mitte verschoben,
   * gerundet auf Vielfache von `quantum`. Gibt die Anzahl der Streifen zurück.
   */
  update(y0: number, rows: number, ground: number, k: number, quantum: number): number {
    this.count = 0;
    if (!(rows > 0)) return 0;
    const end = y0 + rows;
    if (!Number.isFinite(k) || k === 0 || !(quantum > 0) || !Number.isFinite(ground)) {
      this.push(y0, rows, 0);
      return this.count;
    }
    const s = k / quantum; // Scherung in Quanten je Zeile
    let y = y0;
    while (y < end) {
      const n = Math.round(s * (y + 0.5 - ground));
      // Erste Zeile, deren gerundete Verschiebung von n abweicht (Math.round: [n−½, n+½)).
      const t = s > 0 ? (n + 0.5) / s + ground - 0.5 : (n - 0.5) / s + ground - 0.5;
      let next = s > 0 ? Math.ceil(t) : Math.floor(t) + 1;
      // Rundungsfehler der Gleitkommazahlen: immer mindestens eine Zeile, nie über das Ende.
      if (!(next > y)) next = y + 1;
      if (next > end) next = end;
      this.push(y, next - y, n * quantum);
      y = next;
    }
    return this.count;
  }

  private push(y: number, h: number, dx: number): void {
    const i = this.count++;
    this.y[i] = y;
    this.h[i] = h;
    this.dx[i] = dx === 0 ? 0 : dx; // −0 vermeiden
  }
}
