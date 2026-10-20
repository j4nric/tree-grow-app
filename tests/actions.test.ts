import { describe, expect, it } from 'vitest';
import { DECLINE_SEEDS, REROLL_BASE_COST, REROLL_COST_GROWTH } from '../src/content/encounters';
import { cardStatus, evaluate, previewChoice, rerollCost } from '../src/core/formulas';
import { chooseCard, declineEncounter, rerollEncounter } from '../src/core/tick';
import { stateAt } from './helpers';

/** Junger Baum (Krone 2 Plätze) mit einer offenen Begegnung. */
function withEncounter(animals: string[], cards: string[], seed = 1) {
  const state = stateAt(3, animals, seed);
  state.pendingEncounters.push({ type: 'animal', cards, rerolls: 0 });
  return state;
}

describe('chooseCard', () => {
  it('freier Platz: Tier zieht ein, Begegnung ist erledigt, Tagebuch merkt sich die Art', () => {
    const state = withEncounter([], ['bluetit', 'oakmoth', 'robin']);
    expect(cardStatus(state, 0, 0)).toBe('free');
    expect(chooseCard(state, 0, 0)).toEqual({ ok: true });
    expect(state.niches.crown).toEqual(['bluetit']);
    expect(state.pendingEncounters).toHaveLength(0);
    expect(state.meta.journal.species).toEqual(['bluetit']);
  });

  it('wählt die richtige Begegnung aus mehreren', () => {
    const state = withEncounter([], ['bluetit']);
    state.pendingEncounters.push({ type: 'animal', cards: ['earthworm', 'robin'], rerolls: 0 });
    expect(chooseCard(state, 1, 1).ok).toBe(true);
    expect(state.niches.litter).toEqual(['robin']);
    expect(state.pendingEncounters).toEqual([{ type: 'animal', cards: ['bluetit'], rerolls: 0 }]);
  });

  it('volle Nische: ohne Ersatz Fehler, mit Ersatz wird das Tier entlassen', () => {
    const state = withEncounter(['earthworm'], ['earthworm', 'robin']);
    state.niches.litter.push('woodlouse', 'centipede'); // Laubstreu 2/2
    expect(cardStatus(state, 0, 1)).toBe('full');
    expect(chooseCard(state, 0, 1)).toEqual({ ok: false, error: 'niche-full' });
    expect(state.pendingEncounters).toHaveLength(1);
    expect(chooseCard(state, 0, 1, 'bluetit')).toEqual({ ok: false, error: 'invalid-replace' });
    expect(chooseCard(state, 0, 1, 'centipede')).toEqual({ ok: true });
    expect(state.niches.litter).toEqual(['woodlouse', 'robin']);
    expect(state.pendingEncounters).toHaveLength(0);
  });

  it('Ersatz bei freiem Platz ist erlaubt (Tausch statt Zuzug)', () => {
    const state = withEncounter(['oakmoth'], ['bluetit']);
    expect(chooseCard(state, 0, 0, 'oakmoth').ok).toBe(true);
    expect(state.niches.crown).toEqual(['bluetit']);
  });

  it('jede Art höchstens einmal', () => {
    const state = withEncounter(['robin'], ['robin', 'bee']);
    expect(cardStatus(state, 0, 0)).toBe('present');
    expect(chooseCard(state, 0, 0)).toEqual({ ok: false, error: 'present' });
    expect(chooseCard(state, 0, 0, 'robin')).toEqual({ ok: false, error: 'present' });
    expect(state.niches.litter).toEqual(['robin']);
  });

  it('geschlossene Nische, ungültige Indizes und unbekannte Arten', () => {
    const state = stateAt(1);
    state.pendingEncounters.push({ type: 'animal', cards: ['bluetit', 'gibt-es-nicht'], rerolls: 0 });
    expect(chooseCard(state, 0, 0)).toEqual({ ok: false, error: 'closed' });
    expect(chooseCard(state, 0, 1)).toEqual({ ok: false, error: 'no-card' });
    expect(chooseCard(state, 0, 5)).toEqual({ ok: false, error: 'no-card' });
    expect(chooseCard(state, 3, 0)).toEqual({ ok: false, error: 'no-encounter' });
    expect(chooseCard(state, -1, 0)).toEqual({ ok: false, error: 'no-encounter' });
    expect(chooseCard(state, NaN, 0)).toEqual({ ok: false, error: 'no-encounter' });
  });
});

