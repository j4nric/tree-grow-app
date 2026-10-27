import { describe, expect, it } from 'vitest';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { SPECIES } from '../src/content/species';
import { SEASON_SECONDS } from '../src/content/seasons';
import { STAGES } from '../src/content/stages';
import { cycleMemoryGain, evaluate, harmonyMemoryGain, memoryHarmonyBonus, regularSlots } from '../src/core/formulas';
import { MAX_CYCLE_NUMBER, deserialize, loadGame, serialize, v6Threshold } from '../src/core/save';
import { seasonIdAt } from '../src/core/season';
import { MAX_FOREST_MEMORY, SAVE_VERSION, allAnimals, createCycle, createInitialState, type GameState } from '../src/core/state';
import {
  chooseCard,
  drawAnimals,
  moveInRegulars,
  newCycleBlocker,
  previewNewCycle,
  recordDiscoveries,
  regularBlocker,
  setRegulars,
  simulateOffline,
  startNewCycle,
  tick,
  toggleRegular,
} from '../src/core/tick';
import { GROWTH, HARMONY, RANDOM, runGame } from '../scripts/simulate';
import { offlineTick, plantFromSowing, stateAt } from './helpers';

const HAIN_STAGE = NEW_CYCLE_MIN_STAGE;
/** Wegpunkt des Hains – hier gilt die Hain-Regel aus 2.11 (Parameter von cycleMemoryGain). */
const HAIN = STAGES[NEW_CYCLE_MIN_STAGE]!.waypoint;
const URWALD_STAGE = HAIN_STAGE + 2;

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
  it('H = round(H_max): floor(H/5) + 3 je Punkt über 112 (höchstens 45) + neue Arten (seit Phase 11, 3b; 2.11: über 100)', () => {
    // Beispiele aus DESIGN_V2.md 15.4 (Phase 11, 3b): Harmonie-Spieler beim Hain ~122, Wachstums-
    // Spieler ~108 (nur Sockel und Arten), Gelegenheitsspieler ~90.
    expect(cycleMemoryGain(121.6, 12, 0, HAIN)).toBe(24 + 30 + 12);
    expect(cycleMemoryGain(114.8, 13, 0, HAIN)).toBe(23 + 9 + 13); // 114,8 → 115
    expect(cycleMemoryGain(108.3, 13, 0, HAIN)).toBe(21 + 13);
    expect(cycleMemoryGain(81, 13, 0, HAIN)).toBe(16 + 13);
    // Gerundet wie die Anzeige „Höchste Harmonie“: ab 112,5 gilt 113 und zählt extra.
    expect(cycleMemoryGain(112.4, 0, 0, HAIN)).toBe(22);
    expect(cycleMemoryGain(112.5, 0, 0, HAIN)).toBe(22 + 3);
    expect(cycleMemoryGain(112.6, 0, 0, HAIN)).toBe(22 + 3);
    expect(cycleMemoryGain(112.99, 11, 0, HAIN)).toBe(22 + 3 + 11);
    expect(cycleMemoryGain(113, 0, 0, HAIN)).toBe(22 + 3);
    // Auch der Sockel rechnet mit dem gerundeten Wert.
    expect(cycleMemoryGain(4.49, 0, 0, HAIN)).toBe(0);
    expect(cycleMemoryGain(4.5, 0, 0, HAIN)).toBe(1);
    expect(cycleMemoryGain(5, 0, 0, HAIN)).toBe(1);
    expect(cycleMemoryGain(0, 0, 0, HAIN)).toBe(0);
    // Ab 127 (gerundet) ist der Bonus voll: 45 Punkte.
    expect(cycleMemoryGain(126.4, 0, 0, HAIN)).toBe(25 + 42);
    expect(cycleMemoryGain(126.6, 0, 0, HAIN)).toBe(25 + 45);
    expect(cycleMemoryGain(127, 0, 0, HAIN)).toBe(25 + 45);
    expect(cycleMemoryGain(174, 21, 0, HAIN)).toBe(34 + 45 + 21);
  });

  it('Teiler, Schwelle und Obergrenze gleiten mit dem Wegpunkt: Hain 5 / 112 / 45 → Wald 6 / 168 / 48 → Urwald 7 / 196 / 48', () => {
    const WALD = STAGES[HAIN_STAGE + 1]!.waypoint;
    const URWALD = STAGES[HAIN_STAGE + 2]!.waypoint;
    expect([HAIN, WALD, URWALD]).toEqual([20, 28, 36]);
    expect(memoryHarmonyBonus(HAIN)).toEqual({ waypoint: 20, divisor: 5, threshold: 112, maxPoints: 45, bonusFrom: 113, fullAt: 127 });
    expect(memoryHarmonyBonus(WALD)).toEqual({ waypoint: 28, divisor: 6, threshold: 168, maxPoints: 48, bonusFrom: 169, fullAt: 184 });
    expect(memoryHarmonyBonus(URWALD)).toEqual({ waypoint: 36, divisor: 7, threshold: 196, maxPoints: 48, bonusFrom: 197, fullAt: 212 });
    // Dazwischen linear: Wegpunkt 23 → Teiler 5,375, Schwelle 133, Obergrenze 46,125; Panel „ab 134 (bis 149)“.
    expect(memoryHarmonyBonus(23)).toMatchObject({ divisor: 5.375, threshold: 133, maxPoints: 46.125, bonusFrom: 134, fullAt: 149 });
    // Ab dem Wald flacher: +3,5 je Wegpunkt.
    expect(memoryHarmonyBonus(32)).toMatchObject({ divisor: 6.5, threshold: 182, maxPoints: 48, bonusFrom: 183, fullAt: 198 });
    // Vor dem Hain (nur Vorschau), hinter dem Urwald und bei Unsinn: nächstliegende Stützstelle.
    for (const w of [0, 12, 19, 19.9, NaN, -3]) expect(memoryHarmonyBonus(w), String(w)).toEqual(memoryHarmonyBonus(HAIN));
    expect(memoryHarmonyBonus(99)).toEqual(memoryHarmonyBonus(URWALD));
    expect(memoryHarmonyBonus(Infinity)).toEqual(memoryHarmonyBonus(URWALD));
    expect(memoryHarmonyBonus(20.7)).toEqual(memoryHarmonyBonus(HAIN)); // nur ganze Wegpunkte
    expect(cycleMemoryGain(110.4, 12, 0, 0)).toBe(cycleMemoryGain(110.4, 12, 0, HAIN));
    // Typische Werte aus der Simulation (DESIGN_V2.md 15.4, „Stand Phase 11, 3b“): Harmonie- /
    // Wachstums- / Gelegenheitsspieler beim Erreichen des Waldes H_max ~167 / 144 / 120, im Urwald
    // ~206 / 182 / 149. Im Wald zählt bei der Ankunft fast nur der Sockel (die Sperrklinke hält meist
    // mehr aus dem Hain), der Harmonie-Spieler überholt die Schwelle im Lauf der Stufe; im Urwald
    // bringt seine Harmonie 30 Punkte Bonus, die des Wachstums-Spielers keinen.
    expect(cycleMemoryGain(167, 16, 0, WALD)).toBe(27 + 16); // ⌊167 / 6⌋, knapp unter der Schwelle
    expect(cycleMemoryGain(176, 16, 0, WALD)).toBe(53 + 16); // ⌊29,33 + 24⌋
    expect(cycleMemoryGain(144, 17, 0, WALD)).toBe(24 + 17);
    expect(cycleMemoryGain(206, 21, 0, URWALD)).toBe(59 + 21); // ⌊29,43 + 30⌋
    expect(cycleMemoryGain(182, 22, 0, URWALD)).toBe(26 + 22); // ⌊182 / 7⌋, kein Bonus
    expect(cycleMemoryGain(149, 21, 0, URWALD)).toBe(21 + 21);
    // Krummer Teiler: Wegpunkt 23, H 140 → ⌊26,05 + 21⌋ = 47; H 133 → ⌊24,74⌋ = 24.
    expect(cycleMemoryGain(140, 0, 0, 23)).toBe(47);
    expect(cycleMemoryGain(133, 0, 0, 23)).toBe(24);
    // Gerundet wie die Anzeige; voll ab Schwelle + Obergrenze / 3.
    expect(cycleMemoryGain(196.4, 0, 0, URWALD)).toBe(28);
    expect(cycleMemoryGain(196.5, 0, 0, URWALD)).toBe(28 + 3); // ⌊28,14 + 3⌋
    expect(cycleMemoryGain(211, 0, 0, URWALD)).toBe(75); // ⌊30,14 + 45⌋, voll erst ab 212
    expect(cycleMemoryGain(212, 0, 0, URWALD)).toBe(78); // ⌊30,29 + 48⌋
    expect(cycleMemoryGain(230, 0, 0, URWALD)).toBe(80);
    expect(cycleMemoryGain(196, 0, 0, WALD)).toBe(Math.floor(196 / 6 + 48));
    // Unsinn bleibt 0, die Obergrenze gilt auch hier.
    expect(cycleMemoryGain(NaN, NaN, NaN, URWALD)).toBe(0);
    expect(cycleMemoryGain(206, 21, MAX_FOREST_MEMORY - 5, URWALD)).toBe(5);
  });

  it('bei gleicher H_max bringt ein späterer Wegpunkt nie mehr; monoton in H_max und neuen Arten', () => {
    // Die Formel allein (ohne Sperrklinke) sinkt mit dem Wegpunkt: Die Schwelle steigt (bis zum
    // Wald +7, danach +3,5 je Wegpunkt), der Sockel-Teiler auch, und die Obergrenze steigt
    // höchstens so schnell, wie der Sockel sinkt (content/memory.ts). Darauf verlässt sich das
    // Laden: Der Wert zur Hain-Regel ist die Obergrenze der Sperrklinke (core/save.ts). Dass die
    // Vorschau im Spiel trotzdem nie sinkt, sorgt `cycle.bestHarmonyMemory` (Sperrklinke, unten).
    for (let h = 0; h <= 400; h++) {
      for (let w = 0; w < 40; w++) {
        expect(cycleMemoryGain(h, 0, 0, w + 1), `H_max ${h}, Wegpunkt ${w + 1}`).toBeLessThanOrEqual(cycleMemoryGain(h, 0, 0, w));
      }
    }
    for (let w = HAIN; w <= 36; w++) {
      for (let h = 0; h < 220; h++) {
        expect(cycleMemoryGain(h + 1, 5, 0, w)).toBeGreaterThanOrEqual(cycleMemoryGain(h, 5, 0, w));
        expect(cycleMemoryGain(h, 6, 0, w)).toBeGreaterThan(cycleMemoryGain(h, 5, 0, w));
      }
    }
  });

  it('typische Verläufe (Mittelwerte Hain → Urwald, Zyklus 1): Harmonie bringt im Urwald deutlich mehr Bonus', () => {
    // [H_max beim Hain, am Ende des Hain-Wegpunkts, beim Urwald], dazwischen linear
    // (npm run balance, DESIGN_V2.md 15.4, Stand Phase 11, 3b). Mit Sperrklinke zählt der beste
    // Wert des Verlaufs.
    const paths: Record<string, [number, number, number]> = {
      Harmonie: [122, 128, 206],
      Wachstum: [108, 114, 182],
      Zufall: [90, 95, 149],
    };
    const best: Record<string, number> = {};
    const bonusAtEnd: Record<string, number> = {};
    for (const [name, [h0, h20, h1]] of Object.entries(paths)) {
      let ratchet = harmonyMemoryGain(h20, HAIN);
      expect(ratchet).toBeGreaterThanOrEqual(harmonyMemoryGain(h0, HAIN));
      for (let w = HAIN + 1; w <= 36; w++) {
        const h = h20 + ((w - HAIN) / (36 - HAIN)) * (h1 - h20);
        ratchet = Math.max(ratchet, harmonyMemoryGain(h, w));
      }
      best[name] = ratchet;
      bonusAtEnd[name] = harmonyMemoryGain(h1, 36) - Math.floor(h1 / memoryHarmonyBonus(36).divisor);
    }
    // Ziel (e): Die Urwald-Schwelle liegt ~10 unter der typischen Harmonie des Harmonie-Spielers.
    expect(memoryHarmonyBonus(36).threshold).toBeLessThanOrEqual(paths.Harmonie![2] - 10);
    expect(bonusAtEnd).toEqual({ Harmonie: 30, Wachstum: 0, Zufall: 0 });
    // Mit Sperrklinke hält jeder im Mittel-Verlauf den Wert vom Ende des Hain-Wegpunkts (Harmonie 70,
    // Wachstum 28); im Einzelfall bringt der Urwald mehr – vor allem dem Harmonie-Spieler, der
    // dort weit über der Schwelle liegen kann (H 212: 78). Der Zufallsspieler: ⌊142 / 6,75⌋ = 21.
    expect(best).toEqual({ Harmonie: 70, Wachstum: 28, Zufall: 21 });
  });

  it('Vorschau und Neuer Zyklus rechnen mit dem erreichten Wegpunkt', () => {
    const state = groveState();
    state.cycle.maxHarmony = 140;
    state.cycle.newSpecies = Array.from({ length: 10 }, (_, i) => SPECIES[i]!.id);
    expect(previewNewCycle(state)).toMatchObject({ memoryGain: 28 + 45 + 10, harmonyBonus: memoryHarmonyBonus(HAIN) });
    // Ohne gemerkten Wert (Sperrklinke) zählt nur die Regel am Wegpunkt.
    state.cycle.bestHarmonyMemory = 0;
    state.waypoint = 28;
    state.stage = HAIN_STAGE + 1;
    expect(previewNewCycle(state)).toMatchObject({ memoryGain: 23 + 10, harmonyBonus: { threshold: 168, fullAt: 184 } }); // ⌊140 / 6⌋
    state.waypoint = 36;
    state.stage = HAIN_STAGE + 2;
    const preview = previewNewCycle(state);
    expect(preview).toMatchObject({ memoryGain: 20 + 0 + 10, harmonyBonus: { threshold: 196, fullAt: 212 } });
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

describe('Sperrklinke: die Vorschau sinkt nie (seit v10)', () => {
  const WALD = STAGES[HAIN_STAGE + 1]!.waypoint;
  const URWALD = STAGES[URWALD_STAGE]!.waypoint;
  it('harmonyMemoryGain ist der Harmonie-Anteil von cycleMemoryGain', () => {
    for (const w of [0, HAIN, 23, 27, WALD, URWALD, 99]) {
      for (const h of [-5, 0, 4.5, 81, 100.5, 110, 127, 150.4, 174, 300]) {
        expect(harmonyMemoryGain(h, w), `H ${h}, Wegpunkt ${w}`).toBe(cycleMemoryGain(h, 0, 0, w));
      }
    }
    expect(harmonyMemoryGain(NaN, NaN)).toBe(0);
    expect(harmonyMemoryGain(Infinity, HAIN)).toBe(0);
    // Sinkt mit dem Wegpunkt (darum reicht beim Laden die Hain-Regel als Obergrenze).
    for (let h = 0; h <= 400; h++) {
      for (let w = 0; w < 40; w++) expect(harmonyMemoryGain(h, w + 1)).toBeLessThanOrEqual(harmonyMemoryGain(h, w));
    }
  });

  it('cycleMemoryGain zählt max(gemerkt, aktuell) plus neue Arten, begrenzt wie bisher', () => {
    // Urwald, H 135: aktuell 19 – gemerkt 60 zählt.
    expect(cycleMemoryGain(135, 21, 0, URWALD, 60)).toBe(60 + 21);
    // Gemerkt kleiner: aktuell zählt.
    expect(cycleMemoryGain(206, 21, 0, URWALD, 10)).toBe(59 + 21);
    // Bestand nahe der Obergrenze: füllt nur auf.
    expect(cycleMemoryGain(135, 21, MAX_FOREST_MEMORY - 7, URWALD, 60)).toBe(7);
    // Unsinn im gemerkten Wert zählt als 0, Brüche werden abgerundet, Riesen gedeckelt.
    expect(cycleMemoryGain(135, 0, 0, URWALD, NaN)).toBe(19);
    expect(cycleMemoryGain(135, 0, 0, URWALD, -50)).toBe(19);
    expect(cycleMemoryGain(135, 0, 0, URWALD, Infinity)).toBe(19);
    expect(cycleMemoryGain(135, 0, 0, URWALD, 40.9)).toBe(40);
    expect(cycleMemoryGain(0, 0, 0, URWALD, 1e300)).toBe(MAX_FOREST_MEMORY);
    expect(cycleMemoryGain(0, 0, 0, URWALD, 0)).toBe(0);
  });

  it('gleiche H_max über mehrere Wegpunkte: Vorschau bleibt, Neuer Zyklus schreibt den besten Wert gut', () => {
    const state = groveState();
    // Hain, H_max 132: 26 + 45 = 71. Die Tiere des Hains erreichen 132 nicht – H_max bleibt.
    state.cycle.maxHarmony = 132;
    recordDiscoveries(state);
    expect(evaluate(state).harmony).toBeLessThan(132);
    expect(state.cycle.bestHarmonyMemory).toBe(71);
    const species = state.cycle.newSpecies.length;
    const atHain = previewNewCycle(state).memoryGain;
    expect(atHain).toBe(71 + species);
    let previous = atHain;
    while (state.waypoint < HAIN + 4) {
      tick(state, 60);
      state.pendingEncounters = []; // keine Wahl: H_max bleibt 132
      const gain = previewNewCycle(state).memoryGain;
      expect(gain, `Wegpunkt ${state.waypoint}`).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
    expect(state.cycle.maxHarmony).toBe(132);
    // Ohne Sperrklinke wäre die Vorschau gesunken (Wegpunkt 24: ⌊132 / 5,5⌋ = 24, Schwelle 139).
    expect(cycleMemoryGain(132, species, 0, state.waypoint)).toBeLessThan(atHain);
    expect(previewNewCycle(state).memoryGain).toBe(71 + state.cycle.newSpecies.length);
    const memory = state.meta.forestMemory;
    const preview = previewNewCycle(state);
    expect(startNewCycle(state, 0).ok).toBe(true);
    expect(state.meta.forestMemory).toBe(memory + preview.memoryGain);
    // Neuer Zyklus: Sperrklinke beginnt neu (nur der Wert zum frischen Ökosystem).
    expect(state.cycle.bestHarmonyMemory).toBe(harmonyMemoryGain(state.cycle.maxHarmony, 0));
    expect(state.cycle.bestHarmonyMemory).toBeLessThan(71);
  });

  it('online = offline, auch im Schnellvorlauf über ganze Jahre', () => {
    const make = () => {
      const s = groveState(77);
      s.cycle.maxHarmony = 118;
      recordDiscoveries(s);
      return s;
    };
    const online = make();
    const offline = make();
    // Je drei Stunden eine Abwesenheit: erste 60 s voll, danach 10 % (28.3) – wie simulateOffline.
    const chunk = 3 * 3600;
    for (let i = 0; i < 3 * chunk; i++) {
      offlineTick(online, i % chunk, 1);
      online.pendingEncounters = [];
    }
    // Offline in Drei-Stunden-Stücken (Begegnungen dazwischen verworfen wie online).
    for (let i = 0; i < 3; i++) {
      simulateOffline(offline, chunk);
      offline.pendingEncounters = [];
    }
    expect(online.waypoint).toBeGreaterThan(HAIN + 2);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.cycle.maxHarmony).toBe(online.cycle.maxHarmony);
    expect(offline.cycle.bestHarmonyMemory).toBe(online.cycle.bestHarmonyMemory);
    // Die Sperrklinke hält wirklich etwas fest.
    expect(online.cycle.bestHarmonyMemory).toBeGreaterThan(harmonyMemoryGain(online.cycle.maxHarmony, online.waypoint));
    expect(previewNewCycle(offline)).toEqual(previewNewCycle(online));
    // Schnellvorlauf (ganze Jahre am Stück) wie Schritt für Schritt.
    const stepped = stateAt(4, ['chanterelle'], 3);
    recordDiscoveries(stepped);
    const skipped = structuredClone(stepped);
    for (let i = 0; i < 8; i++) tick(stepped, SEASON_SECONDS);
    tick(skipped, 8 * SEASON_SECONDS);
    expect(skipped.cycle.bestHarmonyMemory).toBe(stepped.cycle.bestHarmonyMemory);
    expect(stepped.cycle.bestHarmonyMemory).toBe(harmonyMemoryGain(stepped.cycle.maxHarmony, stepped.waypoint));
  });

  // Drei ganze Simulationen: unter paralleler Last (npm run check) mehr als 5 s.
  it('über einen ganzen simulierten Zyklus bis zum Urwald sinkt die Vorschau nie (runGame, memoryPath)', { timeout: 30_000 }, () => {
    for (const [strategy, seed] of [[HARMONY, 11], [GROWTH, 12], [RANDOM, 13]] as const) {
      const result = runGame(strategy, { seed, targetStage: URWALD_STAGE, maxSeconds: 8 * 3600, care: true });
      const path = result.memoryPath;
      expect(path.length, strategy.id).toBeGreaterThan(10);
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        expect(p.after, `${strategy.id} Wegpunkt ${p.waypoint}`).toBeGreaterThanOrEqual(p.arrive);
        if (i > 0) expect(p.arrive, `${strategy.id} Wegpunkt ${p.waypoint}`).toBeGreaterThanOrEqual(path[i - 1]!.after);
      }
    }
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

  it('Pflanze aus der Aussaat setzen führt H_max nach', () => {
    const state = stateAt(3, ['earthworm', 'bee'], 3);
    const before = state.cycle.maxHarmony;
    expect(plantFromSowing(state, 'hazel').ok).toBe(true);
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
    const h = Math.max(0, evaluate(state).harmony);
    // Sperrklinke neu: nur der Wert zum frischen Zyklus (Wegpunkt 0).
    expect(state.cycle).toEqual({ ...createCycle(2, 99_000), maxHarmony: h, bestHarmonyMemory: harmonyMemoryGain(h, 0) });
  });

  it('behält Tagebuch, Andenken, Stammgäste, Zufallsgenerator und lastTick; schreibt Waldgedächtnis gut', () => {
    const state = groveState();
    state.meta.forestMemory = 30;
    state.meta.regulars = ['vole'];
    state.meta.journal.species.push('vole');
    const journal = structuredClone(state.meta.journal);
    expect(journal.plants).toEqual(['hazel', 'moss']);
    const { rngState, lastTick } = state;
    // H = round(H_max) wie in cycleMemoryGain (DESIGN_V2.md 10).
    const h = Math.round(state.cycle.maxHarmony);
    const gain = Math.floor(h / 5) + Math.min(45, 3 * Math.max(0, h - 100)) + 4;
    const preview = previewNewCycle(state);
    expect(preview).toMatchObject({ blocker: null, memoryGain: gain, memoryBefore: 30, memoryAfter: 30 + gain, newSpecies: 4 });
    const result = startNewCycle(state, 1);
    // Erfolge: Hain vor dem Zurücksetzen, danach der erste abgeschlossene Zyklus.
    expect(result).toEqual({
      ok: true,
      preview,
      regulars: [],
      achievements: expect.arrayContaining(['grove', 'cycle-1']),
      site: 'home',
      founded: false,
      landscapeUnlocked: false,
      chapters: [],
    });
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
    state.cycle.maxHarmony = 122;
    state.cycle.newSpecies = Array.from({ length: 11 }, (_, i) => SPECIES[i]!.id);
    const preview = previewNewCycle(state);
    expect(preview.memoryGain).toBe(24 + 30 + 11);
    expect(preview.regularSlotsBefore).toBe(0);
    expect(preview.regularSlotsAfter).toBe(3); // 20 + 65 = 85
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
    // Einzelwetter: kleine Ticks = ein großer Tick (Stammgäste, Wegpunkte, Nacht-Halte).
    const small = structuredClone(online);
    const big = structuredClone(online);
    for (let i = 0; i < 2 * 3600; i++) tick(small, 1);
    expect(tick(big, 2 * 3600).regulars.length).toBeGreaterThan(0);
    expect(big.niches).toEqual(small.niches);
    expect(big.pendingEncounters).toEqual(small.pendingEncounters);
    expect(big.rngState).toBe(small.rngState);
    // Gesammelte Harmonie (v17) wird wie die Samen aufsummiert: gleich bis auf Rundung.
    expect(big.meta.stats.harmonyEarned / small.meta.stats.harmonyEarned).toBeCloseTo(1, 9);
    expect(big.harmonyPoints / small.harmonyPoints).toBeCloseTo(1, 9);
    expect({ ...big.meta, stats: { ...big.meta.stats, harmonyEarned: 0 } }).toEqual({ ...small.meta, stats: { ...small.meta.stats, harmonyEarned: 0 } });
    expect(big.totalGrowth).toBeCloseTo(small.totalGrowth, 6);
    expect(big.seeds).toBeCloseTo(small.seeds, 6);
    // simulateOffline rechnet ab einem Tag mit dem Mittelwetter (DESIGN_V2.md 21.5): online im selben Modus.
    // Dazu der Ertragsfaktor der Abwesenheit (28.3): erste 60 s voll, danach 10 %.
    for (let i = 0; i < 2 * 3600; i++) offlineTick(online, i, 1);
    const report = simulateOffline(offline, 2 * 3600);
    expect(report.regulars.length).toBeGreaterThan(0);
    expect(offline.niches).toEqual(online.niches);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    // Spielzeit wie Wachstum nur bis auf Rundung gleich (Schritte enden an anderen Halten).
    expect({ ...offline.cycle, elapsed: 0 }).toEqual({ ...online.cycle, elapsed: 0 });
    expect(offline.cycle.elapsed).toBeCloseTo(online.cycle.elapsed, 6);
    // Langzeit-Statistik: Zähler, Spielzeit und abgeschlossene Zyklen exakt; die gesammelte
    // Harmonie (v17) wie die Samen bis auf Rundung.
    expect(offline.meta.stats.harmonyEarned / online.meta.stats.harmonyEarned).toBeCloseTo(1, 9);
    expect(offline.harmonyPoints / online.harmonyPoints).toBeCloseTo(1, 9);
    expect({ ...offline.meta, stats: { ...offline.meta.stats, harmonyEarned: 0 } }).toEqual({ ...online.meta, stats: { ...online.meta.stats, harmonyEarned: 0 } });
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
    // Ein ganzer Tag offline: Mittelwetter (DESIGN_V2.md 21.5) – online im selben Modus.
    // Erste 60 s voll, danach 10 % (28.3) – wie simulateOffline.
    for (let i = 0; i < SEASON_SECONDS; i++) for (const r of offlineTick(online, i, 1)) seen.push(...r.seasons);
    const report = simulateOffline(offline, SEASON_SECONDS);
    expect(report.averaged).toBe(true);
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
    state.cycle.bestHarmonyMemory = harmonyMemoryGain(12.5, state.waypoint);
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
