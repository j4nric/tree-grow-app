import { describe, expect, it } from 'vitest';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { SPECIES } from '../src/content/species';
import { SEASON_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { cycleMemoryGain, evaluate, regularSlots } from '../src/core/formulas';
import { MAX_CYCLE_NUMBER, deserialize, loadGame, serialize, v6Threshold } from '../src/core/save';
import { seasonIdAt } from '../src/core/season';
import { MAX_FOREST_MEMORY, SAVE_VERSION, allAnimals, createCycle, createInitialState, type GameState } from '../src/core/state';
import {
  chooseCard,
  drawAnimals,
  moveInRegulars,
  newCycleBlocker,
  plantSeed,
  previewNewCycle,
  recordDiscoveries,
  regularBlocker,
  setRegulars,
  simulateOffline,
  startNewCycle,
  tick,
  toggleRegular,
} from '../src/core/tick';
import { stateAt } from './helpers';

/** Spielstand im Hain mit Tieren, Pflanzen, einer offenen Begegnung und Tagebuch. */
function groveState(seed = 5): GameState {
  const state = stateAt(NEW_CYCLE_MIN_STAGE, ['earthworm', 'robin', 'bluetit', 'bee'], seed);
  state.plants = ['hazel', 'moss'];
  state.seeds = 1234;
  state.pendingEncounters = [{ type: 'animal', cards: ['vole'], rerolls: 0 }];
  state.cycle.newSpecies = ['earthworm', 'robin', 'bluetit', 'bee'];
  state.meta.journal.keepsakes = ['old-oak'];
  recordDiscoveries(state);
  return state;
}

describe('Waldgedächtnis-Formel (DESIGN_V2.md 10)', () => {
  it('floor(H_max/5) + neue Arten – Beispiel aus dem Design: 105, 11 Arten → 32 (seit Schritt 2.10)', () => {
    expect(cycleMemoryGain(105, 11, 0)).toBe(32);
    expect(cycleMemoryGain(4.99, 0, 0)).toBe(0);
    expect(cycleMemoryGain(5, 0, 0)).toBe(1);
    expect(cycleMemoryGain(0, 0, 0)).toBe(0);
  });

  it('Obergrenze MAX_FOREST_MEMORY: der Gewinn füllt höchstens bis zur Grenze auf', () => {
    expect(cycleMemoryGain(96, 12, MAX_FOREST_MEMORY - 10)).toBe(10);
    expect(cycleMemoryGain(96, 12, MAX_FOREST_MEMORY)).toBe(0);
    expect(cycleMemoryGain(1e300, 1e300, 0)).toBe(MAX_FOREST_MEMORY);
    expect(cycleMemoryGain(Infinity, 0, 0)).toBe(0); // Unsinn zählt nicht
  });

  it('negative Harmonie, NaN und negative Anzahlen ergeben 0 statt Abzug', () => {
    expect(cycleMemoryGain(-50, 0, 0)).toBe(0);
    expect(cycleMemoryGain(NaN, NaN, NaN)).toBe(0);
    expect(cycleMemoryGain(30, -4, 0)).toBe(6);
  });

  it('Stammgast-Plätze: einer je 25 Punkte', () => {
    expect(regularSlots(0)).toBe(0);
    expect(regularSlots(24.9)).toBe(0);
    expect(regularSlots(25)).toBe(1);
    expect(regularSlots(66)).toBe(2);
    expect(regularSlots(NaN)).toBe(0);
    expect(regularSlots(-100)).toBe(0);
    expect(regularSlots(1e12)).toBe(MAX_FOREST_MEMORY / 25);
  });
});

describe('H_max und neu entdeckte Arten', () => {
  it('Karte wählen hebt H_max, ein schlechterer Tausch senkt es nie', () => {
    const state = stateAt(3, [], 3);
    state.pendingEncounters = [{ type: 'animal', cards: ['earthworm'], rerolls: 0 }];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    const after = evaluate(state).harmony;
    expect(state.cycle.maxHarmony).toBe(Math.max(0, after));
    const best = state.cycle.maxHarmony;
    // Von Hand verschlechtern: H_max bleibt.
    state.niches.roots = [];
    recordDiscoveries(state);
    expect(state.cycle.maxHarmony).toBe(best);
  });

  it('Pflanze setzen führt H_max nach', () => {
    const state = stateAt(3, ['earthworm', 'bee'], 3);
    state.seeds = 1000;
    const before = state.cycle.maxHarmony;
    expect(plantSeed(state, 'hazel').ok).toBe(true);
    expect(state.cycle.maxHarmony).toBeGreaterThanOrEqual(before);
    expect(state.cycle.maxHarmony).toBe(Math.max(before, evaluate(state).harmony));
  });

  it('Jahreszeitenwechsel führt H_max nach – online wie offline', () => {
    // Stufe 4, nur Pfifferling: Sommer und Herbst heben die Harmonie über den Frühlingswert.
    const make = () => {
      const s = stateAt(4, ['chanterelle'], 3);
      recordDiscoveries(s);
      return s;
    };
    const online = make();
    let highest = evaluate(online).harmony;
    for (let i = 0; i < 2; i++) {
      tick(online, SEASON_SECONDS);
      highest = Math.max(highest, evaluate(online).harmony);
      expect(online.cycle.maxHarmony).toBeGreaterThanOrEqual(evaluate(online).harmony);
    }
    expect(online.cycle.maxHarmony).toBe(highest);
    expect(highest).toBeGreaterThan(evaluate(make()).harmony);
    // Ganze Jahre (Schnellvorlauf) sehen jede Jahreszeit: gleicher Höchstwert wie Schritt für Schritt.
    const stepped = make();
    for (let i = 0; i < 8; i++) tick(stepped, SEASON_SECONDS);
    const skipped = make();
    tick(skipped, 8 * SEASON_SECONDS);
    expect(skipped.cycle.maxHarmony).toBe(stepped.cycle.maxHarmony);
    expect(stepped.cycle.maxHarmony).toBeGreaterThanOrEqual(highest);
  });

  it('nur Arten, die zum ersten Mal ins Tagebuch kommen, zählen als neu', () => {
    const state = stateAt(3, [], 3);
    state.meta.journal.species = ['vole']; // aus einem früheren Zyklus bekannt
    state.pendingEncounters = [
      { type: 'animal', cards: ['vole'], rerolls: 0 },
      { type: 'animal', cards: ['bee'], rerolls: 0 },
    ];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(state.cycle.newSpecies).toEqual(['bee']);
    expect(state.meta.journal.species).toEqual(['vole', 'bee']);
  });
});

describe('Neuer Zyklus', () => {
  it('ist erst ab dem Hain erlaubt; der Grund nennt Zielstufe und fehlende Wegpunkte', () => {
    const early = stateAt(NEW_CYCLE_MIN_STAGE - 1, ['earthworm'], 2);
    const left = STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint - early.waypoint;
    expect(newCycleBlocker(early)).toEqual({ stage: NEW_CYCLE_MIN_STAGE, waypointsLeft: left });
    early.waypoint = STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint - 1;
    expect(newCycleBlocker(early)).toEqual({ stage: NEW_CYCLE_MIN_STAGE, waypointsLeft: 1 });
    expect(newCycleBlocker(groveState())).toBeNull();
    expect(newCycleBlocker(stateAt(7))).toBeNull();
  });

  it('gesperrt: ändert nichts', () => {
    const state = stateAt(4, ['earthworm'], 2);
    const before = structuredClone(state);
    expect(startNewCycle(state, 10)).toEqual({ ok: false, error: 'cycle-locked' });
    expect(state).toEqual(before);
  });

  it('setzt Wachstum, Samen, Wegpunkt, Stufe, Pflanzen, Nischen und Begegnungen zurück', () => {
    const state = groveState();
    const result = startNewCycle(state, 99_000);
    expect(result.ok).toBe(true);
    expect(state.totalGrowth).toBe(0);
    expect(state.seeds).toBe(0);
    expect(state.waypoint).toBe(0);
    expect(state.stage).toBe(0);
    expect(state.plants).toEqual([]);
    expect(allAnimals(state)).toEqual([]);
    expect(state.pendingEncounters).toEqual([]);
    expect(state.cycle).toEqual({ ...createCycle(2, 99_000), maxHarmony: Math.max(0, evaluate(state).harmony) });
  });

  it('behält Tagebuch, Andenken, Stammgäste, Zufallsgenerator und lastTick; schreibt Waldgedächtnis gut', () => {
    const state = groveState();
    state.meta.forestMemory = 30;
    state.meta.regulars = ['vole'];
    state.meta.journal.species.push('vole');
    const journal = structuredClone(state.meta.journal);
    expect(journal.plants).toEqual(['hazel', 'moss']);
    const { rngState, lastTick } = state;
    const gain = Math.floor(state.cycle.maxHarmony / 5) + 4;
    const preview = previewNewCycle(state);
    expect(preview).toMatchObject({ blocker: null, memoryGain: gain, memoryBefore: 30, memoryAfter: 30 + gain, newSpecies: 4 });
    const result = startNewCycle(state, 1);
    expect(result).toEqual({ ok: true, preview, regulars: [] });
    expect(state.meta.forestMemory).toBe(30 + gain);
    expect(state.meta.journal).toEqual(journal);
    expect(state.meta.regulars).toEqual(['vole']);
    expect(state.rngState).toBe(rngState);
    expect(state.lastTick).toBe(lastTick);
  });

  it('Waldgedächtnis bleibt an der Obergrenze', () => {
    const state = groveState();
    state.meta.forestMemory = MAX_FOREST_MEMORY - 1;
    expect(previewNewCycle(state).memoryGain).toBe(1);
    startNewCycle(state, 0);
    expect(state.meta.forestMemory).toBe(MAX_FOREST_MEMORY);
    // Zweiter Zyklus bis Hain: kein Zuwachs mehr.
    state.stage = NEW_CYCLE_MIN_STAGE;
    state.cycle.maxHarmony = 500;
    expect(previewNewCycle(state).memoryGain).toBe(0);
    startNewCycle(state, 0);
    expect(state.meta.forestMemory).toBe(MAX_FOREST_MEMORY);
  });

  it('Vorschau nennt neue Stammgast-Plätze', () => {
    const state = groveState();
    state.meta.forestMemory = 20;
    state.cycle.maxHarmony = 105;
    state.cycle.newSpecies = Array.from({ length: 11 }, (_, i) => SPECIES[i]!.id);
    const preview = previewNewCycle(state);
    expect(preview.memoryGain).toBe(32);
    expect(preview.regularSlotsBefore).toBe(0);
    expect(preview.regularSlotsAfter).toBe(2);
  });

  it('der nächste Zyklus wächst wieder bis zum Keimling und zieht Karten', () => {
    const state = groveState();
    startNewCycle(state, 0);
    tick(state, 60);
    expect(state.stage).toBeGreaterThanOrEqual(1);
    expect(state.pendingEncounters.length).toBeGreaterThan(0);
  });
});

describe('Stammgäste', () => {
  it('wählen nur entdeckte Arten und nur so viele, wie Plätze da sind', () => {
    const state = stateAt(1, ['earthworm', 'vole'], 1);
    expect(regularBlocker(state, 'earthworm')).toBe('no-regular-slot');
    state.meta.forestMemory = 50;
    expect(toggleRegular(state, 'nope')).toEqual({ ok: false, error: 'unknown-species' });
    expect(toggleRegular(state, 'wolf')).toEqual({ ok: false, error: 'not-discovered' });
    state.meta.journal.species.push('mole');
    expect(toggleRegular(state, 'earthworm').ok).toBe(true);
    expect(toggleRegular(state, 'vole').ok).toBe(true);
    expect(toggleRegular(state, 'mole')).toEqual({ ok: false, error: 'no-regular-slot' });
    expect(regularBlocker(state, 'vole')).toBeNull(); // schon gewählt: abwählen geht
    expect(toggleRegular(state, 'earthworm').ok).toBe(true);
    expect(toggleRegular(state, 'mole').ok).toBe(true);
    expect(state.meta.regulars).toEqual(['vole', 'mole']);
  });

  it('setRegulars prüft alles oder nichts', () => {
    const state = stateAt(1, ['earthworm', 'vole', 'chanterelle'], 1);
    state.meta.forestMemory = 50;
    expect(setRegulars(state, ['earthworm', 'earthworm', 'vole']).ok).toBe(true);
    expect(state.meta.regulars).toEqual(['earthworm', 'vole']);
    expect(setRegulars(state, ['earthworm', 'vole', 'chanterelle'])).toEqual({ ok: false, error: 'no-regular-slot' });
    expect(setRegulars(state, ['wolf'])).toEqual({ ok: false, error: 'not-discovered' });
    expect(state.meta.regulars).toEqual(['earthworm', 'vole']);
    expect(setRegulars(state, []).ok).toBe(true);
    expect(state.meta.regulars).toEqual([]);
  });

  it('ziehen beim Erreichen der Stufe kostenlos ein, in Wahl-Reihenfolge, nur bei freiem Platz', () => {
    const state = groveState();
    state.meta.forestMemory = 100;
    state.meta.journal.species.push('vole');
    state.meta.regulars = ['vole', 'earthworm', 'robin'];
    startNewCycle(state, 0);
    // Samen-Stufe: alle Nischen zu, niemand zieht ein.
    expect(allAnimals(state)).toEqual([]);
    const report = tick(state, 3600);
    // Keimling: Wurzelraum hat 1 Platz → nur die Wühlmaus. Setzling: 2 Plätze → Regenwurm,
    // Laubstreu öffnet → Rotkehlchen (freigeschaltet ab Setzling).
    expect(state.stage).toBeGreaterThanOrEqual(2);
    expect(state.niches.roots.slice(0, 2)).toEqual(['vole', 'earthworm']);
    expect(state.niches.litter[0]).toBe('robin');
    expect(report.regulars).toEqual(['vole', 'earthworm', 'robin']);
    expect(state.seeds).toBeGreaterThan(0); // nichts bezahlt
    // Die Karten bieten Stammgäste, die schon da sind, nicht noch einmal an.
    for (const e of state.pendingEncounters) {
      if (e.type === 'animal') expect(e.cards).not.toContain('vole');
    }
  });

  it('ziehen nicht ein, wenn sie schon da sind oder die Nische voll ist', () => {
    const state = stateAt(1, ['earthworm'], 1);
    state.meta.forestMemory = 50;
    state.meta.journal.species.push('vole');
    state.meta.regulars = ['earthworm', 'vole'];
    expect(moveInRegulars(state)).toEqual([]);
    expect(state.niches.roots).toEqual(['earthworm']);
  });

  it('Platz-Schaffer öffnen Plätze für weitere Stammgäste (zweite Runde)', () => {
    // Alter Baum: der eine Höhlenplatz ist belegt; der Borkenkäfer schafft einen zweiten.
    const state = stateAt(4, ['bat'], 1);
    state.meta.forestMemory = 100;
    state.meta.journal.species.push('owl', 'barkbeetle');
    state.meta.regulars = ['owl', 'barkbeetle'];
    expect(moveInRegulars(state)).toEqual(['barkbeetle', 'owl']);
    expect(state.niches.hollows).toEqual(['bat', 'owl']);
  });

  it('online und offline gleich, auch mit Stammgästen', () => {
    const online = groveState(1234);
    online.meta.forestMemory = 100;
    online.meta.journal.species.push('vole', 'mole', 'woodlouse');
    online.meta.regulars = ['mole', 'woodlouse', 'bee', 'vole'];
    startNewCycle(online, 0);
    const offline = structuredClone(online);
    for (let i = 0; i < 2 * 3600; i++) tick(online, 1);
    const report = simulateOffline(offline, 2 * 3600);
    expect(report.regulars.length).toBeGreaterThan(0);
    expect(offline.niches).toEqual(online.niches);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    // Spielzeit wie Wachstum nur bis auf Rundung gleich (Schritte enden an anderen Halten).
    expect({ ...offline.cycle, elapsed: 0 }).toEqual({ ...online.cycle, elapsed: 0 });
    expect(offline.cycle.elapsed).toBeCloseTo(online.cycle.elapsed, 6);
    expect(offline.meta).toEqual(online.meta);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
  });

  it('online und offline gleich genau an einer Jahreszeitengrenze (Frühling → Sommer)', () => {
    const online = groveState(4321);
    startNewCycle(online, 0);
    expect(online.cycle.elapsed).toBe(0);
    const offline = structuredClone(online);
    // Bis genau auf die Grenze: online in Sekunden-Schritten, offline in einem Stück.
    const seen: string[] = [];
    for (let i = 0; i < SEASON_SECONDS; i++) seen.push(...tick(online, 1).seasons);
    const report = simulateOffline(offline, SEASON_SECONDS);
    expect(online.cycle.elapsed).toBe(SEASON_SECONDS);
    expect(offline.cycle.elapsed).toBe(SEASON_SECONDS);
    expect(seen).toEqual(['summer']);
    expect(report.seasons).toEqual(seen);
    expect(seasonIdAt(offline.cycle.elapsed)).toBe('summer');
    expect(evaluate(offline)).toEqual(evaluate(online));
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 6);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
    // Von der Grenze aus geht es gleich weiter (kein doppelter Wechsel, keine verlorene Zeit).
    const a = tick(online, 0.5);
    const b = simulateOffline(offline, 0.5);
    expect(a.seasons).toEqual([]);
    expect(b.seasons).toEqual([]);
    expect(offline.cycle.elapsed).toBe(online.cycle.elapsed);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
  });
});

