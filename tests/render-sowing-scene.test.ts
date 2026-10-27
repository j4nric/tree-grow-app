import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedPlant } from '../src/render/flora';
import { SOWING_CUE_WAIT, SOWING_LAND_SECONDS, SOWING_SECONDS, SowingCue, sowingSlot } from '../src/render/sowing';
import { drawScene, sceneCacheStats, type SceneInput, type ScenePlant } from '../src/render/tree';

/**
 * Aussaat-Animation im Spiel (Phase 10, 4d): Auslöser aus dem Setzen (`sowingTrigger`) und
 * drawScene mit `SceneInput.sowing` – Pflanze erst nach der Landung, Ebenen nur bei Beginn
 * und Landung neu, Sprites nur während der Aussaat, weniger Bewegung ohne Animation.
 */

// Gemalte Pflanzen mitschreiben (Platz), sonst unverändert zeichnen.
const painted: number[] = [];
vi.mock('../src/render/flora-paint', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/render/flora-paint')>();
  return {
    ...orig,
    paintPlant: (ctx: CanvasRenderingContext2D, p: PlacedPlant, ...rest: unknown[]) => {
      painted.push(p.slot);
      return (orig.paintPlant as (...a: unknown[]) => unknown)(ctx, p, ...rest);
    },
  };
});

// ---------------------------------------------------------------------------
// Canvas-Stub, der alle Aufrufe protokolliert
// ---------------------------------------------------------------------------

interface StubCanvas {
  width: number;
  height: number;
  log: string[];
  getContext: (type: string) => CanvasRenderingContext2D;
}

