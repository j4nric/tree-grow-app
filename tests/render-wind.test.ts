import { describe, expect, it } from 'vitest';
import { ShearBands, WIND_WHOLE_PIXEL_DPR, windQuantum, windSkew } from '../src/render/wind';

/** Erwartete Verschiebung jeder Zeile (Zeilenmitte, gerundet auf das Quantum). */
function rowShift(y: number, ground: number, k: number, q: number): number {
  return Math.round((k * (y + 0.5 - ground)) / q) * q;
}

/** Prüft, dass die Streifen lückenlos alle Zeilen abdecken und jede richtig verschieben. */
function checkBands(b: ShearBands, y0: number, rows: number, ground: number, k: number, q: number): void {
  let y = y0;
  for (let i = 0; i < b.count; i++) {
    expect(b.y[i]).toBe(y);
    expect(b.h[i]).toBeGreaterThan(0);
    for (let r = b.y[i]!; r < b.y[i]! + b.h[i]!; r++) expect(b.dx[i]).toBeCloseTo(rowShift(r, ground, k, q), 9);
    y += b.h[i]!;
  }
  expect(y).toBe(y0 + rows);
}

describe('Wind: Streifen statt Scherung', () => {
  it('ohne Wind genau ein unverschobener Streifen (wie reduzierte Bewegung bisher)', () => {
    const b = new ShearBands();
    expect(b.update(40, 900, 1200, 0, 1)).toBe(1);
    expect([b.y[0], b.h[0], b.dx[0]]).toEqual([40, 900, 0]);
    expect(Object.is(b.dx[0], -0)).toBe(false);
  });

  it('jede Zeile wird um die gerundete Scherung ihrer Mitte verschoben – lückenlos', () => {
    const b = new ShearBands();
    for (const k of [0.0145, -0.0145, 0.003, -0.0071, 1e-6, 0.2]) {
      for (const q of [1, 0.25]) {
        b.update(37, 1311, 1400, k, q);
        checkBands(b, 37, 1311, 1400, k, q);
        // Benachbarte Streifen unterscheiden sich um genau ein Quantum (keine sichtbaren Sprünge).
        for (let i = 1; i < b.count; i++) expect(Math.abs(b.dx[i]! - b.dx[i - 1]!)).toBeLessThanOrEqual(q + 1e-9);
      }
    }
  });

  it('Ebene unter und über der Bodenlinie, ganzzahlige Verschiebung ist ganzzahlig', () => {
    const b = new ShearBands();
    b.update(0, 600, 300, 0.012, 1);
    checkBands(b, 0, 600, 300, 0.012, 1);
    for (let i = 0; i < b.count; i++) expect(Number.isInteger(b.dx[i])).toBe(true);
  });

  it('wenige Streifen: höchstens |k|·Höhe/Quantum + 2', () => {
    const b = new ShearBands();
    const n = b.update(0, 1600, 1600, 0.0145, 1);
    expect(n).toBeLessThanOrEqual(Math.ceil(0.0145 * 1600) + 2);
    expect(n).toBeGreaterThan(10);
  });

  it('ungültige Eingaben: keine Zeilen → nichts, ungültige Scherung → unverschoben', () => {
    const b = new ShearBands();
    expect(b.update(0, 0, 100, 0.01, 1)).toBe(0);
    expect(b.update(0, Number.NaN, 100, 0.01, 1)).toBe(0);
    expect(b.update(0, 50, 100, Number.NaN, 1)).toBe(1);
    expect(b.dx[0]).toBe(0);
    expect(b.update(0, 50, Number.POSITIVE_INFINITY, 0.01, 1)).toBe(1);
    expect(b.update(0, 50, 100, 0.01, 0)).toBe(1);
  });

  it('wiederverwendbar: ein zweiter Aufruf ersetzt die Streifen', () => {
    const b = new ShearBands();
    b.update(0, 1000, 1000, 0.0145, 1);
    b.update(0, 1000, 1000, 0, 1);
    expect(b.count).toBe(1);
  });

  it('Quantum: ganzzahlig ab hoher Pixeldichte, sonst Viertelpixel', () => {
    expect(windQuantum(1)).toBe(0.25);
    expect(windQuantum(WIND_WHOLE_PIXEL_DPR)).toBe(1);
    expect(windQuantum(3)).toBe(1);
    expect(windQuantum(Number.NaN)).toBe(0.25);
  });

  it('windSkew bleibt klein und deterministisch', () => {
    for (let t = 0; t < 100; t += 0.37) {
      expect(Math.abs(windSkew(t, 0))).toBeLessThanOrEqual(0.0145 + 1e-12);
      expect(windSkew(t, 1.9)).toBe(windSkew(t, 1.9));
    }
  });
});
