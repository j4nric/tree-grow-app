import { describe, expect, it } from 'vitest';
import { CARDS_PER_ENCOUNTER, ENCOUNTER_WEIGHTS, FORCED_MAX_CARDS, REROLL_BASE_COST, SCRIPTED_ENCOUNTERS } from '../src/content/encounters';
import { EVENTS, EVENTS_BY_ID } from '../src/content/events';
import { PLANTS_BY_ID } from '../src/content/plants';
import { SEASON_SECONDS, SEASONS_BY_ID } from '../src/content/seasons';
import {
  MAX_SOWINGS,
  MAX_SOWING_CARDS,
  SOWING_BASE,
  SOWING_GROWTH,
  SOWING_MIN_COST_FACTOR,
  SOWING_MIN_STAGE,
  SPRING_SOWING_FACTOR,
} from '../src/content/sowing';
import { ENCOUNTER_TYPES } from '../src/content/types';
import {
  declineReward,
  evaluate,
  sowingBaseCost,
  sowingCardCount,
  sowingCost,
  sowingCostAt,
  sowingDiscount,
  sowingRerollCost,
  sowingSeasonFactor,
  thresholdFor,
} from '../src/core/formulas';
import { deserialize, loadGame, serialize } from '../src/core/save';
import { createInitialState, type GameState } from '../src/core/state';
import {
  chooseEventOption,
  chooseSowing,
  discardSowing,
  rerollSowing,
  rerollSowingBlocker,
  simulateOffline,
  sow,
  sowBlocker,
  startNewCycle,
  tick,
} from '../src/core/tick';
import { stateAt, tickToGrowth } from './helpers';

/*
 * Aussaat (DESIGN_V2.md 27.5/27.6; Phase 10, 2b): Pflanzen kommen nur noch über „Säen“ –
 * Preis je Kauf, geschenkte erste Aussaat an Wegpunkt 2, Vogelsaat, Forschung, Laden alter Stände.
 */

const SPRING = 0; // cycle.elapsed im Frühling
const SUMMER = SEASON_SECONDS; // erste Sekunde des Sommers

/** Spielstand einer Stufe im Sommer (ohne Saatzeit), mit Samen. */
function sowable(stage: number, seeds = 1e6, seed = 1): GameState {
  const state = stateAt(stage, ['earthworm'], seed);
  state.cycle.elapsed = SUMMER;
  state.seeds = seeds;
  return state;
}

