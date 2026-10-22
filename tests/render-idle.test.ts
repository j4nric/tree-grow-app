import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIDGROUND_MEADOW, MIDGROUND_WALL, midgroundPath } from '../src/render/habitat-scenery';
import { IdleQueue, type IdlePost } from '../src/render/idle';
import { makeLayout } from '../src/render/layout';
import { RESIZE_SETTLE_SECONDS } from '../src/render/resize';
import { drawScene, sceneCacheStats, type SceneAnimal, type SceneInput } from '../src/render/tree';

/**
 * Arbeit in Leerlaufzeit (idle.ts) und ihre Nutzung im Renderer: neue Jahreszeit-Stufe,
 * Tönung und Detail-Ebenen entstehen zwischen den Frames, der Frame selbst bleibt billig.
 * Dazu die Kuppe von Waldwiese und Trockenmauer im Nebel (K2).
 */

/** Post-Funktion zum Mitschreiben: Rückrufe laufen erst, wenn der Test sie auslöst. */
function manualPost(): { post: IdlePost; pending: (() => void)[] } {
  const pending: (() => void)[] = [];
  return { post: (run) => void pending.push(run), pending };
}

describe('IdleQueue', () => {
  it('plant nur einen Rückruf und arbeitet je Rückruf genau eine Aufgabe ab', () => {
    const { post, pending } = manualPost();
    const q = new IdleQueue(post);
    const done: string[] = [];
    q.schedule('a', () => done.push('a'));
    q.schedule('b', () => done.push('b'));
    expect(pending).toHaveLength(1);
    pending.shift()!();
    expect(done).toEqual(['a']);
    // Es wartet noch etwas: neuer Rückruf für das nächste Stück.
    expect(pending).toHaveLength(1);
    pending.shift()!();
    expect(done).toEqual(['a', 'b']);
    expect(pending).toHaveLength(0);
    expect(q.size).toBe(0);
  });

  it('gleicher Schlüssel ersetzt die wartende Aufgabe (Platz in der Reihe bleibt)', () => {
    const { post } = manualPost();
    const q = new IdleQueue(post);
    const done: string[] = [];
    q.schedule('a', () => done.push('a1'));
    q.schedule('b', () => done.push('b'));
    q.schedule('a', () => done.push('a2'));
    expect(q.size).toBe(2);
    expect(q.has('a')).toBe(true);
    q.flush();
    expect(done).toEqual(['a2', 'b']);
  });

  it('Folge-Stücke, die eine Aufgabe einplant, laufen danach; cancel entfernt', () => {
    const { post } = manualPost();
    const q = new IdleQueue(post);
    const done: number[] = [];
    let n = 0;
    const step = (): void => {
      done.push(n++);
      if (n < 3) q.schedule('job', step);
    };
    q.schedule('job', step);
    q.schedule('x', () => done.push(99));
    q.cancel('x');
    expect(q.flush()).toBe(3);
    expect(done).toEqual([0, 1, 2]);
    expect(q.runNext()).toBe(false);
  });

  it('ein Fehler in einer Aufgabe hält die Warteschlange nicht an', () => {
    const { post, pending } = manualPost();
    const q = new IdleQueue(post);
    const done: string[] = [];
    q.schedule('bad', () => {
      throw new Error('kaputt');
    });
    q.schedule('good', () => done.push('good'));
    expect(() => pending.shift()!()).toThrow('kaputt');
    expect(pending).toHaveLength(1);
    pending.shift()!();
    expect(done).toEqual(['good']);
  });

  it('Standard ohne requestIdleCallback: setTimeout', () => {
    vi.useFakeTimers();
    try {
      const q = new IdleQueue();
      const done: string[] = [];
      q.schedule('a', () => done.push('a'));
      expect(done).toEqual([]);
      vi.runAllTimers();
      expect(done).toEqual(['a']);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Canvas-Stub, der alle Aufrufe protokolliert
// ---------------------------------------------------------------------------

interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  props: string[];
  getContext: (type: string) => CanvasRenderingContext2D;
}

let canvases: StubCanvas[] = [];
let totalCalls = 0;

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, calls: [], props: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop() {}, data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        totalCalls++;
        canvas.calls.push({ name: String(prop), args });
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      canvas.props.push(`${String(prop)}=${typeof value === 'object' ? 'obj' : String(value)}`);
      canvas.calls.push({ name: `${String(prop)}=`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return canvas;
}

beforeEach(() => {
  canvases = [];
  totalCalls = 0;
  vi.stubGlobal('document', {
    createElement: () => {
      const c = makeCanvas();
      canvases.push(c);
      return c;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const animals: SceneAnimal[] = [{ id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: 1 }];

/** Nacht (Mitternacht) mit Nebel: die Ebenen sind getönt. */
function night(extra: Partial<SceneInput> = {}): SceneInput {
  return { growth: 4.2, time: 0, animals, sizeSettled: true, dayPhase: 0, weather: 'fog', season: 0.2, meadow: true, wall: true, ...extra };
}

function draw(canvas: StubCanvas, input: SceneInput): number {
  const before = totalCalls;
  drawScene(canvas.getContext('2d'), 400, 300, input);
  return totalCalls - before;
}

describe('drawScene mit Leerlauf-Warteschlange', () => {
  it('neue Jahreszeit-Stufe: der Frame bleibt billig, Kulisse und Tönung folgen in Leerlaufzeit', () => {
    const { post } = manualPost();
    const idle = new IdleQueue(post);
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    // Erster Aufbau: synchron (es gibt noch kein Bild zum Weiterzeigen).
    draw(canvas, night({ idle, time: 1 }));
    expect(idle.size).toBe(0);
    const plain = draw(canvas, night({ idle, time: 1.02 }));
    const s0 = sceneCacheStats(el)!;

    // 0,2 → 0,26: neue Stufe (0,25). Im Frame nichts neu, nur eingeplant.
    const stepped = draw(canvas, night({ idle, time: 1.04, season: 0.26 }));
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds);
    expect(sceneCacheStats(el)!.tintBuilds).toBe(s0.tintBuilds);
    expect(idle.has('season')).toBe(true);
    expect(stepped).toBeLessThan(plain * 1.5);
    // Weitere Frames bis zur Leerlaufzeit: kein zweiter Auftrag, nichts neu.
    draw(canvas, night({ idle, time: 1.06, season: 0.26 }));
    expect(idle.size).toBe(1);

    // Leerlauf: Kulisse und Ebenen neu …
    idle.runNext();
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds + 1);
    // … der nächste Frame plant die Tönung in Stücken (Kulisse, hinten, vorn, Rest).
    draw(canvas, night({ idle, time: 1.08, season: 0.26 }));
    expect(idle.has('tint')).toBe(true);
    let stages = 0;
    while (idle.runNext()) {
      stages++;
      // Zwischen den Stücken: Frames zeigen den alten Stand, ohne neu zu tönen.
      draw(canvas, night({ idle, time: 1.1 + stages * 0.02, season: 0.26 }));
    }
    expect(stages).toBe(4);
    expect(sceneCacheStats(el)!.tintBuilds).toBe(s0.tintBuilds + 1);
    // Danach: ruhig, nichts mehr eingeplant.
    draw(canvas, night({ idle, time: 1.3, season: 0.26 }));
    expect(idle.size).toBe(0);
  });

  it('gleiches Endbild wie ohne Warteschlange (Aufrufe des sichtbaren Canvas)', () => {
    const run = (withIdle: boolean): string => {
      const idle = withIdle ? new IdleQueue(manualPost().post) : undefined;
      const canvas = makeCanvas(800, 600);
      draw(canvas, night({ idle, time: 1 }));
      draw(canvas, night({ idle, time: 1.02, season: 0.26 }));
      idle?.flush();
      draw(canvas, night({ idle, time: 1.04, season: 0.26 }));
      idle?.flush();
      canvas.calls.length = 0;
      draw(canvas, night({ idle, time: 2, season: 0.26 }));
      return JSON.stringify(canvas.calls.map((c) => [c.name, c.args.map((a) => (typeof a === 'number' ? a.toFixed(3) : typeof a))]));
    };
    expect(run(true)).toBe(run(false));
  });

  it('ohne Warteschlange wie bisher: neue Stufe sofort im Frame', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    draw(canvas, night({ time: 1 }));
    const s0 = sceneCacheStats(el)!;
    draw(canvas, night({ time: 1.02, season: 0.26 }));
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds + 1);
    expect(sceneCacheStats(el)!.tintBuilds).toBe(s0.tintBuilds + 1);
  });

  it('Größenänderung bleibt synchron (kein veraltetes Bild in falscher Größe)', () => {
    const idle = new IdleQueue(manualPost().post);
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    draw(canvas, night({ idle, time: 1 }));
    const s0 = sceneCacheStats(el)!;
    canvas.width = 600;
    canvas.height = 600;
    drawScene(canvas.getContext('2d'), 300, 300, night({ idle, time: 1.02 }));
    expect(sceneCacheStats(el)!.staticBuilds).toBeGreaterThan(s0.staticBuilds);
    expect(sceneCacheStats(el)!.tintBuilds).toBe(s0.tintBuilds + 1);
  });

  /** Skalierung des ersten setTransform eines Frames (2 = Basis vergrößert, 1 = Detail-Ebenen). */
  function scaleOf(canvas: StubCanvas, input: SceneInput): number {
    canvas.calls.length = 0;
    drawScene(canvas.getContext('2d'), 400, 300, input);
    const t = canvas.calls.find((c) => c.name === 'setTransform');
    return t ? (t.args[0] as number) : Number.NaN;
  }

  it('Zoom: Detail-Ebenen entstehen in Leerlaufzeit, bis dahin die Basis vergrößert', () => {
    const idle = new IdleQueue(manualPost().post);
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    const cam = { zoom: 2, x: 0.4, y: 0.6 };
    scaleOf(canvas, night({ idle, time: 1 }));
    expect(scaleOf(canvas, night({ idle, time: 1.02, camera: cam }))).toBe(2);
    const s0 = sceneCacheStats(el)!;
    // Kamera ruht: eingeplant, aber noch nichts gebaut – weiter die vergrößerte Basis.
    expect(scaleOf(canvas, night({ idle, time: 1.04 + RESIZE_SETTLE_SECONDS, camera: cam }))).toBe(2);
    expect(idle.has('detail')).toBe(true);
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds);
    // Erstes Stück: Satz gebaut (noch nicht gezeigt, die Tönung fehlt).
    idle.runNext();
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds + 1);
    expect(scaleOf(canvas, night({ idle, time: 1.1 + RESIZE_SETTLE_SECONDS, camera: cam }))).toBe(2);
    idle.flush();
    // Fertig: scharfe Detail-Ebenen 1:1, ohne weiteren Aufbau im Frame.
    expect(scaleOf(canvas, night({ idle, time: 1.2 + RESIZE_SETTLE_SECONDS, camera: cam }))).toBe(1);
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds + 1);
    expect(idle.size).toBe(0);
  });

  it('Zoom: bewegt sich die Kamera vor dem Leerlauf, wird nichts gebaut', () => {
    const idle = new IdleQueue(manualPost().post);
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    scaleOf(canvas, night({ idle, time: 1 }));
    scaleOf(canvas, night({ idle, time: 1.02, camera: { zoom: 2, x: 0.4, y: 0.6 } }));
    scaleOf(canvas, night({ idle, time: 1.04 + RESIZE_SETTLE_SECONDS, camera: { zoom: 2, x: 0.4, y: 0.6 } }));
    const s0 = sceneCacheStats(el)!;
    scaleOf(canvas, night({ idle, time: 1.06 + RESIZE_SETTLE_SECONDS, camera: { zoom: 2, x: 0.45, y: 0.6 } }));
    idle.flush();
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds);
    // Zurück auf 1×: auch nichts mehr eingeplant.
    scaleOf(canvas, night({ idle, time: 2 }));
    scaleOf(canvas, night({ idle, time: 2.1 + RESIZE_SETTLE_SECONDS }));
    expect(idle.size).toBe(0);
  });
});

describe('Kuppe von Waldwiese und Trockenmauer im Nebel (K2)', () => {
  /** Rückt die getönte Kulisse die Kuppe aus dem Dunst (Kopie der Kulisse mit Deckkraft 0,7)? */
  function restoresKnoll(input: SceneInput): boolean {
    canvases = [];
    const canvas = makeCanvas(800, 600);
    draw(canvas, input);
    return canvases.some((c) => {
      const i = c.calls.findIndex((x) => x.name === 'globalAlpha=' && Math.abs((x.args[0] as number) - 0.7) < 1e-9);
      return i >= 0 && c.calls.slice(Math.max(0, i - 40), i).some((x) => x.name === 'clip') && c.calls.slice(i).some((x) => x.name === 'drawImage');
    });
  }

  it('nur bei Nebel und offenem Lebensraum', () => {
    expect(restoresKnoll(night({ time: 1 }))).toBe(true);
    expect(restoresKnoll(night({ time: 1, dayPhase: 0.5 }))).toBe(true);
    expect(restoresKnoll(night({ time: 1, meadow: false, wall: false }))).toBe(false);
    expect(restoresKnoll(night({ time: 1, weather: 'rain' }))).toBe(false);
  });

  it('Umriss: Kuppen bzw. Mauerkörper je offenem Lebensraum, deterministisch', () => {
    const layout = makeLayout(800, 600);
    const path = (mask: number): string[] => {
      const c = makeCanvas(800, 600);
      midgroundPath(c.getContext('2d'), layout, mask);
      return c.calls.map((x) => `${x.name}(${x.args.map((a) => (a as number).toFixed(2)).join(',')})`);
    };
    expect(path(0)).toEqual(['beginPath()']);
    const meadow = path(MIDGROUND_MEADOW);
    const wall = path(MIDGROUND_WALL);
    const both = path(MIDGROUND_MEADOW | MIDGROUND_WALL);
    expect(meadow.filter((s) => s.startsWith('moveTo'))).toHaveLength(1);
    // Mauer: Kuppe und Mauerkörper (abgerundetes Viereck).
    expect(wall.filter((s) => s.startsWith('moveTo'))).toHaveLength(2);
    expect(both).toEqual(['beginPath()', ...wall.slice(1), ...meadow.slice(1)]);
    expect(path(MIDGROUND_MEADOW)).toEqual(meadow);
    // Kuppen rechts bzw. links der Mitte.
    const x = (s: string): number => Number(s.slice(s.indexOf('(') + 1, s.indexOf(',')));
    expect(x(meadow[1]!)).toBeGreaterThan(layout.width / 2 - 200);
    expect(x(wall[1]!)).toBeLessThan(layout.width / 2);
  });
});
