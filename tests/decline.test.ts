import { describe, expect, it } from 'vitest';
import { DECLINE_SEED_SECONDS, MAX_PENDING_ENCOUNTERS } from '../src/content/encounters';
import { SEED_SECONDS_MIN_SEEDS } from '../src/content/events';
import { SEASON_SECONDS } from '../src/content/seasons';
import { declineReward, evaluate, seedSeconds, seedSecondsRate, thresholdFor } from '../src/core/formulas';
import type { GameState, PendingEncounter } from '../src/core/state';
import { declineEncounter, simulateOffline, tick } from '../src/core/tick';
import { offlineTick, stateAt } from './helpers';

/**
 * Ablehnen nach Samen-Sekunden (DESIGN_V2.md 7.9): 10 Samen-Sekunden, mindestens 5 🌰 –
 * von Hand, beim Weiterziehen mit vollem Stapel (online wie offline) und wenn keine Karte
 * in Frage kam.
 */

const card = (cards: string[]): PendingEncounter => ({ type: 'animal', cards, rerolls: 0 });

/** Hain mit Bewohnern und Pflanzen – Samenrate deutlich über der Untergrenze. */
function grove(seed = 1): GameState {
  const state = stateAt(5, ['earthworm', 'robin', 'bee', 'bluetit', 'vole', 'squirrel'], seed);
  state.plants = ['hazel', 'birch', 'fern'];
  return state;
}

/** Voller Stapel, Gesamt-Wachstum knapp vor dem nächsten Wegpunkt. */
function fullStackBeforeWaypoint(state: GameState): GameState {
  state.pendingEncounters = Array.from({ length: MAX_PENDING_ENCOUNTERS }, () => card(['bee']));
  state.totalGrowth = thresholdFor(state.waypoint + 1) - 1e-6;
  return state;
}

describe('declineReward: Samen-Sekunden', () => {
  it('Keimling: die Untergrenze von 5 🌰', () => {
    const state = stateAt(1);
    expect(10 * seedSecondsRate(state)).toBeLessThan(SEED_SECONDS_MIN_SEEDS);
    expect(declineReward(state)).toBe(SEED_SECONDS_MIN_SEEDS);
  });

  it('Hain: 10 × Samenrate ohne Zeit-Boni', () => {
    const state = grove();
    const rate = seedSecondsRate(state);
    expect(DECLINE_SEED_SECONDS * rate).toBeGreaterThan(SEED_SECONDS_MIN_SEEDS);
    expect(declineReward(state)).toBeCloseTo(DECLINE_SEED_SECONDS * rate, 9);
    expect(declineReward(state)).toBe(seedSeconds(state, DECLINE_SEED_SECONDS));
  });

  it('Zeit-Bonus, Jahreszeit und Gäste ändern den Betrag nicht', () => {
    const state = grove();
    const base = declineReward(state);
    const seedsBefore = evaluate(state).seeds;
    state.cycle.timed.push({ source: 'test', effect: { kind: 'seeds', pct: 60 }, remaining: 300 });
    expect(evaluate(state).seeds).toBeGreaterThan(seedsBefore);
    expect(declineReward(state)).toBe(base);
    const rates = new Set<number>();
    for (let s = 0; s < 4; s++) {
      state.cycle.elapsed = s * SEASON_SECONDS + 1;
      rates.add(evaluate(state).seeds);
      expect(declineReward(state)).toBe(base);
    }
    // Die Jahreszeit ändert die echte Samenrate wirklich – sonst wäre der Test leer.
    expect(rates.size).toBeGreaterThan(1);
  });

  it('auf jeder Stufe endlich und mindestens 5 🌰', () => {
    for (let stage = 0; stage <= 7; stage++) {
      const r = declineReward(stateAt(stage));
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(SEED_SECONDS_MIN_SEEDS);
    }
  });

  it('kaputter Zustand (Rate Infinity oder NaN): Untergrenze statt Unsinn; riesige Rate bleibt endlich', () => {
    // Ein unsinniger Harmonie-Bonus treibt die Samenrate auf Infinity, NaN bzw. ~1e305.
    const broken = (points: number): GameState => {
      const state = grove();
      state.cycle.bonuses.push({ source: 'test', effect: { kind: 'harmony', points } });
      return state;
    };
    const inf = broken(Infinity);
    expect(seedSecondsRate(inf)).toBe(Infinity);
    expect(declineReward(inf)).toBe(SEED_SECONDS_MIN_SEEDS);
    const huge = broken(1e308);
    expect(seedSecondsRate(huge)).toBeGreaterThan(1e300);
    expect(Number.isFinite(declineReward(huge))).toBe(true);
    const nan = broken(NaN);
    expect(seedSecondsRate(nan)).toBeNaN();
    expect(declineReward(nan)).toBe(SEED_SECONDS_MIN_SEEDS);
    // Ablehnen von Hand schreibt dann nur endliche Samen gut.
    for (const state of [inf, nan, huge]) {
      state.pendingEncounters = [card(['bee'])];
      declineEncounter(state, 0);
      expect(Number.isFinite(state.seeds)).toBe(true);
    }
  });

  it('Raten-Cache unterscheidet Infinity, -Infinity und NaN (direkt hintereinander)', () => {
    const broken = (points: number): GameState => {
      const state = grove();
      state.cycle.bonuses.push({ source: 'test', effect: { kind: 'harmony', points } });
      return state;
    };
    const fresh = seedSecondsRate(grove());
    expect(seedSecondsRate(broken(Infinity))).toBe(Infinity);
    expect(seedSecondsRate(broken(NaN))).toBeNaN();
    expect(seedSecondsRate(broken(Infinity))).toBe(Infinity);
    const negative = seedSecondsRate(broken(-Infinity));
    expect(Object.is(negative, Infinity)).toBe(false);
    expect(Number.isNaN(negative)).toBe(false);
    expect(seedSecondsRate(broken(NaN))).toBeNaN();
    // Ein heiler Zustand danach bekommt wieder seine eigene Rate.
    expect(seedSecondsRate(grove())).toBe(fresh);
  });
});

