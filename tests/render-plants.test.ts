import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANTS, SPECIES } from '../scripts/v2/content';
import { animalSize, createAnchorResolver } from '../src/render/anchors';
import { animalKind, animalKinds, animalRarity, SpriteCache } from '../src/render/animals';
import { layoutFlora, nudge, plantKind, PLANT_SPECIES, trunkBaseHalf, type PlacedPlant, type ScenePlant } from '../src/render/flora';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { drawScene } from '../src/render/tree';

const SIZES: [number, number][] = [
  [1200, 700],
  [390, 844],
  [320, 480],
  [1920, 1080],
  [800, 600],
];
const GROWTHS = [1, 2, 2.5, 3, 3.5, 4.5, 5.5, 6.5, 7.6, 8];

/** Alle 14 Pflanzen aus scripts/v2/content.ts, Plätze 0..13 im Ring. */
const ALL_PLANTS: ScenePlant[] = PLANTS.map((p, slot) => ({ id: p.id, group: p.group, slot, vigor: 1 - (slot % 4) * 0.2 }));

/** Kanonische Gruppen-ID für die Tests (Bäume liegen hinten, alles andere am Boden). */
function isTree(p: PlacedPlant): boolean {
  return p.group === 'trees';
}

/** Halbe Stammbreite eines Begleitbaums am Fuß (px). */
function treeTrunkHalf(p: PlacedPlant): number {
  const t = p.tree!;
  return (t.geo.branches[0]!.w1 * t.scale) / 2;
}

describe('Begleitpflanzen: Zeichnungen', () => {
  it('haben für jede Pflanze aus scripts/v2/content.ts eine eigene Zeichnung', () => {
    for (const p of PLANTS) {
      expect(plantKind({ id: p.id, group: p.group }), p.id).toBe(p.id);
      expect(PLANT_SPECIES[p.id], p.id).toBe(p.group);
    }
    expect(Object.keys(PLANT_SPECIES).sort()).toEqual(PLANTS.map((p) => p.id).sort());
  });

  it('nutzen für unbekannte IDs den Ersatz der Gruppe', () => {
    expect(plantKind({ id: 'oak', group: 'trees' })).toBe('tree');
    expect(plantKind({ id: 'blackthorn', group: 'shrubs' })).toBe('shrub');
    expect(plantKind({ id: 'daisy', group: 'flowers' })).toBe('flower');
    expect(plantKind({ id: 'peatmoss', group: 'mosses' })).toBe('moss');
    // 'herbs' gilt als Blumen & Kräuter; unbekannte Gruppen werden nicht gezeichnet.
    expect(plantKind({ id: 'thyme', group: 'herbs' as ScenePlant['group'] })).toBe('flower');
    expect(plantKind({ id: 'kelp', group: 'ocean' as ScenePlant['group'] })).toBeNull();
    // Bekannte ID in fremder Gruppe: Ersatz der angegebenen Gruppe (Lage und Bild passen zusammen).
    expect(plantKind({ id: 'birch', group: 'mosses' })).toBe('moss');
  });
});

