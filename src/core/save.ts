import { ACHIEVEMENTS_BY_ID } from '../content/achievements';
import { CARE } from '../content/care';
import { COMMUNITIES_BY_ID } from '../content/communities';
import { CARDS_PER_ENCOUNTER, MAX_PENDING_ENCOUNTERS } from '../content/encounters';
import { EVENTS, EVENTS_BY_ID, type CycleEffect, type TimedEffect } from '../content/events';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY, V1_KEEPSAKE_MIN_ENERGY, V1_KEEPSAKE_MIN_STAGE, NEW_CYCLE_MIN_STAGE } from '../content/memory';
import { PLANTS_BY_ID } from '../content/plants';
import { SPECIES_BY_ID } from '../content/species';
import { NICHE_IDS, type Tag } from '../content/types';
import { VISITORS_BY_ID } from '../content/visitors';
import { WAYPOINT_COUNT } from '../content/waypoints';
import { DEFAULT_MAIN_TREE, MAIN_TREES_BY_ID, type MainTreeId } from '../content/trees';
import {
  nicheSlots,
  plantCost,
  plantSlots,
  regularSlots,
  slotBonuses,
  slotEffects,
  stageForWaypoint,
  thresholdFor,
  waypointsForGrowth,
} from './formulas';
import { checkAchievements } from './achievements';
import { isValidRngState, normalizeSeed } from './rng';
import { normalizeElapsed } from './season';
import { MAX_STAT_COUNT, interludeThreshold, isTreeUnlocked, recordDiscoveries } from './tick';
import {
  MAX_FOREST_MEMORY,
  SAVE_VERSION,
  createCycle,
  createInitialState,
  createStats,
  type CycleBonus,
  type CycleState,
  type GameState,
  type LifetimeStats,
  type PendingEncounter,
  type TimedBonus,
} from './state';

export const SAVE_KEY = 'tree-grow-save';
/** Obergrenzen beim Laden: Andenken (Anzahl, Länge der ID) und Neuwürfe je Begegnung. */
export const MAX_KEEPSAKES = 100;
export const MAX_KEEPSAKE_ID_LENGTH = 64;
export const MAX_REROLLS = 1000;

/** Obergrenze für die Zyklus-Nummer beim Laden (Schutz vor kaputten Ständen). */
export const MAX_CYCLE_NUMBER = 1e9;

/**
 * v2 → v3: Prototyp-Stände (ohne Pflanzen) hatten keine Samen-Senke und bringen oft
 * Tausende 🌰 mit. Beim Laden wird der Bestand auf die Kosten der ersten zwei Pflanzen
 * begrenzt (20 + 38 = 58 🌰), damit niemand mit einem Schlag den Pflanzring füllt
 * (Empfehlung DESIGN_V2.md 15.4).
 */
export const V2_SEED_CAP = plantCost(0) + plantCost(1);

/** Ergebnis des Ladens: der Spielstand und ob er aus einem v1-Stand neu angelegt wurde. */
export interface LoadResult {
  state: GameState;
  /** Der gespeicherte Stand war v1 (Wasser/Licht/Energie) und wurde durch einen Neustart ersetzt. */
  migratedFromV1: boolean;
  /** Andenken „Die alte Eiche“ (+5 Waldgedächtnis) wurde vergeben. */
  keepsake: boolean;
  /**
   * Der Stand kam aus v2–v6 und hat Waldgedächtnis oder Andenken: Seit v7 (Balancing 2.10)
   * bringt jeder Punkt +1 % statt +2 % – die Punkte selbst bleiben (bewusste Entscheidung,
   * DESIGN_V2.md 15.4). Nur ein Hinweis für die Oberfläche, nicht Teil des Spielstands.
   */
  memoryReweighted: boolean;
  /**
   * Migration v8 → v9: so viele Erfolge hat der Stand schon erfüllt und still nachgetragen
   * bekommen (die Oberfläche meldet sie gesammelt, nicht einzeln). Sonst 0.
   */
  achievementsBackfilled: number;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Liest einen gespeicherten Stand. Unbekannte oder kaputte Felder werden durch
 * Startwerte ersetzt, damit ein alter Spielstand das Spiel nie zum Absturz bringt.
 * Gibt null zurück, wenn gar nichts Brauchbares vorliegt.
 */
export function loadGame(raw: string | null, now: number): LoadResult | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const version = typeof data.version === 'number' && Number.isFinite(data.version) ? data.version : 1;
  if (version < 2) return migrateV1(data, now);
  const state = loadV2(data, now, version);
  if (version < 3) migrateV2(state);
  if (version < 4) migrateV3(state);
  if (version < 5) migrateV4(state);
  if (version < 6) migrateV5(state);
  if (version < 8) migrateV7(state);
  // v6 → v7 (Balancing 2.10): nur die Wegpunkt-Kurve – schon in loadV2 umgerechnet
  // (v6GrowthToV7), bevor Wegpunkt, Stufe und Zwischenhalt abgeleitet werden.
  // Erst nach der Migration: sie verwirft z. B. Pflanzen, die v2 nicht kannte. Führt
  // auch H_max nach (die aktuelle Harmonie zählt schon für diesen Zyklus).
  recordDiscoveries(state);
  // v6 → v7: Waldgedächtnis +1 % statt +2 % je Punkt, Punkte unverändert → einmal Hinweis.
  const memoryReweighted = version < 7 && (state.meta.forestMemory > 0 || state.meta.journal.keepsakes.length > 0);
  // v8 → v9 (Erfolge): ganz zuletzt, wenn Tagebuch, Statistik und H_max feststehen.
  const achievementsBackfilled = version < 9 ? migrateV8(state) : 0;
  return { state, migratedFromV1: false, keepsake: false, memoryReweighted, achievementsBackfilled };
}

