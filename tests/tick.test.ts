import { describe, expect, it } from 'vitest';
import { ENCOUNTER_WEIGHTS, MAX_PENDING_ENCOUNTERS } from '../src/content/encounters';
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
  chooseSowing,
  discardSowing,
  sow,
  sowBlocker,
  simulateOffline,
  tick,
} from '../src/core/tick';
import { dayIndex, weatherAt, weatherOfDay } from '../src/core/weather';
import { SPRING_GROWTH, offlineTick, resolveSpecial, stateAt, researchFor } from './helpers';

/**
 * Feste Wahl-Strategie für Golden Tests: erste Karte mit freiem Platz; sonst die erste
 * Karte mit voller Nische und das erste Tier dort entlassen; sonst ablehnen. Scheitert der
 * Tausch, ablehnen. Eine offene Aussaat zuerst: erste Karte (bei vollem Ring anstelle der
 * ersten Pflanze, die anders ist), sonst zurücklegen.
 */
function resolveAll(state: GameState): void {
  while (state.pendingEncounters.length > 0 || state.cycle.sowing) {
    if (state.cycle.sowing) {
      const id = state.cycle.sowing.cards[0]!;
      const full = state.plants.length >= evaluate(state).plantSlots;
      const replace = full ? state.plants.find((p) => p !== id) : undefined;
      if (!chooseSowing(state, 0, replace).ok) discardSowing(state);
      continue;
    }
    if (resolveSpecial(state)) continue;
    const { cards } = state.pendingEncounters[0]!;
    const statuses = cards.map((_, c) => cardStatus(state, 0, c));
    const free = statuses.indexOf('free');
    const full = statuses.indexOf('full');
    if (free >= 0) chooseCard(state, 0, free);
    else if (full >= 0) {
      const replace = state.niches[SPECIES_BY_ID.get(cards[full]!)!.niche][0];
      if (!chooseCard(state, 0, full, replace).ok) declineEncounter(state, 0);
    } else declineEncounter(state, 0);
  }
}

