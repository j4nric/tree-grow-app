import type { Tag } from './types';

/**
 * Wachstumsstufen des Hauptbaums (Stieleiche). Eine Stufe ist erreicht, sobald der
 * Wegpunkt `waypoint` erreicht ist (siehe waypoints.ts). Reihenfolge = Fortschritt;
 * der Index wird im Spielstand gespeichert.
 */
export interface Stage {
  id: string;
  name: string;
  description: string;
  /** Ab diesem Wegpunkt gilt die Stufe. */
  waypoint: number;
  /** Grundwachstum des Hauptbaums (🌿/s). */
  treeGrowth: number;
  /** Grundsamen des Hauptbaums (🌰/s). */
  treeSeeds: number;
  /** Licht, das Begleitpflanzen teilen (bestimmt im Prototyp nur „sonnig“). */
  light: number;
  /** Wasser, das Begleitpflanzen teilen. */
  water: number;
}

export const STAGES: readonly Stage[] = [
  { id: 'seed', name: 'Samen', description: 'Ein kleiner Samen in dunkler Erde.', waypoint: 0, treeGrowth: 1, treeSeeds: 0.1, light: 0, water: 0 },
  { id: 'sprout', name: 'Keimling', description: 'Die ersten Keimblätter durchbrechen den Boden.', waypoint: 1, treeGrowth: 2, treeSeeds: 0.15, light: 2, water: 2 },
  { id: 'sapling', name: 'Setzling', description: 'Ein dünner Stamm reckt sich zum Licht.', waypoint: 3, treeGrowth: 3.5, treeSeeds: 0.25, light: 3, water: 3 },
  { id: 'young-tree', name: 'Junger Baum', description: 'Äste verzweigen sich, die Krone wird dichter.', waypoint: 6, treeGrowth: 6, treeSeeds: 0.4, light: 5, water: 5 },
  { id: 'old-tree', name: 'Alter Baum', description: 'Ein mächtiger Stamm mit tiefen Wurzeln.', waypoint: 12, treeGrowth: 10, treeSeeds: 0.6, light: 7, water: 7 },
  { id: 'grove', name: 'Hain', description: 'Deine Samen sind aufgegangen – du bist nicht mehr allein.', waypoint: 20, treeGrowth: 16, treeSeeds: 0.9, light: 9, water: 9 },
  { id: 'forest', name: 'Wald', description: 'Ein lebendiger Wald, verbunden durch Pilzfäden.', waypoint: 28, treeGrowth: 24, treeSeeds: 1.3, light: 12, water: 11 },
  { id: 'ancient-forest', name: 'Urwald', description: 'Uralt, riesig und voller Leben.', waypoint: 36, treeGrowth: 34, treeSeeds: 1.8, light: 15, water: 14 },
];

/** Der Hauptbaum zählt als Baum und stellt diese Merkmale bereit. */
export const MAIN_TREE_TAGS: readonly Tag[] = ['laub', 'wurzeln'];
/** Ab „Alter Baum“ trägt die Eiche Eicheln (Nüsse). */
export const MAIN_TREE_NUTS_STAGE = 4;
/** Der Hauptbaum zählt in der Nahrungspyramide wie so viele Pflanzen. */
export const MAIN_TREE_WEIGHT = 3;