/** Wie loadGame, aber nur der Spielstand. */
export function deserialize(raw: string | null, now: number): GameState | null {
  return loadGame(raw, now)?.state ?? null;
}

/**
 * v1 → v2: sauberer Neustart (Wasser/Licht/Energie/Upgrades haben keine Entsprechung).
 * Wer in v1 mindestens „Junger Baum“ erreicht hat, bekommt das Andenken „Die alte
 * Eiche“: +5 Waldgedächtnis. Keine Offline-Zeit – die Uhr startet jetzt.
 */
function migrateV1(data: Record<string, unknown>, now: number): LoadResult {
  const oldLastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now, now + oldLastTick);
  const keepsake =
    finiteOr(data.stage, 0) >= V1_KEEPSAKE_MIN_STAGE || finiteOr(data.totalEnergy, 0) >= V1_KEEPSAKE_MIN_ENERGY;
  if (keepsake) {
    state.meta.forestMemory += V1_KEEPSAKE_MEMORY;
    state.meta.journal.keepsakes.push(V1_KEEPSAKE_ID);
  }
  return { state, migratedFromV1: true, keepsake, memoryReweighted: false, achievementsBackfilled: 0 };
}

/** Wegpunkt-Kurve der v2-Stände (Prototyp ohne Pflanzen): Wegpunkt k bei 4 · k^3,2. */
export const V2_WAYPOINT_BASE = 4;
export const V2_WAYPOINT_POWER = 3.2;

function v2Threshold(k: number): number {
  return k <= 0 ? 0 : Math.round(V2_WAYPOINT_BASE * Math.pow(k, V2_WAYPOINT_POWER));
}

/** Erreichte Wegpunkte auf einer (früheren) Kurve. */
function waypointsOnCurve(growth: number, threshold: (k: number) => number): number {
  let k = 0;
  while (k < WAYPOINT_COUNT && growth >= threshold(k + 1)) k++;
  return k;
}

/**
 * Bildet Gesamt-Wachstum von einer früheren Wegpunkt-Kurve auf dieselbe Stelle der
 * aktuellen Kurve ab: gleicher Wegpunkt, gleicher Bruchteil bis zum nächsten. So bleibt
 * die Stufe erhalten (kein Zurückstufen, keine entlassenen Tiere, keine doppelten
 * Wegpunkte). Hinter dem letzten Wegpunkt wird im Verhältnis der beiden Kurven skaliert.
 * Exportiert für Tests.
 */
export function growthToCurrentCurve(growth: number, threshold: (k: number) => number): number {
  if (!(growth > 0)) return 0;
  const k = waypointsOnCurve(growth, threshold);
  if (k >= WAYPOINT_COUNT) {
    const scaled = thresholdFor(WAYPOINT_COUNT) * (growth / threshold(WAYPOINT_COUNT));
    return Math.min(Number.MAX_VALUE, scaled);
  }
  const from = threshold(k);
  const to = threshold(k + 1);
  const fraction = Math.min(1, Math.max(0, (growth - from) / (to - from)));
  const newFrom = thresholdFor(k);
  const newTo = thresholdFor(k + 1);
  const result = newFrom + fraction * (newTo - newFrom);
  // Rundung darf nie unter den erreichten Wegpunkt fallen – und nie den nächsten erreichen
  // (ein Bruchteil knapp unter 1 kann im Gleitkomma auf genau newTo runden).
  return Math.max(newFrom, Math.min(result, below(newTo)));
}

/** Die größte Gleitkommazahl unter x (x > 0, endlich). */
function below(x: number): number {
  const y = x - x * Number.EPSILON;
  return y < x ? y : x - Number.MIN_VALUE;
}

/**
 * Umkehrung von growthToCurrentCurve: Gesamt-Wachstum der aktuellen Kurve → dieselbe Stelle
 * (Wegpunkt und Bruchteil bis zum nächsten) auf einer früheren Kurve.
 */
function growthFromCurrentCurve(growth: number, threshold: (k: number) => number): number {
  if (!(growth > 0)) return 0;
  const k = waypointsForGrowth(growth);
  if (k >= WAYPOINT_COUNT) return threshold(WAYPOINT_COUNT) * (growth / thresholdFor(WAYPOINT_COUNT));
  const share = (growth - thresholdFor(k)) / (thresholdFor(k + 1) - thresholdFor(k));
  return threshold(k) + share * (threshold(k + 1) - threshold(k));
}

/** v2-Stand (4 · k^3,2) → aktuelle Kurve (siehe growthToCurrentCurve). */
export function v2GrowthToCurrent(growth: number): number {
  return growthToCurrentCurve(growth, v2Threshold);
}

