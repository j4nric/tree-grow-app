import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pathProgress,
  SEED_DANDELION,
  SEED_MAPLE,
  seedPose,
  Sowing,
  sowingElapsed,
  sowingGlow,
  sowingPaths,
  sowingPlantVisible,
  SOWING_LAND_SECONDS,
  SOWING_LEAD,
  SOWING_SECONDS,
  SOWING_SEEDS,
  SOWING_SETTLE_SECONDS,
  type SeedPose,
  type SowingStage,
} from '../src/render/sowing';

/** Aussaat-Animation (DESIGN_V2.md 27.12, Phase 10 1b): Bahnen, Dauer, Ende, Cache. */

const STAGE: SowingStage = { width: 1200, groundY: 560, targetX: 930, targetY: 562, unit: 36, seed: 4 };
const pose = (): SeedPose => ({ x: 0, y: 0, rot: 0, squash: 1, scale: 1, alpha: 0 });

describe('Aussaat: Zeitfenster', () => {
  it('läuft SOWING_SECONDS lang, früher Start gilt als jetzt, danach NaN', () => {
    expect(SOWING_SECONDS).toBeCloseTo(SOWING_LAND_SECONDS + SOWING_SETTLE_SECONDS, 9);
    expect(SOWING_SECONDS).toBeLessThanOrEqual(3);
    expect(sowingElapsed(10, 10, false)).toBe(0);
    expect(sowingElapsed(11.5, 10, false)).toBeCloseTo(1.5, 9);
    expect(sowingElapsed(10 - SOWING_LEAD / 2, 10, false)).toBe(0);
    expect(sowingElapsed(10 - SOWING_LEAD - 0.1, 10, false)).toBeNaN();
    expect(sowingElapsed(SOWING_SECONDS, 0, false)).toBeNaN();
    expect(sowingElapsed(Number.NaN, 10, false)).toBeNaN();
    expect(sowingElapsed(10, Number.POSITIVE_INFINITY, false)).toBeNaN();
  });

  it('reduzierte Bewegung: keine Animation, Pflanze sofort sichtbar', () => {
    for (const d of [0, 0.5, 1, 2, 2.6]) {
      expect(sowingElapsed(10 + d, 10, true)).toBeNaN();
      expect(sowingPlantVisible(10 + d, 10, true)).toBe(true);
    }
  });

  it('Pflanze erscheint erst nach der Landung und bleibt danach', () => {
    expect(sowingPlantVisible(10, 10, false)).toBe(false);
    expect(sowingPlantVisible(10 + SOWING_LAND_SECONDS - 0.01, 10, false)).toBe(false);
    expect(sowingPlantVisible(SOWING_LAND_SECONDS, 0, false)).toBe(true);
    expect(sowingPlantVisible(10 + SOWING_SECONDS + 5, 10, false)).toBe(true);
    // Vor dem Zeitfenster (ungültig/zu früh): Pflanze nicht verstecken
    expect(sowingPlantVisible(0, 10, false)).toBe(true);
  });
});

describe('Aussaat: Bahnen', () => {
  it('deterministisch: gleiche Bühne → gleiche Bahnen, anderer Seed → andere', () => {
    const a = sowingPaths(STAGE);
    const b = sowingPaths({ ...STAGE });
    expect(b).toEqual(a);
    expect(sowingPaths({ ...STAGE, seed: 5 })).not.toEqual(a);
    expect(a).toHaveLength(SOWING_SEEDS);
    expect(a.some((p) => p.kind === SEED_MAPLE)).toBe(true);
    expect(a.some((p) => p.kind === SEED_DANDELION)).toBe(true);
  });

  it('Start außerhalb am näheren Rand, Landung eng um das Ziel, rechtzeitig', () => {
    for (const targetX of [150, 930]) {
      const stage = { ...STAGE, targetX };
      for (const p of sowingPaths(stage)) {
        if (targetX < 600) expect(p.x0).toBeLessThan(0);
        else expect(p.x0).toBeGreaterThan(STAGE.width);
        expect(p.y0).toBeGreaterThan(0);
        expect(p.y0).toBeLessThan(STAGE.groundY * 0.5);
        expect(Math.abs(p.x3 - targetX)).toBeLessThanOrEqual(STAGE.unit);
        expect(p.y3).toBeLessThanOrEqual(STAGE.targetY);
        expect(p.y3).toBeGreaterThan(STAGE.targetY - STAGE.unit);
        expect(p.delay).toBeGreaterThanOrEqual(0);
        expect(p.flight).toBeGreaterThan(1);
        expect(p.delay + p.flight).toBeLessThanOrEqual(SOWING_LAND_SECONDS + 1e-9);
      }
    }
  });

  it('wiederverwendet das Ausgabe-Array (keine neuen Bahnen bei erneutem Aufruf)', () => {
    const out = sowingPaths(STAGE);
    const first = out[0];
    sowingPaths({ ...STAGE, seed: 9 }, out);
    expect(out[0]).toBe(first);
  });

  it('ungültiges Ziel fällt auf die Bildmitte am Boden zurück', () => {
    for (const p of sowingPaths({ ...STAGE, targetX: Number.NaN, targetY: Number.NaN })) {
      expect(Number.isFinite(p.x3)).toBe(true);
      expect(Number.isFinite(p.y3)).toBe(true);
    }
  });

  it('Fortschritt: 0 → 1, monoton, gebremst am Ende', () => {
    expect(pathProgress(0)).toBe(0);
    expect(pathProgress(1)).toBe(1);
    expect(pathProgress(2)).toBe(1);
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const s = pathProgress(t);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(pathProgress(1) - pathProgress(0.95)).toBeLessThan(pathProgress(0.05) - pathProgress(0));
  });
});

