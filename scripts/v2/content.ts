/**
 * Design v2 – Inhalte des Monte-Carlo-Prototyps (docs/DESIGN_V2.md).
 *
 * Reine Daten, alle Zahlen VORLÄUFIG. Wird von src/ NICHT importiert; die echte
 * Umsetzung übernimmt die Werte später nach src/content/.
 */

// ---------------------------------------------------------------------------
// Grundbegriffe
// ---------------------------------------------------------------------------

export type Genus = 'birds' | 'insects' | 'mammals' | 'soil' | 'fungi';
export type PlantGroup = 'trees' | 'shrubs' | 'flowers' | 'mosses';
/** 0 gewöhnlich · 1 selten · 2 besonders · 3 legendär */
export type Rarity = 0 | 1 | 2 | 3;
/** Ebene der Nahrungspyramide (Pflanzen sind die unterste Ebene). */
export type Level = 'herbivore' | 'predator' | 'decomposer';
export type NicheId = 'roots' | 'litter' | 'edge' | 'crown' | 'bark' | 'hollows';

export const GENERA: readonly Genus[] = ['birds', 'insects', 'mammals', 'soil', 'fungi'];
export const PLANT_GROUPS: readonly PlantGroup[] = ['trees', 'shrubs', 'flowers', 'mosses'];
export const NICHES: readonly NicheId[] = ['roots', 'litter', 'edge', 'crown', 'bark', 'hollows'];

export const GENUS_NAMES: Record<Genus, string> = {
  birds: 'Vögel',
  insects: 'Insekten',
  mammals: 'Säugetiere',
  soil: 'Bodenleben',
  fungi: 'Pilze',
};
export const GROUP_NAMES: Record<PlantGroup, string> = {
  trees: 'Bäume',
  shrubs: 'Sträucher',
  flowers: 'Blumen & Kräuter',
  mosses: 'Moose & Farne',
};
export const RARITY_NAMES = ['gewöhnlich', 'selten', 'besonders', 'legendär'] as const;
export const LEVEL_NAMES: Record<Level, string> = {
  herbivore: 'Pflanzenfresser',
  predator: 'Räuber',
  decomposer: 'Zersetzer & Partner',
};

// ---------------------------------------------------------------------------
// Stufen, Wegpunkte, Umweltgrenzen
// ---------------------------------------------------------------------------

export const STAGE_NAMES = ['Samen', 'Keimling', 'Setzling', 'Junger Baum', 'Alter Baum', 'Hain', 'Wald', 'Urwald'] as const;

/**
 * Wegpunkte: Gesamt-Wachstum, bei dem jeweils eine Begegnung stattfindet.
 * Wegpunkt k (1-basiert) liegt bei WAYPOINT_BASE · k^WAYPOINT_POWER.
 */
export const WAYPOINT_BASE = 4;
export const WAYPOINT_POWER = 3.4;
export const WAYPOINT_COUNT = 36;
export function waypointThreshold(k: number): number {
  return Math.round(WAYPOINT_BASE * Math.pow(k, WAYPOINT_POWER));
}

/** Stufe i ist erreicht, sobald Wegpunkt STAGE_WAYPOINTS[i] erreicht ist. */
export const STAGE_WAYPOINTS = [0, 1, 3, 6, 12, 20, 28, 36] as const;

/** Grundwachstum und Grundsamen des Hauptbaums (Stieleiche) je Stufe. */
export const TREE_GROWTH = [1, 2, 3.5, 6, 10, 16, 24, 34] as const;
export const TREE_SEEDS = [0.1, 0.15, 0.25, 0.4, 0.6, 0.9, 1.3, 1.8] as const;

/** Umweltgrenzen je Stufe: Licht und Wasser, die Begleitpflanzen teilen. */
export const LIGHT_BUDGET = [0, 2, 3, 5, 7, 9, 12, 15] as const;
export const WATER_BUDGET = [0, 2, 3, 5, 7, 9, 11, 14] as const;

/** Pflanzplätze um den Hauptbaum je Stufe. */
export const PLANT_SLOTS = [0, 1, 2, 3, 5, 7, 9, 12] as const;

/** Tierplätze je Nische und Stufe. */
export const NICHE_SLOTS: Record<NicheId, readonly number[]> = {
  roots: [0, 1, 2, 2, 3, 3, 4, 4],
  litter: [0, 0, 1, 2, 2, 3, 3, 4],
  edge: [0, 0, 1, 2, 3, 3, 4, 4],
  crown: [0, 0, 0, 2, 2, 3, 4, 4],
  bark: [0, 0, 0, 1, 2, 2, 3, 3],
  hollows: [0, 0, 0, 0, 1, 2, 2, 3],
};
export const NICHE_NAMES: Record<NicheId, string> = {
  roots: 'Wurzelraum',
  litter: 'Laubstreu',
  edge: 'Waldsaum',
  crown: 'Krone',
  bark: 'Stamm & Rinde',
  hollows: 'Höhlen & Totholz',
};