/**
 * Wegpunkt-Kurve der Stände v3 bis v6 (Schritt 2.1 bis Jahreszeiten): Wegpunkt k bei
 * 3,5 · k^3,4. Seit v7 (Balancing 2.10) gilt 3,5 · k^3,5 (content/waypoints.ts).
 */
export const V6_WAYPOINT_BASE = 3.5;
export const V6_WAYPOINT_POWER = 3.4;

/** Gesamt-Wachstum für Wegpunkt k auf der Kurve der Stände v3–v6. */
export function v6Threshold(k: number): number {
  return k <= 0 ? 0 : Math.round(V6_WAYPOINT_BASE * Math.pow(k, V6_WAYPOINT_POWER));
}

/**
 * v3–v6-Stand (3,5 · k^3,4) → aktuelle Kurve: gleicher Wegpunkt, gleicher Bruchteil bis
 * zum nächsten (siehe growthToCurrentCurve) – Stufe, Tiere und Zwischenhalt bleiben.
 */
export function v6GrowthToV7(growth: number): number {
  return growthToCurrentCurve(growth, v6Threshold);
}

/**
 * Umkehrung von v6GrowthToV7: aktuelle Kurve → Kurve der Stände v3–v6. Für Tests und
 * e2e-Fixtures (ein v3-Stand mit `v7GrowthToV6(g)` lädt bei g).
 */
export function v7GrowthToV6(growth: number): number {
  return growthFromCurrentCurve(growth, v6Threshold);
}

/** v2 → v3: noch keine Pflanzen; Samen-Bestand begrenzen (siehe V2_SEED_CAP). */
function migrateV2(state: GameState): void {
  state.plants = [];
  state.seeds = Math.min(state.seeds, V2_SEED_CAP);
}

/**
 * v3 → v4 (Neuer Zyklus): Vor v4 gab es keinen Zyklusstart, also läuft noch der erste
 * Zyklus – alle Arten im Tagebuch wurden in ihm entdeckt und zählen fürs Waldgedächtnis.
 * H_max ergänzt loadGame aus dem aktuellen Ökosystem; Stammgäste gibt es noch keine.
 */
function migrateV3(state: GameState): void {
  // Nur die v4-Felder setzen: Was das Laden schon ergänzt hat (z. B. wartende Ereignisse
  // in `seen`), bleibt erhalten.
  state.cycle.number = 1;
  state.cycle.maxHarmony = 0;
  state.cycle.newSpecies = [...state.meta.journal.species];
  state.meta.regulars = [];
}

/**
 * v4 → v5 (Ereignisse und Durchreisende): Die neuen Zyklusfelder starten leer (das
 * Laden setzt sie so). Liegt der Stand schon hinter dem Zwischenhalt des laufenden
 * Abschnitts, gilt er als ausgewertet – sonst käme direkt nach dem Update ein Ereignis.
 */
function migrateV4(state: GameState): void {
  state.cycle.interlude = 0;
  if (state.totalGrowth >= interludeThreshold(state)) state.cycle.interlude = state.waypoint;
}

/**
 * v5 → v6 (Jahreszeiten und Hauptbaum-Arten, DESIGN_V2.md 16.6, 17.5): Der laufende
 * Zyklus beginnt im Frühling (`elapsed = 0` – harmlos, nichts geht verloren) und wächst
 * als Stieleiche weiter, wie bisher. Plätze der Eiche (+1 Krone ab Junger Baum) kommen
 * dazu, gekürzt wird nichts.
 */
function migrateV5(state: GameState): void {
  state.cycle.elapsed = 0;
  state.cycle.mainTree = DEFAULT_MAIN_TREE;
}

/**
 * v7 → v8 (Langzeit-Statistik `meta.stats`, DESIGN_V2.md 12.5): Frühere Zyklen sind nicht
 * bekannt – die Statistik beginnt beim laufenden Zyklus: Spielzeit = `cycle.elapsed`,
 * Wachstum abgeschlossener Zyklen = 0 (Gesamt-Wachstum also `totalGrowth`), beste
 * Harmonie = H_max, alle Zähler 0. Gewachsen ist die aktuelle Baumart; ab Zyklus 2 auch
 * die Stieleiche, denn jeder erste Zyklus beginnt mit ihr (DEFAULT_MAIN_TREE, zuerst).
 * Was ein älterer Stand unter `meta.stats` mitbringt, zählt nicht. Läuft nach den älteren
 * Migrationen (Spielzeit und Baumart stehen dann fest).
 */
function migrateV7(state: GameState): void {
  const grownTrees = unique(
    state.cycle.number > 1 ? [DEFAULT_MAIN_TREE, state.cycle.mainTree] : [state.cycle.mainTree],
  ) as MainTreeId[];
  state.meta.stats = {
    ...createStats(state.cycle.mainTree),
    playSeconds: state.cycle.elapsed,
    bestHarmony: state.cycle.maxHarmony,
    grownTrees,
  };
}

