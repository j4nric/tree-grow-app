/**
 * Kleine Hilfsfunktionen für den Renderer: Seed-Zufall, Interpolation, Farben.
 * Kein Math.random() – gleiche Eingabe ergibt immer das gleiche Bild.
 */

/** Kleiner, deterministischer Zufallsgenerator (gleicher Seed → gleiche Folge). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mischt zwei Zahlen zu einem neuen Seed. Jeder Ast bekommt so einen eigenen Seed
 * aus „Eltern-Seed + Kind-Index“ – unabhängig davon, wie tief der Baum schon ist.
 * Dadurch verschieben neue Äste nie die Zufallswerte bestehender Äste.
 */
export function hash2(a: number, b: number): number {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) >>> 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function smooth01(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mischt Farbe `a` mit `b` im Verhältnis t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const bl = Math.round(lerp(b1, b2, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