// ---------------------------------------------------------------------------
// Bedingungen und Effekte
// ---------------------------------------------------------------------------

/**
 * Nahrungs- und Lebensraum-Merkmale („Tags“). Pflanzen und Tiere stellen sie bereit.
 * laub, wurzeln, nuesse, beeren, nektar, kraut, feucht, totholz, nadeln,
 * insekten, raupen, kaefer, wuermer, schnecken, kleinsaeuger, rehe
 */
export type Tag = string;

export type Condition =
  | { kind: 'tag'; tag: Tag }
  | { kind: 'group'; group: PlantGroup; min: number }
  | { kind: 'species'; id: string }
  | { kind: 'genus'; genus: Genus; min: number }
  /** Sonnig: nach allen Begleitpflanzen bleiben mindestens 2 Licht frei. */
  | { kind: 'sunny' }
  /** Schattig: mindestens 3 Bäume (inkl. Hauptbaum). */
  | { kind: 'shady' };

export type AbilityId =
  | 'minSupply' // Versorgung aller Pflanzen mindestens 90 %
  | 'rarityBoost' // +5 Prozentpunkte auf selten/besonders/legendär
  | 'countsAsBird' // zählt zusätzlich als Vogel
  | 'decomposerBoost' // Zersetzer & Partner +0,2 Zufriedenheit
  | 'communityBoost' // jede Lebensgemeinschaft +3 Harmonie
  | 'mossNoWater' // Moose & Farne brauchen kein Wasser
  | 'calm' // Zufriedenheit nie unter 50 %
  | 'nightWatch' // Schaden aller Pflanzenfresser −20 %
  | 'architect' // +1 Platz Krone, +1 Höhlen; Höhlenbewohner +0,2 Zufriedenheit
  | 'fear'; // Reh-Schaden entfällt, Reh-Licht ×2

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
  | { kind: 'slot'; niche: NicheId; amount: number }
  | { kind: 'harmony'; points: number }
  /** Stört eine andere Art: deren Zufriedenheit −0,15. */
  | { kind: 'disturb'; target: string }
  | { kind: 'ability'; id: AbilityId };

// ---------------------------------------------------------------------------
// Pflanzen
// ---------------------------------------------------------------------------

export interface Plant {
  id: string;
  name: string;
  group: PlantGroup;
  unlock: number;
  growth: number;
  seeds: number;
  light: number;
  water: number;
  provides: Tag[];
  text: string;
}

/** Der Hauptbaum (Stieleiche) zählt als Baum und stellt diese Merkmale bereit. */
export const MAIN_TREE_TAGS: readonly Tag[] = ['laub', 'wurzeln'];
/** Ab „Alter Baum“ trägt die Eiche Eicheln. */
export const MAIN_TREE_NUTS_STAGE = 4;
/** Der Hauptbaum zählt in der Nahrungspyramide wie so viele Pflanzen. */
export const MAIN_TREE_WEIGHT = 3;

