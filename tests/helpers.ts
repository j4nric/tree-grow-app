import { SPECIES_BY_ID, type Species } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { thresholdFor } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';

/** Spielstand genau am Anfang einer Stufe, mit diesen Tieren in ihren Nischen. */
export function stateAt(stage: number, animals: string[] = [], seed = 1): GameState {
  const state = createInitialState(0, seed);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = thresholdFor(state.waypoint);
  for (const id of animals) {
    state.niches[SPECIES_BY_ID.get(id)!.niche].push(id);
    state.meta.journal.species.push(id);
  }
  return state;
}

/**
 * Registriert für die Dauer von `fn` zusätzliche Test-Arten (z. B. einen Höhlenbewohner,
 * den der Prototyp noch nicht hat). Die Logik sucht Arten über SPECIES_BY_ID.
 */
export function withFakeSpecies<T>(species: Species[], fn: () => T): T {
  const map = SPECIES_BY_ID as Map<string, Species>;
  // Überschriebene echte Arten danach wiederherstellen, statt sie zu löschen.
  const previous = species.map((s) => [s.id, map.get(s.id)] as const);
  for (const s of species) map.set(s.id, s);
  try {
    return fn();
  } finally {
    for (const [id, original] of previous) {
      if (original) map.set(id, original);
      else map.delete(id);
    }
  }
}

/** Test-Art mit schlichten Standardwerten. */
export function fakeSpecies(patch: Partial<Species> & Pick<Species, 'id' | 'niche'>): Species {
  return {
    name: patch.id,
    genus: 'birds',
    rarity: 0,
    level: 'predator',
    unlock: 1,
    food: ['insekten'],
    needs: [],
    provides: [],
    effects: [],
    summary: '-',
    text: '-',
    ...patch,
  };
}
