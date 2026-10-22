import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_TREE_IDS } from '../src/content/trees';
import { animalSize, foliageReach, HABITAT_LIFT, nicheAnchors, SCENE_NICHES, trunkBaseHalf } from '../src/render/anchors';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { buildTree, formAt, normalizeSpecies, RENDER_TREE_SPECIES, TREE_FORMS, TREE_SPECIES, type TreeSpecies } from '../src/render/plant';
import { seasonLook } from '../src/render/season';
import { speciesLeafAmount } from '../src/render/species';
import { drawScene, type SceneInput, type ScenePlant } from '../src/render/tree';

/**
 * Weißtanne und Schwarzerle (DESIGN_V2.md 25.6 Nr. 1): zunächst nur render-lokal
 * (`RENDER_TREE_SPECIES`, Demo `?tree=fir|alder`). Muster wie tests/render-species.test.ts.
 */

const NEW: readonly TreeSpecies[] = ['fir', 'alder'];

interface StubCanvas {
  width: number;
  height: number;
  calls: string[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

let created: StubCanvas[] = [];

/** Canvas-Stub, der Aufrufe und gesetzte Werte protokolliert (auch in Offscreen-Ebenen). */
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

/** Umriss eines Baums in Baum-Einheiten. */
function box(species: TreeSpecies, g: number): [number, number, number] {
  const geo = buildTree(g, 7, TREE_FORMS[species]);
  return [geo.minX, geo.maxX, geo.minY];
}

describe('Weißtanne und Schwarzerle: Auswahl', () => {
  it('seit v15 spielbar: TREE_SPECIES = RENDER_TREE_SPECIES = MAIN_TREE_IDS, die neuen Arten hinten', () => {
    expect([...TREE_SPECIES]).toEqual([...MAIN_TREE_IDS]);
    expect([...RENDER_TREE_SPECIES]).toEqual([...TREE_SPECIES]);
    expect(RENDER_TREE_SPECIES.slice(-NEW.length)).toEqual([...NEW]);
    for (const s of RENDER_TREE_SPECIES) expect(normalizeSpecies(s)).toBe(s);
    expect(normalizeSpecies('maple')).toBe('oak');
  });

  it('sehen vom Samen bis zum Urwald anders aus als Eiche, Buche, Kiefer und einander', { timeout: 60_000 }, () => {
    for (const growth of [0.5, 1.2, 3.5, 7.5]) {
      const others = (['oak', 'beech', 'pine'] as const).map((s) => play({ mainTree: s }, growth));
      const fir = play({ mainTree: 'fir' }, growth);
      const alder = play({ mainTree: 'alder' }, growth);
      for (const o of others) {
        expect(fir, `Tanne g=${growth}`).not.toEqual(o);
        expect(alder, `Erle g=${growth}`).not.toEqual(o);
      }
      expect(fir, `Tanne ≠ Erle g=${growth}`).not.toEqual(alder);
    }
  });
});

describe('Weißtanne und Schwarzerle: stabil und stufenlos', () => {
  it('gleiches Wachstum → gleicher Baum und gleiche Zeichenbefehle', () => {
    for (const species of NEW) {
      for (const g of [1, 2.37, 5, 8]) expect(buildTree(g, 7, TREE_FORMS[species])).toEqual(buildTree(g, 7, TREE_FORMS[species]));
      expect(play({ mainTree: species, season: 3.1 }, 6.3)).toEqual(play({ mainTree: species, season: 3.1 }, 6.3));
    }
  });

  it('jede Stufe zeichnet ohne Fehler und ohne NaN – in jeder Jahreszeit', { timeout: 60_000 }, () => {
    for (const species of NEW) {
      for (const growth of [0, 0.3, 0.8, 1, 1.5, 2, 3, 4, 5, 6, 7, 8]) {
        for (const season of [undefined, 0.3, 1, 2.3, 3.1, 3.6]) {
          const calls = play({ mainTree: species, season }, growth, [0, 0.5]);
          expect(calls.filter((c) => /NaN|Infinity/.test(c)), `${species} g=${growth} s=${season}`).toEqual([]);
        }
      }
    }
  });

  it('Umriss wächst stetig: kein Sprung zwischen g und g + 0,01 (g 1–8)', () => {
    for (const species of NEW) {
      let prev = box(species, 1);
      for (let k = 1; k <= 700; k++) {
        const g = 1 + k * 0.01;
        const next = box(species, g);
        // Baum-Einheiten: der Stamm ist 1 lang, der ganze Baum etwa 3–5.
        for (let i = 0; i < 3; i++) expect(Math.abs(next[i]! - prev[i]!), `${species} ${i} bei g=${g.toFixed(2)}`).toBeLessThan(0.08);
        prev = next;
      }
    }
  });

  it('bestehende Äste bleiben beim Wachsen an ihrem Platz (Stamm der Tanne, Hauptstamm der Erle)', () => {
    for (const species of NEW) {
      const a = buildTree(6, 7, TREE_FORMS[species]);
      const b = buildTree(6.01, 7, TREE_FORMS[species]);
      expect(b.branches[0]!.x2).toBeCloseTo(a.branches[0]!.x2, 2);
      expect(b.branches[0]!.y2).toBeCloseTo(a.branches[0]!.y2, 2);
      expect(b.branches.length).toBeGreaterThanOrEqual(a.branches.length);
    }
  });

  it('Anker der Tiere springen nicht: höchstens 8 px je Δg = 0,05 (g 1–8)', () => {
    const step = 0.05;
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
    ] as const) {
      for (const species of NEW) {
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

describe('Weißtanne und Schwarzerle: Wuchsform', () => {
  it('Tanne: jung spitzer Kegel, im Alter flacher Gipfel (Storchennest)', () => {
    /** Breite der Krone im obersten Fünftel relativ zur größten Breite. */
    const topShare = (g: number) => {
      const geo = buildTree(g, 7, TREE_FORMS.fir);
      const top = geo.minY;
      const cut = top + (0 - top) * 0.2;
      let topHalf = 0;
      let half = 0;
      for (const l of geo.leaves) {
        const w = Math.abs(l.x) + l.r;
        half = Math.max(half, w);
        if (l.y <= cut) topHalf = Math.max(topHalf, w);
      }
      return topHalf / half;
    };
    expect(topShare(4)).toBeLessThan(0.5);
    expect(topShare(7.8)).toBeGreaterThan(topShare(4) + 0.2);
    // Formwechsel stetig.
    expect(formAt(TREE_FORMS.fir, 5).flatTop).toBe(0);
    expect(formAt(TREE_FORMS.fir, 8).flatTop).toBeCloseTo(TREE_FORMS.fir.aged!.flatTop!, 6);
  });

  it('Tanne: das untere Astpaar stirbt im Alter zu kahlen Aststummeln ab', () => {
    /** Kahlheit und Länge des Astpaars in der Stammmitte. */
    const lowest = (g: number) => {
      const geo = buildTree(g, 7, TREE_FORMS.fir);
      const trunk = geo.branches[0]!;
      const low = trunk.children.slice(1).map((c) => geo.branches[c]!).filter((b) => b.y1 > -0.6);
      return { bare: Math.max(...low.map((b) => b.bare ?? 0)), len: Math.max(...low.map((b) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1))) };
    };
    const young = lowest(3);
    const old = lowest(6.5);
    expect(young.bare).toBe(0);
    expect(old.bare).toBeGreaterThan(0.9);
    expect(old.len).toBeLessThan(young.len);
    // Stummel tragen keine Nadeln.
    const geo = buildTree(6.5, 7, TREE_FORMS.fir);
    expect(geo.leaves.filter((l) => l.y > -0.6 && l.level === 1)).toEqual([]);
  });

  it('Erle: mehrstämmig ab Setzling, Keimblätter und Anker bleiben am Hauptstamm', () => {
    const stems = (g: number) => buildTree(g, 7, TREE_FORMS.alder).branches.filter((b) => b.level === 0).length;
    expect(stems(1.7)).toBe(1);
    expect(stems(2.6)).toBe(3);
    const geo = buildTree(1.5, 7, TREE_FORMS.alder);
    expect(geo.tipX).toBe(geo.branches[0]!.x2);
    expect(geo.tipY).toBe(geo.branches[0]!.y2);
  });

  it('Stamm nie breiter als die Eiche: Waldsaum-Reihe bleibt auch mit den neuen Arten gleich', () => {
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
      [320, 568],
      [360, 800],
      [600, 900],
      [800, 600],
      [1024, 768],
      [1920, 1080],
      [2400, 700],
    ] as [number, number][]) {
      const layout = makeLayout(w, h);
      const oak = trunkBaseHalf(8, placeMainTree(layout, 8, 'oak'), layout);
      for (const species of NEW) {
        expect(trunkBaseHalf(8, placeMainTree(layout, 8, species), layout), `${species} ${w}×${h}`).toBeLessThanOrEqual(oak);
        expect(nicheAnchors(w, h, 6, 4, species).edge, `${species} ${w}×${h}`).toEqual(nicheAnchors(w, h, 6, 4, 'oak').edge);
      }
    }
  });

  it('Krone: Plätze im Laub; Stamm und Höhlen am Stamm (alle Stufen, Desktop und Mobil)', () => {
    for (const species of NEW) {
      for (const [w, h] of [
        [1200, 700],
        [390, 844],
      ] as const) {
        const layout = makeLayout(w, h);
        const S = animalSize(w, h);
        for (const g of [3, 4, 5, 6, 7, 8]) {
          const main = placeMainTree(layout, g, species)!;
          const all = nicheAnchors(w, h, g, 4, species);
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
          const trunkTopY = main.y + main.geo.branches[0]!.y2 * main.scale;
          for (const a of all.crown) {
            const msg = `${species} Krone ${a.slot} bei g=${g}, ${w}×${h}`;
            expect(a.x, msg).toBeGreaterThanOrEqual(x0 - pad);
            expect(a.x, msg).toBeLessThanOrEqual(x1 + pad);
            expect(a.y, msg).toBeGreaterThanOrEqual(y0 - pad);
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

  it('Laub der Tanne und Erle reicht nicht weiter in den Mittelgrund als das der bisherigen Arten', () => {
    // Seit 2b gilt TREE_SPECIES = RENDER_TREE_SPECIES – so verschieben sich keine Lebensräume.
    for (const [w, h] of [
      [1200, 700],
      [390, 844],
      [800, 600],
      [1920, 1080],
    ] as [number, number][]) {
      const layout = makeLayout(w, h);
      const S = animalSize(w, h);
      for (const side of [-1, 1] as const) {
        const line = layout.groundY - HABITAT_LIFT * S;
        const top = line - (1.55 + 0.6) * S;
        let want = 0;
        for (const species of NEW) {
          for (let g = 3; g <= 8; g += 0.5) {
            const t = placeMainTree(layout, g, species)!;
            for (const l of t.geo.leaves) {
              const r = l.r * t.scale;
              const y = t.y + l.y * t.scale;
              if (y + r < top || y - r > line + S * 0.1) continue;
              want = Math.max(want, (t.x + l.x * t.scale - layout.cx) * side + r * 0.85);
            }
          }
        }
        expect(want + S * 0.15, `${w}×${h} ${side}`).toBeLessThanOrEqual(foliageReach(layout, S, side) + 1e-6);
      }
    }
  });
});

describe('Weißtanne und Schwarzerle: Jahreszeiten und Leistung', () => {
  it('Tanne bleibt im Winter grün (Schnee auf den Etagen), Erle ist kahl', () => {
    const winter = seasonLook(3.1);
    expect(speciesLeafAmount('fir', winter)).toBe(1);
    expect(speciesLeafAmount('alder', winter)).toBe(0);
    expect(speciesLeafAmount('alder', seasonLook(1))).toBe(1);
    // Schnee: die Tanne sieht im Winter anders aus als im Sommer – mit voller Krone.
    expect(play({ mainTree: 'fir', season: 3.1 }, 6)).not.toEqual(play({ mainTree: 'fir', season: 1 }, 6));
  });

  it('Erle: Kätzchen und Zäpfchen nur, wenn sie kahl ist – im Sommer wie ohne Jahreszeit', () => {
    expect(play({ mainTree: 'alder', season: 1 }, 6)).toEqual(play({ mainTree: 'alder' }, 6));
  });

  it('Zyklus-Übergang und Erinnerungsbaum mit den neuen Arten', () => {
    for (const species of NEW) {
      const calls = play(
        { mainTree: species, season: 3.1, forestMemory: 300, cycleTransition: { startedAt: 0.2, fromGrowth: 6, fromTree: species === 'fir' ? 'alder' : 'fir' } },
        0,
        [0, 0.5, 2.5],
      );
      expect(calls.filter((c) => /NaN|Infinity/.test(c))).toEqual([]);
    }
  });

  it('zeichnet die Ebenen nicht pro Frame neu (Offscreen-Cache), erst bei Wechsel der Art', () => {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const offscreen = (mainTree: TreeSpecies, time: number) => {
      for (const c of created) c.calls.length = 0;
      drawScene(ctx, W, H, { growth: 6, time, mainTree, season: 3.1 });
      return created.reduce((n, c) => n + c.calls.length, 0);
    };
    expect(offscreen('fir', 0)).toBeGreaterThan(0);
    expect(offscreen('fir', 0.016)).toBe(0);
    expect(offscreen('alder', 0.032)).toBeGreaterThan(0);
    expect(offscreen('alder', 0.048)).toBe(0);
  });
});
