import {
  CARDS_PER_ENCOUNTER,
  ENCOUNTER_WEIGHTS,
  MAX_PENDING_ENCOUNTERS,
  PLANT_WEIGHT_IN_RING,
  PLANT_WEIGHT_RING_FULL,
  SCRIPTED_ENCOUNTERS,
} from '../content/encounters';
import { PLANTS, PLANTS_BY_ID } from '../content/plants';
import { SPECIES } from '../content/species';
import { ENCOUNTER_TYPES } from '../content/types';
import { WAYPOINT_COUNT } from '../content/waypoints';
import {
  activeCommunities,
  appearsContext,
  declineReward,
  evaluate,
  nextPlantCost,
  nicheSlots,
  plantSlots,
  rarityWeights,
  rerollCost,
  resolveChoice,
  speciesAppears,
  stageForWaypoint,
  thresholdFor,
  type ChoiceError,
} from './formulas';
import { pick, weightedIndex, type RngHolder } from './rng';
import { allAnimals, type GameState, type PendingEncounter, type PendingEncounterType } from './state';

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
    state.seeds = capped(state.seeds + ev.seeds * step);
    remaining -= step;
    if (step < toNext) {
      state.totalGrowth = capped(state.totalGrowth + rate * step);
      break;
    }
    // Wegpunkt genau erreicht (ohne Rundungsfehler, damit online und offline gleich zählen)
    state.totalGrowth = Math.max(state.totalGrowth, next);
    reachWaypoint(state, report);
  }
  return report;
}

/**
 * Begrenzt +Infinity auf die größte endliche Zahl: JSON.stringify schriebe sonst `null`
 * in den Spielstand. (Bis „Urwald“ unerreichbar – Schutz für riesige Zeitsprünge.)
 */
function capped(value: number): number {
  return value > Number.MAX_VALUE ? Number.MAX_VALUE : value;
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
    state.seeds = capped(state.seeds + declineReward());
    report.autoDeclined++;
    return;
  }
  const encounter = drawEncounter(state);
  if (!encounter) {
    // Weder Art noch Pflanze kommt in Frage: wie Ablehnen.
    state.seeds = capped(state.seeds + declineReward());
    report.autoDeclined++;
    return;
  }
  state.pendingEncounters.push(encounter);
  report.encounters++;
}

/** Begegnungstypen, die es schon gibt (Ereignis und Durchreisende folgen in 2.4). */
const DRAWABLE_TYPES: readonly PendingEncounterType[] = ['animal', 'plant'];

/**
 * Zieht die Begegnung für den gerade erreichten Wegpunkt (DESIGN_V2.md, 7.1/7.2): Die
 * ersten Wegpunkte sind festgelegt (Tier, Pflanze, Tier), danach entscheidet das
 * Gewicht der Stufe zwischen „Tier zieht ein“ und „Etwas keimt“ (bei vollem Pflanzenring
 * zählt „Etwas keimt“ nur mit PLANT_WEIGHT_RING_FULL). Kommt für den Typ
 * keine Karte in Frage, gibt es den anderen; null, wenn gar nichts passt.
 */
export function drawEncounter(state: GameState): PendingEncounter | null {
  let type = SCRIPTED_ENCOUNTERS[state.waypoint - 1];
  if (type === undefined) {
    const weights = ENCOUNTER_WEIGHTS[state.stage] ?? ENCOUNTER_WEIGHTS[ENCOUNTER_WEIGHTS.length - 1]!;
    const ringFull = state.plants.length >= plantSlots(state.stage);
    const drawable = ENCOUNTER_TYPES.map((t, i) => {
      if (!(DRAWABLE_TYPES as readonly string[]).includes(t)) return 0;
      return t === 'plant' && ringFull ? weights[i]! * PLANT_WEIGHT_RING_FULL : weights[i]!;
    });
    type = ENCOUNTER_TYPES[weightedIndex(state, drawable)] ?? 'animal';
  }
  const order: readonly PendingEncounterType[] = type === 'plant' ? ['plant', 'animal'] : ['animal', 'plant'];
  for (const t of order) {
    const cards = drawCards(state, t);
    if (cards.length > 0) return { type: t, cards, rerolls: 0 };
  }
  return null;
}

