import { describe, expect, it } from 'vitest';
import { DECLINE_SEED_SECONDS, MAX_PENDING_ENCOUNTERS } from '../src/content/encounters';
import { SEASON_SECONDS } from '../src/content/seasons';
import { OFFLINE_FULL_SECONDS, OFFLINE_YIELD } from '../src/content/offline';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { updateDaily } from '../src/core/daily';
import { declineReward, normalizeYieldFactor, seedSeconds, thresholdFor } from '../src/core/formulas';
import { ANCIENT_STAGE, chronicleOf } from '../src/core/landscape';
import type { DailyGoal, GameState } from '../src/core/state';
import { MAX_OFFLINE_SECONDS, simulateOffline, tick } from '../src/core/tick';
import { offlineTick, stateAt } from './helpers';

/*
 * Offline 10 % (DESIGN_V2.md 28.3, Phase 11, 1b): Ertragsfaktor f in tick – auf Raten und
 * Halte-Rechnung, nie auf die Zeit; simulateOffline = 60 s voll + Rest × OFFLINE_YIELD.
 */

/** Stand mit allen Wegpunkten: Die Raten hängen nicht mehr am Wachstum (keine Wegpunkte, keine Zwischenhalte). */
function finished(seed = 4): GameState {
  const state = stateAt(7, ['earthworm', 'robin', 'bee', 'vole'], seed);
  state.waypoint = WAYPOINT_COUNT;
  state.totalGrowth = thresholdFor(WAYPOINT_COUNT);
  state.harmonyPoints = 0;
  return state;
}

/** Zuwachs von Wachstum, Samen und Harmonie-Vorrat während `run`. */
function gains(state: GameState, run: (s: GameState) => void): { growth: number; seeds: number; harmony: number } {
  const before = { growth: state.totalGrowth, seeds: state.seeds, harmony: state.harmonyPoints };
  run(state);
  return { growth: state.totalGrowth - before.growth, seeds: state.seeds - before.seeds, harmony: state.harmonyPoints - before.harmony };
}

describe('Konstanten (28.3)', () => {
  it('10 % nach 60 vollen Sekunden', () => {
    expect(OFFLINE_YIELD).toBe(0.1);
    expect(OFFLINE_FULL_SECONDS).toBe(60);
    expect(OFFLINE_FULL_SECONDS).toBeLessThan(MAX_OFFLINE_SECONDS);
  });
});

