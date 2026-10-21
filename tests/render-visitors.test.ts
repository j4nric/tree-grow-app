import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animalSize, createAnchorResolver } from '../src/render/anchors';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { drawScene, type SceneAnimal } from '../src/render/tree';
import {
  ABOVE_BIG_ANIMALS,
  boarPoses,
  falconPose,
  freeIntervals,
  mothPose,
  swallowPoses,
  SWALLOW_MIN_HEIGHT,
  VISITOR_IDS,
  visitorDepth,
  visitorKind,
  VisitorLayer,
} from '../src/render/visitors';

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

const NEW_GUESTS = ['swallows', 'boars', 'peregrine', 'stag-flight', 'waxwings'];
const ALL_GUESTS = ['cranes', 'bramblings', 'hummingbird-moth', ...NEW_GUESTS];

/** Belegungen des Waldsaums (Plätze), wie sie im Spiel vorkommen können. */
const EDGE_SETS: number[][] = [[], [0], [1], [0, 1], [1, 3], [0, 1, 2], [0, 1, 2, 3]];
const SIZES: [number, number][] = [
  [390, 844],
  [1200, 700],
  [320, 568],
];

const frameMemo = new Map<string, ReturnType<typeof buildFrame>>();

/** Szene-Rahmen für die reinen Bahn-Funktionen (gemerkt je Größe und Belegung; nur die Zeit wechselt). */
function frameFor(w: number, h: number, edgeSlots: number[], time: number, reducedMotion = false) {
  const key = `${w}x${h}/${edgeSlots.join(',')}`;
  let base = frameMemo.get(key);
  if (!base) {
    base = buildFrame(w, h, edgeSlots);
    frameMemo.set(key, base);
  }
  return { ...base, time, reducedMotion };
}

/** Belegte Bereiche aus echten Ankerpunkten (Stufe 7). */
function buildFrame(w: number, h: number, edgeSlots: number[]) {
  const layout = makeLayout(w, h);
  const g = 7;
  const anchors = createAnchorResolver(layout, g, placeMainTree(layout, g));
  // Am Waldsaum stehen Rehe (Großtiere) auf den belegten Plätzen.
  const animals = edgeSlots.map((slot) => ({ id: 'deer', family: 'mammals' as const, niche: 'edge', slot }));
  const blocked = new VisitorLayer().updateBlocked(animals, anchors);
  return { width: w, height: h, groundY: layout.groundY, top: layout.top, size: animalSize(w, h), time: 0, reducedMotion: false, blocked };
}

function overlapsBlocked(x0: number, x1: number, blocked: readonly number[]): boolean {
  for (let i = 0; i < blocked.length; i += 2) if (x1 > blocked[i]! && x0 < blocked[i + 1]!) return true;
  return false;
}

const TIMES = Array.from({ length: 40 }, (_, i) => i * 1.37);

describe('Durchreisende: Zuordnung', () => {
  it('haben für alle acht Gäste eine eigene Zeichnung', () => {
    for (const id of ALL_GUESTS) {
      expect(VISITOR_IDS).toContain(id);
      expect(visitorKind(id), id).not.toBe('flock');
    }
    expect(visitorKind('golden-eagle')).toBe('flock');
    expect(visitorDepth(visitorKind('peregrine'))).toBe('sky');
    expect(visitorDepth(visitorKind('boars'))).toBe('meadow');
    expect(visitorDepth(visitorKind('swallows'))).toBe('front');
  });

  it('freie Lücken zwischen belegten Bereichen', () => {
    expect(freeIntervals([], 0, 100, 5)).toEqual([0, 100]);
    expect(freeIntervals([20, 30, 60, 70], 0, 100, 5)).toEqual([0, 15, 35, 55, 75, 100]);
    expect(freeIntervals([0, 100], 0, 100, 0)).toEqual([]);
  });
});

describe('Wildschweine', () => {
  it('laufen nie in Großtiere am Waldsaum und haben Bodenkontakt (Mobil und Desktop)', () => {
    for (const [w, h] of SIZES) {
      for (const set of EDGE_SETS) {
        for (const t of TIMES) {
          const f = frameFor(w, h, set, t);
          const poses = boarPoses(f, 0, 12345);
          for (const p of poses) {
            const half = p.size * 0.8;
            expect(overlapsBlocked(p.x - half, p.x + half, f.blocked), `${w}×${h}, Plätze ${set}, t=${t.toFixed(1)}`).toBe(false);
            expect(p.x - half).toBeGreaterThanOrEqual(-0.01);
            expect(p.x + half).toBeLessThanOrEqual(w + 0.01);
            // Füße auf der Grasnarbe (höchstens 0,2 Tiergrößen dahinter).
            expect(p.y).toBeLessThanOrEqual(f.groundY + 1);
            expect(p.y).toBeGreaterThanOrEqual(f.groundY - f.size * 0.2);
          }
        }
      }
    }
  });

  it('ziehen als Rotte (Bache und Frischlinge), bleiben stehen und wühlen', () => {
    const f = (t: number) => frameFor(1200, 700, [], t);
    const herd = boarPoses(f(0.5), 0, 7);
    expect(herd.length).toBe(4);
    expect(herd.filter((p) => !p.piglet).length).toBe(1);
    // Laufen (Bilder 0/1) und Wühlen (Bilder 2/3) wechseln sich ab.
    const frames = new Set<number>();
    for (let t = 0; t < 15; t += 0.25) for (const p of boarPoses(f(t), 0, 7)) frames.add(p.frame);
    expect([...frames].sort()).toEqual([0, 1, 2, 3]);
    // Mobil höchstens 3 Tiere.
    expect(boarPoses(frameFor(390, 844, [], 0.5), 0, 7).length).toBeLessThanOrEqual(3);
  });

  it('ohne freien Platz bleiben sie weg; bei weniger Bewegung stehen sie still', () => {
    const f = frameFor(1200, 700, [], 0);
    expect(boarPoses({ ...f, blocked: [0, 1200] }, 0, 7)).toEqual([]);
    const a = boarPoses(frameFor(1200, 700, [0, 1], 0, true), 0, 7);
    const b = boarPoses(frameFor(1200, 700, [0, 1], 33, true), 0, 7);
    expect(a).toEqual(b);
    expect(a.every((p) => p.frame >= 2)).toBe(true);
  });
});

