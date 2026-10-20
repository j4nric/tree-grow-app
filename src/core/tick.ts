import { CARDS_PER_ENCOUNTER, MAX_PENDING_ENCOUNTERS, RARITY_WEIGHTS } from '../content/encounters';
import { SPECIES, SPECIES_BY_ID } from '../content/species';
import { NICHE_IDS } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import {
  cardStatus,
  declineReward,
  evaluate,
  nicheSlots,
  rerollCost,
  stageForWaypoint,
  thresholdFor,
} from './formulas';
import { pick, weightedIndex } from './rng';
import { allAnimals, type GameState } from './state';

/** Offline-Fortschritt wird auf diese Dauer begrenzt. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;

/** Was während eines Ticks (oder offline) passiert ist. */
export interface TickReport {
  /** Neu erreichte Wegpunkte. */
  waypoints: number;
  /** Davon als Begegnung in die Warteschlange gelegt. */
  encounters: number;
  /** Automatisch abgelehnt (Warteschlange voll oder keine Art verfügbar). */
  autoDeclined: number;
}

export interface OfflineReport extends TickReport {
  /** Tatsächlich simulierte Sekunden (nach Begrenzung). */
  seconds: number;
  growth: number;
  seeds: number;
}

/**
 * Lässt `dt` Sekunden Spielzeit vergehen. Verändert `state` direkt.
 * Ereignisgesteuert: Zwischen zwei Wegpunkten sind die Raten konstant, also wird bis
 * zum nächsten Wegpunkt in einem Schritt gerechnet. Darum liefern viele kleine Ticks
 * und ein großer dasselbe Ergebnis (bis auf Rundung). Deterministisch: Zeit kommt nur
 * über `dt`, Zufall nur über `state.rngState`.
 */
export function tick(state: GameState, dt: number): TickReport {
  const report: TickReport = { waypoints: 0, encounters: 0, autoDeclined: 0 };
  if (!(dt > 0) || !Number.isFinite(dt)) return report;
  let remaining = dt;
  // Schleife endet: Jede Runde verbraucht die Restzeit oder erreicht einen der
  // höchstens WAYPOINT_COUNT Wegpunkte.
  while (remaining > 0) {
    const ev = evaluate(state);
    const next = thresholdFor(state.waypoint + 1);
    const rate = ev.growth > 0 && Number.isFinite(ev.growth) ? ev.growth : 0;
    const toNext = rate > 0 ? Math.max(0, next - state.totalGrowth) / rate : Infinity;
    const step = Math.min(remaining, toNext);
    state.seeds += ev.seeds * step;
    remaining -= step;
    if (step < toNext) {
      state.totalGrowth += rate * step;
      break;
    }
    // Wegpunkt genau erreicht (ohne Rundungsfehler, damit online und offline gleich zählen)
    state.totalGrowth = Math.max(state.totalGrowth, next);
    reachWaypoint(state, report);
  }
  return report;
}

/**
 * Simuliert die Zeit, in der das Spiel geschlossen war (höchstens 8 Stunden).
 * Begegnungen werden wie online gezogen; mehr als 3 offene werden automatisch
 * abgelehnt und als Samen gutgeschrieben.
 */
export function simulateOffline(state: GameState, seconds: number): OfflineReport {
  const total = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), MAX_OFFLINE_SECONDS) : 0;
  const growthBefore = state.totalGrowth;
  const seedsBefore = state.seeds;
  const report = tick(state, total);
  return { ...report, seconds: total, growth: state.totalGrowth - growthBefore, seeds: state.seeds - seedsBefore };
}

function reachWaypoint(state: GameState, report: TickReport): void {
  state.waypoint++;
  state.stage = Math.max(state.stage, stageForWaypoint(state.waypoint));
  report.waypoints++;
  if (state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS) {
    // Warteschlange voll: überzählige Begegnung gleich ablehnen – nichts verfällt.
    state.seeds += declineReward();
    report.autoDeclined++;
    return;
  }
  const cards = drawAnimals(state);
  if (cards.length === 0) {
    // Keine Art kommt in Frage (z. B. Keimling mit besetztem Wurzelraum): wie Ablehnen.
    state.seeds += declineReward();
    report.autoDeclined++;
    return;
  }
  state.pendingEncounters.push({ type: 'animal', cards, rerolls: 0 });
  report.encounters++;
}

/** Wurde der letzte Wegpunkt erreicht? Danach gibt es keine Begegnungen mehr. */
export function allWaypointsReached(state: GameState): boolean {
  return state.waypoint >= WAYPOINT_COUNT;
}