/**
 * v8 → v9 (Erfolge, DESIGN_V2.md 18): Alles, was der Stand schon erfüllt, wird still
 * freigeschaltet (Reihenfolge wie ACHIEVEMENTS). Ab Zyklus 2 ist sicher, dass schon einmal
 * die Stufe für den Neuen Zyklus (Hain) erreicht war – die Stufen-Erfolge bis dorthin
 * kommen darum mit, ohne die Stufe im Spielstand zu ändern. Was frühere Zyklen sonst
 * erreicht haben, aber der Stand nicht mehr zeigt (z. B. Urwald, ein volles Jahr), ist
 * nicht bekannt und kommt beim nächsten Erreichen. Was ein älterer Stand unter
 * `meta.achievements` mitbringt, zählt nicht. Gibt die Anzahl zurück.
 */
function migrateV8(state: GameState): number {
  state.meta.achievements = [];
  const minStage = state.cycle.number > 1 ? NEW_CYCLE_MIN_STAGE : 0;
  return checkAchievements(state, { minStage }).length;
}

/**
 * Relative Toleranz für die Untergrenze `playSeconds ≥ cycle.elapsed` beim Laden: Beide
 * werden getrennt aufsummiert (Statistik je Tick um dt, `elapsed` je Schritt und an
 * Jahreszeitgrenzen exakt gesetzt), liegen also nach echtem Spiel um Rundungsrauschen
 * auseinander. Das darf Speichern + Laden nicht verändern.
 */
export const PLAY_SECONDS_TOLERANCE = 1e-6;

/**
 * Langzeit-Statistik robust laden (seit v8): fehlende, kaputte oder negative Zahlen → 0,
 * ±Infinity → Grenze, Zähler ganzzahlig. Untergrenzen aus dem laufenden Zyklus – über alle
 * Zyklen ist nie weniger als im laufenden (Spielzeit bis auf Rundungsrauschen, H_max,
 * aktuelle Baumart). Das Wachstum braucht keine: Gesamt = abgeschlossene Zyklen +
 * `totalGrowth` (lifetimeGrowth). Baumarten nur bekannte, freigeschaltete (`unlocked`) und
 * je einmal, in gespeicherter Reihenfolge; die aktuelle kommt dazu, falls sie fehlt.
 */
function loadStats(raw: unknown, state: GameState, unlocked: (id: MainTreeId) => boolean): LifetimeStats {
  const r = isRecord(raw) ? raw : {};
  const amount = (value: unknown) => clampedOr(value, 0, 0, Number.MAX_VALUE);
  const count = (value: unknown) => Math.floor(clampedOr(value, 0, 0, MAX_STAT_COUNT));
  const grownTrees = unique(stringArray(r.grownTrees)).filter(
    (id): id is MainTreeId => MAIN_TREES_BY_ID.has(id as MainTreeId) && unlocked(id as MainTreeId),
  );
  if (!grownTrees.includes(state.cycle.mainTree)) grownTrees.push(state.cycle.mainTree);
  const elapsed = state.cycle.elapsed;
  let playSeconds = amount(r.playSeconds);
  if (playSeconds < elapsed - Math.max(PLAY_SECONDS_TOLERANCE, elapsed * PLAY_SECONDS_TOLERANCE)) playSeconds = elapsed;
  return {
    playSeconds,
    completedCyclesGrowth: amount(r.completedCyclesGrowth),
    bestHarmony: Math.max(state.cycle.maxHarmony, amount(r.bestHarmony)),
    cardsChosen: count(r.cardsChosen),
    eventsDecided: count(r.eventsDecided),
    visitorsHosted: count(r.visitorsHosted),
    plantsPlanted: count(r.plantsPlanted),
    careRanksBought: count(r.careRanksBought),
    grownTrees,
  };
}

/**
 * Robustes Laden eines Stands ab v2 (DESIGN_V2.md, 12.3). Felder, die es in v2 noch
 * nicht gab (Pflanzen), fehlen dort einfach und bleiben leer.
 */
