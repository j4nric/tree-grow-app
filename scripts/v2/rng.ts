/**
 * Kleiner, deterministischer Zufallsgenerator (mulberry32). Der gesamte Zustand ist
 * eine 32-Bit-Zahl – genau so soll er später im GameState gespeichert werden
 * (`rngState`), damit Kartenziehungen nach dem Neuladen identisch bleiben.
 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  /** Gleichverteilte Zahl in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  /** Index nach Gewichten; −1, wenn alle Gewichte 0 sind. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]!);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}
