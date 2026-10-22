import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animalSize, edgeFootprint, nicheAnchors, SCENE_NICHES, trunkBaseHalf } from '../src/render/anchors';
import { trunkBaseHalf as floraTrunkBaseHalf } from '../src/render/flora';
import { makeLayout, placeMainTree, placeRoots } from '../src/render/layout';
import { buildTree, formAt, TREE_FORMS, TREE_SPECIES, trunkWidthOf, type TreeSpecies } from '../src/render/plant';
import { normalizeSpecies, speciesLeafAmount } from '../src/render/species';
import { seasonLook } from '../src/render/season';
import { drawScene, type SceneInput, type ScenePlant } from '../src/render/tree';

/** Canvas-Stub, der Aufrufe und gesetzte Werte protokolliert (auch in Offscreen-Ebenen). */
interface StubCanvas {
  width: number;
  height: number;
  calls: string[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

let created: StubCanvas[] = [];

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, calls: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop: (o: number, c: string) => canvas.calls.push(`stop(${o},${c})`), data: new Uint8ClampedArray(16) };
  const fmt = (a: unknown) => (typeof a === 'number' ? a.toFixed(3) : typeof a === 'string' ? a : typeof a);
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        canvas.calls.push(`${String(prop)}(${args.map(fmt).join(',')})`);
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      canvas.calls.push(`${String(prop)}=${fmt(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

beforeEach(() => {
  created = [];
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

const W = 800;
const H = 600;
const PLANTS: ScenePlant[] = [
  { id: 'beech', group: 'trees', slot: 0, vigor: 1 },
  { id: 'hazel', group: 'shrubs', slot: 1, vigor: 1 },
];

function play(extra: Partial<SceneInput>, growth = 6, times = [0, 0.4, 1]): string[] {
  created = [];
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (const t of times) drawScene(ctx, W, H, { growth, time: t, plants: PLANTS, ...extra });
  return [...canvas.calls, ...created.flatMap((c) => c.calls)];
}

describe('Hauptbaum-Arten: Eiche unverändert', () => {
  it('Geometrie der Eiche ist mit und ohne Wuchsform identisch', () => {
    for (const g of [1, 2.5, 5, 8]) expect(buildTree(g, 7, TREE_FORMS.oak)).toEqual(buildTree(g, 7));
  });

  it('ohne Feld, mit „oak“ und mit unbekannter Art: exakt dieselben Zeichenbefehle', () => {
    for (const growth of [0.5, 1.2, 6]) {
      const plain = play({}, growth);
      expect(play({ mainTree: 'oak' }, growth)).toEqual(plain);
      expect(play({ mainTree: 'maple' as TreeSpecies }, growth)).toEqual(plain);
    }
    expect(normalizeSpecies(undefined)).toBe('oak');
    expect(normalizeSpecies('pine')).toBe('pine');
    expect(normalizeSpecies('maple', 'beech')).toBe('beech');
  });

  it('Wuchsform der Eiche hängt nicht vom Alter ab', () => {
    for (const g of [1, 4, 8]) expect(formAt(TREE_FORMS.oak, g)).toBe(TREE_FORMS.oak);
  });

  it('Buche und Kiefer sehen anders aus – vom Samen bis zum alten Baum', { timeout: 30_000 }, () => {
    for (const growth of [0.5, 1.2, 4, 7.5]) {
      const oak = play({}, growth);
      expect(play({ mainTree: 'beech' }, growth), `Buche g=${growth}`).not.toEqual(oak);
      expect(play({ mainTree: 'pine' }, growth), `Kiefer g=${growth}`).not.toEqual(oak);
    }
  });
});

describe('Hauptbaum-Arten: Anker der Tiere', () => {
  const SIZES: [number, number][] = [
    [1200, 700],
    [390, 844],
  ];

  it('Krone: alle Plätze liegen im Laub; Stamm und Höhlen: am Stamm (alle Arten und Stufen)', () => {
    for (const species of TREE_SPECIES) {
      for (const [w, h] of SIZES) {
        const layout = makeLayout(w, h);
        const S = animalSize(w, h);
        for (const g of [3, 4, 5, 6, 7, 8]) {
          const main = placeMainTree(layout, g, species)!;
          const all = nicheAnchors(w, h, g, 4, species);
          // Laub als Rechteck um alle Blattbüschel (CSS-Pixel), etwas Spielraum.
          let x0 = Infinity;
          let x1 = -Infinity;
          let y0 = Infinity;
          let y1 = -Infinity;
          for (const l of main.geo.leaves) {
            const r = l.r * main.scale;
            x0 = Math.min(x0, main.x + l.x * main.scale - r);
            x1 = Math.max(x1, main.x + l.x * main.scale + r);
            y0 = Math.min(y0, main.y + l.y * main.scale - r);
            y1 = Math.max(y1, main.y + l.y * main.scale + r);
          }
          const pad = S * 0.3;
          const trunk = main.geo.branches[0]!;
          const trunkTopY = main.y + trunk.y2 * main.scale;
          for (const a of all.crown) {
            const msg = `${species} Krone ${a.slot} bei g=${g}, ${w}×${h}`;
            expect(a.x, msg).toBeGreaterThanOrEqual(x0 - pad);
            expect(a.x, msg).toBeLessThanOrEqual(x1 + pad);
            expect(a.y, msg).toBeGreaterThanOrEqual(y0 - pad);
            expect(a.y, msg).toBeLessThanOrEqual(y1 + pad);
            // Oberhalb des Stammfußes, im Bereich der Krone (nicht unten am Stamm).
            expect(a.y, msg).toBeLessThanOrEqual(trunkTopY + (layout.groundY - trunkTopY) * 0.35);
          }
          for (const a of [...all.bark, ...all.hollows]) {
            const msg = `${species} ${a.niche} ${a.slot} bei g=${g}, ${w}×${h}`;
            expect(Math.abs(a.x - a.trunkX), msg).toBeLessThanOrEqual(a.trunkHalf * 1.05 + 0.5);
            expect(a.y, msg).toBeLessThan(layout.groundY);
            expect(a.y, msg).toBeGreaterThanOrEqual(trunkTopY - 0.5);
          }
        }
      }
    }
  });
});

describe('Hauptbaum-Arten: Stammbreite', () => {
  it('Anker, Pflanzen und Wurzeln rechnen mit dem gezeichneten Stammfuß der Art', () => {
    for (const species of TREE_SPECIES) {
      for (const [w, h] of [
        [1200, 700],
        [390, 844],
      ] as const) {
        const layout = makeLayout(w, h);
        for (const g of [2.5, 5, 8]) {
          const main = placeMainTree(layout, g, species)!;
          // Erstes Segment = Stammfuß mit Verdickung, so wie es gezeichnet wird.
          const drawn = (main.geo.segments[0]!.w1 * main.scale) / 2;
          const msg = `${species} g=${g}, ${w}×${h}`;
          expect(trunkBaseHalf(g, main, layout), msg).toBeCloseTo(drawn, 6);
          expect(floraTrunkBaseHalf(g, main, layout), msg).toBeCloseTo(drawn, 6);
          const roots = placeRoots(layout, g, main);
          expect(roots.widthScale * roots.scale, msg).toBeCloseTo(trunkWidthOf(g) * TREE_FORMS[species].trunkWidth * main.scale * 0.8, 6);
        }
      }
    }
  });

  it('Kiefer hat einen schlanken Schaft (Desktop deutlich schmaler als die Eiche)', () => {
    const layout = makeLayout(1200, 700);
    const oak = trunkBaseHalf(8, placeMainTree(layout, 8, 'oak'), layout);
    const pine = trunkBaseHalf(8, placeMainTree(layout, 8, 'pine'), layout);
    expect(pine).toBeLessThan(oak * 0.75);
    expect(pine).toBeGreaterThan(oak * 0.4);
  });
});

describe('Hauptbaum-Arten: Waldsaum', () => {
  const SIZES: [number, number][] = [
    [1200, 700],
    [390, 844],
  ];

  it('Großtiere stehen bei keiner Art auf dem ausgewachsenen Stamm', () => {
    for (const [w, h] of SIZES) {
      const layout = makeLayout(w, h);
      const size = animalSize(w, h);
      for (const species of TREE_SPECIES) {
        const tb = trunkBaseHalf(8, placeMainTree(layout, 8, species), layout);
        for (const g of [2, 5, 8]) {
          for (const a of nicheAnchors(w, h, g, 4, species).edge) {
            const [x0, x1] = edgeFootprint(a, size);
            const gap = Math.max(x0 - (layout.cx + tb), layout.cx - tb - x1);
            expect(gap, `${species} Waldsaum ${a.slot} bei g=${g}, ${w}×${h}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('Waldsaum-Plätze springen beim Artwechsel nicht', () => {
    for (const [w, h] of [...SIZES, [320, 568] as [number, number], [800, 600] as [number, number]]) {
      const oak = nicheAnchors(w, h, 6, 4, 'oak').edge;
      for (const species of TREE_SPECIES) expect(nicheAnchors(w, h, 6, 4, species).edge, `${species} ${w}×${h}`).toEqual(oak);
    }
  });

  it('der Eichenstamm bleibt der breiteste – die Reihe der Eiche ist dieselbe wie vorher', () => {
    for (const [w, h] of [...SIZES, [320, 568], [360, 800], [600, 900], [800, 600], [1024, 768], [1920, 1080], [2400, 700]] as [number, number][]) {
      const layout = makeLayout(w, h);
      const oak = trunkBaseHalf(8, placeMainTree(layout, 8, 'oak'), layout);
      for (const species of TREE_SPECIES) {
        expect(trunkBaseHalf(8, placeMainTree(layout, 8, species), layout), `${species} ${w}×${h}`).toBeLessThanOrEqual(oak);
      }
    }
  });

  it('unbekannte Art in nicheAnchors gilt als Eiche', () => {
    expect(nicheAnchors(800, 600, 5, 4, 'maple' as TreeSpecies)).toEqual(nicheAnchors(800, 600, 5, 4));
  });
});