function loadV2(data: Record<string, unknown>, now: number, version: number): GameState {
  const lastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now);
  state.version = SAVE_VERSION;
  state.lastTick = lastTick;
  // ±Infinity (z. B. „1e400“ im JSON) wird auf den größten endlichen Wert begrenzt.
  state.totalGrowth = clampedOr(data.totalGrowth, 0, 0, Number.MAX_VALUE);
  // v2 und v3–v6 rechneten mit anderen Wegpunkt-Kurven: erst auf die aktuelle umrechnen
  // (direkt, nicht über die v6-Kurve), dann Wegpunkt und Stufe ableiten.
  if (version < 3) state.totalGrowth = v2GrowthToCurrent(state.totalGrowth);
  else if (version < 7) state.totalGrowth = v6GrowthToV7(state.totalGrowth);
  state.seeds = clampedOr(data.seeds, 0, 0, Number.MAX_VALUE);
  // Wegpunkt und Stufe immer aus dem Gesamt-Wachstum ableiten.
  state.waypoint = waypointsForGrowth(state.totalGrowth);
  state.stage = stageForWaypoint(state.waypoint);

  // Seit v5: Ereignis-Boni, Habitate, Gäste … – vor den Nischen, denn Platz-Boni zählen
  // beim Kürzen mit.
  const cycle = isRecord(data.cycle) ? data.cycle : {};
  const meta = isRecord(data.meta) ? data.meta : {};
  const journal = isRecord(meta.journal) ? meta.journal : {};
  // Begleitpflanzen: unbekannte IDs verwerfen (Duplikate sind erlaubt), auf den Pflanzring
  // kürzen. Vor dem Zyklus, denn sie schalten Baumarten frei.
  state.plants = stringArray(data.plants)
    .filter((id) => PLANTS_BY_ID.has(id))
    .slice(0, plantSlots(state.stage));
  // Pflanzen im Tagebuch schalten Baumarten frei. Was gerade (gültig) im Ring wächst, trägt
  // loadGame ohnehin nach (recordDiscoveries) – es zählt darum schon hier. Rohdaten jenseits
  // des Rings zählen nicht (sonst ließe sich eine gesperrte Art per Import setzen).
  const knownPlants = [...stringArray(journal.plants).filter((id) => PLANTS_BY_ID.has(id)), ...state.plants];
  loadCycleExtras(cycle, state, knownPlants, version);
  // Platz-Boni aus Ereignissen, Pflege und der Baumart (seit v6) zählen beim Kürzen mit.
  const bonusSlots = slotBonuses(state);

  // Nischen: unbekannte Arten und Duplikate verwerfen, jede Art in ihre eigene Nische,
  // auf die aktuelle Platzzahl kürzen. Fehlende Nischen (z. B. „hollows“ aus älteren
  // v2-Ständen) bleiben leer. Arten, die Plätze schaffen (Borkenkäfer → Höhlen, Schwarzspecht), ziehen
  // zuerst ein, damit ihre Plätze beim Kürzen schon zählen; danach gilt wieder die
  // gespeicherte Reihenfolge.
  const niches = isRecord(data.niches) ? data.niches : {};
  const candidates: string[] = [];
  for (const nicheId of NICHE_IDS) {
    for (const id of stringArray(niches[nicheId])) if (SPECIES_BY_ID.has(id) && !candidates.includes(id)) candidates.push(id);
  }
  const createsSlots = (id: string) => slotEffects(SPECIES_BY_ID.get(id)!).length > 0;
  // Alle gespeicherten Arten haben hier gelebt – auch gekürzte bleiben im Tagebuch.
  const seen = new Set<string>(candidates);
  for (const id of [...candidates.filter(createsSlots), ...candidates.filter((x) => !createsSlots(x))]) {
    const sp = SPECIES_BY_ID.get(id)!;
    if (state.niches[sp.niche].length >= nicheSlots(state.stage, state.niches, bonusSlots)[sp.niche]) continue;
    state.niches[sp.niche].push(id);
  }
  for (const nicheId of NICHE_IDS) {
    state.niches[nicheId].sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
  }
  // Sicherheitsnetz: Kürzen kann Platz-Schaffer entfernt haben – überzählige Tiere von hinten entlassen.
  for (let changed = true; changed; ) {
    changed = false;
    const slots = nicheSlots(state.stage, state.niches, bonusSlots);
    for (const nicheId of NICHE_IDS) {
      if (state.niches[nicheId].length > slots[nicheId]) {
        state.niches[nicheId].pop();
        changed = true;
        break;
      }
    }
  }

  // Offene Begegnungen: ungültige Karten entfernen, leere verwerfen, höchstens 3.
  // Pflanzen-Begegnungen („Etwas keimt“) haben Pflanzen-IDs als Karten, Ereignisse und
  // Gäste genau eine ID (seit v5); alles andere (auch fehlender Typ) gilt als
  // Tierbegegnung. Unbekannte Typen aus späteren Versionen verlieren so ihre Karten und
  // fallen weg.
  if (Array.isArray(data.pendingEncounters)) {
    for (const raw of data.pendingEncounters) {
      if (state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS) break;
      if (!isRecord(raw)) continue;
      const type = raw.type === 'plant' || raw.type === 'event' || raw.type === 'visitor' ? raw.type : 'animal';
      const valid: (id: string) => boolean =
        type === 'plant'
          ? // Pflanzenkarten müssen auf dieser Stufe freigeschaltet sein.
            (id) => (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= state.stage
          : type === 'event'
            ? (id) => EVENTS_BY_ID.has(id)
            : type === 'visitor'
              ? (id) => VISITORS_BY_ID.has(id)
              : (id) => SPECIES_BY_ID.has(id);
      const single = type === 'event' || type === 'visitor';
      const cards = unique(stringArray(raw.cards).filter(valid)).slice(0, single ? 1 : CARDS_PER_ENCOUNTER);
      if (cards.length === 0) continue;
      if (single) {
        const id = cards[0]!;
        // Jedes Ereignis und jeder Gast höchstens einmal: keine Doppel in der Warteschlange,
        // kein Gast, der schon rastet, kein Ereignis, dessen Wirkungen schon vergeben sind.
        if (state.pendingEncounters.some((e) => e.cards[0] === id && e.type === type)) continue;
        if (type === 'visitor' && state.cycle.visitors.some((v) => v.id === id)) continue;
        if (type === 'event' && [...state.cycle.bonuses, ...state.cycle.timed].some((b) => b.source === id)) continue;
      }
      const encounter: PendingEncounter = {
        type,
        cards,
        rerolls: single ? 0 : Math.floor(clampedOr(raw.rerolls, 0, 0, MAX_REROLLS)),
      };
      state.pendingEncounters.push(encounter);
      // Wartende Ereignisse und Gäste sind gezogen, also gesehen.
      if (single && !state.cycle.seen.includes(cards[0]!)) state.cycle.seen.push(cards[0]!);
    }
  }
  // Zwischenhalt: höchstens bis zum aktuellen Wegpunkt ausgewertet.
  state.cycle.interlude = Math.min(state.cycle.interlude, state.waypoint);

  state.rngState = isValidRngState(data.rngState) ? data.rngState : normalizeSeed(lastTick);

  state.meta.forestMemory = clampedOr(meta.forestMemory, 0, 0, MAX_FOREST_MEMORY);
  state.meta.journal.species = unique(stringArray(journal.species).filter((id) => SPECIES_BY_ID.has(id)));
  for (const id of seen) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  // Andenken sind freie IDs: Anzahl und Länge begrenzen (fremde oder manipulierte Stände).
  state.meta.journal.keepsakes = unique(stringArray(journal.keepsakes))
    .filter((id) => id.length > 0 && id.length <= MAX_KEEPSAKE_ID_LENGTH)
    .slice(0, MAX_KEEPSAKES);
  // Pflanzen und Lebensgemeinschaften im Tagebuch (seit Schritt 2.3, ohne neue Version):
  // fehlen sie (ältere Stände), ergänzt loadGame sie per recordDiscoveries aus dem Ökosystem.
  state.meta.journal.plants = unique(stringArray(journal.plants).filter((id) => PLANTS_BY_ID.has(id)));
  state.meta.journal.communities = unique(stringArray(journal.communities).filter((id) => COMMUNITIES_BY_ID.has(id)));

  // Seit v4: laufender Zyklus und Stammgäste (ältere Stände: migrateV3 setzt sie).
  const discovered = new Set(state.meta.journal.species);
  state.cycle.number = Math.floor(clampedOr(cycle.number, 1, 1, MAX_CYCLE_NUMBER));
  state.cycle.maxHarmony = clampedOr(cycle.maxHarmony, 0, 0, Number.MAX_VALUE);
  state.cycle.newSpecies = unique(stringArray(cycle.newSpecies).filter((id) => discovered.has(id)));
  if (typeof cycle.startedAt === 'number' && Number.isFinite(cycle.startedAt)) state.cycle.startedAt = cycle.startedAt;
  state.meta.regulars = unique(stringArray(meta.regulars).filter((id) => discovered.has(id))).slice(
    0,
    regularSlots(state.meta.forestMemory),
  );
  // Seit v8: Langzeit-Statistik (ältere Stände: migrateV7 setzt sie).
  const known = { meta: { ...state.meta, journal: { ...state.meta.journal, plants: [...state.meta.journal.plants, ...state.plants] } } };
  state.meta.stats = loadStats(version >= 8 ? meta.stats : undefined, state, (id) => isTreeUnlocked(known, id));
  // Seit v9: Erfolge – nur bekannte IDs, je einmal, gespeicherte Reihenfolge (ältere Stände:
  // migrateV8). Ob sie erfüllt sind, lässt sich nicht prüfen (frühere Zyklen) – sie bleiben.
  state.meta.achievements =
    version >= 9 ? unique(stringArray(meta.achievements)).filter((id) => ACHIEVEMENTS_BY_ID.has(id)) : [];
  return state;
}

