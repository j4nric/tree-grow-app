import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEATHERS, WEATHER_BLEND_SECONDS } from '../src/content/weather';
import { sceneWeather } from '../src/core/weather';
import {
  batFlight,
  batFlying,
  nightWake,
  nocturnalPace,
  owlDozing,
  owlPose,
  NOCTURNAL_KINDS,
} from '../src/render/nocturnal';
import { drawScene, hitTestAnimal, type SceneAnimal, type SceneInput } from '../src/render/tree';
import {
  fallProgress,
  isClearWeather,
  MAX_GUST_LEAVES,
  MAX_RAIN,
  MAX_SNOW,
  maxStormSkew,
  mixWeather,
  normalizeBlend,
  normalizeWeather,
  ParticlePool,
  particleCount,
  SCENE_WEATHERS,
  stormSkew,
  toneStep,
  weatherLevels,
  weatherParam,
  weatherRgb,
  weatherToneKey,
  WEATHER_TONE_STEPS,
  type SceneWeatherId,
} from '../src/render/weather';
import { windSkew } from '../src/render/wind';

/** Canvas-Stub wie in render-daylight.test.ts: protokolliert nur die Aufrufe. */
interface StubCanvas {
  width: number;
  height: number;
  calls: { name: string; args: unknown[] }[];
  getContext: (type: string, opts?: unknown) => CanvasRenderingContext2D;
}

let created = 0;
let all: StubCanvas[] = [];

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