describe('Ertragsfaktor in tick', () => {
  it('wirkt auf Wachstum, Samen und Harmonie-Vorrat – genau mal f', () => {
    for (const mode of ['live', 'average', 'off'] as const) {
      const full = gains(finished(), (s) => tick(s, 3600, mode, 1));
      const tenth = gains(finished(), (s) => tick(s, 3600, mode, 0.1));
      expect(full.growth, mode).toBeGreaterThan(0);
      expect(full.seeds, mode).toBeGreaterThan(0);
      expect(full.harmony, mode).toBeGreaterThan(0);
      expect(tenth.growth / full.growth, mode).toBeCloseTo(0.1, 9);
      expect(tenth.seeds / full.seeds, mode).toBeCloseTo(0.1, 9);
      expect(tenth.harmony / full.harmony, mode).toBeCloseTo(0.1, 9);
    }
  });

  it('nie auf die Zeit: Spielzeit, Jahreszeit, Restdauern und Statistik laufen voll', () => {
    const make = () => {
      const s = finished();
      s.cycle.timed = [{ source: 'midsummer', effect: { kind: 'growth', pct: 30 }, remaining: 500 }];
      s.cycle.visitors = [{ id: 'cranes', remaining: 9000 }];
      return s;
    };
    const a = make();
    const b = make();
    const ra = tick(a, 2 * 3600 + 7, 'average', 1);
    const rb = tick(b, 2 * 3600 + 7, 'average', OFFLINE_YIELD);
    expect(b.cycle.elapsed).toBe(a.cycle.elapsed);
    expect(b.cycle.timed).toEqual(a.cycle.timed);
    expect(b.cycle.visitors).toEqual(a.cycle.visitors);
    expect(rb.expired).toEqual(ra.expired);
    expect(rb.expired).toEqual(['midsummer']);
    expect(rb.seasons).toEqual(ra.seasons);
    expect(rb.weather).toEqual(ra.weather);
    expect(b.meta.stats.playSeconds).toBe(a.meta.stats.playSeconds);
  });

  it('Halte-Rechnung mit f: Der Wegpunkt kommt nach der zehnfachen Zeit', () => {
    const s = stateAt(2, ['earthworm'], 3);
    s.cycle.elapsed = 10;
    // Rate (🌿/s) mitten im Frühling, ohne Wetter und Nacht ('off'): konstant bis zum Wegpunkt.
    const g = gains(structuredClone(s), (x) => tick(x, 1, 'off', 1)).growth;
    expect(g).toBeGreaterThan(0);
    s.totalGrowth = thresholdFor(s.waypoint + 1) - 5 * g; // 5 s bei voller Rate, 50 s bei 10 %
    expect(tick(structuredClone(s), 4.99, 'off', 1).waypoints).toBe(0);
    expect(tick(structuredClone(s), 5.01, 'off', 1).waypoints).toBe(1);
    const tenth = structuredClone(s);
    expect(tick(tenth, 49.9, 'off', OFFLINE_YIELD).waypoints).toBe(0);
    expect(tick(tenth, 0.2, 'off', OFFLINE_YIELD).waypoints).toBe(1);
    // Genau auf den Wegpunkt (kein Rundungsrest), wie online.
    expect(tenth.totalGrowth).toBeGreaterThanOrEqual(thresholdFor(tenth.waypoint));
  });

  it('viele kleine Ticks = ein großer Tick, je f (inkl. Begegnungen und automatischem Weiterziehen)', () => {
    for (const f of [1, OFFLINE_YIELD, 0.37]) {
      for (const mode of ['live', 'average'] as const) {
        const start = stateAt(2, ['earthworm', 'robin'], 99);
        start.pendingEncounters = Array.from({ length: MAX_PENDING_ENCOUNTERS }, () => ({ type: 'animal' as const, cards: ['vole'], rerolls: 0 }));
        const small = structuredClone(start);
        const big = structuredClone(start);
        let declined = 0;
        let declinedSeeds = 0;
        const seconds = 3 * 3600;
        for (let i = 0; i < seconds; i++) {
          const r = tick(small, 1, mode, f);
          declined += r.autoDeclined;
          declinedSeeds += r.declinedSeeds;
        }
        const report = tick(big, seconds, mode, f);
        const label = `${mode} f=${f}`;
        expect(report.autoDeclined, label).toBeGreaterThan(0);
        expect(report.autoDeclined, label).toBe(declined);
        expect(report.declinedSeeds, label).toBeCloseTo(declinedSeeds, 6);
        expect(big.waypoint, label).toBe(small.waypoint);
        expect(big.rngState, label).toBe(small.rngState);
        expect(big.pendingEncounters, label).toEqual(small.pendingEncounters);
        expect(big.cycle.elapsed, label).toBeCloseTo(small.cycle.elapsed, 6);
        expect(big.totalGrowth, label).toBeCloseTo(small.totalGrowth, 6);
        expect(big.seeds, label).toBeCloseTo(small.seeds, 6);
        expect(big.harmonyPoints, label).toBeCloseTo(small.harmonyPoints, 6);
      }
    }
  });

  it('automatisches Weiterziehen zahlt Samen-Sekunden × f (Mindestwert bleibt)', () => {
    const state = finished();
    expect(declineReward(state)).toBe(seedSeconds(state, DECLINE_SEED_SECONDS));
    expect(declineReward(state, 1)).toBe(declineReward(state));
    expect(declineReward(state, OFFLINE_YIELD)).toBe(seedSeconds(state, DECLINE_SEED_SECONDS * OFFLINE_YIELD));
    expect(declineReward(state, OFFLINE_YIELD)).toBeLessThan(declineReward(state));
    // Am Wegpunkt mit voller Warteschlange: der kleinere Betrag landet im Bericht.
    const s = stateAt(3, ['earthworm', 'robin'], 5);
    s.pendingEncounters = Array.from({ length: MAX_PENDING_ENCOUNTERS }, () => ({ type: 'animal' as const, cards: ['vole'], rerolls: 0 }));
    s.totalGrowth = thresholdFor(s.waypoint + 1) - 1e-9;
    const expected = declineReward(s, OFFLINE_YIELD);
    const r = tick(s, 1e-3, 'live', OFFLINE_YIELD);
    expect(r.autoDeclined).toBe(1);
    expect(r.declinedSeeds).toBe(expected);
  });

  it('Grenzfälle: f = 0 bringt nichts, ungültige Werte zählen als 1, außerhalb [0, 1] begrenzt', () => {
    expect(normalizeYieldFactor(NaN)).toBe(1);
    expect(normalizeYieldFactor(Infinity)).toBe(1);
    expect(normalizeYieldFactor(-Infinity)).toBe(1);
    expect(normalizeYieldFactor('0.1')).toBe(1);
    expect(normalizeYieldFactor(-0.5)).toBe(0);
    expect(normalizeYieldFactor(7)).toBe(1);
    expect(normalizeYieldFactor(0.1)).toBe(0.1);
    const zero = finished();
    const before = structuredClone(zero);
    tick(zero, 3600, 'average', 0);
    expect(zero.totalGrowth).toBe(before.totalGrowth);
    expect(zero.seeds).toBe(before.seeds);
    expect(zero.harmonyPoints).toBe(before.harmonyPoints);
    expect(zero.cycle.elapsed).toBe(3600 + before.cycle.elapsed);
    for (const bad of [NaN, Infinity, 2]) {
      const a = finished();
      const b = finished();
      tick(a, 600, 'average');
      tick(b, 600, 'average', bad);
      expect(b).toEqual(a);
    }
    // Riesiger Tick mit kleinem f bleibt endlich.
    const huge = finished();
    tick(huge, Number.MAX_VALUE, 'average', 1e-300);
    expect(Number.isFinite(huge.seeds)).toBe(true);
    expect(Number.isFinite(huge.totalGrowth)).toBe(true);
  });

  it('Golden-Werte online unverändert: ohne f = mit f = 1', () => {
    for (const mode of ['live', 'average'] as const) {
      const a = stateAt(3, ['earthworm', 'robin', 'bee'], 2026);
      const b = structuredClone(a);
      const ra = tick(a, 2 * 3600, mode);
      const rb = tick(b, 2 * 3600, mode, 1);
      expect(rb).toEqual(ra);
      expect(b).toEqual(a);
    }
  });
});

