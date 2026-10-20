import { SPECIES_BY_ID } from '../src/content/species';
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
