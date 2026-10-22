import { describe, expect, it } from 'vitest';
import { ENCOUNTER_WEIGHTS, MAX_PENDING_ENCOUNTERS, PLANT_WEIGHT_RING_FULL } from '../src/content/encounters';
import { PLANTS, PLANTS_BY_ID, type Plant } from '../src/content/plants';
import { SEASONS_BY_ID } from '../src/content/seasons';
import { SPECIES_BY_ID } from '../src/content/species';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { cardStatus, declineReward, evaluate, thresholdFor } from '../src/core/formulas';
import { allAnimals, createInitialState, type GameState } from '../src/core/state';
import {
  MAX_OFFLINE_SECONDS,
  chooseCard,
  declineEncounter,
  drawAnimals,
  drawEncounter,
  drawPlants,
  plantSeed,
  simulateOffline,
  tick,
} from '../src/core/tick';
import { SPRING_GROWTH, resolveSpecial, stateAt } from './helpers';

/**
 * Feste Wahl-Strategie für Golden Tests: erste Karte mit freiem Platz; sonst die erste
 * Karte mit voller Nische (bzw. vollem Pflanzring) und das erste Tier dort entlassen
 * (bzw. die erste Pflanze ersetzen); sonst ablehnen. Scheitert der Tausch, ablehnen.
 */
function resolveAll(state: GameState): void {
  while (state.pendingEncounters.length > 0) {
    if (resolveSpecial(state)) continue;
    const { type, cards } = state.pendingEncounters[0]!;
    const statuses = cards.map((_, c) => cardStatus(state, 0, c));
    const free = statuses.indexOf('free');
    const full = statuses.indexOf('full');
    if (free >= 0) chooseCard(state, 0, free);
    else if (full >= 0) {
      const replace = type === 'plant' ? state.plants[0] : state.niches[SPECIES_BY_ID.get(cards[full]!)!.niche][0];
      if (!chooseCard(state, 0, full, replace).ok) declineEncounter(state, 0);
    } else declineEncounter(state, 0);
  }
}

