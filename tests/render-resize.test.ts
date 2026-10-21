import { describe, expect, it } from 'vitest';
import {
  CANVAS_SETTLE_FRAMES,
  CANVAS_SETTLE_MS,
  canvasSize,
  CanvasSizeDebouncer,
  seasonStepKey,
  settled,
  sizeKey,
} from '../src/render/resize';
import { seasonLook } from '../src/render/season';

describe('Cache-Schlüssel der Kulisse', () => {
  it('sizeKey unterscheidet Größe und Pixeldichte', () => {
    expect(sizeKey(1600, 1000, 800, 500)).toBe(sizeKey(1600, 1000, 800, 500));
    expect(sizeKey(1600, 1000, 800, 500)).not.toBe(sizeKey(800, 500, 800, 500)); // andere Pixeldichte
    expect(sizeKey(1600, 1000, 800, 500)).not.toBe(sizeKey(1600, 1000, 1600, 1000)); // gleiche Gerätepixel
    expect(sizeKey(1600, 1000, 800, 500)).not.toBe(sizeKey(1000, 1600, 500, 800)); // gedreht
  });

  it('seasonStepKey: ohne Angabe und im Sommer −1', () => {
    expect(seasonStepKey(null)).toBe(-1);
    expect(seasonStepKey(seasonLook(undefined))).toBe(-1);
    expect(seasonStepKey(seasonLook(Number.NaN))).toBe(-1);
    expect(seasonStepKey(seasonLook(1))).toBe(-1);
    expect(seasonStepKey(seasonLook(1.01))).toBe(-1);
  });

  it('seasonStepKey ändert sich nur alle 0,05', () => {
    const a = seasonStepKey(seasonLook(2.3));
    expect(seasonStepKey(seasonLook(2.31))).toBe(a);
    expect(seasonStepKey(seasonLook(2.29))).toBe(a);
    expect(seasonStepKey(seasonLook(2.36))).not.toBe(a);
    expect(seasonStepKey(seasonLook(6.3))).toBe(a); // modulo 4
    // Über einen ganzen Jahreslauf höchstens 80 verschiedene Stufen (+ Sommer).
    const keys = new Set<number>();
    for (let s = 0; s < 4; s += 0.001) keys.add(seasonStepKey(seasonLook(s)));
    expect(keys.size).toBeLessThanOrEqual(81);
    expect(keys.size).toBeGreaterThan(40);
  });
});

describe('canvasSize', () => {
  it('rundet Gerätepixel wie bisher', () => {
    const s = canvasSize(800.4, 500.6, 2);
    expect(s).toMatchObject({ width: 800.4, height: 500.6, pw: 1601, ph: 1001 });
    expect(s.key).toBe(sizeKey(1601, 1001, 800.4, 500.6));
  });

  it('ungültige Werte werden zu 0 bzw. Pixeldichte 1', () => {
    expect(canvasSize(Number.NaN, -3, 2)).toMatchObject({ pw: 0, ph: 0 });
    expect(canvasSize(100, 50, 0)).toMatchObject({ pw: 100, ph: 50 });
    expect(canvasSize(100, 50, Number.POSITIVE_INFINITY)).toMatchObject({ pw: 100, ph: 50 });
  });
});

describe('settled', () => {
  it('Frame-Regel nur bei stehender Zeit, sonst entscheidet die Zeit', () => {
    expect(settled(0, 100, 7, 6)).toBe(true);
    expect(settled(0, 100, 6, 6)).toBe(false);
    // Zeit läuft: viele Frames zählen nicht.
    expect(settled(30, 100, 50, 6)).toBe(false);
    expect(settled(100, 100, 2, 6)).toBe(true);
    // Zurückgesprungen: sofort.
    expect(settled(-1, 100, 1, 6)).toBe(true);
  });
});

describe('canvasSize mit exakten Gerätepixeln', () => {
  it('nimmt devicePixelContentBoxSize, wenn gültig', () => {
    expect(canvasSize(800.4, 500.6, 2, { pw: 1600, ph: 1002 })).toMatchObject({ width: 800.4, pw: 1600, ph: 1002 });
    expect(canvasSize(800.4, 500.6, 2, { pw: 1600, ph: 1002 }).key).toBe(sizeKey(1600, 1002, 800.4, 500.6));
  });

  it('ignoriert ungültige Gerätepixel und leere CSS-Größe', () => {
    expect(canvasSize(800, 500, 2, { pw: 0, ph: 1000 })).toMatchObject({ pw: 1600, ph: 1000 });
    expect(canvasSize(800, 500, 2, { pw: Number.NaN, ph: 1000 })).toMatchObject({ pw: 1600 });
    expect(canvasSize(800, 500, 2, { pw: 1600.5, ph: 1000 })).toMatchObject({ pw: 1600 });
    expect(canvasSize(0, 500, 2, { pw: 1600, ph: 1000 })).toMatchObject({ pw: 0, ph: 1000 });
    expect(canvasSize(800, 500, 2, null)).toMatchObject({ pw: 1600, ph: 1000 });
  });

  it('ignoriert Gerätepixel, die nicht zur Pixeldichte passen (emulierte Pixeldichte)', () => {
    // Headless-Chromium mit deviceScaleFactor 2 meldet CSS-Pixel als Gerätepixel.
    expect(canvasSize(800, 500, 2, { pw: 800, ph: 500 })).toMatchObject({ pw: 1600, ph: 1000 });
    expect(canvasSize(800, 500, 2, { pw: 1602, ph: 1000 })).toMatchObject({ pw: 1600, ph: 1000 });
    expect(canvasSize(800.5, 500, 1, { pw: 801, ph: 500 })).toMatchObject({ pw: 801 });
    expect(canvasSize(800.5, 500, 1, { pw: 800, ph: 500 })).toMatchObject({ pw: 800 });
  });
});

