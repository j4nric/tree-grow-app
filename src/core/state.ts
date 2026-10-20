import { NICHE_IDS, type NicheId } from '../content/types';
import { normalizeSeed } from './rng';

/**
 * Spielstand v2 (Prototyp). Reine Daten, JSON-serialisierbar – kein DOM, keine Klassen.
 * Abgeleitete Werte (Zufriedenheit, Harmonie, Raten) werden NICHT gespeichert, sondern
 * mit `evaluate(state)` berechnet.
 * Bei Änderungen am Format: SAVE_VERSION erhöhen und Migration in save.ts ergänzen.
 */
export const SAVE_VERSION = 2;

export interface PendingEncounter {
  /** Im Prototyp gibt es nur Tierbegegnungen. */
  type: 'animal';
  /** Art-IDs der angebotenen Karten (1–3, verschieden). */
  cards: string[];
  /** In dieser Begegnung schon neu gewürfelt. */
  rerolls: number;
}

export interface GameState {
  version: 2;
  /** Gesamt-Wachstum in diesem Zyklus (bestimmt Wegpunkte und Stufe). */
  totalGrowth: number;
  /** 🌰 Samen – einzige Währung. */
  seeds: number;
  /** Erreichte Wegpunkte (Begegnungen ausgelöst). */
  waypoint: number;
  /** Index in STAGES, immer aus `waypoint` abgeleitet. */
  stage: number;
  /** Nische → Art-IDs. Jede Art höchstens einmal im Ökosystem. */
  niches: Record<NicheId, string[]>;
  /** Bereits gezogene, noch offene Begegnungen (max. MAX_PENDING_ENCOUNTERS). */
  pendingEncounters: PendingEncounter[];
  /** Zustand des Zufallsgenerators (mulberry32, uint32, nie 0). */
  rngState: number;
  /** Überdauert den Neuen Zyklus. */
  meta: {
    /** Dauerhafter Bonus: je Punkt +2 % Wachstum und Samen. */
    forestMemory: number;
    journal: {
      /** Arten, die schon einmal im Ökosystem gelebt haben. */
      species: string[];
      /** Andenken, z. B. „old-oak“ für einen v1-Spielstand. */
      keepsakes: string[];
    };
  };
  /** Zeitpunkt des letzten Ticks (ms seit Epoch), für Offline-Fortschritt. */
  lastTick: number;
}

export function emptyNiches(): Record<NicheId, string[]> {
  const niches = {} as Record<NicheId, string[]>;
  for (const id of NICHE_IDS) niches[id] = [];
  return niches;
}

/**
 * Neuer Spielstand. `seed` ist der Startwert des Zufallsgenerators – main.ts setzt ihn
 * einmal beim neuen Spiel (z. B. aus der Uhrzeit), Tests übergeben feste Werte.
 */
export function createInitialState(now: number, seed: number = now): GameState {
  return {
    version: SAVE_VERSION,
    totalGrowth: 0,
    seeds: 0,
    waypoint: 0,
    stage: 0,
    niches: emptyNiches(),
    pendingEncounters: [],
    rngState: normalizeSeed(seed),
    meta: { forestMemory: 0, journal: { species: [], keepsakes: [] } },
    lastTick: now,
  };
}

/** Alle Tiere im Ökosystem in Nischen-Reihenfolge. */
export function allAnimals(state: Pick<GameState, 'niches'>): string[] {
  const out: string[] = [];
  for (const id of NICHE_IDS) out.push(...(state.niches[id] ?? []));
  return out;
}