describe('Aussaat: Preis (27.6)', () => {
  it('Tabelle 27.6: die erste gratis, dann ⌈20 · 1,75^(n−1)⌉', () => {
    const table = [0, 20, 35, 62, 108, 188, 329, 575, 1006, 1760, 3079, 5388, 9429, 16501, 28876, 50532, 88431];
    expect(table.map((_, n) => sowingCostAt(n, [], SUMMER))).toEqual(table);
    expect(sowingBaseCost(2)).toBe(SOWING_BASE * SOWING_GROWTH);
  });

  it('Saatzeit im Frühling (× 0,8), Samenbank (−25 %), beides; aufgerundet ohne Rundungsrauschen', () => {
    expect(SEASONS_BY_ID.get('spring')!.sowingCostFactor).toBe(SPRING_SOWING_FACTOR);
    expect(sowingSeasonFactor(SPRING)).toBe(SPRING_SOWING_FACTOR);
    expect(sowingSeasonFactor(SUMMER)).toBe(1);
    expect(sowingCostAt(2, [], SPRING)).toBe(28); // 35 · 0,8
    expect(sowingCostAt(3, [], SPRING)).toBe(49); // ⌈61,25 · 0,8⌉ = ⌈49⌉
    expect(sowingCostAt(2, ['seed-sorting', 'seed-bank'], SUMMER)).toBe(27); // ⌈26,25⌉
    // Beispiel aus content/sowing.ts: 35 · 0,75 · 0,8 = 21 (nicht 22 durch 0,6000000000000001).
    expect(sowingCostAt(2, ['seed-sorting', 'seed-bank'], SPRING)).toBe(21);
    expect(sowingCostAt(0, ['seed-bank'], SPRING)).toBe(0);
  });

  it('Rabatt nie unter SOWING_MIN_COST_FACTOR; kaputte Zähler zählen als 0, riesige als Infinity', () => {
    expect(sowingDiscount([])).toBe(1);
    expect(sowingDiscount(['seed-bank'])).toBe(0.75);
    expect(sowingDiscount(['seed-bank', 'seed-bank', 'nope'])).toBe(0.75); // je Knoten einmal
    expect(SOWING_MIN_COST_FACTOR).toBeGreaterThan(0);
    for (const n of [NaN, -3, -Infinity]) expect(sowingCostAt(n, [], SUMMER), String(n)).toBe(0);
    expect(sowingCostAt(2.9, [], SUMMER)).toBe(35);
    expect(sowingCostAt(5000, [], SUMMER)).toBe(Infinity);
    expect(sowingCostAt(Infinity, [], SUMMER)).toBe(Infinity);
    expect(sowingCostAt(MAX_SOWINGS, [], SUMMER)).toBeGreaterThan(1e40);
  });

  it('sowingCost: Zähler des Zyklus; eine wartende Vogelsaat ist gratis', () => {
    const state = sowable(3);
    expect(sowingCost(state)).toBe(0);
    state.cycle.sowings = 3;
    expect(sowingCost(state)).toBe(62);
    state.cycle.freeSowing = { ids: ['rowan'] };
    expect(sowingCost(state)).toBe(0);
  });
});