/**
 * Zieht bis zu drei verschiedene Tierkarten: erst eine Seltenheit nach Gewicht, dann
 * gleichverteilt eine Art dieser Seltenheit, die freigeschaltet ist, deren Nische
 * offen ist und die noch nicht im Ökosystem lebt (DESIGN_V2.md, 7.3).
 */
export function drawAnimals(state: GameState): string[] {
  const slots = nicheSlots(state.stage);
  const present = new Set(allAnimals(state));
  const eligible = SPECIES.filter((s) => s.unlock <= state.stage && slots[s.niche] > 0 && !present.has(s.id));
  const weights = RARITY_WEIGHTS[state.stage] ?? RARITY_WEIGHTS[RARITY_WEIGHTS.length - 1]!;
  const cards: string[] = [];
  for (let i = 0; i < CARDS_PER_ENCOUNTER; i++) {
    const byRarity = [0, 1, 2, 3].map((r) => eligible.filter((s) => s.rarity === r && !cards.includes(s.id)));
    const r = weightedIndex(
      state,
      weights.map((w, idx) => (byRarity[idx]!.length > 0 ? w : 0)),
    );
    if (r < 0) break;
    cards.push(pick(state, byRarity[r]!).id);
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Spieleraktionen
// ---------------------------------------------------------------------------

export type ActionError =
  | 'no-encounter'
  | 'no-card'
  | 'present'
  | 'closed'
  | 'niche-full'
  | 'invalid-replace'
  | 'too-expensive'
  | 'no-cards';

export type ActionResult = { ok: true } | { ok: false; error: ActionError };

const fail = (error: ActionError): ActionResult => ({ ok: false, error });

/**
 * Wählt eine Karte: Das Tier zieht in seine Nische, die Begegnung ist erledigt.
 * Ist die Nische voll, muss `replaceSpeciesId` ein Tier dieser Nische nennen – es wird
 * entlassen (bleibt im Naturtagebuch). Ohne Ersatz bleibt die Begegnung offen
 * (Fehler „niche-full“); der Spieler kann dann tauschen, ablehnen oder neu würfeln.
 */
export function chooseCard(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceSpeciesId?: string,
): ActionResult {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return fail('no-encounter');
  const status = cardStatus(state, encounterIndex, cardIndex);
  if (status === 'invalid') return fail('no-card');
  if (status === 'present') return fail('present');
  if (status === 'closed') return fail('closed');
  const sp = SPECIES_BY_ID.get(encounter.cards[cardIndex]!)!;
  const occupants = state.niches[sp.niche];
  if (replaceSpeciesId !== undefined) {
    const at = occupants.indexOf(replaceSpeciesId);
    if (at < 0) return fail('invalid-replace');
    occupants[at] = sp.id;
  } else {
    if (status === 'full') return fail('niche-full');
    occupants.push(sp.id);
  }
  if (!state.meta.journal.species.includes(sp.id)) state.meta.journal.species.push(sp.id);
  state.pendingEncounters.splice(encounterIndex, 1);
  return { ok: true };
}

/** Lehnt eine Begegnung ab und schreibt Samen gut. */
export function declineEncounter(state: GameState, encounterIndex: number): ActionResult {
  if (!state.pendingEncounters[encounterIndex]) return fail('no-encounter');
  state.seeds += declineReward();
  state.pendingEncounters.splice(encounterIndex, 1);
  return { ok: true };
}

/**
 * Würfelt die Karten einer Begegnung neu (kostet Samen, jedes weitere Mal doppelt so
 * viel). Kommt keine Art in Frage, bleibt alles unverändert und es kostet nichts.
 */
export function rerollEncounter(state: GameState, encounterIndex: number): ActionResult {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return fail('no-encounter');
  const cost = rerollCost(state, encounterIndex);
  if (state.seeds < cost) return fail('too-expensive');
  const saved = state.rngState;
  const cards = drawAnimals(state);
  if (cards.length === 0) {
    state.rngState = saved;
    return fail('no-cards');
  }
  state.seeds -= cost;
  encounter.cards = cards;
  encounter.rerolls++;
  return { ok: true };
}

/** Für Tests und Werkzeuge: Lebt die Art irgendwo im Ökosystem? */
export function hasSpecies(state: GameState, speciesId: string): boolean {
  return NICHE_IDS.some((n) => state.niches[n].includes(speciesId));
}