let created = 0;

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, log: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop: () => undefined, data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        canvas.log.push(`${String(prop)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : typeof a)).join(',')})`);
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      canvas.log.push(`${String(prop)}=${typeof value === 'object' ? 'obj' : String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

beforeEach(() => {
  created = 0;
  painted.length = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      created++;
      return makeCanvas();
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Aussaat: Auslöser', () => {
  it('sowingSlot: freier Platz (angehängt) und ersetzter Platz', () => {
    expect(sowingSlot([], ['hazel'], 'hazel')).toBe(0);
    expect(sowingSlot(['fern'], ['fern', 'hazel'], 'hazel')).toBe(1);
    expect(sowingSlot(['fern', 'moss', 'oak'], ['fern', 'hazel', 'oak'], 'hazel')).toBe(1);
    // Gleiche Art ein zweites Mal: der neue Platz, nicht der alte.
    expect(sowingSlot(['hazel'], ['hazel', 'hazel'], 'hazel')).toBe(1);
  });

  it('sowingSlot: nichts gesetzt → −1', () => {
    expect(sowingSlot(['fern'], ['fern'], 'fern')).toBe(-1);
    expect(sowingSlot([], ['fern'], undefined)).toBe(-1);
    expect(sowingSlot([], ['fern'], 'hazel')).toBe(-1);
  });

  it('SowingCue: startet erst, wenn die Szene zu sehen ist – einmal', () => {
    const cue = new SowingCue();
    expect(cue.take(1, true)).toBeUndefined();
    cue.plant(2, 10);
    expect(cue.pending).toBe(true);
    expect(cue.take(10.5, false)).toBeUndefined();
    expect(cue.take(12, true)).toEqual({ startedAt: 12, slot: 2 });
    expect(cue.pending).toBe(false);
    expect(cue.take(12.1, true)).toBeUndefined();
  });

  it('SowingCue: nichts gesetzt, ungültige Werte, verfallen und verworfen', () => {
    const cue = new SowingCue();
    cue.plant(-1, 10);
    cue.plant(Number.NaN, 10);
    cue.plant(1, Number.NaN);
    expect(cue.pending).toBe(false);
    // Zu lange verdeckt: verfällt, die Pflanze steht einfach da.
    cue.plant(1, 10);
    expect(cue.take(10 + SOWING_CUE_WAIT + 0.1, false)).toBeUndefined();
    expect(cue.pending).toBe(false);
    expect(cue.take(10 + SOWING_CUE_WAIT + 0.2, true)).toBeUndefined();
    cue.plant(1, 10);
    expect(cue.take(10 + SOWING_CUE_WAIT, true)).toEqual({ startedAt: 10 + SOWING_CUE_WAIT, slot: 1 });
    cue.plant(3, 20);
    cue.clear();
    expect(cue.take(20, true)).toBeUndefined();
  });
});

describe('Aussaat in drawScene', () => {
  const plants: ScenePlant[] = [
    { id: 'hazel', group: 'shrubs', slot: 0, vigor: 1 },
    { id: 'oak', group: 'trees', slot: 1, vigor: 1 },
    { id: 'thyme', group: 'flowers', slot: 2, vigor: 1 },
  ];
  const base: SceneInput = { growth: 6, time: 0, plants, sizeSettled: true, reducedMotion: false };
  const T0 = 2;

  /** Frames im 50-ms-Takt von `from` bis `to`. */
  function run(canvas: StubCanvas, input: Partial<SceneInput>, from: number, to: number): void {
    const ctx = canvas.getContext('2d');
    for (let t = from; t <= to + 1e-9; t += 0.05) drawScene(ctx, 800, 600, { ...base, ...input, time: t });
  }

  it('Pflanze fehlt bis zur Landung, die übrigen bleiben; Ebenen nur bei Beginn und Landung neu', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    run(canvas, {}, 1, 1.2);
    const builds0 = sceneCacheStats(el)!.layerBuilds;
    expect(new Set(painted)).toEqual(new Set([0, 1, 2]));
    painted.length = 0;
    const sowing = { startedAt: T0, slot: 2 };
    run(canvas, { sowing }, T0, T0 + SOWING_LAND_SECONDS - 0.1);
    // Während des Flugs: ohne die neue Pflanze gezeichnet (einmal), die anderen unverändert.
    expect(new Set(painted)).toEqual(new Set([0, 1]));
    expect(sceneCacheStats(el)!.layerBuilds).toBe(builds0 + 1);
    expect(sceneCacheStats(el)!.sowPrepared).toBe(true);
    painted.length = 0;
    run(canvas, { sowing }, T0 + SOWING_LAND_SECONDS + 0.01, T0 + SOWING_SECONDS + 1);
    expect(new Set(painted)).toEqual(new Set([0, 1, 2]));
    const stats = sceneCacheStats(el)!;
    expect(stats.layerBuilds).toBe(builds0 + 2);
    // Bahnen einmal, Sprites höchstens drei (Ahorn, Schirmchen, Schein) – danach freigegeben.
    expect(stats.sowPathBuilds).toBe(1);
    expect(stats.sowSpriteBuilds).toBeGreaterThanOrEqual(2);
    expect(stats.sowSpriteBuilds).toBeLessThanOrEqual(3);
    expect(stats.sowPrepared).toBe(false);
  });

  it('keine Canvases und Neuzeichnungen pro Frame während der Aussaat', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    const sowing = { startedAt: T0, slot: 0 };
    run(canvas, { sowing }, T0, T0 + 0.5);
    const n0 = created;
    const b0 = sceneCacheStats(el)!.layerBuilds;
    const s0 = sceneCacheStats(el)!.sowSpriteBuilds;
    run(canvas, { sowing }, T0 + 0.55, T0 + SOWING_LAND_SECONDS - 0.1);
    expect(sceneCacheStats(el)!.layerBuilds).toBe(b0);
    expect(created - n0).toBe(sceneCacheStats(el)!.sowSpriteBuilds - s0);
    expect(sceneCacheStats(el)!.sowPathBuilds).toBe(1);
  });

  it('weniger Bewegung: keine Samen, Pflanze sofort, kein zusätzliches Neuzeichnen', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    run(canvas, { reducedMotion: true }, 1, 1.2);
    const b0 = sceneCacheStats(el)!.layerBuilds;
    painted.length = 0;
    run(canvas, { reducedMotion: true, sowing: { startedAt: T0, slot: 2 } }, T0, T0 + SOWING_SECONDS + 0.5);
    const stats = sceneCacheStats(el)!;
    expect(stats.layerBuilds).toBe(b0);
    expect(stats.sowSpriteBuilds).toBe(0);
    expect(stats.sowPathBuilds).toBe(0);
    expect(painted).toEqual([]);
  });

  it('nach der Aussaat (Feld bleibt gesetzt) zeichnet die Szene wie ohne das Feld', () => {
    const a = makeCanvas(800, 600);
    const b = makeCanvas(800, 600);
    run(a, { sowing: { startedAt: T0, slot: 1 } }, T0, T0 + SOWING_SECONDS + 0.3);
    run(b, {}, T0, T0 + SOWING_SECONDS + 0.3);
    a.log.length = 0;
    b.log.length = 0;
    const t = T0 + SOWING_SECONDS + 0.5;
    drawScene(a.getContext('2d'), 800, 600, { ...base, time: t, sowing: { startedAt: T0, slot: 1 } });
    drawScene(b.getContext('2d'), 800, 600, { ...base, time: t });
    expect(a.log.join('|')).toBe(b.log.join('|'));
  });

  it('Platz ohne Pflanze, ungültige Werte und Zoom: kein Fehler', () => {
    const canvas = makeCanvas(800, 600);
    expect(() => {
      run(canvas, { sowing: { startedAt: T0, slot: 9 } }, T0, T0 + 0.3);
      run(canvas, { sowing: { startedAt: Number.NaN, slot: 1 } }, T0, T0 + 0.1);
      run(canvas, { sowing: { startedAt: T0, slot: Number.NaN } }, T0, T0 + 0.1);
      run(canvas, { sowing: { startedAt: T0 + 3, slot: -1 } }, T0 + 3, T0 + 3.3);
      run(canvas, { sowing: { startedAt: T0 + 5, slot: 1 }, plants: undefined }, T0 + 5, T0 + 5.3);
      run(canvas, { sowing: { startedAt: T0 + 7, slot: 1 }, camera: { zoom: 2.5, x: 0.6, y: 0.7 } }, T0 + 7, T0 + 8);
    }).not.toThrow();
    expect(sceneCacheStats(canvas as unknown as HTMLCanvasElement)!.sowSpriteBuilds).toBeGreaterThan(0);
  });
});
