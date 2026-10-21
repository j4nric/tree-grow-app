import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CYCLE_TRANSITION_REDUCED_SECONDS, CYCLE_TRANSITION_SECONDS, cycleElapsed, cyclePhase } from '../src/render/cycle';
import { drawScene, memoryGrowth, type SceneInput } from '../src/render/tree';

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

/** Aufrufe vergleichbar machen: Name und Zahlen (Canvas-Objekte sind je Szene andere). */
function signature(calls: StubCanvas['calls']): string[] {
  return calls.map((c) => `${c.name}(${c.args.map((a) => (typeof a === 'number' ? a.toFixed(3) : typeof a)).join(',')})`);
}

const W = 800;
const H = 600;

/** Spielt eine Szene: erst der alte Baum (g = 6), ab t = 1 der neue Zyklus (g = 0). */
function play(times: number[], extra: (t: number) => Partial<SceneInput>): StubCanvas {
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (const t of times) {
    canvas.calls.length = 0;
    drawScene(ctx, W, H, { growth: t < 1 ? 6 : 0, time: t, animals: [], ...extra(t) });
  }
  return canvas;
}

const TIMES = [0, 0.3, 0.6, 1, 1.5, 2, 3, 4, 5, 6, 6.6, 7, 8];

describe('Zyklus-Übergang: Ablauf', () => {
  it('blendet das alte Bild aus und endet nach der angegebenen Dauer', () => {
    const a = cyclePhase(0, false);
    expect(a.frame).toBe(1);
    expect(a.done).toBe(false);
    let prev = 1;
    for (let u = 0; u <= CYCLE_TRANSITION_SECONDS; u += 0.05) {
      const p = cyclePhase(u, false);
      expect(p.frame).toBeLessThanOrEqual(prev + 1e-9);
      prev = p.frame;
    }
    expect(cyclePhase(CYCLE_TRANSITION_SECONDS - 0.01, false).done).toBe(false);
    expect(cyclePhase(CYCLE_TRANSITION_SECONDS, false).done).toBe(true);
    const end = cyclePhase(CYCLE_TRANSITION_SECONDS - 0.01, false);
    expect(end.frame + end.silhouette + end.glow + end.seedGlow).toBeLessThan(0.02);
    // Die Eichel fällt in der Mitte der Sequenz.
    expect(cyclePhase(2.5, false).acorn).toBeGreaterThan(0);
    expect(cyclePhase(1, false).acorn).toBe(-1);
  });

  it('ändert Helligkeiten nur langsam (keine Blitze, Rücksicht auf Lichtempfindlichkeit)', () => {
    const du = 0.01;
    for (let u = 0; u < CYCLE_TRANSITION_SECONDS; u += du) {
      const a = cyclePhase(u, false);
      const b = cyclePhase(u + du, false);
      for (const k of ['frame', 'silhouette', 'glow', 'seedGlow'] as const) {
        expect(Math.abs(b[k] - a[k]) / du, `${k} bei ${u.toFixed(2)} s`).toBeLessThan(2);
      }
    }
  });

  it('bei weniger Bewegung nur eine kurze Überblendung', () => {
    const p = cyclePhase(0.3, true);
    expect(p.frame).toBeGreaterThan(0);
    expect(p.frame).toBeLessThan(1);
    expect(p.silhouette + p.glow + p.seedGlow).toBe(0);
    expect(p.acorn).toBe(-1);
    expect(cyclePhase(CYCLE_TRANSITION_REDUCED_SECONDS, true).done).toBe(true);
  });
});

describe('Zyklus-Übergang: Zeitfenster', () => {
  it('gilt von bis zu 1 s vor dem Start bis zum Ende, sonst nicht', () => {
    expect(cycleElapsed(10, 10, false)).toBe(0);
    expect(cycleElapsed(9.5, 10, false)).toBe(0);
    expect(cycleElapsed(8.5, 10, false)).toBeNaN();
    expect(cycleElapsed(12, 10, false)).toBe(2);
    expect(cycleElapsed(10 + CYCLE_TRANSITION_SECONDS, 10, false)).toBeNaN();
    expect(cycleElapsed(10.9, 10, true)).toBeNaN();
    expect(cycleElapsed(Number.NaN, 10, false)).toBeNaN();
    expect(cycleElapsed(10, Number.NaN, false)).toBeNaN();
  });
});