describe('previewChoice', () => {
  it('rechnet die Wahl vor, ohne den Spielstand zu ändern', () => {
    const state = withEncounter(['oakmoth'], ['bluetit']);
    const before = JSON.stringify(state);
    const preview = previewChoice(state, 0, 0)!;
    expect(JSON.stringify(state)).toBe(before);
    chooseCard(state, 0, 0);
    expect(evaluate(state).harmony).toBeCloseTo(preview.harmony);
    expect(preview.animals.bluetit).toBeDefined();
  });

  it('null bei unmöglicher Wahl', () => {
    const state = withEncounter(['robin', 'woodlouse'], ['robin', 'centipede']);
    expect(previewChoice(state, 0, 0)).toBeNull(); // lebt schon hier
    expect(previewChoice(state, 0, 1)).toBeNull(); // voll, kein Ersatz genannt
    expect(previewChoice(state, 0, 1, 'woodlouse')).not.toBeNull();
    expect(previewChoice(state, 0, 1, 'bee')).toBeNull();
    expect(previewChoice(state, 9, 0)).toBeNull();
  });
});

describe('declineEncounter', () => {
  it('bringt Samen und entfernt die Begegnung', () => {
    const state = withEncounter([], ['bluetit']);
    expect(declineEncounter(state, 0)).toEqual({ ok: true });
    expect(state.seeds).toBe(DECLINE_SEEDS);
    expect(state.pendingEncounters).toHaveLength(0);
    expect(declineEncounter(state, 0)).toEqual({ ok: false, error: 'no-encounter' });
    expect(state.seeds).toBe(DECLINE_SEEDS);
  });
});

describe('rerollEncounter', () => {
  it('kostet Samen, zieht neue Karten mit dem Generator und verdoppelt die Kosten', () => {
    const state = withEncounter([], ['bluetit'], 77);
    state.seeds = 100;
    expect(rerollCost(state, 0)).toBe(REROLL_BASE_COST);
    const rng = state.rngState;
    expect(rerollEncounter(state, 0)).toEqual({ ok: true });
    expect(state.seeds).toBe(100 - REROLL_BASE_COST);
    expect(state.rngState).not.toBe(rng);
    expect(state.pendingEncounters[0]!.rerolls).toBe(1);
    expect(state.pendingEncounters[0]!.cards.length).toBeGreaterThan(0);
    expect(rerollCost(state, 0)).toBe(REROLL_BASE_COST * REROLL_COST_GROWTH);
    expect(rerollEncounter(state, 0).ok).toBe(true);
    expect(state.seeds).toBe(100 - REROLL_BASE_COST * (1 + REROLL_COST_GROWTH));
  });

  it('ist deterministisch', () => {
    const a = withEncounter([], ['bluetit'], 5);
    const b = withEncounter([], ['bluetit'], 5);
    a.seeds = b.seeds = 50;
    rerollEncounter(a, 0);
    rerollEncounter(b, 0);
    expect(a).toEqual(b);
  });

  it('zu teuer: nichts passiert', () => {
    const state = withEncounter([], ['bluetit']);
    state.seeds = REROLL_BASE_COST - 0.01;
    const before = structuredClone(state);
    expect(rerollEncounter(state, 0)).toEqual({ ok: false, error: 'too-expensive' });
    expect(state).toEqual(before);
    expect(rerollEncounter(state, 4)).toEqual({ ok: false, error: 'no-encounter' });
  });

  it('keine Art verfügbar: kostet nichts, Zufall bleibt unverändert', () => {
    const state = stateAt(1, ['earthworm']); // Keimling: nur der Regenwurm, und der lebt schon hier
    state.pendingEncounters.push({ type: 'animal', cards: ['earthworm'], rerolls: 0 });
    state.seeds = 100;
    const before = structuredClone(state);
    expect(rerollEncounter(state, 0)).toEqual({ ok: false, error: 'no-cards' });
    expect(state).toEqual(before);
  });
});
