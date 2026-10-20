/**
 * Deterministischer Zufallsgenerator (mulberry32) mit 32-Bit-Zustand im GameState
 * (`rngState`). Gleicher Algorithmus wie scripts/v2/rng.ts. Kein Math.random():
 * Neuladen, Offline-Simulation und Tests ziehen dieselben Karten.
 */
export interface RngHolder {
  rngState: number;
}

/** Macht aus einer beliebigen Zahl (z. B. Date.now()) einen gültigen Zustand ≠ 0. */
export function normalizeSeed(seed: number): number {
  const n = Number.isFinite(seed) ? Math.floor(Math.abs(seed)) % 4294967296 : 0;
  // Bits durchmischen, damit nahe beieinanderliegende Startwerte verschieden starten.
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x === 0 ? 0x9e3779b9 : x;
}

/** Ist das ein gültiger gespeicherter Zustand (uint32, ≠ 0)? */
export function isValidRngState(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 4294967296;
}

/** Gleichverteilte Zahl in [0, 1). Rückt den Zustand weiter. */
export function random(rng: RngHolder): number {
  rng.rngState = (rng.rngState + 0x6d2b79f5) >>> 0;
  let t = rng.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Ganze Zahl in [0, n). */
export function randomInt(rng: RngHolder, n: number): number {
  return Math.floor(random(rng) * n);
}

export function pick<T>(rng: RngHolder, items: readonly T[]): T {
  return items[randomInt(rng, items.length)]!;
}

/** Index nach Gewichten; −1, wenn alle Gewichte 0 sind (verbraucht dann keinen Zufall). */
export function weightedIndex(rng: RngHolder, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!(total > 0)) return -1;
  let r = random(rng) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r < 0) return i;
  }
  return weights.length - 1;
}