/** Karten für einen Begegnungstyp (siehe drawAnimals / drawPlants). */
export function drawCards(
  state: GameState,
  type: PendingEncounterType,
  exclude: readonly string[] = [],
  rng: RngHolder = state,
): string[] {
  return type === 'plant' ? drawPlants(state, exclude, rng) : drawAnimals(state, exclude, rng);
}

/**
 * Zieht bis zu drei verschiedene Pflanzenkarten gewichtet (schon im Ring:
 * PLANT_WEIGHT_IN_RING, sonst 1) aus allen Pflanzen, die
 * auf dieser Stufe freigeschaltet sind – auch solche, die schon wachsen (Duplikate
 * erlaubt). Pflanzen in `exclude` kommen nur zum Auffüllen dran (wie bei drawAnimals).
 */
export function drawPlants(state: GameState, exclude: readonly string[] = [], rng: RngHolder = state): string[] {
  const eligible = PLANTS.filter((p) => p.unlock <= state.stage);
  const pools = [eligible.filter((p) => !exclude.includes(p.id)), eligible.filter((p) => exclude.includes(p.id))];
  const cards: string[] = [];
  for (const pool of pools) {
    const left = pool.map((p) => p.id);
    while (cards.length < CARDS_PER_ENCOUNTER && left.length > 0) {
      // Pflanzen, die schon im Ring wachsen, kommen seltener (PLANT_WEIGHT_IN_RING).
      const i = weightedIndex(
        rng,
        left.map((id) => (state.plants.includes(id) ? PLANT_WEIGHT_IN_RING : 1)),
      );
      cards.push(left.splice(i, 1)[0]!);
    }
  }
  return cards;
}

/** Wurde der letzte Wegpunkt erreicht? Danach gibt es keine Begegnungen mehr. */
export function allWaypointsReached(state: GameState): boolean {
  return state.waypoint >= WAYPOINT_COUNT;
}

/**
 * Zieht bis zu drei verschiedene Tierkarten: erst eine Seltenheit nach Gewicht
 * (rarityWeights: Stufe und Glückspilz), dann gleichverteilt eine Art dieser Seltenheit,
 * die freigeschaltet ist, deren Nische offen ist, die noch nicht im Ökosystem lebt und
 * deren Erscheinungsbedingung erfüllt ist (DESIGN_V2.md, 7.3). Seltenheiten ohne
 * passende Art fallen weg (neu gewichtet).
 * Arten in `exclude` (beim Neu würfeln: die bisherigen Karten) kommen nur zum Auffüllen
 * dran, wenn die übrigen Arten nicht für alle Karten reichen.
 * Zufall aus `rng` (Standard: der Spielstand selbst).
 */