/** Alle Wirkungen einer Art aus allen Ereignis-Optionen (für die Prüfung beim Laden). */
function eventEffects<K extends 'cycle' | 'timed' | 'habitat'>(eventId: string, kind: K) {
  const out: Extract<(typeof EVENTS)[number]['options'][number]['effects'][number], { kind: K }>[] = [];
  for (const option of EVENTS_BY_ID.get(eventId)?.options ?? []) {
    for (const e of option.effects) if (e.kind === kind) out.push(e as (typeof out)[number]);
  }
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lädt die Zyklusfelder für Ereignisse und Gäste (seit v5) robust: Boni, Zeit-Boni und
 * Habitate nur, wenn ein Ereignis sie wirklich vergibt (Schutz vor manipulierten
 * Ständen), Restdauern begrenzt auf (0, Dauer], Gäste nur bekannte. Seit v6 auch
 * Spielzeit (wie normalizeElapsed, keine Zahl → 0) und Hauptbaum (bekannt und über
 * `knownPlants` freigeschaltet, sonst DEFAULT_MAIN_TREE). Ältere Stände (< v6) kannten
 * beides nicht: Was dort steht, zählt nicht (Frühling, Eiche) – so kürzt loadV2 die
 * Nischen auch nicht mit den Plätzen einer fremden Art.
 */
function loadCycleExtras(raw: Record<string, unknown>, state: GameState, knownPlants: readonly string[], version: number): void {
  const cycle: CycleState = createCycle(1);
  if (version >= 6) {
    // −Infinity und negative Werte → 0 (Frühling), +Infinity und sehr große → MAX_ELAPSED.
    cycle.elapsed = typeof raw.elapsed === 'number' ? normalizeElapsed(raw.elapsed) : 0;
    const tree = typeof raw.mainTree === 'string' ? MAIN_TREES_BY_ID.get(raw.mainTree as MainTreeId) : undefined;
    const known: Pick<GameState, 'meta'> = { ...state, meta: { ...state.meta, journal: { ...state.meta.journal, plants: [...knownPlants] } } };
    cycle.mainTree = tree && isTreeUnlocked(known, tree.id) ? tree.id : DEFAULT_MAIN_TREE;
  }
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) cycle.startedAt = raw.startedAt;
  cycle.seen = unique(stringArray(raw.seen).filter((id) => EVENTS_BY_ID.has(id) || VISITORS_BY_ID.has(id)));
  // Wirkungen nur von Ereignissen, die in diesem Zyklus gezogen wurden, und je (Quelle,
  // Wirkung) höchstens einmal – so lassen sich Boni nicht durch Kopieren vervielfachen.
  const seen = new Set(cycle.seen);
  const taken = new Set<string>();
  const once = (kind: string, source: string, effect: unknown) => {
    const key = `${kind}|${source}|${JSON.stringify(effect)}`;
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  };
  for (const b of Array.isArray(raw.bonuses) ? raw.bonuses : []) {
    if (!isRecord(b) || typeof b.source !== 'string' || !seen.has(b.source)) continue;
    const effect = eventEffects(b.source, 'cycle').find((e) => sameJson(e.effect, b.effect))?.effect;
    if (effect && once('cycle', b.source, effect)) cycle.bonuses.push({ source: b.source, effect: effect as CycleEffect } satisfies CycleBonus);
  }
  // Habitate: je Merkmal höchstens so oft, wie die gezogenen Ereignisse es vergeben können.
  const allowed = new Map<string, number>();
  for (const id of cycle.seen) {
    const perTag = new Map<string, number>();
    for (const option of EVENTS_BY_ID.get(id)?.options ?? []) {
      const counts = new Map<string, number>();
      for (const e of option.effects) if (e.kind === 'habitat') counts.set(e.tag, (counts.get(e.tag) ?? 0) + 1);
      for (const [tag, n] of counts) perTag.set(tag, Math.max(perTag.get(tag) ?? 0, n));
    }
    for (const [tag, n] of perTag) allowed.set(tag, (allowed.get(tag) ?? 0) + n);
  }
  for (const tag of stringArray(raw.habitats)) {
    const left = allowed.get(tag) ?? 0;
    if (left <= 0) continue;
    allowed.set(tag, left - 1);
    cycle.habitats.push(tag as Tag);
  }
  for (const t of Array.isArray(raw.timed) ? raw.timed : []) {
    if (!isRecord(t) || typeof t.source !== 'string' || !seen.has(t.source)) continue;
    const timed = eventEffects(t.source, 'timed').find((e) => sameJson(e.effect, t.effect));
    const remaining = finiteOr(t.remaining, 0);
    if (!timed || !(remaining > 0) || !once('timed', t.source, timed.effect)) continue;
    cycle.timed.push({ source: t.source, effect: timed.effect as TimedEffect, remaining: Math.min(remaining, timed.seconds) } satisfies TimedBonus);
  }
  for (const v of Array.isArray(raw.visitors) ? raw.visitors : []) {
    if (!isRecord(v) || typeof v.id !== 'string' || !seen.has(v.id)) continue;
    const visitor = VISITORS_BY_ID.get(v.id);
    const remaining = finiteOr(v.remaining, 0);
    if (!visitor || !(remaining > 0) || cycle.visitors.some((x) => x.id === v.id)) continue;
    cycle.visitors.push({ id: v.id, remaining: Math.min(remaining, visitor.stay) });
  }
  if (isRecord(raw.forced) && (raw.forced.type === 'animal' || raw.forced.type === 'plant')) {
    const type = raw.forced.type;
    // Nur IDs, die ein Ereignis wirklich als nächste Begegnung desselben Typs vorgibt.
    const offered = new Set(
      EVENTS.flatMap((e) => e.options.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'nextEncounter' && x.type === type ? x.ids : [])))),
    );
    const ids = unique(stringArray(raw.forced.ids).filter((id) => offered.has(id)));
    if (ids.length > 0) cycle.forced = { type, ids };
  }
  cycle.interlude = Math.floor(clampedOr(raw.interlude, 0, 0, WAYPOINT_COUNT));
  // Pflege (Schritt 2.7, additiv in v5): fehlt das Feld, bleibt es leer. Nur bekannte
  // Maßnahmen, Ränge ganzzahlig und höchstens bis zum letzten Rang, den die aktuelle Stufe
  // erlaubt. Schließen sich Maßnahmen aus (Lichte/Dichte Krone), bleibt nur die erste in
  // CARE-Reihenfolge. `requires` gilt bewusst nur beim Kauf, nicht beim Laden.
  if (isRecord(raw.care)) {
    for (const measure of CARE) {
      if (!Object.hasOwn(raw.care, measure.id)) continue;
      let allowed = 0;
      while (allowed < measure.ranks.length && measure.ranks[allowed]!.minStage <= state.stage) allowed++;
      const r = Math.floor(clampedOr(raw.care[measure.id], 0, 0, allowed));
      if (r <= 0 || (measure.excludes ?? []).some((x) => (cycle.care[x] ?? 0) > 0)) continue;
      cycle.care[measure.id] = r;
    }
  }
  state.cycle = cycle;
}

