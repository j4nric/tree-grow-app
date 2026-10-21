import { describe, expect, it } from 'vitest';
import { ENCOUNTER_WEIGHTS, MAX_PENDING_ENCOUNTERS, PLANT_WEIGHT_RING_FULL } from '../src/content/encounters';
import { PLANTS, PLANTS_BY_ID, type Plant } from '../src/content/plants';
import { SEASONS_BY_ID } from '../src/content/seasons';
import { SPECIES_BY_ID } from '../src/content/species';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { cardStatus, evaluate, thresholdFor } from '../src/core/formulas';
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
      regulars: [],
      interludes: 0,
      interludesReached: 0,
      expired: [],
      seasons: [],
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
      regulars: [],
      interludes: 0,
      interludesReached: 0,
      expired: [],
      seasons: [],
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
    expect(report.declinedStackFull).toBe(report.autoDeclined);
  });

  it('gleich mit Begleitpflanzen (Versorgung < 1) und Pflanzen-Begegnungen', () => {
    // Seed 301: Der Ring ist voll (halbes Pflanzengewicht), es muss trotzdem eine
    // Pflanzen-Begegnung kommen – die Vorbedingung unten prüft das.
    const online = stateAt(2, ['bee'], 301);
    online.plants = ['fern', 'fern']; // Setzling: Wasser 3 < Bedarf 4 → V = 3/4
    expect(evaluate(online).supply).toBeLessThan(1);
    const offline = structuredClone(online);
    for (let i = 0; i < 3600; i++) tick(online, 1);
    simulateOffline(offline, 3600);
    expect(online.pendingEncounters.some((e) => e.type === 'plant')).toBe(true);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
  });

  it('gleich mit Fähigkeiten, Störung, Erscheinungsbedingungen und Glückspilz (Schritt 2.2)', () => {
    // Alter Baum: Fliegenpilz (Glückspilz) verschiebt die Seltenheit, Wühlmaus lässt den
    // Waldkauz erscheinen, Eichhörnchen stört, Hallimasch hält die Versorgung oben.
    const online = stateAt(4, ['flyagaric', 'vole', 'squirrel', 'bluetit', 'honeyfungus', 'barkbeetle'], 777);
    online.plants = ['birch', 'birch', 'birch'];
    const ev = evaluate(online);
    expect(ev.abilities).toEqual(['rarityBoost', 'minSupply']);
    expect(ev.supply).toBe(0.9);
    const offline = structuredClone(online);
    for (let i = 0; i < 3 * 3600; i++) tick(online, 1);
    simulateOffline(offline, 3 * 3600);
    expect(online.stage).toBeGreaterThanOrEqual(5);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
  });

  it('gleich mit Platz-Schaffern (Borkenkäfer öffnet Höhlen) über den Alten Baum hinaus', () => {
    const online = stateAt(3, ['barkbeetle', 'earthworm'], 4242);
    const offline = structuredClone(online);
    for (let i = 0; i < 2 * 3600; i++) tick(online, 1);
    simulateOffline(offline, 2 * 3600);
    expect(online.stage).toBeGreaterThanOrEqual(4);
    expect(evaluate(online).slots.hollows).toBeGreaterThanOrEqual(2);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
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
  function play(seed: number): GameState {
    const state = createInitialState(0, seed);
    for (let t = 0; t < 2 * 3600; t += 10) {
      tick(state, 10);
      resolveAndPlant(state);
    }
    return state;
  }

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
        "harmony": 68.83,
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
          "tinder",
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
            "tinder",
            "woodpecker",
          ],
          "crown": [
            "bluetit",
            "oakmoth",
          ],
          "edge": [
            "bee",
          ],
          "hollows": [],
          "litter": [
            "woodlouse",
            "slug",
          ],
          "roots": [
            "chanterelle",
            "vole",
            "flyagaric",
          ],
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
        "rngState": 3892806722,
        "seeds": 34502,
        "stage": 5,
        "totalGrowth": 142332,
        "waypoint": 20,
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