describe('Hauptbaum-Arten: Anker wachsen stetig', () => {
  it('höchstens 8 px je Δg = 0,05 für g von 1 bis 8 (abseits von g = 1), alle Arten', () => {
    const step = 0.05;
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
    ] as const) {
      for (const species of TREE_SPECIES) {
        let a = nicheAnchors(w, h, 1 + step, 4, species);
        for (let k = 2; k <= 140; k++) {
          const g = 1 + k * step;
          const b = nicheAnchors(w, h, g, 4, species);
          for (const niche of SCENE_NICHES) {
            for (let i = 0; i < 4; i++) {
              const d = Math.hypot(a[niche][i]!.x - b[niche][i]!.x, a[niche][i]!.y - b[niche][i]!.y);
              expect(d, `${species} ${niche} ${i} bei g=${(g - step).toFixed(2)}, ${w}×${h}`).toBeLessThanOrEqual(8);
            }
          }
          a = b;
        }
      }
    }
  });
});

describe('Hauptbaum-Arten: Jahreszeiten, Übergang, Leistung', () => {
  it('Zyklus-Übergang: unbekannte Art des alten Baums gilt als aktuelle Art', () => {
    const transition = (fromTree: string) =>
      play({ mainTree: 'pine', cycleTransition: { startedAt: 0.2, fromGrowth: 6, fromTree: fromTree as TreeSpecies } }, 0, [0, 0.5, 2.5]);
    expect(transition('maple')).toEqual(transition('pine'));
    expect(transition('maple')).not.toEqual(transition('oak'));
  });

  it('Kiefer bleibt grün, Buche behält im Winter etwas Laub, Eiche ist kahl', () => {
    const winter = seasonLook(3.1);
    expect(speciesLeafAmount('pine', winter)).toBe(1);
    expect(speciesLeafAmount('oak', winter)).toBe(0);
    expect(speciesLeafAmount('beech', winter)).toBeGreaterThan(0);
    expect(speciesLeafAmount('beech', winter)).toBeLessThan(0.3);
    expect(speciesLeafAmount('beech', seasonLook(1))).toBe(1);
  });

  it('verträgt Jahreszeit, Stimmung, Erinnerungsbaum und Zyklus-Übergang mit Arten', () => {
    for (const species of TREE_SPECIES) {
      for (const season of [0.3, 2.3, 3.1]) {
        const calls = play(
          {
            mainTree: species,
            season,
            harmonyTier: 3,
            forestMemory: 300,
            cycleTransition: { startedAt: 0.2, fromGrowth: 6, fromTree: species === 'pine' ? 'oak' : 'pine' },
          },
          0,
          [0, 0.5, 2.5],
        );
        expect(calls.filter((c) => /NaN|Infinity/.test(c))).toEqual([]);
      }
    }
  });

  it('zeichnet die Ebenen nicht pro Frame neu, erst bei Wechsel der Art', () => {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const offscreen = (mainTree: TreeSpecies, time: number) => {
      for (const c of created) c.calls.length = 0;
      drawScene(ctx, W, H, { growth: 6, time, mainTree });
      return created.reduce((n, c) => n + c.calls.length, 0);
    };
    expect(offscreen('pine', 0)).toBeGreaterThan(0);
    expect(offscreen('pine', 0.016)).toBe(0);
    expect(offscreen('beech', 0.032)).toBeGreaterThan(0);
    expect(offscreen('beech', 0.048)).toBe(0);
  });
});
