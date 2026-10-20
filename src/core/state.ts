/**
 * Spielstand. Reine Daten, JSON-serialisierbar – kein DOM, keine Klassen.
 * Bei Änderungen am Format: SAVE_VERSION erhöhen und Migration in save.ts ergänzen.
 */
export type ResourceId = 'water' | 'light' | 'energy';

export const RESOURCE_IDS: readonly ResourceId[] = ['water', 'light', 'energy'];

export const SAVE_VERSION = 1;

export interface GameState {
  version: number;
  resources: Record<ResourceId, number>;
  /** Upgrade-ID → gekaufte Stufen. Fehlender Eintrag = 0. */
  upgrades: Record<string, number>;
  /** Index in STAGES. */
  stage: number;
  /** In diesem Durchgang insgesamt erzeugte Energie (bestimmt die Stufe). */
  totalEnergy: number;
  /** Zeitpunkt des letzten Ticks (ms seit Epoch), für Offline-Fortschritt. */
  lastTick: number;
}

export function createInitialState(now: number): GameState {
  return {
    version: SAVE_VERSION,
    resources: { water: 0, light: 0, energy: 0 },
    upgrades: {},
    stage: 0,
    totalEnergy: 0,
    lastTick: now,
  };
}
