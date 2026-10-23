import { describe, expect, it } from 'vitest';
import { REROLL_BASE_COST, REROLL_COST_GROWTH } from '../src/content/encounters';
import { SEED_SECONDS_MIN_SEEDS } from '../src/content/events';
import {
  cardStatus,
  choiceBlocker,
  declineReward,
  evaluate,
  previewChoice,
  previewSowing,
  rerollCost,
  sowingChoiceBlocker,
} from '../src/core/formulas';
import type { GameState } from '../src/core/state';
import {
  canReroll,
  chooseCard,
  chooseSowing,
  declineEncounter,
  recordDiscoveries,
  rerollBlocker,
  rerollEncounter,
  unlockedPlants,
} from '../src/core/tick';
import { fakeSpecies, plantFromSowing, stateAt, withFakeSpecies } from './helpers';

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

describe('chooseCard mit Höhlen & Totholz', () => {
  const owl = fakeSpecies({ id: 'test-owl', niche: 'hollows' });
  const nuthatch = fakeSpecies({ id: 'test-nuthatch', niche: 'bark' });

  it('Borkenkäfer öffnet einen Höhlenplatz schon im Jungen Baum', () => {
    withFakeSpecies([owl], () => {
      const closed = withEncounter([], ['test-owl']);
      expect(cardStatus(closed, 0, 0)).toBe('closed');
      const open = withEncounter(['barkbeetle'], ['test-owl']);
      expect(cardStatus(open, 0, 0)).toBe('free');
      expect(chooseCard(open, 0, 0)).toEqual({ ok: true });
      expect(open.niches.hollows).toEqual(['test-owl']);
      expect(evaluate(open).slots.hollows).toBe(1);
    });
  });

  it('wer den Borkenkäfer entlässt, darf den Höhlenbewohner nicht obdachlos machen', () => {
    withFakeSpecies([owl, nuthatch], () => {
      const state = withEncounter(['barkbeetle'], ['test-nuthatch']);
      state.niches.hollows.push('test-owl');
      const before = structuredClone(state);
      expect(cardStatus(state, 0, 0)).toBe('full'); // Stamm 1/1
      expect(previewChoice(state, 0, 0, 'barkbeetle')).toBeNull();
      expect(choiceBlocker(state, 0, 0, 'barkbeetle')).toBe('would-evict');
      expect(chooseCard(state, 0, 0, 'barkbeetle')).toEqual({ ok: false, error: 'would-evict' });
      expect(state).toEqual(before);
      // Ein Tier, das nicht in der Nische lebt, bleibt 'invalid-replace'.
      expect(chooseCard(state, 0, 0, 'test-owl')).toEqual({ ok: false, error: 'invalid-replace' });
    });
  });

  it('auch bei freiem Platz: Tausch gegen den Borkenkäfer nähme der Höhle den Platz', () => {
    const owl2 = fakeSpecies({ id: 'test-owl-2', niche: 'hollows' });
    withFakeSpecies([owl, owl2, nuthatch], () => {
      const state = withEncounter(['barkbeetle'], ['test-nuthatch']);
      state.stage = 4; // Alter Baum: Stamm 2 Plätze, Höhle 1 + 1 (Borkenkäfer)
      state.niches.hollows.push('test-owl', 'test-owl-2');
      expect(cardStatus(state, 0, 0)).toBe('free');
      expect(choiceBlocker(state, 0, 0, 'barkbeetle')).toBe('would-evict');
      expect(choiceBlocker(state, 0, 0)).toBeNull(); // Zuzug ohne Tausch geht
    });
  });
});

describe('choiceBlocker, previewChoice und chooseCard sind sich einig', () => {
  const owl = fakeSpecies({ id: 'test-owl', niche: 'hollows' });
  const nuthatch = fakeSpecies({ id: 'test-nuthatch', niche: 'bark' });

  /** Alle Kombinationen aus Begegnung, Karte und Ersatz (auch unsinnige). */
  function check(state: GameState): void {
    const replaces = [undefined, 'gibt-es-nicht', ...Object.values(state.niches).flat(), ...state.plants];
    for (let e = -1; e <= state.pendingEncounters.length; e++) {
      for (let c = -1; c <= 3; c++) {
        for (const r of replaces) {
          const blocker = choiceBlocker(state, e, c, r);
          const preview = previewChoice(state, e, c, r);
          const copy = structuredClone(state);
          const result = chooseCard(copy, e, c, r);
          const label = [e, c, r].join('/');
          expect(preview === null, label).toBe(blocker !== null);
          expect(result, label).toEqual(blocker ? { ok: false, error: blocker } : { ok: true });
          if (preview) expect(evaluate(copy).harmony, label).toBeCloseTo(preview.harmony, 9);
          else expect(copy, label).toEqual(state);
        }
      }
    }
  }

  it('Tierkarten mit Höhlenbewohnern, vollen und geschlossenen Nischen', () => {
    withFakeSpecies([owl, nuthatch], () => {
      const state = withEncounter(['barkbeetle', 'earthworm', 'robin'], ['test-nuthatch', 'robin', 'bee', 'test-owl']);
      state.niches.hollows.push('test-owl');
      state.niches.litter.push('woodlouse');
      state.pendingEncounters.push({ type: 'animal', cards: ['centipede', 'gibt-es-nicht'], rerolls: 0 });
      check(state);
    });
  });
});