describe('Begleitpflanzen: Lage', () => {
  it('ist deterministisch', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      for (const g of [3, 5.5, 7.6]) {
        expect(layoutFlora(layout, g, ALL_PLANTS)).toEqual(layoutFlora(layout, g, ALL_PLANTS));
      }
    }
  });

  it('hängt nicht von der Reihenfolge der Liste ab', () => {
    const layout = makeLayout(1200, 700);
    const a = layoutFlora(layout, 6, ALL_PLANTS);
    const b = layoutFlora(layout, 6, [...ALL_PLANTS].reverse());
    const key = (p: PlacedPlant) => `${p.id}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.h.toFixed(3)}`;
    expect(b.map(key).sort()).toEqual(a.map(key).sort());
  });

  it('liegt immer im Canvas (mindestens zur Hälfte sichtbar)', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      for (const g of GROWTHS) {
        const flora = layoutFlora(layout, g, ALL_PLANTS);
        expect(flora.length).toBe(ALL_PLANTS.length);
        for (const p of flora) {
          const msg = `${p.id} bei g=${g}, ${w}×${h}`;
          for (const v of [p.x, p.y, p.hw, p.h]) expect(Number.isFinite(v), msg).toBe(true);
          expect(p.x, msg).toBeGreaterThanOrEqual(0);
          expect(p.x, msg).toBeLessThanOrEqual(w);
          expect(p.y, msg).toBeGreaterThan(layout.top);
          expect(p.y, msg).toBeLessThan(h);
          const visible = Math.min(w, p.x + p.hw) - Math.max(0, p.x - p.hw);
          expect(visible / (2 * p.hw), msg).toBeGreaterThanOrEqual(0.5);
          expect(p.y - p.h, msg).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('überdeckt nie den Stamm des Hauptbaums', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      for (const g of GROWTHS) {
        const main = placeMainTree(layout, g);
        const tb = trunkBaseHalf(g, main, layout);
        for (const p of layoutFlora(layout, g, ALL_PLANTS)) {
          const half = isTree(p) ? treeTrunkHalf(p) : p.hw;
          expect(Math.abs(p.x - layout.cx) - half - tb, `${p.id} bei g=${g}, ${w}×${h}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('lässt die Tierplätze am Boden frei', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      const S = animalSize(w, h);
      for (const g of GROWTHS) {
        const anchors = createAnchorResolver(layout, g, placeMainTree(layout, g));
        const spots: number[] = [];
        for (let s = 0; s < 4; s++) {
          spots.push(anchors.get('litter', s)!.x, anchors.get('edge', s)!.x, anchors.get('roots', s)!.surfaceX);
        }
        for (const p of layoutFlora(layout, g, ALL_PLANTS)) {
          // Niedrige Pflanzen: Mitte nicht auf einem Tierplatz; Bäume: Stamm daneben.
          const clear = isTree(p) ? treeTrunkHalf(p) + S * 0.3 : S * 0.5;
          for (const x of spots) {
            expect(Math.abs(p.x - x), `${p.id} bei g=${g}, ${w}×${h}, Platz x=${x.toFixed(1)}`).toBeGreaterThanOrEqual(clear - 0.05);
          }
        }
      }
    }
  });

  it('stellt Bäume hinter die übrigen Pflanzen und ordnet nach Gruppen', () => {
    const flora = layoutFlora(makeLayout(1200, 700), 7, ALL_PLANTS);
    const groups = flora.map((p) => p.group);
    const firstLow = groups.findIndex((g) => g !== 'trees');
    expect(groups.slice(0, firstLow).every((g) => g === 'trees')).toBe(true);
    expect(groups.slice(firstLow).every((g) => g !== 'trees')).toBe(true);
    // Hintere Bäume zuerst und blasser.
    const trees = flora.filter(isTree);
    for (let i = 1; i < trees.length; i++) expect(trees[i]!.depth).toBeLessThanOrEqual(trees[i - 1]!.depth);
    for (const t of trees) expect(t.haze).toBeGreaterThan(0);
  });

  it('verteilt die Bäume auf beide Seiten, auch wenn ihre Ringplätze alle ungerade sind', () => {
    const layout = makeLayout(1200, 700);
    const trees: ScenePlant[] = [
      { id: 'birch', group: 'trees', slot: 3, vigor: 1 },
      { id: 'beech', group: 'trees', slot: 7, vigor: 1 },
    ];
    const [a, b] = layoutFlora(layout, 7, trees).sort((p, q) => p.slot - q.slot);
    expect(Math.sign(a!.x - layout.cx)).not.toBe(Math.sign(b!.x - layout.cx));
  });

  it('wächst mit dem Hauptbaum und welkt bei schlechter Versorgung', () => {
    const layout = makeLayout(1200, 700);
    const one = (g: number, vigor: number, id: string, group: ScenePlant['group']) =>
      layoutFlora(layout, g, [{ id, group, slot: 0, vigor }])[0]!;
    for (const [id, group] of [
      ['hazel', 'shrubs'],
      ['foxglove', 'flowers'],
      ['birch', 'trees'],
    ] as const) {
      expect(one(5, 1, id, group).h).toBeGreaterThan(one(3, 1, id, group).h);
      expect(one(5, 0.1, id, group).h).toBeLessThan(one(5, 1, id, group).h);
    }
  });

  it('wächst stufenlos: Lage und Größe ändern sich bei kleinen Schritten nur wenig', () => {
    // Volle Belegung des Pflanzrings (12 Plätze, scripts/v2/content.ts PLANT_SLOTS).
    const ring = ALL_PLANTS.slice(0, 12);
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
      [320, 480],
    ] as const) {
      const layout = makeLayout(w, h);
      let prev = layoutFlora(layout, 1.5, ring);
      for (let g = 1.52; g <= 8; g += 0.02) {
        const cur = layoutFlora(layout, g, ring);
        for (let i = 0; i < cur.length; i++) {
          const msg = `${cur[i]!.id} bei g=${g.toFixed(2)}, ${w}×${h}`;
          expect(Math.abs(cur[i]!.x - prev[i]!.x), msg).toBeLessThan(3);
          expect(Math.abs(cur[i]!.h - prev[i]!.h), msg).toBeLessThan(3);
        }
        prev = cur;
      }
    }
  });

  it('ignoriert ungültige Einträge', () => {
    const layout = makeLayout(800, 600);
    const flora = layoutFlora(layout, 5, [
      { id: 'birch', group: 'trees', slot: Number.NaN, vigor: 1 },
      { id: 'fern', group: 'mosses', slot: -1, vigor: 1 },
      { id: 'kelp', group: 'ocean' as ScenePlant['group'], slot: 0, vigor: 1 },
      { id: 'mystery', group: 'flowers', slot: 2, vigor: Number.NaN },
    ]);
    expect(flora.map((p) => p.kind)).toEqual(['flower']);
    expect(flora[0]!.vigor).toBe(1);
    expect(layoutFlora(layout, 5, [])).toEqual([]);
  });
});

describe('nudge', () => {
  it('lässt freie Stellen unverändert und schiebt sonst zum nächsten Rand', () => {
    expect(nudge(5, [[10, 20]], 0, 100)).toBe(5);
    expect(nudge(12, [[10, 20]], 0, 100)).toBeCloseTo(10, 1);
    expect(nudge(62, [[60, 70]], 0, 100)).toBeCloseTo(70, 1);
    expect(nudge(18, [[10, 20]], 0, 100)).toBeCloseTo(10, 1);
    expect(nudge(18, [[10, 20], [-5, 10]], 0, 100)).toBeCloseTo(20, 1);
    // Ohne freien Platz: strikt NaN, sonst größter Abstand.
    expect(nudge(5, [[-1, 101]], 0, 100, true)).toBeNaN();
    expect(Number.isFinite(nudge(5, [[-1, 101]], 0, 100))).toBe(true);
    // Fast berührende Sperrbereiche gelten als ein Bereich.
    expect(nudge(25, [[10, 20], [21, 30]], 0, 100)).toBeCloseTo(10, 1);
  });
});

describe('Tierarten', () => {
  it('haben für alle Arten aus scripts/v2/content.ts eine eigene Zeichnung', () => {
    const kinds = new Set(animalKinds());
    const fallback = new Set(['bird', 'insect', 'mammal', 'mushroom', 'bracket']);
    for (const s of SPECIES) {
      const kind = animalKind({ id: s.id, family: s.genus, niche: s.niche });
      expect(kind, s.id).toBe(s.id);
      expect(kinds.has(kind), s.id).toBe(true);
      expect(fallback.has(kind), s.id).toBe(false);
    }
  });

  it('schimmern ab Seltenheit „besonders“ (Vorgabe aus dem Katalog oder aus `rarity`)', () => {
    for (const s of SPECIES) {
      expect(animalRarity({ id: s.id }) >= 2, s.id).toBe(s.rarity >= 2);
    }
    expect(animalRarity({ id: 'robin', rarity: 3 })).toBe(3);
    expect(animalRarity({ id: 'wolf', rarity: 0 })).toBe(0);
    expect(animalRarity({ id: 'x', rarity: Number.NaN })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Szene mit Canvas-Stub
// ---------------------------------------------------------------------------

interface StubCanvas {
  width: number;
  height: number;
  calls: string[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

const created: StubCanvas[] = [];

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, calls: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop() {}, data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return () => {
        canvas.calls.push(String(prop));
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
  created.length = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      const c = makeCanvas();
      created.push(c);
      return c;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawScene mit Pflanzen', () => {
  const total = () => created.reduce((n, c) => n + c.calls.length, 0);

  it('zeichnet die Pflanzen-Ebene nur bei geänderter Liste neu', () => {
    const screen = makeCanvas(800, 600);
    const ctx = screen.getContext('2d');
    const plants = ALL_PLANTS.slice(0, 6);
    drawScene(ctx, 800, 600, { growth: 5, time: 1, plants });
    const afterFirst = total();
    expect(afterFirst).toBeGreaterThan(0);
    // Neues Array mit gleichem Inhalt → nichts wird neu gezeichnet.
    drawScene(ctx, 800, 600, { growth: 5, time: 1.02, plants: plants.map((p) => ({ ...p })) });
    expect(total()).toBe(afterFirst);
    // Andere Versorgung → neu.
    drawScene(ctx, 800, 600, { growth: 5, time: 1.04, plants: plants.map((p) => ({ ...p, vigor: 0.2 })) });
    expect(total()).toBeGreaterThan(afterFirst);
  });

  it('kommt mit leerer Liste, unbekannten IDs und ohne Liste zurecht', () => {
    const screen = makeCanvas(390, 844);
    const ctx = screen.getContext('2d');
    expect(() => {
      drawScene(ctx, 390, 844, { growth: 6, time: 1 });
      drawScene(ctx, 390, 844, { growth: 6, time: 2, plants: [] });
      drawScene(ctx, 390, 844, {
        growth: 6,
        time: 3,
        plants: [
          { id: 'oak', group: 'trees', slot: 0, vigor: 0.5 },
          { id: 'thyme', group: 'flowers', slot: 1, vigor: 0 },
          { id: 'x', group: 'ocean' as ScenePlant['group'], slot: 2, vigor: 1 },
        ],
      });
      drawScene(ctx, 390, 844, { growth: 6, time: 4 });
    }).not.toThrow();
  });

  it('zeichnet alle Arten ohne Fehler (Sprites und Schimmer)', () => {
    const cache = new SpriteCache();
    for (const kind of [...animalKinds(), 'shimmer', 'sparkle']) {
      expect(() => cache.get(kind, 0, false, 30, 2)).not.toThrow();
      expect(() => cache.get(kind, 1, true, 30, 2)).not.toThrow();
    }
  });
});