describe('Kartenpool: Arten aus dem Tagebuch ab dem zweiten Zyklus doppelt gewichtet', () => {
  /** Wie oft taucht `id` in den ersten Karten von n Ziehungen auf? */
  function share(state: GameState, id: string, n = 4000): number {
    let hits = 0;
    const rng = { rngState: 777 };
    for (let i = 0; i < n; i++) if (drawAnimals(state, [], rng)[0] === id) hits++;
    return hits / n;
  }

  it('erster Zyklus gleichverteilt, ab Zyklus 2 etwa doppelt so oft', () => {
    // Keimling: Wurzelraum offen, drei gewöhnliche Arten (Wühlmaus, Regenwurm, Pfifferling).
    const state = stateAt(1, [], 1);
    state.meta.journal.species = ['vole'];
    const first = share(state, 'vole');
    state.cycle.number = 2;
    const later = share(state, 'vole');
    // Ohne Gewicht 1/3 (seltene Arten außen vor), mit Gewicht 2 → 2/4 der gewöhnlichen.
    expect(first).toBeGreaterThan(0.25);
    expect(first).toBeLessThan(0.36);
    expect(later / first).toBeGreaterThan(1.3);
    expect(later).toBeGreaterThan(0.42);
  });

  it('erster Zyklus zieht exakt wie vorher (gleicher Zufallsverbrauch)', () => {
    const a = stateAt(3, ['earthworm'], 42);
    a.meta.journal.species = SPECIES.map((s) => s.id);
    const b = structuredClone(a);
    b.meta.journal.species = [];
    expect(drawAnimals(a)).toEqual(drawAnimals(b));
    expect(a.rngState).toBe(b.rngState);
  });
});

