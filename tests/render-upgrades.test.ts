import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout, placeMainTree, trunkFootHalf } from '../src/render/layout';
import { drawScene, sceneCacheStats, type SceneInput } from '../src/render/tree';
import {
  crownLimits,
  MAX_MUSHROOMS,
  mushroomSpots,
  nicheDetailTier,
  sceneUpgradesFromLevels,
  treeUpgradeSteps,
  upgradeLook,
  upgradeMainTree,
  upgradesKey,
  upgradesParam,
  type SceneUpgrades,
} from '../src/render/upgrades';

/**
 * Canvas-Stub: protokolliert jeden Kontextaufruf und jede gesetzte Eigenschaft (Farben,
 * Linienbreiten) – so lässt sich „gleiches Bild“ als „gleiche Aufrufe“ prüfen.
 */
interface StubCanvas {
  width: number;
  height: number;
  calls: unknown[][];
  getContext: (type: string) => CanvasRenderingContext2D;
}

let created: StubCanvas[] = [];

/** Objekte (Canvas, Verläufe) als vergleichbare Werte: Canvas → Index, sonst Platzhalter. */
function plain(a: unknown): unknown {
  if (typeof a !== 'object' || a === null) return a;
  const i = created.indexOf(a as StubCanvas);
  return i >= 0 ? `canvas#${i}` : 'object';
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
        canvas.calls.push([String(prop), ...args.map(plain)]);
        return helper;
      };
    },
    set(target, prop, value) {
      canvas.calls.push(['=' + String(prop), plain(value)]);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  created.push(canvas);
  return canvas;
}

