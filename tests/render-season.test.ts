import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blossomOn, MAX_FLAKES, MAX_LEAVES, normalizeSeason, seasonColor, seasonLeaves, seasonLook, seasonWood } from '../src/render/season';
import { buildTree, leafKeep, paintLeaves } from '../src/render/plant';
import { drawScene, type SceneInput, type ScenePlant } from '../src/render/tree';

/**
 * Canvas-Stub, der Aufrufe und gesetzte Farben/Deckkraft protokolliert – so lässt sich
 * „pixelgleich“ als gleiche Zeichenbefehle prüfen (auch in den Offscreen-Ebenen).
 */
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
  { id: 'pine', group: 'trees', slot: 1, vigor: 1 },
  { id: 'hazel', group: 'shrubs', slot: 2, vigor: 1 },
  { id: 'anemone', group: 'flowers', slot: 3, vigor: 0.8 },
  { id: 'moss', group: 'mosses', slot: 4, vigor: 1 },
];

/** Alle Zeichenbefehle (Bildschirm und Offscreen-Ebenen) über einige Frames. */
function play(extra: Partial<SceneInput>, times = [0, 0.3, 0.7, 1.2]): string[] {
  created = [];
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (const t of times) drawScene(ctx, W, H, { growth: 6, time: t, plants: PLANTS, ...extra });
  return [...canvas.calls, ...created.flatMap((c) => c.calls)];
}

describe('Jahreszeit: Werte', () => {
  it('normalisiert: ungültig wie ohne Angabe, sonst modulo 4', () => {
    expect(normalizeSeason(undefined)).toBeNull();
    expect(normalizeSeason(Number.NaN)).toBeNull();
    expect(normalizeSeason(Infinity)).toBeNull();
    expect(normalizeSeason(-1)).toBe(3);
    expect(normalizeSeason(5)).toBe(1);
    expect(normalizeSeason(4)).toBe(0);
    expect(normalizeSeason(2.5)).toBe(2.5);
  });

  it('Sommer ist neutral; Frühling, Herbst und Winter haben ihre Merkmale', () => {
    const summer = seasonLook(1)!;
    expect(summer.summer).toBe(true);
    expect(seasonLook(5)).toBe(summer);
    expect(seasonLook(-3)).toBe(summer);
    const palette = { shadow: '#2c5230', tones: ['#3a6e39', '#4d8942', '#68a14e'] as [string, string, string], highlight: '#a7cf7c' };
    expect(seasonLeaves(palette, summer)).toBe(palette);
    expect(seasonColor('#5d9a3e', summer)).toBe('#5d9a3e');
    const wood = { base: '#6b4a30', shade: '#563a25', light: '#866244' };
    expect(seasonWood(wood, summer)).toBe(wood);

    const spring = seasonLook(0.3)!;
    expect(spring.blossom).toBeGreaterThan(0.5);
    expect(spring.spring).toBeGreaterThan(0.5);
    const autumn = seasonLook(2.3)!;
    expect(autumn.autumn).toBe(1);
    expect(autumn.fall).toBe(1);
    expect(autumn.leaves).toBeGreaterThan(0.3);
    expect(seasonLeaves(palette, autumn)).not.toEqual(palette);
    const winter = seasonLook(3.1)!;
    expect(winter.leaves).toBe(0);
    expect(winter.snow).toBe(1);
    expect(seasonLook(-0.9)).toBe(winter);
  });

  it('rundet auf 0,05 und legt je Rundung nur ein Objekt an', () => {
    expect(seasonLook(2.31)).toBe(seasonLook(2.29));
    expect(seasonLook(2.3)).not.toBe(seasonLook(2.4));
    // Übergänge stufenlos: kleine Schritte ändern das Sichtbare nur wenig. Die Laubfarbe
    // wechselt nur, während die Bäume kahl sind – daher Farbe × Laubmenge.
    const visible = (l: NonNullable<ReturnType<typeof seasonLook>>) => [
      l.leaves,
      l.spring * l.leaves,
      l.autumn * l.leaves,
      l.blossom * l.leaves,
      l.snow,
      l.fall,
    ];
    let prev = visible(seasonLook(0)!);
    for (let s = 0.05; s < 4.01; s += 0.05) {
      const cur = visible(seasonLook(s)!);
      cur.forEach((v, k) => expect(Math.abs(v - prev[k]!), `Merkmal ${k} bei ${s.toFixed(2)}`).toBeLessThan(0.36));
      prev = cur;
    }
  });
});

