import { describe, expect, it } from 'vitest';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { SPECIES } from '../src/content/species';
import { SEASON_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { cycleMemoryGain, evaluate, memoryHarmonyBonus, regularSlots } from '../src/core/formulas';
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

const HAIN_STAGE = NEW_CYCLE_MIN_STAGE;
/** Wegpunkt des Hains – hier gilt die Hain-Regel aus 2.11 (Parameter von cycleMemoryGain). */
const HAIN = STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint;

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
  it('H = round(H_max): floor(H/5) + 3 je Punkt über 100 (höchstens 45) + neue Arten (seit Schritt 2.11)', () => {
    // Beispiele aus DESIGN_V2.md 15.4: Harmonie-Spieler beim Hain ~110, Wachstums-Spieler ~103,
    // Gelegenheitsspieler ~81 (nur Sockel und Arten, wie vor 2.11).
    expect(cycleMemoryGain(110.4, 12, 0, HAIN)).toBe(22 + 30 + 12);
    expect(cycleMemoryGain(102.8, 13, 0, HAIN)).toBe(20 + 9 + 13); // 102,8 → 103
    expect(cycleMemoryGain(81, 13, 0, HAIN)).toBe(16 + 13);
    // Gerundet wie die Anzeige „Höchste Harmonie“: ab 100,5 gilt 101 und zählt extra.
    expect(cycleMemoryGain(100.4, 0, 0, HAIN)).toBe(20);
    expect(cycleMemoryGain(100.5, 0, 0, HAIN)).toBe(20 + 3);
    expect(cycleMemoryGain(100.6, 0, 0, HAIN)).toBe(20 + 3);
    expect(cycleMemoryGain(100.99, 11, 0, HAIN)).toBe(20 + 3 + 11);
    expect(cycleMemoryGain(101, 0, 0, HAIN)).toBe(20 + 3);
    // Auch der Sockel rechnet mit dem gerundeten Wert.
    expect(cycleMemoryGain(4.49, 0, 0, HAIN)).toBe(0);
    expect(cycleMemoryGain(4.5, 0, 0, HAIN)).toBe(1);
    expect(cycleMemoryGain(5, 0, 0, HAIN)).toBe(1);
    expect(cycleMemoryGain(0, 0, 0, HAIN)).toBe(0);
    // Ab 115 (gerundet) ist der Bonus voll: 45 Punkte.
    expect(cycleMemoryGain(114.4, 0, 0, HAIN)).toBe(22 + 42);
    expect(cycleMemoryGain(114.6, 0, 0, HAIN)).toBe(23 + 45);
    expect(cycleMemoryGain(115, 0, 0, HAIN)).toBe(23 + 45);
    expect(cycleMemoryGain(174, 21, 0, HAIN)).toBe(34 + 45 + 21);
  });

  it('Schwelle gleitet mit dem Wegpunkt (Schritt 2.11b): Hain 100 / 45 → Wald 125 / 41,5 → Urwald 150 / 38', () => {
    const WALD = STAGES[HAIN_STAGE + 1]!.waypoint;
    const URWALD = STAGES[HAIN_STAGE + 2]!.waypoint;
    expect([HAIN, WALD, URWALD]).toEqual([20, 28, 36]);
    expect(memoryHarmonyBonus(HAIN)).toEqual({ waypoint: 20, threshold: 100, maxPoints: 45, shownThreshold: 100, fullAt: 115 });
    expect(memoryHarmonyBonus(WALD)).toEqual({ waypoint: 28, threshold: 125, maxPoints: 41.5, shownThreshold: 125, fullAt: 139 });
    expect(memoryHarmonyBonus(URWALD)).toEqual({ waypoint: 36, threshold: 150, maxPoints: 38, shownThreshold: 150, fullAt: 163 });
    // Krumm dazwischen: Wegpunkt 23 → Schwelle 109,375, Obergrenze 43,6875; Panel „über 109 (bis 124)“.
    expect(memoryHarmonyBonus(23)).toMatchObject({ threshold: 109.375, maxPoints: 43.6875, shownThreshold: 109, fullAt: 124 });
    // Vor dem Hain (nur Vorschau), hinter dem Urwald und bei Unsinn: nächstliegende Stützstelle.
    for (const w of [0, 12, 19, 19.9, NaN, -3]) expect(memoryHarmonyBonus(w), String(w)).toEqual(memoryHarmonyBonus(HAIN));
    expect(memoryHarmonyBonus(99)).toEqual(memoryHarmonyBonus(URWALD));
    expect(memoryHarmonyBonus(Infinity)).toEqual(memoryHarmonyBonus(URWALD));
    expect(memoryHarmonyBonus(20.7)).toEqual(memoryHarmonyBonus(HAIN)); // nur ganze Wegpunkte
    expect(cycleMemoryGain(110.4, 12, 0, 0)).toBe(cycleMemoryGain(110.4, 12, 0, HAIN));
    // Typische Werte aus der Simulation (DESIGN_V2.md 15.4, Stand 2.11b): Harmonie- /
    // Wachstums- / Gelegenheitsspieler im Wald H_max ~143 / 128 / 109, im Urwald ~174 / 157 / 135.
    expect(cycleMemoryGain(143, 16, 0, WALD)).toBe(70 + 16); // ⌊28,6 + 41,5⌋
    expect(cycleMemoryGain(127, 17, 0, WALD)).toBe(25 + 6 + 17); // ⌊25,4 + 6⌋
    expect(cycleMemoryGain(107, 17, 0, WALD)).toBe(21 + 17);
    expect(cycleMemoryGain(174, 21, 0, URWALD)).toBe(34 + 38 + 21); // ⌊34,8 + 38⌋
    expect(cycleMemoryGain(157, 22, 0, URWALD)).toBe(31 + 21 + 22); // ⌊31,4 + 21⌋
    expect(cycleMemoryGain(135, 21, 0, URWALD)).toBe(27 + 21);
    // Krumme Schwelle: Wegpunkt 23, H 110 → ⌊22 + 3 · 0,625⌋ = 23; H 109 → 21.
    expect(cycleMemoryGain(110, 0, 0, 23)).toBe(23);
    expect(cycleMemoryGain(109, 0, 0, 23)).toBe(21);
    // Gerundet wie die Anzeige; voll ab Schwelle + Obergrenze / 3.
    expect(cycleMemoryGain(150.4, 0, 0, URWALD)).toBe(30);
    expect(cycleMemoryGain(150.5, 0, 0, URWALD)).toBe(30 + 3);
    expect(cycleMemoryGain(162, 0, 0, URWALD)).toBe(32 + 36); // ⌊32,4 + 36⌋, voll erst ab 163
    expect(cycleMemoryGain(163, 0, 0, URWALD)).toBe(32 + 38);
    expect(cycleMemoryGain(195, 0, 0, URWALD)).toBe(39 + 38);
    expect(cycleMemoryGain(139, 0, 0, WALD)).toBe(Math.floor(139 / 5 + 41.5));
    // Unsinn bleibt 0, die Obergrenze gilt auch hier.
    expect(cycleMemoryGain(NaN, NaN, NaN, URWALD)).toBe(0);
    expect(cycleMemoryGain(174, 21, MAX_FOREST_MEMORY - 5, URWALD)).toBe(5);
  });

  it('Gewinn sinkt nie, solange H_max je Wegpunkt um mindestens 3 steigt (alle Start-H_max 80–200)', () => {
    // Die Schwelle steigt um 3,125 je Wegpunkt. Bleibt H_max gleich, sinkt der Gewinn darum um
    // bis zu ~9 Punkte (das lässt sich ohne Gedächtnis im Spielstand nicht vermeiden: der Hain
    // gibt 115 Harmonie schon 68 Punkte, der Urwald darf höchstens ~1,5 × Hain bringen,
    // DESIGN_V2.md 15.4). Typische Verläufe steigen aber schneller: Mittel der Simulation
    // Hain → Urwald je Wegpunkt Harmonie +4,0, Wachstum +3,3, Zufall +3,2.
    for (const slope of [3, 3.2, 4.1, 5]) {
      for (let h0 = 80; h0 <= 200; h0++) {
        for (let w = HAIN; w < 36; w++) {
          const now = cycleMemoryGain(h0 + slope * (w - HAIN), 0, 0, w);
          const next = cycleMemoryGain(h0 + slope * (w + 1 - HAIN), 0, 0, w + 1);
          expect(next, `H_max ${h0} + ${slope} je Wegpunkt, Wegpunkt ${w}`).toBeGreaterThanOrEqual(now);
        }
      }
    }
    // Und monoton in H_max und neuen Arten bei festem Wegpunkt.
    for (let w = HAIN; w <= 36; w++) {
      for (let h = 0; h < 220; h++) {
        expect(cycleMemoryGain(h + 1, 5, 0, w)).toBeGreaterThanOrEqual(cycleMemoryGain(h, 5, 0, w));
        expect(cycleMemoryGain(h, 6, 0, w)).toBeGreaterThan(cycleMemoryGain(h, 5, 0, w));
      }
    }
  });

  it('typische Verläufe aus der Simulation (Mittelwerte Hain → Urwald, Zyklus 1–3) steigen an jedem Wegpunkt', () => {
    // [H_max beim Hain, beim Urwald, neue Arten beim Hain, beim Urwald], dazwischen linear
    // (npm run balance, DESIGN_V2.md 15.4 „Stand Schritt 2.11b“).
    const paths: Record<string, [number, number, number, number]> = {
      'Harmonie Z1': [110, 174, 12, 21],
      'Wachstum Z1': [104, 157, 13, 22],
      'Zufall Z1': [84, 135, 13, 21],
      'Harmonie Z2': [116, 185, 4, 4],
      'Wachstum Z2': [107, 158, 4, 4],
      'Zufall Z2': [88, 141, 4, 4],
      'Harmonie Z3': [119, 193, 2, 2],
      'Wachstum Z3': [109, 166, 2, 2],
    };
    for (const [name, [h0, h1, s0, s1]] of Object.entries(paths)) {
      let previous = -1;
      for (let w = HAIN; w <= 36; w++) {
        const t = (w - HAIN) / (36 - HAIN);
        const gain = cycleMemoryGain(h0 + t * (h1 - h0), Math.floor(s0 + t * (s1 - s0)), 0, w);
        expect(gain, `${name}, Wegpunkt ${w}`).toBeGreaterThanOrEqual(previous);
        previous = gain;
      }
    }
  });

  it('Vorschau und Neuer Zyklus rechnen mit dem erreichten Wegpunkt', () => {
    const state = groveState();
    state.cycle.maxHarmony = 140;
    state.cycle.newSpecies = Array.from({ length: 10 }, (_, i) => SPECIES[i]!.id);
    expect(previewNewCycle(state)).toMatchObject({ memoryGain: 28 + 45 + 10, harmonyBonus: memoryHarmonyBonus(HAIN) });
    state.waypoint = 28;
    state.stage = HAIN_STAGE + 1;
    expect(previewNewCycle(state)).toMatchObject({ memoryGain: 69 + 10, harmonyBonus: { threshold: 125, fullAt: 139 } }); // ⌊28 + 41,5⌋
    state.waypoint = 36;
    state.stage = HAIN_STAGE + 2;
    const preview = previewNewCycle(state);
    expect(preview).toMatchObject({ memoryGain: 28 + 0 + 10, harmonyBonus: { threshold: 150, fullAt: 163 } });
    const memory = state.meta.forestMemory;
    expect(startNewCycle(state, 0).ok).toBe(true);
    expect(state.meta.forestMemory).toBe(memory + preview.memoryGain);
  });

  it('Obergrenze MAX_FOREST_MEMORY: der Gewinn füllt höchstens bis zur Grenze auf', () => {
    expect(cycleMemoryGain(96, 12, MAX_FOREST_MEMORY - 10, HAIN)).toBe(10);
    expect(cycleMemoryGain(96, 12, MAX_FOREST_MEMORY, HAIN)).toBe(0);
    expect(cycleMemoryGain(1e300, 1e300, 0, HAIN)).toBe(MAX_FOREST_MEMORY);
    expect(cycleMemoryGain(Infinity, 0, 0, HAIN)).toBe(0); // Unsinn zählt nicht
  });

  it('negative Harmonie, NaN und negative Anzahlen ergeben 0 statt Abzug', () => {
    expect(cycleMemoryGain(-50, 0, 0, HAIN)).toBe(0);
    expect(cycleMemoryGain(NaN, NaN, NaN, HAIN)).toBe(0);
    expect(cycleMemoryGain(130, -4, 0, HAIN)).toBe(26 + 45);
    expect(cycleMemoryGain(30, 4, 0, HAIN)).toBe(6 + 4);
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
    const h = state.cycle.maxHarmony;
    const gain = Math.floor(h / 5) + Math.min(45, 3 * Math.max(0, Math.floor(h) - 100)) + 4;
    const preview = previewNewCycle(state);
    expect(preview).toMatchObject({ blocker: null, memoryGain: gain, memoryBefore: 30, memoryAfter: 30 + gain, newSpecies: 4 });
    const result = startNewCycle(state, 1);
    // Erfolge: Hain vor dem Zurücksetzen, danach der erste abgeschlossene Zyklus.
    expect(result).toEqual({ ok: true, preview, regulars: [], achievements: expect.arrayContaining(['grove', 'cycle-1']) });
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
    state.cycle.maxHarmony = 110;
    state.cycle.newSpecies = Array.from({ length: 11 }, (_, i) => SPECIES[i]!.id);
    const preview = previewNewCycle(state);
    expect(preview.memoryGain).toBe(22 + 30 + 11);
    expect(preview.regularSlotsBefore).toBe(0);
    expect(preview.regularSlotsAfter).toBe(3); // 20 + 63 = 83
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
    // Langzeit-Statistik: Zähler, Spielzeit und abgeschlossene Zyklen exakt.
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