export const PLANTS: readonly Plant[] = [
  // Bäume
  { id: 'birch', name: 'Hänge-Birke', group: 'trees', unlock: 3, growth: 1.5, seeds: 0.3, light: 4, water: 2, provides: ['laub'], text: 'Pionierin mit weißer Rinde – wächst schnell, wo Licht ist.' },
  { id: 'rowan', name: 'Eberesche', group: 'trees', unlock: 3, growth: 1, seeds: 0.6, light: 3, water: 2, provides: ['laub', 'beeren', 'nektar'], text: 'Ihre roten Beeren sind ein Festmahl für Vögel.' },
  { id: 'beech', name: 'Rotbuche', group: 'trees', unlock: 4, growth: 2, seeds: 0.4, light: 3, water: 3, provides: ['laub', 'nuesse'], text: 'Die Mutter des Waldes – kommt auch im Schatten zurecht.' },
  { id: 'pine', name: 'Waldkiefer', group: 'trees', unlock: 4, growth: 1.5, seeds: 0.4, light: 3, water: 1, provides: ['laub', 'nadeln'], text: 'Genügsam und harzig, liebt sandigen Boden.' },
  // Sträucher
  { id: 'hazel', name: 'Hasel', group: 'shrubs', unlock: 2, growth: 0.8, seeds: 0.6, light: 2, water: 2, provides: ['laub', 'nuesse'], text: 'Blüht schon im Februar – und dann die Nüsse!' },
  { id: 'bramble', name: 'Brombeere', group: 'shrubs', unlock: 2, growth: 0.5, seeds: 1, light: 2, water: 1, provides: ['beeren', 'nektar'], text: 'Stachelig, wuchernd, ein sicheres Versteck.' },
  { id: 'elder', name: 'Schwarzer Holunder', group: 'shrubs', unlock: 3, growth: 0.8, seeds: 0.8, light: 2, water: 2, provides: ['laub', 'beeren', 'nektar'], text: 'Duftende Dolden im Juni, dunkle Beeren im Herbst.' },
  // Blumen & Kräuter
  { id: 'anemone', name: 'Buschwindröschen', group: 'flowers', unlock: 1, growth: 0.3, seeds: 0.8, light: 1, water: 1, provides: ['nektar', 'kraut'], text: 'Blüht, bevor sich das Kronendach schließt.' },
  { id: 'nettle', name: 'Große Brennnessel', group: 'flowers', unlock: 2, growth: 0.4, seeds: 0.6, light: 2, water: 2, provides: ['kraut'], text: 'Brennt – und ernährt die Raupen vieler Falter.' },
  { id: 'strawberry', name: 'Wald-Erdbeere', group: 'flowers', unlock: 2, growth: 0.3, seeds: 1, light: 2, water: 1, provides: ['beeren', 'nektar', 'kraut'], text: 'Winzig, rot und süßer als jede Gartenerdbeere.' },
  { id: 'foxglove', name: 'Roter Fingerhut', group: 'flowers', unlock: 3, growth: 0.3, seeds: 1.4, light: 3, water: 1, provides: ['nektar'], text: 'Hohe Glockenblüten – die Hummeln kriechen ganz hinein.' },
  // Moose & Farne
  { id: 'moss', name: 'Frauenhaarmoos', group: 'mosses', unlock: 1, growth: 0.3, seeds: 0.2, light: 0, water: -2, provides: ['feucht'], text: 'Ein grünes Polster, das Regen speichert wie ein Schwamm.' },
  { id: 'fern', name: 'Wurmfarn', group: 'mosses', unlock: 2, growth: 0.6, seeds: 0.2, light: 1, water: 2, provides: ['feucht'], text: 'Rollt im Frühling seine Wedel aus wie Bischofsstäbe.' },
  { id: 'hartstongue', name: 'Hirschzunge', group: 'mosses', unlock: 4, growth: 0.7, seeds: 0.3, light: 0, water: 2, provides: ['feucht'], text: 'Ein Farn mit ungeteilten, glänzenden Blättern – liebt tiefen Schatten.' },
];

// ---------------------------------------------------------------------------
// Tiere (und Pilze)
// ---------------------------------------------------------------------------

export interface Species {
  id: string;
  name: string;
  genus: Genus;
  rarity: Rarity;
  level: Level;
  niche: NicheId;
  unlock: number;
  /** Nahrung: mindestens ein Merkmal muss vorhanden sein (zählt doppelt). */
  food: Tag[];
  /** Weitere Wünsche an den Lebensraum (je einfach gewichtet). */
  needs: Condition[];
  /** Nur besonders/legendär: erst ziehbar, wenn diese Bedingungen erfüllt sind. */
  appears?: Condition[];
  provides: Tag[];
  effects: Effect[];
  text: string;
}