describe('Jahreszeit in der Szene', () => {
  it('ohne Angabe, bei 1 (Sommer), 5 und NaN: exakt dieselben Zeichenbefehle wie bisher', () => {
    const plain = play({});
    expect(play({ season: 1 })).toEqual(plain);
    expect(play({ season: 5 })).toEqual(plain);
    expect(play({ season: Number.NaN })).toEqual(plain);
    expect(play({ season: 0.99 })).toEqual(plain);
    expect(play({ season: 2.3 })).not.toEqual(plain);
  });

  it('zeichnet die Ebenen nicht pro Frame neu, erst ab einer Änderung von 0,05', () => {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const offscreen = (season: number, time: number) => {
      for (const c of created) c.calls.length = 0;
      drawScene(ctx, W, H, { growth: 6, time, plants: PLANTS, season });
      return created.reduce((n, c) => n + c.calls.length, 0);
    };
    expect(offscreen(2.3, 0)).toBeGreaterThan(0);
    // Fallende Blätter: nur Sprites (einmal angelegt), keine Ebenen.
    offscreen(2.3, 0.016);
    expect(offscreen(2.3, 0.032)).toBe(0);
    expect(offscreen(2.31, 0.048)).toBe(0);
    expect(offscreen(2.4, 0.064)).toBeGreaterThan(0);
    expect(offscreen(2.4, 0.08)).toBe(0);
  });

  it('begrenzt die Partikel und hält sie bei weniger Bewegung an', () => {
    const drawImages = (calls: string[]) => calls.filter((c) => c.startsWith('drawImage')).length;
    const frame = (extra: Partial<SceneInput>, t: number) => {
      const canvas = makeCanvas(W, H);
      const ctx = canvas.getContext('2d');
      drawScene(ctx, W, H, { growth: 6, time: t - 0.1, plants: PLANTS, ...extra });
      canvas.calls.length = 0;
      drawScene(ctx, W, H, { growth: 6, time: t, plants: PLANTS, ...extra });
      return canvas.calls;
    };
    const summer = drawImages(frame({ season: 1 }, 3));
    const winter = drawImages(frame({ season: 3.1 }, 3));
    const autumn = drawImages(frame({ season: 2.3 }, 3));
    expect(winter - summer).toBeGreaterThan(0);
    expect(winter - summer).toBeLessThanOrEqual(MAX_FLAKES);
    expect(autumn - summer).toBeGreaterThan(0);
    expect(autumn - summer).toBeLessThanOrEqual(MAX_LEAVES);
    // Weniger Bewegung: gleiche Lage zu verschiedenen Zeiten.
    expect(frame({ season: 3.1, reducedMotion: true }, 2)).toEqual(frame({ season: 3.1, reducedMotion: true }, 9));
    expect(frame({ season: 3.1 }, 2)).not.toEqual(frame({ season: 3.1 }, 9));
  });

  it('verträgt sich mit Stimmung, Gästen, Tieren und Zyklus-Übergang', () => {
    for (const season of [0.3, 2.3, 3.1]) {
      const calls = play(
        {
          season,
          harmonyTier: 4,
          visitors: [
            { id: 'waxwings', slot: 0 },
            { id: 'boars', slot: 1 },
          ],
          animals: [{ id: 'deer', family: 'mammals', niche: 'edge', slot: 1, happiness: 0.8 }],
          forestMemory: 200,
          cycleTransition: { startedAt: 0.5, fromGrowth: 6.5, fromPlants: PLANTS },
        },
        [0, 0.6, 1.5],
      );
      const bad = calls.filter((c) => /NaN|Infinity/.test(c));
      expect(bad).toEqual([]);
    }
  });
});

describe('Jahreszeit: Nachschliff', () => {
  it('Blüten sitzen nur auf gezeichneten Büscheln (keine Blüten an kahlen Zweigen)', () => {
    const geo = buildTree(6, 1234);
    expect(geo.leaves.length).toBeGreaterThan(20);
    for (const leaves of [0.2, 0.5, 0.8, 1]) {
      let blossoms = 0;
      geo.leaves.forEach((l, i) => {
        if (blossomOn(l, i, 1, leaves) < 0) return;
        blossoms++;
        // paintLeaves zeichnet ein Büschel bei Laubmenge < 1 nur mit leafKeep < leaves.
        if (leaves < 1) expect(leafKeep(l)).toBeLessThan(leaves);
      });
      expect(blossoms).toBeGreaterThan(0);
    }
    // Ohne Laub keine Blüten.
    expect(geo.leaves.every((l, i) => blossomOn(l, i, 1, 0) < 0)).toBe(true);
  });

  it('Blattbüschel: gleiche Zeichenbefehle, egal was vorher gezeichnet wurde (Determinismus)', () => {
    const record = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = makeCanvas(100, 100);
      draw(c.getContext('2d'));
      return c.calls;
    };
    const palette = { shadow: '#2c5230', tones: ['#3a6e39', '#4d8942', '#68a14e'] as [string, string, string], highlight: '#a7cf7c' };
    const a = buildTree(5.3, 77);
    const b = buildTree(6.1, 7);
    const fresh = record((ctx) => paintLeaves(ctx, b, 50, 90, 4, palette));
    // Vorlauf mit einem anderen Baum (anderer Zählerstand) – das Ergebnis darf sich nicht ändern.
    record((ctx) => paintLeaves(ctx, a, 50, 90, 3.3, palette, 0.6));
    const after = record((ctx) => paintLeaves(ctx, b, 50, 90, 4, palette));
    expect(after).toEqual(fresh);
  });

  it('Naht: 3,99 ist (gerundet) wieder Frühling 0; nahe Sommer gilt als Sommer', () => {
    expect(seasonLook(3.99)).toBe(seasonLook(0));
    expect(seasonLook(-0.01)).toBe(seasonLook(0));
    expect(seasonLook(0.98)!.summer).toBe(true);
    expect(seasonLook(1.1)!.summer).toBe(true);
    expect(seasonLook(1.4)!.summer).toBe(false);
    expect(seasonLook(0.9)!.summer).toBe(false);
  });

  it('Partikel-Sprites werden einmal angelegt und nicht neu erzeugt', () => {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawScene(ctx, W, H, { growth: 6, time: 0, season: 2.3 });
    drawScene(ctx, W, H, { growth: 6, time: 0.05, season: 2.3 });
    const count = created.length;
    for (let i = 0; i < 20; i++) drawScene(ctx, W, H, { growth: 6, time: 0.1 + i * 0.05, season: 2.3 });
    expect(created.length).toBe(count);
    // Winter dazu: genau ein weiteres Sprite (Flocke) – und die Ebenen einmal neu.
    drawScene(ctx, W, H, { growth: 6, time: 2, season: 3.1 });
    const winter = created.length;
    for (let i = 0; i < 20; i++) drawScene(ctx, W, H, { growth: 6, time: 2.1 + i * 0.05, season: 3.1 });
    expect(created.length).toBe(winter);
  });
});
