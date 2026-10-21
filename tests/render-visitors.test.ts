import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animalSize, createAnchorResolver } from '../src/render/anchors';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { drawScene, type SceneAnimal } from '../src/render/tree';
import {
  ABOVE_BIG_ANIMALS,
  boarPoses,
  boarRoute,
  mothGap,
  waxwingPerches,
  WAXWING_CLEARANCE,
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

describe('Gäste-Nachschliff', () => {
  it('freeIntervals ist leer, wenn hi nicht größer als lo ist', () => {
    expect(freeIntervals([], 10, 10, 0)).toEqual([]);
    expect(freeIntervals([], 20, 10, 0)).toEqual([]);
    expect(freeIntervals([0, 5], Number.NaN, 10, 0)).toEqual([]);
  });

  it('zwei Taubenschwänzchen auf einer Seite bekommen getrennte Bahnen', () => {
    for (const [w, h] of SIZES) {
      for (const set of EDGE_SETS) {
        const f = frameFor(w, h, set, 0);
        const half = f.size * 0.78 * 0.62;
        const g0 = mothGap(f, 0, 0, 2);
        const g1 = mothGap(f, 2, 1, 2);
        if (g0 && g1) expect(g1[0] - g0[1], `${w}×${h}, Plätze ${set}`).toBeGreaterThanOrEqual(half * 2 - 1e-6);
        // Über die Zeit: nie übereinander (gleiche Blütenhöhe, andere Bahn – oder höher).
        for (let t = 0; t < 12; t += 0.37) {
          const a = mothPose({ ...f, time: t }, 0, 11, g0, undefined, 0);
          const b = mothPose({ ...f, time: t }, 2, 22, g1, undefined, 1);
          const apart = Math.abs(a.x - b.x) >= half * 2 - 1e-6 || Math.abs(a.y - b.y) >= f.size * 0.5;
          expect(apart, `${w}×${h}, Plätze ${set}, t=${t.toFixed(2)}`).toBe(true);
        }
      }
    }
  });

  it('zwei Rotten laufen in getrennten Lücken oder Bahnen', () => {
    for (const [w, h] of SIZES) {
      for (const set of EDGE_SETS) {
        const f = frameFor(w, h, set, 0);
        const half = f.size * 1.05 * 0.82;
        const r0 = boarRoute(f, 0, 0, 2);
        const r1 = boarRoute(f, 1, 1, 2);
        if (!r0 || !r1) continue;
        const [a0, b0] = [r0.a - half, r0.a + r0.range + half];
        const [a1, b1] = [r1.a - half, r1.a + r1.range + half];
        expect(b0 <= a1 + 1e-6 || b1 <= a0 + 1e-6, `${w}×${h}, Plätze ${set}`).toBe(true);
      }
    }
  });

  it('Seidenschwänze halten Abstand zu Tieren in der Krone und zwischen den Trupps', () => {
    const layout = makeLayout(1200, 700);
    const anchors = createAnchorResolver(layout, 6.5, placeMainTree(layout, 6.5));
    const S = anchors.size;
    const taken: number[] = [];
    for (let slot = 0; slot < 4; slot++) {
      const a = anchors.get('crown', slot)!;
      taken.push(a.x, a.y);
    }
    const lane0 = waxwingPerches(anchors, taken, 6, 0, 2);
    const lane1 = waxwingPerches(anchors, taken, 6, 1, 2);
    expect(lane0.length).toBeGreaterThan(0);
    expect(lane1.length).toBeGreaterThan(0);
    const all = [...lane0, ...lane1];
    for (let i = 0; i < all.length; i += 2) {
      for (let k = 0; k < taken.length; k += 2) {
        expect(Math.hypot(all[i]! - taken[k]!, all[i + 1]! - taken[k + 1]!)).toBeGreaterThanOrEqual(S * WAXWING_CLEARANCE - 1e-6);
      }
      for (let j = i + 2; j < all.length; j += 2) {
        expect(Math.hypot(all[i]! - all[j]!, all[i + 1]! - all[j + 1]!)).toBeGreaterThanOrEqual(S * 0.6 - 1e-6);
      }
    }
    // Allein: dieselbe Wahl wie die erste Bahn ohne zweiten Trupp, nur mehr Plätze.
    expect(waxwingPerches(anchors, taken, 6).length).toBe(12);
  });

  it('verwendet Posen wieder (keine neuen Objekte pro Frame)', () => {
    const f = frameFor(1200, 700, [1], 3);
    const route = boarRoute(f, 0);
    const out: ReturnType<typeof boarPoses> = [];
    const a = boarPoses(f, 0, 7, route, out);
    const first = a[0];
    const b = boarPoses({ ...f, time: 3.5 }, 0, 7, route, out);
    expect(b).toBe(out);
    expect(b).toContain(first);
    const pose = mothPose(f, 0, 3, null);
    expect(mothPose({ ...f, time: 4 }, 0, 3, null, pose)).toBe(pose);
    const flight: ReturnType<typeof swallowPoses> = [];
    expect(swallowPoses(f, 1, flight)).toBe(flight);
  });

  it('zählt den Sprite-Cache nur in beginFrame weiter', () => {
    const layer = new VisitorLayer();
    const tick = vi.spyOn(layer.sprites, 'tick');
    const canvas = makeCanvas(800, 600);
    const f = { ...frameFor(1200, 700, [], 2), height: 700, dpr: 1, sx: 1, sy: 1, windSkew: 0, anchors: null, crownX: 0, crownY: 0, crownRx: 0, crownRy: 0, crownTaken: [] };
    const visitors = ALL_GUESTS.map((id, slot) => ({ id, slot }));
    layer.beginFrame(f.size, f.dpr);
    for (const depth of ['sky', 'meadow', 'front'] as const) layer.draw(canvas.getContext('2d'), visitors, depth, f);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('die Rotte blendet bei geänderter Belegung aus und wieder ein, statt zu springen', () => {
    // Stub, der auch die Deckkraft protokolliert.
    const alphas: number[] = [];
    const calls: { x: number; alpha: number }[] = [];
    let alpha = 1;
    let lastX = 0;
    const ctx = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'globalAlpha') return alpha;
          return (...args: unknown[]) => {
            if (prop === 'setTransform') lastX = args[4] as number;
            if (prop === 'drawImage') calls.push({ x: lastX, alpha });
          };
        },
        set(_t, prop, value) {
          if (prop === 'globalAlpha') {
            alpha = value as number;
            alphas.push(alpha);
          }
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const layer = new VisitorLayer();
    const base = { ...frameFor(1200, 700, [], 0), height: 700, dpr: 1, sx: 1, sy: 1, windSkew: 0, anchors: null, crownX: 0, crownY: 0, crownRx: 0, crownRy: 0, crownTaken: [] };
    const blockedA = frameFor(1200, 700, [], 0).blocked;
    const blockedB = frameFor(1200, 700, [0, 1, 2], 0).blocked;
    const visitors = [{ id: 'boars', slot: 0 }];
    const frame = (time: number, blocked: readonly number[]) => {
      calls.length = 0;
      layer.draw(ctx, visitors, 'meadow', { ...base, time, blocked });
      return calls.slice();
    };
    const before = frame(1, blockedA);
    expect(before.every((c) => c.alpha === 1)).toBe(true);
    // Belegung ändert sich: zuerst die alte Stelle, blasser werdend …
    const out1 = frame(1.1, blockedB);
    expect(out1.length).toBeGreaterThan(0);
    expect(out1[0]!.alpha).toBeLessThan(1);
    const out2 = frame(1.4, blockedB);
    expect(out2[0]!.alpha).toBeLessThan(out1[0]!.alpha);
    // … dann die neue Stelle, kräftiger werdend, und schließlich voll.
    const in1 = frame(1.7, blockedB);
    const in2 = frame(2.0, blockedB);
    expect(in2[0]!.alpha).toBeGreaterThan(in1[0]!.alpha);
    // Ausgeblendet an der alten, eingeblendet an der neuen Stelle (kein Sprung im Sichtbaren).
    expect(in1[0]!.x).not.toBeCloseTo(out2[0]!.x, 0);
    const done = frame(2.4, blockedB);
    expect(done.every((c) => c.alpha === 1)).toBe(true);
    // Bei weniger Bewegung: sofort an der neuen Stelle (kein Überblenden).
    const reduced = new VisitorLayer();
    reduced.draw(ctx, visitors, 'meadow', { ...base, time: 1, blocked: blockedA, reducedMotion: true });
    calls.length = 0;
    reduced.draw(ctx, visitors, 'meadow', { ...base, time: 1.1, blocked: blockedB, reducedMotion: true });
    expect(calls.every((c) => c.alpha === 1)).toBe(true);
  });
});
