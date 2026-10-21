import type { Condition, Effect, Genus, Level, NicheId, Rarity, Tag } from './types';

/**
 * Tierarten des v2-Prototyps: 3 Gattungen × 3 Arten (docs/DESIGN_V2.md, 5.3 und 13).
 * Zahlen aus scripts/v2/content.ts. Borkenkäfer (Totholz) und Buntspecht (gezimmerte
 * Höhle) bringen je +1 Platz in „Höhlen & Totholz“.
 */
export interface Species {
  id: string;
  name: string;
  genus: Genus;
  rarity: Rarity;
  level: Level;
  niche: NicheId;
  /** Ab dieser Stufe (Index in STAGES) kann die Art angeboten werden. */
  unlock: number;
  /** Nahrung: das am besten verfügbare Merkmal zählt (doppelt gewichtet). */
  food: readonly Tag[];
  /** Weitere Wünsche an den Lebensraum (je einfach gewichtet). */
  needs: readonly Condition[];
  /** Merkmale, die die Art anderen bereitstellt (Futter, Totholz, Baumhöhle …). */
  provides: readonly Tag[];
  /** Grundwirkung; wird mit der Zufriedenheit multipliziert (außer Fraß). */
  effects: readonly Effect[];
  /** Kurze Wirkung für Karten und Übersicht. */
  summary: string;
  text: string;
}

export const GENUS_INFO: Readonly<Record<Genus, { name: string; icon: string }>> = {
  birds: { name: 'Vögel', icon: '🐦' },
  insects: { name: 'Insekten', icon: '🐝' },
  soil: { name: 'Bodenleben', icon: '🪱' },
};

export const RARITY_NAMES: readonly string[] = ['gewöhnlich', 'selten', 'besonders', 'legendär'];

/** Grundzufriedenheit je Seltenheit: seltene Arten sind wählerischer. */
export const BASE_HAPPINESS: readonly number[] = [0.25, 0.15, 0.05, 0];

export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  herbivore: 'Pflanzenfresser',
  predator: 'Räuber',
  decomposer: 'Zersetzer & Partner',
};

