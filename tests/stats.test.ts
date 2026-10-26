import { describe, expect, it } from 'vitest';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { SEASON_SECONDS, YEAR_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { evaluate, lifetimeGrowth, thresholdFor } from '../src/core/formulas';
import { PLAY_SECONDS_TOLERANCE, exportCode, importCode, loadGame, serialize } from '../src/core/save';
import { MAX_ELAPSED } from '../src/core/season';
import { SAVE_VERSION, createInitialState, createStats, type GameState } from '../src/core/state';
import {
  MAX_STAT_COUNT,
  chooseCard,
  chooseEventOption,
  declineEncounter,
  discardSowing,
  farewellVisitor,
  hostVisitor,
  research,
  sow,
  recordDiscoveries,
  MAX_OFFLINE_SECONDS,
  simulateOffline,
  startNewCycle,
  tick,
} from '../src/core/tick';
import { offlineTick, plantFromSowing, stateAt } from './helpers';

/**
 * Langzeit-Statistik `meta.stats` (Spielstand v8, DESIGN_V2.md 12.5): Zähler in den
 * Aktionen, Spielzeit in tick (online = offline), Gesamt-Wachstum über alle Zyklen,
 * Migration v7 → v8 und robustes Laden.
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
      completedCyclesGrowth: 0,
      bestHarmony: 0,
      cardsChosen: 0,
      eventsDecided: 0,
      visitorsHosted: 0,
      plantsPlanted: 0,
      careRanksBought: 0,
      harmonyEarned: 0,
      wildwechselChosen: 0,
      upgradesBought: 0,
      upgradeSeeds: 0,
      grownTrees: ['oak'],
    });
    expect(createStats('pine').grownTrees).toEqual(['pine']);
    // JSON-serialisierbar ohne Verlust.
    expect(JSON.parse(JSON.stringify(s.meta.stats))).toEqual(s.meta.stats);
  });
});

describe('Spielzeit und Wachstum in tick', () => {
  it('zählt dt; Gesamt-Wachstum ist im ersten Zyklus genau totalGrowth', () => {
    const s = stateAt(2, ['earthworm'], 3);
    const before = s.totalGrowth;
    tick(s, 10);
    tick(s, 2.5);
    expect(s.meta.stats.playSeconds).toBe(12.5);
    expect(s.meta.stats.completedCyclesGrowth).toBe(0);
    expect(lifetimeGrowth(s)).toBe(s.totalGrowth);
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
    const years = 1000;
    tick(s, years * YEAR_SECONDS);
    expect(s.cycle.elapsed).toBe(years * YEAR_SECONDS);
    expect(s.meta.stats.playSeconds).toBe(years * YEAR_SECONDS);
    expect(lifetimeGrowth(s)).toBe(s.totalGrowth);
    expect(s.totalGrowth).toBeGreaterThan(thresholdFor(WAYPOINT_COUNT));
  });

  it('sehr große Zeitsprünge: endlich, Spielzeit auch über MAX_ELAPSED hinaus', () => {
    const s = createInitialState(0, 9);
    tick(s, MAX_ELAPSED * 4);
    expect(s.cycle.elapsed).toBeLessThanOrEqual(MAX_ELAPSED);
    expect(s.meta.stats.playSeconds).toBe(MAX_ELAPSED * 4);
    expect(Number.isFinite(lifetimeGrowth(s))).toBe(true);
    s.meta.stats.playSeconds = Number.MAX_VALUE;
    tick(s, Number.MAX_VALUE);
    expect(s.meta.stats.playSeconds).toBe(Number.MAX_VALUE);
    expect(JSON.parse(serialize(s)).meta.stats.playSeconds).toBe(Number.MAX_VALUE);
  });

  it('online = offline: viele kleine Ticks und ein großer liefern dieselbe Statistik', () => {
    const start = groveState(77);
    start.cycle.elapsed = SEASON_SECONDS - 30; // eine Jahreszeitgrenze liegt im Weg
    // Einzelwetter: kleine Ticks = großer Tick; Mittel (offline, 21.5): kleine Ticks = simulateOffline.
    for (const mode of ['live', 'average'] as const) {
      const online = structuredClone(start);
      const offline = structuredClone(start);
      // Offline mit dem Ertragsfaktor (60 s voll, danach 10 %, 28.3) – darum die vollen 8 h.
      const seconds = mode === 'live' ? 2 * 3600 : MAX_OFFLINE_SECONDS;
      for (let i = 0; i < seconds; i++) {
        if (mode === 'live') tick(online, 1, mode);
        else offlineTick(online, i, 1);
      }
      if (mode === 'live') tick(offline, seconds);
      else simulateOffline(offline, seconds);
      expect(online.waypoint).toBeGreaterThan(NEW_CYCLE_MIN_STAGE);
      // Auch offline (10 % nach 60 s, 28.3) kommen Wegpunkte – die Statistik zählt etwas.
      expect(online.waypoint - start.waypoint, mode).toBeGreaterThanOrEqual(mode === 'live' ? 5 : 2);
      expect(online.meta.stats.harmonyEarned, mode).toBeGreaterThan(0);
      // Gesammelte Harmonie (v17) wie die Samen: gleich bis auf Rundung.
      expect(offline.meta.stats.harmonyEarned / online.meta.stats.harmonyEarned, mode).toBeCloseTo(1, 9);
      expect(offline.meta.stats, mode).toEqual({ ...online.meta.stats, harmonyEarned: offline.meta.stats.harmonyEarned });
      expect(offline.meta.stats.playSeconds).toBe(online.meta.stats.playSeconds);
      expect(lifetimeGrowth(offline) / lifetimeGrowth(online), mode).toBeCloseTo(1, 11); // mit dem Faktor 0,1 etwas mehr Rundung
    }
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

describe('Gesamt-Wachstum über alle Zyklen (lifetimeGrowth)', () => {
  it('abgeschlossene Zyklen + laufender, exakt über mehrere Neue Zyklen', () => {
    const s = groveState(8);
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      tick(s, 600);
      s.stage = Math.max(s.stage, NEW_CYCLE_MIN_STAGE);
      sum += s.totalGrowth;
      expect(startNewCycle(s, 0).ok).toBe(true);
      expect(s.meta.stats.completedCyclesGrowth).toBe(sum);
    }
    tick(s, 10);
    expect(lifetimeGrowth(s)).toBe(sum + s.totalGrowth);
  });

  it('Grenzfälle: 0, NaN, negativ, riesig – endlich und ≥ 0', () => {
    const s = createInitialState(0, 1);
    expect(lifetimeGrowth(s)).toBe(0);
    s.meta.stats.completedCyclesGrowth = Number.NaN;
    s.totalGrowth = -5;
    expect(lifetimeGrowth(s)).toBe(0);
    s.meta.stats.completedCyclesGrowth = Number.MAX_VALUE;
    s.totalGrowth = Number.MAX_VALUE;
    expect(lifetimeGrowth(s)).toBe(Number.MAX_VALUE);
    s.meta.stats.completedCyclesGrowth = Number.POSITIVE_INFINITY;
    expect(lifetimeGrowth(s)).toBe(Number.MAX_VALUE);
  });

  it('Neuer Zyklus kappt bei Number.MAX_VALUE (JSON bleibt endlich)', () => {
    const s = groveState(2);
    s.meta.stats.completedCyclesGrowth = Number.MAX_VALUE;
    s.totalGrowth = Number.MAX_VALUE;
    expect(startNewCycle(s, 0).ok).toBe(true);
    expect(s.meta.stats.completedCyclesGrowth).toBe(Number.MAX_VALUE);
    expect(JSON.parse(serialize(s)).meta.stats.completedCyclesGrowth).toBe(Number.MAX_VALUE);
  });
});

describe('Zähler in den Aktionen', () => {
  it('Tierkarte wählen zählt, Ablehnen und Fehlschläge nicht', () => {
    const s = stateAt(2, [], 1);
    s.pendingEncounters = [
      { type: 'animal', cards: ['earthworm'], rerolls: 0 },
      { type: 'animal', cards: ['woodlouse'], rerolls: 0 },
      { type: 'animal', cards: ['robin'], rerolls: 0 },
    ];
    expect(chooseCard(s, 0, 5).ok).toBe(false);
    expect(s.meta.stats.cardsChosen).toBe(0);
    expect(chooseCard(s, 0, 0).ok).toBe(true);
    expect(chooseCard(s, 0, 0).ok).toBe(true);
    expect(s.meta.stats.cardsChosen).toBe(2);
    expect(declineEncounter(s, 0).ok).toBe(true);
    expect(s.meta.stats.cardsChosen).toBe(2);
    expect(s.meta.stats.plantsPlanted).toBe(0);
  });

  it('Pflanze aus einer Aussaat setzen zählt nur bei Erfolg – Säen und Zurücklegen nicht', () => {
    const s = stateAt(2, [], 1);
    expect(sow(s).ok).toBe(true);
    expect(discardSowing(s).ok).toBe(true);
    expect(s.meta.stats.plantsPlanted).toBe(0);
    expect(plantFromSowing(s, 'moss').ok).toBe(true);
    expect(plantFromSowing(s, 'gibt-es-nicht').ok).toBe(false);
    expect(s.meta.stats).toMatchObject({ plantsPlanted: 1, cardsChosen: 0 });
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

  it('erforschte Knoten zählen je Erfolg (Feld `careRanksBought` wie bis v16)', () => {
    const s = stateAt(5, ['earthworm', 'robin'], 1);
    s.harmonyPoints = 1e9;
    expect(research(s, 'leaf-litter').ok).toBe(true);
    expect(research(s, 'leaf-litter').ok).toBe(false); // schon erforscht
    expect(research(s, 'compost').ok).toBe(true);
    expect(research(s, 'gibt-es-nicht').ok).toBe(false);
    expect(s.meta.stats.careRanksBought).toBe(2);
  });

  it('Zähler bleiben ganzzahlig und enden bei MAX_STAT_COUNT', () => {
    const s = stateAt(2, [], 1);
    s.seeds = 1e6;
    s.meta.stats.plantsPlanted = MAX_STAT_COUNT;
    plantFromSowing(s, 'moss');
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
    const grown = s.totalGrowth;
    expect(startNewCycle(s, 0, 'pine').ok).toBe(true);
    expect(s.cycle.maxHarmony).toBeLessThan(best);
    expect(s.meta.stats).toEqual({ ...before, completedCyclesGrowth: grown, grownTrees: ['oak', 'pine'] });
    expect(lifetimeGrowth(s)).toBe(grown);
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

  it('v7 → v8: Startwerte aus dem laufenden Zyklus, Zähler 0, ab Zyklus 2 auch die Eiche', () => {
    expect(SAVE_VERSION).toBe(18);
    const s = loadGame(rawV7(), 0)!.state;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.meta.stats).toEqual({
      playSeconds: 2 * YEAR_SECONDS + 42,
      completedCyclesGrowth: 0,
      bestHarmony: 1e4,
      cardsChosen: 0,
      eventsDecided: 0,
      visitorsHosted: 0,
      plantsPlanted: 0,
      careRanksBought: 0,
      harmonyEarned: 0,
      wildwechselChosen: 0,
      upgradesBought: 0,
      upgradeSeeds: 0,
      // Jeder erste Zyklus beginnt mit der Stieleiche – sie steht vorn.
      grownTrees: ['oak', 'pine'],
    });
    expect(lifetimeGrowth(s)).toBe(s.totalGrowth);
  });

  it('v7 im ersten Zyklus: nur die aktuelle Baumart; Eiche ab Zyklus 2 nicht doppelt', () => {
    const first = loadGame(rawV7((d) => ((d.cycle.number = 1), (d.cycle.mainTree = 'oak'))), 0)!.state;
    expect(first.meta.stats.grownTrees).toEqual(['oak']);
    const oakAgain = loadGame(rawV7((d) => (d.cycle.mainTree = 'oak')), 0)!.state;
    expect(oakAgain.meta.stats.grownTrees).toEqual(['oak']);
  });

  it('v7 mit fremdem `meta.stats`: zählt nicht', () => {
    const s = loadGame(
      rawV7((d) => (d.meta.stats = { cardsChosen: 999, completedCyclesGrowth: 1e9, grownTrees: ['beech'] })),
      0,
    )!.state;
    expect(s.meta.stats.cardsChosen).toBe(0);
    expect(s.meta.stats.completedCyclesGrowth).toBe(0);
    expect(s.meta.stats.grownTrees).toEqual(['oak', 'pine']);
  });

  it('ältere Stände (v1, v2, v5) bekommen ebenfalls gültige Startwerte', () => {
    const v1 = loadGame(JSON.stringify({ version: 1, stage: 4, totalEnergy: 1e6, lastTick: 5 }), 10)!.state;
    expect(v1.meta.stats).toEqual(createStats());
    const v2 = loadGame(JSON.stringify({ version: 2, totalGrowth: 500, seeds: 1, lastTick: 1 }), 10)!.state;
    expect(v2.meta.stats).toMatchObject({ playSeconds: 0, completedCyclesGrowth: 0, grownTrees: ['oak'] });
    expect(lifetimeGrowth(v2)).toBe(v2.totalGrowth);
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
      completedCyclesGrowth: 0,
      bestHarmony: base.cycle.maxHarmony,
      cardsChosen: 0,
      eventsDecided: 0,
      visitorsHosted: 0,
      plantsPlanted: 0,
      careRanksBought: 0,
      harmonyEarned: 0,
      wildwechselChosen: 0,
      upgradesBought: 0,
      upgradeSeeds: 0,
      grownTrees: ['oak'],
    };
    for (const broken of [undefined, null, 'x', 42, [1, 2], {}]) expect(load(broken), String(broken)).toEqual(fallback);
    const s = load({
      playSeconds: '__INF__',
      completedCyclesGrowth: -5,
      bestHarmony: 'viel',
      cardsChosen: 3.9,
      eventsDecided: '__NINF__',
      visitorsHosted: '__INF__',
      plantsPlanted: null,
      careRanksBought: true,
      harmonyEarned: '__INF__',
      wildwechselChosen: -1,
      upgradesBought: 2.7,
      upgradeSeeds: '__NINF__',
      grownTrees: ['oak', 'drache', 'oak', 7, 'beech', 'fir', 'alder'],
    });
    expect(s).toEqual({
      ...fallback,
      playSeconds: Number.MAX_VALUE,
      cardsChosen: 3,
      upgradesBought: 2,
      visitorsHosted: MAX_STAT_COUNT,
      harmonyEarned: Number.MAX_VALUE,
      // Rotbuche ist nicht freigeschaltet (nicht im Tagebuch), Weißtanne und Schwarzerle nicht
      // (Standort nicht gegründet) – keine kann gewachsen sein.
      grownTrees: ['oak'],
    });
  });

  it('Untergrenzen aus dem laufenden Zyklus; aktuelle Baumart kommt dazu', () => {
    const base = groveState(5);
    base.cycle.mainTree = 'pine';
    base.meta.journal.plants.push('pine', 'beech');
    base.cycle.elapsed = 1000;
    const s = loadGame(
      raw(base, (d) => (d.meta.stats = { ...createStats(), playSeconds: 10, bestHarmony: 0, grownTrees: ['beech'] })),
      0,
    )!.state.meta.stats;
    expect(s.playSeconds).toBe(1000);
    expect(s.bestHarmony).toBe(base.cycle.maxHarmony);
    expect(s.grownTrees).toEqual(['beech', 'pine']);
  });

  it('Spielzeit: Untergrenze erst jenseits der Toleranz (Rundungsrauschen bleibt)', () => {
    const base = groveState(5);
    base.cycle.elapsed = 1000;
    const load = (playSeconds: number) =>
      loadGame(raw(base, (d) => (d.meta.stats.playSeconds = playSeconds)), 0)!.state.meta.stats.playSeconds;
    const slack = 1000 * PLAY_SECONDS_TOLERANCE;
    expect(load(1000 - slack / 2)).toBe(1000 - slack / 2);
    expect(load(1000 - slack * 2)).toBe(1000);
    // Kleine Spielzeit: mindestens die absolute Toleranz.
    base.cycle.elapsed = 1e-7;
    expect(load(0)).toBe(0);
    base.cycle.elapsed = 1;
    expect(load(0)).toBe(1);
  });

  it('Roundtrip nach echtem Spiel (Frames à 1/60 s): bitgenau gleich', () => {
    // Spielzeit und `cycle.elapsed` werden getrennt aufsummiert und driften um Rundungsrauschen.
    const s = groveState(21);
    for (let i = 0; i < 600; i++) tick(s, 1 / 60);
    expect(loadGame(serialize(s), 0)!.state).toEqual(s);
    // 10 min am Stück, über eine Jahreszeitgrenze (dort wird elapsed exakt gesetzt).
    for (let i = 0; i < 600 * 60; i++) tick(s, 1 / 60);
    expect(s.cycle.elapsed).toBeGreaterThan(SEASON_SECONDS);
    expect(loadGame(serialize(s), 0)!.state).toEqual(s);
  });
});
