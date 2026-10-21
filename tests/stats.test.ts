import { describe, expect, it } from 'vitest';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { evaluate, thresholdFor } from '../src/core/formulas';
import { exportCode, importCode, loadGame, serialize } from '../src/core/save';
import { MAX_ELAPSED } from '../src/core/season';
import { SAVE_VERSION, createInitialState, createStats, type GameState } from '../src/core/state';
import {
  MAX_STAT_COUNT,
  buyCare,
  chooseCard,
  chooseEventOption,
  declineEncounter,
  farewellVisitor,
  hostVisitor,
  plantSeed,
  recordDiscoveries,
  simulateOffline,
  startNewCycle,
  tick,
} from '../src/core/tick';
import { stateAt } from './helpers';

/**
 * Langzeit-Statistik `meta.stats` (Spielstand v8, DESIGN_V2.md 12.5): Zähler in den
 * Aktionen, Spielzeit und Wachstum in tick (online = offline), Migration v7 → v8 und
 * robustes Laden.
 */

/** Hain mit Tieren, Pflanzen und offener Begegnung – bereit für den Neuen Zyklus. */
function groveState(seed = 5): GameState {
  const state = stateAt(NEW_CYCLE_MIN_STAGE, ['earthworm', 'robin', 'bluetit', 'bee'], seed);
  state.plants = ['hazel', 'moss'];
  state.seeds = 1234;
  state.meta.journal.plants = ['hazel', 'moss'];
  recordDiscoveries(state);
  return state;
}

/** Der aktuelle Stand als Rohdaten mit Patch auf `meta.stats` bzw. Version. */
function raw(state: GameState, patch: (data: Record<string, any>) => void): string {
  const data = JSON.parse(serialize(state));
  patch(data);
  return JSON.stringify(data);
}

describe('Startwerte', () => {
  it('neues Spiel: alles 0, die Stieleiche ist gewachsen', () => {
    const s = createInitialState(0, 1);
    expect(s.meta.stats).toEqual({
      playSeconds: 0,
      totalGrowth: 0,
      bestHarmony: 0,
      cardsChosen: 0,
      eventsDecided: 0,
      visitorsHosted: 0,
      plantsPlanted: 0,
      careRanksBought: 0,
      grownTrees: ['oak'],
    });
    expect(createStats('pine').grownTrees).toEqual(['pine']);
    // JSON-serialisierbar ohne Verlust.
    expect(JSON.parse(JSON.stringify(s.meta.stats))).toEqual(s.meta.stats);
  });
});

