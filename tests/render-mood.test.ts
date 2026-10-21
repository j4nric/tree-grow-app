import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISITORS } from '../scripts/v2/content';
import { MoodLayer, moodWeights, normalizeTier } from '../src/render/mood';
import { drawScene, type SceneInput } from '../src/render/tree';
import { visitorDepth, visitorKind } from '../src/render/visitors';

/** Canvas-Stub wie in render-scene.test.ts: protokolliert nur die Aufrufe. */
interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, calls: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop() {}, data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        canvas.calls.push({ name: String(prop), args });
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => makeCanvas() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Harmonie-Stimmung', () => {
  it('normalisiert die Stufe (ungültig → aus, sonst 0–4)', () => {
    expect(normalizeTier(undefined)).toBeNull();
    expect(normalizeTier(Number.NaN)).toBeNull();
    expect(normalizeTier(Infinity)).toBeNull();
    expect(normalizeTier(-3)).toBe(0);
    expect(normalizeTier(9)).toBe(4);
    expect(normalizeTier(3)).toBe(3);
  });

  it('ist bei Stufe 2 neutral, grau darunter und warm mit Strahlen, Pollen und Glühwürmchen darüber', () => {
    expect(moodWeights(2)).toEqual({ veil: 0, warm: 0, rays: 0, pollen: 0, fireflies: 0 });
    expect(moodWeights(0).veil).toBeGreaterThan(moodWeights(1).veil);
    expect(moodWeights(1).veil).toBeGreaterThan(0);
    expect(moodWeights(1).warm).toBe(0);
    const t3 = moodWeights(3);
    expect(t3.warm).toBeGreaterThan(0);
    expect(t3.rays).toBeGreaterThan(0);
    expect(t3.pollen).toBeGreaterThan(0);
    expect(t3.fireflies).toBe(0);
    const t4 = moodWeights(4);
    expect(t4.veil).toBe(0);
    expect(t4.fireflies).toBe(1);
    expect(t4.rays).toBe(1);
  });

  it('wechselt die Stufe sanft (stufenlos, ohne Sprung) und sofort bei weniger Bewegung', () => {
    const m = new MoodLayer();
    expect(m.update(undefined, 0, false)).toBeNull();
    expect(m.update(0, 0, false)).toBe(0);
    let prev = 0;
    for (let i = 1; i <= 600; i++) {
      const level = m.update(4, i / 60, false)!;
      expect(level - prev).toBeLessThanOrEqual(0.5 / 60 + 1e-9);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
    expect(prev).toBe(4);
    // Steht die Zeit, geht es je Frame ein kleines Stück weiter.
    const paused = new MoodLayer();
    paused.update(1, 5, false);
    expect(paused.update(3, 5, false)!).toBeGreaterThan(1);
    expect(paused.update(3, 5, false)!).toBeLessThan(1.1);
    expect(paused.update(0, 5, true)).toBe(0);
    expect(paused.update(undefined, 5, false)).toBeNull();
  });
});

describe('Durchreisende', () => {
  it('haben für jeden Gast aus scripts/v2/content.ts eine eigene Zeichnung', () => {
    for (const v of VISITORS) expect(visitorKind(v.id), v.id).not.toBe('flock');
    expect(visitorKind('cranes')).toBe('cranes');
    expect(visitorKind('hummingbird-moth')).toBe('moth');
    expect(visitorKind('waxwings')).toBe('flock');
    expect(visitorDepth('cranes')).toBe('sky');
    expect(visitorDepth('moth')).toBe('front');
  });
});

describe('Szene mit Stimmung und Gästen', () => {
  const base: SceneInput = { growth: 5.5, time: 3, animals: [] };

  function calls(input: SceneInput, w = 800, h = 600): StubCanvas['calls'] {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    drawScene(ctx, w, h, input);
    canvas.calls.length = 0;
    drawScene(ctx, w, h, { ...input, time: input.time + 0.016 });
    return canvas.calls;
  }

  it('zeichnet ohne Angabe, bei Stufe 2 und ohne Gäste genau wie bisher', () => {
    const plain = calls(base).map((c) => c.name);
    expect(calls({ ...base, harmonyTier: 2 }).map((c) => c.name)).toEqual(plain);
    expect(calls({ ...base, visitors: [] }).map((c) => c.name)).toEqual(plain);
  });

  it('zeichnet Stimmung und Gäste ohne ungültige Transformationen – auch bei schrägen Eingaben', () => {
    const plain = calls(base).length;
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
      [320, 480],
    ] as const) {
      for (const reducedMotion of [false, true]) {
        for (const harmonyTier of [0, 3, 4, Number.NaN]) {
          const list = calls(
            {
              ...base,
              harmonyTier,
              reducedMotion,
              visitors: [
                { id: 'cranes', slot: 0 },
                { id: 'bramblings', slot: 1 },
                { id: 'hummingbird-moth', slot: 2 },
                { id: 'unknown-guest', slot: Number.NaN },
              ],
            },
            w,
            h,
          );
          const bad = list.filter((c) => c.name === 'setTransform' && c.args.some((a) => !Number.isFinite(a as number)));
          expect(bad).toEqual([]);
          if (w === 1200) expect(list.length).toBeGreaterThan(plain);
        }
      }
    }
  });
});