describe('Aussaat: säen, wählen, zurücklegen, neu würfeln (27.6)', () => {
  it('sowBlocker: erst ab Keimling, höchstens eine offen, Samen müssen reichen', () => {
    expect(SOWING_MIN_STAGE).toBe(1);
    expect(sowBlocker(sowable(0))).toBe('stage');
    const state = sowable(1, 0);
    expect(sowBlocker(state)).toBeNull(); // die erste ist gratis
    state.cycle.sowings = 1;
    expect(sowBlocker(state)).toBe('too-expensive');
    state.seeds = 19.99;
    expect(sowBlocker(state)).toBe('too-expensive');
    state.seeds = NaN;
    expect(sowBlocker(state)).toBe('too-expensive');
    state.seeds = 20;
    expect(sowBlocker(state)).toBeNull();
    state.cycle.sowing = { cards: ['moss'], rerolls: 0 };
    expect(sowBlocker(state)).toBe('open');
    const before = structuredClone(state);
    expect(sow(state)).toEqual({ ok: false, error: 'open' });
    expect(state).toEqual(before);
  });

  it('sow: Karten stehen sofort fest, Zähler steigt, Preis wird abgezogen', () => {
    const state = sowable(4, 100);
    expect(sow(state)).toEqual({ ok: true, seeds: 0, sowing: true });
    expect(state.cycle.sowings).toBe(1);
    expect(state.seeds).toBe(100);
    const cards = state.cycle.sowing!.cards;
    expect(cards).toHaveLength(CARDS_PER_ENCOUNTER);
    expect(new Set(cards).size).toBe(cards.length);
    for (const id of cards) expect(PLANTS_BY_ID.get(id)!.unlock).toBeLessThanOrEqual(4);
    // Neuladen würfelt nicht neu.
    expect(deserialize(serialize(state), 0)!.cycle.sowing).toEqual(state.cycle.sowing);
    expect(chooseSowing(state, 0).ok).toBe(true);
    expect(sow(state)).toEqual({ ok: true, seeds: -20, sowing: true });
    expect(state.seeds).toBe(80);
    expect(state.cycle.sowings).toBe(2);
    expect(discardSowing(state).ok).toBe(true);
    expect(sowingCost(state)).toBe(35);
  });

  it('Keimling: nur zwei Pflanzen – zwei Karten, Neu würfeln brächte dieselben', () => {
    const state = sowable(1);
    expect(sow(state).ok).toBe(true);
    expect([...state.cycle.sowing!.cards].sort()).toEqual(['anemone', 'moss']);
    expect(rerollSowingBlocker(state)).toBe('no-alternatives');
    expect(rerollSowing(state)).toEqual({ ok: false, error: 'no-alternatives' });
  });

  it('voller Ring: Säen geht trotzdem, die Karte ersetzt eine Pflanze', () => {
    const state = sowable(2);
    state.plants = ['moss', 'anemone'];
    state.cycle.sowings = 2;
    expect(sowBlocker(state)).toBeNull();
    expect(sow(state).ok).toBe(true);
    const card = state.cycle.sowing!.cards.findIndex((id) => id !== 'moss');
    expect(chooseSowing(state, card)).toEqual({ ok: false, error: 'ring-full' });
    const result = chooseSowing(state, card, 'moss');
    expect(result.ok).toBe(true);
    expect(state.plants).toHaveLength(2);
    expect(state.plants).not.toContain('moss');
    expect(state.cycle.sowings).toBe(3);
  });

  it('Zurücklegen: Samen-Sekunden wie Ablehnen, der Zähler bleibt erhöht', () => {
    const state = sowable(3, 50);
    state.cycle.sowings = 1;
    expect(sow(state).ok).toBe(true);
    const reward = declineReward(state);
    const seeds = state.seeds;
    expect(discardSowing(state)).toEqual({ ok: true, seeds: reward });
    expect(state.seeds).toBe(seeds + reward);
    expect(state.cycle.sowing).toBeNull();
    expect(state.cycle.sowings).toBe(2);
    expect(state.plants).toEqual([]);
    expect(discardSowing(state)).toEqual({ ok: false, error: 'no-sowing' });
  });

  it('Neu würfeln: 10 · 2^Würfe, andere Karten; Anzuchtbeet macht den ersten Wurf gratis', () => {
    const state = sowable(4, 100);
    expect(rerollSowing(state)).toEqual({ ok: false, error: 'no-sowing' });
    sow(state);
    const first = [...state.cycle.sowing!.cards];
    expect(sowingRerollCost(state)).toBe(REROLL_BASE_COST);
    expect(rerollSowing(state)).toEqual({ ok: true, seeds: -10 });
    expect(state.seeds).toBe(90);
    for (const id of state.cycle.sowing!.cards) expect(first).not.toContain(id);
    expect(sowingRerollCost(state)).toBe(20);
    state.seeds = 19;
    expect(rerollSowingBlocker(state)).toBe('too-expensive');
    const nursery = sowable(4, 0);
    nursery.cycle.research = ['seed-sorting', 'nursery'];
    sow(nursery);
    expect(sowingRerollCost(nursery)).toBe(0);
    expect(rerollSowing(nursery)).toEqual({ ok: true, seeds: 0 });
    expect(sowingRerollCost(nursery)).toBe(REROLL_BASE_COST);
    expect(rerollSowingBlocker(nursery)).toBe('too-expensive');
  });

  it('Saatgut sortieren: vier Karten (höchstens MAX_SOWING_CARDS), auch beim Neu würfeln', () => {
    expect(sowingCardCount([])).toBe(CARDS_PER_ENCOUNTER);
    expect(sowingCardCount(['seed-sorting'])).toBe(4);
    expect(MAX_SOWING_CARDS).toBe(4);
    const state = sowable(4, 100);
    state.cycle.research = ['seed-sorting'];
    sow(state);
    expect(state.cycle.sowing!.cards).toHaveLength(4);
    rerollSowing(state);
    expect(state.cycle.sowing!.cards).toHaveLength(4);
    expect(new Set(state.cycle.sowing!.cards).size).toBe(4);
  });

  it('Tagesziel und Statistik zählen das Setzen, nicht das Säen', () => {
    const state = sowable(3);
    state.meta.daily.goals = [{ kind: 'plant', target: 1, progress: 0, reward: 'seeds', done: false }];
    sow(state);
    expect(state.meta.daily.goals[0]!.progress).toBe(0);
    expect(chooseSowing(state, 0).ok).toBe(true);
    expect(state.meta.daily.goals[0]!.progress).toBe(1);
    expect(state.meta.stats.plantsPlanted).toBe(1);
    expect(state.meta.stats.cardsChosen).toBe(0);
  });

  it('Neuer Zyklus: Zähler, offene und wartende Aussaat beginnen neu', () => {
    const state = sowable(5);
    state.cycle.sowings = 9;
    state.cycle.sowing = { cards: ['hazel'], rerolls: 1 };
    state.cycle.freeSowing = { ids: ['rowan'] };
    expect(startNewCycle(state, 0).ok).toBe(true);
    expect(state.cycle.sowings).toBe(0);
    expect(state.cycle.sowing).toBeNull();
    expect(state.cycle.freeSowing).toBeNull();
  });
});

