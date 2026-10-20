import { describe, expect, it } from 'vitest';
import { DECLINE_SEEDS, MAX_PENDING_ENCOUNTERS } from '../src/content/encounters';
import { SPECIES_BY_ID } from '../src/content/species';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { cardStatus, evaluate, thresholdFor } from '../src/core/formulas';
import { allAnimals, createInitialState, type GameState } from '../src/core/state';
import {
  MAX_OFFLINE_SECONDS,
  chooseCard,
  declineEncounter,
  drawAnimals,
  simulateOffline,
  tick,
} from '../src/core/tick';
import { stateAt } from './helpers';

/**
 * Feste Wahl-Strategie für Golden Tests: erste Karte mit freiem Platz; sonst die erste
 * Karte mit voller Nische und das erste Tier dort entlassen; sonst ablehnen.
 */
function resolveAll(state: GameState): void {
  while (state.pendingEncounters.length > 0) {
    const cards = state.pendingEncounters[0]!.cards;
    const statuses = cards.map((_, c) => cardStatus(state, 0, c));
    const free = statuses.indexOf('free');
    const full = statuses.indexOf('full');
    if (free >= 0) chooseCard(state, 0, free);
    else if (full >= 0) chooseCard(state, 0, full, state.niches[SPECIES_BY_ID.get(cards[full]!)!.niche][0]);
    else declineEncounter(state, 0);
  }
}

describe('tick', () => {
  it('ignoriert 0, negative, NaN und unendliche Zeit', () => {
    const state = createInitialState(0, 42);
    const before = structuredClone(state);
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) tick(state, dt);
    expect(state).toEqual(before);
  });

  it('wächst von selbst und sammelt Samen', () => {
    const state = createInitialState(0, 42);
    tick(state, 2);
    expect(state.totalGrowth).toBeCloseTo(2 * 1.05);
    expect(state.seeds).toBeCloseTo(2 * 0.105);
    expect(state.waypoint).toBe(0);
  });

  it('erster Wegpunkt nach ~4 s: Keimling und eine Begegnung mit dem Regenwurm', () => {
    const state = createInitialState(0, 42);
    const report = tick(state, 4);
    expect(report).toEqual({ waypoints: 1, encounters: 1, autoDeclined: 0 });
    expect(state.waypoint).toBe(1);
    expect(state.stage).toBe(1);
    // Im Keimling ist nur der Regenwurm freigeschaltet → genau eine Karte.
    expect(state.pendingEncounters).toEqual([{ type: 'animal', cards: ['earthworm'], rerolls: 0 }]);
  });

  it('über mehrere Wegpunkte in einem Schritt: jeder Wegpunkt wird einzeln gezählt', () => {
    const state = createInitialState(0, 42);
    const report = tick(state, 120);
    expect(state.waypoint).toBe(report.waypoints);
    expect(report.waypoints).toBeGreaterThanOrEqual(2);
    expect(report.encounters + report.autoDeclined).toBe(report.waypoints);
    expect(state.totalGrowth).toBeGreaterThanOrEqual(thresholdFor(state.waypoint));
    expect(state.totalGrowth).toBeLessThan(thresholdFor(state.waypoint + 1));
  });

  it('ohne passende Art: Wegpunkt wird wie Ablehnen mit Samen gutgeschrieben', () => {
    const state = stateAt(1, ['earthworm']);
    state.totalGrowth = thresholdFor(2) - 0.001;
    const seeds = state.seeds;
    const report = tick(state, 1);
    expect(report.autoDeclined).toBe(1);
    expect(state.pendingEncounters).toHaveLength(0);
    expect(state.seeds).toBeGreaterThan(seeds + DECLINE_SEEDS - 0.01);
  });

  it(`höchstens ${MAX_PENDING_ENCOUNTERS} offene Begegnungen, Überlauf wird als Samen gutgeschrieben`, () => {
    const state = stateAt(3);
    const report = tick(state, 3600);
    expect(report.waypoints).toBeGreaterThan(MAX_PENDING_ENCOUNTERS);
    expect(state.pendingEncounters).toHaveLength(MAX_PENDING_ENCOUNTERS);
    expect(report.autoDeclined).toBe(report.waypoints - MAX_PENDING_ENCOUNTERS);
  });

  it('Karten sind verschieden, freigeschaltet und leben noch nicht hier', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = stateAt(3, ['earthworm', 'bee'], seed);
      const cards = drawAnimals(state);
      expect(cards.length).toBeGreaterThan(0);
      expect(new Set(cards).size).toBe(cards.length);
      for (const id of cards) {
        const sp = SPECIES_BY_ID.get(id)!;
        expect(sp.unlock).toBeLessThanOrEqual(3);
        expect(['earthworm', 'bee']).not.toContain(id);
      }
    }
  });

  it('nach dem letzten Wegpunkt wächst der Baum weiter, ohne Begegnungen', () => {
    const state = stateAt(7);
    expect(state.waypoint).toBe(WAYPOINT_COUNT);
    const report = tick(state, 1e6);
    expect(report.waypoints).toBe(0);
    expect(state.totalGrowth).toBeGreaterThan(thresholdFor(WAYPOINT_COUNT));
    expect(Number.isFinite(state.totalGrowth)).toBe(true);
  });

  it('übersteht riesige Zeitsprünge', () => {
    const state = createInitialState(0, 3);
    tick(state, 1e15);
    expect(state.waypoint).toBe(WAYPOINT_COUNT);
    expect(state.stage).toBe(7);
    expect(Number.isFinite(state.seeds)).toBe(true);
  });
});