export const SPECIES: readonly Species[] = [
  // --- Bodenleben ---------------------------------------------------------
  { id: 'earthworm', name: 'Regenwurm', genus: 'soil', rarity: 0, level: 'decomposer', niche: 'roots', unlock: 1,
    food: ['laub'], needs: [{ kind: 'tag', tag: 'feucht' }], provides: ['wuermer'],
    effects: [{ kind: 'water', amount: 2 }, { kind: 'growth', pct: 8 }],
    text: 'Frisst sich durch die Erde und hinterlässt Gänge, durch die der Regen sickert.' },
  { id: 'woodlouse', name: 'Rollassel', genus: 'soil', rarity: 0, level: 'decomposer', niche: 'litter', unlock: 2,
    food: ['laub'], needs: [{ kind: 'tag', tag: 'totholz' }], provides: ['insekten'],
    effects: [{ kind: 'growth', pct: 8 }],
    text: 'Rollt sich bei Gefahr zur Kugel und macht aus Laub fruchtbare Erde.' },
  { id: 'slug', name: 'Nacktschnecke', genus: 'soil', rarity: 0, level: 'herbivore', niche: 'litter', unlock: 2,
    food: ['kraut'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }], provides: ['schnecken'],
    effects: [{ kind: 'damage', pct: 6 }, { kind: 'water', amount: 1 }],
    text: 'Kommt nachts, wenn es feucht ist. Und sie hat Hunger.' },
  { id: 'centipede', name: 'Steinläufer', genus: 'soil', rarity: 1, level: 'predator', niche: 'litter', unlock: 3,
    food: ['insekten', 'wuermer'], needs: [{ kind: 'tag', tag: 'totholz' }], provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 30 }, { kind: 'growth', pct: 6 }],
    text: 'Fünfzehn Beinpaare, flink und nachts auf der Jagd unter der Rinde.' },
  { id: 'snail', name: 'Weinbergschnecke', genus: 'soil', rarity: 2, level: 'decomposer', niche: 'litter', unlock: 4,
    food: ['laub', 'kraut'], needs: [{ kind: 'group', group: 'flowers', min: 2 }, { kind: 'tag', tag: 'feucht' }],
    appears: [{ kind: 'tag', tag: 'feucht' }], provides: ['schnecken'],
    effects: [{ kind: 'growth', pct: 12 }, { kind: 'water', amount: 2 }, { kind: 'ability', id: 'calm' }],
    text: 'Trägt ihr Haus seit Jahren mit sich herum. Eile kennt sie nicht.' },
  { id: 'salamander', name: 'Feuersalamander', genus: 'soil', rarity: 3, level: 'predator', niche: 'litter', unlock: 5,
    food: ['schnecken', 'wuermer', 'insekten'], needs: [{ kind: 'group', group: 'mosses', min: 2 }, { kind: 'tag', tag: 'totholz' }, { kind: 'shady' }],
    appears: [{ kind: 'group', group: 'mosses', min: 2 }, { kind: 'tag', tag: 'totholz' }], provides: [],
    effects: [{ kind: 'growth', pct: 15 }, { kind: 'control', tag: 'schnecken', pct: 50 }, { kind: 'ability', id: 'mossNoWater' }],
    text: 'Schwarz-gelb und uralt. Wo er lebt, ist der Wald noch feucht und heil.' },

  // --- Pilze ----------------------------------------------------------------
  { id: 'chanterelle', name: 'Pfifferling', genus: 'fungi', rarity: 0, level: 'decomposer', niche: 'roots', unlock: 1,
    food: ['wurzeln'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'shady' }], provides: [],
    effects: [{ kind: 'groupGrowth', group: 'trees', pct: 10 }],
    text: 'Goldgelb im Moos – und unterirdisch mit den Baumwurzeln verbunden.' },
  { id: 'tinder', name: 'Zunderschwamm', genus: 'fungi', rarity: 0, level: 'decomposer', niche: 'bark', unlock: 3,
    food: ['laub'], needs: [{ kind: 'group', group: 'trees', min: 2 }], provides: ['totholz'],
    effects: [{ kind: 'growth', pct: 5 }, { kind: 'damage', pct: 3 }],
    text: 'Ein Hufeisen aus Holz am Stamm. Er macht aus altem Holz neues Leben.' },
  { id: 'porcini', name: 'Steinpilz', genus: 'fungi', rarity: 1, level: 'decomposer', niche: 'roots', unlock: 3,
    food: ['wurzeln'], needs: [{ kind: 'group', group: 'trees', min: 2 }, { kind: 'genus', genus: 'soil', min: 1 }], provides: [],
    effects: [{ kind: 'groupGrowth', group: 'trees', pct: 20 }, { kind: 'water', amount: 3 }],
    text: 'Feine Pilzfäden umspinnen die Wurzeln und tauschen Wasser gegen Zucker.' },
  { id: 'flyagaric', name: 'Fliegenpilz', genus: 'fungi', rarity: 2, level: 'decomposer', niche: 'roots', unlock: 4,
    food: ['wurzeln'], needs: [{ kind: 'species', id: 'birch' }, { kind: 'tag', tag: 'feucht' }],
    appears: [{ kind: 'species', id: 'birch' }], provides: [],
    effects: [{ kind: 'groupGrowth', group: 'trees', pct: 15 }, { kind: 'seeds', pct: 10 }, { kind: 'ability', id: 'rarityBoost' }],
    text: 'Rot mit weißen Tupfen, der treue Begleiter der Birke. Bringt Glück.' },
  { id: 'honeyfungus', name: 'Hallimasch', genus: 'fungi', rarity: 3, level: 'decomposer', niche: 'roots', unlock: 5,
    food: ['wurzeln', 'totholz'], needs: [{ kind: 'group', group: 'trees', min: 3 }, { kind: 'tag', tag: 'totholz' }, { kind: 'genus', genus: 'fungi', min: 2 }],
    appears: [{ kind: 'genus', genus: 'fungi', min: 2 }, { kind: 'tag', tag: 'totholz' }], provides: [],
    effects: [{ kind: 'growth', pct: 20 }, { kind: 'ability', id: 'minSupply' }],
    text: 'Das größte Lebewesen der Erde ist ein Pilz. Sein Netz verbindet den ganzen Wald.' },

  // --- Insekten -------------------------------------------------------------
  { id: 'oakmoth', name: 'Eichenwickler', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'crown', unlock: 3,
    food: ['laub'], needs: [], provides: ['insekten', 'raupen'],
    effects: [{ kind: 'damage', pct: 10 }, { kind: 'growth', pct: 3 }],
    text: 'Eine grüne Raupe, die sich in Blätter einrollt – Meisenfutter erster Güte.' },
  { id: 'bee', name: 'Wildbiene', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 2,
    food: ['nektar'], needs: [{ kind: 'group', group: 'flowers', min: 1 }, { kind: 'sunny' }], provides: ['insekten'],
    effects: [{ kind: 'groupSeeds', group: 'flowers', pct: 40 }, { kind: 'groupSeeds', group: 'shrubs', pct: 25 }, { kind: 'seeds', pct: 5 }],
    text: 'Summt von Blüte zu Blüte und bringt Früchte hervor.' },
  { id: 'peacock', name: 'Tagpfauenauge', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 3,
    food: ['nektar'], needs: [{ kind: 'species', id: 'nettle' }, { kind: 'sunny' }], provides: ['insekten', 'raupen'],
    effects: [{ kind: 'seeds', pct: 10 }, { kind: 'groupSeeds', group: 'flowers', pct: 20 }],
    text: 'Vier blaue Augen auf rotem Grund. Die Raupen wachsen nur auf Brennnesseln.' },
  { id: 'barkbeetle', name: 'Borkenkäfer', genus: 'insects', rarity: 0, level: 'herbivore', niche: 'bark', unlock: 3,
    food: ['laub', 'nadeln'], needs: [], provides: ['insekten', 'kaefer', 'totholz'],
    effects: [{ kind: 'damage', pct: 8 }, { kind: 'slot', niche: 'hollows', amount: 1 }],
    text: 'Zeichnet feine Gänge unter die Rinde. Schön anzusehen, schlecht für den Baum.' },
  { id: 'woodant', name: 'Rote Waldameise', genus: 'insects', rarity: 1, level: 'predator', niche: 'litter', unlock: 4,
    food: ['insekten'], needs: [{ kind: 'tag', tag: 'nadeln' }, { kind: 'sunny' }], provides: ['insekten'],
    effects: [{ kind: 'control', tag: 'raupen', pct: 40 }, { kind: 'groupSeeds', group: 'flowers', pct: 30 }, { kind: 'growth', pct: 4 }],
    text: 'Ein Hügel aus Nadeln, eine Million Schwestern – und sie tragen Samen davon.' },
  { id: 'glowworm', name: 'Glühwürmchen', genus: 'insects', rarity: 2, level: 'predator', niche: 'edge', unlock: 4,
    food: ['schnecken'], needs: [{ kind: 'tag', tag: 'feucht' }, { kind: 'group', group: 'flowers', min: 1 }],
    appears: [{ kind: 'tag', tag: 'schnecken' }], provides: ['insekten'],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 60 }, { kind: 'harmony', points: 4 }, { kind: 'ability', id: 'communityBoost' }],
    text: 'Seine Larven jagen Schnecken. An Juniabenden leuchtet der Waldsaum.' },
  { id: 'stagbeetle', name: 'Hirschkäfer', genus: 'insects', rarity: 3, level: 'decomposer', niche: 'hollows', unlock: 5,
    food: ['totholz'], needs: [{ kind: 'shady' }, { kind: 'genus', genus: 'fungi', min: 1 }, { kind: 'sunny' }],
    appears: [{ kind: 'tag', tag: 'totholz' }], provides: ['insekten', 'kaefer'],
    effects: [{ kind: 'growth', pct: 10 }, { kind: 'harmony', points: 5 }, { kind: 'ability', id: 'decomposerBoost' }],
    text: 'Seine Larven leben fünf Jahre im morschen Holz. Geduld ist alles.' },

  // --- Vögel ----------------------------------------------------------------
  { id: 'robin', name: 'Rotkehlchen', genus: 'birds', rarity: 0, level: 'predator', niche: 'litter', unlock: 2,
    food: ['wuermer', 'insekten', 'beeren'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }], provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 20 }, { kind: 'seeds', pct: 8 }],
    text: 'Folgt jedem, der im Boden gräbt – vielleicht kommt ein Wurm zum Vorschein.' },
  { id: 'bluetit', name: 'Blaumeise', genus: 'birds', rarity: 0, level: 'predator', niche: 'crown', unlock: 3,
    food: ['raupen', 'insekten'], needs: [{ kind: 'group', group: 'trees', min: 2 }, { kind: 'tag', tag: 'hoehle' }], provides: [],
    effects: [{ kind: 'control', tag: 'raupen', pct: 50 }, { kind: 'seeds', pct: 4 }],
    text: 'Ein Meisenpaar verfüttert im Frühling Tausende Raupen.' },
  { id: 'woodpecker', name: 'Buntspecht', genus: 'birds', rarity: 1, level: 'predator', niche: 'bark', unlock: 4,
    food: ['kaefer', 'insekten', 'nuesse'], needs: [{ kind: 'tag', tag: 'totholz' }], provides: ['hoehle'],
    effects: [{ kind: 'control', tag: 'kaefer', pct: 60 }, { kind: 'slot', niche: 'hollows', amount: 1 }, { kind: 'growth', pct: 4 }],
    text: 'Klopft, horcht, hackt. Seine alten Höhlen sind begehrter Wohnraum.' },
  { id: 'jay', name: 'Eichelhäher', genus: 'birds', rarity: 1, level: 'herbivore', niche: 'crown', unlock: 4,
    food: ['nuesse'], needs: [], provides: [],
    effects: [{ kind: 'growth', pct: 12 }, { kind: 'seeds', pct: 10 }, { kind: 'disturb', target: 'bluetit' }],
    text: 'Der Förster des Waldes: vergräbt Tausende Eicheln und findet nicht alle wieder.' },
  { id: 'owl', name: 'Waldkauz', genus: 'birds', rarity: 2, level: 'predator', niche: 'hollows', unlock: 4,
    food: ['kleinsaeuger'], needs: [{ kind: 'group', group: 'trees', min: 2 }],
    appears: [{ kind: 'tag', tag: 'kleinsaeuger' }], provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 70 }, { kind: 'growth', pct: 8 }, { kind: 'ability', id: 'nightWatch' }],
    text: 'Huhu-huuu. Nachts jagt er lautlos über den Waldboden.' },
  { id: 'blackwoodpecker', name: 'Schwarzspecht', genus: 'birds', rarity: 3, level: 'predator', niche: 'bark', unlock: 5,
    food: ['insekten', 'kaefer'], needs: [{ kind: 'species', id: 'woodant' }, { kind: 'tag', tag: 'totholz' }, { kind: 'group', group: 'trees', min: 3 }],
    appears: [{ kind: 'species', id: 'woodpecker' }], provides: ['hoehle'],
    effects: [{ kind: 'growth', pct: 10 }, { kind: 'control', tag: 'kaefer', pct: 40 }, { kind: 'ability', id: 'architect' }],
    text: 'Der Baumeister des Waldes. In seine Höhlen ziehen später Kauz, Fledermaus und Hohltaube.' },

  // --- Säugetiere -----------------------------------------------------------
  { id: 'vole', name: 'Wühlmaus', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'roots', unlock: 1,
    food: ['wurzeln', 'kraut'], needs: [], provides: ['kleinsaeuger'],
    effects: [{ kind: 'damage', pct: 8 }, { kind: 'seeds', pct: 4 }],
    text: 'Knabbert an zarten Wurzeln. Lecker findet sie vor allem der Kauz.' },
  { id: 'squirrel', name: 'Eichhörnchen', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'crown', unlock: 3,
    food: ['nuesse'], needs: [{ kind: 'group', group: 'trees', min: 2 }], provides: [],
    effects: [{ kind: 'seeds', pct: 12 }, { kind: 'growth', pct: 6 }, { kind: 'disturb', target: 'bluetit' }],
    text: 'Versteckt Hunderte Nüsse – und vergisst zum Glück viele davon.' },
  { id: 'deer', name: 'Reh', genus: 'mammals', rarity: 0, level: 'herbivore', niche: 'edge', unlock: 4,
    food: ['kraut', 'laub'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }, { kind: 'sunny' }], provides: ['rehe'],
    effects: [{ kind: 'light', amount: 3 }, { kind: 'damage', pct: 10 }],
    text: 'Zupft am liebsten die frischesten Triebe – und hält so den Saum offen.' },
  { id: 'mole', name: 'Maulwurf', genus: 'mammals', rarity: 1, level: 'predator', niche: 'roots', unlock: 2,
    food: ['wuermer', 'insekten'], needs: [], provides: [],
    effects: [{ kind: 'water', amount: 2 }, { kind: 'growth', pct: 5 }, { kind: 'disturb', target: 'earthworm' }],
    text: 'Gräbt unermüdlich – zum Leidwesen der Regenwürmer.' },
  { id: 'hedgehog', name: 'Igel', genus: 'mammals', rarity: 1, level: 'predator', niche: 'litter', unlock: 3,
    food: ['schnecken', 'insekten', 'wuermer'], needs: [{ kind: 'group', group: 'shrubs', min: 1 }], provides: [],
    effects: [{ kind: 'control', tag: 'schnecken', pct: 70 }, { kind: 'growth', pct: 4 }],
    text: 'Schmatzt sich nachts durchs Laub. Schnecken sind sein Leibgericht.' },
  { id: 'fox', name: 'Rotfuchs', genus: 'mammals', rarity: 1, level: 'predator', niche: 'edge', unlock: 4,
    food: ['kleinsaeuger'], needs: [{ kind: 'group', group: 'shrubs', min: 2 }], provides: [],
    effects: [{ kind: 'control', tag: 'kleinsaeuger', pct: 50 }, { kind: 'seeds', pct: 6 }],
    text: 'Springt mit einem Satz auf die Maus unter dem Laub – und verteilt Beerensamen.' },
  { id: 'bat', name: 'Braunes Langohr', genus: 'mammals', rarity: 2, level: 'predator', niche: 'hollows', unlock: 4,
    food: ['insekten'], needs: [{ kind: 'group', group: 'flowers', min: 2 }],
    appears: [{ kind: 'genus', genus: 'insects', min: 2 }], provides: [],
    effects: [{ kind: 'control', tag: 'insekten', pct: 40 }, { kind: 'seeds', pct: 8 }, { kind: 'ability', id: 'countsAsBird' }],
    text: 'Hört mit riesigen Ohren jeden Nachtfalter.' },
  { id: 'wolf', name: 'Wolf', genus: 'mammals', rarity: 3, level: 'predator', niche: 'edge', unlock: 6,
    food: ['rehe'], needs: [{ kind: 'group', group: 'trees', min: 3 }],
    appears: [{ kind: 'species', id: 'deer' }], provides: [],
    effects: [{ kind: 'growth', pct: 15 }, { kind: 'ability', id: 'fear' }],
    text: 'Er ist zurück. Wo er durchzieht, wächst der Wald wieder dichter.' },
];

