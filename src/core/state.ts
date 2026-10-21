import { NICHE_IDS, type NicheId } from '../content/types';
import { normalizeSeed } from './rng';

/**
 * Spielstand v3 (v2-Spiel mit Begleitpflanzen). Reine Daten, JSON-serialisierbar – kein DOM, keine Klassen.
 * Abgeleitete Werte (Zufriedenheit, Harmonie, Raten) werden NICHT gespeichert, sondern
 * mit `evaluate(state)` berechnet.
 * Bei Änderungen am Format: SAVE_VERSION erhöhen und Migration in save.ts ergänzen.
 */
export const SAVE_VERSION = 3;

/**
 * Obergrenze für das Waldgedächtnis beim Laden und Rechnen (+2 % je Punkt → höchstens
 * ×21). Schützt vor manipulierten oder kaputten Spielständen.
 */
export const MAX_FOREST_MEMORY = 1000;

/** Begegnungstypen, die es schon gibt (Ereignis und Durchreisende folgen in 2.4). */
export type PendingEncounterType = 'animal' | 'plant';

export interface PendingEncounter {
  /** „Tier zieht ein“ (Karten = Art-IDs) oder „Etwas keimt“ (Karten = Pflanzen-IDs). */
  type: PendingEncounterType;
  /** IDs der angebotenen Karten (1–3, verschieden). */
  cards: string[];
  /** In dieser Begegnung schon neu gewürfelt. */
  rerolls: number;
}

export interface GameState {
  version: 3;
  /** Gesamt-Wachstum in diesem Zyklus (bestimmt Wegpunkte und Stufe). */
  totalGrowth: number;
  /** 🌰 Samen – einzige Währung. */
  seeds: number;
  /** Erreichte Wegpunkte (Begegnungen ausgelöst). */
  waypoint: number;
  /** Index in STAGES, immer aus `waypoint` abgeleitet. */
  stage: number;
  /**
   * Begleitpflanzen um den Hauptbaum (Pflanzen-IDs, Duplikate erlaubt), höchstens
   * `Stage.plantSlots` viele. Reihenfolge = Reihenfolge des Setzens.
   */
  plants: string[];
  /** Nische → Art-IDs. Jede Art höchstens einmal im Ökosystem. */
  niches: Record<NicheId, string[]>;
  /** Bereits gezogene, noch offene Begegnungen (max. MAX_PENDING_ENCOUNTERS). */
  pendingEncounters: PendingEncounter[];
  /**
   * Zustand des Zufallsgenerators (mulberry32, ganze Zahl in 0 … 2³²−1).
   * Startwerte sind ≠ 0 (normalizeSeed). Der Zustand läuft aber mit ungerader Schrittweite
   * durch alle 2³² Werte und kann darum im Spiel 0 erreichen (1 : 2³² je Zug) – für
   * mulberry32 unschädlich. Wird genau dann gespeichert, setzt das Laden den Zustand aus
   * lastTick neu (isValidRngState lehnt 0 ab); das kostet nur die Reproduzierbarkeit.
   */
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
    plants: [],
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