describe('sowingChoiceBlocker, previewSowing und chooseSowing sind sich einig', () => {
  /** Alle Kombinationen aus Karte und Ersatz (auch unsinnige). */
  function check(state: GameState): void {
    const replaces = [undefined, 'gibt-es-nicht', 'earthworm', ...state.plants];
    for (let c = -1; c <= 3; c++) {
      for (const r of replaces) {
        const blocker = sowingChoiceBlocker(state, c, r);
        const preview = previewSowing(state, c, r);
        const copy = structuredClone(state);
        const result = chooseSowing(copy, c, r);
        const label = [c, r].join('/');
        expect(preview === null, label).toBe(blocker !== null);
        expect(result.ok, label).toBe(blocker === null);
        if (!result.ok) expect(result.error, label).toBe(blocker);
        if (preview) expect(evaluate(copy).harmony, label).toBeCloseTo(preview.harmony, 9);
        else expect(copy, label).toEqual(state);
      }
    }
  }

  it('Pflanzenkarten mit freiem und vollem Ring', () => {
    const state = stateAt(2, ['earthworm']);
    state.cycle.sowing = { cards: ['hazel', 'gibt-es-nicht', 'moss', 'birch'], rerolls: 0 };
    check(state);
    state.plants = ['fern', 'moss'];
    check(state);
    state.cycle.sowing = null;
    check(state);
  });
});