describe('Migration v3 → v4', () => {
  /** Ein echter v3-Stand (vor dem Neuen Zyklus), Alter Baum mit Tieren und Pflanzen. */
  function rawV3(): string {
    return JSON.stringify({
      version: 3,
      // v3-Stände liegen auf der Kurve 3,5 · k^3,4 (Umrechnung beim Laden, v6GrowthToV7).
      totalGrowth: v6Threshold(12) + 5,
      seeds: 77,
      waypoint: 12,
      stage: 4,
      plants: ['hazel'],
      niches: { roots: ['earthworm'], litter: ['robin'], edge: ['bee'], crown: [], bark: [], hollows: [] },
      pendingEncounters: [{ type: 'animal', cards: ['bluetit', 'jay'], rerolls: 1 }],
      rngState: 31337,
      meta: {
        forestMemory: 5,
        journal: { species: ['earthworm', 'robin', 'bee', 'oakmoth'], plants: ['hazel'], communities: [], keepsakes: ['old-oak'] },
      },
      lastTick: 5000,
    });
  }

  it('übernimmt den v3-Stand verlustfrei und ergänzt Zyklus und Stammgäste', () => {
    const result = loadGame(rawV3(), 9000)!;
    expect(result.migratedFromV1).toBe(false);
    const s = result.state;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.seeds).toBe(77);
    expect(s.waypoint).toBe(12);
    expect(s.stage).toBe(4);
    expect(s.plants).toEqual(['hazel']);
    expect(s.niches.edge).toEqual(['bee']);
    expect(s.pendingEncounters).toEqual([{ type: 'animal', cards: ['bluetit', 'jay'], rerolls: 1 }]);
    expect(s.rngState).toBe(31337);
    expect(s.lastTick).toBe(5000);
    expect(s.meta.forestMemory).toBe(5);
    expect(s.meta.journal.keepsakes).toEqual(['old-oak']);
    expect(s.meta.regulars).toEqual([]);
    // Erster Zyklus: alles im Tagebuch wurde in ihm entdeckt.
    expect(s.cycle.number).toBe(1);
    expect(s.cycle.newSpecies).toEqual(['earthworm', 'robin', 'bee', 'oakmoth']);
    expect(s.cycle.maxHarmony).toBe(Math.max(0, evaluate(s).harmony));
    expect(s.cycle).not.toHaveProperty('startedAt');
    // Und danach als v4 verlustfrei weiter.
    expect(deserialize(serialize(s), 9000)).toEqual(s);
  });

  it('v4: Zyklus und Stammgäste überstehen Speichern und Laden', () => {
    const state = groveState();
    state.meta.forestMemory = 60;
    state.meta.regulars = ['bee', 'earthworm'];
    startNewCycle(state, 4242);
    state.cycle.maxHarmony = 12.5;
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.cycle).toEqual(state.cycle);
    expect(loaded.meta.regulars).toEqual(['bee', 'earthworm']);
  });

  it('kaputte v4-Felder: Startwerte statt Absturz', () => {
    const base = JSON.parse(serialize(groveState()));
    const raw = JSON.stringify({
      ...base,
      cycle: { number: 'zwei', maxHarmony: NaN, newSpecies: ['bee', 'unbekannt', 3, 'bee', 'wolf'], startedAt: 'gestern' },
      meta: { ...base.meta, forestMemory: 30, regulars: ['bee', 'bee', 'wolf', 'robin', 'xyz'] },
    });
    const s = deserialize(raw, 0)!;
    expect(s.cycle.number).toBe(1);
    expect(s.cycle.maxHarmony).toBe(Math.max(0, evaluate(s).harmony));
    expect(s.cycle.newSpecies).toEqual(['bee']); // nur entdeckte, ohne Duplikate
    expect(s.cycle).not.toHaveProperty('startedAt');
    // Nur entdeckte Arten, höchstens floor(30/25) = 1 Platz.
    expect(s.meta.regulars).toEqual(['bee']);
    for (const bad of [{ cycle: null }, { cycle: [1, 2] }, { cycle: { number: -5, maxHarmony: -1e400 } }]) {
      const t = deserialize(JSON.stringify({ ...base, ...bad }), 0)!;
      expect(t.cycle.number).toBe(1);
      expect(t.cycle.maxHarmony).toBeGreaterThanOrEqual(0);
    }
    const huge = JSON.stringify({ ...base, cycle: { number: 0, maxHarmony: 0 } })
      .replace('"number":0', '"number":1e400')
      .replace('"maxHarmony":0', '"maxHarmony":-1e400');
    const h = deserialize(huge, 0)!;
    expect(h.cycle.number).toBe(MAX_CYCLE_NUMBER);
    expect(h.cycle.maxHarmony).toBeGreaterThanOrEqual(0);
  });

  it('neues Spiel startet im ersten Zyklus ohne Stammgäste', () => {
    const s = createInitialState(500, 1);
    expect(s.cycle).toEqual(createCycle(1, 500));
    expect(s.cycle).toMatchObject({ number: 1, maxHarmony: 0, newSpecies: [], startedAt: 500 });
    expect(s.meta.regulars).toEqual([]);
  });
});
