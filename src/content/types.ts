/**
 * Gemeinsame Typen der Spielinhalte (v2-Prototyp, docs/DESIGN_V2.md).
 * Reine Typen und Konstanten-Listen – keine Logik.
 */

/** Die fünf Gattungen (eigentlich Lebensweise-Gruppen, DESIGN_V2.md 5.1). */
export type Genus = 'birds' | 'insects' | 'mammals' | 'soil' | 'fungi';
export const GENERA: readonly Genus[] = ['birds', 'insects', 'mammals', 'soil', 'fungi'];

/** Pflanzengruppen der Begleitpflanzen (der Hauptbaum zählt als Baum). */
export type PlantGroup = 'trees' | 'shrubs' | 'flowers' | 'mosses';
export const PLANT_GROUPS: readonly PlantGroup[] = ['trees', 'shrubs', 'flowers', 'mosses'];

/** 0 gewöhnlich · 1 selten · 2 besonders · 3 legendär */
export type Rarity = 0 | 1 | 2 | 3;

/** Ebene der Nahrungspyramide (Pflanzen sind die unterste Ebene). */
export type Level = 'herbivore' | 'predator' | 'decomposer';

/** Nischen am Hauptbaum (DESIGN_V2.md, Abschnitt 3). */
export type NicheId = 'roots' | 'litter' | 'edge' | 'crown' | 'bark' | 'hollows';
export const NICHE_IDS: readonly NicheId[] = ['roots', 'litter', 'edge', 'crown', 'bark', 'hollows'];

/** Nahrungs- und Lebensraum-Merkmale. Hauptbaum, Begleitpflanzen und Tiere stellen sie bereit. */
export type Tag =
  | 'laub'
  | 'wurzeln'
  | 'nuesse'
  | 'nadeln'
  | 'beeren'
  | 'nektar'
  | 'kraut'
  | 'feucht'
  | 'totholz'
  | 'hoehle'
  | 'insekten'
  | 'raupen'
  | 'kaefer'
  | 'wuermer'
  | 'schnecken'
  | 'kleinsaeuger'
  | 'rehe';

/** Wunsch eines Tiers an seinen Lebensraum. */
export type Condition =
  | { kind: 'tag'; tag: Tag }
  | { kind: 'group'; group: PlantGroup; min: number }
  /** Eine bestimmte Art oder Pflanze lebt bzw. wächst im Ökosystem. */
  | { kind: 'species'; id: string }
  /** Mindestens `min` Tiere dieser Gattung leben im Ökosystem. */
  | { kind: 'genus'; genus: Genus; min: number }
  /** Sonnig: nach allen Begleitpflanzen bleiben mindestens 2 Licht frei. */
  | { kind: 'sunny' }
  /** Schattig: mindestens 3 Bäume (inkl. Hauptbaum). */
  | { kind: 'shady' };

/**
 * Fähigkeiten besonderer und legendärer Arten (DESIGN_V2.md 5.3). Was sie bewirken und
 * mit welchen Zahlen, steht in abilities.ts. Sie wirken, solange die Art im Ökosystem
 * lebt – unabhängig von ihrer Zufriedenheit.
 */
export type AbilityId =
  | 'minSupply'
  | 'rarityBoost'
  | 'countsAsBird'
  | 'decomposerBoost'
  | 'communityBoost'
  | 'mossNoWater'
  | 'calm'
  | 'nightWatch'
  | 'architect'
  | 'fear';

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
  | { kind: 'control'; tag: Tag; pct: number }
  /**
   * Zusätzliche Plätze in einer Nische, solange die Art im Ökosystem lebt – unabhängig
   * von ihrer Zufriedenheit. Öffnet nur Nischen mit `opensEarly` vor ihrer Stufe.
   */
  | { kind: 'slot'; niche: NicheId; amount: number }
  /** Harmonie-Punkte (mal Zufriedenheit). */
  | { kind: 'harmony'; points: number }
  /** Stört eine andere Art: deren Zufriedenheit sinkt (DISTURB_PENALTY), solange beide leben. */
  | { kind: 'disturb'; target: string }
  /** Fähigkeit (siehe AbilityId und abilities.ts). */
  | { kind: 'ability'; id: AbilityId };

/**
 * Begegnungstypen (DESIGN_V2.md, Abschnitt 7). Reihenfolge = Spalten in
 * ENCOUNTER_WEIGHTS: „Tier zieht ein“, „Etwas keimt“, Ereignisse (events.ts) und
 * Durchreisende (visitors.ts).
 */
export type EncounterType = 'animal' | 'plant' | 'event' | 'visitor';
export const ENCOUNTER_TYPES: readonly EncounterType[] = ['animal', 'plant', 'event', 'visitor'];
