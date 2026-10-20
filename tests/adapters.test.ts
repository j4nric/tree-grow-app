import { describe, expect, it } from 'vitest';
import { DECLINE_SEEDS, REROLL_BASE_COST } from '../src/content/encounters';
import { SPECIES_BY_ID } from '../src/content/species';
import { evaluate, previewChoice } from '../src/core/formulas';
import {
  effectView,
  encounterTitle,
  harmonyTier,
  moodText,
  refreshEcosystemView,
  toEcosystemView,
  toEncounterView,
} from '../src/ui/adapters';
import { fakeSpecies, stateAt, withFakeSpecies } from './helpers';

/** Junger Baum (Krone 2, Laubstreu 2 Plätze) mit einer offenen Begegnung. */
function withEncounter(animals: string[], cards: string[], seed = 1) {
  const state = stateAt(3, animals, seed);
  state.pendingEncounters.push({ type: 'animal', cards, rerolls: 0 });
  return state;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('toEcosystemView', () => {
  it('Startzustand: Stufe Samen, alle Nischen verschlossen mit Hinweis, Gattungen leer', () => {
    const state = stateAt(0);
    const view = toEcosystemView(state, evaluate(state));
    expect(view.stageName).toBe('Samen');
    expect(view.niches.map((n) => n.id)).toEqual(['roots', 'litter', 'edge', 'crown', 'bark', 'hollows']);
    expect(view.niches.every((n) => n.capacity === 0 && n.animals.length === 0)).toBe(true);
    expect(view.niches[0]!.unlockHint).toBe('öffnet bei „Keimling“');
    expect(view.niches[3]!.unlockHint).toBe('öffnet bei „Junger Baum“');
    // Höhlen haben im Prototyp noch keine Bewohner-Art
    expect(view.niches[5]!.unlockHint).toBe('Bewohner folgen bald');
    expect(view.families.map((f) => [f.id, f.icon, f.count])).toEqual([
      ['birds', '🐦', 0],
      ['insects', '🐝', 0],
      ['soil', '🪱', 0],
    ]);
    expect(view.families[0]!.thresholds).toEqual([2, 3, 5]);
    expect(view.families[2]!.bonuses[0]).toBe('+2 Wasser');
    expect(view.harmonyTier).toBe('Zarte Anfänge');
    expect(view.progressHint).toMatch(/^Nächste Begegnung in /);
  });

  it('übernimmt Zahlen und Tiere aus der Auswertung', () => {
    const state = stateAt(3, ['earthworm', 'bluetit', 'oakmoth', 'robin']);
    state.seeds = 42;
    const ev = evaluate(state);
    const view = toEcosystemView(state, ev);
    expect(view.stageName).toBe('Junger Baum');
    expect(view.growthPerSec).toBe(ev.growth);
    expect(view.seedsPerSec).toBe(ev.seeds);
    expect(view.seeds).toBe(42);
    expect(view.harmony).toBe(ev.harmony);
    expect(view.harmonyMultiplier).toBe(ev.multiplier);

    const crown = view.niches.find((n) => n.id === 'crown')!;
    expect(crown.capacity).toBe(2);
    expect(crown.animals.map((a) => a.name)).toEqual(['Blaumeise', 'Eichenwickler']);
    expect(crown.animals[0]).toMatchObject({ family: 'birds', familyIcon: '🐦', rarity: 'common' });
    expect(crown.animals[0]!.happiness).toBe(ev.animals.bluetit!.happiness);
    expect(crown.unlockHint).toBeUndefined();

    expect(view.families.find((f) => f.id === 'birds')!.count).toBe(2);
    expect(view.families.find((f) => f.id === 'insects')!.count).toBe(1);
  });

  it('Harmonie-Aufschlüsselung ergibt die Summe, unbewachte Schädlinge als Abzug', () => {
    const state = stateAt(3, ['oakmoth', 'earthworm']);
    const ev = evaluate(state);
    expect(ev.unguarded).toBe(1);
    const parts = toEcosystemView(state, ev).harmonyParts;
    expect(parts.map((p) => p.label)).toEqual(['Vielfalt', 'Zufriedenheit', 'Nahrungspyramide', 'Unbewachte Schädlinge']);
    expect(parts[3]!.value).toBe(-4);
    expect(sum(parts.map((p) => p.value))).toBeCloseTo(ev.harmony, 9);

    const guarded = stateAt(3, ['earthworm']);
    const guardedParts = toEcosystemView(guarded, evaluate(guarded)).harmonyParts;
    expect(guardedParts).toHaveLength(3);
    expect(sum(guardedParts.map((p) => p.value))).toBeCloseTo(evaluate(guarded).harmony, 9);
  });

  it('refreshEcosystemView aktualisiert nur Samen und Fortschritt', () => {
    const state = stateAt(1, ['earthworm']);
    const view = toEcosystemView(state, evaluate(state));
    const progress = view.stageProgress;
    state.seeds = 99;
    state.totalGrowth += 1;
    refreshEcosystemView(view, state);
    expect(view.seeds).toBe(99);
    expect(view.stageProgress).toBeGreaterThan(progress);
  });

  it('verändert den Spielstand nicht', () => {
    const state = withEncounter(['earthworm', 'woodlouse', 'centipede'], ['robin', 'bluetit']);
    const before = JSON.stringify(state);
    toEcosystemView(state, evaluate(state));
    toEncounterView(state, 0);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('Stimmung und Texte', () => {
  it('Stimmung nennt den ersten fehlenden Wunsch, sonst „fühlt sich wohl“', () => {
    const lonely = stateAt(3, ['bluetit']);
    const ev = evaluate(lonely);
    expect(moodText(SPECIES_BY_ID.get('bluetit')!, ev.animals.bluetit)).toBe('sucht Futter');

    const worm = stateAt(1, ['earthworm']);
    // Wurzelraum am Keimling: Laub ja, Feuchte nein
    expect(moodText(SPECIES_BY_ID.get('earthworm')!, evaluate(worm).animals.earthworm)).toBe('wünscht sich Feuchte');

    const moth = stateAt(3, ['oakmoth']);
    expect(moodText(SPECIES_BY_ID.get('oakmoth')!, evaluate(moth).animals.oakmoth)).toBe('fühlt sich wohl');
  });

  it('Wirkungen: Fraß ist schlecht, Jagd und Boni sind gut', () => {
    expect(effectView({ kind: 'damage', pct: 10 })).toEqual({ label: 'Fraß −10 % 🌿', tone: 'bad' });
    expect(effectView({ kind: 'growth', pct: 8 })).toEqual({ label: '+8 % 🌿', tone: 'good' });
    expect(effectView({ kind: 'control', tag: 'raupen', pct: 50 })).toEqual({
      label: 'jagt Raupen (−50 % Fraß)',
      tone: 'good',
    });
    expect(effectView({ kind: 'groupSeeds', group: 'flowers', pct: 40 }).label).toBe('Blumen +40 % 🌰');
    expect(effectView({ kind: 'water', amount: 2 }).label).toBe('+2 💧');
    expect(effectView({ kind: 'slot', niche: 'hollows', amount: 1 })).toEqual({
      label: '+1 Platz Höhlen & Totholz',
      tone: 'good',
    });
  });

  it('Harmoniestufen nach Design (9.1)', () => {
    expect(harmonyTier(0)).toBe('Zarte Anfänge');
    expect(harmonyTier(30)).toBe('Lebendiges Gefüge');
    expect(harmonyTier(89.9)).toBe('Stimmiges Ökosystem');
    expect(harmonyTier(90)).toBe('Blühender Mischwald');
    expect(harmonyTier(150)).toBe('Urwald');
    expect(harmonyTier(Number.NaN)).toBe('Zarte Anfänge');
  });

  it('Überschrift nach Nische, gemischt allgemein', () => {
    expect(encounterTitle(['crown', 'crown'])).toBe('Etwas regt sich in der Krone …');
    expect(encounterTitle(['roots'])).toBe('Etwas regt sich in der Erde …');
    expect(encounterTitle(['crown', 'bark'])).toMatch(/am Baum/);
  });
});

describe('toEncounterView', () => {
  it('freie Karte: Gattung, Seltenheit, Nische, Vorschau aus previewChoice', () => {
    const state = withEncounter(['earthworm'], ['bluetit', 'oakmoth']);
    const now = evaluate(state);
    const view = toEncounterView(state, 0)!;
    expect(view.kind).toBe('animal');
    expect(view.title).toBe('Etwas regt sich in der Krone …');
    expect(view.cards).toHaveLength(2);

    const moth = view.cards[1]!;
    expect(moth).toMatchObject({
      id: 'oakmoth',
      name: 'Eichenwickler',
      family: 'insects',
      familyLabel: 'Insekten',
      familyIcon: '🐝',
      rarity: 'common',
      niche: 'crown',
      nicheLabel: '🌳 Krone',
    });
    expect(moth.nicheFull).toBeUndefined();
    expect(moth.disabledReason).toBeUndefined();
    expect(moth.flavor).toBe(SPECIES_BY_ID.get('oakmoth')!.text);

    const after = previewChoice(state, 0, 1)!;
    expect(moth.preview.harmonyDelta).toBeCloseTo(after.harmony - now.harmony, 9);
    expect(moth.preview.growthDelta).toBeCloseTo(after.growth / now.growth - 1, 9);
    expect(moth.preview.seedDelta).toBeCloseTo(after.seeds / now.seeds - 1, 9);
    expect(moth.preview.happiness).toBe(after.animals.oakmoth!.happiness);
    expect(moth.effects.some((e) => e.tone === 'bad' && e.label.startsWith('Fraß'))).toBe(true);
    expect(moth.effects.some((e) => e.label === 'bietet Insekten, Raupen')).toBe(true);
  });

  it('Bedingungen ✓/✗ folgen dem Zustand nach dem Einzug', () => {
    const state = withEncounter([], ['bluetit']);
    const card = toEncounterView(state, 0)!.cards[0]!;
    // Blaumeise ohne Raupen, mit nur einem Baum und ohne Baumhöhle
    expect(card.conditions).toEqual([
      { label: '🍽 Raupen / Insekten', met: false },
      { label: '🌳 2× Bäume', met: false },
      { label: '🕳️ Baumhöhle', met: false },
    ]);

    const withFood = withEncounter(['oakmoth'], ['bluetit']);
    const fed = toEncounterView(withFood, 0)!.cards[0]!;
    expect(fed.conditions![0]).toEqual({ label: '🍽 Raupen / Insekten', met: true });
  });

  it('volle Nische: Ersetzen-Optionen mit eigener Vorschau', () => {
    const state = withEncounter(['woodlouse', 'centipede'], ['robin']);
    const now = evaluate(state);
    const card = toEncounterView(state, 0)!.cards[0]!;
    expect(card.nicheFull).toBe(true);
    expect(card.disabledReason).toBeUndefined();
    expect(card.replaceOptions!.map((o) => [o.id, o.name])).toEqual([
      ['woodlouse', 'Rollassel'],
      ['centipede', 'Steinläufer'],
    ]);
    for (const option of card.replaceOptions!) {
      const after = previewChoice(state, 0, 0, option.id)!;
      expect(option.preview!.harmonyDelta).toBeCloseTo(after.harmony - now.harmony, 9);
      expect(option.preview!.happiness).toBe(after.animals.robin!.happiness);
    }
    expect(card.preview).toEqual(card.replaceOptions![0]!.preview);
  });

  it('gesperrte Karten: schon im Ökosystem, Nische verschlossen', () => {
    const present = withEncounter(['bluetit'], ['bluetit', 'oakmoth']);
    expect(toEncounterView(present, 0)!.cards[0]!.disabledReason).toBe('Schon im Ökosystem');
    expect(toEncounterView(present, 0)!.cards[1]!.disabledReason).toBeUndefined();

    const closed = stateAt(1);
    closed.pendingEncounters.push({ type: 'animal', cards: ['bluetit', 'earthworm'], rerolls: 0 });
    const cards = toEncounterView(closed, 0)!.cards;
    expect(cards[0]!.disabledReason).toBe('Nische noch verschlossen');
    expect(cards[0]!.preview).toEqual({ harmonyDelta: 0, growthDelta: 0 });
    expect(cards[1]!.disabledReason).toBeUndefined();
  });

  it('unbekannte Art bleibt als gesperrte Karte stehen (Indizes passen zum Kern)', () => {
    const state = withEncounter([], ['dodo', 'oakmoth']);
    const cards = toEncounterView(state, 0)!.cards;
    expect(cards).toHaveLength(2);
    expect(cards[0]!.disabledReason).toBeDefined();
    expect(cards[1]!.id).toBe('oakmoth');
  });

  it('Neu würfeln und Ablehnen: Kosten, Samen reichen?', () => {
    const state = withEncounter([], ['bluetit']);
    state.seeds = REROLL_BASE_COST - 1;
    let view = toEncounterView(state, 0)!;
    expect(view.rerollCost).toBe(REROLL_BASE_COST);
    expect(view.canReroll).toBe(false);
    expect(view.rerollDisabledReason).toBe('Nicht genug Samen');
    expect(view.declineReward).toBe(DECLINE_SEEDS);

    state.seeds = REROLL_BASE_COST;
    expect(toEncounterView(state, 0)!.canReroll).toBe(true);

    state.pendingEncounters[0]!.rerolls = 1;
    view = toEncounterView(state, 0)!;
    expect(view.rerollCost).toBe(REROLL_BASE_COST * 2);
    expect(view.canReroll).toBe(false);
  });

  it('Höhlen: ohne Bewohner-Art verschlossen, mit Bewohner Plätze aus dem Borkenkäfer', () => {
    const empty = stateAt(3, ['barkbeetle']);
    const locked = toEcosystemView(empty, evaluate(empty)).niches.find((n) => n.id === 'hollows')!;
    expect(locked.capacity).toBe(0);
    expect(locked.unlockHint).toBe('Bewohner folgen bald');

    withFakeSpecies([fakeSpecies({ id: 'test-owl', niche: 'hollows' })], () => {
      const state = stateAt(3, ['barkbeetle', 'test-owl']);
      const hollows = toEcosystemView(state, evaluate(state)).niches.find((n) => n.id === 'hollows')!;
      expect(hollows.capacity).toBe(1);
      expect(hollows.animals.map((a) => a.id)).toEqual(['test-owl']);
      expect(hollows.unlockHint).toBeUndefined();
    });
  });

  it('Tausch, der einen Höhlenbewohner ohne Platz ließe, ist gesperrt', () => {
    const owl = fakeSpecies({ id: 'test-owl', niche: 'hollows' });
    const bark = fakeSpecies({ id: 'test-bark', niche: 'bark', name: 'Testrinde' });
    withFakeSpecies([owl, bark], () => {
      const state = stateAt(3, ['barkbeetle', 'test-owl']);
      state.pendingEncounters.push({ type: 'animal', cards: ['test-bark'], rerolls: 0 });
      const card = toEncounterView(state, 0)!.cards[0]!;
      expect(card.nicheFull).toBe(true);
      expect(card.replaceOptions).toEqual([
        { id: 'barkbeetle', name: 'Borkenkäfer', disabledReason: 'Höhlenbewohner verlören ihren Platz' },
      ]);
      expect(card.disabledReason).toBe('Kein Tausch möglich');
    });
  });

  it('Neu würfeln gesperrt mit Grund, wenn keine anderen Tiere in Frage kommen', () => {
    const state = stateAt(1);
    state.seeds = 1000;
    state.pendingEncounters.push({ type: 'animal', cards: ['earthworm'], rerolls: 0 });
    const view = toEncounterView(state, 0)!;
    expect(view.canReroll).toBe(false);
    expect(view.rerollDisabledReason).toBe('Keine anderen Tiere verfügbar');
  });

  it('gibt null für fehlende Begegnungen', () => {
    expect(toEncounterView(stateAt(3), 0)).toBeNull();
  });
});
