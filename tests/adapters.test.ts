import { describe, expect, it } from 'vitest';
import { DECLINE_SEEDS, REROLL_BASE_COST } from '../src/content/encounters';
import { PLANT_GROUP_INFO, PLANTS_BY_ID } from '../src/content/plants';
import { SPECIES_BY_ID } from '../src/content/species';
import { evaluate, nextPlantCost, previewChoice, previewPlant } from '../src/core/formulas';
import { MAX_OFFLINE_SECONDS, unlockedPlants } from '../src/core/tick';
import { formatDuration, formatNumber } from '../src/ui/format';
import { seedsLine } from '../src/ui/view-format';
import {
  PLANT_BLOCKERS,
  PLANT_ENCOUNTER_TITLE,
  PLANT_REROLL_BLOCKERS,
  effectView,
  encounterTitle,
  harmonyTier,
  listNames,
  plantCostLabel,
  plantProvidesViews,
  shortageHint,
  toPlantPickerView,
  moodText,
  MOOD_REASON_BELOW,
  SCENE_GROUP_OF,
  autoDeclineText,
  foodCompetitors,
  huntersOf,
  disturbersOf,
  refreshEcosystemView,
  toEcosystemView,
  toEncounterView,
  toSceneAnimals,
  toScenePlants,
  welcomeText,
} from '../src/ui/adapters';
import { PLANTS } from '../src/content/plants';
import { SCENE_PLANT_GROUPS } from '../src/render/tree';
import { allAnimals } from '../src/core/state';
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
  it('Stimmung nennt fehlende Wünsche, sonst „fühlt sich wohl“', () => {
    const lonely = stateAt(3, ['bluetit']);
    const ev = evaluate(lonely);
    // Unter 70 %: bis zu zwei Gründe
    expect(ev.animals.bluetit!.happiness).toBeLessThan(MOOD_REASON_BELOW);
    expect(moodText(SPECIES_BY_ID.get('bluetit')!, ev.animals.bluetit)).toBe('sucht Futter · wünscht sich 2× Bäume');

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

describe('welcomeText', () => {
  const report = { seconds: 3600, growth: 1234, seeds: 56, autoDeclined: 0 };

  it('nennt Dauer, Ertrag und wartende Begegnungen', () => {
    expect(welcomeText(3600, report, 2)).toBe(
      'Willkommen zurück! In 1 Std.: +1.234 🌿, +56 🌰, 2 Begegnungen warten.',
    );
    expect(welcomeText(3600, report, 1)).toContain('1 Begegnung wartet');
    expect(welcomeText(3600, report, 0)).toBe('Willkommen zurück! In 1 Std.: +1.234 🌿, +56 🌰.');
  });

  it('nennt die simulierte statt der ungekürzten Abwesenheit', () => {
    const capped = { ...report, seconds: MAX_OFFLINE_SECONDS };
    expect(welcomeText(30 * 3600, capped, 3)).toMatch(/^Willkommen zurück! In 8 Std\. \(max\. 8 Std\.\):/);
  });

  it('nennt automatisch abgelehnte Begegnungen samt Samen', () => {
    const text = welcomeText(3600, { ...report, autoDeclined: 3 }, 3);
    expect(text).toContain(`3 Begegnungen zogen weiter: +${3 * DECLINE_SEEDS} 🌰.`);
    expect(welcomeText(3600, { ...report, autoDeclined: 1 }, 3)).toContain('1 Begegnung zog weiter');
  });

  it('formatDuration lässt „0 Min.“ bei vollen Stunden weg', () => {
    expect(formatDuration(8 * 3600)).toBe('8 Std.');
    expect(formatDuration(3600 + 120)).toBe('1 Std. 2 Min.');
    expect(formatDuration(59)).toBe('59 Sek.');
  });

  it('formatNumber: ab 10.000 ohne Nachkommastellen, ab einer Million abgekürzt', () => {
    expect(formatNumber(12.34)).toBe('12,3');
    expect(formatNumber(119_899.69)).toBe('119.900');
    expect(formatNumber(1_234_567)).toMatch(/^1,23\s+Mio\.$/); // geschütztes Leerzeichen
  });
});

describe('toSceneAnimals', () => {
  it('liefert Art, Gattung, Nische, Platz, Zufriedenheit und Seltenheit für den Renderer', () => {
    const state = stateAt(3, ['earthworm', 'bluetit', 'oakmoth', 'robin']);
    const ev = evaluate(state);
    expect(toSceneAnimals(state, ev)).toEqual([
      { id: 'earthworm', family: 'soil', niche: 'roots', slot: 0, happiness: ev.animals.earthworm!.happiness, rarity: 0 },
      { id: 'robin', family: 'birds', niche: 'litter', slot: 0, happiness: ev.animals.robin!.happiness, rarity: 0 },
      { id: 'bluetit', family: 'birds', niche: 'crown', slot: 0, happiness: ev.animals.bluetit!.happiness, rarity: 0 },
      { id: 'oakmoth', family: 'insects', niche: 'crown', slot: 1, happiness: ev.animals.oakmoth!.happiness, rarity: 0 },
    ]);
    const empty = stateAt(0);
    expect(toSceneAnimals(empty, evaluate(empty))).toEqual([]);
  });

  it('gibt die Seltenheit der Art weiter (selten = 1, auch bei erfundenen Arten)', () => {
    const state = stateAt(4, ['woodpecker', 'centipede']);
    const animals = toSceneAnimals(state, evaluate(state));
    expect(animals.find((a) => a.id === 'woodpecker')?.rarity).toBe(SPECIES_BY_ID.get('woodpecker')!.rarity);
    expect(animals.find((a) => a.id === 'centipede')?.rarity).toBe(1);
    withFakeSpecies([fakeSpecies({ id: 'owl', niche: 'crown', rarity: 3 })], () => {
      const s = stateAt(4, ['owl']);
      expect(toSceneAnimals(s, evaluate(s))).toEqual([expect.objectContaining({ id: 'owl', rarity: 3 })]);
    });
  });
});

describe('toScenePlants', () => {
  it('jede Pflanzengruppe aus content hat eine Gruppe in der Szene', () => {
    for (const plant of PLANTS) expect(SCENE_PLANT_GROUPS).toContain(SCENE_GROUP_OF[plant.group]);
  });

  it('liefert Art, Gruppe, Ring-Index als Platz und Versorgung als Wuchskraft', () => {
    const state = stateAt(3);
    state.plants = ['hazel', 'moss', 'hazel', 'birch'];
    const ev = evaluate(state);
    expect(toScenePlants(state, ev)).toEqual([
      { id: 'hazel', group: 'shrubs', slot: 0, vigor: ev.supply },
      { id: 'moss', group: 'mosses', slot: 1, vigor: ev.supply },
      { id: 'hazel', group: 'shrubs', slot: 2, vigor: ev.supply },
      { id: 'birch', group: 'trees', slot: 3, vigor: ev.supply },
    ]);
  });

  it('Mangel an Licht/Wasser senkt die Wuchskraft aller Pflanzen', () => {
    const state = stateAt(3);
    state.plants = ['birch', 'rowan', 'birch'];
    const ev = evaluate(state);
    expect(ev.supply).toBeLessThan(1);
    const plants = toScenePlants(state, ev);
    expect(plants).toHaveLength(3);
    for (const p of plants) expect(p.vigor).toBeCloseTo(ev.supply, 10);
  });

  it('unbekannte Pflanzen fehlen, die übrigen behalten ihren Platz; leerer Ring → leere Liste', () => {
    const state = stateAt(3);
    state.plants = ['gone', 'fern'];
    expect(toScenePlants(state, evaluate(state))).toEqual([
      { id: 'fern', group: 'mosses', slot: 1, vigor: evaluate(state).supply },
    ]);
    const empty = stateAt(0);
    expect(toScenePlants(empty, evaluate(empty))).toEqual([]);
  });

  it('Wuchskraft bleibt in [0, 1], auch bei kaputten Werten', () => {
    const plants = toScenePlants({ plants: ['hazel'] }, { supply: Number.NaN } as never);
    expect(plants[0]!.vigor).toBe(1);
    expect(toScenePlants({ plants: ['hazel'] }, { supply: 3 } as never)[0]!.vigor).toBe(1);
  });
});

describe('Stimmung: Gründe unter 70 %', () => {
  it('Futterkonkurrenz: nennt, mit wem das Tier das Futter teilt', () => {
    // Laub vom Hauptbaum reicht für 2, hier fressen 4 davon.
    const state = stateAt(3, ['earthworm', 'woodlouse', 'oakmoth', 'barkbeetle']);
    const ev = evaluate(state);
    const moth = SPECIES_BY_ID.get('oakmoth')!;
    const status = ev.animals.oakmoth!;
    expect(status.food).toBeGreaterThan(0);
    expect(status.food).toBeLessThan(1);
    const present = allAnimals(state);
    expect(foodCompetitors(moth, present)).toEqual(['earthworm', 'woodlouse', 'barkbeetle']);
    expect(moodText(moth, status, present)).toBe('teilt sich das Futter mit Regenwurm, Rollassel und 1 weitere');
    // Ohne Liste der Mitbewohner: allgemeiner Grund
    expect(moodText(moth, status)).toBe('findet wenig Futter');
  });

  it('fehlender Wunsch und Futterkonkurrenz: beide Gründe, wenn die Zufriedenheit unter 70 % liegt', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse', 'oakmoth']);
    const ev = evaluate(state);
    const worm = ev.animals.earthworm!;
    expect(worm.happiness).toBeLessThan(MOOD_REASON_BELOW);
    expect(moodText(SPECIES_BY_ID.get('earthworm')!, worm, allAnimals(state))).toBe(
      'wünscht sich Feuchte · teilt sich das Futter mit Rollassel und Eichenwickler',
    );
  });

  it('Räuberdruck: nennt den Jäger unter 70 %', () => {
    const state = stateAt(3, ['oakmoth', 'bluetit']);
    const ev = evaluate(state);
    const moth = SPECIES_BY_ID.get('oakmoth')!;
    expect(ev.animals.oakmoth!.hunters).toBe(1);
    expect(huntersOf(moth, allAnimals(state))).toEqual(['bluetit']);
    // Ab 70 % kurz, darunter mit Namen
    expect(ev.animals.oakmoth!.happiness).toBeGreaterThanOrEqual(MOOD_REASON_BELOW);
    expect(moodText(moth, ev.animals.oakmoth, allAnimals(state))).toBe('ist auf der Hut');
    const low = { ...ev.animals.oakmoth!, happiness: 0.5 };
    expect(moodText(moth, low, allAnimals(state))).toBe('ist auf der Hut vor Blaumeise');
    expect(moodText(moth, low)).toBe('ist auf der Hut');
  });

  it('Störer (ab Schritt 2.2: AnimalStatus.disturbers): „wird gestört von …“', () => {
    const noisy = fakeSpecies({ id: 'jay', name: 'Eichelhäher', niche: 'crown', level: 'herbivore', food: ['nuesse'], effects: [{ kind: 'disturb', target: 'oakmoth' } as never] });
    withFakeSpecies([noisy], () => {
      const moth = SPECIES_BY_ID.get('oakmoth')!;
      const present = ['oakmoth', 'jay', 'bluetit'];
      expect(disturbersOf(moth, present)).toEqual(['jay']);
      const status = { happiness: 0.6, food: 1, needs: [], hunters: 1, disturbers: 1 };
      expect(moodText(moth, status, present)).toBe('wird gestört von Eichelhäher · ist auf der Hut vor Blaumeise');
      expect(moodText(moth, status)).toBe('wird gestört · ist auf der Hut');
      // Ohne das Feld (Stand vor 2.2) bleibt alles wie bisher.
      expect(moodText(moth, { happiness: 0.9, food: 1, needs: [], hunters: 0 }, present)).toBe('fühlt sich wohl');
    });
  });

  it('ab 70 % nur der wichtigste Grund, darunter höchstens zwei', () => {
    const species = SPECIES_BY_ID.get('bluetit')!;
    const status = { happiness: 0.8, food: 0.5, needs: [false, false], hunters: 1 };
    expect(moodText(species, status)).toBe('wünscht sich 2× Bäume');
    expect(moodText(species, { ...status, happiness: 0.3 })).toBe('wünscht sich 2× Bäume · wünscht sich Baumhöhle');
  });

  it('Seitenleiste zeigt die Gründe mit den echten Mitbewohnern', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse', 'oakmoth', 'barkbeetle']);
    const view = toEcosystemView(state, evaluate(state));
    const moth = view.niches.flatMap((n) => n.animals).find((a) => a.id === 'oakmoth')!;
    expect(moth.mood).toContain('teilt sich das Futter mit Regenwurm');
  });

  it('Karte erklärt „(knapp)“ beim Futter', () => {
    const state = withEncounter(['earthworm', 'woodlouse'], ['oakmoth']);
    const card = toEncounterView(state, 0)!.cards[0]!;
    const food = card.conditions![0]!;
    expect(food.label).toContain('(knapp)');
    expect(food.hint).toBe('teilt sich das Futter mit Regenwurm und Rollassel');
    // Reicht das Futter, gibt es keine Erklärung.
    const calm = withEncounter([], ['oakmoth']);
    expect(toEncounterView(calm, 0)!.cards[0]!.conditions![0]!.hint).toBeUndefined();
  });

  it('bei voller Nische zählt das Tier, das weicht, nicht als Konkurrent', () => {
    // Laubstreu voll (Rollassel, Rotkehlchen); eine Laub fressende Test-Art ersetzt die
    // Rollassel (erste Option). Danach teilen sich Regenwurm, Eichenwickler und sie das Laub.
    withFakeSpecies([fakeSpecies({ id: 'slug', name: 'Nacktschnecke', niche: 'litter', food: ['laub'], level: 'herbivore' })], () => {
      const state = withEncounter(['earthworm', 'oakmoth', 'woodlouse', 'robin'], ['slug']);
      const card = toEncounterView(state, 0)!.cards[0]!;
      expect(card.nicheFull).toBe(true);
      expect(card.replaceOptions![0]!.id).toBe('woodlouse');
      expect(card.conditions![0]!.hint).toBe('teilt sich das Futter mit Regenwurm und Eichenwickler');
    });
  });
});

