import { COMMUNITIES_BY_ID } from '../content/communities';
import { CARDS_PER_ENCOUNTER, MAX_PENDING_ENCOUNTERS } from '../content/encounters';
import { EVENTS, EVENTS_BY_ID, type CycleEffect, type TimedEffect } from '../content/events';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY, V1_KEEPSAKE_MIN_ENERGY, V1_KEEPSAKE_MIN_STAGE } from '../content/memory';
import { PLANTS_BY_ID } from '../content/plants';
import { SPECIES_BY_ID } from '../content/species';
import { NICHE_IDS, type Tag } from '../content/types';
import { VISITORS_BY_ID } from '../content/visitors';
import { WAYPOINT_COUNT } from '../content/waypoints';
import {
  cycleSlotBonuses,
  nicheSlots,
  plantCost,
  plantSlots,
  regularSlots,
  slotEffects,
  stageForWaypoint,
  thresholdFor,
  waypointsForGrowth,
} from './formulas';
import { isValidRngState, normalizeSeed } from './rng';
import { interludeThreshold, recordDiscoveries } from './tick';
import {
  MAX_FOREST_MEMORY,
  SAVE_VERSION,
  createCycle,
  createInitialState,
  type CycleBonus,
  type CycleState,
  type GameState,
  type PendingEncounter,
  type TimedBonus,
} from './state';

export const SAVE_KEY = 'tree-grow-save';

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
  // Erst nach der Migration: sie verwirft z. B. Pflanzen, die v2 nicht kannte. Führt
  // auch H_max nach (die aktuelle Harmonie zählt schon für diesen Zyklus).
  recordDiscoveries(state);
  return { state, migratedFromV1: false, keepsake: false };
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
  return { state, migratedFromV1: true, keepsake };
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
 */
function growthToCurrentCurve(growth: number, threshold: (k: number) => number): number {
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
  const result = newFrom + fraction * (thresholdFor(k + 1) - newFrom);
  // Rundung darf nie unter den erreichten Wegpunkt fallen.
  return Math.max(newFrom, result);
}

/** v2-Stand (4 · k^3,2) → aktuelle Kurve (siehe growthToCurrentCurve). */
export function v2GrowthToV3(growth: number): number {
  return growthToCurrentCurve(growth, v2Threshold);
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
  state.cycle = createCycle(1);
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
  // v2 rechnete mit einer anderen Wegpunkt-Kurve: erst auf die neue umrechnen, dann ableiten.
  if (version < 3) state.totalGrowth = v2GrowthToV3(state.totalGrowth);
  state.seeds = clampedOr(data.seeds, 0, 0, Number.MAX_VALUE);
  // Wegpunkt und Stufe immer aus dem Gesamt-Wachstum ableiten.
  state.waypoint = waypointsForGrowth(state.totalGrowth);
  state.stage = stageForWaypoint(state.waypoint);

  // Seit v5: Ereignis-Boni, Habitate, Gäste … – vor den Nischen, denn Platz-Boni zählen
  // beim Kürzen mit.
  const cycle = isRecord(data.cycle) ? data.cycle : {};
  loadCycleExtras(cycle, state);
  const bonusSlots = cycleSlotBonuses(state.cycle);

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

  // Begleitpflanzen: unbekannte IDs verwerfen (Duplikate sind erlaubt), auf den Pflanzring kürzen.
  state.plants = stringArray(data.plants)
    .filter((id) => PLANTS_BY_ID.has(id))
    .slice(0, plantSlots(state.stage));

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
      const encounter: PendingEncounter = {
        type,
        cards,
        rerolls: single ? 0 : Math.max(0, Math.floor(finiteOr(raw.rerolls, 0))),
      };
      state.pendingEncounters.push(encounter);
      // Wartende Ereignisse und Gäste sind gezogen, also gesehen.
      if (single && !state.cycle.seen.includes(cards[0]!)) state.cycle.seen.push(cards[0]!);
    }
  }
  // Zwischenhalt: höchstens bis zum aktuellen Wegpunkt ausgewertet.
  state.cycle.interlude = Math.min(state.cycle.interlude, state.waypoint);

  state.rngState = isValidRngState(data.rngState) ? data.rngState : normalizeSeed(lastTick);

  const meta = isRecord(data.meta) ? data.meta : {};
  state.meta.forestMemory = clampedOr(meta.forestMemory, 0, 0, MAX_FOREST_MEMORY);
  const journal = isRecord(meta.journal) ? meta.journal : {};
  state.meta.journal.species = unique(stringArray(journal.species).filter((id) => SPECIES_BY_ID.has(id)));
  for (const id of seen) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  state.meta.journal.keepsakes = unique(stringArray(journal.keepsakes));
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
 * Ständen), Restdauern begrenzt auf (0, Dauer], Gäste nur bekannte.
 */
function loadCycleExtras(raw: Record<string, unknown>, state: GameState): void {
  const cycle: CycleState = createCycle(1);
  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) cycle.startedAt = raw.startedAt;
  cycle.seen = unique(stringArray(raw.seen).filter((id) => EVENTS_BY_ID.has(id) || VISITORS_BY_ID.has(id)));
  for (const b of Array.isArray(raw.bonuses) ? raw.bonuses : []) {
    if (!isRecord(b) || typeof b.source !== 'string') continue;
    const effect = eventEffects(b.source, 'cycle').find((e) => sameJson(e.effect, b.effect))?.effect;
    if (effect) cycle.bonuses.push({ source: b.source, effect: effect as CycleEffect } satisfies CycleBonus);
  }
  const habitatTags = new Set<string>(EVENTS.flatMap((e) => e.options.flatMap((o) => o.effects.flatMap((x) => (x.kind === 'habitat' ? [x.tag] : [])))));
  cycle.habitats = stringArray(raw.habitats).filter((t) => habitatTags.has(t)) as Tag[];
  for (const t of Array.isArray(raw.timed) ? raw.timed : []) {
    if (!isRecord(t) || typeof t.source !== 'string') continue;
    const timed = eventEffects(t.source, 'timed').find((e) => sameJson(e.effect, t.effect));
    const remaining = finiteOr(t.remaining, 0);
    if (!timed || !(remaining > 0)) continue;
    cycle.timed.push({ source: t.source, effect: timed.effect as TimedEffect, remaining: Math.min(remaining, timed.seconds) } satisfies TimedBonus);
  }
  for (const v of Array.isArray(raw.visitors) ? raw.visitors : []) {
    if (!isRecord(v) || typeof v.id !== 'string') continue;
    const visitor = VISITORS_BY_ID.get(v.id);
    const remaining = finiteOr(v.remaining, 0);
    if (!visitor || !(remaining > 0) || cycle.visitors.some((x) => x.id === v.id)) continue;
    cycle.visitors.push({ id: v.id, remaining: Math.min(remaining, visitor.stay) });
  }
  if (isRecord(raw.forced) && (raw.forced.type === 'animal' || raw.forced.type === 'plant')) {
    const type = raw.forced.type;
    const ids = unique(stringArray(raw.forced.ids).filter((id) => (type === 'plant' ? PLANTS_BY_ID.has(id) : SPECIES_BY_ID.has(id))));
    if (ids.length > 0) cycle.forced = { type, ids };
  }
  cycle.interlude = Math.floor(clampedOr(raw.interlude, 0, 0, WAYPOINT_COUNT));
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
