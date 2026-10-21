import { describe, expect, it } from 'vitest';
import { evaluate, previewChoice } from '../src/core/formulas';
import { allAnimals, createInitialState, type GameState } from '../src/core/state';
import { chooseCard, declineEncounter, plantSeed, tick, unlockedPlants } from '../src/core/tick';

/**
 * Minimaler Durchlauf-Test mit der echten Logik (ausführlich: tests/balance.test.ts).
 * Ein harmonie-orientierter Spieler entscheidet alle 5 Sekunden über Tier- und
 * Pflanzenkarten und setzt Pflanzen, wenn die Samen reichen.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

function resolveForHarmony(state: GameState): void {
  while (state.pendingEncounters.length > 0) {
    const now = evaluate(state).harmony;
    let best: { card: number; replace?: string; harmony: number } | null = null;
    state.pendingEncounters[0]!.cards.forEach((id, card) => {
      const candidates: (string | undefined)[] = [undefined, ...Object.values(state.niches).flat(), ...state.plants];
      for (const replace of candidates) {
        const preview = previewChoice(state, 0, card, replace);
        if (preview && preview.harmony > (best?.harmony ?? now)) best = { card, replace, harmony: preview.harmony };
      }
      void id;
    });
    const choice = best as { card: number; replace?: string } | null;
    if (choice) chooseCard(state, 0, choice.card, choice.replace);
    else declineEncounter(state, 0);
  }
  // Die erste freigeschaltete Pflanze setzen, solange Samen und Ring reichen.
  const first = unlockedPlants(state)[0];
  while (first !== undefined && plantSeed(state, first).ok) {
    // weiter
  }
}

describe('v2-Prototyp: Durchlauf', () => {
  it('erreicht die Stufen in vernünftiger Zeit, ohne NaN', () => {
    const state = createInitialState(0, 31415);
    const reached: number[] = [0];
    let time = 0;
    while (time < 3 * 3600 && state.stage < 5) {
      tick(state, 5);
      time += 5;
      resolveForHarmony(state);
      if (reached[state.stage] === undefined) reached[state.stage] = time;
      expect(Number.isFinite(state.totalGrowth) && Number.isFinite(state.seeds)).toBe(true);
    }
    // Erste Karte sofort, Keimling in Sekunden; Hain innerhalb von 3 Stunden.
    expect(reached[1]).toBeLessThanOrEqual(10);
    expect(reached[2]).toBeLessThan(5 * 60);
    expect(state.stage).toBe(5);
    expect(allAnimals(state).length).toBeGreaterThanOrEqual(5);
    expect(state.plants.length).toBeGreaterThanOrEqual(5);
    expect(evaluate(state).harmony).toBeGreaterThan(30);
    // Protokoll nur auf Wunsch: SIM_LOG=1 npx vitest run tests/smoke-v2.test.ts
    if (env.SIM_LOG) console.log(
      'Stufenzeiten (s):',
      reached.map((t) => Math.round(t)),
      'Harmonie',
      Math.round(evaluate(state).harmony),
      'Tiere',
      allAnimals(state),
    );
  });
});