/** Wie resolveAll, sät danach (erste Karte), solange der Ring Platz hat und die Samen reichen. */
function resolveAndPlant(state: GameState): void {
  resolveAll(state);
  while (state.plants.length < evaluate(state).plantSlots && sowBlocker(state) === null && sow(state).ok) resolveAll(state);
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
      sowings: 0,
      interludesReached: 0,
      expired: [],
      seasons: [],
      weather: [],
      wildwechsel: [],
      chapters: [],
      discovered: [],
      research: [],
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
    // Wegpunkt 2 öffnet die geschenkte Aussaat – keine Begegnung (27.5).
    expect(report.sowings).toBe(1);
    expect(report.encounters + report.autoDeclined + report.sowings).toBe(report.waypoints);
    expect(state.totalGrowth).toBeGreaterThanOrEqual(thresholdFor(state.waypoint));
    expect(state.totalGrowth).toBeLessThan(thresholdFor(state.waypoint + 1));
  });

  it('die ersten Wegpunkte sind festgelegt: Tier, Aussaat (Geschenk), Tier', () => {
    const state = createInitialState(0, 42);
    tick(state, 4);
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal']);
    const two = tick(state, 1e-9 + (thresholdFor(2) - state.totalGrowth) / evaluate(state).growth);
    expect(two).toMatchObject({ waypoints: 1, encounters: 0, sowings: 1 });
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal']);
    // Keimling: nur Buschwindröschen und Frauenhaarmoos sind freigeschaltet.
    expect([...state.cycle.sowing!.cards].sort()).toEqual(['anemone', 'moss']);
    expect(state.cycle.sowings).toBe(1);
    tick(state, 1e-9 + (thresholdFor(3) - state.totalGrowth) / evaluate(state).growth);
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal', 'animal']);
  });

  it('Tierbegegnung ohne passende Art: keine Pflanze als Ersatz, wie Ablehnen gutgeschrieben', () => {
    // Wegpunkt 1 (Tier, festgelegt), aber alle Keimling-Gäste leben schon hier.
    const state = createInitialState(0, 8);
    state.niches.roots.push('earthworm', 'vole', 'chanterelle');
    state.totalGrowth = thresholdFor(1) - 0.001;
    const report = tick(state, 1);
    expect(report).toEqual({
      waypoints: 1,
      encounters: 0,
      autoDeclined: 1,
      declinedStackFull: 0,
      declinedNoCards: 1,
      declinedSeeds: declineReward(state),
      regulars: [],
      interludes: 0,
      sowings: 0,
      interludesReached: 0,
      expired: [],
      seasons: [],
      weather: [],
      wildwechsel: [],
      chapters: [],
      discovered: [],
      research: [],
    });
    expect(state.pendingEncounters).toEqual([]);
  });

  it('drawEncounter: null, wenn keine Art passt (wird wie Ablehnen gutgeschrieben)', () => {
    const state = createInitialState(0, 8); // Stufe 0: nichts freigeschaltet
    state.waypoint = 10; // hinter den festgelegten Begegnungen
    const rng = state.rngState;
    expect(drawEncounter(state)).toBeNull();
    expect(state.rngState).not.toBe(rng); // der Typ wurde gewürfelt
  });

  it('Begegnungstypen folgen den Gewichten der Stufe (Tier, Ereignis, Gast)', () => {
    for (const stage of [2, 4]) {
      const counts: Record<string, number> = { animal: 0, event: 0, visitor: 0 };
      const n = 4000;
      for (let seed = 1; seed <= n; seed++) {
        const state = stateAt(stage, [], seed);
        state.waypoint = 10;
        counts[drawEncounter(state)!.type]!++;
      }
      // Alter Baum ohne Tiere: Es gibt Ereignisse und Gäste ohne Bedingungen. Frühling:
      // Faktoren der Jahreszeit (heute keine auf Begegnungen).
      const factors = SEASONS_BY_ID.get('spring')!.encounterFactors ?? {};
      const weights = (['animal', 'event', 'visitor'] as const).map((t, i) => ENCOUNTER_WEIGHTS[stage]![i]! * (factors[t] ?? 1));
      const total = weights.reduce((a, b) => a + b, 0);
      (['animal', 'event', 'visitor'] as const).forEach((type, i) => {
        expect(counts[type]! / n, `Stufe ${stage}, ${type}`).toBeCloseTo(weights[i]! / total, 1);
      });
    }
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
 * 2. simulateOffline = viele kleine Ticks im Modus „Mittel“ (`average`), je Abschnitt mit dem
 *    Ertragsfaktor der Abwesenheit (offlineTick: 60 s voll, danach 0,1; 28.3).
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
    // Wie simulateOffline: erste 60 s voll, danach OFFLINE_YIELD (28.3).
    offlineTick(smallAvg, i * step, step, 'average');
  }
  tick(big, seconds);
  const report = simulateOffline(offline, seconds);
  return { live: [small, big], average: [smallAvg, offline], report };
}

/**
 * Lange Abwesenheiten (28.3): `chunks` × 8 h simulateOffline gegen dieselbe Zeit in Sekunden-Ticks
 * mit dem Ertragsfaktor (offlineTick). Mit 10 % nach 60 s braucht es diese Länge, damit offline
 * dieselben Stufen erreicht werden wie in runPairs online. Liefert [kleine Ticks, offline].
 */
function runOffline(start: GameState, chunks: number): [GameState, GameState] {
  const small = structuredClone(start);
  const offline = structuredClone(start);
  for (let c = 0; c < chunks; c++) {
    for (let i = 0; i < MAX_OFFLINE_SECONDS; i++) offlineTick(small, i, 1, 'average');
    simulateOffline(offline, MAX_OFFLINE_SECONDS);
  }
  return [small, offline];
}