describe('chooseSowing: Karten der Aussaat', () => {
  function withSowing(plants: string[], cards: string[], stage = 2) {
    const state = stateAt(stage, ['earthworm']);
    state.plants = plants;
    state.cycle.sowing = { cards, rerolls: 0 };
    return state;
  }

  it('freier Ring: Pflanze wird gesetzt, Aussaat erledigt, nichts kostet', () => {
    const state = withSowing([], ['hazel', 'fern', 'nettle']);
    state.seeds = 3;
    const preview = previewSowing(state, 1)!;
    expect(chooseSowing(state, 1)).toEqual({ ok: true, planted: 'fern' });
    expect(state.plants).toEqual(['fern']);
    expect(state.seeds).toBe(3);
    expect(state.cycle.sowing).toBeNull();
    expect(state.meta.stats.plantsPlanted).toBe(1);
    expect(state.meta.stats.cardsChosen).toBe(0);
    expect(evaluate(state).growth).toBeCloseTo(preview.growth);
    // Pflanzen landen nicht im Arten-Tagebuch.
    expect(state.meta.journal.species).toEqual(['earthworm']);
  });

  it('Duplikate sind erlaubt (kein „lebt schon hier“)', () => {
    const state = withSowing(['hazel'], ['hazel']);
    expect(chooseSowing(state, 0).ok).toBe(true);
    expect(state.plants).toEqual(['hazel', 'hazel']);
  });

  it('voller Ring: ohne Ersatz Fehler, mit Ersatz wird die Pflanze ersetzt', () => {
    const state = withSowing(['moss', 'fern'], ['hazel']);
    expect(chooseSowing(state, 0)).toEqual({ ok: false, error: 'ring-full' });
    expect(chooseSowing(state, 0, 'birch')).toEqual({ ok: false, error: 'invalid-replace' });
    expect(chooseSowing(state, 0, 'earthworm')).toEqual({ ok: false, error: 'invalid-replace' });
    expect(state.cycle.sowing).not.toBeNull();
    expect(chooseSowing(state, 0, 'fern')).toEqual({ ok: true, planted: 'hazel' });
    expect(state.plants).toEqual(['moss', 'hazel']);
  });

  it('gesperrte Pflanze (erst auf späterer Stufe): Karte ist geschlossen', () => {
    const state = withSowing([], ['birch', 'hazel']); // Setzling, Birke ab Junger Baum
    expect(chooseSowing(state, 0)).toEqual({ ok: false, error: 'closed' });
    expect(sowingChoiceBlocker(state, 1)).toBeNull();
  });

  it('Ersatz nur bei vollem Ring und nur durch eine andere Pflanze', () => {
    const free = withSowing(['moss'], ['hazel', 'moss']);
    expect(chooseSowing(free, 0, 'moss')).toEqual({ ok: false, error: 'invalid-replace' });
    expect(free.plants).toEqual(['moss']);
    const full = withSowing(['moss', 'fern'], ['hazel', 'moss']);
    expect(chooseSowing(full, 1, 'moss')).toEqual({ ok: false, error: 'invalid-replace' });
    expect(previewSowing(full, 1, 'moss')).toBeNull();
    expect(chooseSowing(full, 1, 'fern').ok).toBe(true);
    expect(full.plants).toEqual(['moss', 'moss']);
  });

  it('unbekannte Pflanze, Tier-ID, geschlossener Ring, keine Aussaat', () => {
    const state = withSowing([], ['gibt-es-nicht', 'earthworm']);
    expect(chooseSowing(state, 0)).toEqual({ ok: false, error: 'no-card' });
    expect(chooseSowing(state, 1)).toEqual({ ok: false, error: 'no-card' });
    expect(chooseSowing(state, 0.5)).toEqual({ ok: false, error: 'no-card' });
    const seedStage = withSowing([], ['moss'], 0);
    expect(chooseSowing(seedStage, 0)).toEqual({ ok: false, error: 'closed' });
    const none = stateAt(2);
    expect(chooseSowing(none, 0)).toEqual({ ok: false, error: 'no-sowing' });
    expect(previewSowing(none, 0)).toBeNull();
  });

  it('unlockedPlants je Stufe', () => {
    expect(unlockedPlants(stateAt(0))).toEqual([]);
    expect(unlockedPlants(stateAt(1)).sort()).toEqual(['anemone', 'moss']);
    expect(unlockedPlants(stateAt(4))).toHaveLength(14);
  });
});