/** Wie resolveAll, setzt danach Pflanzen (immer die erste freigeschaltete), solange Samen reichen. */
function resolveAndPlant(state: GameState): void {
  resolveAll(state);
  while (plantSeed(state, state.stage >= 2 ? 'hazel' : 'anemone').ok) {
    // weiter, bis Ring voll oder Samen alle
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
    expect(state.totalGrowth).toBeCloseTo(2 * 1.05 * (1 + SPRING_GROWTH)); // Frühling
    expect(state.seeds).toBeCloseTo(2 * 0.105);
    expect(state.waypoint).toBe(0);
  });

  it('erster Wegpunkt nach ~4 s: Keimling und eine Begegnung mit den Wurzelraum-Gästen', () => {
    const state = createInitialState(0, 42);
    const report = tick(state, 4);
    expect(report).toEqual({
      waypoints: 1,
      encounters: 1,
      autoDeclined: 0,
      declinedStackFull: 0,
      declinedNoCards: 0,
      declinedSeeds: 0,
      regulars: [],
      interludes: 0,
      interludesReached: 0,
      expired: [],
      seasons: [],
      weather: [],
      wildwechsel: [],
    });
    expect(state.waypoint).toBe(1);
    expect(state.stage).toBe(1);
    // Im Keimling sind nur Regenwurm, Wühlmaus und Pfifferling freigeschaltet → genau diese drei.
    expect(state.pendingEncounters).toHaveLength(1);
    expect(state.pendingEncounters[0]).toMatchObject({ type: 'animal', rerolls: 0 });
    expect([...state.pendingEncounters[0]!.cards].sort()).toEqual(['chanterelle', 'earthworm', 'vole']);
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

  it('die ersten Begegnungen sind festgelegt: Tier, Pflanze, Tier', () => {
    const state = createInitialState(0, 42);
    tick(state, 4);
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal']);
    tick(state, 1e-9 + (thresholdFor(2) - state.totalGrowth) / evaluate(state).growth);
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal', 'plant']);
    // Keimling: nur Buschwindröschen und Frauenhaarmoos sind freigeschaltet.
    expect([...state.pendingEncounters[1]!.cards].sort()).toEqual(['anemone', 'moss']);
    tick(state, 1e-9 + (thresholdFor(3) - state.totalGrowth) / evaluate(state).growth);
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal', 'plant', 'animal']);
  });

  it('Tierbegegnung ohne passende Art wird zu „Etwas keimt“', () => {
    // Wegpunkt 1 (Tier, festgelegt), aber alle Keimling-Gäste leben schon hier.
    const state = createInitialState(0, 8);
    state.niches.roots.push('earthworm', 'vole', 'chanterelle');
    state.totalGrowth = thresholdFor(1) - 0.001;
    const report = tick(state, 1);
    expect(report).toEqual({
      waypoints: 1,
      encounters: 1,
      autoDeclined: 0,
      declinedStackFull: 0,
      declinedNoCards: 0,
      declinedSeeds: 0,
      regulars: [],
      interludes: 0,
      interludesReached: 0,
      expired: [],
      seasons: [],
      weather: [],
      wildwechsel: [],
    });
    expect(state.pendingEncounters[0]!.type).toBe('plant');
  });

  it('drawEncounter: null, wenn weder Art noch Pflanze passt (wird wie Ablehnen gutgeschrieben)', () => {
    const state = createInitialState(0, 8); // Stufe 0: nichts freigeschaltet
    state.waypoint = 10; // hinter den festgelegten Begegnungen
    const rng = state.rngState;
    expect(drawEncounter(state)).toBeNull();
    expect(state.rngState).not.toBe(rng); // der Typ wurde gewürfelt
  });

  it('Begegnungstypen folgen den Gewichten der Stufe (Tier, Pflanze, Ereignis, Gast)', () => {
    for (const stage of [2, 4]) {
      const counts: Record<string, number> = { animal: 0, plant: 0, event: 0, visitor: 0 };
      const n = 4000;
      for (let seed = 1; seed <= n; seed++) {
        const state = stateAt(stage, [], seed);
        state.waypoint = 10;
        counts[drawEncounter(state)!.type]!++;
      }
      // Alter Baum ohne Tiere: Es gibt Ereignisse und Gäste ohne Bedingungen. Frühling:
      // „Etwas keimt“ × Faktor (der Ring ist leer).
      const factors = SEASONS_BY_ID.get('spring')!.encounterFactors ?? {};
      const weights = (['animal', 'plant', 'event', 'visitor'] as const).map((t, i) => ENCOUNTER_WEIGHTS[stage]![i]! * (factors[t] ?? 1));
      const total = weights.reduce((a, b) => a + b, 0);
      (['animal', 'plant', 'event', 'visitor'] as const).forEach((type, i) => {
        expect(counts[type]! / n, `Stufe ${stage}, ${type}`).toBeCloseTo(weights[i]! / total, 1);
      });
    }
  });

  it('voller Pflanzring: „Etwas keimt“ kommt seltener (PLANT_WEIGHT_RING_FULL)', () => {
    const stage = 3; // Junger Baum: 3 Pflanzplätze
    const n = 4000;
    let plants = 0;
    for (let seed = 1; seed <= n; seed++) {
      const state = stateAt(stage, [], seed);
      state.waypoint = 10;
      state.plants = ['hazel', 'hazel', 'birch'];
      if (drawEncounter(state)!.type === 'plant') plants++;
    }
    const [animal, plant, event, visitor] = ENCOUNTER_WEIGHTS[stage]!;
    const expected = (plant * PLANT_WEIGHT_RING_FULL) / (animal + plant * PLANT_WEIGHT_RING_FULL + event + visitor);
    expect(plants / n).toBeCloseTo(expected, 1);
    expect(plants / n).toBeLessThan(plant / (animal + plant + event + visitor) - 0.05);
  });

  it('Pflanzenkarten: was schon im Ring wächst, kommt seltener (PLANT_WEIGHT_IN_RING)', () => {
    const n = 3000;
    let hazel = 0;
    let anemone = 0;
    for (let seed = 1; seed <= n; seed++) {
      const state = stateAt(3, [], seed);
      state.plants = ['hazel'];
      const cards = drawPlants(state);
      if (cards.includes('hazel')) hazel++;
      if (cards.includes('anemone')) anemone++;
    }
    // Ungewichtet läge jede der 11 Pflanzen bei 3/11 ≈ 27 %.
    expect(hazel / n).toBeLessThan(0.17);
    expect(hazel / n).toBeGreaterThan(0.05); // Duplikate bleiben möglich
    // Exakt: Anemone ≈ 0,289, Hasel ≈ 0,109.
    expect(anemone / n).toBeGreaterThan(2 * (hazel / n));
    // Ausschluss beim Neu würfeln geht weiterhin vor der Gewichtung.
    const state = stateAt(1, [], 3);
    state.plants = ['moss'];
    expect(drawPlants(state, ['anemone']).sort()).toEqual(['anemone', 'moss']);
    expect(drawPlants(state, ['anemone'])[0]).toBe('moss');
  });

  it('Pflanzenkarten: verschieden, freigeschaltet, Duplikate im Ring erlaubt', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = stateAt(3, [], seed);
      state.plants = ['hazel', 'hazel'];
      const cards = drawPlants(state);
      expect(cards).toHaveLength(3);
      expect(new Set(cards).size).toBe(3);
      for (const id of cards) expect(PLANTS_BY_ID.get(id)!.unlock).toBeLessThanOrEqual(3);
    }
    // Ausschluss: alte Karten nur zum Auffüllen (Keimling hat nur zwei Pflanzen).
    const sprout = stateAt(1);
    expect(drawPlants(sprout, ['anemone'])[0]).toBe('moss');
    expect(drawPlants(stateAt(0))).toEqual([]);
  });

  it(`höchstens ${MAX_PENDING_ENCOUNTERS} offene Begegnungen, Überlauf wird als Samen gutgeschrieben`, () => {
    const state = stateAt(3);
    const report = tick(state, 3600);
    expect(report.waypoints).toBeGreaterThan(MAX_PENDING_ENCOUNTERS);
    expect(state.pendingEncounters).toHaveLength(MAX_PENDING_ENCOUNTERS);
    expect(report.autoDeclined).toBe(report.waypoints - MAX_PENDING_ENCOUNTERS);
    // Grund: nur „Stapel voll“.
    expect(report.declinedStackFull).toBe(report.autoDeclined);
    expect(report.declinedNoCards).toBe(0);
  });

  it('autoDeclined getrennt nach Grund: nichts Passendes zählt nicht als „Stapel voll“', () => {
    // Keimling: alle Arten des Wurzelraums leben schon, Pflanzen zeitweise entfernt.
    const plants = PLANTS as Plant[];
    const saved = plants.splice(0, plants.length);
    try {
      const state = createInitialState(0, 8);
      state.niches.roots.push('earthworm', 'vole', 'chanterelle');
      state.totalGrowth = thresholdFor(1) - 0.001;
      const report = tick(state, 1);
      expect(report).toMatchObject({ waypoints: 1, encounters: 0, autoDeclined: 1, declinedStackFull: 0, declinedNoCards: 1 });
      expect(state.pendingEncounters).toEqual([]);
      // Samen wie beim Ablehnen von Hand (Keimling: Untergrenze), DESIGN_V2.md 7.9.
      expect(report.declinedSeeds).toBe(declineReward(state));
    } finally {
      plants.push(...saved);
    }
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

  it('Samen und Wachstum laufen nie nach Unendlich über (kein null im JSON)', () => {
    const state = stateAt(7, [], 3);
    state.seeds = Number.MAX_VALUE / 2;
    state.totalGrowth = Number.MAX_VALUE / 2;
    tick(state, Number.MAX_VALUE);
    expect(state.seeds).toBe(Number.MAX_VALUE);
    expect(state.totalGrowth).toBe(Number.MAX_VALUE);
    const json = JSON.parse(JSON.stringify(state));
    expect(json.seeds).toBe(Number.MAX_VALUE);
    expect(json.totalGrowth).toBe(Number.MAX_VALUE);
    tick(state, Number.MAX_VALUE); // bleibt stabil
    expect(state.seeds).toBe(Number.MAX_VALUE);
  });
});