// ---------------------------------------------------------------------------
// Gattungsboni (Schwellen 2 / 3 / 5)
// ---------------------------------------------------------------------------

export const TRAIT_THRESHOLDS = [2, 3, 5] as const;

export const TRAITS: Record<Genus, readonly (readonly Effect[])[]> = {
  birds: [
    [{ kind: 'control', tag: 'insekten', pct: 25 }],
    [{ kind: 'seeds', pct: 15 }],
    [{ kind: 'growth', pct: 20 }, { kind: 'seeds', pct: 20 }],
  ],
  insects: [
    [{ kind: 'groupSeeds', group: 'flowers', pct: 30 }],
    [{ kind: 'groupSeeds', group: 'shrubs', pct: 30 }, { kind: 'groupSeeds', group: 'trees', pct: 30 }],
    [{ kind: 'seeds', pct: 40 }],
  ],
  mammals: [
    [{ kind: 'seeds', pct: 10 }],
    [{ kind: 'growth', pct: 12 }],
    [{ kind: 'growth', pct: 25 }],
  ],
  soil: [
    [{ kind: 'water', amount: 2 }],
    [{ kind: 'growth', pct: 12 }],
    [{ kind: 'growth', pct: 25 }, { kind: 'water', amount: 3 }],
  ],
  fungi: [
    [{ kind: 'groupGrowth', group: 'trees', pct: 10 }],
    [{ kind: 'water', amount: 3 }, { kind: 'light', amount: 2 }],
    [{ kind: 'growth', pct: 30 }],
  ],
};