export function drawAnimals(state: GameState, exclude: readonly string[] = [], rng: RngHolder = state): string[] {
  const slots = nicheSlots(state.stage, state.niches);
  const present = new Set(allAnimals(state));
  const appears = appearsContext(state);
  const eligible = SPECIES.filter(
    (s) => s.unlock <= state.stage && slots[s.niche] > 0 && !present.has(s.id) && speciesAppears(appears, s),
  );
  const pools = [eligible.filter((s) => !exclude.includes(s.id)), eligible.filter((s) => exclude.includes(s.id))];
  const weights = rarityWeights(state);
  const cards: string[] = [];
  for (const pool of pools) {
    while (cards.length < CARDS_PER_ENCOUNTER) {
      const byRarity = [0, 1, 2, 3].map((r) => pool.filter((s) => s.rarity === r && !cards.includes(s.id)));
      const r = weightedIndex(
        rng,
        weights.map((w, idx) => (byRarity[idx]!.length > 0 ? w : 0)),
      );
      if (r < 0) break;
      cards.push(pick(rng, byRarity[r]!).id);
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Spieleraktionen
// ---------------------------------------------------------------------------

export type ActionError =
  /** Fehler beim Wählen einer Karte (siehe ChoiceError in formulas.ts). */
  | ChoiceError
  | 'too-expensive'
  /** Keine Art bzw. Pflanze kommt in Frage. */
  | 'no-cards'
  /** Neu würfeln brächte nur dieselben Karten (zu wenige passende Arten). */
  | 'no-alternatives'
  /** Pflanze setzen: unbekannte Pflanzen-ID. */
  | 'unknown-plant'
  /** Pflanze setzen: erst auf einer späteren Stufe freigeschaltet. */
  | 'locked';

/**
 * Ergebnis einer Spieleraktion. `discovered`: Lebensgemeinschaften, die durch die Aktion
 * zum ersten Mal entstanden sind (chooseCard, plantSeed) – für die Entdeckungs-Meldung.
 * Fehlt, wenn nichts Neues entdeckt wurde.
 */
export type ActionResult = { ok: true; discovered?: string[] } | { ok: false; error: ActionError };

const fail = (error: ActionError): ActionResult => ({ ok: false, error });

/** Erfolg; `discovered` nur, wenn wirklich etwas Neues entstanden ist. */
const discoveryResult = (discovered: string[]): ActionResult =>
  discovered.length > 0 ? { ok: true, discovered } : { ok: true };

/**
 * Wählt eine Karte, die Begegnung ist danach erledigt.
 * - Tierkarte: Das Tier zieht in seine Nische. Ist sie voll, muss `replaceId` ein Tier
 *   dieser Nische nennen – es wird entlassen (bleibt im Naturtagebuch).
 * - Pflanzenkarte („Etwas keimt“): Die Pflanze keimt kostenlos im Pflanzring. Ist er
 *   voll, muss `replaceId` eine Pflanze im Ring nennen – sie wird ersetzt.
 * Ohne Ersatz bei voller Nische/vollem Ring bleibt die Begegnung offen ('niche-full' /
 * 'ring-full'); der Spieler kann dann tauschen, ablehnen oder neu würfeln. Ein Tausch,
 * der anderen Tieren den Platz nähme, scheitert mit 'would-evict'. Gleiche Prüfung wie
 * previewChoice / choiceBlocker.
 */
export function chooseCard(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): ActionResult {
  const outcome = resolveChoice(state, encounterIndex, cardIndex, replaceId);
  if (!outcome.ok) return fail(outcome.error);
  const encounter = state.pendingEncounters[encounterIndex]!;
  const id = encounter.cards[cardIndex]!;
  for (const nicheId of Object.keys(outcome.niches) as (keyof typeof outcome.niches)[]) {
    state.niches[nicheId] = outcome.niches[nicheId];
  }
  state.plants = outcome.plants;
  if (encounter.type === 'animal' && !state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  state.pendingEncounters.splice(encounterIndex, 1);
  return discoveryResult(recordDiscoveries(state));
}

/**
 * Trägt ins Naturtagebuch ein, was gerade im Ökosystem ist: wachsende Pflanzen und
 * aktive Lebensgemeinschaften (je einmal, in der Reihenfolge der Entdeckung). Arten
 * trägt chooseCard selbst ein. Gibt die neu entdeckten Lebensgemeinschaften zurück
 * (chooseCard und plantSeed reichen sie als `discovered` an die UI weiter).
 */
export function recordDiscoveries(state: GameState): string[] {
  const journal = state.meta.journal;
  for (const id of state.plants) if (!journal.plants.includes(id)) journal.plants.push(id);
  const fresh = activeCommunities(evaluate(state)).filter((id) => !journal.communities.includes(id));
  journal.communities.push(...fresh);
  return fresh;
}

/**
 * Setzt eine Pflanze für Samen in den Pflanzring (die Samen-Senke, DESIGN_V2.md 4).
 * Kosten: 20 · 1,9^n bei n Begleitpflanzen (nextPlantCost). Duplikate sind erlaubt.
 */
export function plantSeed(state: GameState, plantId: string): ActionResult {
  const blocker = plantBlocker(state, plantId);
  if (blocker) return fail(blocker);
  state.seeds -= nextPlantCost(state);
  state.plants.push(plantId);
  return discoveryResult(recordDiscoveries(state));
}

/** Warum „Pflanze setzen“ gerade nicht geht – null, wenn es geht. Ändert nichts. */
export function plantBlocker(
  state: GameState,
  plantId: string,
): 'unknown-plant' | 'locked' | 'ring-full' | 'too-expensive' | null {
  const plant = PLANTS_BY_ID.get(plantId);
  if (!plant) return 'unknown-plant';
  if (plant.unlock > state.stage) return 'locked';
  if (state.plants.length >= plantSlots(state.stage)) return 'ring-full';
  if (!(state.seeds >= nextPlantCost(state))) return 'too-expensive';
  return null;
}

/** Kann diese Pflanze jetzt gesetzt werden? (Für den Knopf in der UI.) */
export function canPlant(state: GameState, plantId: string): boolean {
  return plantBlocker(state, plantId) === null;
}

/** Pflanzen, die auf der aktuellen Stufe gesetzt werden können (ohne Blick auf Samen und Ring). */
export function unlockedPlants(state: Pick<GameState, 'stage'>): string[] {
  return PLANTS.filter((p) => p.unlock <= state.stage).map((p) => p.id);
}

/** Lehnt eine Begegnung ab und schreibt Samen gut. */
export function declineEncounter(state: GameState, encounterIndex: number): ActionResult {
  if (!state.pendingEncounters[encounterIndex]) return fail('no-encounter');
  state.seeds = capped(state.seeds + declineReward());
  state.pendingEncounters.splice(encounterIndex, 1);
  return { ok: true };
}

/**
 * Würfelt die Karten einer Begegnung neu (kostet Samen, jedes weitere Mal doppelt so
 * viel) – Tierkarten wie Pflanzenkarten. Die bisherigen Karten kommen nur zum Auffüllen
 * wieder. Kommt keine Karte in Frage oder wären es dieselben Karten, bleibt alles
 * unverändert und es kostet nichts.
 */
export function rerollEncounter(state: GameState, encounterIndex: number): ActionResult {
  const blocker = rerollBlocker(state, encounterIndex);
  if (blocker) return fail(blocker);
  const encounter = state.pendingEncounters[encounterIndex]!;
  state.seeds -= rerollCost(state, encounterIndex);
  encounter.cards = drawCards(state, encounter.type, encounter.cards);
  encounter.rerolls++;
  return { ok: true };
}

/** Kann diese Begegnung jetzt neu gewürfelt werden? (Für den Knopf in der UI.) */
export function canReroll(state: GameState, encounterIndex: number): boolean {
  return rerollBlocker(state, encounterIndex) === null;
}

/**
 * Warum „Neu würfeln“ gerade nicht geht – null, wenn es geht. Verändert den Spielstand
 * nicht (der Zufall wird auf einer Kopie des Generators vorgezogen).
 */
export function rerollBlocker(
  state: GameState,
  encounterIndex: number,
): 'no-encounter' | 'no-cards' | 'no-alternatives' | 'too-expensive' | null {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return 'no-encounter';
  const cards = drawCards(state, encounter.type, encounter.cards, { rngState: state.rngState });
  if (cards.length === 0) return 'no-cards';
  if (sameSet(cards, encounter.cards)) return 'no-alternatives';
  if (!(state.seeds >= rerollCost(state, encounterIndex))) return 'too-expensive';
  return null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));
}
