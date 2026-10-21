import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANTS, SPECIES } from '../scripts/v2/content';
import { animalSize, createAnchorResolver } from '../src/render/anchors';
import { AnimalLayer, animalKind, animalKinds, animalRarity, SpriteCache, type AnimalFrame, type SceneAnimal } from '../src/render/animals';
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
    // Vergleich über eine kompakte Zusammenfassung (Lage, Größe, Baumgeometrie) statt
    // eines tiefen Vergleichs tausender Aststücke – gleiche Aussage, viel schneller.
    const summary = (list: PlacedPlant[]) =>
      list.map((p) => {
        const t = p.tree;
        const geo = t ? [t.scale, t.x, t.y, t.geo.segments.length, t.geo.leaves.length, t.geo.minX, t.geo.maxX, t.geo.minY] : null;
        return [p.index, p.kind, p.x, p.y, p.hw, p.h, p.depth, p.haze, p.vigor, p.grow, p.seed, geo];
      });
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      for (const g of [3, 5.5, 7.6]) {
        expect(summary(layoutFlora(layout, g, ALL_PLANTS))).toEqual(summary(layoutFlora(layout, g, ALL_PLANTS)));
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
        /** Waldsaum-Plätze der hinteren Reihe (schmale Bildschirme): liegen hinter Moosen am Stammfuß. */
        const backSpots: number[] = [];
        for (let s = 0; s < 4; s++) {
          const edge = anchors.get('edge', s)!;
          spots.push(anchors.get('litter', s)!.x, anchors.get('roots', s)!.surfaceX);
          (edge.depth === 1 ? backSpots : spots).push(edge.x);
        }
        for (const p of layoutFlora(layout, g, ALL_PLANTS)) {
          // Niedrige Pflanzen: Mitte nicht auf einem Tierplatz; Bäume: Stamm daneben.
          const clear = isTree(p) ? treeTrunkHalf(p) + S * 0.3 : S * 0.5;
          for (const x of p.group === 'mosses' ? spots : [...spots, ...backSpots]) {
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

  it('wächst stufenlos: Lage und Größe ändern sich bei kleinen Schritten nur wenig', { timeout: 15000 }, () => {
    // Volle Belegung des Pflanzrings (12 Plätze, scripts/v2/content.ts PLANT_SLOTS).
    const ring = ALL_PLANTS.slice(0, 12);
    const worst = { x: { d: 0, at: '' }, h: { d: 0, at: '' } };
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
      [320, 480],
    ] as const) {
      const layout = makeLayout(w, h);
      let prev = layoutFlora(layout, 1.5, ring);
      for (let g = 1.52; g <= 8; g += 0.02) {
        const cur = layoutFlora(layout, g, ring);
        expect(cur.length).toBe(prev.length);
        for (let i = 0; i < cur.length; i++) {
          const at = `${cur[i]!.id} bei g=${g.toFixed(2)}, ${w}×${h}`;
          const dx = Math.abs(cur[i]!.x - prev[i]!.x);
          const dh = Math.abs(cur[i]!.h - prev[i]!.h);
          if (!(dx <= worst.x.d)) worst.x = { d: dx, at };
          if (!(dh <= worst.h.d)) worst.h = { d: dh, at };
        }
        prev = cur;
      }
    }
    // Ein `expect` je Größe am Ende statt zehntausender (schneller, gleiche Aussage).
    expect(worst.x.d, `Lage: ${worst.x.at}`).toBeLessThan(3);
    expect(worst.h.d, `Größe: ${worst.h.at}`).toBeLessThan(3);
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

  it('zeichnet bei ungültigen Werten (NaN) nicht jeden Frame neu', () => {
    const screen = makeCanvas(800, 600);
    const ctx = screen.getContext('2d');
    const weird = (): ScenePlant[] => [
      { id: 'birch', group: 'trees', slot: Number.NaN, vigor: Number.NaN },
      { id: 'fern', group: 'mosses', slot: 1, vigor: Number.NaN },
      { id: 'hazel', group: 'shrubs', slot: Infinity, vigor: 0.7 },
    ];
    drawScene(ctx, 800, 600, { growth: 5, time: 1, plants: weird() });
    const afterFirst = total();
    for (let i = 1; i <= 5; i++) drawScene(ctx, 800, 600, { growth: 5, time: 1 + i * 0.02, plants: weird() });
    expect(total()).toBe(afterFirst);
  });

  it('reagiert auf die Versorgung mit Hysterese (kein Flackern an Stufengrenzen)', () => {
    const screen = makeCanvas(800, 600);
    const ctx = screen.getContext('2d');
    const at = (vigor: number): ScenePlant[] => [{ id: 'hazel', group: 'shrubs', slot: 0, vigor }];
    drawScene(ctx, 800, 600, { growth: 5, time: 1, plants: at(0.5) });
    const base = total();
    // Hin und her um eine frühere 5-%-Grenze (0,525): kein Neuzeichnen.
    for (let i = 0; i < 6; i++) drawScene(ctx, 800, 600, { growth: 5, time: 1.02 + i * 0.02, plants: at(i % 2 ? 0.524 : 0.526) });
    expect(total()).toBe(base);
    // Deutliche Änderung: neu.
    drawScene(ctx, 800, 600, { growth: 5, time: 2, plants: at(0.56) });
    expect(total()).toBeGreaterThan(base);
  });

  it('zeichnet die Pflanzen beim Nachziehen nur bei merklicher Wachstumsänderung neu', () => {
    const screen = makeCanvas(800, 600);
    const ctx = screen.getContext('2d');
    const plants = ALL_PLANTS.slice(0, 4);
    drawScene(ctx, 800, 600, { growth: 5, time: 1, plants });
    // Die Pflanzen-Ebene ist die zuletzt angelegte Zeichenfläche (ohne Tiere keine Sprites).
    const plantLayer = created[created.length - 1]!;
    const before = plantLayer.calls.length;
    // Winzige Änderung (< 0,002): Hauptbaum zieht nach, die Pflanzen nicht.
    drawScene(ctx, 800, 600, { growth: 5.001, time: 3, plants });
    expect(plantLayer.calls.length).toBe(before);
    // Merkliche Änderung beim Nachziehen: Pflanzen neu.
    drawScene(ctx, 800, 600, { growth: 5.004, time: 5, plants });
    expect(plantLayer.calls.length).toBeGreaterThan(before);
  });

  it('baut den Tier-Plan bei ungültigen Werten (NaN) nicht jeden Frame neu', () => {
    const layout = makeLayout(800, 600);
    const anchors = createAnchorResolver(layout, 5, placeMainTree(layout, 5));
    const layer = new AnimalLayer();
    const ctx = makeCanvas(800, 600).getContext('2d');
    const f: AnimalFrame = { time: 1, windSkew: 0, reducedMotion: false, dpr: 1, sx: 1, sy: 1 };
    const animals = (): SceneAnimal[] => [
      { id: 'wolf', family: 'mammals', niche: 'edge', slot: 0, happiness: 0.9, rarity: Number.NaN },
      { id: 'owl', family: 'birds', niche: 'hollows', slot: Number.NaN, happiness: 0.9 },
      { id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 0.9, rarity: 2.4 },
    ];
    for (let i = 0; i < 5; i++) layer.draw(ctx, animals(), anchors, { ...f, time: 1 + i });
    expect(layer.builds).toBe(1);
    // Echte Änderung der Seltenheit → Neubau.
    layer.draw(ctx, animals().map((a) => ({ ...a, rarity: 3 })), anchors, f);
    expect(layer.builds).toBe(2);
  });

  it('verwirft bei vollem Sprite-Cache zuerst unbenutzte Sprites', () => {
    const cache = new SpriteCache();
    const keep = cache.get('owl', 0, false, 30, 1);
    for (let px = 4; px < 2000; px++) {
      cache.tick();
      // Die Eule wird in jedem Frame gebraucht, die übrigen Größen nur einmal.
      expect(cache.get('owl', 0, false, 30, 1)).toBe(keep);
      cache.get('insect', 0, false, px, 1);
      expect(cache.count).toBeLessThanOrEqual(400);
    }
  });

  it('zeigt bei negativer Zeit nur gültige Bewegungsbilder', () => {
    const layout = makeLayout(800, 600);
    const anchors = createAnchorResolver(layout, 5, placeMainTree(layout, 5));
    const layer = new AnimalLayer();
    const ctx = makeCanvas(800, 600).getContext('2d');
    const all: SceneAnimal[] = [
      { id: 'owl', family: 'birds', niche: 'hollows', slot: 0, happiness: 1 },
      { id: 'woodant', family: 'insects', niche: 'litter', slot: 0, happiness: 1 },
      { id: 'stagbeetle', family: 'insects', niche: 'hollows', slot: 1, happiness: 1 },
      { id: 'bee', family: 'insects', niche: 'edge', slot: 0, happiness: 1 },
      { id: 'salamander', family: 'soil', niche: 'litter', slot: 1, happiness: 1 },
    ];
    const frames: number[] = [];
    const spy = vi.spyOn(SpriteCache.prototype, 'get').mockImplementation(function (this: SpriteCache, _k, frame) {
      frames.push(frame);
      return { canvas: makeCanvas() as unknown as HTMLCanvasElement, ox: 0, oy: 0, w: 1, h: 1, used: 0 };
    });
    for (const t of [-0.37, -1.5, -3.21, -10.05, -123.4]) {
      layer.draw(ctx, all, anchors, { time: t, windSkew: 0, reducedMotion: false, dpr: 1, sx: 1, sy: 1 });
    }
    spy.mockRestore();
    expect(frames.length).toBeGreaterThan(0);
    for (const fr of frames) expect(fr === 0 || fr === 1, `Frame ${fr}`).toBe(true);
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