describe('CanvasSizeDebouncer', () => {
  it('bei 144 und 240 Hz wird erst nach ~100 ms übernommen, nicht nach 6 Frames', () => {
    for (const hz of [144, 240]) {
      const d = new CanvasSizeDebouncer();
      const first = d.update(800, 500, 1, 0);
      const dt = 1000 / hz;
      let i = 1;
      let t = dt;
      while (d.update(700, 500, 1, i * dt) === first) {
        i++;
        t = i * dt;
      }
      expect(t - dt).toBeGreaterThanOrEqual(CANVAS_SETTLE_MS - 1e-9);
      expect(t - dt).toBeLessThan(CANVAS_SETTLE_MS + dt + 1e-9);
    }
  });

  it('übergibt exakte Gerätepixel an den Backing-Store', () => {
    const d = new CanvasSizeDebouncer();
    expect(d.update(800.3, 500, 1.5, 0, { pw: 1201, ph: 750 })).toMatchObject({ pw: 1201, ph: 750 }); // statt 1200
  });

  it('übernimmt die erste Größe sofort', () => {
    const d = new CanvasSizeDebouncer();
    expect(d.update(800, 500, 2, 0)).toMatchObject({ pw: 1600, ph: 1000 });
  });

  it('übernimmt eine Größe sofort, wenn das Canvas bisher leer war', () => {
    const d = new CanvasSizeDebouncer();
    d.update(0, 0, 1, 0);
    expect(d.update(800, 500, 1, 16)).toMatchObject({ pw: 800, ph: 500 });
  });

  it('hält beim Ziehen die alte Größe, bis die neue ~100 ms stabil ist', () => {
    const d = new CanvasSizeDebouncer();
    const first = d.update(800, 500, 1, 0);
    // Breite ändert sich jeden Frame: alte Größe bleibt (Frame-Zählung beginnt je neuer Größe neu).
    for (let i = 1; i <= 20; i++) expect(d.update(800 - i, 500, 1, i * 16)).toBe(first);
    // Danach stabil: erst nach CANVAS_SETTLE_MS übernommen.
    const t0 = 21 * 16;
    expect(d.update(760, 500, 1, t0)).toBe(first);
    expect(d.update(760, 500, 1, t0 + CANVAS_SETTLE_MS - 1)).toBe(first);
    expect(d.update(760, 500, 1, t0 + CANVAS_SETTLE_MS)).toMatchObject({ pw: 760, ph: 500 });
  });

  it('gleiche Größe → dasselbe Objekt (keine Allokation, kein Neubelegen)', () => {
    const d = new CanvasSizeDebouncer();
    const a = d.update(800, 500, 2, 0);
    expect(d.update(800, 500, 2, 16)).toBe(a);
  });

  it('geänderte Pixeldichte gilt als Größenänderung', () => {
    const d = new CanvasSizeDebouncer();
    d.update(800, 500, 1, 0);
    d.update(800, 500, 2, 10);
    expect(d.update(800, 500, 2, 10 + CANVAS_SETTLE_MS)).toMatchObject({ pw: 1600, ph: 1000 });
  });

  it('übernimmt bei stehender Zeit nach einigen Frames', () => {
    const d = new CanvasSizeDebouncer();
    const first = d.update(800, 500, 1, 5);
    for (let i = 0; i < CANVAS_SETTLE_FRAMES; i++) expect(d.update(700, 500, 1, 5)).toBe(first);
    expect(d.update(700, 500, 1, 5)).toMatchObject({ pw: 700 });
  });

  it('übernimmt sofort bei zurückgesprungener oder ungültiger Zeit', () => {
    const d = new CanvasSizeDebouncer();
    d.update(800, 500, 1, 1000);
    d.update(700, 500, 1, 1000);
    expect(d.update(700, 500, 1, 10)).toMatchObject({ pw: 700 });
    expect(d.update(600, 500, 1, Number.NaN)).toMatchObject({ pw: 600 });
  });

  it('zurück zur alten Größe während des Wartens: nichts zu tun', () => {
    const d = new CanvasSizeDebouncer();
    const first = d.update(800, 500, 1, 0);
    d.update(700, 500, 1, 16);
    expect(d.update(800, 500, 1, 32)).toBe(first);
    // Neue Änderung beginnt eine neue Wartezeit.
    expect(d.update(700, 500, 1, 200)).toBe(first);
    expect(d.update(700, 500, 1, 200 + CANVAS_SETTLE_MS)).toMatchObject({ pw: 700 });
  });
});
