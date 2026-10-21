import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_BUCKETS,
  DayLayer,
  TINT_STEPS,
  bucketPhase,
  dayBucket,
  dayLevels,
  isBrightDay,
  normalizeDayPhase,
  tintCopy,
  tintLevels,
  tintRgb,
  type DayFrame,
} from '../src/render/daylight';
import { drawScene, type SceneInput } from '../src/render/tree';

/** Canvas-Stub wie in render-mood.test.ts: protokolliert nur die Aufrufe. */
interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

/** Wie viele Canvases angelegt wurden (Caches) – und alle, um Aufrufe auch in Kopien zu zählen. */
let created = 0;
let all: StubCanvas[] = [];

/** Anzahl der Aufrufe `name` über alle Canvases (Szene und Caches). */
function allCalls(name: string): number {
  let n = 0;
  for (const c of all) for (const call of c.calls) if (call.name === name) n++;
  return n;
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
  all.push(canvas);
  return canvas;
}

beforeEach(() => {
  created = 0;
  all = [];
  vi.stubGlobal('document', {
    createElement: () => {
      created++;
      return makeCanvas();
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tageszeit: Stärken und Stufen', () => {
  it('normalisiert den Tagesanteil (ungültig → null, sonst modulo 1)', () => {
    expect(normalizeDayPhase(undefined)).toBeNull();
    expect(normalizeDayPhase(Number.NaN)).toBeNull();
    expect(normalizeDayPhase(Infinity)).toBeNull();
    expect(normalizeDayPhase(1.25)).toBeCloseTo(0.25);
    expect(normalizeDayPhase(-0.25)).toBeCloseTo(0.75);
    expect(normalizeDayPhase(1)).toBe(0);
  });

  it('heller Tag ist neutral, Mitternacht volle Nacht, Dämmerung um Sonnenauf- und -untergang', () => {
    for (const p of [0.3, 0.4, 0.5, 0.6, 0.7]) expect(isBrightDay(dayLevels(p))).toBe(true);
    const midnight = dayLevels(0);
    expect(midnight.night).toBe(1);
    expect(midnight.twilight).toBe(0);
    expect(midnight.sun).toBe(0);
    for (const p of [0.22, 0.25, 0.75, 0.78]) expect(dayLevels(p).twilight).toBeGreaterThan(0.3);
    expect(dayLevels(0.22).dusk).toBe(false);
    expect(dayLevels(0.78).dusk).toBe(true);
    // Volle Nacht etwa ein Drittel des Tages, heller Tag fast die Hälfte.
    let fullNight = 0;
    let bright = 0;
    for (let i = 0; i < 1000; i++) {
      const lv = dayLevels(i / 1000);
      if (lv.night >= 0.999) fullNight++;
      if (isBrightDay(lv)) bright++;
    }
    expect(fullNight / 1000).toBeGreaterThan(0.28);
    expect(fullNight / 1000).toBeLessThan(0.38);
    expect(bright / 1000).toBeGreaterThan(0.4);
  });

  it('ändert sich stufenlos (kein Sprung zwischen benachbarten Werten)', () => {
    let prev = { ...dayLevels(0) };
    for (let i = 1; i <= 2000; i++) {
      const lv = dayLevels(i / 2000);
      expect(Math.abs(lv.night - prev.night)).toBeLessThan(0.02);
      expect(Math.abs(lv.twilight - prev.twilight)).toBeLessThan(0.025);
      prev = { ...lv };
    }
  });

  it('Stufen: Mitternacht 0, Mittag DAY_BUCKETS / 2, rund um den Tag', () => {
    expect(dayBucket(0)).toBe(0);
    expect(dayBucket(0.5)).toBe(DAY_BUCKETS / 2);
    expect(dayBucket(0.999)).toBe(0);
    expect(dayBucket(Number.NaN)).toBe(DAY_BUCKETS / 2);
    for (let b = 0; b < DAY_BUCKETS; b++) {
      expect(dayBucket(bucketPhase(b))).toBe(b);
      // Alle Werte innerhalb einer Stufe ergeben dieselbe Stufe.
      expect(dayBucket(bucketPhase(b) + 0.4 / DAY_BUCKETS)).toBe(b);
      expect(dayBucket(bucketPhase(b) - 0.4 / DAY_BUCKETS)).toBe(b);
    }
    expect(bucketPhase(-1)).toBeCloseTo(1 - 1 / DAY_BUCKETS);
  });

  it('Lichtfarbe: tags weiß (keine Wirkung), nachts gedämpft und bläulich, aber lesbar', () => {
    expect(tintRgb(dayLevels(0.5))).toEqual([255, 255, 255]);
    const night = tintRgb(dayLevels(0));
    expect(night[2]!).toBeGreaterThan(night[0]!);
    // Lesbar: Landschaft nicht dunkler als ~45 % (rot) bzw. ~65 % (blau).
    expect(night[0]!).toBeGreaterThan(0.45 * 255);
    expect(night[2]!).toBeGreaterThan(0.65 * 255);
    // Abends wärmer als morgens.
    const dawn = tintRgb(dayLevels(0.24));
    const dusk = tintRgb(dayLevels(0.76));
    expect(dusk[2]!).toBeLessThan(dawn[2]!);
  });

  it('Tönungsstufen: gerundet auf 1 / TINT_STEPS, gleicher Schlüssel innerhalb einer Stufe, −1 am Tag', () => {
    expect(tintLevels(dayLevels(0.5))).toBe(-1);
    expect(tintLevels(dayLevels(0))).toBe(tintLevels(dayLevels(0.05)));
    const out = { night: 0, twilight: 0, dusk: false, sun: 1 };
    const keys = new Set<number>();
    let changes = 0;
    let prev = -1;
    for (let i = 0; i < 4800; i++) {
      const key = tintLevels(dayLevels(i / 4800), out);
      expect(out.night * TINT_STEPS).toBeCloseTo(Math.round(out.night * TINT_STEPS), 9);
      expect(out.twilight * TINT_STEPS).toBeCloseTo(Math.round(out.twilight * TINT_STEPS), 9);
      keys.add(key);
      if (key !== prev) changes++;
      prev = key;
    }
    // Neu getönt wird nur ein paar Dutzend Mal am Tag (nicht pro Frame).
    expect(changes).toBeGreaterThan(20);
    expect(changes).toBeLessThan(90);
    expect(keys.size).toBeGreaterThan(10);
  });

  it('getönte Kopie: Bereich der Vorlage, multiply, dann wieder in ihrer Form', () => {
    const src = makeCanvas(100, 80) as unknown as HTMLCanvasElement;
    const copy = tintCopy(src, { x: 10, y: 20, w: 30, h: 40 }, null, 'rgb(1, 2, 3)') as unknown as StubCanvas;
    expect(copy.width).toBe(30);
    expect(copy.height).toBe(40);
    expect(copy.calls.map((c) => c.name)).toEqual(['setTransform', 'drawImage', 'fillRect', 'drawImage']);
    // Wiederverwendet bei gleicher Größe (kein neues Canvas).
    const before = created;
    tintCopy(src, { x: 0, y: 0, w: 30, h: 40 }, copy as unknown as HTMLCanvasElement, 'rgb(1, 2, 3)');
    expect(created).toBe(before);
  });
});

function frame(time: number, over: Partial<DayFrame> = {}): DayFrame {
  return { width: 400, height: 800, groundY: 500, dpr: 2, sx: 1, sy: 1, tx: 0, ty: 0, baseDpr: 2, time, reducedMotion: false, ...over };
}

describe('Tag-und-Nacht-Ebene', () => {
  it('ohne Angabe und am hellen Tag: nichts zu zeichnen', () => {
    const d = new DayLayer();
    expect(d.update(undefined, 0, false)).toBeNull();
    expect(d.update(0.5, 0, false)).toBeNull();
    const other = new DayLayer();
    expect(other.update(0, 0, false)).not.toBeNull();
  });

  it('folgt dem normalen Fortschreiten direkt und gleitet bei Sprüngen (über Mitternacht den kurzen Weg)', () => {
    const d = new DayLayer();
    d.update(0.95, 0, false);
    d.update(0.952, 1 / 60, false);
    expect(d.phase).toBeCloseTo(0.952);
    // Sprung auf den Morgen (z. B. Neuer Zyklus): stufenlos, vorwärts über Mitternacht.
    let prev = d.phase;
    let t = 1 / 60;
    for (let i = 0; i < 600; i++) {
      t += 1 / 60;
      d.update(0.3, t, false);
      let step = d.phase - prev;
      if (step < -0.5) step += 1;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(0.15 / 60 + 1e-9);
      prev = d.phase;
    }
    expect(d.phase).toBeCloseTo(0.3);
    // Weniger Bewegung: sofort.
    d.update(0, t + 1 / 60, true);
    expect(d.phase).toBe(0);
  });

  it('weniger Bewegung: nur Stufen – innerhalb einer Stufe identische Stärken', () => {
    const d = new DayLayer();
    const a = { ...d.update(0.21, 0, true)! };
    const b = { ...d.update(0.21 + 0.3 / DAY_BUCKETS, 1, true)! };
    expect(b).toEqual(a);
    expect(a).toEqual({ ...d.bucketLevels(dayBucket(0.21)) });
    // Ohne reduzierte Bewegung stufenlos.
    const e = new DayLayer();
    const c = { ...e.update(0.21, 0, false)! };
    const f = { ...e.update(0.21 + 0.3 / DAY_BUCKETS, 1 / 60, false)! };
    expect(f.night).not.toBe(c.night);
  });

  it('Lichtfarbe nur bei neuer Tönungsstufe neu; Sterne und Mond ohne ungültige Werte, auch gezoomt', () => {
    const d = new DayLayer();
    d.update(0.02, 0, false);
    const fill = d.tintFill;
    const key = d.tintKey;
    d.update(0.021, 1 / 60, false);
    expect(d.tintKey).toBe(key);
    expect(d.tintFill).toBe(fill);
    const canvas = makeCanvas(1200, 900);
    const ctx = canvas.getContext('2d');
    for (const p of [0, 0.2, 0.25, 0.75, 0.8, 0.95]) {
      for (const reducedMotion of [false, true]) {
        const lv = d.update(p, 1, reducedMotion);
        expect(lv).not.toBeNull();
        d.drawLights(ctx, lv!, frame(1, { reducedMotion }));
        d.drawLights(ctx, lv!, frame(1, { reducedMotion, sx: 0.5, sy: 0.5, dpr: 8, tx: -900, ty: -400 }));
      }
    }
    const bad = canvas.calls.filter(
      (c) => (c.name === 'setTransform' || c.name === 'drawImage') && c.args.some((a) => typeof a === 'number' && !Number.isFinite(a)),
    );
    expect(bad).toEqual([]);
    expect(canvas.calls.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(20);
  });
});

describe('Szene mit Tageszeit', () => {
  const base: SceneInput = { growth: 5.5, time: 3, animals: [], plants: [], harmonyTier: 4, season: 1.2 };

  function run(input: SceneInput, frames = 2, w = 800, h = 600): StubCanvas {
    const canvas = makeCanvas(w * 2, h * 2);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < frames; i++) drawScene(ctx, w, h, { ...input, time: input.time + i / 60 });
    return canvas;
  }

  it('am hellen Tag (und bei ungültigem Wert) genau wie ohne Angabe', () => {
    const plain = run(base).calls.map((c) => c.name);
    expect(run({ ...base, dayPhase: 0.5 }).calls.map((c) => c.name)).toEqual(plain);
    expect(run({ ...base, dayPhase: 0.4 }).calls.map((c) => c.name)).toEqual(plain);
    expect(run({ ...base, dayPhase: Number.NaN }).calls.map((c) => c.name)).toEqual(plain);
  });

  it('nachts: wirft nie – auch mit Kamera, Winter, Zyklus-Übergang und Glühwürmchen', () => {
    for (const [w, h] of [
      [1280, 800],
      [390, 844],
    ] as const) {
      for (const reducedMotion of [false, true]) {
        for (const extra of [
          {},
          { season: 3 },
          { camera: { zoom: 3, x: 0.3, y: 0.4 } },
          { cycleTransition: { startedAt: 2.5, fromGrowth: 6 } },
          { animals: [{ id: 'glowworm', family: 'insect', niche: 'edge', slot: 0, happiness: 0.9 }] },
        ] as Partial<SceneInput>[]) {
          const input = { ...base, ...extra, dayPhase: 0.02, reducedMotion };
          let canvas: StubCanvas | null = null;
          expect(() => (canvas = run(input, 3, w, h))).not.toThrow();
          const bad = canvas!.calls.filter((c) => c.name === 'setTransform' && c.args.some((a) => !Number.isFinite(a as number)));
          expect(bad).toEqual([]);
        }
      }
    }
  });

  it('pro Frame keine Fläche über das ganze Canvas – die Tönung steckt in den Kopien der Ebenen', () => {
    const full = (c: StubCanvas) => c.calls.filter((x) => x.name === 'fillRect' && x.args[0] === 0 && x.args[1] === 0 && x.args[2] === 1600 && x.args[3] === 1200).length;
    const canvas = makeCanvas(1600, 1200);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 4; i++) drawScene(ctx, 800, 600, { ...base, dayPhase: 0, time: 3 + i / 60 });
    expect(full(canvas)).toBe(0);
  });

  it('nutzt die Caches weiter: innerhalb einer Tönungsstufe wird nicht neu getönt, bei neuer Stufe schon', () => {
    const canvas = makeCanvas(1600, 1200);
    const ctx = canvas.getContext('2d');
    const input: SceneInput = { ...base, harmonyTier: undefined, dayPhase: 0.01 };
    for (let i = 0; i < 5; i++) drawScene(ctx, 800, 600, { ...input, time: 3 + i / 60 });
    const madeBefore = created;
    const tintsBefore = allCalls('createLinearGradient');
    // Gleiche Stufe (volle Nacht), Zeit läuft: keine neuen Canvases, keine neuen Verläufe.
    for (let i = 5; i < 30; i++) drawScene(ctx, 800, 600, { ...input, dayPhase: 0.01 + i * 1e-4, time: 3 + i / 60 });
    expect(created).toBe(madeBefore);
    expect(allCalls('createLinearGradient')).toBe(tintsBefore);
    // Andere Stufe (Dämmerung): neu getönt (Himmel-Verläufe in der Kopie), ohne neue Canvases.
    drawScene(ctx, 800, 600, { ...input, dayPhase: 0.24, reducedMotion: true, time: 4 });
    const afterDawn = allCalls('createLinearGradient');
    expect(afterDawn).toBeGreaterThan(tintsBefore);
    expect(created).toBe(madeBefore);
    // Heller Tag: Kopien werden freigegeben, nichts mehr getönt.
    drawScene(ctx, 800, 600, { ...input, dayPhase: 0.5, reducedMotion: true, time: 5 });
    drawScene(ctx, 800, 600, { ...input, dayPhase: 0.5, reducedMotion: true, time: 5.1 });
    expect(allCalls('createLinearGradient')).toBe(afterDawn);
  });
});