describe('Naturtagebuch: Pflanzen und Lebensgemeinschaften', () => {
  it('chooseCard und chooseSowing merken Pflanzen und entdeckte Lebensgemeinschaften', () => {
    // Humusküche: Regenwurm, Rollassel, Pfifferling oder Steinpilz
    const state = withEncounter(['earthworm', 'woodlouse'], ['chanterelle']);
    expect(state.meta.journal.communities).toEqual([]);
    expect(chooseCard(state, 0, 0)).toEqual({ ok: true, discovered: ['humus'] });
    expect(state.meta.journal.communities).toEqual(['humus']);
    // Pflanze aus einer Aussaat → im Tagebuch; Feuchter Grund braucht noch den Wurmfarn.
    expect(plantFromSowing(state, 'moss')).toEqual({ ok: true, planted: 'moss' });
    expect(state.meta.journal.plants).toEqual(['moss']);
    state.niches.litter.push('slug');
    expect(plantFromSowing(state, 'fern')).toEqual({ ok: true, planted: 'fern', discovered: ['damp-ground'] });
    expect(state.meta.journal.plants).toEqual(['moss', 'fern']);
    expect(state.meta.journal.communities).toEqual(['humus', 'damp-ground']);
    // Doppelt gesetzt: kein doppelter Eintrag, nichts Neues entdeckt (kein `discovered`).
    expect(plantFromSowing(state, 'fern')).toEqual({ ok: true, planted: 'fern' });
    expect(state.meta.journal.plants).toEqual(['moss', 'fern']);
  });

  it('eine Wahl kann zwei Gemeinschaften auf einmal entdecken (`discovered` mit beiden IDs)', () => {
    // Wildbiene vervollständigt Samenboten und Blütensaum.
    const state = withEncounter(['squirrel', 'jay', 'peacock'], ['bee']);
    state.plants = ['nettle', 'strawberry'];
    expect(chooseCard(state, 0, 0)).toEqual({ ok: true, discovered: ['seed-couriers', 'flower-hem'] });
    expect(state.meta.journal.communities).toEqual(['seed-couriers', 'flower-hem']);
  });

  it('entdeckt bleibt entdeckt; recordDiscoveries meldet nur Neues', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse', 'porcini']);
    expect(recordDiscoveries(state)).toEqual(['humus']);
    expect(recordDiscoveries(state)).toEqual([]);
    state.niches.roots = ['earthworm'];
    expect(recordDiscoveries(state)).toEqual([]);
    expect(state.meta.journal.communities).toEqual(['humus']);
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
    const reward = declineReward(state);
    expect(reward).toBeGreaterThanOrEqual(SEED_SECONDS_MIN_SEEDS);
    expect(declineEncounter(state, 0)).toEqual({ ok: true });
    expect(state.seeds).toBe(reward);
    expect(state.pendingEncounters).toHaveLength(0);
    expect(declineEncounter(state, 0)).toEqual({ ok: false, error: 'no-encounter' });
    expect(state.seeds).toBe(reward);
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

  it('schließt die bisherigen Karten aus, wenn genug andere Arten passen', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = withEncounter([], ['robin', 'bee', 'oakmoth'], seed);
      state.seeds = 1000;
      expect(rerollEncounter(state, 0).ok).toBe(true);
      const cards = state.pendingEncounters[0]!.cards;
      expect(cards).toHaveLength(3);
      for (const old of ['robin', 'bee', 'oakmoth']) expect(cards, `Seed ${seed}`).not.toContain(old);
    }
  });

  it('füllt mit alten Karten auf, wenn zu wenige andere Arten passen', () => {
    // Keimling: nur Regenwurm, Wühlmaus und Pfifferling (Wurzelraum) kommen in Frage.
    for (let seed = 1; seed <= 20; seed++) {
      const state = stateAt(1, [], seed);
      state.pendingEncounters.push({ type: 'animal', cards: ['earthworm', 'vole'], rerolls: 0 });
      state.seeds = 1000;
      expect(canReroll(state, 0)).toBe(true);
      expect(rerollEncounter(state, 0).ok).toBe(true);
      const cards = state.pendingEncounters[0]!.cards;
      expect(cards[0]).toBe('chanterelle'); // die neue Art zuerst
      expect(cards).toHaveLength(3);
      expect(new Set(cards).size).toBe(3);
    }
  });

  it('dieselben Karten wären das Ergebnis: kostet nichts, Zufall bleibt unverändert', () => {
    const state = stateAt(1); // Keimling: nur Regenwurm, Wühlmaus und Pfifferling
    state.pendingEncounters.push({ type: 'animal', cards: ['earthworm', 'vole', 'chanterelle'], rerolls: 0 });
    state.seeds = 100;
    const before = structuredClone(state);
    expect(rerollBlocker(state, 0)).toBe('no-alternatives');
    expect(canReroll(state, 0)).toBe(false);
    expect(rerollEncounter(state, 0)).toEqual({ ok: false, error: 'no-alternatives' });
    expect(state).toEqual(before);
  });

  it('canReroll / rerollBlocker nennen den Grund und ändern nichts', () => {
    const state = withEncounter([], ['bluetit'], 3);
    const before = structuredClone(state);
    expect(rerollBlocker(state, 0)).toBe('too-expensive');
    expect(canReroll(state, 0)).toBe(false);
    expect(rerollBlocker(state, 1)).toBe('no-encounter');
    expect(canReroll(state, NaN)).toBe(false);
    expect(state).toEqual(before);
    state.seeds = NaN; // kaputte Samen: nie würfeln
    expect(canReroll(state, 0)).toBe(false);
    state.seeds = REROLL_BASE_COST;
    expect(rerollBlocker(state, 0)).toBeNull();
    expect(canReroll(state, 0)).toBe(true);
    // Die Vorschau zieht denselben Zufall wie der echte Wurf.
    const probe = structuredClone(state);
    expect(rerollEncounter(state, 0).ok).toBe(true);
    expect(state.rngState).not.toBe(probe.rngState);
    expect(state.seeds).toBe(0);
  });

  it('keine Art verfügbar: kostet nichts, Zufall bleibt unverändert', () => {
    // Keimling: nur Regenwurm, Wühlmaus und Pfifferling – alle leben schon hier.
    const state = stateAt(1, ['earthworm', 'vole', 'chanterelle']);
    state.pendingEncounters.push({ type: 'animal', cards: ['earthworm'], rerolls: 0 });
    state.seeds = 100;
    const before = structuredClone(state);
    expect(rerollEncounter(state, 0)).toEqual({ ok: false, error: 'no-cards' });
    expect(canReroll(state, 0)).toBe(false);
    expect(state).toEqual(before);
  });
});
