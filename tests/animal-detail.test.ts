import { describe, expect, it } from 'vitest';
import { SEASON_SECONDS } from '../src/content/seasons';
import { slotOpensDetails } from '../src/ui/ecosystem-panel';
import { MEMORY_PER_REGULAR_SLOT } from '../src/content/memory';
import { COMMUNITIES } from '../src/content/communities';
import { SEASONS_BY_ID } from '../src/content/seasons';
import { ecosystemOf, evaluate, evaluateEcosystem, memberOptions } from '../src/core/formulas';
import type { GameState } from '../src/core/state';
import { resolveAnimal, toAnimalDetailView } from '../src/ui/animal-detail-view';
import { FOOD_ENOUGH, formatPercent, isScarceFood } from '../src/ui/view-format';
import { stateAt } from './helpers';

/** Auswertung ohne diese Art – zum Nachprüfen des Beitrags (Kern rechnet, nicht der Test). */
function without(state: GameState, id: string) {
  const niches = Object.fromEntries(Object.entries(state.niches).map(([k, v]) => [k, v.filter((x) => x !== id)]));
  return evaluateEcosystem(ecosystemOf(state, { niches: niches as GameState['niches'] }));
}

describe('Tierdetails: View-Model', () => {
  it('Zahlen stammen aus der Auswertung (Zufriedenheit, Beitrag)', () => {
    const state = stateAt(6, ['earthworm', 'woodlouse', 'bluetit', 'jay']);
    const now = evaluate(state);
    const view = toAnimalDetailView(state, 'bluetit', now)!;
    expect(view.name).toBe('Blaumeise');
    expect(view.familyLabel).toBe('Vögel');
    expect(view.nicheId).toBe('crown');
    expect(view.happiness).toBe(now.animals.bluetit!.happiness);
    expect(view.contribution.happiness).toBe(now.animals.bluetit!.happiness);
    const before = without(state, 'bluetit');
    expect(view.contribution.harmonyDelta).toBeCloseTo(now.harmony - before.harmony, 10);
    expect(view.contribution.growthDelta).toBeCloseTo(now.growth / before.growth - 1, 10);
    expect(view.contribution.seedDelta).toBeCloseTo(now.seeds / before.seeds - 1, 10);
    // Keine Gemeinschafts-Hinweise in der Vorschau (die stehen unten mit Spoiler-Regel).
    expect(view.contribution.communities).toBeUndefined();
  });

  it('Wünsche ✓/✗ wie im Kern, Störer mit Namen und Abzug', () => {
    const state = stateAt(6, ['bluetit', 'jay']);
    const now = evaluate(state);
    const view = toAnimalDetailView(state, 'bluetit', now)!;
    const status = now.animals.bluetit!;
    expect(view.conditions.map((c) => c.met)).toEqual([status.food > 0, ...status.needs]);
    const disturb = view.factors.find((f) => f.key === 'disturb')!;
    expect(status.disturbers).toBe(1);
    expect(disturb.label).toBe('wird gestört von Eichelhäher (−15 Prozentpunkte)');
    expect(disturb.tone).toBe('bad');
  });

  it('Futter: wie viel gedeckt ist und mit wem es geteilt wird', () => {
    const state = stateAt(6, ['jay', 'squirrel']);
    const now = evaluate(state);
    const view = toAnimalDetailView(state, 'jay', now)!;
    const food = view.conditions[0]!;
    expect(food.met).toBe(now.animals.jay!.food > 0);
    expect(food.hint).toBe(`${formatPercent(now.animals.jay!.food)} gedeckt · teilt sich das Futter mit Eichhörnchen`);
    // ✓ nur bei ausreichender Deckung, sonst ◐ (teilweise).
    expect(food.partial === true).toBe(isScarceFood(now.animals.jay!.food));
  });

  it('Futter knapp gedeckt: teilweise statt erfüllt; voll gedeckt: erfüllt', () => {
    const scarce = stateAt(3, ['earthworm', 'woodlouse', 'oakmoth', 'barkbeetle']);
    scarce.cycle.mainTree = 'beech';
    const moth = evaluate(scarce).animals.oakmoth!;
    expect(moth.food).toBeLessThan(FOOD_ENOUGH);
    expect(toAnimalDetailView(scarce, 'oakmoth')!.conditions[0]).toMatchObject({ met: true, partial: true });
    const alone = stateAt(3, ['earthworm']);
    expect(evaluate(alone).animals.earthworm!.food).toBeGreaterThanOrEqual(FOOD_ENOUGH);
    expect(toAnimalDetailView(alone, 'earthworm')!.conditions[0]!.partial).toBeUndefined();
  });

  it('Jahreszeit: Winter hebt die Zufriedenheit der Säugetiere', () => {
    const state = stateAt(6, ['hedgehog']);
    state.cycle.elapsed = 3 * SEASON_SECONDS + 1;
    const winter = toAnimalDetailView(state, 'hedgehog')!;
    expect(winter.factors.find((f) => f.key === 'season')).toMatchObject({ label: 'Winter: +15 Prozentpunkte', tone: 'good' });
    state.cycle.elapsed = 1;
    const spring = toAnimalDetailView(state, 'hedgehog')!;
    expect(spring.factors.find((f) => f.key === 'season')).toMatchObject({ label: 'Frühling: keine Wirkung auf Säugetiere', tone: 'neutral' });
    // Der Zufriedenheitswert folgt der Auswertung (Winter höher).
    expect(winter.happiness).toBeGreaterThan(spring.happiness);
  });

  it('Spoiler-Regel: unentdeckte Lebensgemeinschaften nur als Anzahl – ohne Name, ID, Hinweis und Fortschritt', () => {
    const state = stateAt(6, ['earthworm', 'woodlouse']);
    const hidden = toAnimalDetailView(state, 'earthworm')!;
    const humusData = COMMUNITIES.find((c) => c.id === 'humus')!;
    const memberOf = COMMUNITIES.filter((c) => c.members.some((m) => memberOptions(m).includes('earthworm'))).length;
    // Alle Gemeinschaften des Regenwurms sind unentdeckt → genau ein Sammeleintrag.
    expect(hidden.communities).toHaveLength(1);
    const entry = hidden.communities[0]!;
    expect(entry).toMatchObject({ key: 'unknown-communities', discovered: false, icon: '❔', active: false });
    expect(entry.name).toBe(
      memberOf === 1
        ? 'Gehört zu einer noch unentdeckten Lebensgemeinschaft'
        : `Gehört zu ${memberOf} noch unentdeckten Lebensgemeinschaften`,
    );
    expect(entry.progress).toBeUndefined();
    const json = JSON.stringify(hidden);
    expect(json).not.toContain('Humusküche');
    expect(json).not.toContain('"humus"');
    expect(json).not.toContain(humusData.hint);
    expect(json).not.toMatch(/\d\/\d Mitglieder/);

    state.meta.journal.communities.push('humus');
    const known = toAnimalDetailView(state, 'earthworm')!;
    expect(known.communities[0]).toMatchObject({ key: 'humus', discovered: true, name: 'Humusküche', active: false });
    expect(known.communities[0]!.progress).toContain('fehlt: Pfifferling oder Steinpilz');
  });

  it('Aktive Gemeinschaft gilt als entdeckt, mit Harmonie aus der Auswertung', () => {
    const state = stateAt(6, ['earthworm', 'woodlouse', 'chanterelle']);
    const now = evaluate(state);
    const view = toAnimalDetailView(state, 'earthworm', now)!;
    const humus = view.communities.find((c) => c.key === 'humus')!;
    expect(humus.active).toBe(true);
    const harmony = now.communities.find((c) => c.id === 'humus')!.harmony;
    expect(humus.effect).toContain(`+${harmony} Harmonie`);
  });

  it('Stammgast-Status nur, wenn es Plätze gibt', () => {
    const state = stateAt(6, ['bluetit']);
    expect(toAnimalDetailView(state, 'bluetit')!.regular).toBeNull();
    state.meta.forestMemory = MEMORY_PER_REGULAR_SLOT;
    expect(toAnimalDetailView(state, 'bluetit')!.regular).toMatch(/^☆ Kein Stammgast/);
    state.meta.regulars.push('bluetit');
    expect(toAnimalDetailView(state, 'bluetit')!.regular).toMatch(/^★ Stammgast/);
  });

  it('Ziel per Art-ID oder Platz; nicht eingezogene Arten → null', () => {
    const state = stateAt(6, ['earthworm', 'woodlouse']);
    expect(resolveAnimal(state, { niche: 'roots', index: 0 })).toBe('earthworm');
    expect(resolveAnimal(state, { niche: 'roots', index: 5 })).toBeNull();
    expect(resolveAnimal(state, 'woodlouse')).toBe('woodlouse');
    expect(toAnimalDetailView(state, 'bluetit')).toBeNull();
    expect(toAnimalDetailView(state, { niche: 'litter', index: 0 })!.id).toBe('woodlouse');
  });

  it('Fähigkeiten getrennt von den Wirkungen', () => {
    const state = stateAt(7, ['blackwoodpecker']);
    const view = toAnimalDetailView(state, 'blackwoodpecker')!;
    expect(view.abilities).toEqual([expect.objectContaining({ name: 'Baumeister' })]);
    expect(view.effects.some((e) => e.label.includes('Baumeister'))).toBe(false);
    expect(view.effects.map((e) => e.label)).toContain('+8 % 🌿');
  });

  it('Beitrag mit aktiver Lebensgemeinschaft: Harmonie und Wirkungen der Humusküche zählen mit', () => {
    const state = stateAt(6, ['earthworm', 'woodlouse', 'chanterelle']);
    const now = evaluate(state);
    const before = without(state, 'earthworm');
    expect(now.communities.find((c) => c.id === 'humus')!.active).toBe(true);
    expect(before.communities.find((c) => c.id === 'humus')!.active).toBe(false);
    const view = toAnimalDetailView(state, 'earthworm', now)!;
    expect(view.contribution.harmonyDelta).toBeCloseTo(now.harmony - before.harmony, 10);
    expect(view.contribution.growthDelta).toBeCloseTo(now.growth / before.growth - 1, 10);
    expect(view.contribution.seedDelta).toBeCloseTo(now.seeds / before.seeds - 1, 10);
    // Die Gemeinschaft hebt den Beitrag über das, was der Regenwurm allein brächte.
    const humus = now.communities.find((c) => c.id === 'humus')!.harmony;
    expect(view.contribution.harmonyDelta).toBeGreaterThanOrEqual(humus);
  });

  it('Beitrag mit Gattungsbonus: die zweite Vogelart hebt die Eigenheit der Vögel', () => {
    const state = stateAt(6, ['bluetit', 'robin']);
    const now = evaluate(state);
    const before = without(state, 'robin');
    expect(now.traitTiers.birds).toBeGreaterThan(before.traitTiers.birds);
    const view = toAnimalDetailView(state, 'robin', now)!;
    expect(view.contribution.harmonyDelta).toBeCloseTo(now.harmony - before.harmony, 10);
    expect(view.contribution.growthDelta).toBeCloseTo(now.growth / before.growth - 1, 10);
    expect(view.contribution.seedDelta).toBeCloseTo(now.seeds / before.seeds - 1, 10);
  });

  it('Platz-Schaffer: Hinweis, dass ohne sie Plätze wegfielen und Bewohner ausziehen müssten', () => {
    const plain = toAnimalDetailView(stateAt(6, ['bluetit']), 'bluetit')!;
    expect(plain.contributionNote).toBe('Unterschied zu deinem Ökosystem ohne diese Art.');

    // Junger Baum: 1 Höhlenplatz + 1 vom Buntspecht – Waldkauz und Langohr bräuchten beide.
    const crowded = toAnimalDetailView(stateAt(4, ['woodpecker', 'owl', 'bat']), 'woodpecker')!;
    expect(crowded.contributionNote).toContain('Schafft Plätze (🕳️ Höhlen & Totholz +1)');
    expect(crowded.contributionNote).toContain('ein Bewohner müsste ausziehen – das zeigt der Beitrag nicht.');

    const roomy = toAnimalDetailView(stateAt(4, ['woodpecker']), 'woodpecker')!;
    expect(roomy.contributionNote).toContain('gerade müsste deswegen niemand ausziehen');

    // Baumeister: Plätze in Krone und Höhlen.
    const architect = toAnimalDetailView(stateAt(7, ['blackwoodpecker']), 'blackwoodpecker')!;
    expect(architect.contributionNote).toMatch(/Krone \+1.*Höhlen & Totholz \+1/);
  });

  it('Jahreszeit mit Hauptbaum: Die Kiefer streicht Abzüge – auch in den Details', () => {
    const winter = SEASONS_BY_ID.get('winter')!;
    const effects = winter.effects as unknown as { kind: string; genus?: string; points?: number }[];
    // Künstlicher Abzug für Säugetiere im Winter (Inhalt kennt derzeit keinen).
    effects.push({ kind: 'happiness', genus: 'mammals', points: -5 });
    try {
      const state = stateAt(6, ['hedgehog']);
      state.cycle.elapsed = 3 * SEASON_SECONDS + 1;
      state.cycle.mainTree = 'oak';
      // Auswertung ungecacht – der künstliche Abzug soll nicht im Cache von evaluate landen.
      const oak = toAnimalDetailView(state, 'hedgehog', evaluateEcosystem(ecosystemOf(state)))!;
      expect(oak.factors.find((f) => f.key === 'season')!.label).toBe('Winter: +10 Prozentpunkte');
      state.cycle.mainTree = 'pine';
      const pine = toAnimalDetailView(state, 'hedgehog', evaluateEcosystem(ecosystemOf(state)))!;
      expect(pine.factors.find((f) => f.key === 'season')!.label).toBe('Winter: +15 Prozentpunkte');
      // Gleiche Richtung wie die Auswertung des Kerns.
      expect(pine.happiness).toBeGreaterThan(oak.happiness);
    } finally {
      effects.pop();
    }
  });
});

describe('Tierdetails: Kachel als Knopf (Seitenleiste)', () => {
  it('nur eingezogene Tiere öffnen Details – keine freien Plätze, keine Gäste', () => {
    expect(slotOpensDetails({}, true)).toBe(true);
    expect(slotOpensDetails({ visitor: false }, true)).toBe(true);
    expect(slotOpensDetails(undefined, true)).toBe(false);
    expect(slotOpensDetails({ visitor: true }, true)).toBe(false);
    // Ohne Rückruf bleibt die Kachel schlicht.
    expect(slotOpensDetails({}, false)).toBe(false);
  });
});