describe('autoDeclineText', () => {
  it('nichts Passendes: „Niemand zog ein“ mit den Samen fürs Ablehnen', () => {
    expect(autoDeclineText(1, false)).toBe(`Niemand zog ein · +${formatNumber(DECLINE_SEEDS)} 🌰`);
    expect(autoDeclineText(2, false)).toBe(`Niemand zog ein · +${formatNumber(2 * DECLINE_SEEDS)} 🌰`);
  });

  it('Stapel voll: sagt, dass die Begegnung weiterzog', () => {
    expect(autoDeclineText(1, true)).toBe(`Stapel voll – eine Begegnung zog weiter · +${formatNumber(DECLINE_SEEDS)} 🌰`);
  });
});

describe('Pflanzen: Begegnung „Etwas keimt“', () => {
  /** Spielstand mit Pflanzen und einer offenen Pflanzenbegegnung. */
  function withPlantEncounter(stage: number, plants: string[], cards: string[], animals: string[] = []) {
    const state = stateAt(stage, animals);
    state.plants = [...plants];
    state.pendingEncounters.push({ type: 'plant', cards, rerolls: 0 });
    return state;
  }

  it('echte Pflanzenkarten: Gruppe, Kennzahlen, Vorschau aus previewChoice inkl. Versorgung', () => {
    const state = withPlantEncounter(2, ['hazel'], ['bramble', 'anemone', 'moss'], ['bee']);
    const now = evaluate(state);
    const view = toEncounterView(state, 0)!;
    expect(view.kind).toBe('plant');
    expect(view.title).toBe(PLANT_ENCOUNTER_TITLE);
    expect(view.subtitle).toBe('Eine Pflanze keimt kostenlos im Pflanzring (1/2 belegt).');
    expect(view.cards.map((c) => c.name)).toEqual(['Brombeere', 'Buschwindröschen', 'Frauenhaarmoos']);

    const anemone = view.cards[1]!;
    expect(anemone).toMatchObject({
      id: 'anemone',
      family: 'flowers',
      familyLabel: PLANT_GROUP_INFO.flowers.name,
      familyIcon: PLANT_GROUP_INFO.flowers.icon,
      flavor: PLANTS_BY_ID.get('anemone')!.text,
    });
    expect(anemone.rarity).toBeUndefined();
    expect(anemone.nicheFull).toBeUndefined();
    expect(anemone.disabledReason).toBeUndefined();
    expect(anemone.facts!.map((f) => [f.label, f.value])).toEqual([
      ['Wachstum', '0,3/s'],
      ['Samen', '0,8/s'],
      ['braucht Licht', '1'],
      ['braucht Wasser', '1'],
    ]);
    const after = previewChoice(state, 0, 1)!;
    expect(anemone.preview.harmonyDelta).toBeCloseTo(after.harmony - now.harmony, 9);
    expect(anemone.preview.growthDelta).toBeCloseTo(after.growth / now.growth - 1, 9);
    expect(anemone.preview.seedDelta).toBeCloseTo(after.seeds / now.seeds - 1, 9);
    expect(anemone.preview.supply).toBe(after.supply);
    expect(anemone.preview.supplyDelta).toBeCloseTo(after.supply - now.supply, 9);
    expect(anemone.preview.happiness).toBeUndefined();
  });

  it('was die Pflanze Tieren bietet – gut, wenn ein lebendes Tier davon profitiert', () => {
    const state = withPlantEncounter(2, [], ['anemone', 'moss'], ['bee']);
    const [anemone, moss] = toEncounterView(state, 0)!.cards;
    expect(anemone!.effects).toEqual([
      { label: '🌸 Nektar für Wildbiene', tone: 'good' },
      { label: '🌱 bietet Kräuter', tone: 'neutral' },
      { label: `${PLANT_GROUP_INFO.flowers.icon} Wildbiene wünscht sich Blumen`, tone: 'good' },
    ]);
    // Der Regenwurm lebt noch nicht: neutral
    expect(moss!.effects).toEqual([{ label: '💧 Feuchte für Regenwurm', tone: 'neutral' }]);
    expect(moss!.facts![3]).toMatchObject({ label: 'speichert Wasser', value: '+2', text: 'speichert 2 Wasser' });
    expect(plantProvidesViews(PLANTS_BY_ID.get('moss')!, stateAt(1, ['earthworm']))[0]!.tone).toBe('good');
  });

  it('listNames kürzt lange Listen', () => {
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A und B');
    expect(listNames(['A', 'B', 'C', 'D'])).toBe('A, B und 2 weitere');
  });

  it('Ring voll: „Welche Pflanze weicht?“ – jede Art einmal, Vorschau je Tausch', () => {
    // Setzling hat 2 Plätze – zwei Haseln füllen den Ring.
    const state = withPlantEncounter(2, ['hazel', 'hazel'], ['bramble']);
    const now = evaluate(state);
    const view = toEncounterView(state, 0)!;
    expect(view.subtitle).toMatch(/Pflanzring ist voll \(2\/2\)/);
    const card = view.cards[0]!;
    expect(card.nicheFull).toBe(true);
    expect(card.fullText).toBe('Pflanzring voll');
    expect(card.replacePrompt).toBe('Welche Pflanze weicht?');
    expect(card.replaceOptions!.map((o) => [o.id, o.name])).toEqual([['hazel', 'Hasel']]);
    const after = previewChoice(state, 0, 0, 'hazel')!;
    expect(card.replaceOptions![0]!.preview!.harmonyDelta).toBeCloseTo(after.harmony - now.harmony, 9);
    expect(card.preview).toEqual(card.replaceOptions![0]!.preview);
    expect(card.disabledReason).toBeUndefined();
  });

  it('Ring voll mit derselben Pflanze: Tausch gesperrt, mit Grund', () => {
    const state = withPlantEncounter(1, ['anemone'], ['anemone', 'moss']);
    const [same, other] = toEncounterView(state, 0)!.cards;
    expect(same!.replaceOptions).toEqual([{ id: 'anemone', name: 'Buschwindröschen', disabledReason: 'dieselbe Pflanze' }]);
    expect(same!.disabledReason).toBe('Kein Tausch möglich');
    expect(other!.disabledReason).toBeUndefined();
    expect(other!.replaceOptions![0]!.preview).toBeDefined();
  });

  it('gesperrte Pflanze und unbekannte Pflanze', () => {
    const state = withPlantEncounter(2, [], ['birch', 'dodo-plant', 'hazel']);
    const cards = toEncounterView(state, 0)!.cards;
    expect(cards[0]!.disabledReason).toBe('Wächst erst ab „Junger Baum“');
    expect(cards[0]!.preview).toEqual({ harmonyDelta: 0, growthDelta: 0 });
    expect(cards[1]!.name).toBe('Unbekannte Pflanze');
    expect(cards[1]!.disabledReason).toBeDefined();
    expect(cards[2]!.disabledReason).toBeUndefined();
  });

  it('Neu würfeln: Grund spricht von Pflanzen', () => {
    // Keimling: nur Buschwindröschen und Moos sind freigeschaltet
    const state = withPlantEncounter(1, [], ['anemone', 'moss']);
    state.seeds = 1000;
    const view = toEncounterView(state, 0)!;
    expect(view.canReroll).toBe(false);
    expect(view.rerollDisabledReason).toBe('Keine anderen Pflanzen verfügbar');
    expect(PLANT_REROLL_BLOCKERS['too-expensive']).toBe('Nicht genug Samen');
  });
});