describe('simulateOffline', () => {
  it('liefert dasselbe Ergebnis wie laufende Ticks (inkl. Begegnungen und Überlauf)', () => {
    const online = stateAt(2, ['earthworm', 'robin'], 99);
    const offline = structuredClone(online);
    for (let i = 0; i < 3 * 3600; i++) tick(online, 1);
    const report = simulateOffline(offline, 3 * 3600);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.stage).toBe(online.stage);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
    expect(report.waypoints).toBeGreaterThan(MAX_PENDING_ENCOUNTERS);
    expect(report.autoDeclined).toBe(report.waypoints - MAX_PENDING_ENCOUNTERS);
  });

  it('auch mit Frame-Schritten (60 fps) und Entscheidungen dazwischen', () => {
    const a = createInitialState(0, 7);
    const b = createInitialState(0, 7);
    // Beide spielen 10 Minuten; Entscheidungen jeweils nach derselben Spielzeit.
    for (let minute = 0; minute < 10; minute++) {
      for (let f = 0; f < 60 * 60; f++) tick(a, 1 / 60);
      simulateOffline(b, 60);
      resolveAll(a);
      resolveAll(b);
      expect(b.niches).toEqual(a.niches);
    }
    expect(b.waypoint).toBe(a.waypoint);
    expect(b.totalGrowth).toBeCloseTo(a.totalGrowth, 4);
    expect(b.seeds).toBeCloseTo(a.seeds, 4);
    expect(b.rngState).toBe(a.rngState);
  });

  it('ist auf 8 Stunden begrenzt und übersteht ungültige Werte', () => {
    const a = createInitialState(0, 5);
    const b = createInitialState(0, 5);
    simulateOffline(a, MAX_OFFLINE_SECONDS);
    const report = simulateOffline(b, MAX_OFFLINE_SECONDS * 10);
    expect(report.seconds).toBe(MAX_OFFLINE_SECONDS);
    expect(b).toEqual(a);
    for (const bad of [NaN, -100, -Infinity]) {
      const c = createInitialState(0, 5);
      expect(simulateOffline(c, bad)).toMatchObject({ seconds: 0, growth: 0, seeds: 0, waypoints: 0 });
    }
    expect(simulateOffline(createInitialState(0, 5), Infinity).seconds).toBe(0);
  });

  it('meldet Wachstum, Samen und neue Begegnungen', () => {
    const state = createInitialState(0, 11);
    const report = simulateOffline(state, 600);
    expect(report.growth).toBeCloseTo(state.totalGrowth);
    expect(report.seeds).toBeCloseTo(state.seeds);
    expect(report.encounters).toBe(state.pendingEncounters.length);
  });
});

describe('Golden Test: fester Seed + feste Wahl-Strategie', () => {
  /** 2 Stunden spielen, alle 10 s entscheiden. */
  function play(seed: number): GameState {
    const state = createInitialState(0, seed);
    for (let t = 0; t < 2 * 3600; t += 10) {
      tick(state, 10);
      resolveAll(state);
    }
    return state;
  }

  it('liefert festgelegte Ergebnisse', () => {
    const state = play(2026);
    const ev = evaluate(state);
    expect({
      waypoint: state.waypoint,
      stage: state.stage,
      niches: state.niches,
      journal: state.meta.journal.species,
      rngState: state.rngState,
      totalGrowth: Math.round(state.totalGrowth),
      seeds: Math.round(state.seeds),
      harmony: Math.round(ev.harmony * 100) / 100,
    }).toMatchInlineSnapshot(`
      {
        "harmony": 54.67,
        "journal": [
          "earthworm",
          "robin",
          "bee",
          "woodlouse",
          "oakmoth",
          "bluetit",
          "centipede",
          "barkbeetle",
          "woodpecker",
        ],
        "niches": {
          "bark": [
            "barkbeetle",
            "woodpecker",
          ],
          "crown": [
            "oakmoth",
            "bluetit",
          ],
          "edge": [
            "bee",
          ],
          "litter": [
            "robin",
            "centipede",
            "woodlouse",
          ],
          "roots": [
            "earthworm",
          ],
        },
        "rngState": 3708559431,
        "seeds": 11934,
        "stage": 5,
        "totalGrowth": 160105,
        "waypoint": 27,
      }
    `);
  });

  it('ist reproduzierbar und hängt vom Seed ab', () => {
    const a = play(1);
    expect(play(1)).toEqual(a);
    const others = [2, 3, 4, 5].map((s) => JSON.stringify(play(s).niches));
    expect(others.some((n) => n !== JSON.stringify(a.niches))).toBe(true);
    expect(allAnimals(a).length).toBeGreaterThan(0);
  });
});