describe('Spielzeit und Wachstum in tick', () => {
  it('zählt dt und den Zuwachs an Wachstum', () => {
    const s = stateAt(2, ['earthworm'], 3);
    const before = s.totalGrowth;
    tick(s, 10);
    tick(s, 2.5);
    expect(s.meta.stats.playSeconds).toBe(12.5);
    expect(s.meta.stats.totalGrowth).toBeCloseTo(s.totalGrowth, 9);
    expect(s.totalGrowth).toBeGreaterThan(before);
  });

  it('ungültige dt (0, negativ, NaN, Infinity) ändern nichts', () => {
    const s = stateAt(2, ['earthworm'], 3);
    const stats = structuredClone(s.meta.stats);
    for (const dt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) tick(s, dt);
    expect(s.meta.stats).toEqual(stats);
  });

  it('Schnellvorlauf über ganze Jahre zählt mit (ein großer Tick)', () => {
    // Am letzten Wegpunkt: kein Halt mehr, der Vorlauf springt über alle Jahre.
    const s = stateAt(STAGES.length - 1, ['earthworm'], 9);
    s.waypoint = WAYPOINT_COUNT;
    s.totalGrowth = thresholdFor(WAYPOINT_COUNT);
    s.meta.stats.totalGrowth = s.totalGrowth;
    const years = 1000;
    tick(s, years * YEAR_SECONDS);
    expect(s.cycle.elapsed).toBe(years * YEAR_SECONDS);
    expect(s.meta.stats.playSeconds).toBe(years * YEAR_SECONDS);
    expect(s.meta.stats.totalGrowth / s.totalGrowth).toBeCloseTo(1, 12);
    expect(s.totalGrowth).toBeGreaterThan(thresholdFor(WAYPOINT_COUNT));
  });

  it('sehr große Zeitsprünge: endlich, Spielzeit auch über MAX_ELAPSED hinaus', () => {
    const s = createInitialState(0, 9);
    tick(s, MAX_ELAPSED * 4);
    expect(s.cycle.elapsed).toBeLessThanOrEqual(MAX_ELAPSED);
    expect(s.meta.stats.playSeconds).toBe(MAX_ELAPSED * 4);
    expect(Number.isFinite(s.meta.stats.totalGrowth)).toBe(true);
    s.meta.stats.playSeconds = Number.MAX_VALUE;
    tick(s, Number.MAX_VALUE);
    expect(s.meta.stats.playSeconds).toBe(Number.MAX_VALUE);
    expect(JSON.parse(serialize(s)).meta.stats.playSeconds).toBe(Number.MAX_VALUE);
  });

  it('online = offline: viele kleine Ticks und ein großer liefern dieselbe Statistik', () => {
    const online = groveState(77);
    online.cycle.elapsed = SEASON_SECONDS - 30; // eine Jahreszeitgrenze liegt im Weg
    const offline = structuredClone(online);
    for (let i = 0; i < 2 * 3600; i++) tick(online, 1);
    simulateOffline(offline, 2 * 3600);
    expect(online.waypoint).toBeGreaterThan(NEW_CYCLE_MIN_STAGE);
    const { totalGrowth: growthOn, ...restOn } = online.meta.stats;
    const { totalGrowth: growthOff, ...restOff } = offline.meta.stats;
    expect(restOff).toEqual(restOn);
    expect(offline.meta.stats.playSeconds).toBe(online.meta.stats.playSeconds);
    expect(growthOff / growthOn).toBeCloseTo(1, 12);
  });

  it('deterministisch: gleicher Stand, gleiche Folge → gleiche Statistik', () => {
    const run = () => {
      const s = groveState(4242);
      s.pendingEncounters = [{ type: 'animal', cards: ['vole'], rerolls: 0 }];
      tick(s, 1234);
      chooseCard(s, 0, 0);
      tick(s, 3600);
      startNewCycle(s, 0);
      tick(s, 600);
      return s;
    };
    expect(run().meta.stats).toEqual(run().meta.stats);
    expect(serialize(run())).toBe(serialize(run()));
  });
});

