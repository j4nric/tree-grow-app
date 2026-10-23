import { RESEARCH } from '../src/content/research';
import { EVENTS_BY_ID } from '../src/content/events';
import { dayKeyFromNumber, dayNumber, updateDaily } from '../src/core/daily';
import { evaluate, previewSowing, sowingCost } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import {
  chooseCard,
  chooseEventOption,
  declineEncounter,
  chooseSowing,
  discardSowing,
  farewellVisitor,
  rerollSowing,
  research,
  researchBlocker,
  sow,
  sowBlocker,
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
 * Lässt einen Wald bis `stage` wachsen: nimmt jeweils die erste Karte (sonst ablehnen), sät
 * bei freiem Pflanzring, sobald die Samen reichen, und setzt die beste Karte nach Harmonie
 * (eine offene Aussaat zuerst). Schritte zu 5 s.
 */
export function grow(seed: number, stage: number, maxSeconds = 6 * 3600): GameState {
  const state = createInitialState(0, seed);
  for (let t = 0; state.stage < stage && t < maxSeconds; t += 5) {
    if (state.cycle.sowing) settleSowing(state);
    while (state.pendingEncounters.length > 0) {
      const e = state.pendingEncounters[0]!;
      if (e.type === 'event') chooseEventOption(state, 0, neutralOption(state));
      else if (e.type === 'visitor') farewellVisitor(state, 0);
      else if (!chooseCard(state, 0, 0).ok) declineEncounter(state, 0);
      if (state.cycle.sowing) settleSowing(state);
    }
    if (state.plants.length < evaluate(state).plantSlots && sowBlocker(state) === null && sow(state).ok) {
      settleSowing(state);
      continue;
    }
    tick(state, 5);
  }
  return state;
}

/**
 * Wahl der offenen Aussaat mit der höchsten Harmonie danach – bei vollem Ring mit dem besten
 * Ersatz; `among`: nur diese Pflanzen. null, wenn keine Karte passt.
 */
export function bestSowingChoice(state: GameState, among?: readonly string[]): { card: number; replace?: string } | null {
  let best: { card: number; replace?: string } | null = null;
  let value = -Infinity;
  (state.cycle.sowing?.cards ?? []).forEach((id, card) => {
    if (among && !among.includes(id)) return;
    for (const replace of [undefined, ...new Set(state.plants)]) {
      const h = previewSowing(state, card, replace)?.harmony ?? -Infinity;
      if (h > value) {
        value = h;
        best = replace === undefined ? { card } : { card, replace };
      }
    }
  });
  return best;
}

/** Offene Aussaat auflösen: beste Wahl setzen (`among`: nur diese Pflanzen), sonst zurücklegen. */
function settleSowing(state: GameState, among?: readonly string[]): void {
  const choice = bestSowingChoice(state, among);
  if (!choice || !chooseSowing(state, choice.card, choice.replace).ok) discardSowing(state);
}

/**
 * Sät (falls keine Aussaat offen ist) und setzt eine Pflanze – mit `among` nur eine gesuchte
 * (Lebensgemeinschafts-Ziel): Dafür wird neu gewürfelt, bis eine passende Karte kommt, solange
 * die Samen reichen; sonst zurücklegen.
 */
function sowFor(state: GameState, among?: readonly string[]): void {
  if (!state.cycle.sowing && (sowBlocker(state) !== null || !sow(state).ok)) return;
  for (let i = 0; i < 20 && among && bestSowingChoice(state, among) === null && rerollSowing(state).ok; i++);
  settleSowing(state, among);
}

/**
 * Ein kurzer Besuch: `seconds` Spielzeit in Sekundenschritten, Tagesziele jede Sekunde
 * nachgeführt. Der Besucher entscheidet Begegnungen, ohne das Ökosystem umzubauen
 * (ablehnen, neutrale Ereignis-Option, Gäste ziehen lassen), sät nur für ein
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
      sowFor(state, status?.missing.flat() ?? []);
    } else if (goals.some((g) => g.kind === 'plant') && (state.cycle.sowing || state.seeds >= sowingCost(state))) {
      sowFor(state);
    } else if (state.cycle.sowing) {
      // Geschenkte Aussaat (Wegpunkt 2) ohne Ziel: zurücklegen, das Ökosystem bleibt.
      discardSowing(state);
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
