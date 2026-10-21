import { describe, expect, it } from 'vitest';
import { EVENTS_BY_ID } from '../src/content/events';
import { VISITORS_BY_ID } from '../src/content/visitors';
import { seedSeconds } from '../src/core/formulas';
import { chooseEventOption, hostVisitor } from '../src/core/tick';
import {
  UNTIL_NEW_CYCLE,
  activeBonusViews,
  bonusEffectLabel,
  encounterActionKey,
  remainingLabel,
  seedsLabel,
  toEncounterView,
  toEventView,
  toSceneVisitors,
  toVisitorView,
} from '../src/ui/adapters';
import { stateAt } from './helpers';

describe('View: Ereignis', () => {
  it('Titel, Stimmungstext, je Option eine Karte mit Knopftext und konkreten Samen', () => {
    const state = stateAt(4, ['earthworm', 'bee'], 1);
    state.pendingEncounters = [{ type: 'event', cards: ['storm'], rerolls: 0 }];
    const before = structuredClone(state);
    const view = toEventView(state, 0)!;
    const storm = EVENTS_BY_ID.get('storm')!;
    expect(view.kind).toBe('event');
    expect(view.title).toBe(`${storm.icon} ${storm.name}`);
    expect(view.subtitle).toBe(storm.text);
    expect(view.rerollCost).toBeNull();
    expect(view.declineReward).toBeNull();
    expect(view.cards.map((c) => c.chooseLabel)).toEqual(storm.options.map((o) => o.label));
    const seeds = seedSeconds(state, 120);
    expect(view.cards[1]!.effects.map((e) => e.label)).toContain(`+${seedsLabel(seeds)} 🌰 sofort`);
    // Totholz + Platz: Vorschau zeigt die echte Wirkung (Harmonie ändert sich nicht negativ).
    expect(view.cards[0]!.preview.harmonyDelta).toBeGreaterThanOrEqual(0);
    // Die Ansicht ändert den Spielstand nicht (Vorschau auf einer Kopie).
    expect(state).toEqual(before);
    expect(toEncounterView(state, 0)).toEqual(view);
  });

  it('Vorschau einer Zeit-Option: mehr Wachstum', () => {
    const state = stateAt(4, ['earthworm'], 1);
    state.pendingEncounters = [{ type: 'event', cards: ['midsummer'], rerolls: 0 }];
    const view = toEventView(state, 0)!;
    expect(view.cards[0]!.preview.growthDelta).toBeGreaterThan(0.2);
    expect(view.cards[1]!.preview.seedDelta).toBeGreaterThan(0.4);
  });

  it('unbekannt oder falscher Typ: null', () => {
    const state = stateAt(4, [], 1);
    state.pendingEncounters = [{ type: 'event', cards: ['nope'], rerolls: 0 }];
    expect(toEventView(state, 0)).toBeNull();
    expect(toEventView(state, 3)).toBeNull();
    state.pendingEncounters = [{ type: 'animal', cards: ['earthworm'], rerolls: 0 }];
    expect(toEventView(state, 0)).toBeNull();
    expect(toVisitorView(state, 0)).toBeNull();
  });
});

describe('View: Durchreisende', () => {
  it('„Bewirten (−X 🌰)“ und „Ziehen lassen (+Y 🌰)“ mit Samen zur aktuellen Rate', () => {
    const state = stateAt(4, ['earthworm', 'robin'], 1);
    state.pendingEncounters = [{ type: 'visitor', cards: ['cranes'], rerolls: 0 }];
    const host = seedSeconds(state, VISITORS_BY_ID.get('cranes')!.hostCost);
    const thanks = seedSeconds(state, VISITORS_BY_ID.get('cranes')!.farewellSeeds);
    let view = toVisitorView(state, 0)!;
    expect(view.kind).toBe('visitor');
    expect(view.subtitle).toBe(VISITORS_BY_ID.get('cranes')!.text);
    expect(view.cards.map((c) => c.chooseLabel)).toEqual([
      `Bewirten (−${seedsLabel(host)} 🌰)`,
      `Ziehen lassen (+${seedsLabel(thanks)} 🌰)`,
    ]);
    expect(view.cards[0]!.disabledReason).toContain('Nicht genug Samen');
    expect(view.cards[1]!.disabledReason).toBeUndefined();
    state.seeds = host;
    view = toVisitorView(state, 0)!;
    expect(view.cards[0]!.disabledReason).toBeUndefined();
    expect(view.cards[0]!.preview.seedDelta).toBeGreaterThan(0.2);
  });

  it('Samen-Beschriftung: ganze Zahlen ab 10, sonst eine Nachkommastelle', () => {
    expect(seedsLabel(5)).toBe('5');
    expect(seedsLabel(7.25)).toBe('7,3');
    expect(seedsLabel(1234.4)).toBe('1.234');
  });
});