beforeEach(() => {
  created = [];
  vi.stubGlobal('document', { createElement: () => makeCanvas() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ausbau: Schritte und Parser', () => {
  it('rechnet Stufen in Schritte (je 10) und Nischen-Details (25/50) um', () => {
    expect([0, 9, 10, 19, 20, 109].map(treeUpgradeSteps)).toEqual([0, 0, 1, 1, 2, 10]);
    expect([-5, Number.NaN, Infinity].map(treeUpgradeSteps)).toEqual([0, 0, 0]);
    expect([0, 24, 25, 49, 50, 99].map(nicheDetailTier)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(nicheDetailTier(Number.NaN)).toBe(0);
  });

  it('liest den Demo-Parameter (Stufen → Schritte)', () => {
    expect(upgradesParam('rings:30,leaves:20,mycorrhiza:10')).toEqual({ rings: 3, leaves: 2, mycorrhiza: 1 });
    expect(upgradesParam('rings:35, roots:25,crown:50,edge:24')).toEqual({ rings: 3, niches: { roots: 1, crown: 2, edge: 0 } });
  });

  it('übergeht Unbekanntes und Ungültiges; ohne gültigen Eintrag wie ohne Ausbau', () => {
    expect(upgradesParam(null)).toBeUndefined();
    expect(upgradesParam('')).toBeUndefined();
    expect(upgradesParam('foo:30,rings:abc,leaves:-10,mycorrhiza:')).toBeUndefined();
    expect(upgradesParam('foo:30,leaves:40')).toEqual({ leaves: 4 });
  });

  it('Schlüssel: 0 ohne Ausbau, begrenzt, gleiche Schritte → gleicher Schlüssel', () => {
    expect(upgradesKey(undefined)).toBe(0);
    expect(upgradesKey({})).toBe(0);
    expect(upgradesKey({ rings: 0, leaves: 0, mycorrhiza: 0, niches: { roots: 0 } })).toBe(0);
    expect(upgradeLook({ rings: 0 })).toBeNull();
    expect(upgradesKey({ rings: 15 })).toBe(upgradesKey({ rings: 10 }));
    expect(upgradesKey({ mycorrhiza: 9 })).toBe(upgradesKey({ mycorrhiza: MAX_MUSHROOMS }));
    expect(upgradesKey(sceneUpgradesFromLevels({ rings: 21 }))).toBe(upgradesKey(sceneUpgradesFromLevels({ rings: 29 })));
    const keys = new Set<number>();
    for (const u of [{ rings: 1 }, { leaves: 1 }, { mycorrhiza: 1 }, { niches: { roots: 1 } }, { niches: { crown: 1 } }, { niches: { edge: 1 } }, { rings: 10, leaves: 10 }] as SceneUpgrades[]) {
      keys.add(upgradesKey(u));
    }
    expect(keys.size).toBe(7);
    expect([...keys].every((k) => k > 0)).toBe(true);
  });
});

describe('Ausbau: Geometrie', () => {
  const layout = makeLayout(900, 600);
  const main = placeMainTree(layout, 6)!;

  it('ohne Baum-Ausbau derselbe Baum', () => {
    expect(upgradeMainTree(main, null, crownLimits(layout, main))).toBe(main);
    expect(upgradeMainTree(main, upgradeLook({ mycorrhiza: 3 }), crownLimits(layout, main))).toBe(main);
  });

  it('Jahresringe: Stamm +3 % je Schritt, höchstens +30 %; dünne Zweige kaum; Original bleibt', () => {
    const before = main.geo.segments[0]!.w1;
    const up = upgradeMainTree(main, upgradeLook({ rings: 10 }), crownLimits(layout, main));
    expect(up.geo.segments[0]!.w1).toBeCloseTo(before * 1.3, 9);
    expect(trunkFootHalf(6, up)).toBeCloseTo(trunkFootHalf(6, main) * 1.3, 9);
    const thin = main.geo.segments.findIndex((s) => s.w1 < before * 0.05);
    expect(thin).toBeGreaterThan(0);
    expect(up.geo.segments[thin]!.w1 / main.geo.segments[thin]!.w1).toBeLessThan(1.03);
    expect(main.geo.segments[0]!.w1).toBe(before);
    const five = upgradeMainTree(main, upgradeLook({ rings: 5 }), crownLimits(layout, main));
    expect(five.geo.segments[0]!.w1).toBeCloseTo(before * 1.15, 9);
  });

  it('Blattwerk: größere Krone, bleibt im Bild', () => {
    const limits = crownLimits(layout, main);
    const up = upgradeMainTree(main, upgradeLook({ leaves: 10 }), limits);
    const area = (g: typeof main.geo) => g.leaves.reduce((a, l) => a + l.r * l.r, 0);
    expect(area(up.geo)).toBeGreaterThan(area(main.geo) * 1.2);
    expect(-up.geo.minY).toBeLessThanOrEqual(Math.max(limits.up, -main.geo.minY) + 1e-9);
    expect(Math.max(-up.geo.minX, up.geo.maxX)).toBeLessThanOrEqual(Math.max(limits.half, -main.geo.minX, main.geo.maxX) + 1e-9);
    expect(up.geo.leaves.length).toBe(main.geo.leaves.length);
  });

  it('Pilzhüte: einer je Schritt, höchstens 6, stabil (Seed)', () => {
    expect(mushroomSpots(3, 450, 480, 20, layout)).toHaveLength(3);
    expect(mushroomSpots(40, 450, 480, 20, layout)).toHaveLength(MAX_MUSHROOMS);
    expect(mushroomSpots(4, 450, 480, 20, layout)).toEqual(mushroomSpots(4, 450, 480, 20, layout));
    // Neue Hüte verschieben die vorhandenen nicht.
    expect(mushroomSpots(4, 450, 480, 20, layout).slice(0, 3)).toEqual(mushroomSpots(3, 450, 480, 20, layout));
    // Keiner steht im Stamm.
    for (const m of mushroomSpots(6, 450, 480, 20, layout)) expect(Math.abs(m.x - 450)).toBeGreaterThan(20);
  });
});

describe('Ausbau in drawScene (Canvas-Stub)', () => {
  function render(upgrades: SceneUpgrades | undefined, extra: Partial<SceneInput> = {}): unknown[][][] {
    created = [];
    const canvas = makeCanvas(600, 400);
    drawScene(canvas.getContext('2d'), 600, 400, { growth: 5.5, time: 1, upgrades, ...extra });
    return created.map((c) => c.calls);
  }

  it('Standardbild unverändert: ohne Angabe, leer oder alles 0 zeichnet exakt gleich', () => {
    const base = render(undefined);
    expect(render({})).toEqual(base);
    expect(render({ rings: 0, leaves: 0, mycorrhiza: 0, niches: { roots: 0, crown: 0, edge: 0 } })).toEqual(base);
    expect(render(upgradesParam('rings:9,leaves:5,roots:24'))).toEqual(base);
  });

  it('Ausbau ändert das Bild', () => {
    const base = render(undefined);
    for (const u of [{ rings: 1 }, { leaves: 1 }, { mycorrhiza: 1 }, { niches: { roots: 1 } }, { niches: { crown: 1 } }, { niches: { edge: 1 } }] as SceneUpgrades[]) {
      expect(render(u)).not.toEqual(base);
    }
  });

  it('gleiche Schritte → gleiches Bild (stabil)', () => {
    const u = { rings: 4, leaves: 6, mycorrhiza: 5, niches: { roots: 2, crown: 2, edge: 2 } };
    expect(render(u)).toEqual(render({ ...u, niches: { ...u.niches } }));
  });

  it('neu gezeichnet nur beim Schrittwechsel, nicht pro Frame', () => {
    const canvas = makeCanvas(600, 400);
    const ctx = canvas.getContext('2d');
    const frame = (time: number, upgrades: SceneUpgrades | undefined) => drawScene(ctx, 600, 400, { growth: 5.5, time, upgrades });
    frame(0, sceneUpgradesFromLevels({ rings: 20, leaves: 30, mycorrhiza: 10 }));
    const builds = () => sceneCacheStats(canvas as unknown as HTMLCanvasElement)!.layerBuilds;
    const first = builds();
    expect(first).toBe(1);
    // 120 Frames mit wechselnden Stufen innerhalb derselben Schritte: kein Neuaufbau.
    for (let i = 1; i <= 120; i++) frame(i / 60, sceneUpgradesFromLevels({ rings: 20 + (i % 10), leaves: 30 + (i % 7), mycorrhiza: 10 }));
    expect(builds()).toBe(first);
    // Ein Schritt mehr: genau ein Neuaufbau, danach wieder Ruhe.
    for (let i = 121; i <= 180; i++) frame(i / 60, sceneUpgradesFromLevels({ rings: 30, leaves: 30, mycorrhiza: 10 }));
    expect(builds()).toBe(first + 1);
    // Nischen-Detail ab 25: ebenfalls genau einmal.
    for (let i = 181; i <= 240; i++) frame(i / 60, sceneUpgradesFromLevels({ rings: 30, leaves: 30, mycorrhiza: 10, roots: 25 + (i % 5) }));
    expect(builds()).toBe(first + 2);
  });

  it('zeichnet in allen Jahreszeiten, Arten und Stufen ohne Fehler', () => {
    const u = { rings: 10, leaves: 10, mycorrhiza: 6, niches: { roots: 2, crown: 2, edge: 2 } };
    for (const growth of [0, 0.6, 1.2, 3, 8]) {
      for (const mainTree of ['oak', 'beech', 'pine', 'fir', 'alder'] as const) {
        for (const season of [undefined, 0, 2, 3]) {
          expect(() => render(u, { growth, mainTree, season })).not.toThrow();
        }
      }
    }
  });
});