/**
 * Invariante seit Wetter und Nacht (DESIGN_V2.md 21.5), in zwei Hälften:
 * 1. viele kleine Ticks = ein großer Tick, beide mit Einzelwetter (`live`, wie online);
 * 2. simulateOffline = viele kleine Ticks im Modus „Mittel“ (`average`).
 * Online gegen offline gilt nur noch im Mittel (tests/weather.test.ts, Offline-Mittel).
 * `run` liefert beide Paare: [kleine live, großer live] und [kleine Mittel, offline].
 */
function runPairs(start: GameState, seconds: number, step = 1): { live: [GameState, GameState]; average: [GameState, GameState]; report: ReturnType<typeof simulateOffline> } {
  const small = structuredClone(start);
  const big = structuredClone(start);
  const smallAvg = structuredClone(start);
  const offline = structuredClone(start);
  for (let i = 0; i < seconds / step; i++) {
    tick(small, step);
    tick(smallAvg, step, 'average');
  }
  tick(big, seconds);
  const report = simulateOffline(offline, seconds);
  return { live: [small, big], average: [smallAvg, offline], report };
}

function expectSameRun([online, offline]: [GameState, GameState], digits = 6): void {
  expect(offline.waypoint).toBe(online.waypoint);
  expect(offline.stage).toBe(online.stage);
  expect(offline.niches).toEqual(online.niches);
  expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
  expect(offline.rngState).toBe(online.rngState);
  expect(offline.cycle.elapsed).toBeCloseTo(online.cycle.elapsed, 6);
  expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, digits);
  expect(offline.seeds).toBeCloseTo(online.seeds, digits);
}

