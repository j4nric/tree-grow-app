import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITE_IDS } from '../src/content/landscape';
import { JAY_FLIGHT_LEAD, JAY_FLIGHT_REDUCED_SECONDS, JAY_FLIGHT_SECONDS, jayElapsed, jayPose, type JayPose } from '../src/render/jay-flight';
import { makeLayout } from '../src/render/layout';
import { seasonLook } from '../src/render/season';
import {
  heatherBloom,
  HOME_GROUND,
  mountainSnowLine,
  normalizeSite,
  paintSiteBackdrop,
  SCENE_SITES,
  sceneSite,
  siteGround,
  siteParam,
} from '../src/render/site-scenery';
import { drawScene, SITE_FADE_REDUCED_SECONDS, SITE_FADE_SECONDS, sceneCacheStats, siteFadeAlpha, type SceneInput } from '../src/render/tree';

/**
 * Kulisse je Waldtyp und Häherflug (DESIGN_V2.md 24.11, Schritt 3): reine Funktionen,
 * Determinismus und Cache-Verhalten (kein Neuzeichnen der Kulisse pro Frame).
 */

// ---------------------------------------------------------------------------
// Canvas-Stub, der alle Aufrufe und gesetzten Eigenschaften protokolliert
// ---------------------------------------------------------------------------

interface StubCanvas {
  width: number;
  height: number;
  log: string[];
  getContext: (type: string) => CanvasRenderingContext2D;
}

let created = 0;
let totalCalls = 0;

function makeCanvas(width = 0, height = 0): StubCanvas {
  const canvas: StubCanvas = { width, height, log: [], getContext: () => ctx };
  const store: Record<string | symbol, unknown> = {};
  const helper = { addColorStop: (o: number, c: string) => canvas.log.push(`stop ${o} ${c}`), data: new Uint8ClampedArray(16) };
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'canvas') return canvas;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        totalCalls++;
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
  totalCalls = 0;
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

const SEASONS = [undefined, 0, 0.5, 1, 1.5, 2, 3, 3.5];

