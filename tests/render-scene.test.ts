import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimalLayer, SpriteCache, type AnimalFrame, type SceneAnimal } from '../src/render/animals';
import { createAnchorResolver } from '../src/render/anchors';
import { makeLayout, placeMainTree } from '../src/render/layout';
import { RESIZE_SETTLE_FRAMES, RESIZE_SETTLE_SECONDS, ResizeGate } from '../src/render/resize';
import { drawScene } from '../src/render/tree';

/**
 * Canvas-Stub: In Vitest gibt es keine Canvas-API. Jeder Kontextaufruf wird nur
 * protokolliert; Hilfsobjekte (Verläufe, Pixeldaten) sind Attrappen.
 */
interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = {
    width,
    height,
    calls: [],
    getContext: () => ctx,
  };
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

describe('ResizeGate', () => {
  it('baut ohne vorhandenen Cache sofort', () => {
    expect(new ResizeGate().shouldRebuild('a', null, 0)).toBe(true);
  });

  it('wartet bei laufender Zeit ~150 ms', () => {
    const gate = new ResizeGate();
    expect(gate.shouldRebuild('b', 'a', 1)).toBe(false);
    expect(gate.shouldRebuild('b', 'a', 1.1)).toBe(false);
    expect(gate.shouldRebuild('b', 'a', 1.16)).toBe(true);
  });

  it('übernimmt die Größe auch bei stehender Zeit nach einigen Frames', () => {
    const gate = new ResizeGate();
    let frames = 0;
    while (!gate.shouldRebuild('b', 'a', 5)) frames++;
    expect(frames).toBe(RESIZE_SETTLE_FRAMES);
  });

  it('baut bei ungültiger Zeit sofort', () => {
    expect(new ResizeGate().shouldRebuild('b', 'a', Number.NaN)).toBe(true);
    expect(new ResizeGate().shouldRebuild('b', 'a', Infinity)).toBe(true);
  });

  it('wartet, solange sich die Größe noch ändert', () => {
    const gate = new ResizeGate();
    for (let i = 0; i < 30; i++) expect(gate.shouldRebuild(`k${i}`, 'a', 1 + i * 0.016)).toBe(false);
  });

  it('bei hoher Bildwiederholrate (240 Hz) entscheidet die Zeit, nicht die Frame-Zahl', () => {
    const gate = new ResizeGate();
    const dt = 1 / 240;
    let frames = 0;
    while (!gate.shouldRebuild('b', 'a', 1 + frames * dt)) frames++;
    expect(frames * dt).toBeGreaterThanOrEqual(RESIZE_SETTLE_SECONDS - 1e-9);
    expect(frames).toBeGreaterThan(RESIZE_SETTLE_FRAMES * 3);
  });

  it('stand die Zeit erst und läuft dann weiter, zählt wieder die Zeit', () => {
    const gate = new ResizeGate();
    for (let i = 0; i < RESIZE_SETTLE_FRAMES - 1; i++) expect(gate.shouldRebuild('b', 'a', 2)).toBe(false);
    for (let i = 1; i <= 20; i++) expect(gate.shouldRebuild('b', 'a', 2 + i * 0.004)).toBe(false);
    expect(gate.shouldRebuild('b', 'a', 2 + RESIZE_SETTLE_SECONDS + 0.001)).toBe(true);
  });

  it('meldet nichts, wenn die Größe passt', () => {
    expect(new ResizeGate().shouldRebuild('a', 'a', 1)).toBe(false);
  });
});

