import { RESEARCH } from '../src/content/research';
import { EVENTS_BY_ID } from '../src/content/events';
import { PLANTS } from '../src/content/plants';
import { dayKeyFromNumber, dayNumber, updateDaily } from '../src/core/daily';
import { evaluate, nextPlantCost, previewPlant } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import {
  chooseCard,
  chooseEventOption,
  declineEncounter,
  farewellVisitor,
  plantBlocker,
  plantSeed,
  research,
  researchBlocker,
  tick,
} from '../src/core/tick';

/*
 * Hilfen für die Tests der Tagesziele (tests/daily*.test.ts): ein schlichter Spieler, der
 * einen Wald bis zu einer Stufe wachsen lässt, und ein „Besucher“, der die Ziele eines
 * Tages ohne Umbau des Ökosystems angeht.
 */

/** Tag n Tage nach `day`. */
export const addDays = (day: string, n: number) => dayKeyFromNumber(dayNumber(day) + n);

/** Wählt die Ereignis-Option nur mit Samen (neutral), sonst die erste. */
function neutralOption(state: GameState): number {
  const event = EVENTS_BY_ID.get(state.pendingEncounters[0]!.cards[0]!);
  const i = event?.options.findIndex((o) => o.effects.every((e) => e.kind === 'seedsNow')) ?? -1;
  return i >= 0 ? i : 0;
}

/**
 * Lässt einen Wald bis `stage` wachsen: nimmt jeweils die erste Karte (sonst ablehnen),
 * setzt die beste Pflanze nach Harmonie, sobald die Samen reichen. Schritte zu 5 s.
 */
export function grow(seed: number, stage: number, maxSeconds = 6 * 3600): GameState {
  const state = createInitialState(0, seed);
  for (let t = 0; state.stage < stage && t < maxSeconds; t += 5) {
    while (state.pendingEncounters.length > 0) {
      const e = state.pendingEncounters[0]!;
      if (e.type === 'event') chooseEventOption(state, 0, neutralOption(state));
      else if (e.type === 'visitor') farewellVisitor(state, 0);
      else if (!chooseCard(state, 0, 0).ok) declineEncounter(state, 0);
    }
    const plant = bestPlant(state);
    if (plant && plantSeed(state, plant).ok) continue;
    tick(state, 5);
  }
  return state;
}

/** Pflanze mit der höchsten Harmonie danach (nur setzbare); null, wenn keine geht. */
export function bestPlant(state: GameState, among: readonly string[] = PLANTS.map((p) => p.id)): string | null {
  let best: string | null = null;
  let value = -Infinity;
  for (const id of among) {
    if (plantBlocker(state, id) !== null) continue;
    const h = previewPlant(state, id)?.harmony ?? -Infinity;
    if (h > value) {
      value = h;
      best = id;
    }
  }
  return best;
}

/**
 * Ein kurzer Besuch: `seconds` Spielzeit in Sekundenschritten, Tagesziele jede Sekunde
 * nachgeführt. Der Besucher entscheidet Begegnungen, ohne das Ökosystem umzubauen
 * (ablehnen, neutrale Ereignis-Option, Gäste ziehen lassen), setzt Pflanzen nur für ein
 * Pflanz- oder Lebensgemeinschafts-Ziel und kauft Pflege nur für ein Pflege-Ziel (die
 * günstigste). Endet früher, wenn alle Ziele erfüllt sind.
 */
export function visit(state: GameState, day: string, seconds = 900): void {
  updateDaily(state, day, {});
  for (let t = 0; t < seconds && !state.meta.daily.goals.every((g) => g.done); t++) {
    const goals = state.meta.daily.goals.filter((g) => !g.done);
    while (state.pendingEncounters.length > 0) {
      const e = state.pendingEncounters[0]!;
      if (e.type === 'event') chooseEventOption(state, 0, neutralOption(state));
      else if (e.type === 'visitor') farewellVisitor(state, 0);
      else declineEncounter(state, 0);
      updateDaily(state, day, {});
    }
    const community = goals.find((g) => g.kind === 'community');
    if (community) {
      const status = evaluate(state).communities.find((c) => c.id === community.community);
      const id = bestPlant(state, status?.missing.flat() ?? []);
      if (id) plantSeed(state, id);
    } else if (goals.some((g) => g.kind === 'plant') && state.seeds >= nextPlantCost(state)) {
      const id = bestPlant(state);
      if (id) plantSeed(state, id);
    }
    if (goals.some((g) => g.kind === 'care')) {
      const cheapest = RESEARCH.filter((n) => researchBlocker(state, n.id) === null).sort((a, b) => a.cost - b.cost)[0];
      if (cheapest) research(state, cheapest.id);
    }
    updateDaily(state, day, {});
    tick(state, 1);
    updateDaily(state, day, { activeSeconds: 1 });
  }
}