describe('Ablehnen: überall derselbe Betrag', () => {
  it('von Hand: schreibt declineReward(state) gut', () => {
    const state = grove();
    state.pendingEncounters = [card(['bee'])];
    const reward = declineReward(state);
    expect(declineEncounter(state, 0)).toEqual({ ok: true });
    expect(state.seeds).toBe(reward);
  });

  it('Stapel voll am Wegpunkt: derselbe Betrag wie Ablehnen von Hand dort', () => {
    const state = fullStackBeforeWaypoint(grove());
    const report = tick(state, 1e-3);
    expect(report).toMatchObject({ waypoints: 1, autoDeclined: 1, declinedStackFull: 1 });
    // Nach dem Wegpunkt: Ablehnen von Hand brächte genau dasselbe.
    const manual = declineReward(state);
    expect(manual).toBeGreaterThan(SEED_SECONDS_MIN_SEEDS);
    expect(report.declinedSeeds).toBe(manual);
    const before = state.seeds;
    declineEncounter(state, 0);
    // (a + b) − a ist in Gleitkomma nicht immer exakt b: bis auf Rundung.
    expect(state.seeds - before).toBeCloseTo(manual, 9);
  });

  it('declinedSeeds ist 0 ohne automatisches Ablehnen', () => {
    const state = grove();
    state.totalGrowth = thresholdFor(state.waypoint + 1) - 1e-6;
    const report = tick(state, 1e-3);
    expect(report).toMatchObject({ waypoints: 1, autoDeclined: 0, declinedSeeds: 0 });
  });

  it('online (viele Ticks) = offline (ein Schritt): dieselbe Summe, Rate je Wegpunkt', () => {
    const online = fullStackBeforeWaypoint(grove(77));
    const offline = structuredClone(online);
    // Einzelwetter: kleine Ticks = ein großer Tick, auch für die abgelehnten Samen.
    const small = structuredClone(online);
    const big = structuredClone(online);
    let smallDeclined = 0;
    let smallCount = 0;
    for (let i = 0; i < 3600; i++) {
      const r = tick(small, 1);
      smallDeclined += r.declinedSeeds;
      smallCount += r.autoDeclined;
    }
    const bigReport = tick(big, 3600);
    expect(bigReport.autoDeclined).toBe(smallCount);
    expect(bigReport.declinedSeeds).toBeCloseTo(smallDeclined, 6);
    expect(big.seeds).toBeCloseTo(small.seeds, 6);
    expect(big.rngState).toBe(small.rngState);
    let onlineDeclined = 0;
    let onlineCount = 0;
    // 8 h: Mit 10 % Ertrag (28.3) kommen in einer Stunde zu wenige Wegpunkte.
    const away = 8 * 3600;
    for (let i = 0; i < away; i++) {
      // simulateOffline rechnet mit dem Mittelwetter (DESIGN_V2.md 21.5) und nach 60 s mit 10 %
      // (28.3): die kleinen Ticks im selben Modus und mit demselben Faktor.
      for (const r of offlineTick(online, i, 1)) {
        onlineDeclined += r.declinedSeeds;
        onlineCount += r.autoDeclined;
      }
    }
    const report = simulateOffline(offline, away);
    expect(report.autoDeclined).toBe(onlineCount);
    expect(report.autoDeclined).toBeGreaterThan(1);
    expect(report.declinedSeeds).toBeCloseTo(onlineDeclined, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
    expect(offline.rngState).toBe(online.rngState);
    // Mehr als die Untergrenze je Begegnung – die Samen-Sekunden wirken wirklich.
    expect(report.declinedSeeds).toBeGreaterThan(report.autoDeclined * SEED_SECONDS_MIN_SEEDS);
  });

  it('Samen am Maximum: declinedSeeds bleibt endlich', () => {
    const state = fullStackBeforeWaypoint(grove());
    state.seeds = Number.MAX_VALUE;
    const report = tick(state, 1e-3);
    expect(state.seeds).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(report.declinedSeeds)).toBe(true);
  });
});