describe('drawScene mit Canvas-Stub', () => {
  /** Skalierung des ersten setTransform-Aufrufs eines Frames (1 = neu aufgebaut). */
  function frameScale(canvas: StubCanvas): number {
    const t = canvas.calls.find((c) => c.name === 'setTransform');
    return t ? (t.args[0] as number) : NaN;
  }

  function frame(canvas: StubCanvas, w: number, h: number, time: number, sizeSettled?: boolean): void {
    canvas.calls.length = 0;
    const ctx = canvas.getContext('2d');
    drawScene(ctx, w, h, { growth: 3.5, time, animals: ANIMALS, sizeSettled });
  }

  it('sizeSettled: schon entprellte Größe wird sofort neu aufgebaut (keine zweite Wartezeit)', () => {
    const canvas = makeCanvas(400, 300);
    frame(canvas, 400, 300, 1, true);
    expect(frameScale(canvas)).toBe(1);
    canvas.width = 800;
    frame(canvas, 800, 300, 1.016, true);
    expect(frameScale(canvas)).toBe(1);
    // Gleiche Größe: nichts neu (Ebenen bleiben, Skalierung 1).
    frame(canvas, 800, 300, 1.032, true);
    expect(frameScale(canvas)).toBe(1);
  });

  it('ohne sizeSettled wartet der Renderer bei laufender Zeit selbst', () => {
    const canvas = makeCanvas(400, 300);
    frame(canvas, 400, 300, 1);
    canvas.width = 800;
    frame(canvas, 800, 300, 1.016);
    expect(frameScale(canvas)).toBe(2);
    frame(canvas, 800, 300, 1.017 + RESIZE_SETTLE_SECONDS);
    expect(frameScale(canvas)).toBe(1);
  });

  it('übernimmt eine neue Größe auch bei fester Zeit (z. B. Pause)', () => {
    const canvas = makeCanvas(400, 300);
    frame(canvas, 400, 300, 5);
    expect(frameScale(canvas)).toBe(1);
    canvas.width = 800;
    canvas.height = 300;
    frame(canvas, 800, 300, 5);
    // Zunächst das alte Bild skaliert …
    expect(frameScale(canvas)).toBe(2);
    for (let i = 0; i < RESIZE_SETTLE_FRAMES + 2; i++) frame(canvas, 800, 300, 5);
    // … dann neu aufgebaut.
    expect(frameScale(canvas)).toBe(1);
  });

  it('baut bei NaN-Zeit sofort neu und zeichnet ohne Fehler', () => {
    const canvas = makeCanvas(400, 300);
    frame(canvas, 400, 300, 1);
    canvas.width = 600;
    frame(canvas, 600, 300, Number.NaN);
    expect(frameScale(canvas)).toBe(1);
    const nonFinite = canvas.calls.filter((c) => c.name === 'setTransform' && c.args.some((a) => !Number.isFinite(a as number)));
    expect(nonFinite).toEqual([]);
  });
});

const ANIMALS: SceneAnimal[] = [
  { id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 0.9 },
  { id: 'bluetit', family: 'birds', niche: 'crown', slot: 0, happiness: 0.1 },
  { id: 'earthworm', family: 'soil', niche: 'roots', slot: 0, happiness: 0.5 },
  { id: 'unknown', family: 'fungi', niche: 'ocean', slot: 0, happiness: 0.5 },
];

describe('SpriteCache', () => {
  it('liefert für gleiche Werte dasselbe Sprite und baut neue Größen getrennt', () => {
    const cache = new SpriteCache();
    const a = cache.get('robin', 0, false, 28, 2);
    expect(cache.get('robin', 0, false, 28.2, 2)).toBe(a);
    expect(cache.get('robin', 0, false, 30, 2)).not.toBe(a);
    expect(cache.get('robin', 0, false, 28, 1)).not.toBe(a);
    expect(cache.count).toBe(3);
  });

  it('legt die entsättigte Variante zusätzlich an und lässt sich leeren', () => {
    const cache = new SpriteCache();
    const muted = cache.get('bee', 1, true, 20, 1);
    expect(muted).not.toBe(cache.get('bee', 1, false, 20, 1));
    expect(cache.count).toBe(2);
    cache.clear();
    expect(cache.count).toBe(0);
  });

  it('wächst nie unbegrenzt', () => {
    const cache = new SpriteCache();
    for (let px = 4; px < 1000; px++) cache.get('insect', 0, false, px, 1);
    expect(cache.count).toBeLessThanOrEqual(400);
  });

  it('nutzt für unbekannte Arten eine Ersatzzeichnung', () => {
    expect(() => new SpriteCache().get('does-not-exist', 0, false, 20, 1)).not.toThrow();
  });
});

describe('AnimalLayer', () => {
  const layout = makeLayout(800, 600);
  const anchors = createAnchorResolver(layout, 4, placeMainTree(layout, 4));
  const f: AnimalFrame = { time: 1, windSkew: 0.01, reducedMotion: false, dpr: 1, sx: 1, sy: 1 };

  it('baut den Plan nur neu, wenn sich Arten, Nischen oder Plätze ändern', () => {
    const layer = new AnimalLayer();
    const ctx = makeCanvas(800, 600).getContext('2d');
    layer.draw(ctx, ANIMALS, anchors, f);
    expect(layer.builds).toBe(1);
    // Neues Array mit gleichem Inhalt, nur andere Zufriedenheit → kein Neubau.
    layer.draw(ctx, ANIMALS.map((a) => ({ ...a, happiness: 0.3 })), anchors, f);
    expect(layer.builds).toBe(1);
    layer.draw(ctx, ANIMALS.map((a, i) => (i === 0 ? { ...a, slot: 1 } : a)), anchors, f);
    expect(layer.builds).toBe(2);
    // Neue Ankerpunkte (Baum gewachsen) → Neubau.
    layer.draw(ctx, ANIMALS, createAnchorResolver(layout, 4.5, placeMainTree(layout, 4.5)), f);
    expect(layer.builds).toBe(3);
  });

  it('zeichnet nur Tiere mit bekannter Nische', () => {
    const layer = new AnimalLayer();
    const canvas = makeCanvas(800, 600);
    layer.draw(canvas.getContext('2d'), ANIMALS, anchors, { ...f, reducedMotion: true });
    const draws = canvas.calls.filter((c) => c.name === 'drawImage').length;
    // Rotkehlchen + Laub, Blaumeise (unzufrieden: nur entsättigt), Regenwurm + Erdloch; Nische „ocean“ fehlt
    expect(draws).toBe(2 + 1 + 2);
  });
});