describe('Pflanzring in der Übersicht', () => {
  function ringOf(stage: number, plants: string[], seeds = 0, animals: string[] = []) {
    const state = stateAt(stage, animals);
    state.plants = [...plants];
    state.seeds = seeds;
    const ev = evaluate(state);
    return { state, ev, ring: toEcosystemView(state, ev).plantRing };
  }

  it('Samen-Stufe: verschlossen mit Hinweis, kein Knopf', () => {
    const { ring } = ringOf(0, []);
    expect(ring.capacity).toBe(0);
    expect(ring.unlockHint).toBe('öffnet bei „Keimling“');
    expect(ring.canOpenPicker).toBe(false);
    expect(ring.plantHint).toBe('');
  });

  it('unbekannte Pflanze belegt trotzdem einen Platz', () => {
    const { ring } = ringOf(2, ['hazel', 'dodo-plant']);
    expect(ring.plants.map((p) => [p.id, p.name, p.group])).toEqual([
      ['hazel', 'Hasel', 'shrubs'],
      ['dodo-plant', 'Unbekannte Pflanze', 'unknown'],
    ]);
    expect(ring.canOpenPicker).toBe(false);
  });

  it('Plätze, Pflanzen mit Gruppe, Gruppen-Zähler (Hauptbaum zählt als Baum)', () => {
    const { ring, ev } = ringOf(3, ['birch', 'hazel']);
    expect(ring.capacity).toBe(ev.plantSlots);
    expect(ring.plants).toEqual([
      { id: 'birch', name: 'Hänge-Birke', group: 'trees', groupIcon: '🌳', groupLabel: 'Bäume' },
      { id: 'hazel', name: 'Hasel', group: 'shrubs', groupIcon: PLANT_GROUP_INFO.shrubs.icon, groupLabel: 'Sträucher' },
    ]);
    expect(ring.groups.map((g) => [g.id, g.count])).toEqual([
      ['trees', 2],
      ['shrubs', 1],
      ['flowers', 0],
      ['mosses', 0],
    ]);
  });

  it('Versorgung: verständlicher Text, Mangel an Licht wird erklärt', () => {
    const full = ringOf(2, ['hazel']).ring;
    expect(full.supplyText).toBe('☀️ Licht 100 % · 💧 Wasser 100 %');
    expect(full.shortageHint).toBeUndefined();
    expect(full.meters.map((m) => m.detail)).toEqual(['Bedarf 2 von 3', 'Bedarf 2 von 3']);

    // Hasel (2 ☀️) + Erdbeere (2 ☀️) auf 3 Licht
    const { ring, ev } = ringOf(2, ['hazel', 'strawberry']);
    expect(ev.supply).toBeCloseTo(0.75, 9);
    expect(ring.supplyText).toBe('☀️ Licht 75 % · 💧 Wasser 100 %');
    expect(ring.meters[0]!.ratio).toBeCloseTo(0.75, 9);
    expect(ring.shortageHint).toBe('Zu wenig Licht – Begleitpflanzen wachsen nur mit 75 %. Schattenpflanzen helfen.');
  });

  it('Mangel an Wasser bzw. beidem, Moos speichert Wasser', () => {
    // Hasel (2 💧) + Wurmfarn (2 💧) auf 3 Wasser
    const { ring } = ringOf(2, ['hazel', 'fern']);
    expect(ring.supplyText).toBe('☀️ Licht 100 % · 💧 Wasser 75 %');
    expect(ring.shortageHint).toMatch(/^Zu wenig Wasser – .* Moos speichert Wasser\.$/);
    expect(shortageHint(0.5, 0.8, 0.5)).toMatch(/^Zu wenig Licht und Wasser – Begleitpflanzen wachsen nur mit 50 %/);
    expect(shortageHint(1, 1, 1)).toBeNull();

    const moss = ringOf(1, ['moss']).ring;
    expect(moss.meters[1]!.detail).toBe('Moos speichert 2 · 2 vorhanden');
    expect(moss.meters[1]!.ratio).toBe(1);
  });

  it('„Pflanze setzen“: Kosten, reicht es?, Hinweise – Samen per refresh aktualisiert', () => {
    const { state, ring } = ringOf(2, ['hazel'], 10);
    expect(ring.canOpenPicker).toBe(true);
    expect(ring.plantCost).toBe(nextPlantCost(state));
    expect(ring.plantCostLabel).toBe(formatNumber(Math.ceil(nextPlantCost(state))));
    expect(ring.affordable).toBe(false);
    expect(ring.plantHint).toBe(`Noch ${formatNumber(Math.ceil(nextPlantCost(state) - 10))} 🌰 bis zur nächsten Pflanze`);

    const view = toEcosystemView(state, evaluate(state));
    state.seeds = 1000;
    refreshEcosystemView(view, state);
    expect(view.plantRing.affordable).toBe(true);
    expect(view.plantRing.plantHint).toBe('');

    const full = ringOf(2, ['hazel', 'hazel'], 1000).ring;
    expect(full.canOpenPicker).toBe(false);
    expect(full.plantHint).toMatch(/^Alle Plätze belegt/);
  });
});