/** Übergang aus dem alten Baum (g = 6) mit Start bei `at`. */
const from = (at: number): Partial<SceneInput> => ({ cycleTransition: { startedAt: at, fromGrowth: 6 } });

describe('Zyklus-Übergang in der Szene', () => {
  it('zeichnet ohne die neuen Felder (und mit Waldgedächtnis 0) genau wie bisher', () => {
    const plain = signature(play(TIMES, () => ({})).calls);
    expect(signature(play(TIMES, () => ({ cycleTransition: undefined, forestMemory: undefined })).calls)).toEqual(plain);
    expect(signature(play(TIMES, () => ({ forestMemory: 0 })).calls)).toEqual(plain);
  });

  it('zeichnet während der Sequenz zusätzlich und danach wieder genau die Stufe 0', () => {
    const plain = (t: number) => signature(play(TIMES.filter((x) => x <= t), () => ({})).calls);
    const withCycle = (t: number) => signature(play(TIMES.filter((x) => x <= t), (x) => (x >= 1 ? from(1) : {})).calls);
    for (const t of [1, 2, 3, 5]) expect(withCycle(t).length, `t=${t}`).toBeGreaterThan(plain(t).length);
    // Ende (1 + 5,5 s): pixelgleich – gleiche Aufrufe wie ohne das Feld.
    for (const t of [6.6, 8]) expect(withCycle(t), `t=${t}`).toEqual(plain(t));
  });

  it('bei weniger Bewegung endet die Überblendung nach 0,8 s', () => {
    const reduced = (cycle: boolean, until: number) =>
      signature(
        play(
          [0, 0.5, 1, 1.3, 1.6, 1.9, 2.5].filter((x) => x <= until),
          (x) => ({ reducedMotion: true, ...(cycle && x >= 1 ? from(1) : {}) }),
        ).calls,
      );
    expect(reduced(true, 1.3).length).toBeGreaterThan(reduced(false, 1.3).length);
    expect(reduced(true, 1.9)).toEqual(reduced(false, 1.9));
  });

  it('hängt nur von der Eingabe ab: Reihenfolge der Frames, Neustart und Neuladen', () => {
    // Gleicher Frame (t = 2,5) – frisch, nach anderer Reihenfolge, nach einem Neustart.
    const fresh = signature(play([2.5], () => ({ ...from(1), growth: 0 })).calls);
    const shuffled = signature(play([1, 4, 1.5, 2.5], () => ({ ...from(1), growth: 0 })).calls);
    const restarted = signature(play([0, 0.5, 1.2, 2.5], (x) => (x < 1 ? from(0) : from(1))).calls);
    expect(shuffled).toEqual(fresh);
    expect(restarted).toEqual(fresh);
  });

  it('zeichnet nach einer Größenänderung mitten in der Sequenz wie frisch in der neuen Größe', () => {
    const canvas = makeCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    for (const t of [0, 0.5, 1]) drawScene(ctx, 400, 300, { growth: 0, time: t, ...from(1) });
    // Neue Größe im selben Frame; nach dem Entprellen (~150 ms) gilt sie.
    canvas.width = 600;
    for (const t of [1.05, 1.2, 1.4]) {
      canvas.calls.length = 0;
      drawScene(ctx, 600, 300, { growth: 0, time: t, ...from(1) });
    }
    const fresh = makeCanvas(600, 300);
    drawScene(fresh.getContext('2d'), 600, 300, { growth: 0, time: 1.4, ...from(1) });
    expect(signature(canvas.calls)).toEqual(signature(fresh.calls));
  });

  it('Start in der Zukunft: bis 1 s gilt „jetzt“, weiter wird verworfen', () => {
    const plain = signature(play([5], () => ({ growth: 0 })).calls);
    const soon = signature(play([5], () => ({ ...from(5.5), growth: 0 })).calls);
    const now = signature(play([5], () => ({ ...from(5), growth: 0 })).calls);
    const far = signature(play([5], () => ({ ...from(9), growth: 0 })).calls);
    expect(soon).toEqual(now);
    expect(soon.length).toBeGreaterThan(plain.length);
    expect(far).toEqual(plain);
  });

  it('ungültige Zeit und Zeitsprung zurück: nichts zusätzlich, Kopien frei', () => {
    const plainNaN = signature(play([0, Number.NaN], () => ({ growth: 0 })).calls);
    expect(signature(play([0, Number.NaN], () => ({ ...from(0), growth: 0 })).calls)).toEqual(plainNaN);
    // Zeitsprung zurück (z. B. neue Uhr): hartes Ende.
    const plainBack = signature(play([1, 2, -10], () => ({ growth: 0 })).calls);
    expect(signature(play([1, 2, -10], () => ({ ...from(1), growth: 0 })).calls)).toEqual(plainBack);
  });

  it('spielt eine längst vergangene Sequenz (z. B. nach dem Neuladen) nicht nach', () => {
    const late = signature(play([10, 10.5], () => ({ growth: 0, ...from(1) })).calls);
    const plain = signature(play([10, 10.5], () => ({ growth: 0 })).calls);
    expect(late).toEqual(plain);
  });

  it('gibt die Kopien nach dem Ende frei', () => {
    const created: StubCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const c = makeCanvas();
        created.push(c);
        return c;
      },
    });
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawScene(ctx, W, H, { growth: 0, time: 1, ...from(1) });
    const count = created.length;
    drawScene(ctx, W, H, { growth: 0, time: 2, ...from(1) });
    // Keine neuen Kopien während der Sequenz …
    expect(created.length).toBe(count);
    drawScene(ctx, W, H, { growth: 0, time: 8, ...from(1) });
    // … und danach auf Größe 0 gesetzt (Speicher frei, auch in Safari).
    expect(created.filter((c) => c.width === 0 && c.height === 0).length).toBeGreaterThanOrEqual(3);
  });

  it('verkraftet ungültige Werte', () => {
    const bad = play(TIMES, (x) => (x >= 1 ? { cycleTransition: { startedAt: Number.NaN, fromGrowth: 6 } } : {}));
    expect(signature(bad.calls)).toEqual(signature(play(TIMES, () => ({})).calls));
    const nanGrowth = play([1, 2], () => ({ growth: 0, cycleTransition: { startedAt: 1, fromGrowth: Number.NaN } }));
    for (const c of nanGrowth.calls) for (const a of c.args) if (typeof a === 'number') expect(Number.isFinite(a)).toBe(true);
  });
});

