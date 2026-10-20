import { CARDS_PER_ENCOUNTER, MAX_PENDING_ENCOUNTERS } from '../content/encounters';
import { V1_KEEPSAKE_ID, V1_KEEPSAKE_MEMORY, V1_KEEPSAKE_MIN_ENERGY, V1_KEEPSAKE_MIN_STAGE } from '../content/memory';
import { SPECIES_BY_ID } from '../content/species';
import { NICHE_IDS } from '../content/types';
import { nicheSlots, stageForWaypoint, waypointsForGrowth } from './formulas';
import { isValidRngState, normalizeSeed } from './rng';
import { SAVE_VERSION, createInitialState, type GameState, type PendingEncounter } from './state';

export const SAVE_KEY = 'tree-grow-save';

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
  return { state: loadV2(data, now), migratedFromV1: false, keepsake: false };
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

/** Robustes Laden eines v2-Stands (DESIGN_V2.md, 12.3). */
function loadV2(data: Record<string, unknown>, now: number): GameState {
  const lastTick = finiteOr(data.lastTick, now);
  const state = createInitialState(now);
  state.version = SAVE_VERSION;
  state.lastTick = lastTick;
  state.totalGrowth = Math.max(0, finiteOr(data.totalGrowth, 0));
  state.seeds = Math.max(0, finiteOr(data.seeds, 0));
  // Wegpunkt und Stufe immer aus dem Gesamt-Wachstum ableiten.
  state.waypoint = waypointsForGrowth(state.totalGrowth);
  state.stage = stageForWaypoint(state.waypoint);

  // Nischen: unbekannte Arten und Duplikate verwerfen, jede Art in ihre eigene Nische,
  // auf die aktuelle Platzzahl kürzen.
  const slots = nicheSlots(state.stage);
  const niches = isRecord(data.niches) ? data.niches : {};
  const seen = new Set<string>();
  for (const nicheId of NICHE_IDS) {
    for (const id of stringArray(niches[nicheId])) {
      const sp = SPECIES_BY_ID.get(id);
      if (!sp || seen.has(id)) continue;
      seen.add(id);
      if (state.niches[sp.niche].length < slots[sp.niche]) state.niches[sp.niche].push(id);
    }
  }

  // Offene Begegnungen: ungültige Karten entfernen, leere verwerfen, höchstens 3.
  if (Array.isArray(data.pendingEncounters)) {
    for (const raw of data.pendingEncounters) {
      if (state.pendingEncounters.length >= MAX_PENDING_ENCOUNTERS) break;
      if (!isRecord(raw)) continue;
      const cards = unique(stringArray(raw.cards).filter((id) => SPECIES_BY_ID.has(id))).slice(0, CARDS_PER_ENCOUNTER);
      if (cards.length === 0) continue;
      const encounter: PendingEncounter = {
        type: 'animal',
        cards,
        rerolls: Math.max(0, Math.floor(finiteOr(raw.rerolls, 0))),
      };
      state.pendingEncounters.push(encounter);
    }
  }

  state.rngState = isValidRngState(data.rngState) ? data.rngState : normalizeSeed(lastTick);

  const meta = isRecord(data.meta) ? data.meta : {};
  state.meta.forestMemory = Math.max(0, finiteOr(meta.forestMemory, 0));
  const journal = isRecord(meta.journal) ? meta.journal : {};
  state.meta.journal.species = unique(stringArray(journal.species).filter((id) => SPECIES_BY_ID.has(id)));
  for (const id of seen) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
  state.meta.journal.keepsakes = unique(stringArray(journal.keepsakes));
  return state;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