describe('Waldtümpel (Erweiterung Amphibien)', () => {
  const layout = makeLayout(800, 600);
  const anchors = createAnchorResolver(layout, 4, placeMainTree(layout, 4));
  const f: AnimalFrame = { time: 1, windSkew: 0, reducedMotion: true, dpr: 1, sx: 1, sy: 1 };
  const AMPHIBIANS: SceneAnimal[] = [
    { id: 'toad', family: 'amphibians', niche: 'pond', slot: 0, happiness: 0.9 },
    { id: 'newt', family: 'amphibians', niche: 'pond', slot: 1, happiness: 0.9 },
    // Unbekannte Amphibie: Zeichnung der Gattung (Kröte), kein Absturz.
    { id: 'treefrog', family: 'amphibians', niche: 'pond', slot: 2, happiness: 0.9 },
  ];

  it('zeichnet den Tümpel auch ohne Tiere – ein Sprite, im Winter eins mehr (Eis)', () => {
    const layer = new AnimalLayer();
    const summer = makeCanvas(800, 600);
    layer.draw(summer.getContext('2d'), [], anchors, f, true);
    expect(summer.calls.filter((c) => c.name === 'drawImage')).toHaveLength(1);
    const winter = makeCanvas(800, 600);
    layer.draw(winter.getContext('2d'), [], anchors, { ...f, season: 3 }, true);
    expect(winter.calls.filter((c) => c.name === 'drawImage')).toHaveLength(2);
    const none = makeCanvas(800, 600);
    layer.draw(none.getContext('2d'), [], anchors, f);
    expect(none.calls.filter((c) => c.name === 'drawImage')).toHaveLength(0);
    // Lage gemerkt: kein neues Objekt pro Frame.
    expect(anchors.pond()).toBe(anchors.pond());
  });

  it('Kröte steht im flachen Wasser, der Molch schwimmt; unbekannte Amphibien bekommen die Kröte', () => {
    const layer = new AnimalLayer();
    const canvas = makeCanvas(800, 600);
    layer.draw(canvas.getContext('2d'), AMPHIBIANS, anchors, f, true);
    // Tümpel + (Kröte + Wasser davor) + Molch + (Ersatz-Kröte + Wasser davor)
    expect(canvas.calls.filter((c) => c.name === 'drawImage')).toHaveLength(1 + 2 + 1 + 2);
  });

  it('Reihenfolge: Wurzelraum (Erdloch, Pilzgeflecht) → Tümpel → übrige Tiere', () => {
    const layer = new AnimalLayer();
    const canvas = makeCanvas(800, 600);
    const mixed: SceneAnimal[] = [
      { id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 0.9 },
      { id: 'toad', family: 'amphibians', niche: 'pond', slot: 0, happiness: 0.9 },
      { id: 'earthworm', family: 'soil', niche: 'roots', slot: 0, happiness: 0.9 },
    ];
    layer.draw(canvas.getContext('2d'), mixed, anchors, f, true);
    const draws = canvas.calls.filter((c) => c.name === 'drawImage');
    // Der Tümpel ist das breiteste Sprite (4 Tiergrößen): nach Erdloch und Regenwurm.
    const widths = draws.map((c) => c.args[3] as number);
    expect(widths.indexOf(Math.max(...widths))).toBe(2);
  });

  it('drawScene mit Tümpel und Amphibien in allen Jahreszeiten ohne Fehler', () => {
    const canvas = makeCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    for (const season of [0, 1, 2, 3, 3.5]) {
      expect(() =>
        drawScene(ctx, 800, 600, { growth: 4.5, time: 2 + season, animals: AMPHIBIANS, pond: true, season, sizeSettled: true }),
      ).not.toThrow();
    }
  });
});