export function saveToStorage(state: GameState, storage: Storage = localStorage): void {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
  } catch {
    // Speicher voll oder blockiert (z. B. privater Modus) – Spiel läuft trotzdem weiter.
  }
}

export function loadFromStorage(now: number, storage: Storage = localStorage): LoadResult | null {
  try {
    return loadGame(storage.getItem(SAVE_KEY), now);
  } catch {
    return null;
  }
}

export function clearStorage(storage: Storage = localStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // ignorieren
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Zahl in [min, max]; NaN und Nicht-Zahlen → fallback, ±Infinity → Grenze. */
function clampedOr(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// Spielstand als Text-Code (Exportieren / Importieren)
// ---------------------------------------------------------------------------

/** Präfix des Text-Codes („Vom Samen zum Wald“, Format 1). */
export const EXPORT_PREFIX = 'VSZW1:';
/** Längere Codes werden gar nicht erst dekodiert (Schutz vor riesigen Eingaben). */
export const MAX_EXPORT_CODE_LENGTH = 200_000;

/** Warum ein Code nicht geladen werden konnte. */
export type ImportError =
  /** Leere Eingabe. */
  | 'empty'
  /** Länger als MAX_EXPORT_CODE_LENGTH. */
  | 'too-large'
  /** Kein Code dieses Spiels (Präfix, Aufbau oder Zeichen falsch). */
  | 'format'
  /** Prüfsumme passt nicht – der Code wurde unvollständig oder verändert kopiert. */
  | 'checksum'
  /** Der Inhalt ist kein brauchbarer Spielstand. */
  | 'invalid';

export type ImportResult = { ok: true; result: LoadResult } | { ok: false; error: ImportError };

/**
 * Spielstand als Text-Code: `VSZW1:<Base64url des JSON>.<Prüfsumme>`. Deterministisch
 * (gleicher Stand → gleicher Code), nur URL-sichere Zeichen, ohne Zeilenumbrüche.
 */
export function exportCode(state: GameState): string {
  return codeFromJson(serialize(state));
}

/** Kodiert einen gespeicherten Stand (JSON-Text, auch ältere Versionen) als Text-Code. */
export function codeFromJson(json: string): string {
  const payload = base64UrlEncode(new TextEncoder().encode(json));
  return `${EXPORT_PREFIX}${payload}.${checksum(payload)}`;
}

/**
 * Liest einen Text-Code und lädt ihn wie einen gespeicherten Stand (loadGame: robust,
 * mit Migration alter Versionen). Leerraum (Zeilenumbrüche beim Kopieren) wird ignoriert.
 * Die Uhr startet beim Import neu (`lastTick = now`) – ein Import bringt keine
 * Offline-Zeit. Verändert nichts außerhalb des Ergebnisses. Mit `keepClock` bleibt die Uhr
 * des Codes stehen (Konto-Abgleich: die Zeit seit dem Speichern wird nachgerechnet).
 */
export function importCode(code: string, now: number, options: { keepClock?: boolean } = {}): ImportResult {
  // Grobe Prüfung vor dem Entfernen des Leerraums (riesige Eingaben gar nicht erst anfassen).
  if (code.length > 2 * MAX_EXPORT_CODE_LENGTH) return { ok: false, error: 'too-large' };
  const compact = code.replace(/\s+/g, '');
  if (compact.length === 0) return { ok: false, error: 'empty' };
  if (compact.length > MAX_EXPORT_CODE_LENGTH) return { ok: false, error: 'too-large' };
  if (!compact.startsWith(EXPORT_PREFIX)) return { ok: false, error: 'format' };
  const body = compact.slice(EXPORT_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'format' };
  const payload = body.slice(0, dot);
  const sum = body.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{8}$/.test(sum)) return { ok: false, error: 'format' };
  if (checksum(payload) !== sum) return { ok: false, error: 'checksum' };
  const bytes = base64UrlDecode(payload);
  if (!bytes) return { ok: false, error: 'format' };
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  let result: LoadResult | null;
  try {
    result = loadGame(json, now);
  } catch {
    // z. B. zu tief verschachteltes JSON – lieber „ungültig“ als ein Absturz.
    return { ok: false, error: 'invalid' };
  }
  if (!result) return { ok: false, error: 'invalid' };
  if (!options.keepClock) result.state.lastTick = now;
  return { ok: true, result };
}

/** FNV-1a (32 Bit) über die Zeichen – einfach und deterministisch, als 8 Hex-Ziffern. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url ohne Auffüllzeichen (eigene Umsetzung, damit der Kern ohne btoa auskommt). */
function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]!;
    if (b !== undefined) out += BASE64URL[(n >> 6) & 63]!;
    if (c !== undefined) out += BASE64URL[n & 63]!;
  }
  return out;
}

/** Gegenstück zu base64UrlEncode; null bei unmöglicher Länge oder fremden Zeichen. */
function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = k < chunk.length ? BASE64URL.indexOf(chunk[k]!) : 0;
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    out[o++] = (n >> 16) & 255;
    if (chunk.length > 2) out[o++] = (n >> 8) & 255;
    if (chunk.length > 3) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