export const TRAIT_TEXT: Record<Genus, readonly string[]> = {
  birds: ['Insektenschaden −25 %', '+15 % Samen', '+20 % Wachstum, +20 % Samen'],
  insects: ['Blumen +30 % Samen', 'Sträucher und Bäume +30 % Samen', '+40 % Samen'],
  mammals: ['+10 % Samen', '+12 % Wachstum', '+25 % Wachstum'],
  soil: ['+2 Wasser', '+12 % Wachstum', '+25 % Wachstum, +3 Wasser'],
  fungi: ['Bäume +10 % Wachstum', '+3 Wasser, +2 Licht', '+30 % Wachstum'],
};

// ---------------------------------------------------------------------------
// Lebensgemeinschaften (Arten- oder Pflanzen-IDs; Array = eine davon genügt)
// ---------------------------------------------------------------------------

export interface Community {
  id: string;
  name: string;
  members: (string | string[])[];
  harmony: number;
  effects: Effect[];
  hint: string;
}

export const COMMUNITIES: readonly Community[] = [
  { id: 'humus', name: 'Humusküche', members: ['earthworm', 'woodlouse', ['chanterelle', 'porcini']], harmony: 8, effects: [{ kind: 'growth', pct: 5 }], hint: 'Aus Laub wird Erde, aus Erde wird Leben.' },
  { id: 'caterpillar-watch', name: 'Raupenwacht', members: ['oakmoth', 'bluetit', ['bat', 'woodant']], harmony: 8, effects: [], hint: 'Tags und nachts wird die Krone bewacht.' },
  { id: 'deadwood', name: 'Totholz-Kette', members: ['barkbeetle', 'woodpecker', 'tinder', ['owl', 'bat']], harmony: 10, effects: [], hint: 'Was stirbt, schafft Wohnraum.' },
  { id: 'night-shift', name: 'Nachtschicht', members: ['owl', 'bat', ['hedgehog', 'glowworm']], harmony: 6, effects: [], hint: 'Wenn du schläfst, arbeiten sie.' },
  { id: 'seed-couriers', name: 'Samenboten', members: ['squirrel', 'jay', 'bee'], harmony: 8, effects: [{ kind: 'seeds', pct: 10 }], hint: 'Blüte, Frucht und Versteck.' },
  { id: 'wild-edge', name: 'Wilder Waldsaum', members: ['deer', 'fox', 'wolf'], harmony: 10, effects: [], hint: 'Erst der Jäger bringt den Wald ins Gleichgewicht.' },
  { id: 'flower-hem', name: 'Blütensaum', members: ['bee', 'peacock', 'nettle', ['strawberry', 'foxglove']], harmony: 6, effects: [], hint: 'Wo Brennnesseln stehen dürfen, tanzen Falter.' },
  { id: 'birch-bond', name: 'Birkenbund', members: ['birch', 'flyagaric', 'moss'], harmony: 6, effects: [], hint: 'Weiß, rot und grün – ein altes Bündnis.' },
  { id: 'damp-ground', name: 'Feuchter Grund', members: ['moss', 'fern', ['slug', 'salamander']], harmony: 6, effects: [], hint: 'Im Schatten, wo es nie ganz trocknet.' },
];

