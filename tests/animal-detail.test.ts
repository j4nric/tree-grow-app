import { describe, expect, it } from 'vitest';
import { SEASON_SECONDS } from '../src/content/seasons';
import { MEMORY_PER_REGULAR_SLOT } from '../src/content/memory';
import { ecosystemOf, evaluate, evaluateEcosystem } from '../src/core/formulas';
import type { GameState } from '../src/core/state';
import { resolveAnimal, toAnimalDetailView } from '../src/ui/animal-detail-view';
import { formatPercent } from '../src/ui/view-format';
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

  it('Spoiler-Regel: unentdeckte Lebensgemeinschaften ohne Name und ID', () => {
    const state = stateAt(6, ['earthworm', 'woodlouse']);
    const hidden = toAnimalDetailView(state, 'earthworm')!;
    const humus = hidden.communities[0]!;
    expect(humus).toMatchObject({ key: 'unknown-community-0', discovered: false, name: '???', icon: '❔', progress: '2/3 Mitglieder' });
    expect(JSON.stringify(hidden)).not.toContain('Humusküche');
    expect(JSON.stringify(hidden)).not.toContain('"humus"');

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
    expect(view.abilities).toEqual([expect.objectContaining({ name: 'Baumeister', active: true })]);
    expect(view.effects.some((e) => e.label.includes('Baumeister'))).toBe(false);
    expect(view.effects.map((e) => e.label)).toContain('+8 % 🌿');
  });
});