describe('Begegnungen nur mit Tieren (27.5)', () => {
  it('Gewichte ohne Pflanzenspalte: Tier, Ereignis, Gast', () => {
    expect(ENCOUNTER_TYPES).toEqual(['animal', 'event', 'visitor']);
    expect(ENCOUNTER_WEIGHTS.map((w) => w.join(':'))).toEqual([
      '100:0:0',
      '100:0:0',
      '100:0:0',
      '90:10:0',
      '80:10:10',
      '80:10:10',
      '80:10:10',
      '80:10:10',
    ]);
    expect(SCRIPTED_ENCOUNTERS).toEqual(['animal', 'sowing', 'animal']);
  });

  it('Wegpunkt 2 öffnet die geschenkte erste Aussaat – keine Begegnung', () => {
    const state = createInitialState(0, 7);
    const one = tickToGrowth(state, thresholdFor(1));
    expect(one.encounters).toBe(1);
    expect(state.pendingEncounters[0]!.type).toBe('animal');
    const two = tickToGrowth(state, thresholdFor(2));
    expect(two.waypoints).toBe(1);
    expect(two.sowings).toBe(1);
    expect(two.encounters).toBe(0);
    expect(state.pendingEncounters).toHaveLength(1);
    expect(state.cycle.sowings).toBe(1);
    expect(state.cycle.sowing!.cards.length).toBeGreaterThan(0);
    expect(state.seeds).toBeGreaterThanOrEqual(0);
  });

  it('Wegpunkt 2 nach eigener erster Aussaat: ein Tier statt des Geschenks', () => {
    const state = createInitialState(0, 7);
    tickToGrowth(state, thresholdFor(1));
    expect(sow(state)).toEqual({ ok: true, seeds: 0, sowing: true });
    expect(chooseSowing(state, 0).ok).toBe(true);
    const two = tickToGrowth(state, thresholdFor(2));
    expect(two.sowings).toBe(0);
    expect(two.encounters).toBe(1);
    expect(state.pendingEncounters.map((e) => e.type)).toEqual(['animal', 'animal']);
    expect(state.cycle.sowing).toBeNull();
    expect(state.cycle.sowings).toBe(1);
  });

  it('Wegpunkt 2 mit offener Aussaat: kein zweites Geschenk, ein Tier', () => {
    const state = createInitialState(0, 7);
    tickToGrowth(state, thresholdFor(1));
    state.cycle.sowing = { cards: ['moss'], rerolls: 0 }; // offen (z. B. aus einem alten Stand)
    const two = tickToGrowth(state, thresholdFor(2));
    expect(two.sowings).toBe(0);
    expect(two.encounters).toBe(1);
    expect(state.cycle.sowing).toEqual({ cards: ['moss'], rerolls: 0 });
  });

  it('volle Warteschlange: das Geschenk kommt trotzdem (es ist keine Begegnung)', () => {
    const state = createInitialState(0, 7);
    tickToGrowth(state, thresholdFor(1));
    state.pendingEncounters.push({ type: 'animal', cards: ['earthworm'], rerolls: 0 }, { type: 'animal', cards: ['woodlouse'], rerolls: 0 });
    const two = tickToGrowth(state, thresholdFor(2));
    expect(two.sowings).toBe(1);
    expect(two.autoDeclined).toBe(0);
    expect(state.pendingEncounters).toHaveLength(3);
  });

  it('bis zum Urwald zieht das Deck nie eine Pflanzenbegegnung', () => {
    const state = createInitialState(0, 3);
    const types = new Set<string>();
    for (let k = 1; k <= 36; k++) {
      tickToGrowth(state, thresholdFor(k));
      for (const e of state.pendingEncounters) types.add(e.type);
      state.pendingEncounters = [];
      state.cycle.sowing = null;
    }
    expect(state.stage).toBe(7);
    expect([...types].every((t) => t === 'animal' || t === 'event' || t === 'visitor')).toBe(true);
    expect(types.has('animal')).toBe(true);
  });

  it('online gleich offline: Geschenk an Wegpunkt 2 und alles danach', () => {
    const online = createInitialState(0, 11);
    const offline = structuredClone(online);
    for (let i = 0; i < 400; i++) tick(online, 1, 'average');
    tick(offline, 400, 'average');
    expect(online.waypoint).toBeGreaterThanOrEqual(3);
    expect(offline.cycle.sowing).toEqual(online.cycle.sowing);
    expect(offline.cycle.sowings).toBe(online.cycle.sowings);
    expect(offline.pendingEncounters).toEqual(online.pendingEncounters);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.seeds).toBeCloseTo(online.seeds, 6);
    const viaOffline = createInitialState(0, 11);
    simulateOffline(viaOffline, 400);
    expect(viaOffline.cycle.sowing).toEqual(online.cycle.sowing);
  });
});