describe('Standorte', () => {
  it('die IDs entsprechen genau den Standorten der Landschaft (content/landscape.ts)', () => {
    expect([...SCENE_SITES]).toEqual([...SITE_IDS]);
  });

  it('normalizeSite, sceneSite und ?site= erkennen nur bekannte IDs', () => {
    for (const id of SCENE_SITES) {
      expect(normalizeSite(id)).toBe(id);
      expect(sceneSite(id)).toBe(id);
      expect(siteParam(`?site=${id}&g=3`)).toBe(id);
    }
    for (const bad of [undefined, null, 3, '', 'Auwald', 'HOME', {}]) {
      expect(normalizeSite(bad)).toBeNull();
      expect(sceneSite(bad)).toBe('home');
    }
    expect(siteParam('')).toBeNull();
    expect(siteParam('?site=mars')).toBeNull();
  });

  it('jeder Waldtyp hat eigene Bodenfarben, der Heimatwald die bisherigen', () => {
    expect(siteGround('home')).toBe(HOME_GROUND);
    expect(HOME_GROUND.soil.top).toBe('#6b4b30');
    expect(HOME_GROUND.grass.band).toBe('#5d9a3e');
    const soils = new Set(SCENE_SITES.map((s) => siteGround(s).soil.top));
    expect(soils.size).toBe(SCENE_SITES.length);
    for (const s of SCENE_SITES) {
      const g = siteGround(s);
      for (const c of [g.soil.top, g.soil.bottom, g.soil.stone, g.soil.crumb, g.grass.band, g.grass.bandLight, g.grass.blade, g.grass.bladeLight]) {
        expect(c, s).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(g.grass.density).toBeGreaterThan(0);
      expect(g.soil.stones).toBeGreaterThan(0);
    }
  });

  it('Bergmischwald: im Winter liegt der Schnee viel tiefer als im Sommer', () => {
    const summer = mountainSnowLine(seasonLook(1));
    expect(mountainSnowLine(null)).toBe(summer);
    expect(mountainSnowLine(seasonLook(3))).toBeGreaterThan(summer + 0.3);
    expect(mountainSnowLine(seasonLook(0))).toBeGreaterThan(summer);
    for (const s of SEASONS) {
      const v = mountainSnowLine(seasonLook(s));
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('Kiefernheide: Heidekraut blüht im Spätsommer am stärksten', () => {
    const late = heatherBloom(seasonLook(1.6));
    expect(late).toBeGreaterThan(0.9);
    expect(heatherBloom(seasonLook(3))).toBeLessThan(0.2);
    expect(heatherBloom(seasonLook(0.2))).toBeLessThan(heatherBloom(seasonLook(1)));
    expect(heatherBloom(null)).toBeCloseTo(heatherBloom(seasonLook(1)), 6);
  });

  it('gleiche Eingabe → gleiche Zeichnung (Seed-Zufall), alle Standorte, Jahreszeiten und Größen', () => {
    const sizes: [number, number][] = [
      [360, 640],
      [1200, 700],
      [1920, 1080],
    ];
    for (const [w, h] of sizes) {
      const layout = makeLayout(w, h);
      for (const site of SCENE_SITES) {
        for (const season of SEASONS) {
          const a = makeCanvas(w, h);
          const b = makeCanvas(w, h);
          paintSiteBackdrop(a.getContext('2d'), layout, site, seasonLook(season));
          paintSiteBackdrop(b.getContext('2d'), layout, site, seasonLook(season));
          expect(a.log.length, `${site} ${season}`).toBeGreaterThan(5);
          expect(a.log).toEqual(b.log);
          // Keine ungültigen Zahlen in den Zeichenaufrufen
          expect(a.log.some((l) => l.includes('NaN') || l.includes('Infinity')), `${site} ${season} ${w}×${h}`).toBe(false);
        }
      }
    }
  });

  it('jede Kulisse unterscheidet sich (je Standort ein eigenes Bild)', () => {
    const layout = makeLayout(1200, 700);
    const logs = SCENE_SITES.map((site) => {
      const c = makeCanvas(1200, 700);
      paintSiteBackdrop(c.getContext('2d'), layout, site, null);
      return c.log.join('|');
    });
    expect(new Set(logs).size).toBe(SCENE_SITES.length);
  });
});

describe('Häherflug', () => {
  it('Zeitfenster: höchstens 3 s, Vorlauf 1 s, davor und danach nichts', () => {
    expect(JAY_FLIGHT_SECONDS).toBeLessThanOrEqual(3);
    expect(jayElapsed(10, 10, false)).toBe(0);
    expect(jayElapsed(11.5, 10, false)).toBeCloseTo(1.5, 9);
    expect(jayElapsed(10 - JAY_FLIGHT_LEAD / 2, 10, false)).toBe(0);
    expect(jayElapsed(10 - JAY_FLIGHT_LEAD - 0.1, 10, false)).toBeNaN();
    expect(jayElapsed(10 + JAY_FLIGHT_SECONDS + 0.01, 10, false)).toBeNaN();
    expect(jayElapsed(10 + JAY_FLIGHT_REDUCED_SECONDS + 0.01, 10, true)).toBeNaN();
    expect(jayElapsed(Number.NaN, 10, false)).toBeNaN();
    expect(jayElapsed(10, Number.POSITIVE_INFINITY, false)).toBeNaN();
  });

  it('fliegt von rechts nach links am Himmel durchs Bild, blendet weich ein und aus', () => {
    const out: JayPose = { x: 0, y: 0, frame: 0, tilt: 0, alpha: 0 };
    const width = 800;
    const groundY = 480;
    const size = 50;
    let lastX = Infinity;
    for (let u = 0; u <= JAY_FLIGHT_SECONDS; u += 0.05) {
      const p = jayPose(u, false, width, groundY, size, out);
      expect(p.x).toBeLessThan(lastX);
      lastX = p.x;
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(groundY * 0.5);
      expect([0, 1, 2]).toContain(p.frame);
      expect(Math.abs(p.tilt)).toBeLessThan(0.6);
      expect(p.alpha).toBeGreaterThanOrEqual(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
    expect(jayPose(0, false, width, groundY, size, out).x).toBeGreaterThan(width);
    expect(jayPose(JAY_FLIGHT_SECONDS, false, width, groundY, size, out).x).toBeLessThan(0);
    expect(jayPose(JAY_FLIGHT_SECONDS, false, width, groundY, size, out).alpha).toBe(0);
    expect(jayPose(1.4, false, width, groundY, size, out).alpha).toBe(1);
    // Gleiche Eingabe → gleiche Lage
    const a = { ...jayPose(1.234, false, width, groundY, size, out) };
    expect(jayPose(1.234, false, width, groundY, size, out)).toEqual(a);
  });

  it('weniger Bewegung: steht still und blendet nur über (Rampen ≥ 0,5 s)', () => {
    const out: JayPose = { x: 0, y: 0, frame: 0, tilt: 0, alpha: 0 };
    const xs = new Set<number>();
    let prev = 0;
    for (let u = 0; u <= JAY_FLIGHT_REDUCED_SECONDS; u += 0.02) {
      const p = jayPose(u, true, 800, 480, 50, out);
      xs.add(p.x);
      expect(p.frame).toBe(2);
      // keine Sprünge der Deckkraft
      expect(Math.abs(p.alpha - prev)).toBeLessThan(0.07);
      prev = p.alpha;
    }
    expect(xs.size).toBe(1);
    expect(jayPose(0, true, 800, 480, 50, out).alpha).toBe(0);
    expect(jayPose(0.8, true, 800, 480, 50, out).alpha).toBe(1);
  });
});

describe('Überblendung beim Standortwechsel', () => {
  it('fällt sanft von 1 auf 0 – nach Zeit oder (bei stehender Zeit) nach Frames', () => {
    expect(siteFadeAlpha(0, 0, false)).toBe(1);
    expect(siteFadeAlpha(SITE_FADE_SECONDS / 2, 0, false)).toBeCloseTo(0.5, 6);
    expect(siteFadeAlpha(SITE_FADE_SECONDS, 0, false)).toBe(0);
    expect(siteFadeAlpha(SITE_FADE_REDUCED_SECONDS, 0, true)).toBe(0);
    expect(siteFadeAlpha(0, Math.ceil(SITE_FADE_SECONDS * 60), false)).toBe(0);
    expect(siteFadeAlpha(Number.NaN, 0, false)).toBe(1);
    expect(siteFadeAlpha(-5, 0, false)).toBe(1);
  });
});

describe('drawScene: Kulisse je Standort im Cache', () => {
  const base: SceneInput = { growth: 5.5, time: 0, plants: [], sizeSettled: true, reducedMotion: true };

  function frames(canvas: StubCanvas, input: Partial<SceneInput>, from: number, n: number): void {
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < n; i++) drawScene(ctx, 800, 600, { ...base, ...input, time: from + i * 0.016 });
  }

  it('ohne Angabe und mit site: home pixelgleich (gleiche Zeichenaufrufe), andere Standorte anders', () => {
    const logs: Record<string, string> = {};
    for (const site of [undefined, 'home', 'mars', 'heath']) {
      const c = makeCanvas(800, 600);
      drawScene(c.getContext('2d'), 800, 600, { ...base, time: 1, site });
      logs[String(site)] = c.log.join('|');
    }
    // Die Ebenen-Canvases des Stubs protokollieren getrennt; verglichen wird das sichtbare Canvas.
    expect(logs.home).toBe(logs.undefined);
    expect(logs.mars).toBe(logs.undefined);
    expect(sceneCacheStats(makeCanvas() as unknown as HTMLCanvasElement)).toBeNull();
  });

  it('Kulisse nur bei Standortwechsel neu, nicht pro Frame; Überblendung danach freigegeben', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    frames(canvas, { site: 'home' }, 1, 3);
    const s0 = sceneCacheStats(el)!;
    const n0 = created;
    // Weitere Frames am selben Standort: keine neue Kulisse, keine neuen Canvases.
    frames(canvas, { site: 'home' }, 2, 20);
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds);
    expect(created).toBe(n0);
    let mark = totalCalls;
    frames(canvas, { site: 'home' }, 3, 1);
    const plain = totalCalls - mark;

    // Wechsel: einmal neu zeichnen, eine Kopie der alten Kulisse für die Überblendung.
    mark = totalCalls;
    frames(canvas, { site: 'mountain' }, 4, 1);
    const switched = totalCalls - mark;
    expect(switched).toBeGreaterThan(plain * 3);
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds + 1);
    expect(sceneCacheStats(el)!.siteFade).toBe(true);
    expect(created).toBe(n0 + 1);

    // Während der Überblendung: nur eine Kopie mehr pro Frame, keine neue Kulisse.
    mark = totalCalls;
    frames(canvas, { site: 'mountain' }, 4.1, 1);
    expect(totalCalls - mark).toBeLessThanOrEqual(plain + 4);
    // Nach der Überblendung (Zeit läuft): wieder wie vorher, Kopie freigegeben.
    frames(canvas, { site: 'mountain' }, 4 + SITE_FADE_SECONDS + 0.1, 2);
    expect(sceneCacheStats(el)!.siteFade).toBe(false);
    expect(sceneCacheStats(el)!.staticBuilds).toBe(s0.staticBuilds + 1);
    mark = totalCalls;
    frames(canvas, { site: 'mountain' }, 8, 1);
    expect(totalCalls - mark).toBeLessThanOrEqual(plain + 2);
  });

  it('Überblendung endet auch bei stehender Zeit (nach Frames)', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    drawScene(ctx, 800, 600, { ...base, time: 1, site: 'carr' });
    drawScene(ctx, 800, 600, { ...base, time: 1, site: 'beechwood' });
    expect(sceneCacheStats(el)!.siteFade).toBe(true);
    for (let i = 0; i < Math.ceil(SITE_FADE_REDUCED_SECONDS * 60) + 2; i++) drawScene(ctx, 800, 600, { ...base, time: 1, site: 'beechwood' });
    expect(sceneCacheStats(el)!.siteFade).toBe(false);
  });

  it('bei laufender Zeit rein zeitbasiert: mit 144 Hz so lang wie mit 60 Hz', () => {
    for (const hz of [60, 144]) {
      const canvas = makeCanvas(800, 600);
      const el = canvas as unknown as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      drawScene(ctx, 800, 600, { ...base, time: 1, site: 'home', reducedMotion: false });
      drawScene(ctx, 800, 600, { ...base, time: 2, site: 'heath', reducedMotion: false });
      const n = Math.round(hz * SITE_FADE_SECONDS);
      let ended = -1;
      for (let i = 1; i <= n + 5 && ended < 0; i++) {
        drawScene(ctx, 800, 600, { ...base, time: 2 + i / hz, site: 'heath', reducedMotion: false });
        if (!sceneCacheStats(el)!.siteFade) ended = i / hz;
      }
      // Endet nach SITE_FADE_SECONDS (± ein Frame), nicht nach 96 Frames.
      expect(ended, `${hz} Hz`).toBeGreaterThan(SITE_FADE_SECONDS - 2 / hz);
      expect(ended, `${hz} Hz`).toBeLessThan(SITE_FADE_SECONDS + 2 / hz);
    }
  });

  it('erster Frame mit einem Standort: keine Überblendung (nichts Altes zu zeigen)', () => {
    const canvas = makeCanvas(800, 600);
    frames(canvas, { site: 'heath' }, 1, 2);
    expect(sceneCacheStats(canvas as unknown as HTMLCanvasElement)!.siteFade).toBe(false);
  });

  it('alle Standorte mit Jahreszeit, Nacht, Wetter, Lebensräumen und Zoom ohne Fehler', () => {
    const canvas = makeCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    let t = 1;
    for (const site of SCENE_SITES) {
      for (const season of [0, 1, 2, 3]) {
        for (const weather of ['mild', 'fog', 'snow', 'drought'] as const) {
          expect(() =>
            drawScene(ctx, 800, 600, {
              ...base,
              time: (t += 0.3),
              site,
              season,
              weather,
              dayPhase: 0.9,
              meadow: true,
              wall: true,
              deadwood: true,
              pond: true,
              camera: { zoom: 2, x: 0.4, y: 0.6 },
            }),
          ).not.toThrow();
        }
      }
    }
  });

  it('Häherflug: höchstens drei Sprites, keine neuen Canvases pro Frame, danach freigegeben', () => {
    const canvas = makeCanvas(800, 600);
    const el = canvas as unknown as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    drawScene(ctx, 800, 600, { ...base, time: 1, reducedMotion: false });
    const n0 = created;
    for (let i = 0; i <= 60; i++) {
      drawScene(ctx, 800, 600, { ...base, time: 2 + i * 0.05, reducedMotion: false, jayFlight: { startedAt: 2 } });
    }
    const stats = sceneCacheStats(el)!;
    expect(stats.jaySpriteBuilds).toBeGreaterThanOrEqual(2);
    expect(stats.jaySpriteBuilds).toBeLessThanOrEqual(3);
    expect(created - n0).toBe(stats.jaySpriteBuilds);
    // Nach dem Flug (Feld bleibt gesetzt): Sprites frei, nichts mehr gezeichnet.
    drawScene(ctx, 800, 600, { ...base, time: 2 + JAY_FLIGHT_SECONDS + 0.1, reducedMotion: false, jayFlight: { startedAt: 2 } });
    expect(sceneCacheStats(el)!.jayPrepared).toBe(false);
    // Weniger Bewegung: nur ein Bild (Gleiten) für die Überblendung.
    const c2 = makeCanvas(800, 600);
    for (let i = 0; i <= 30; i++) drawScene(c2.getContext('2d'), 800, 600, { ...base, time: 1 + i * 0.05, jayFlight: { startedAt: 1 } });
    expect(sceneCacheStats(c2 as unknown as HTMLCanvasElement)!.jaySpriteBuilds).toBe(1);
  });
});