describe('Taubenschwänzchen, Schwalben, Falke', () => {
  it('Taubenschwänzchen überlappt nie ein Großtier (auch nicht im Flug zwischen den Blüten)', () => {
    for (const [w, h] of SIZES) {
      for (const set of EDGE_SETS) {
        for (const slot of [0, 1]) {
          for (let t = 0; t < 30; t += 0.13) {
            const f = frameFor(w, h, set, t);
            const p = mothPose(f, slot, 999);
            const half = f.size * 0.78 * 0.62;
            const above = p.y <= f.groundY - f.size * ABOVE_BIG_ANIMALS;
            expect(above || !overlapsBlocked(p.x - half, p.x + half, f.blocked), `${w}×${h}, Plätze ${set}, Platz ${slot}, t=${t.toFixed(2)}`).toBe(true);
          }
        }
      }
    }
  });

  it('Schwalben fliegen tief, aber über den Köpfen der Großtiere', () => {
    for (const [w, h] of SIZES) {
      for (const t of TIMES) {
        const f = frameFor(w, h, [0, 1, 2, 3], t);
        for (const p of swallowPoses(f, 42)) {
          expect(p.y).toBeLessThanOrEqual(f.groundY - f.size * SWALLOW_MIN_HEIGHT + 1e-6);
          expect(p.y).toBeGreaterThan(f.groundY - f.size * 5);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(w);
          expect(Math.abs(p.rot)).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('der Falke kreist hoch oben und stößt gelegentlich herab', () => {
    const f = (t: number) => frameFor(1200, 700, [], t);
    let stoops = 0;
    let lowest = Infinity;
    for (let t = 0; t < 30; t += 0.1) {
      const p = falconPose(f(t), 1, 5);
      if (p.frame === 2) stoops++;
      lowest = Math.min(lowest, f(t).groundY - p.y);
      expect(p.y).toBeLessThan(f(t).groundY - f(t).size * 3);
    }
    expect(stoops).toBeGreaterThan(0);
    // Meist segelt er (Sturzflug ist kurz).
    expect(stoops).toBeLessThan(60);
    expect(lowest).toBeGreaterThan(0);
  });

  it('sind deterministisch und unterscheiden sich je Art und Platz', () => {
    const f = frameFor(1200, 700, [1], 12.3);
    expect(swallowPoses(f, 1)).toEqual(swallowPoses(f, 1));
    expect(swallowPoses(f, 1)).not.toEqual(swallowPoses(f, 2));
    expect(falconPose(f, 0, 3)).not.toEqual(falconPose(f, 1, 3));
  });
});

describe('Alle Gäste in der Szene', () => {
  it('zeichnen ohne ungültige Transformationen – Mobil und Desktop, mit und ohne Bewegung', () => {
    const visitors = ALL_GUESTS.map((id, slot) => ({ id, slot }));
    const animals: SceneAnimal[] = [
      { id: 'deer', family: 'mammals', niche: 'edge', slot: 1, happiness: 0.8 },
      { id: 'fox', family: 'mammals', niche: 'edge', slot: 3, happiness: 0.8 },
    ];
    for (const [w, h] of SIZES) {
      for (const growth of [2, 6.5]) {
        for (const reducedMotion of [false, true]) {
          const canvas = makeCanvas(w, h);
          const ctx = canvas.getContext('2d');
          drawScene(ctx, w, h, { growth, time: 3, visitors, animals, reducedMotion });
          canvas.calls.length = 0;
          drawScene(ctx, w, h, { growth, time: 3.4, visitors, animals, reducedMotion });
          const bad = canvas.calls.filter((c) => c.name === 'setTransform' && c.args.some((a) => !Number.isFinite(a as number)));
          expect(bad).toEqual([]);
          expect(canvas.calls.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(20);
        }
      }
    }
  });

  it('berechnen belegte Bereiche nur bei geänderten Plätzen neu', () => {
    const layout = makeLayout(1200, 700);
    const anchors = createAnchorResolver(layout, 5, placeMainTree(layout, 5));
    const layer = new VisitorLayer();
    const deer = (slot: number, niche = 'edge') => ({ id: 'deer', family: 'mammals' as const, niche, slot });
    const a = layer.updateBlocked([deer(1)], anchors);
    expect(a.length).toBe(2);
    expect(layer.updateBlocked([deer(1), deer(0, 'crown')], anchors)).toBe(a);
    expect(layer.updateBlocked([deer(2)], anchors)).not.toBe(a);
    expect(layer.updateBlocked(undefined, anchors)).toEqual([]);
    // Kleine Tiere am Waldsaum (Biene) blockieren nicht.
    expect(layer.updateBlocked([{ id: 'bee', family: 'insects', niche: 'edge', slot: 0 }], anchors)).toEqual([]);
  });
});
