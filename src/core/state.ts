import type { CycleEffect, ForcedEncounterType, TimedEffect } from '../content/events';
import { DEFAULT_MAIN_TREE, type MainTreeId } from '../content/trees';
import { NICHE_IDS, type NicheId, type Tag } from '../content/types';
import { normalizeSeed } from './rng';

/**
 * Spielstand v6 (v2-Spiel mit Begleitpflanzen, Neuem Zyklus, Ereignissen und Gästen,
 * Jahreszeiten und Hauptbaum-Arten). Reine Daten,
 * JSON-serialisierbar – kein DOM, keine Klassen.
 * Abgeleitete Werte (Zufriedenheit, Harmonie, Raten) werden NICHT gespeichert, sondern
 * mit `evaluate(state)` berechnet.
 * Bei Änderungen am Format: SAVE_VERSION erhöhen und Migration in save.ts ergänzen.
 * Ausnahme ohne neue Version (Schritt 2.3): `meta.journal.plants` und
 * `meta.journal.communities` sind reine Ergänzungen; fehlen sie in einem v3-Stand,
 * ergänzt das Laden sie aus dem aktuellen Ökosystem (save.ts).
 */
export const SAVE_VERSION = 6;

/**
 * Obergrenze für das Waldgedächtnis beim Laden und Rechnen (+2 % je Punkt → höchstens
 * ×21). Schützt vor manipulierten oder kaputten Spielständen.
 */
export const MAX_FOREST_MEMORY = 1000;

/** Begegnungen mit Karten zum Auswählen (Tier- bzw. Pflanzenkarten, neu würfelbar). */
export type CardEncounterType = 'animal' | 'plant';

/** Alle Begegnungstypen (DESIGN_V2.md 7.1). */
export type PendingEncounterType = CardEncounterType | 'event' | 'visitor';

export interface PendingEncounter {
  /**
   * „Tier zieht ein“ (Karten = Art-IDs), „Etwas keimt“ (Karten = Pflanzen-IDs),
   * Ereignis (cards = [Ereignis-ID]) oder Durchreisende (cards = [Gast-ID]).
   */
  type: PendingEncounterType;
  /** IDs der angebotenen Karten (1–3, verschieden; bei Ereignis und Gast genau eine). */
  cards: string[];
  /** In dieser Begegnung schon neu gewürfelt (Ereignis und Gast: immer 0). */
  rerolls: number;
}

/** Ist das eine Begegnung mit Tier- oder Pflanzenkarten? */
export function isCardEncounter(type: PendingEncounterType | undefined): type is CardEncounterType {
  return type === 'animal' || type === 'plant';
}

/** Zyklus-Bonus aus einer Ereignis-Option (`cycle`). */
export interface CycleBonus {
  /** Herkunft, z. B. „windthrow“ (Ereignis-ID). */
  source: string;
  effect: CycleEffect;
}

/** Zeit-Bonus aus einer Ereignis-Option (`timed`). */
export interface TimedBonus {
  source: string;
  effect: TimedEffect;
  /** Restdauer in Sekunden Spielzeit (> 0). */
  remaining: number;
}

/** Bewirteter Gast. Seine Wirkungen kommen aus VISITORS_BY_ID. */
export interface ActiveVisitor {
  id: string;
  /** Restdauer in Sekunden Spielzeit (> 0). */
  remaining: number;
}

/** Vorgabe für die nächste Begegnung (Ereignis-Option `nextEncounter`). */
export interface ForcedEncounter {
  type: ForcedEncounterType;
  ids: string[];
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
  /** IDs der in diesem Zyklus gezogenen Ereignisse und Gäste (je höchstens einmal). */
  seen: string[];
  /** Wirkungen bis zum Neuen Zyklus (Ereignis-Option `cycle`). */
  bonuses: CycleBonus[];
  /** Merkmale aus Ereignissen (`habitat`), je 1 Einheit Angebot. */
  habitats: Tag[];
  /** Zeit-Boni mit Restdauer (Ereignis-Option `timed`). */
  timed: TimedBonus[];
  /** Bewirtete Gäste mit Restdauer. */
  visitors: ActiveVisitor[];
  /** Vorgabe für die nächste Begegnung (`nextEncounter`), sonst null. */
  forced: ForcedEncounter | null;
  /** Wegpunkt, nach dem der Zwischenhalt schon ausgewertet wurde (Start: 0). */
  interlude: number;
  /**
   * Gekaufte Pflege-Ränge je Maßnahme (ID → 1 … ranks.length; fehlt = 0). Seit Schritt
   * 2.7 additiv in v5: fehlt das Feld in einem gespeicherten v5-Stand, ergänzt das Laden
   * ein leeres Objekt. Die Wirkungen kommen immer aus CARE_BY_ID.
   */
  care: Record<string, number>;
  /**
   * Spielzeit des Zyklus in Sekunden (seit v6, endlich und ≥ 0). Bestimmt die Jahreszeit
   * (DESIGN_V2.md 16.2): Jeder Zyklus beginnt im Frühling, offline läuft das Jahr mit.
   */
  elapsed: number;
  /**
   * Art des Hauptbaums (seit v6, DESIGN_V2.md 17). Gewählt beim Neuen Zyklus, gilt für den
   * ganzen Zyklus. Nur freigeschaltete Arten (unlockedTrees); das Laden fällt sonst auf
   * DEFAULT_MAIN_TREE zurück.
   */
  mainTree: MainTreeId;
}

export interface GameState {
  version: 6;
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

/** Ein frischer Zyklus mit dieser Nummer (beginnt im Frühling, Standard: Stieleiche). */
export function createCycle(number: number, now?: number, mainTree: MainTreeId = DEFAULT_MAIN_TREE): CycleState {
  const cycle: CycleState = {
    number,
    maxHarmony: 0,
    newSpecies: [],
    seen: [],
    bonuses: [],
    habitats: [],
    timed: [],
    visitors: [],
    forced: null,
    interlude: 0,
    care: {},
    elapsed: 0,
    mainTree,
  };
  if (now !== undefined && Number.isFinite(now)) cycle.startedAt = now;
  return cycle;
}

/** Alle Tiere im Ökosystem in Nischen-Reihenfolge. */
export function allAnimals(state: Pick<GameState, 'niches'>): string[] {
  const out: string[] = [];
  for (const id of NICHE_IDS) out.push(...(state.niches[id] ?? []));
  return out;
}