// ---------------------------------------------------------------------------
// Begegnungen
// ---------------------------------------------------------------------------

export type EncounterType = 'animal' | 'plant' | 'event' | 'visitor';

/** Gewichte der Begegnungstypen je Stufe: [Tier, Pflanze, Ereignis, Durchreisende]. */
export const ENCOUNTER_WEIGHTS: readonly (readonly [number, number, number, number])[] = [
  [60, 40, 0, 0], // Samen
  [60, 40, 0, 0], // Keimling
  [60, 40, 0, 0], // Setzling
  [60, 25, 15, 0], // Junger Baum
  [55, 20, 15, 10], // Alter Baum
  [55, 20, 15, 10], // Hain
  [55, 20, 15, 10], // Wald
  [55, 20, 15, 10], // Urwald
];
/** Die ersten Begegnungen sind festgelegt (Einführung). */
export const SCRIPTED_ENCOUNTERS: readonly EncounterType[] = ['animal', 'plant', 'animal'];

/** Seltenheitsgewichte [g, s, b, l] je Stufe. */
export const RARITY_WEIGHTS: readonly (readonly [number, number, number, number])[] = [
  [90, 10, 0, 0],
  [90, 10, 0, 0],
  [85, 15, 0, 0],
  [72, 23, 5, 0],
  [60, 28, 10, 2],
  [50, 30, 14, 6],
  [45, 30, 17, 8],
  [40, 30, 20, 10],
];

