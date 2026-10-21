import { NICHE_IDS, type NicheId } from '../content/types';
import { normalizeSeed } from './rng';

/**
 * Spielstand v4 (v2-Spiel mit Begleitpflanzen und Neuem Zyklus). Reine Daten,
 * JSON-serialisierbar – kein DOM, keine Klassen.
 * Abgeleitete Werte (Zufriedenheit, Harmonie, Raten) werden NICHT gespeichert, sondern
 * mit `evaluate(state)` berechnet.
 * Bei Änderungen am Format: SAVE_VERSION erhöhen und Migration in save.ts ergänzen.
 * Ausnahme ohne neue Version (Schritt 2.3): `meta.journal.plants` und
 * `meta.journal.communities` sind reine Ergänzungen; fehlen sie in einem v3-Stand,
 * ergänzt das Laden sie aus dem aktuellen Ökosystem (save.ts).
 */
export const SAVE_VERSION = 4;

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

/** Der laufende Zyklus (DESIGN_V2.md, Abschnitt 10). Wird beim Neuen Zyklus neu angelegt. */
export interface CycleState {
  /** Nummer des Zyklus, ab 1. */
  number: number;
  /**
   * Höchste Harmonie dieses Zyklus (H_max, nie unter 0). Wird nach jeder Änderung am
   * Ökosystem nachgeführt (Karte wählen, Pflanze setzen, Stammgäste, Stufenwechsel, Laden).
   */
  maxHarmony: number;
  /** Arten, die in diesem Zyklus zum ersten Mal ins Naturtagebuch kamen (je einmal). */
  newSpecies: string[];
  /** Beginn des Zyklus (ms seit Epoch); fehlt bei Ständen aus der Zeit vor v4. */
  startedAt?: number;
}

export interface GameState {
  version: 4;
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
  /** Der laufende Zyklus (H_max, neu entdeckte Arten). */
  cycle: CycleState;
  /** Überdauert den Neuen Zyklus. */
  meta: {
    /** Dauerhafter Bonus: je Punkt +2 % Wachstum und Samen. */
    forestMemory: number;
    /**
     * Stammgäste: entdeckte Arten, die automatisch einziehen, sobald in ihrer Nische ein
     * Platz frei ist. Höchstens `regularSlots(forestMemory)` viele, in Wahl-Reihenfolge.
     */
    regulars: string[];
    journal: {
      /** Arten, die schon einmal im Ökosystem gelebt haben. */
      species: string[];
      /** Pflanzen, die schon einmal im Pflanzring gewachsen sind (gekeimt oder gesetzt). */
      plants: string[];
      /** Lebensgemeinschaften, die schon einmal bestanden haben (entdeckt). */
      communities: string[];
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
    cycle: createCycle(1, now),
    meta: { forestMemory: 0, regulars: [], journal: { species: [], plants: [], communities: [], keepsakes: [] } },
    lastTick: now,
  };
}

/** Ein frischer Zyklus mit dieser Nummer. */
export function createCycle(number: number, now?: number): CycleState {
  const cycle: CycleState = { number, maxHarmony: 0, newSpecies: [] };
  if (now !== undefined && Number.isFinite(now)) cycle.startedAt = now;
  return cycle;
}

/** Alle Tiere im Ökosystem in Nischen-Reihenfolge. */
export function allAnimals(state: Pick<GameState, 'niches'>): string[] {
  const out: string[] = [];
  for (const id of NICHE_IDS) out.push(...(state.niches[id] ?? []));
  return out;
}