describe('View: aktive Boni und Szene', () => {
  it('Zeit-Boni und Gäste mit Restzeit (kürzeste zuerst), dann Zyklus-Boni und Habitate', () => {
    const state = stateAt(5, ['earthworm', 'woodant'], 1);
    state.seeds = 1e6;
    state.pendingEncounters = [
      { type: 'event', cards: ['midsummer'], rerolls: 0 },
      { type: 'visitor', cards: ['peregrine'], rerolls: 0 },
      { type: 'event', cards: ['storm'], rerolls: 0 },
    ];
    chooseEventOption(state, 0, 0); // +30 % 🌿 für 6 min
    hostVisitor(state, 0); // 10 min
    chooseEventOption(state, 0, 0); // Totholz, +1 Platz
    const views = activeBonusViews(state);
    expect(views.map((v) => v.name)).toEqual(['Mittsommer', 'Wanderfalke', 'Sturmnacht', 'Totholz']);
    expect(views[0]).toMatchObject({ icon: '☀️', effect: '+30 % 🌿', remaining: 'noch 6 Min.' });
    expect(views[1]).toMatchObject({ effect: '+6 ⚖️', remaining: 'noch 10 Min.' });
    expect(views[2]).toMatchObject({ effect: '+1 Platz Höhlen & Totholz', remaining: UNTIL_NEW_CYCLE });
    expect(views[3]!.remaining).toBe(UNTIL_NEW_CYCLE);
    expect(toSceneVisitors(state)).toEqual([{ id: 'peregrine', slot: 0 }]);
    expect(activeBonusViews(stateAt(5, [], 1))).toEqual([]);
  });

  it('Kurzformen der Wirkungen', () => {
    expect(bonusEffectLabel({ kind: 'groupSeeds', group: 'flowers', pct: 60 })).toBe('Blumen & Kräuter +60 % 🌰');
    expect(bonusEffectLabel({ kind: 'light', amount: 3 })).toBe('+3 ☀️');
    expect(bonusEffectLabel({ kind: 'water', amount: 3 })).toBe('+3 💧');
    expect(bonusEffectLabel({ kind: 'seeds', pct: 25 })).toBe('+25 % 🌰');
  });
});

describe('View: Review #31', () => {
  it('„Bewirten“ wird frei, wenn die Samen steigen – der Aktions-Schlüssel ändert sich dabei', () => {
    const state = stateAt(4, ['earthworm', 'robin'], 1);
    state.pendingEncounters = [{ type: 'visitor', cards: ['cranes'], rerolls: 0 }];
    const locked = encounterActionKey(state, 0);
    expect(toVisitorView(state, 0)!.cards[0]!.disabledReason).toBeDefined();
    state.seeds += 1e4; // tick bringt Samen – main.ts vergleicht den Schlüssel je Frame
    expect(encounterActionKey(state, 0)).not.toBe(locked);
    expect(toVisitorView(state, 0)!.cards[0]!.disabledReason).toBeUndefined();
    // Tierbegegnung: Neu würfeln bezahlbar oder nicht.
    state.pendingEncounters = [{ type: 'animal', cards: ['vole'], rerolls: 0 }];
    const rich = encounterActionKey(state, 0);
    state.seeds = 0;
    expect(encounterActionKey(state, 0)).not.toBe(rich);
    expect(encounterActionKey(state, 5)).toBe('');
  });

  it('Restzeit auf Minuten aufgerundet, darunter Sekunden; Symbol je Habitat', () => {
    expect(remainingLabel(299)).toBe('noch 5 Min.');
    expect(remainingLabel(240)).toBe('noch 4 Min.');
    expect(remainingLabel(59.2)).toBe('noch 1 Min.'); // 60 Sek. aufgerundet
    expect(remainingLabel(42.3)).toBe('noch 43 Sek.');
    expect(remainingLabel(NaN)).toBe('noch 0 Sek.');
    const state = stateAt(5, [], 1);
    state.cycle.habitats = ['totholz', 'feucht', 'hoehle'];
    expect(activeBonusViews(state).map((v) => v.icon)).toEqual(['🪵', '💧', '🕳️']);
  });
});
