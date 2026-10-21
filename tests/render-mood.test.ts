import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISITORS } from '../scripts/v2/content';
import { MoodLayer, moodWeights, normalizeTier } from '../src/render/mood';
import { drawScene, type SceneInput } from '../src/render/tree';
import { VisitorLayer, visitorDepth, visitorKind, type SceneVisitor, type VisitorFrame } from '../src/render/visitors';

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
    expect(visitorKind('golden-eagle')).toBe('flock');
    expect(visitorDepth('cranes')).toBe('sky');
    expect(visitorDepth('moth')).toBe('front');
  });
});

describe('Durchreisende zeichnen', () => {
  const frame = (time: number, reducedMotion = false): VisitorFrame => ({
    width: 800,
    height: 600,
    groundY: 480,
    top: 27,
    size: 30,
    dpr: 2,
    sx: 1,
    sy: 1,
    time,
    reducedMotion,
    windSkew: 0,
    blocked: [],
    anchors: null,
    crownX: 0,
    crownY: 0,
    crownRx: 0,
    crownRy: 0,
    crownTaken: [],
  });

  function draw(list: SceneVisitor[], depth: 'sky' | 'front', f: VisitorFrame): StubCanvas['calls'] {
    const canvas = makeCanvas(1600, 1200);
    new VisitorLayer().draw(canvas.getContext('2d'), list, depth, f);
    return canvas.calls.filter((c) => c.name === 'setTransform');
  }

  it('zeichnet doppelte Paare aus id und Platz nur einmal', () => {
    const one = draw([{ id: 'hummingbird-moth', slot: 1 }], 'front', frame(4)).length;
    expect(one).toBe(1);
    const twice = draw(
      [
        { id: 'hummingbird-moth', slot: 1 },
        { id: 'hummingbird-moth', slot: 1.4 },
        { id: 'hummingbird-moth', slot: 2 },
      ],
      'front',
      frame(4),
    ).length;
    expect(twice).toBe(2);
  });

  it('behält den Versatz je Gast auch ohne Bewegung und verkraftet negative Zeit', () => {
    const at = (list: SceneVisitor[]) => draw(list, 'front', frame(0, true)).map((c) => c.args[4]);
    expect(at([{ id: 'hummingbird-moth', slot: 0 }])).not.toEqual(at([{ id: 'hummingbird-moth', slot: 2 }]));
    // Gleicher Platz, andere Art: eigener Seed.
    const flock = draw([{ id: 'bramblings', slot: 0 }], 'front', frame(0, true)).map((c) => c.args[4]);
    const other = draw([{ id: 'golden-eagle', slot: 0 }], 'front', frame(0, true)).map((c) => c.args[4]);
    expect(flock.slice(0, 3)).not.toEqual(other.slice(0, 3));
    for (const time of [-0.5, -7.3, -100]) {
      const calls = draw(
        [
          { id: 'hummingbird-moth', slot: 0 },
          { id: 'cranes', slot: Number.NaN },
        ],
        'front',
        frame(time),
      );
      expect(calls.length).toBe(1);
      for (const c of calls) for (const a of c.args) expect(Number.isFinite(a as number)).toBe(true);
    }
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
