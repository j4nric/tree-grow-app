/**
 * Wachstumsstufen der Pflanze. Eine Stufe ist erreicht, sobald die in diesem
 * Durchgang insgesamt erzeugte Energie (`totalEnergy`) den Schwellwert erreicht.
 * Reihenfolge = Fortschritt; der Index wird im Spielstand gespeichert.
 */
export interface Stage {
  id: string;
  name: string;
  description: string;
  /** Benötigte Gesamtenergie in diesem Durchgang. */
  threshold: number;
}

export const STAGES: readonly Stage[] = [
  { id: 'seed', name: 'Samen', description: 'Ein kleiner Samen in dunkler Erde.', threshold: 0 },
  { id: 'sprout', name: 'Keimling', description: 'Die ersten Keimblätter durchbrechen den Boden.', threshold: 10 },
  { id: 'sapling', name: 'Setzling', description: 'Ein dünner Stamm reckt sich zum Licht.', threshold: 100 },
  { id: 'young-tree', name: 'Junger Baum', description: 'Äste verzweigen sich, die Krone wird dichter.', threshold: 1_000 },
  { id: 'old-tree', name: 'Alter Baum', description: 'Ein mächtiger Stamm mit tiefen Wurzeln.', threshold: 10_000 },
  { id: 'grove', name: 'Hain', description: 'Deine Samen sind aufgegangen – du bist nicht mehr allein.', threshold: 100_000 },
  { id: 'forest', name: 'Wald', description: 'Ein lebendiger Wald, verbunden durch Pilzfäden.', threshold: 1_000_000 },
  { id: 'ancient-forest', name: 'Urwald', description: 'Uralt, riesig und voller Leben.', threshold: 10_000_000 },
];