describe('Zähler in den Aktionen', () => {
  it('Karte wählen (Tier und Pflanze) zählt, Ablehnen und Fehlschläge nicht', () => {
    const s = stateAt(2, [], 1);
    s.pendingEncounters = [
      { type: 'animal', cards: ['earthworm'], rerolls: 0 },
      { type: 'plant', cards: ['moss'], rerolls: 0 },
      { type: 'animal', cards: ['robin'], rerolls: 0 },
    ];
    expect(chooseCard(s, 0, 5).ok).toBe(false);
    expect(s.meta.stats.cardsChosen).toBe(0);
    expect(chooseCard(s, 0, 0).ok).toBe(true);
    expect(chooseCard(s, 0, 0).ok).toBe(true);
    expect(s.meta.stats.cardsChosen).toBe(2);
    expect(declineEncounter(s, 0).ok).toBe(true);
    expect(s.meta.stats.cardsChosen).toBe(2);
    // Gekeimte Pflanzen zählen als Karte, nicht als gesetzt.
    expect(s.meta.stats.plantsPlanted).toBe(0);
  });

  it('Pflanze setzen zählt nur bei Erfolg', () => {
    const s = stateAt(2, [], 1);
    expect(plantSeed(s, 'moss').ok).toBe(false); // zu teuer
    s.seeds = 1e6;
    expect(plantSeed(s, 'moss').ok).toBe(true);
    expect(plantSeed(s, 'gibt-es-nicht').ok).toBe(false);
    expect(s.meta.stats.plantsPlanted).toBe(1);
  });

  it('Ereignis entscheiden und Gast bewirten zählen, Ziehenlassen nicht', () => {
    const s = stateAt(4, ['earthworm', 'robin'], 1);
    s.seeds = 1e9;
    s.pendingEncounters = [
      { type: 'event', cards: ['storm'], rerolls: 0 },
      { type: 'visitor', cards: ['cranes'], rerolls: 0 },
      { type: 'visitor', cards: ['bramblings'], rerolls: 0 },
    ];
    expect(chooseEventOption(s, 0, 99).ok).toBe(false);
    expect(chooseEventOption(s, 0, 0).ok).toBe(true);
    expect(hostVisitor(s, 0).ok).toBe(true);
    expect(farewellVisitor(s, 0).ok).toBe(true);
    expect(s.meta.stats).toMatchObject({ eventsDecided: 1, visitorsHosted: 1, cardsChosen: 0 });
  });

  it('Pflege-Ränge zählen je Kauf', () => {
    const s = stateAt(5, ['earthworm', 'robin'], 1);
    s.seeds = 1e9;
    expect(buyCare(s, 'leaf-litter').ok).toBe(true);
    expect(buyCare(s, 'leaf-litter').ok).toBe(true);
    expect(buyCare(s, 'gibt-es-nicht').ok).toBe(false);
    expect(s.meta.stats.careRanksBought).toBe(2);
  });

  it('Zähler bleiben ganzzahlig und enden bei MAX_STAT_COUNT', () => {
    const s = stateAt(2, [], 1);
    s.seeds = 1e6;
    s.meta.stats.plantsPlanted = MAX_STAT_COUNT;
    plantSeed(s, 'moss');
    expect(s.meta.stats.plantsPlanted).toBe(MAX_STAT_COUNT);
  });

  it('Neuer Zyklus: Statistik bleibt, beste Harmonie überdauert H_max, neue Baumart je einmal', () => {
    const s = groveState();
    s.meta.journal.plants.push('pine');
    tick(s, 100);
    const best = s.meta.stats.bestHarmony;
    expect(best).toBe(s.cycle.maxHarmony);
    expect(best).toBeGreaterThan(0);
    const before = structuredClone(s.meta.stats);
    expect(startNewCycle(s, 0, 'pine').ok).toBe(true);
    expect(s.cycle.maxHarmony).toBeLessThan(best);
    expect(s.meta.stats).toEqual({ ...before, grownTrees: ['oak', 'pine'] });
    // Wieder Kiefer, dann Eiche: keine Doppel.
    s.stage = NEW_CYCLE_MIN_STAGE;
    startNewCycle(s, 0, 'pine');
    s.stage = NEW_CYCLE_MIN_STAGE;
    startNewCycle(s, 0, 'oak');
    expect(s.meta.stats.grownTrees).toEqual(['oak', 'pine']);
    // Gesperrte Art: nichts ändert sich.
    s.stage = NEW_CYCLE_MIN_STAGE;
    expect(startNewCycle(s, 0, 'beech').ok).toBe(false);
    expect(s.meta.stats.grownTrees).toEqual(['oak', 'pine']);
  });

  it('beste Harmonie folgt jeder höheren Harmonie (auch beim Laden)', () => {
    const s = groveState();
    expect(s.meta.stats.bestHarmony).toBe(evaluate(s).harmony);
    s.meta.stats.bestHarmony = 1e6;
    recordDiscoveries(s);
    expect(s.meta.stats.bestHarmony).toBe(1e6);
  });
});

