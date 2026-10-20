import { STAGES } from '../content/stages';
import { RESOURCE_IDS, SAVE_VERSION, createInitialState, type GameState } from './state';

export const SAVE_KEY = 'tree-grow-save';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Liest einen gespeicherten Stand. Unbekannte oder kaputte Felder werden durch
 * Startwerte ersetzt, damit ein alter Spielstand das Spiel nie zum Absturz bringt.
 * Gibt null zurück, wenn gar nichts Brauchbares vorliegt.
 */
export function deserialize(raw: string | null, now: number): GameState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const state = createInitialState(now);
  // Hier künftig Migrationen ergänzen: if (data.version === 1) { ... }
  state.version = SAVE_VERSION;

  if (isRecord(data.resources)) {
    for (const id of RESOURCE_IDS) state.resources[id] = finiteOr(data.resources[id], 0);
  }
  if (isRecord(data.upgrades)) {
    for (const [id, level] of Object.entries(data.upgrades)) {
      const n = Math.floor(finiteOr(level, 0));
      if (n > 0) state.upgrades[id] = n;
    }
  }
  state.totalEnergy = finiteOr(data.totalEnergy, 0);
  state.stage = Math.min(Math.max(Math.floor(finiteOr(data.stage, 0)), 0), STAGES.length - 1);
  state.lastTick = finiteOr(data.lastTick, now);
  return state;
}

export function saveToStorage(state: GameState, storage: Storage = localStorage): void {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
  } catch {
    // Speicher voll oder blockiert (z. B. privater Modus) – Spiel läuft trotzdem weiter.
  }
}

export function loadFromStorage(now: number, storage: Storage = localStorage): GameState | null {
  try {
    return deserialize(storage.getItem(SAVE_KEY), now);
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