function expectSameRun([online, offline]: [GameState, GameState], digits = 6): void {
  expect(offline.waypoint).toBe(online.waypoint);
  expect(offline.stage).toBe(online.stage);
  expect(offline.niches).toEqual(online.niches);
  expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
  // Aussaat (Phase 10, 2b): das Geschenk an Wegpunkt 2 öffnet online wie offline gleich.
  expect(offline.cycle.sowing).toEqual(online.cycle.sowing);
  expect(offline.cycle.sowings).toBe(online.cycle.sowings);
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

  it('gleich mit Begleitpflanzen (Versorgung < 1) und geschenkter Aussaat an Wegpunkt 2', () => {
    const start = stateAt(2, ['bee'], 301);
    start.plants = ['fern', 'fern']; // Setzling: Wasser 3 < Bedarf 4 → V = 3/4
    expect(evaluate(start).supply).toBeLessThan(1);
    const { live, average } = runPairs(start, 3600);
    for (const pair of [live, average]) expectSameRun(pair);
    // Vom ersten Wegpunkt an: Die geschenkte Aussaat an Wegpunkt 2 öffnet online wie offline gleich.
    const fresh = runPairs(createInitialState(0, 301), 600);
    for (const pair of [fresh.live, fresh.average]) {
      expect(pair[0].cycle.sowing).not.toBeNull();
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
      // Offline (10 % nach 60 s, 28.3) reicht die Zeit hier nicht – die Stufe prüft runOffline unten.
      if (pair === live) expect(pair[0].stage).toBeGreaterThanOrEqual(5);
      expectSameRun(pair);
    }
    // Offline (10 % nach 60 s, 28.3): zwei Abwesenheiten à 8 h bis zum Hain.
    const away = runOffline(start, 2);
    expect(away[0].stage).toBeGreaterThanOrEqual(5);
    expectSameRun(away);
  });

  it('gleich mit Lebensräumen (v13): Wiese, Totholzhaufen, Mauer, Reptilien und neue Jagdpaare', () => {
    // Hain mit allen drei Lebensräumen aus Pflege: Fuchs ↔ Kaninchen, Natter ↔ Frosch,
    // Falke und Schlingnatter ↔ Echsen, Reptilien im Sommer zufriedener.
    const start = stateAt(5, ['cricket', 'fieldmouse', 'rabbit', 'lizard', 'fox', 'wren', 'slowworm', 'sandlizard', 'grasssnake', 'smoothsnake', 'frog'], 1313);
    start.cycle.research = researchFor({ meadow: 2, 'deadwood-pile': 1, 'drystone-wall': 1, pond: 1 });
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

  it('gleich mit Ausbau (v18): Tier-Bonus, Hauptbaum, Begleitpflanzen, Plätze, 💧 und Kartengewichte', () => {
    // Junger Baum: Wurzelraum 50 (Platz, ×1,5 und seltene ×2 beim Ziehen), Krone 12, alle drei
    // Baumteile über 25 (+1 Höhle – bleibt zu –, +1 Krone, +1 💧) – alles in evaluate und drawAnimals.
    const start = stateAt(3, ['earthworm', 'vole', 'bluetit', 'bee'], 1818);
    start.plants = ['hazel', 'fern'];
    start.cycle.upgrades = { niches: { roots: 50, crown: 12 }, tree: { rings: 30, leaves: 26, mycorrhiza: 25 } };
    const ev = evaluate(start);
    expect([ev.slots.roots, ev.slots.crown, ev.slots.hollows]).toEqual([3, 4, 0]);
    const { live, average } = runPairs(start, 2 * 3600);
    // Online erreicht der Baum den Alten Baum; offline (10 % nach 60 s) zieht er wenigstens Karten.
    expect(live[0].stage).toBeGreaterThanOrEqual(4);
    expect(average[0].waypoint).toBeGreaterThan(start.waypoint);
    for (const pair of [live, average]) expectSameRun(pair);
  });

  it('gleich mit Forschungsplan (27.8) und wiederholbaren Rängen (28.6): Käufe am Halt', () => {
    // Hain mit Boden-Gabel; „Plan folgen“ kauft Ränge und Humus, sobald der Vorrat reicht.
    const start = stateAt(5, ['earthworm', 'robin', 'bee', 'vole', 'chanterelle'], 2121);
    start.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];
    start.meta.research = { plan: [...start.cycle.research, 'soil-life', 'humus', 'soil-life', 'soil-life'], auto: true };
    start.harmonyPoints = 1_200;
    const { live, average } = runPairs(start, 2 * 3600);
    expect(live[0].cycle.researchRanks['soil-life']).toBeGreaterThanOrEqual(1);
    for (const pair of [live, average]) {
      expectSameRun(pair);
      expect(pair[1].cycle.research).toEqual(pair[0].cycle.research);
      expect(pair[1].cycle.researchRanks).toEqual(pair[0].cycle.researchRanks);
      expect(pair[1].harmonyPoints).toBeCloseTo(pair[0].harmonyPoints, 6);
    }
  });

  it('gleich in der Waldlandschaft (v14): Auwald aktiv, alle Gaben, Korridor-Zufluss', () => {
    // Alter Baum im Auwald: Eigenheit (+2 💧, Tümpel, Pilze −15 %), Merkmal Feuchte, Gaben aller
    // Wälder und wirksames Gedächtnis aus dem Zufluss – alles in evaluate, also online = offline.
    // Seit 3c (24.14) auch das Wetter des Auwalds (oft Landregen) – live wie im Mittel.
    const start = stateAt(4, ['earthworm', 'robin', 'chanterelle', 'toad', 'frog', 'newt'], 1414);
    start.meta.forestMemory = 80;
    start.meta.landscape = {
      active: 'floodplain',
      sites: [
        // Bestand der Nachbarn für Wildwechsel-Karten (24.6, Schritt B) über beide Korridore.
        { id: 'home', memory: 600, regulars: [], ancient: true, mainTree: 'oak', fauna: ['owl', 'deer', 'jay', 'fox', 'woodpecker', 'bat'], chronicle: [] },
        ...(['carr', 'beechwood', 'mountain', 'heath'] as const).map((id) => ({
          id,
          memory: 200,
          regulars: [],
          ancient: false,
          mainTree: 'oak' as const,
          fauna: id === 'carr' ? ['treefrog', 'crestednewt', 'porcini', 'snail'] : [],
          chronicle: [],
        })),
        { id: 'floodplain', memory: 0, regulars: [], ancient: false, mainTree: 'oak', fauna: [], chronicle: [] },
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
      // Offline (10 % nach 60 s, 28.3) reicht die Zeit hier nicht – die Stufe prüft runOffline unten.
      if (pair === live) expect(pair[0].stage).toBeGreaterThanOrEqual(5);
      expectSameRun(pair);
      // Die Landschaft bleibt, nur die Chronik des aktiven Waldes wächst (26.4) – online wie offline.
      const withoutChronicle = (l: GameState['meta']['landscape']) => ({ ...l, sites: l.sites.map((x) => ({ ...x, chronicle: [] })) });
      expect(withoutChronicle(pair[1].meta.landscape)).toEqual(withoutChronicle(start.meta.landscape));
      expect(pair[1].meta.landscape.sites.map((x) => x.chronicle)).toEqual(pair[0].meta.landscape.sites.map((x) => x.chronicle));
    }
    // Offline (10 % nach 60 s, 28.3): 8 h Abwesenheit bis über den Hain hinaus.
    const away = runOffline(start, 1);
    expect(away[0].stage).toBeGreaterThanOrEqual(5);
    expectSameRun(away);
    expect(weatherAt(live[0]).id).toBe(weatherOfDay(live[0].cycle, dayIndex(live[0].cycle.elapsed), 'floodplain'));
  });

  it('gleich mit den Hauptbäumen der Landschaft (v15): Schwarzerle im Erlenbruch, Weißtanne im Bergmischwald, Wildwechsel-Markierung', () => {
    for (const [active, tree, corridor] of [
      ['carr', 'alder', 'home-carr'],
      ['mountain', 'fir', 'home-mountain'],
    ] as const) {
      // Junger Baum: Tümpel der Erle bzw. Rinde der Tanne öffnen sich, ab Alter Baum −1 ☀️ der Tanne.
      const start = stateAt(3, ['earthworm', 'robin', 'vole'], 1515);
      start.cycle.mainTree = tree;
      start.meta.forestMemory = 60;
      start.meta.achievements.push('ancient-forest');
      start.meta.landscape = {
        active,
        sites: [
          { id: 'home', memory: 600, regulars: [], ancient: true, mainTree: 'oak', fauna: ['owl', 'deer', 'jay', 'fox', 'woodpecker', 'toad', 'frog'], chronicle: [] },
          { id: active, memory: 0, regulars: [], ancient: false, mainTree: tree, fauna: [], chronicle: [] },
        ],
        corridors: [corridor],
        freeCorridors: [corridor],
        announced: true,
      };
      const { live, average } = runPairs(start, 2 * 3600);
      for (const pair of [live, average]) {
        expect(pair[0].stage, tree).toBeGreaterThanOrEqual(4);
        expectSameRun(pair);
        expect(pair[1].meta.stats.wildwechselChosen).toBe(0);
      }
    }
  });

  it('gleich mit Platz-Schaffern (Borkenkäfer öffnet Höhlen) über den Alten Baum hinaus', () => {
    const start = stateAt(3, ['barkbeetle', 'earthworm'], 4242);
    const { live, average } = runPairs(start, 2 * 3600);
    // Platz-Schaffer auch offline (10 % nach 60 s, 28.3): längere Abwesenheit, Alter Baum, Höhlen.
    const away = runOffline(start, 1);
    expect(away[0].stage).toBeGreaterThanOrEqual(4);
    expect(evaluate(away[0]).slots.hollows).toBeGreaterThanOrEqual(2);
    expectSameRun(away);
    for (const pair of [live, average]) {
      // Offline (10 % nach 60 s, 28.3) reicht die Zeit hier nicht – die Stufe prüft runOffline oben.
      if (pair === live) expect(pair[0].stage).toBeGreaterThanOrEqual(4);
      if (pair === live) expect(evaluate(pair[0]).slots.hollows).toBeGreaterThanOrEqual(2);
      expectSameRun(pair);
    }
  });

  it('auch mit Frame-Schritten (60 fps) und Entscheidungen dazwischen (Tiere, Aussaat, Säen)', () => {
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
  /** 2 Stunden spielen, alle 10 s entscheiden und säen. */
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
  // Phase 10, 2b (27.5): ohne „Etwas keimt“ – mehr Tierbegegnungen, Pflanzen nur noch über die
  // Aussaat (vorher 21 / 165733899 / 159325 / 32553 / 76,25). Phase 11, 3a: Aussaat-Faktor 1,6
  // statt 1,75 – billigere Aussaaten, nur der Samenbestand ändert sich (vorher 82883).
  it('ohne Wetter und Nacht (`off`): festgelegte Ergebnisse (seit Räuber und Beute)', () => {
    const state = play(2026, 'off');
    expect({
      waypoint: state.waypoint,
      rngState: state.rngState,
      totalGrowth: Math.round(state.totalGrowth),
      seeds: Math.round(state.seeds),
      harmony: Math.round(evaluate(state).harmony * 100) / 100,
    }).toEqual({ waypoint: 22, rngState: 1485770136, totalGrowth: 191379, seeds: 83089, harmony: 101.06 });
  });

  // Neu aufgenommen in Phase 10, 2b (27.5): „Etwas keimt“ entfällt, die feste Strategie sät
  // (erste Karte) – mehr Tiere, gemischte Pflanzen statt fünfmal Hasel, darum höhere Harmonie.
  // Phase 11, 3a: Aussaat-Faktor 1,6 statt 1,75 – nur der Samenbestand ändert sich (vorher 152357).
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
        "communities": [
          "caterpillar-watch",
          "flower-hem",
          "seed-couriers",
        ],
        "harmony": 117.99,
        "journal": [
          "earthworm",
          "chanterelle",
          "mole",
          "slug",
          "vole",
          "woodlouse",
          "bluetit",
          "oakmoth",
          "tinder",
          "peacock",
          "bee",
          "owl",
          "barkbeetle",
          "bat",
          "squirrel",
          "centipede",
          "deer",
          "robin",
          "woodpecker",
          "stagbeetle",
          "flyagaric",
          "jay",
        ],
        "journalPlants": [
          "anemone",
          "bramble",
          "strawberry",
          "birch",
          "hazel",
          "nettle",
          "rowan",
        ],
        "niches": {
          "bark": [
            "woodpecker",
            "barkbeetle",
          ],
          "crown": [
            "bluetit",
            "oakmoth",
            "squirrel",
            "jay",
          ],
          "deadwood": [],
          "edge": [
            "peacock",
            "bee",
            "deer",
          ],
          "hollows": [
            "owl",
            "bat",
            "stagbeetle",
          ],
          "litter": [
            "centipede",
            "woodlouse",
            "robin",
          ],
          "meadow": [],
          "pond": [],
          "roots": [
            "flyagaric",
            "mole",
            "chanterelle",
          ],
          "wall": [],
        },
        "plants": [
          "anemone",
          "bramble",
          "strawberry",
          "birch",
          "hazel",
          "nettle",
          "rowan",
        ],
        "rngState": 726052072,
        "seeds": 152563,
        "stage": 5,
        "totalGrowth": 259184,
        "waypoint": 24,
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