describe('Spielstand v8: Migration v7 → v8 und robustes Laden', () => {
  /** Ein v7-Stand im zweiten Zyklus (Kiefer, mitten im Jahr) – ohne `meta.stats`. */
  function rawV7(patch: (data: Record<string, any>) => void = () => {}): string {
    const s = groveState(11);
    s.cycle.number = 3;
    s.cycle.mainTree = 'pine';
    s.meta.journal.plants.push('pine');
    s.cycle.elapsed = 2 * YEAR_SECONDS + 42;
    s.cycle.maxHarmony = 1e4; // höher als die aktuelle Harmonie
    return raw(s, (d) => {
      d.version = 7;
      delete d.meta.stats;
      patch(d);
    });
  }

  it('v7 → v8: Startwerte aus dem laufenden Zyklus, Zähler 0', () => {
    expect(SAVE_VERSION).toBe(8);
    const s = loadGame(rawV7(), 0)!.state;
    expect(s.version).toBe(8);
    expect(s.meta.stats).toEqual({
      playSeconds: 2 * YEAR_SECONDS + 42,
      totalGrowth: s.totalGrowth,
      bestHarmony: 1e4,
      cardsChosen: 0,
      eventsDecided: 0,
      visitorsHosted: 0,
      plantsPlanted: 0,
      careRanksBought: 0,
      grownTrees: ['pine'],
    });
  });

  it('v7 mit fremdem `meta.stats`: zählt nicht', () => {
    const s = loadGame(rawV7((d) => (d.meta.stats = { cardsChosen: 999, grownTrees: ['oak', 'beech'] })), 0)!.state;
    expect(s.meta.stats.cardsChosen).toBe(0);
    expect(s.meta.stats.grownTrees).toEqual(['pine']);
  });

  it('ältere Stände (v1, v2, v5) bekommen ebenfalls gültige Startwerte', () => {
    const v1 = loadGame(JSON.stringify({ version: 1, stage: 4, totalEnergy: 1e6, lastTick: 5 }), 10)!.state;
    expect(v1.meta.stats).toEqual(createStats());
    const v2 = loadGame(JSON.stringify({ version: 2, totalGrowth: 500, seeds: 1, lastTick: 1 }), 10)!.state;
    expect(v2.meta.stats).toMatchObject({ playSeconds: 0, totalGrowth: v2.totalGrowth, grownTrees: ['oak'] });
    const v5 = loadGame(rawV7((d) => (d.version = 5)), 0)!.state;
    expect(v5.meta.stats).toMatchObject({ playSeconds: 0, grownTrees: ['oak'], cardsChosen: 0 });
  });

  it('Roundtrip v8, auch über Export/Import', () => {
    const s = groveState(3);
    s.pendingEncounters = [{ type: 'animal', cards: ['vole'], rerolls: 0 }];
    chooseCard(s, 0, 0);
    tick(s, 500);
    s.meta.stats.eventsDecided = 4;
    expect(loadGame(serialize(s), 0)!.state).toEqual(s);
    const imported = importCode(exportCode(s), 123);
    expect(imported.ok && imported.result.state.meta.stats).toEqual(s.meta.stats);
  });

  it('kaputte Felder: Nicht-Zahlen, negativ, ±Infinity, Brüche, falsche Typen', () => {
    const base = groveState(5);
    const load = (stats: unknown) =>
      loadGame(
        raw(base, (d) => (d.meta.stats = stats)).replaceAll('"__INF__"', '1e400').replaceAll('"__NINF__"', '-1e400'),
        0,
      )!.state.meta.stats;
    const fallback = {
      playSeconds: 0,
      totalGrowth: base.totalGrowth,
      bestHarmony: base.cycle.maxHarmony,
      cardsChosen: 0,
      eventsDecided: 0,
      visitorsHosted: 0,
      plantsPlanted: 0,
      careRanksBought: 0,
      grownTrees: ['oak'],
    };
    for (const broken of [undefined, null, 'x', 42, [1, 2], {}]) expect(load(broken), String(broken)).toEqual(fallback);
    const s = load({
      playSeconds: '__INF__',
      totalGrowth: -5,
      bestHarmony: 'viel',
      cardsChosen: 3.9,
      eventsDecided: '__NINF__',
      visitorsHosted: '__INF__',
      plantsPlanted: null,
      careRanksBought: true,
      grownTrees: ['oak', 'drache', 'oak', 7, 'beech'],
    });
    expect(s).toEqual({
      ...fallback,
      playSeconds: Number.MAX_VALUE,
      cardsChosen: 3,
      visitorsHosted: MAX_STAT_COUNT,
      // Rotbuche ist nicht freigeschaltet (nicht im Tagebuch) – kann nicht gewachsen sein.
      grownTrees: ['oak'],
    });
  });

  it('Untergrenzen aus dem laufenden Zyklus; aktuelle Baumart kommt dazu', () => {
    const base = groveState(5);
    base.cycle.mainTree = 'pine';
    base.meta.journal.plants.push('pine', 'beech');
    base.cycle.elapsed = 1000;
    const s = loadGame(
      raw(base, (d) => (d.meta.stats = { ...createStats(), playSeconds: 10, totalGrowth: 1, bestHarmony: 0, grownTrees: ['beech'] })),
      0,
    )!.state.meta.stats;
    expect(s.playSeconds).toBe(1000);
    expect(s.totalGrowth).toBe(base.totalGrowth);
    expect(s.bestHarmony).toBe(base.cycle.maxHarmony);
    expect(s.grownTrees).toEqual(['beech', 'pine']);
  });
});