// Je Fall vier Läufe (Einzelwetter klein/groß, Mittel klein/offline) – mehr Zeit als üblich.
describe('simulateOffline', { timeout: 60_000 }, () => {
  it('kleine Ticks = großer Tick (Einzelwetter) und = simulateOffline (Mittel), inkl. Begegnungen und Überlauf', () => {
    const { live, average, report } = runPairs(stateAt(2, ['earthworm', 'robin'], 99), 3 * 3600);
    expectSameRun(live);
    expectSameRun(average);
    expect(report.averaged).toBe(true);
    // Einzelwetter und Mittel unterscheiden sich wirklich (sonst prüfte die Teilung nichts).
    expect(live[0].totalGrowth).not.toBeCloseTo(average[0].totalGrowth, 0);
    expect(report.waypoints).toBeGreaterThan(MAX_PENDING_ENCOUNTERS);
    expect(report.autoDeclined).toBe(report.waypoints - MAX_PENDING_ENCOUNTERS);
    expect(report.declinedStackFull).toBe(report.autoDeclined);
  });

  it('gleich mit Begleitpflanzen (Versorgung < 1) und Pflanzen-Begegnungen', () => {
    // Seed 301: Der Ring ist voll (halbes Pflanzengewicht), es muss trotzdem eine
    // Pflanzen-Begegnung kommen – die Vorbedingung unten prüft das.
    const start = stateAt(2, ['bee'], 301);
    start.plants = ['fern', 'fern']; // Setzling: Wasser 3 < Bedarf 4 → V = 3/4
    expect(evaluate(start).supply).toBeLessThan(1);
    const { live, average } = runPairs(start, 3600);
    for (const pair of [live, average]) {
      expect(pair[0].pendingEncounters.some((e) => e.type === 'plant')).toBe(true);
      expectSameRun(pair);
    }
  });

  it('gleich mit Fähigkeiten, Störung, Erscheinungsbedingungen und Glückspilz (Schritt 2.2)', () => {
    // Alter Baum: Fliegenpilz (Glückspilz) verschiebt die Seltenheit, Wühlmaus lässt den
    // Waldkauz erscheinen, Eichhörnchen stört, Hallimasch hält die Versorgung oben.
    const start = stateAt(4, ['flyagaric', 'vole', 'squirrel', 'bluetit', 'honeyfungus', 'barkbeetle'], 777);
    start.plants = ['birch', 'birch', 'birch'];
    const ev = evaluate(start);
    expect(ev.abilities).toEqual(['rarityBoost', 'minSupply']);
    expect(ev.supply).toBe(0.9);
    const { live, average } = runPairs(start, 3 * 3600);
    for (const pair of [live, average]) {
      expect(pair[0].stage).toBeGreaterThanOrEqual(5);
      expectSameRun(pair);
    }
  });

  it('gleich mit Lebensräumen (v13): Wiese, Totholzhaufen, Mauer, Reptilien und neue Jagdpaare', () => {
    // Hain mit allen drei Lebensräumen aus Pflege: Fuchs ↔ Kaninchen, Natter ↔ Frosch,
    // Falke und Schlingnatter ↔ Echsen, Reptilien im Sommer zufriedener.
    const start = stateAt(5, ['cricket', 'fieldmouse', 'rabbit', 'lizard', 'fox', 'wren', 'slowworm', 'sandlizard', 'grasssnake', 'smoothsnake', 'frog'], 1313);
    start.cycle.care = { meadow: 2, 'deadwood-pile': 1, 'drystone-wall': 1, pond: 1 };
    start.plants = ['hazel', 'hazel'];
    const ev = evaluate(start);
    expect([ev.slots.meadow, ev.slots.deadwood, ev.slots.wall]).toEqual([4, 2, 2]);
    expect(ev.traitTiers.reptiles).toBeGreaterThanOrEqual(2);
    const { live, average } = runPairs(start, 2 * 3600);
    for (const pair of [live, average]) {
      expect(pair[0].stage).toBeGreaterThanOrEqual(5);
      expectSameRun(pair);
    }
  });

  it('gleich in der Waldlandschaft (v14): Auwald aktiv, alle Gaben, Korridor-Zufluss', () => {
    // Alter Baum im Auwald: Eigenheit (+2 💧, Tümpel, Pilze −15 %), Merkmal Feuchte, Gaben aller
    // Wälder und wirksames Gedächtnis aus dem Zufluss – alles in evaluate, also online = offline.
    const start = stateAt(4, ['earthworm', 'robin', 'chanterelle', 'toad', 'frog', 'newt'], 1414);
    start.meta.forestMemory = 80;
    start.meta.landscape = {
      active: 'floodplain',
      sites: [
        // Bestand der Nachbarn für Wildwechsel-Karten (24.6, Schritt B) über beide Korridore.
        { id: 'home', memory: 600, regulars: [], ancient: true, mainTree: 'oak', fauna: ['owl', 'deer', 'jay', 'fox', 'woodpecker', 'bat'] },
        ...(['carr', 'beechwood', 'mountain', 'heath'] as const).map((id) => ({
          id,
          memory: 200,
          regulars: [],
          ancient: false,
          mainTree: 'oak' as const,
          fauna: id === 'carr' ? ['treefrog', 'crestednewt', 'porcini', 'snail'] : [],
        })),
        { id: 'floodplain', memory: 0, regulars: [], ancient: false, mainTree: 'oak', fauna: [] },
      ],
      corridors: ['home-floodplain', 'floodplain-carr'],
      freeCorridors: ['home-floodplain'],
      announced: false,
    };
    start.meta.regulars = ['bee'];
    start.meta.journal.species.push('bee');
    const ev = evaluate(start);
    expect(ev.slots.pond).toBe(3);
    const { live, average } = runPairs(start, 2 * 3600);
    for (const pair of [live, average]) {
      expect(pair[0].stage).toBeGreaterThanOrEqual(5);
      expectSameRun(pair);
      expect(pair[1].meta.landscape).toEqual(start.meta.landscape);
    }
  });

  it('gleich mit Platz-Schaffern (Borkenkäfer öffnet Höhlen) über den Alten Baum hinaus', () => {
    const { live, average } = runPairs(stateAt(3, ['barkbeetle', 'earthworm'], 4242), 2 * 3600);
    for (const pair of [live, average]) {
      expect(pair[0].stage).toBeGreaterThanOrEqual(4);
      expect(evaluate(pair[0]).slots.hollows).toBeGreaterThanOrEqual(2);
      expectSameRun(pair);
    }
  });

  it('auch mit Frame-Schritten (60 fps) und Entscheidungen dazwischen (Tiere, Pflanzen, Pflanzen setzen)', () => {
    const a = createInitialState(0, 7);
    const b = createInitialState(0, 7);
    // Beide spielen 10 Minuten; Entscheidungen jeweils nach derselben Spielzeit.
    for (let minute = 0; minute < 10; minute++) {
      for (let f = 0; f < 60 * 60; f++) tick(a, 1 / 60);
      simulateOffline(b, 60);
      resolveAndPlant(a);
      resolveAndPlant(b);
      expect(b.niches).toEqual(a.niches);
      expect(b.plants).toEqual(a.plants);
    }
    expect(a.plants.length).toBeGreaterThan(0);
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
  /** 2 Stunden spielen, alle 10 s entscheiden und Pflanzen setzen. */
  function play(seed: number, ambient: 'live' | 'off' = 'live'): GameState {
    const state = createInitialState(0, seed);
    for (let t = 0; t < 2 * 3600; t += 10) {
      tick(state, 10, ambient);
      resolveAndPlant(state);
    }
    return state;
  }

  // Bis zum Wetter galt hier „genau wie vor dem Wetter“ (20 / 3892806722 / 145529 / 35187 /
  // 75,94). Seit Räuber und Beute (DESIGN_V2.md 22: Bestand, Überjagung, Massenjahre) rechnet
  // auch `off` anders – Wetter-Gewichte wirken in `off` nicht, darum nur noch festgelegte Werte.
  it('ohne Wetter und Nacht (`off`): festgelegte Ergebnisse (seit Räuber und Beute)', () => {
    const state = play(2026, 'off');
    expect({
      waypoint: state.waypoint,
      rngState: state.rngState,
      totalGrowth: Math.round(state.totalGrowth),
      seeds: Math.round(state.seeds),
      harmony: Math.round(evaluate(state).harmony * 100) / 100,
    }).toEqual({ waypoint: 21, rngState: 165733899, totalGrowth: 159325, seeds: 32553, harmony: 76.25 });
  });

  it('liefert festgelegte Ergebnisse', () => {
    const state = play(2026);
    const ev = evaluate(state);
    expect({
      waypoint: state.waypoint,
      stage: state.stage,
      plants: state.plants,
      niches: state.niches,
      journal: state.meta.journal.species,
      journalPlants: state.meta.journal.plants,
      communities: state.meta.journal.communities,
      rngState: state.rngState,
      totalGrowth: Math.round(state.totalGrowth),
      seeds: Math.round(state.seeds),
      harmony: Math.round(ev.harmony * 100) / 100,
    }).toMatchInlineSnapshot(`
      {
        "communities": [],
        "harmony": 77.74,
        "journal": [
          "earthworm",
          "woodlouse",
          "vole",
          "mole",
          "slug",
          "chanterelle",
          "bluetit",
          "oakmoth",
          "flyagaric",
          "bee",
          "fox",
          "woodpecker",
        ],
        "journalPlants": [
          "anemone",
          "hazel",
          "fern",
          "rowan",
          "nettle",
          "birch",
        ],
        "niches": {
          "bark": [
            "woodpecker",
          ],
          "crown": [
            "bluetit",
            "oakmoth",
          ],
          "deadwood": [],
          "edge": [
            "bee",
            "fox",
          ],
          "hollows": [],
          "litter": [
            "woodlouse",
            "slug",
          ],
          "meadow": [],
          "pond": [],
          "roots": [
            "chanterelle",
            "vole",
            "flyagaric",
          ],
          "wall": [],
        },
        "plants": [
          "nettle",
          "hazel",
          "hazel",
          "birch",
          "hazel",
          "hazel",
          "hazel",
        ],
        "rngState": 3260971052,
        "seeds": 38750,
        "stage": 5,
        "totalGrowth": 152481,
        "waypoint": 21,
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