describe('Wetter der Szene: IDs, Überblendung, Tönung', () => {
  it('kennt genau die Wetterlagen aus content/weather.ts; unbekannte gelten als ohne Angabe', () => {
    expect([...SCENE_WEATHERS].sort()).toEqual(WEATHERS.map((w) => w.id).sort());
    for (const id of SCENE_WEATHERS) expect(normalizeWeather(id)).toBe(id);
    for (const bad of [undefined, null, '', 'hail', 42, 'RAIN']) expect(normalizeWeather(bad)).toBeNull();
    expect(weatherParam('?weather=storm')).toBe('storm');
    expect(weatherParam('?g=3&weather=fog&x=1')).toBe('fog');
    expect(weatherParam('?weather=blitz')).toBeNull();
    expect(weatherParam('')).toBeNull();
  });

  it('Überblendung: fehlend/ungültig → 1, begrenzt auf 0–1, „Weniger Bewegung“ ohne Überblendung', () => {
    expect(normalizeBlend(undefined)).toBe(1);
    expect(normalizeBlend(Number.NaN)).toBe(1);
    expect(normalizeBlend(Infinity)).toBe(1);
    expect(normalizeBlend(-0.5)).toBe(0);
    expect(normalizeBlend(0.4)).toBe(0.4);
    expect(normalizeBlend(3)).toBe(1);
    expect(normalizeBlend(0.2, true)).toBe(1);
  });

  it('mild ist neutral; jedes andere Wetter hat ein Bild', () => {
    expect(isClearWeather(weatherLevels('mild'))).toBe(true);
    expect(isClearWeather(weatherLevels(null))).toBe(true);
    for (const id of SCENE_WEATHERS) if (id !== 'mild') expect(isClearWeather(weatherLevels(id))).toBe(false);
    // Sturm ohne Blitze: nur Wolken und Wind, kein Regen-Flackern.
    expect(weatherLevels('storm').storm).toBe(1);
  });

  it('blendet stufenlos und linear vom Vortag zu heute', () => {
    const a = weatherLevels('rain');
    const b = weatherLevels('sun');
    expect(mixWeather('rain', 'sun', 0)).toEqual(a);
    expect(mixWeather('rain', 'sun', 1)).toEqual(b);
    const mid = mixWeather('rain', 'sun', 0.5);
    expect(mid.rain).toBeCloseTo(0.5);
    expect(mid.sun).toBeCloseTo(0.5);
    let prev = mixWeather('storm', 'snow', 0);
    for (let i = 1; i <= 600; i++) {
      const lv = mixWeather('storm', 'snow', i / 600);
      for (const k of Object.keys(lv) as (keyof typeof lv)[]) expect(Math.abs(lv[k] - prev[k])).toBeLessThan(0.01);
      prev = lv;
    }
    // Ohne Vortag: nur heute.
    expect(mixWeather(null, 'fog', 0)).toEqual(weatherLevels('fog'));
  });

  it('Tönungsschlüssel: −1 für mild, gleich innerhalb einer Stufe, neu je Stufe – höchstens WEATHER_TONE_STEPS + 1 je Wechsel', () => {
    expect(weatherToneKey('mild', 'mild', 0.3)).toBe(-1);
    expect(weatherToneKey(null, null, 1)).toBe(-1);
    expect(weatherToneKey('rain', 'rain', 0.1)).toBe(weatherToneKey('rain', 'rain', 1));
    expect(weatherToneKey('fog', 'rain', 1)).toBe(weatherToneKey('rain', 'rain', 1));
    expect(weatherToneKey('fog', 'rain', 0)).toBe(weatherToneKey('fog', 'fog', 1));
    expect(weatherToneKey('mild', 'rain', 0)).toBe(-1);
    const keys = new Set<number>();
    for (let i = 0; i <= 1000; i++) keys.add(weatherToneKey('mild', 'storm', i / 1000));
    expect(keys.size).toBe(WEATHER_TONE_STEPS + 1);
    // Alle Paare und Stufen haben eigene Schlüssel.
    const seen = new Map<number, string>();
    for (const p of SCENE_WEATHERS) {
      for (const c of SCENE_WEATHERS) {
        for (let s = 1; s < WEATHER_TONE_STEPS; s++) {
          if (p === c) continue;
          const k = weatherToneKey(p, c, s / WEATHER_TONE_STEPS);
          expect(seen.has(k), `${p}->${c}@${s}`).toBe(false);
          seen.set(k, `${p}->${c}@${s}`);
        }
      }
    }
    expect(toneStep(Number.NaN)).toBe(WEATHER_TONE_STEPS);
  });

  it('Lichtfarbe: mild und Sonne weiß, Dürre gelblich, Frost kühl, Regen/Sturm gedämpft', () => {
    expect(weatherRgb(weatherLevels('mild'))).toEqual([255, 255, 255]);
    expect(weatherRgb(weatherLevels('sun'))).toEqual([255, 255, 255]);
    const d = weatherRgb(weatherLevels('drought'));
    expect(d[0]).toBe(255);
    expect(d[2]).toBeLessThan(d[1]!);
    const f = weatherRgb(weatherLevels('frost'));
    expect(f[2]).toBeGreaterThan(f[0]!);
    for (const id of ['rain', 'storm'] as const) {
      const c = weatherRgb(weatherLevels(id));
      // Gedämpft, aber gut lesbar (keine Nacht am Tag).
      for (const v of c) {
        expect(v).toBeLessThan(230);
        expect(v).toBeGreaterThan(150);
      }
    }
  });

  it('Sturm: Wind ×2–3, stetig, begrenzt; ohne Sturm unverändert', () => {
    for (let t = 0; t < 60; t += 0.37) {
      const base = windSkew(t, 0);
      expect(stormSkew(base, t, 0)).toBe(base);
      expect(stormSkew(base, t, Number.NaN)).toBe(base);
      expect(Math.abs(stormSkew(base, t, 1))).toBeLessThanOrEqual(maxStormSkew(0.0145) + 1e-12);
      expect(Math.abs(stormSkew(base, t, 0.5) - stormSkew(base, t, 0.51))).toBeLessThan(0.001);
    }
    // Spürbar stärker: im Mittel mindestens doppelt so viel Ausschlag.
    let calm = 0;
    let storm = 0;
    for (let t = 0; t < 120; t += 0.1) {
      calm += Math.abs(windSkew(t, 0));
      storm += Math.abs(stormSkew(windSkew(t, 0), t, 1));
    }
    expect(storm / calm).toBeGreaterThan(2);
    expect(storm / calm).toBeLessThan(3.2);
  });

  it('passt zur Core-Schnittstelle: sceneWeather liefert IDs, die die Szene kennt', () => {
    for (let n = 0; n < 40; n++) {
      const sw = sceneWeather({ number: 3, startedAt: 1_700_000_000_000, elapsed: n * 180 + 2 });
      expect(normalizeWeather(sw.weather)).toBe(sw.weather);
      expect(normalizeWeather(sw.previous)).toBe(sw.previous);
      expect(sw.blend).toBeGreaterThanOrEqual(0);
      expect(sw.blend).toBeLessThanOrEqual(1);
    }
    expect(WEATHER_BLEND_SECONDS).toBeGreaterThan(0);
  });
});