describe('Vogelsaat: geschenkte Aussaat (27.5)', () => {
  const birdSown = EVENTS_BY_ID.get('bird-sown')!;
  const ids = ['rowan', 'elder', 'bramble'];

  it('Inhalt: Vogelsaat schenkt eine Aussaat; kein Ereignis gibt mehr Pflanzenbegegnungen vor', () => {
    expect(birdSown.options[0]!.effects).toEqual([{ kind: 'freeSowing', ids }]);
    expect(birdSown.options[0]!.summary).toBe('eine Aussaat gratis – Eberesche, Holunder oder Brombeere');
    for (const e of EVENTS) {
      for (const o of e.options) for (const x of o.effects) if (x.kind === 'nextEncounter') expect(x.type, e.id).toBe('animal');
    }
  });

  function withBirdSown(stage = 4): GameState {
    const state = sowable(stage, 0);
    state.cycle.sowings = 5;
    state.pendingEncounters.push({ type: 'event', cards: ['bird-sown'], rerolls: 0 });
    state.cycle.seen.push('bird-sown');
    return state;
  }

  it('freie Hand: die Aussaat öffnet sofort, gratis, ohne Zähler – bis zu zwei Vorgaben', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = withBirdSown();
      state.rngState = seed;
      expect(chooseEventOption(state, 0, 0)).toMatchObject({ ok: true, sowing: true });
      const cards = state.cycle.sowing!.cards;
      expect(cards).toHaveLength(CARDS_PER_ENCOUNTER);
      const forced = cards.filter((id) => ids.includes(id));
      expect(forced.length).toBeGreaterThanOrEqual(1);
      expect(cards.slice(0, FORCED_MAX_CARDS).every((id) => ids.includes(id))).toBe(true);
      expect(new Set(cards).size).toBe(cards.length);
      expect(state.cycle.sowings).toBe(5);
      expect(state.cycle.freeSowing).toBeNull();
      expect(state.seeds).toBeGreaterThanOrEqual(0);
    }
  });

  it('offene Aussaat: die Vogelsaat wartet und öffnet nach Wahl bzw. Zurücklegen', () => {
    const state = withBirdSown();
    state.cycle.sowing = { cards: ['hazel'], rerolls: 0 };
    const result = chooseEventOption(state, 0, 0);
    expect(result.ok && result.sowing).toBeFalsy();
    expect(state.cycle.freeSowing).toEqual({ ids });
    expect(sowingCost(state)).toBe(0);
    expect(chooseSowing(state, 0)).toMatchObject({ ok: true, planted: 'hazel', sowing: true });
    expect(state.cycle.freeSowing).toBeNull();
    expect(state.cycle.sowing!.cards.some((id) => ids.includes(id))).toBe(true);
    // Wartet sie beim Zurücklegen, öffnet sie ebenso.
    const other = withBirdSown();
    other.cycle.sowing = { cards: ['hazel'], rerolls: 0 };
    chooseEventOption(other, 0, 0);
    expect(discardSowing(other)).toMatchObject({ ok: true, sowing: true });
    expect(other.cycle.sowing).not.toBeNull();
  });

  it('wartende Vogelsaat (z. B. aus einem alten Stand) öffnet „Säen“ gratis, ohne Zähler', () => {
    const state = sowable(4, 0);
    state.cycle.sowings = 4;
    state.cycle.freeSowing = { ids };
    expect(sowBlocker(state)).toBeNull();
    expect(sow(state)).toEqual({ ok: true, seeds: 0, sowing: true });
    expect(state.cycle.sowings).toBe(4);
    expect(state.cycle.freeSowing).toBeNull();
    expect(state.cycle.sowing!.cards.some((id) => ids.includes(id))).toBe(true);
  });

  it('passt keine Vorgabe (Stufe zu niedrig für alle), wird normal gezogen', () => {
    const state = sowable(2, 0);
    state.cycle.freeSowing = { ids: ['rowan', 'elder'] }; // beide erst ab Junger Baum
    expect(sow(state).ok).toBe(true);
    for (const id of state.cycle.sowing!.cards) expect(PLANTS_BY_ID.get(id)!.unlock).toBeLessThanOrEqual(2);
  });
});

