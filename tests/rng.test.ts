import { describe, expect, it } from 'vitest';
import { isValidRngState, normalizeSeed, pick, random, randomInt, weightedIndex } from '../src/core/rng';

describe('rng (mulberry32)', () => {
  it('liefert die feste mulberry32-Folge (gespeicherte Ziehungen bleiben gleich)', () => {
    // Werte des früheren Prototyps (scripts/v2/rng.ts, entfernt in Schritt 2.10).
    const holder = { rngState: 12345 };
    expect([random(holder), random(holder), random(holder)].map((x) => x * 2 ** 32)).toEqual([4207900869, 1317490944, 2079646450]);
    for (let i = 3; i < 100; i++) random(holder);
    expect(holder.rngState).toBe(2767967213);
  });

  it('bleibt im Bereich [0, 1) und ist reproduzierbar', () => {
    const a = { rngState: normalizeSeed(1) };
    const b = { rngState: normalizeSeed(1) };
    for (let i = 0; i < 1000; i++) {
      const x = random(a);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(random(b)).toBe(x);
    }
    expect(randomInt(a, 1)).toBe(0);
    expect(pick(a, ['x'])).toBe('x');
  });

  it('normalizeSeed macht aus allem einen gültigen Zustand', () => {
    for (const seed of [0, 1, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 32, 2 ** 53, Date.UTC(2026, 9, 20)]) {
      expect(isValidRngState(normalizeSeed(seed)), String(seed)).toBe(true);
    }
    expect(normalizeSeed(1)).not.toBe(normalizeSeed(2));
  });

  it('isValidRngState lehnt 0, Brüche, negative und zu große Werte ab', () => {
    for (const v of [0, -1, 1.5, 2 ** 32, NaN, '5', null, undefined]) expect(isValidRngState(v)).toBe(false);
    expect(isValidRngState(1)).toBe(true);
    expect(isValidRngState(2 ** 32 - 1)).toBe(true);
  });

  it('weightedIndex beachtet Gewichte und gibt −1 ohne Gewicht', () => {
    const h = { rngState: 7 };
    const before = h.rngState;
    expect(weightedIndex(h, [0, 0, -3])).toBe(-1);
    expect(h.rngState).toBe(before); // kein Zufall verbraucht
    for (let i = 0; i < 50; i++) expect(weightedIndex(h, [0, 5, 0])).toBe(1);
    const counts = [0, 0];
    for (let i = 0; i < 2000; i++) counts[weightedIndex(h, [9, 1])]!++;
    expect(counts[0]!).toBeGreaterThan(counts[1]! * 4);
  });
});