describe('Partikel-Pool', () => {
  it('feste Größe, deterministisch, Werte im Bereich', () => {
    const a = new ParticlePool(50, 9);
    const b = new ParticlePool(50, 9);
    const c = new ParticlePool(50, 10);
    expect(a.capacity).toBe(50);
    expect(a.u.length).toBe(50);
    expect(Array.from(a.u)).toEqual(Array.from(b.u));
    expect(Array.from(a.speed)).toEqual(Array.from(b.speed));
    expect(Array.from(a.u)).not.toEqual(Array.from(c.u));
    for (let i = 0; i < 50; i++) {
      expect(a.u[i]).toBeGreaterThanOrEqual(0);
      expect(a.u[i]).toBeLessThan(1);
      expect(a.v[i]).toBeLessThan(1);
      expect(a.speed[i]).toBeGreaterThanOrEqual(0.6);
      expect(a.speed[i]).toBeLessThanOrEqual(1.4);
      expect(a.tone[i]).toBeLessThan(3);
    }
    expect(new ParticlePool(-3, 1).capacity).toBe(0);
  });

  it('Anzahl: Desktop ≤ 120 Regentropfen, mobil ≤ 60, „Weniger Bewegung“ halbiert', () => {
    expect(particleCount(MAX_RAIN, 1, false, false)).toBe(120);
    expect(particleCount(MAX_RAIN, 1, true, false)).toBe(60);
    expect(particleCount(MAX_RAIN, 1, false, true)).toBe(60);
    expect(particleCount(MAX_RAIN, 1, true, true)).toBe(30);
    expect(particleCount(MAX_SNOW, 0.5, false, false)).toBe(60);
    expect(particleCount(MAX_GUST_LEAVES, 0, false, false)).toBe(0);
    expect(particleCount(MAX_RAIN, Number.NaN, false, false)).toBe(0);
    for (let l = 0; l <= 1.5; l += 0.05) expect(particleCount(MAX_RAIN, l, false, false)).toBeLessThanOrEqual(MAX_RAIN);
  });

  it('Fallstrecke 0–1, auch bei negativer Zeit', () => {
    for (const t of [-100, -0.3, 0, 0.5, 1e6]) {
      const p = fallProgress(0.7, t, 0.9);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe('Nachtarten', () => {
  it('ohne Tageszeit wie bisher; nachts aktiver, tagsüber ruhiger', () => {
    expect(nightWake(undefined)).toBeNull();
    expect(nightWake(Number.NaN)).toBeNull();
    expect(nightWake(2)).toBe(1);
    for (const kind of NOCTURNAL_KINDS) expect(nocturnalPace(kind, null)).toBe(1);
    for (const kind of ['hedgehog', 'glowworm']) {
      expect(nocturnalPace(kind, 0)).toBeLessThan(1);
      expect(nocturnalPace(kind, 1)).toBeGreaterThan(1);
    }
    // Winterschlaf: der Igel bleibt ruhig, auch nachts.
    expect(nocturnalPace('hedgehog', 1, 0)).toBe(nocturnalPace('hedgehog', 0, 0));
    expect(nocturnalPace('robin', 1)).toBe(1);
  });

  it('Kauz döst tagsüber (Augen zu), nachts wach; Langohr fliegt nur nachts, nicht im Winterschlaf und nicht bei weniger Bewegung', () => {
    expect(owlDozing(0)).toBe(true);
    expect(owlDozing(1)).toBe(false);
    expect(owlDozing(null)).toBe(false);
    let closed = 0;
    for (let t = 0; t < 100; t += 0.1) if (owlPose(0, 1, 0, t, 5, 0.3, false).frame === 1) closed++;
    expect(closed).toBeGreaterThan(800);
    expect(owlPose(0, 1, 0, 3, 5, 0.3, true).frame).toBe(1);
    expect(owlPose(0, 1, 1, 3, 5, 0.3, true)).toEqual({ frame: 0, dir: 1 });
    expect(batFlying(1, 1, false)).toBe(true);
    expect(batFlying(0, 1, false)).toBe(false);
    expect(batFlying(1, 0, false)).toBe(false);
    expect(batFlying(1, 1, true)).toBe(false);
    expect(batFlying(null, 1, false)).toBe(false);
    // Flugbahn bleibt um die Höhle.
    for (let t = 0; t < 30; t += 0.25) {
      const p = batFlight(100, 200, 20, t, 0.4);
      expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(20 * 1.7 + 1e-9);
      expect(p.y).toBeLessThan(200);
      expect([0, 1]).toContain(p.frame);
    }
  });
});

describe('Szene mit Wetter', () => {
  const nocturnals: SceneAnimal[] = [
    { id: 'owl', family: 'birds', niche: 'hollows', slot: 0, happiness: 0.9 },
    { id: 'bat', family: 'mammals', niche: 'hollows', slot: 1, happiness: 0.9 },
    { id: 'hedgehog', family: 'mammals', niche: 'litter', slot: 0, happiness: 0.9 },
    { id: 'glowworm', family: 'insects', niche: 'edge', slot: 0, happiness: 0.9 },
  ];
  const base: SceneInput = { growth: 5.5, time: 3, animals: [], plants: [], harmonyTier: 4, season: 1.2 };

  function run(input: SceneInput, frames = 2, w = 800, h = 600): StubCanvas {
    const canvas = makeCanvas(w * 2, h * 2);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < frames; i++) drawScene(ctx, w, h, { ...input, time: input.time + i / 60 });
    return canvas;
  }

  it('mild, unbekanntes und fehlendes Wetter: genau wie ohne Angabe', () => {
    const plain = run(base).calls.map((c) => c.name);
    expect(run({ ...base, weather: 'mild' }).calls.map((c) => c.name)).toEqual(plain);
    expect(run({ ...base, weather: 'mild', weatherPrevious: 'mild', weatherBlend: 0.3 }).calls.map((c) => c.name)).toEqual(plain);
    expect(run({ ...base, weather: 'hail' as SceneWeatherId }).calls.map((c) => c.name)).toEqual(plain);
  });

  it('wirft nie und rechnet nur mit endlichen Werten – alle Wetter, Tag und Nacht, Kamera, Winter, mobil', () => {
    for (const [w, h] of [
      [1280, 800],
      [390, 844],
    ] as const) {
      for (const weather of SCENE_WEATHERS) {
        for (const extra of [
          {},
          { dayPhase: 0.02, animals: nocturnals },
          { dayPhase: 0.5, animals: nocturnals, reducedMotion: true },
          { season: 3, weatherPrevious: 'rain' as const, weatherBlend: 0.5 },
          { camera: { zoom: 3, x: 0.3, y: 0.4 } },
          { cycleTransition: { startedAt: 2.5, fromGrowth: 6 }, dayPhase: 0.76 },
        ] as Partial<SceneInput>[]) {
          const input = { ...base, ...extra, weather };
          let canvas: StubCanvas | null = null;
          expect(() => (canvas = run(input, 3, w, h))).not.toThrow();
          const bad = canvas!.calls.filter((c) => (c.name === 'setTransform' || c.name === 'drawImage' || c.name === 'lineTo') && c.args.some((a) => typeof a === 'number' && !Number.isFinite(a)));
          expect(bad, `${weather} ${JSON.stringify(extra)}`).toEqual([]);
        }
      }
    }
    // Viele Szenen: unter Last (ganze Suite parallel) mehr Zeit lassen.
  }, 60_000);

  it('pro Frame: keine neuen Canvases, keine Verläufe, keine Fläche über das ganze Canvas', () => {
    for (const weather of SCENE_WEATHERS) {
      const canvas = makeCanvas(1600, 1200);
      const ctx = canvas.getContext('2d');
      const input: SceneInput = { ...base, weather, dayPhase: 0.01, animals: nocturnals };
      // Erster Durchlauf legt Sprites an (Tiere blinzeln, Flügelschlag …); der zweite über
      // dieselben Zeiten darf nichts mehr anlegen.
      const times = Array.from({ length: 60 }, (_, i) => 3 + i * 0.17);
      for (const time of times) drawScene(ctx, 800, 600, { ...input, time });
      const made = created;
      const grads = allCalls('createLinearGradient') + allCalls('createRadialGradient');
      const from = canvas.calls.length;
      for (const time of times) drawScene(ctx, 800, 600, { ...input, time: time + 0.001 });
      expect(created, weather).toBe(made);
      expect(allCalls('createLinearGradient') + allCalls('createRadialGradient'), weather).toBe(grads);
      const full = canvas.calls.slice(from).filter((x) => x.name === 'fillRect' && x.args[0] === 0 && x.args[1] === 0 && x.args[2] === 1600 && x.args[3] === 1200);
      expect(full, weather).toEqual([]);
    }
  });

  it('Regen: ein Pfad je Frame mit höchstens 120 Strichen (mobil 60), „Weniger Bewegung“ halb so viele', () => {
    const strokes = (input: SceneInput, w: number, h: number) => {
      const canvas = run(input, 1, w, h);
      // Regen ist der einzige Pfad mit moveTo/lineTo im Szene-Canvas.
      return canvas.calls.filter((c) => c.name === 'moveTo').length;
    };
    expect(strokes({ ...base, weather: 'rain' }, 1280, 800)).toBe(MAX_RAIN);
    expect(strokes({ ...base, weather: 'rain' }, 390, 844)).toBe(MAX_RAIN / 2);
    expect(strokes({ ...base, weather: 'rain', reducedMotion: true }, 1280, 800)).toBe(MAX_RAIN / 2);
    expect(strokes({ ...base, weather: 'rain', reducedMotion: true }, 390, 844)).toBe(MAX_RAIN / 4);
    expect(strokes({ ...base, weather: 'rain', weatherPrevious: 'mild', weatherBlend: 0.5 }, 1280, 800)).toBe(MAX_RAIN / 2);
    const one = run({ ...base, weather: 'rain' }, 1, 1280, 800);
    expect(one.calls.filter((c) => c.name === 'stroke').length).toBe(1);
  });

  it('Überblendung über 6 s: neu getönt nur an den Stufen, nicht jeden Frame', () => {
    const canvas = makeCanvas(1600, 1200);
    const ctx = canvas.getContext('2d');
    const input: SceneInput = { ...base, harmonyTier: undefined, weather: 'fog', weatherPrevious: 'sun' };
    drawScene(ctx, 800, 600, { ...input, weatherBlend: 0, time: 0 });
    let tinted = 0;
    let before = allCalls('createLinearGradient');
    for (let i = 1; i <= 6 * 60; i++) {
      drawScene(ctx, 800, 600, { ...input, weatherBlend: i / 360, time: i / 60 });
      const now = allCalls('createLinearGradient');
      if (now !== before) tinted++;
      before = now;
    }
    expect(tinted).toBeGreaterThan(0);
    // Eine Tönung je Stufe, dazu einmal die Nebelbänder (Sprites, erst beim ersten Nebel).
    expect(tinted).toBeLessThanOrEqual(WEATHER_TONE_STEPS + 1);
  });

  it('Treffer-Test mit Sturm und Nacht wirft nicht', () => {
    const scene = { width: 800, height: 600, growth: 6, time: 4, animals: nocturnals, weather: 'storm' as const, dayPhase: 0.02, season: 1.2 };
    expect(() => hitTestAnimal(scene, null, 400, 300)).not.toThrow();
    expect(() => hitTestAnimal({ ...scene, weatherPrevious: 'fog', weatherBlend: Number.NaN, dayPhase: Number.NaN }, null, 400, 300)).not.toThrow();
  });
});