describe('Laden: „Etwas keimt“ → Aussaat (27.9 Schritt 4)', () => {
  /** Stand als JSON mit Änderungen, optional als v16 (ohne v17-Felder). */
  function raw(state: GameState, version: 16 | 17, patch: (d: any) => void): string {
    const d = JSON.parse(serialize(state));
    if (version === 16) {
      d.version = 16;
      delete d.harmonyPoints;
      delete d.cycle.research;
      delete d.cycle.sowings;
      delete d.cycle.sowing;
      delete d.cycle.freeSowing;
      delete d.meta.research;
      delete d.meta.stats.harmonyEarned;
      d.cycle.care = {};
    }
    patch(d);
    return JSON.stringify(d);
  }

  for (const version of [16, 17] as const) {
    it(`v${version}: erste Pflanzenbegegnung wird die offene Aussaat, weitere ziehen weiter (Samen)`, () => {
      const state = stateAt(4, ['earthworm'], 1);
      state.plants = ['hazel'];
      state.seeds = 10;
      const loaded = loadGame(
        raw(state, version, (d) => {
          d.pendingEncounters = [
            { type: 'plant', cards: ['nettle', 'nope', 'beech'], rerolls: 2 },
            { type: 'animal', cards: ['bluetit'], rerolls: 0 },
            { type: 'plant', cards: ['fern'], rerolls: 0 },
          ];
        }),
        0,
      )!.state;
      expect(loaded.cycle.sowing).toEqual({ cards: ['nettle', 'beech'], rerolls: 2 });
      expect(loaded.pendingEncounters).toEqual([{ type: 'animal', cards: ['bluetit'], rerolls: 0 }]);
      expect(loaded.seeds).toBeCloseTo(10 + declineReward(loaded), 9);
      // Der Zähler bleibt: v16 zählt die Begleitpflanzen, v17 den gespeicherten Wert.
      expect(loaded.cycle.sowings).toBe(version === 16 ? 1 : state.cycle.sowings);
      // Zweites Laden ändert nichts.
      expect(deserialize(serialize(loaded), 0)).toEqual(loaded);
    });

    it(`v${version}: Vorgabe „Pflanze“ wird eine wartende Vogelsaat (nur mit gezogenem Ereignis)`, () => {
      const state = stateAt(4, ['earthworm'], 1);
      const seen = loadGame(
        raw(state, version, (d) => {
          d.cycle.seen = ['bird-sown'];
          d.cycle.forced = { type: 'plant', ids: ['rowan', 'nope', 'elder'] };
        }),
        0,
      )!.state;
      expect(seen.cycle.forced).toBeNull();
      expect(seen.cycle.freeSowing).toEqual({ ids: ['rowan', 'elder'] });
      expect(deserialize(serialize(seen), 0)).toEqual(seen);
      const unseen = loadGame(raw(state, version, (d) => (d.cycle.forced = { type: 'plant', ids: ['rowan'] })), 0)!.state;
      expect(unseen.cycle.forced).toBeNull();
      expect(unseen.cycle.freeSowing).toBeNull();
      // Tier-Vorgaben bleiben.
      const animal = loadGame(raw(state, version, (d) => (d.cycle.forced = { type: 'animal', ids: ['owl', 'fox'] })), 0)!.state;
      expect(animal.cycle.forced).toEqual({ type: 'animal', ids: ['owl', 'fox'] });
    });
  }

  it('v17 mit offener Aussaat: jede Pflanzenbegegnung zieht weiter', () => {
    const state = stateAt(4, ['earthworm'], 1);
    state.cycle.sowing = { cards: ['hazel'], rerolls: 0 };
    const loaded = loadGame(
      raw(state, 17, (d) => (d.pendingEncounters = [{ type: 'plant', cards: ['fern'], rerolls: 0 }])),
      0,
    )!.state;
    expect(loaded.cycle.sowing).toEqual({ cards: ['hazel'], rerolls: 0 });
    expect(loaded.pendingEncounters).toEqual([]);
    expect(loaded.seeds).toBeCloseTo(declineReward(loaded), 9);
  });

  it('kaputte Pflanzenbegegnungen: ohne gültige Karte fällt sie weg, höchstens drei Begegnungen insgesamt', () => {
    const state = stateAt(2, ['earthworm'], 1);
    const loaded = loadGame(
      raw(state, 16, (d) => {
        d.pendingEncounters = [
          { type: 'plant', cards: ['rowan', 7, null] }, // Eberesche erst ab Junger Baum
          { type: 'plant', cards: 'moss' },
          { type: 'animal', cards: ['earthworm'] },
          { type: 'plant', cards: ['moss'], rerolls: NaN },
          { type: 'animal', cards: ['woodlouse'] },
          { type: 'animal', cards: ['slug'] },
        ];
      }),
      0,
    )!.state;
    expect(loaded.cycle.sowing).toEqual({ cards: ['moss'], rerolls: 0 });
    expect(loaded.pendingEncounters.map((e) => e.cards[0])).toEqual(['earthworm', 'woodlouse']);
    expect(Number.isFinite(loaded.seeds)).toBe(true);
    expect(evaluate(loaded).seeds).toBeGreaterThan(0);
  });
});
