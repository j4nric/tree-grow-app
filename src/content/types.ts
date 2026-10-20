/**
 * Gemeinsame Typen der Spielinhalte (v2-Prototyp, docs/DESIGN_V2.md).
 * Reine Typen und Konstanten-Listen – keine Logik.
 */

/** Tiergattungen des Prototyps (Säugetiere und Pilze folgen in Schritt 2.2). */
export type Genus = 'birds' | 'insects' | 'soil';
export const GENERA: readonly Genus[] = ['birds', 'insects', 'soil'];

/** Pflanzengruppen. Im Prototyp gibt es nur den Hauptbaum (zählt als Baum). */
export type PlantGroup = 'trees' | 'shrubs' | 'flowers' | 'mosses';
export const PLANT_GROUPS: readonly PlantGroup[] = ['trees', 'shrubs', 'flowers', 'mosses'];

/** 0 gewöhnlich · 1 selten · 2 besonders · 3 legendär */
export type Rarity = 0 | 1 | 2 | 3;

/** Ebene der Nahrungspyramide (Pflanzen sind die unterste Ebene). */
export type Level = 'herbivore' | 'predator' | 'decomposer';

/** Nischen am Hauptbaum, die der Prototyp braucht. */
export type NicheId = 'roots' | 'litter' | 'edge' | 'crown' | 'bark';
export const NICHE_IDS: readonly NicheId[] = ['roots', 'litter', 'edge', 'crown', 'bark'];

/** Nahrungs- und Lebensraum-Merkmale. Hauptbaum und Tiere stellen sie bereit. */
export type Tag =
  | 'laub'
  | 'wurzeln'
  | 'nuesse'
  | 'nadeln'
  | 'beeren'
  | 'nektar'
  | 'feucht'
  | 'totholz'
  | 'hoehle'
  | 'insekten'
  | 'raupen'
  | 'kaefer'
  | 'wuermer';

/** Wunsch eines Tiers an seinen Lebensraum. */
export type Condition =
  | { kind: 'tag'; tag: Tag }
  | { kind: 'group'; group: PlantGroup; min: number }
  /** Sonnig: nach allen Begleitpflanzen bleiben mindestens 2 Licht frei. */
  | { kind: 'sunny' };

/** Wirkung eines Tiers oder Gattungsbonus. Prozentwerte als ganze Zahlen (8 = 8 %). */
export type Effect =
  | { kind: 'growth'; pct: number }
  | { kind: 'seeds'; pct: number }
  | { kind: 'groupGrowth'; group: PlantGroup; pct: number }
  | { kind: 'groupSeeds'; group: PlantGroup; pct: number }
  | { kind: 'water'; amount: number }
  | { kind: 'light'; amount: number }
  /** Fraßschaden in % Wachstum – nicht mit Zufriedenheit skaliert, durch Räuber gemindert. */
  | { kind: 'damage'; pct: number }
  /** Mindert den Schaden aller Tiere, die `tag` bereitstellen, um pct · Zufriedenheit. */
  | { kind: 'control'; tag: Tag; pct: number };