describe('Aussaat: Lage je Frame', () => {
  it('vor dem eigenen Start unsichtbar, am Ende genau am Landepunkt und ausgeblendet', () => {
    const o = pose();
    for (const p of sowingPaths(STAGE)) {
      if (p.delay > 0) expect(seedPose(p, p.delay * 0.5, o).alpha).toBe(0);
      seedPose(p, p.delay + p.flight, o);
      expect(o.x).toBeCloseTo(p.x3, 6);
      expect(o.y).toBeCloseTo(p.y3, 6);
      expect(o.alpha).toBeGreaterThan(0.9);
      seedPose(p, SOWING_SECONDS, o);
      expect(o.x).toBeCloseTo(p.x3, 6);
      expect(o.alpha).toBe(0);
      expect(o.scale).toBeLessThan(p.size);
    }
  });

  it('stetig: keine Sprünge zwischen zwei Frames (60 FPS)', () => {
    const o = pose();
    for (const p of sowingPaths(STAGE)) {
      let px = Number.NaN;
      let py = Number.NaN;
      let pr = Number.NaN;
      for (let u = p.delay; u <= SOWING_SECONDS; u += 1 / 60) {
        seedPose(p, u, o);
        if (!Number.isNaN(px)) {
          expect(Math.hypot(o.x - px, o.y - py)).toBeLessThan(STAGE.width * 0.03);
          expect(Math.abs(o.rot - pr)).toBeLessThan(0.5);
        }
        expect(o.squash).toBeGreaterThan(0);
        expect(o.squash).toBeLessThanOrEqual(1);
        px = o.x;
        py = o.y;
        pr = o.rot;
      }
    }
  });

  it('Lichtschein: aus am Anfang und am Ende, sichtbar um die Landung', () => {
    expect(sowingGlow(0)).toBe(0);
    expect(sowingGlow(Number.NaN)).toBe(0);
    expect(sowingGlow(SOWING_LAND_SECONDS)).toBeGreaterThan(0.9);
    expect(sowingGlow(SOWING_SECONDS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cache: Bahnen je Aussaat, Sprites je Größe – pro Frame nur drawImage
// ---------------------------------------------------------------------------

let created = 0;
let calls: string[] = [];

function stubContext(log: string[]): CanvasRenderingContext2D {
  const helper = { addColorStop: () => undefined };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        log.push(String(prop));
        void args;
        return helper;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  created = 0;
  calls = [];
  vi.stubGlobal('document', {
    createElement: () => {
      created++;
      const own: string[] = [];
      return { width: 0, height: 0, getContext: () => stubContext(own) };
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Aussaat: Zeichnen mit Cache', () => {
  it('Bahnen einmal je Aussaat, Sprites einmal je Größe; NaN zeichnet nichts', () => {
    const s = new Sowing();
    const ctx = stubContext(calls);
    s.draw(ctx, Number.NaN, STAGE, 2);
    expect(calls).toHaveLength(0);
    expect(s.prepared).toBe(false);
    for (let u = 0; u < SOWING_SECONDS; u += 1 / 60) s.draw(ctx, u, { ...STAGE }, 2);
    expect(s.pathBuilds).toBe(1);
    // Ahorn, Schirmchen, Lichtschein
    expect(s.spriteBuilds).toBe(3);
    expect(created).toBe(3);
    // Pro Frame nur Transformationen und drawImage (keine Pfade)
    expect(calls.every((c) => c === 'setTransform' || c === 'drawImage')).toBe(true);
    calls.length = 0;
    s.draw(ctx, 1.2, STAGE, 2);
    expect(calls.filter((c) => c === 'drawImage').length).toBeLessThanOrEqual(SOWING_SEEDS + 1);
    // Neue Aussaat (anderer Platz): neue Bahnen, Sprites bleiben
    s.draw(ctx, 1.2, { ...STAGE, seed: 7, targetX: 300 }, 2);
    expect(s.pathBuilds).toBe(2);
    expect(s.spriteBuilds).toBe(3);
    // Neue Größe: Sprites neu
    s.draw(ctx, 1.2, { ...STAGE, unit: 28 }, 2);
    expect(s.spriteBuilds).toBeGreaterThan(3);
    s.release();
    expect(s.prepared).toBe(false);
  });
});