export const SPECIES: readonly Species[] = [
  // --- Vögel ----------------------------------------------------------------
  {
    id: 'robin', name: 'Rotkehlchen', genus: 'birds', rarity: 0, level: 'predator', niche: 'litter', unlock: 2,
    food: ['wuermer', 'insekten', 'beeren'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }], provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 20 }, { kind: 'seeds', pct: 8 }],
    summary: 'jagt Insekten (−20 % Fraß), +8 % 🌰',
    text: 'Folgt jedem, der im Boden gräbt – vielleicht kommt ein Wurm zum Vorschein.',
  },
  {
    id: 'bluetit', name: 'Blaumeise', genus: 'birds', rarity: 0, level: 'predator', niche: 'crown', unlock: 3,
    food: ['raupen', 'insekten'], needs: [{ kind: 'group', group: 'trees', min: 2 }, { kind: 'tag', tag: 'hoehle' }], provides: [],
    effects: [{ kind: 'control', tag: 'raupen', pct: 50 }, { kind: 'seeds', pct: 4 }],
    summary: 'jagt Raupen (−50 % Fraß), +4 % 🌰',
    text: 'Ein Meisenpaar verfüttert im Frühling Tausende Raupen.',
  },
  {
    id: 'woodpecker', name: 'Buntspecht', genus: 'birds', rarity: 1, level: 'predator', niche: 'bark', unlock: 4,
    food: ['kaefer', 'insekten', 'nuesse'], needs: [{ kind: 'tag', tag: 'totholz' }], provides: ['hoehle'],
    effects: [{ kind: 'control', tag: 'kaefer', pct: 60 }, { kind: 'slot', niche: 'hollows', amount: 1 }, { kind: 'growth', pct: 4 }],
    summary: 'jagt Käfer (−60 % Fraß), +1 Platz Höhlen, +4 % 🌿',
    text: 'Klopft, horcht, hackt. Seine alten Höhlen sind begehrter Wohnraum.',
  },

  // --- Insekten -------------------------------------------------------------
  {
    id: 'bee', name: 'Wildbiene', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 2,
    food: ['nektar'], needs: [{ kind: 'group', group: 'flowers', min: 1 }, { kind: 'sunny' }], provides: ['insekten'],
    effects: [
      { kind: 'groupSeeds', group: 'flowers', pct: 40 },
      { kind: 'groupSeeds', group: 'shrubs', pct: 25 },
      { kind: 'seeds', pct: 5 },
    ],
    summary: 'Blumen +40 % 🌰, Sträucher +25 % 🌰, +5 % 🌰',
    text: 'Summt von Blüte zu Blüte und bringt Früchte hervor.',
  },
  {
    id: 'oakmoth', name: 'Eichenwickler', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'crown', unlock: 3,
    food: ['laub'], needs: [], provides: ['insekten', 'raupen'],
    effects: [{ kind: 'damage', pct: 10 }, { kind: 'growth', pct: 3 }],
    summary: 'Fraß −10 % 🌿, +3 % 🌿 (Raupenkot)',
    text: 'Eine grüne Raupe, die sich in Blätter einrollt – Meisenfutter erster Güte.',
  },
  {
    id: 'barkbeetle', name: 'Borkenkäfer', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'bark', unlock: 3,
    food: ['laub', 'nadeln'], needs: [], provides: ['insekten', 'kaefer', 'totholz'],
    effects: [{ kind: 'damage', pct: 8 }, { kind: 'slot', niche: 'hollows', amount: 1 }],
    summary: 'Fraß −8 % 🌿, schafft Totholz: +1 Platz Höhlen',
    text: 'Zeichnet feine Gänge unter die Rinde. Schön anzusehen, schlecht für den Baum.',
  },

  // --- Bodenleben -----------------------------------------------------------
  {
    id: 'earthworm', name: 'Regenwurm', genus: 'soil', rarity: 0, level: 'decomposer', niche: 'roots', unlock: 1,
    food: ['laub'], needs: [{ kind: 'tag', tag: 'feucht' }], provides: ['wuermer'],
    effects: [{ kind: 'water', amount: 2 }, { kind: 'growth', pct: 8 }],
    summary: '+8 % 🌿, +2 💧',
    text: 'Frisst sich durch die Erde und hinterlässt Gänge, durch die der Regen sickert.',
  },
  {
    id: 'woodlouse', name: 'Rollassel', genus: 'soil', rarity: 0, level: 'decomposer', niche: 'litter', unlock: 2,
    food: ['laub'], needs: [{ kind: 'tag', tag: 'totholz' }], provides: ['insekten'],
    effects: [{ kind: 'growth', pct: 8 }],
    summary: '+8 % 🌿',
    text: 'Rollt sich bei Gefahr zur Kugel und macht aus Laub fruchtbare Erde.',
  },
  {
    id: 'centipede', name: 'Steinläufer', genus: 'soil', rarity: 1, level: 'predator', niche: 'litter', unlock: 3,
    food: ['insekten', 'wuermer'], needs: [{ kind: 'tag', tag: 'totholz' }], provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 30 }, { kind: 'growth', pct: 6 }],
    summary: 'jagt Insekten (−30 % Fraß), +6 % 🌿',
    text: 'Fünfzehn Beinpaare, flink und nachts auf der Jagd unter der Rinde.',
  },
];

export const SPECIES_BY_ID: ReadonlyMap<string, Species> = new Map(SPECIES.map((s) => [s.id, s]));

/** Anzeigenamen der Merkmale (für Wünsche und Nahrung auf Karten). */
export const TAG_NAMES: Readonly<Record<Tag, string>> = {
  laub: 'Laub',
  wurzeln: 'Wurzeln',
  nuesse: 'Nüsse',
  nadeln: 'Nadeln',
  beeren: 'Beeren',
  nektar: 'Nektar',
  kraut: 'Kräuter',
  feucht: 'Feuchte',
  totholz: 'Totholz',
  hoehle: 'Baumhöhle',
  insekten: 'Insekten',
  raupen: 'Raupen',
  kaefer: 'Käfer',
  wuermer: 'Würmer',
};