describe('Auswahl „Pflanze setzen“', () => {
  it('alle freigeschalteten Pflanzen mit Kosten, Vorschau aus previewPlant und Sperrgrund', () => {
    const state = stateAt(2);
    state.plants = ['hazel'];
    state.seeds = 1000;
    const now = evaluate(state);
    const view = toPlantPickerView(state);
    const cost = nextPlantCost(state);
    const label = formatNumber(Math.ceil(cost));
    expect(view.title).toBe('Pflanze setzen');
    expect(view.subtitle).toBe(`Pflanzring 1/2 belegt · jede Pflanze kostet jetzt ${label} 🌰`);
    expect(view.cost).toBe(cost);
    expect(view.offers.map((o) => o.card.id)).toEqual(unlockedPlants(state));
    expect(view.offers.every((o) => o.cost === cost && o.costLabel === label && !o.card.disabledReason)).toBe(true);
    const nettle = view.offers.find((o) => o.card.id === 'nettle')!.card;
    const after = previewPlant(state, 'nettle')!;
    expect(nettle.preview.harmonyDelta).toBeCloseTo(after.harmony - now.harmony, 9);
    expect(nettle.preview.supply).toBe(after.supply);
    expect(nettle.facts).toHaveLength(4);
  });

  it('nicht ganzzahlige Kosten: Sperre und Anzeige folgen dem exakten Wert, Anzeige aufgerundet', () => {
    // 3 Pflanzen → 20 · 1,9³ = 137,18 🌰
    const state = stateAt(4);
    state.plants = ['hazel', 'bramble', 'anemone'];
    const cost = nextPlantCost(state);
    expect(cost).toBeCloseTo(137.18, 9);
    expect(plantCostLabel(cost)).toBe('138');

    state.seeds = 137.5; // reicht – exakt wie plantBlocker
    let view = toPlantPickerView(state);
    expect(view.offers.every((o) => o.costLabel === '138' && !o.card.disabledReason)).toBe(true);
    expect(seedsLine(state.seeds, view.cost)).toBe('Du hast 137 🌰');
    let ring = toEcosystemView(state, evaluate(state)).plantRing;
    expect(ring.affordable).toBe(true);
    expect(ring.plantHint).toBe('');

    state.seeds = 137.1; // reicht knapp nicht
    view = toPlantPickerView(state);
    expect(view.offers.every((o) => o.card.disabledReason === 'Nicht genug Samen')).toBe(true);
    expect(seedsLine(state.seeds, view.cost)).toBe('Du hast 137 🌰 – noch 1 🌰 bis zur nächsten Pflanze');
    ring = toEcosystemView(state, evaluate(state)).plantRing;
    expect(ring.affordable).toBe(false);
    expect(ring.plantHint).toBe('Noch 1 🌰 bis zur nächsten Pflanze');
  });

  it('zu teuer und Ring voll', () => {
    const poor = stateAt(2);
    poor.seeds = 1;
    expect(toPlantPickerView(poor).offers.every((o) => o.card.disabledReason === 'Nicht genug Samen')).toBe(true);

    const full = stateAt(1);
    full.plants = ['moss'];
    full.seeds = 1000;
    expect(toPlantPickerView(full).offers.every((o) => o.card.disabledReason === 'Pflanzring voll')).toBe(true);
    expect(PLANT_BLOCKERS.locked).toBe('Noch nicht freigeschaltet');
  });

  it('verändert den Spielstand nicht', () => {
    const state = stateAt(2, ['bee']);
    state.plants = ['hazel'];
    state.pendingEncounters.push({ type: 'plant', cards: ['bramble', 'anemone'], rerolls: 0 });
    const before = JSON.stringify(state);
    toPlantPickerView(state);
    toEncounterView(state, 0);
    toEcosystemView(state, evaluate(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});