describe('Erinnerungsbaum (Waldgedächtnis)', () => {
  it('fehlt ohne Gedächtnis und wächst langsam bis zur Obergrenze', () => {
    for (const m of [undefined, 0, 0.5, -3, Number.NaN]) expect(memoryGrowth(m)).toBe(0);
    let prev = 0;
    for (const m of [1, 10, 33, 100, 300, 1000]) {
      const g = memoryGrowth(m);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(3);
      expect(g).toBeLessThanOrEqual(6.5);
      prev = g;
    }
    expect(memoryGrowth(1000)).toBe(6.5);
    expect(memoryGrowth(5000)).toBe(6.5);
  });

  it('liegt in einer eigenen Ebene: Wachstumsschritte zeichnen ihn nicht neu', () => {
    const created: StubCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const c = makeCanvas();
        created.push(c);
        return c;
      },
    });
    const offscreen = (ctx: CanvasRenderingContext2D, input: SceneInput) => {
      for (const c of created) c.calls.length = 0;
      drawScene(ctx, W, H, input);
      return created.reduce((n, c) => n + c.calls.length, 0);
    };
    const a = makeCanvas(W, H).getContext('2d');
    const b = makeCanvas(W, H).getContext('2d');
    expect(offscreen(a, { growth: 2, time: 0, forestMemory: 300 })).toBeGreaterThan(offscreen(b, { growth: 2, time: 0 }));
    // Wachstumsschritt: gleich viel Zeichenarbeit mit und ohne Erinnerungsbaum.
    expect(offscreen(a, { growth: 2.5, time: 1, forestMemory: 300 })).toBe(offscreen(b, { growth: 2.5, time: 1 }));
    // Kleine Änderung des Gedächtnisses (gleiche Rundung): nichts neu; größere: nur er.
    expect(offscreen(a, { growth: 2.5, time: 1.1, forestMemory: 301 })).toBe(0);
    expect(offscreen(a, { growth: 2.5, time: 1.2, forestMemory: 900 })).toBeGreaterThan(0);
    expect(offscreen(a, { growth: 2.5, time: 1.3, forestMemory: 900 })).toBe(0);
  });
});