export const CARDS_PER_ENCOUNTER = 3;

/** Kosten einer weiteren Pflanze, wenn schon n Begleitpflanzen wachsen (Hauptbaum zählt nicht). */
export const PLANT_COST_BASE = 20;
export const PLANT_COST_GROWTH = 1.9;
export function plantCost(n: number): number {
  return PLANT_COST_BASE * Math.pow(PLANT_COST_GROWTH, n);
}
/** Neu würfeln kostet einen Anteil der nächsten Pflanze; Ablehnen bringt einen Anteil. */
export const REROLL_COST_SHARE = 0.5;
export const DECLINE_SEED_SHARE = 0.25;

export interface GameEvent {
  id: string;
  name: string;
  unlock: number;
  /** Option A: dauerhafte Wirkung. Option B: Samen (Anteil der nächsten Pflanze). */
  keep: { label: string; tags: Tag[]; effects: Effect[] };
  take: { label: string; seedShare: number };
  text: string;
}

export const EVENTS: readonly GameEvent[] = [
  { id: 'storm', name: 'Sturmnacht', unlock: 3, text: 'Ein Ast ist abgebrochen und liegt im Laub.',
    keep: { label: 'Totholz liegen lassen', tags: ['totholz'], effects: [{ kind: 'slot', niche: 'hollows', amount: 1 }] },
    take: { label: 'Holz räumen und verwerten', seedShare: 1 } },
  { id: 'rain', name: 'Regenreicher Frühling', unlock: 3, text: 'In einer Senke sammelt sich das Wasser.',
    keep: { label: 'Waldtümpel entstehen lassen', tags: ['feucht'], effects: [{ kind: 'water', amount: 3 }] },
    take: { label: 'Wasser ableiten, Samen ernten', seedShare: 1 } },
  { id: 'windthrow', name: 'Windwurf', unlock: 4, text: 'Ein alter Nachbarbaum ist umgestürzt – plötzlich ist es hell.',
    keep: { label: 'Lichtung offen lassen', tags: [], effects: [{ kind: 'light', amount: 3 }] },
    take: { label: 'Stamm verkaufen', seedShare: 1.2 } },
];

/** Durchreisende: wirken für VISITOR_WAYPOINTS Wegpunkte, brauchen keinen Platz. */
export const VISITOR_WAYPOINTS = 3;
export const VISITORS: readonly { id: string; name: string; genus: Genus; effects: Effect[]; text: string }[] = [
  { id: 'cranes', name: 'Kraniche', genus: 'birds', effects: [{ kind: 'seeds', pct: 20 }], text: 'Trompetend ziehen sie nach Süden und rasten eine Nacht.' },
  { id: 'bramblings', name: 'Bergfinken', genus: 'birds', effects: [{ kind: 'growth', pct: 10 }, { kind: 'seeds', pct: 10 }], text: 'Ein Schwarm aus dem Norden plündert die Bucheckern.' },
  { id: 'hummingbird-moth', name: 'Taubenschwänzchen', genus: 'insects', effects: [{ kind: 'groupSeeds', group: 'flowers', pct: 50 }], text: 'Ein Falter, der schwirrt wie ein Kolibri.' },
];