describe('simulateOffline mit 10 % (28.3)', () => {
  it('30 s offline = voll (wie online)', () => {
    const offline = stateAt(3, ['earthworm', 'robin'], 8);
    const online = structuredClone(offline);
    const report = simulateOffline(offline, 30);
    tick(online, 30);
    expect(offline).toEqual(online);
    expect(report.fullSeconds).toBe(30);
    expect(report.yieldFactor).toBe(OFFLINE_YIELD);
    expect(report.growth).toBeGreaterThan(0);
  });

  it('2 h = 60 s voll + Rest × 0,1', () => {
    const offline = finished(9);
    const report = simulateOffline(offline, 2 * 3600);
    expect(report.averaged).toBe(true);
    expect(report.fullSeconds).toBe(OFFLINE_FULL_SECONDS);
    expect(report.seconds).toBe(2 * 3600);
    // Zum Vergleich mit vollem Ertrag in zwei Stücken (gleiche Halte): erste 60 s, dann der Rest.
    const first = finished(9);
    const g1 = gains(first, (s) => tick(s, OFFLINE_FULL_SECONDS, 'average', 1));
    const g2 = gains(first, (s) => tick(s, 2 * 3600 - OFFLINE_FULL_SECONDS, 'average', 1));
    expect(report.growth).toBeCloseTo(g1.growth + OFFLINE_YIELD * g2.growth, 6);
    expect(report.seeds).toBeCloseTo(g1.seeds + OFFLINE_YIELD * g2.seeds, 6);
    expect(report.harmony).toBeCloseTo(g1.harmony + OFFLINE_YIELD * g2.harmony, 6);
    // Gleich der Folge der beiden Ticks mit f.
    const pair = finished(9);
    tick(pair, OFFLINE_FULL_SECONDS, 'average', 1);
    tick(pair, 2 * 3600 - OFFLINE_FULL_SECONDS, 'average', OFFLINE_YIELD);
    expect(offline).toEqual(pair);
    // Rund ein Siebtel von vollem Ertrag statt der ganzen Menge.
    expect(report.growth / (g1.growth + g2.growth)).toBeLessThan(0.11);
  });

  it('kleine Ticks mit offlineTick = simulateOffline (Mittel, Begegnungen, Überlauf, Bericht)', () => {
    const start = stateAt(2, ['earthworm', 'robin'], 99);
    const small = structuredClone(start);
    const offline = structuredClone(start);
    const seconds = 4 * 3600;
    const reports = [];
    for (let i = 0; i < seconds; i++) reports.push(...offlineTick(small, i, 1));
    const report = simulateOffline(offline, seconds);
    expect(report.waypoints).toBeGreaterThan(MAX_PENDING_ENCOUNTERS);
    expect(report.waypoints).toBe(reports.reduce((n, r) => n + r.waypoints, 0));
    expect(report.autoDeclined).toBe(reports.reduce((n, r) => n + r.autoDeclined, 0));
    expect(report.declinedSeeds).toBeCloseTo(reports.reduce((n, r) => n + r.declinedSeeds, 0), 6);
    expect(report.seasons).toEqual(reports.flatMap((r) => r.seasons).slice(-report.seasons.length));
    expect(offline.pendingEncounters).toEqual(small.pendingEncounters);
    expect(offline.rngState).toBe(small.rngState);
    expect(offline.totalGrowth).toBeCloseTo(small.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(small.seeds, 6);
  });

  it('Jahreszeit, Wetter und Chronik nach 2 h wie mit vollem Ertrag', () => {
    const make = () => {
      const s = stateAt(ANCIENT_STAGE, ['earthworm', 'robin', 'bee'], 12);
      s.waypoint = WAYPOINT_COUNT;
      s.totalGrowth = thresholdFor(WAYPOINT_COUNT);
      s.cycle.elapsed = 3 * SEASON_SECONDS - 300; // Erster Schnee nach 5 min – nach den vollen 60 s
      s.cycle.timed = [{ source: 'midsummer', effect: { kind: 'growth', pct: 30 }, remaining: 1000 }];
      return s;
    };
    const offline = make();
    const full = make();
    const report = simulateOffline(offline, 2 * 3600);
    const fullReport = tick(full, 2 * 3600, 'average', 1);
    expect(offline.cycle.elapsed).toBeCloseTo(full.cycle.elapsed, 6);
    expect(report.seasons).toEqual(fullReport.seasons);
    expect(report.weather).toEqual(fullReport.weather);
    expect(report.seasons.length).toBe(40);
    expect(report.expired).toEqual(fullReport.expired);
    expect(offline.cycle.timed).toEqual([]);
    expect(report.chapters).toEqual(fullReport.chapters);
    expect(report.chapters.map((c) => c.chapter)).toContain('first-snow');
    expect(chronicleOf(offline, offline.meta.landscape.active)).toEqual(chronicleOf(full, full.meta.landscape.active));
    expect(offline.meta.stats.playSeconds).toBe(full.meta.stats.playSeconds);
    // Nur der Ertrag ist kleiner.
    expect(report.growth).toBeLessThan((full.totalGrowth - thresholdFor(WAYPOINT_COUNT)) * 0.2);
  });

  it('Tagesziele offline unverändert: Wachstum und Samen zählen offline nicht', () => {
    const state = stateAt(3, ['earthworm', 'robin'], 21);
    const goals: DailyGoal[] = [
      { kind: 'growth', target: 1, progress: 0, reward: 'seeds', done: false },
      { kind: 'seeds', target: 1, progress: 0, reward: 'seeds', done: false },
    ];
    state.meta.daily.day = '2026-10-26';
    state.meta.daily.goals = goals;
    simulateOffline(state, 2 * 3600);
    updateDaily(state, '2026-10-26', { offline: true });
    expect(state.meta.daily.goals.map((g) => g.progress)).toEqual([0, 0]);
  });

  it('Grenzfälle: 0, NaN, negativ und über 8 h', () => {
    for (const bad of [0, NaN, -5]) {
      const s = stateAt(3, ['earthworm'], 1);
      const before = structuredClone(s);
      const r = simulateOffline(s, bad);
      expect(r.seconds).toBe(0);
      expect(r.fullSeconds).toBe(0);
      expect(r.growth).toBe(0);
      expect(s).toEqual(before);
    }
    const long = finished();
    const r = simulateOffline(long, 100 * 3600);
    expect(r.seconds).toBe(MAX_OFFLINE_SECONDS);
    expect(r.fullSeconds).toBe(OFFLINE_FULL_SECONDS);
  });
});
