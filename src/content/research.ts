import type { CycleEffect } from './events';
import { HABITAT_RESEARCH } from './habitats';
import type { HappinessEffect } from './seasons';
import type { Condition, Effect, NicheId, PlantGroup, Tag } from './types';

/**
 * Forschungsbaum (docs/DESIGN_V2.md 27.7). Reine Daten – die Logik steht in src/core/tick.ts
 * (research, researchBlocker, previewResearch) und formulas.ts (researchEffects). Seit
 * Spielstand v17 ersetzt der Baum die Pflege (`cycle.research` statt `cycle.care`, Kosten in
 * ⚖️ Harmonie aus dem Vorrat `harmonyPoints` statt 🌰).
 *
 * - **Knoten statt Ränge:** Jeder Knoten wird einmal mit ⚖️ erforscht und wirkt bis zum
 *   Neuen Zyklus (wie Pflege). Die Wirkungen der 25 heutigen Pflege-Ränge sind 1:1 dieselben
 *   Daten (Tabelle CARE_TO_RESEARCH); neu sind 7 Knoten.
 * - **Ebene = Stufe** (`minStage`, Index in STAGES): Setzling 2, Junger Baum 3, Alter Baum 4,
 *   Hain 5, Wald 6.
 * - **Voraussetzungen:** `requires` (alle), `requiresAny` (mindestens einer), auch über Äste
 *   hinweg; stehen in RESEARCH immer vor dem Knoten (Reihenfolge der Migration, 27.9).
 *   `condition` (wie `requires` der Pflege) gilt nur beim Erforschen.
 * - **Gabeln** (RESEARCH_FORKS): zwei gleich teure Wege; jeder Knoten eines Weges schließt
 *   jeden Knoten des anderen aus (`excludes`, gegenseitig eingetragen). Bei der Krone gilt die
 *   Wahl für alle drei Ebenen.
 *
 * Wirkungen:
 * - `cycle` / `habitat` wie bis v16 die Pflege: Licht, Wasser, Plätze, Harmonie,
 *   🌿/🌰/Gruppen-Boni bis zum Neuen Zyklus; Merkmal wie eine Pflanze.
 * - `happiness` wie bei Jahreszeiten (HappinessEffect, 16.3): +points Prozentpunkte
 *   Zufriedenheit für alle Tiere der Gattung, vor der Begrenzung auf 0–1.
 *   Beispiel Pilzgarten: Steinpilz 62 % → 77 %.
 * - Aussaat (nur in den Aussaat-Funktionen, nicht in `evaluate`; sowing.ts):
 *   `sowCards` +amount Karten je Aussaat (höchstens MAX_SOWING_CARDS),
 *   `sowCost` pct % auf den Aussaat-Preis (−25 → Faktor 0,75; Untergrenze 0,25),
 *   `sowFreeReroll` die ersten amount Würfe je Aussaat kosten nichts.
 */

/** Dauerhafte Wirkungen eines Knotens (Erweiterung von CycleEffect, events.ts). */
export type ResearchCycleEffect =
  | CycleEffect
  | Extract<Effect, { kind: 'growth' | 'seeds' | 'groupGrowth' | 'groupSeeds' }>;

export type ResearchEffect =
  | { kind: 'cycle'; effect: ResearchCycleEffect }
  | { kind: 'habitat'; tag: Tag }
  | HappinessEffect
  | { kind: 'sowCards'; amount: number }
  | { kind: 'sowCost'; pct: number }
  | { kind: 'sowFreeReroll'; amount: number };

export type ResearchBranchId = 'soil' | 'water' | 'crown' | 'hem' | 'open' | 'seed';

export interface ResearchBranch {
  id: ResearchBranchId;
  name: string;
  icon: string;
  /** Farbe des Asts (Stempel „erforscht“, Linien im Baum). */
  color: string;
}

export interface ResearchNode {
  id: string;
  branch: ResearchBranchId;
  name: string;
  icon: string;
  /** Ebene: ab dieser Stufe (Index in STAGES) erforschbar. */
  minStage: number;
  /** Kosten in ⚖️ Harmonie (fest). */
  cost: number;
  /** Alle diese Knoten müssen erforscht sein. */
  requires?: readonly string[];
  /** Mindestens einer dieser Knoten muss erforscht sein. */
  requiresAny?: readonly string[];
  /** Gabel: Knoten des anderen Weges (gegenseitig eingetragen). */
  excludes?: readonly string[];
  /** Bedingungen wie `Species.appears` – gelten nur beim Erforschen. */
  condition?: readonly Condition[];
  effects: readonly ResearchEffect[];
  /** Wirkung in Kurzform, z. B. „+3 ☀️“. */
  summary: string;
  /** Stimmungstext (ein Satz, ≤ 120 Zeichen). */
  text: string;
  /** Kurze Bestätigung nach dem Erforschen (UI: schwebender Hinweis). */
  boughtText: string;
  /**
   * Wiederholbarer Knoten (28.6): Rang r ≥ 0 ohne Obergrenze (außer MAX_RESEARCH_RANK).
   * Kosten von Rang r → r+1 = ⌈ base · growth^r ⌉ ⚖️ (`cost` = base); `effects` gelten je Rang
   * und werden mit dem Rang multipliziert. Nur in RESEARCH_REPEATABLE.
   */
  repeatable?: { base: number; growth: number };
}

export interface ResearchFork {
  id: string;
  name: string;
  /** Die Abwägung in einem Satz (für U:Forschungsknoten). */
  question: string;
  /** Zwei Wege, Knoten Ebene für Ebene gleich teuer. */
  paths: readonly [readonly string[], readonly string[]];
}

// Ebenen (Index in STAGES)
const SAPLING = 2;
const YOUNG_TREE = 3;
const OLD_TREE = 4;
const GROVE = 5;
const FOREST = 6;

const slot = (niche: NicheId, amount = 1): ResearchEffect => ({ kind: 'cycle', effect: { kind: 'slot', niche, amount } });
const light = (amount: number): ResearchEffect => ({ kind: 'cycle', effect: { kind: 'light', amount } });
const water = (amount: number): ResearchEffect => ({ kind: 'cycle', effect: { kind: 'water', amount } });
const harmony = (points: number): ResearchEffect => ({ kind: 'cycle', effect: { kind: 'harmony', points } });

export const RESEARCH_BRANCHES: readonly ResearchBranch[] = [
  { id: 'soil', name: 'Boden', icon: '🪱', color: '#8a6a4a' },
  { id: 'water', name: 'Wasser', icon: '💧', color: '#4a8fb8' },
  { id: 'crown', name: 'Krone', icon: '🌳', color: '#4e8a3a' },
  { id: 'hem', name: 'Saum', icon: '🌼', color: '#d9a92e' },
  { id: 'open', name: 'Offenland', icon: '🌾', color: '#a8a04a' },
  { id: 'seed', name: 'Saat', icon: '🌱', color: '#6fae5a' },
];

const LIGHT_PATH = ['light-crown', 'light-crown-2', 'light-crown-3'];
const DENSE_PATH = ['dense-crown', 'dense-crown-2', 'dense-crown-3'];

/** Alle 32 Knoten, je Ast nach Ebene; Voraussetzungen stehen immer weiter oben. */
export const RESEARCH: readonly ResearchNode[] = [
  // --- 🪱 Boden ---------------------------------------------------------------
  {
    id: 'compost', branch: 'soil', name: 'Kompost', icon: '♻️', minStage: SAPLING, cost: 100,
    effects: [{ kind: 'habitat', tag: 'feucht' }], summary: 'Feuchte (für Regenwurm & Co.)',
    text: 'Eine Handvoll Kompost an den Wurzeln hält den Boden feucht – ein Festmahl für das Bodenleben.',
    boughtText: 'Kompost eingearbeitet',
  },
  {
    id: 'leaf-litter', branch: 'soil', name: 'Laub liegen lassen', icon: '🍂', minStage: SAPLING, cost: 80,
    effects: [slot('litter')], summary: '+1 Platz Laubstreu',
    text: 'Im Herbst bleibt das Laub, wo es fällt.',
    boughtText: 'Laub bleibt liegen',
  },
  {
    id: 'deadwood-pile', branch: 'soil', name: 'Totholzhaufen', icon: '🪵', minStage: OLD_TREE, cost: 600,
    requires: ['leaf-litter'],
    effects: [{ kind: 'habitat', tag: 'totholz' }, slot('deadwood', 2)], summary: 'Totholz, +2 Plätze Totholzhaufen',
    text: 'Ein Stapel alter Äste – Kinderstube für Käfer, Versteck für Igel.',
    boughtText: 'Totholz aufgeschichtet',
  },
  {
    id: 'humus', branch: 'soil', name: 'Humusschicht', icon: '🟫', minStage: GROVE, cost: 430,
    requires: ['compost', 'leaf-litter'],
    effects: [water(2), harmony(3)], summary: '+2 💧, +3 ⚖️',
    text: 'Aus dem Laub vom letzten Herbst ist schwarze, krümelige Erde geworden.',
    boughtText: 'Humus aufgebaut',
  },
  {
    id: 'beetle-castle', branch: 'soil', name: 'Käferburg', icon: '🪲', minStage: GROVE, cost: 850,
    requires: ['deadwood-pile'], excludes: ['fungus-garden'],
    effects: [slot('bark'), slot('deadwood'), harmony(2)],
    summary: '+1 Platz Stamm & Rinde, +1 Platz Totholzhaufen, +2 ⚖️',
    text: 'Halb eingegrabene Eichenstämme – darin wachsen Hirschkäferlarven fünf Jahre lang.',
    boughtText: 'Käferburg gebaut',
  },
  {
    id: 'fungus-garden', branch: 'soil', name: 'Pilzgarten', icon: '🍄', minStage: GROVE, cost: 850,
    requires: ['deadwood-pile', 'compost'], excludes: ['beetle-castle'],
    effects: [
      { kind: 'happiness', genus: 'fungi', points: 15 },
      { kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } },
      harmony(2),
    ],
    summary: 'Pilze +15 % 😊, Bäume +10 % 🌿, +2 ⚖️',
    text: 'Morsche Stubben im Halbschatten – das Myzel spinnt sich bis zu den Baumwurzeln.',
    boughtText: 'Pilzgarten angelegt',
  },
  // --- 💧 Wasser --------------------------------------------------------------
  {
    // Öffnet die Nische Waldtümpel für die Amphibien (DESIGN_V2.md 5.5).
    id: 'pond', branch: 'water', name: 'Waldtümpel', icon: '💧', minStage: OLD_TREE, cost: 1_000,
    requires: ['compost'],
    effects: [{ kind: 'habitat', tag: 'feucht' }, water(3), slot('pond', 2)],
    summary: 'Feuchte, +3 💧, +2 Plätze Waldtümpel',
    text: 'Eine feuchte Senke, in der sich der Regen sammelt.',
    boughtText: 'Tümpel angelegt',
  },
  {
    id: 'pond-deepen', branch: 'water', name: 'Tümpel vertiefen', icon: '🌊', minStage: GROVE, cost: 1_370,
    requires: ['pond'], excludes: ['spring-brook'],
    effects: [water(3), harmony(2), slot('pond', 2)], summary: '+3 💧, +2 ⚖️, +2 Plätze Waldtümpel',
    text: 'Eine tiefe Stelle friert im Winter nicht durch – die Molche danken es.',
    boughtText: 'Tümpel vertieft',
  },
  {
    id: 'spring-brook', branch: 'water', name: 'Quellbach', icon: '🏞️', minStage: GROVE, cost: 1_370,
    requires: ['pond'], excludes: ['pond-deepen'],
    effects: [
      water(3),
      { kind: 'cycle', effect: { kind: 'groupGrowth', group: 'mosses', pct: 30 } },
      { kind: 'happiness', genus: 'amphibians', points: 10 },
    ],
    summary: '+3 💧, Moose & Farne +30 % 🌿, Amphibien +10 % 😊',
    text: 'Ein Rinnsal sickert aus dem Hang und hält Moos und Farn das ganze Jahr nass.',
    boughtText: 'Quellbach freigelegt',
  },
  // --- 🌳 Krone ---------------------------------------------------------------
  {
    id: 'nest-boxes', branch: 'crown', name: 'Nistkästen', icon: '🏠', minStage: YOUNG_TREE, cost: 250,
    effects: [{ kind: 'habitat', tag: 'hoehle' }, slot('hollows')], summary: 'Baumhöhle, +1 Platz Höhlen',
    text: 'Ein Holzkasten mit kleinem Flugloch. Gemütlich – und leicht zu finden.',
    boughtText: 'Nistkästen angebracht',
  },
  {
    id: 'light-crown', branch: 'crown', name: 'Lichte Krone', icon: '☀️', minStage: OLD_TREE, cost: 550,
    requires: ['nest-boxes'], excludes: DENSE_PATH,
    effects: [light(3)], summary: '+3 ☀️',
    text: 'Ein paar Äste weniger – Sonnenflecken tanzen über den Boden.',
    boughtText: 'Krone gelichtet',
  },
  {
    id: 'dense-crown', branch: 'crown', name: 'Dichte Krone', icon: '🌳', minStage: OLD_TREE, cost: 550,
    requires: ['nest-boxes'], excludes: LIGHT_PATH,
    effects: [slot('crown'), light(-2)], summary: '+1 Platz Krone, −2 ☀️',
    text: 'Ein Dach aus Blättern, unter dem Vögel sicher brüten.',
    boughtText: 'Krone dicht gelassen',
  },
  {
    id: 'nest-boxes-2', branch: 'crown', name: 'Mehr Nistkästen', icon: '🏡', minStage: GROVE, cost: 670,
    requires: ['nest-boxes'],
    effects: [slot('crown')], summary: '+1 Platz Krone',
    text: 'Ein zweiter Kasten, höher am Stamm – die Meisen streiten nicht mehr.',
    boughtText: 'Zweiter Kasten hängt',
  },
  {
    id: 'light-crown-2', branch: 'crown', name: 'Lichte Krone II', icon: '🌤️', minStage: GROVE, cost: 830,
    requires: ['light-crown'], excludes: DENSE_PATH,
    effects: [light(2)], summary: '+2 ☀️',
    text: 'Noch ein Ast weniger – jetzt blühen auch unter der Krone die ersten Veilchen.',
    boughtText: 'Krone weiter gelichtet',
  },
  {
    id: 'dense-crown-2', branch: 'crown', name: 'Dichte Krone II', icon: '🍃', minStage: GROVE, cost: 830,
    requires: ['dense-crown'], excludes: LIGHT_PATH,
    effects: [{ kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } }], summary: 'Bäume +10 % 🌿',
    text: 'Die Blätter schließen sich zu einem grünen Gewölbe, kühl und still.',
    boughtText: 'Blätterdach geschlossen',
  },
  {
    id: 'light-crown-3', branch: 'crown', name: 'Lichte Krone III', icon: '🌞', minStage: FOREST, cost: 2_500,
    requires: ['light-crown-2'], excludes: DENSE_PATH,
    effects: [light(2)], summary: '+2 ☀️',
    text: 'Durch das lichte Dach fällt die Mittagssonne bis auf den Waldboden.',
    boughtText: 'Krone ganz licht',
  },
  {
    id: 'dense-crown-3', branch: 'crown', name: 'Dichte Krone III', icon: '🌲', minStage: FOREST, cost: 2_500,
    requires: ['dense-crown-2'], excludes: LIGHT_PATH,
    effects: [{ kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } }], summary: 'Bäume +10 % 🌿',
    text: 'Im Schatten des dichten Dachs warten junge Buchen geduldig auf ihre Zeit.',
    boughtText: 'Krone ganz dicht',
  },
  // --- 🌼 Saum ----------------------------------------------------------------
  {
    id: 'wildflower-hem', branch: 'hem', name: 'Wildblumen-Saum', icon: '🌼', minStage: YOUNG_TREE, cost: 300,
    effects: [{ kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 40 } }], summary: 'Blumen +40 % 🌰',
    text: 'Margeriten, Klee und hohes Gras am Rand des Baums.',
    boughtText: 'Wildblumen gesät',
  },
  {
    id: 'hem-wide', branch: 'hem', name: 'Breiter Saum', icon: '🌻', minStage: OLD_TREE, cost: 1_100,
    requires: ['wildflower-hem'],
    effects: [slot('edge')], summary: '+1 Platz Waldsaum',
    text: 'Der Saum wird jedes Jahr ein Stück breiter, weil niemand ihn mäht.',
    boughtText: 'Saum verbreitert',
  },
  {
    id: 'insect-hotel', branch: 'hem', name: 'Insektenhotel', icon: '🐝', minStage: OLD_TREE, cost: 350,
    requires: ['wildflower-hem'], condition: [{ kind: 'genus', genus: 'insects', min: 1 }],
    effects: [harmony(3)], summary: '+3 ⚖️',
    text: 'Hohle Stängel und gebohrte Löcher – jedes Zimmer ist bald belegt.',
    boughtText: 'Insektenhotel aufgestellt',
  },
  {
    id: 'bloom-store', branch: 'hem', name: 'Blütenvorrat', icon: '🌸', minStage: GROVE, cost: 760,
    requires: ['insect-hotel'], excludes: ['bee-wall'],
    effects: [
      { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 25 } },
      { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'shrubs', pct: 25 } },
    ],
    summary: 'Blumen und Sträucher +25 % 🌰',
    text: 'Frühblüher, Sommerblumen, Herbstastern – irgendwo blüht immer etwas.',
    boughtText: 'Blütenvorrat gesät',
  },
  {
    id: 'bee-wall', branch: 'hem', name: 'Wildbienenwand', icon: '🧱', minStage: GROVE, cost: 760,
    requires: ['insect-hotel'], excludes: ['bloom-store'],
    effects: [{ kind: 'happiness', genus: 'insects', points: 10 }, harmony(2)], summary: 'Insekten +10 % 😊, +2 ⚖️',
    text: 'Ein Lehmhang mit tausend Löchern – jede Wildbiene gräbt ihr eigenes.',
    boughtText: 'Lehmwand aufgeschüttet',
  },
  {
    id: 'hem-bloom', branch: 'hem', name: 'Blühender Saum', icon: '💐', minStage: FOREST, cost: 1_650,
    requires: ['hem-wide'],
    effects: [
      { kind: 'cycle', effect: { kind: 'groupGrowth', group: 'flowers', pct: 40 } },
      { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 40 } },
    ],
    summary: 'Blumen +40 % 🌿 und 🌰',
    text: 'Vom ersten Huflattich bis zum letzten Efeu summt es am Saum.',
    boughtText: 'Saum steht in Blüte',
  },
  {
    id: 'insect-hotel-3', branch: 'hem', name: 'Großes Insektenhotel', icon: '🏨', minStage: FOREST, cost: 2_100,
    requiresAny: ['bloom-store', 'bee-wall'],
    effects: [harmony(4)], summary: '+4 ⚖️',
    text: 'Ein Hochhaus aus Schilf, Ziegeln und Hartholz – mit Warteliste.',
    boughtText: 'Großes Hotel eröffnet',
  },
  // --- 🌾 Offenland (Daten in habitats.ts: Waldwiese, Trockenmauer) -------------
  ...HABITAT_RESEARCH,
  // --- 🌱 Saat ----------------------------------------------------------------
  {
    id: 'seed-sorting', branch: 'seed', name: 'Saatgut sortieren', icon: '🏷️', minStage: YOUNG_TREE, cost: 200,
    effects: [{ kind: 'sowCards', amount: 1 }], summary: 'Aussaat zeigt 4 statt 3 Karten',
    text: 'Kleine Tüten, sauber beschriftet – so findet jede Saat ihren Platz.',
    boughtText: 'Saatgut sortiert',
  },
  {
    id: 'seed-bank', branch: 'seed', name: 'Samenbank', icon: '🫙', minStage: OLD_TREE, cost: 500,
    requires: ['seed-sorting'], excludes: ['nursery'],
    effects: [{ kind: 'sowCost', pct: -25 }], summary: 'Aussaat −25 % 🌰',
    text: 'Trocken, dunkel und kühl – so bleiben Samen jahrelang keimfähig.',
    boughtText: 'Samenbank angelegt',
  },
  {
    id: 'nursery', branch: 'seed', name: 'Anzuchtbeet', icon: '🪴', minStage: OLD_TREE, cost: 500,
    requires: ['seed-sorting'], excludes: ['seed-bank'],
    effects: [{ kind: 'sowFreeReroll', amount: 1 }], summary: 'Erstes Neu würfeln je Aussaat gratis',
    text: 'Erst im Schutz vorziehen, dann auspflanzen – was nicht taugt, kommt auf den Kompost.',
    boughtText: 'Anzuchtbeet angelegt',
  },
  {
    id: 'dead-hedge', branch: 'seed', name: 'Benjeshecke', icon: '🪹', minStage: GROVE, cost: 760,
    requires: ['seed-sorting', 'nest-boxes'],
    effects: [{ kind: 'cycle', effect: { kind: 'groupSeeds', group: 'shrubs', pct: 30 } }, harmony(2)],
    summary: 'Sträucher +30 % 🌰, +2 ⚖️',
    text: 'Ein Wall aus Reisig: Die Vögel rasten darin und säen Schlehe, Holunder und Brombeere.',
    boughtText: 'Reisig aufgeschichtet',
  },
];

export const RESEARCH_BY_ID: ReadonlyMap<string, ResearchNode> = new Map(RESEARCH.map((n) => [n.id, n]));

/** Die fünf Gabeln (27.7, „Die fünf Gabeln“). */
export const RESEARCH_FORKS: readonly ResearchFork[] = [
  {
    id: 'crown', name: 'Krone', paths: [LIGHT_PATH, DENSE_PATH],
    question: 'Sonne für Saum, Wiese und Mauer – oder Platz für Vögel und Wachstum für Bäume?',
  },
  {
    id: 'soil', name: 'Boden', paths: [['beetle-castle'], ['fungus-garden']],
    question: 'Neue Arten im Totholz – oder zufriedene Pilze und kräftigere Bäume?',
  },
  {
    id: 'water', name: 'Wasser', paths: [['pond-deepen'], ['spring-brook']],
    question: 'Mehr Platz für Amphibien – oder bessere Amphibien und nasse Farne?',
  },
  {
    id: 'hem', name: 'Saum', paths: [['bloom-store'], ['bee-wall']],
    question: 'Samen für die Aussaat – oder Harmonie für die Forschung?',
  },
  {
    id: 'seed', name: 'Saat', paths: [['seed-bank'], ['nursery']],
    question: 'Mehr Aussaaten – oder bessere Karten je Aussaat?',
  },
];

/**
 * Migration v16 → v17 (27.9): Pflege-Maßnahme → Knoten je Rang (Index 0 = Rang 1).
 * Danach schenkt die Migration fehlende Voraussetzungen (Reihenfolge wie RESEARCH), soweit
 * ihre Stufe erreicht ist; von zwei Kronen bleibt nur die erste.
 */
export const CARE_TO_RESEARCH: Readonly<Record<string, readonly string[]>> = {
  compost: ['compost'],
  'leaf-litter': ['leaf-litter', 'humus'],
  'nest-boxes': ['nest-boxes', 'nest-boxes-2'],
  'wildflower-hem': ['wildflower-hem', 'hem-wide', 'hem-bloom'],
  meadow: ['meadow', 'meadow-2'],
  'deadwood-pile': ['deadwood-pile', 'beetle-castle'],
  'light-crown': LIGHT_PATH,
  'dense-crown': DENSE_PATH,
  pond: ['pond', 'pond-deepen'],
  'insect-hotel': ['insect-hotel', 'bloom-store', 'insect-hotel-3'],
  'drystone-wall': ['drystone-wall', 'drystone-wall-2'],
};

/** Startguthaben der Migration: so viele Minuten Produktion (round(10 · H), ohne G). */
export const MIGRATION_HARMONY_MINUTES = 10;

// --- ∞ Wiederholbare Knoten (DESIGN_V2.md 28.6) -------------------------------

/** Kosten des ersten Rangs in ⚖️. */
export const REPEATABLE_RESEARCH_BASE = 1_500;
/** Jeder weitere Rang kostet das 1,3-Fache (steiler als der Ausbau: ⚖️ wächst nicht exponentiell). */
export const REPEATABLE_RESEARCH_GROWTH = 1.3;
/** Obergrenze eines Rangs beim robusten Laden (28.8). */
export const MAX_RESEARCH_RANK = 200;

const REPEATABLE = { base: REPEATABLE_RESEARCH_BASE, growth: REPEATABLE_RESEARCH_GROWTH } as const;
const groupGrowth = (group: PlantGroup, pct: number): ResearchEffect =>
  ({ kind: 'cycle', effect: { kind: 'groupGrowth', group, pct } });
const groupSeeds = (group: PlantGroup, pct: number): ResearchEffect =>
  ({ kind: 'cycle', effect: { kind: 'groupSeeds', group, pct } });

/**
 * Je Ast ein endloser Knoten am Ende (Zeile „∞“ unter der Wald-Ebene), ab Hain, hinter der
 * Gabel des Asts (`requiresAny`: ein Knoten je Weg; Offenland ohne Gabel: Spätmahd oder
 * Trockenmauer). Wirkung je Rang klein und nur 🌿/🌰 – nie Harmonie, ⚖️-Ertrag oder Plätze.
 * `groupGrowth`/`groupSeeds` der Bäume gelten auch für den Hauptbaum.
 *
 * **Bis Phase 11, 2b ausgeblendet:** Die Knoten stehen bewusst NICHT in RESEARCH und
 * RESEARCH_BY_ID – der core, die Ansicht und der Simulator iterieren RESEARCH und würden sie
 * sonst als einmalige Knoten mit festen Kosten kaufen. 2b (Ränge in `cycle.researchRanks`,
 * `researchCost`) nimmt sie auf.
 */
export const RESEARCH_REPEATABLE: readonly ResearchNode[] = [
  {
    id: 'soil-life', branch: 'soil', name: 'Bodenleben fördern', icon: '🐛', minStage: GROVE,
    cost: REPEATABLE_RESEARCH_BASE, repeatable: REPEATABLE,
    requiresAny: ['beetle-castle', 'fungus-garden'],
    effects: [groupGrowth('trees', 1)], summary: 'Bäume +1 % 🌿 je Rang',
    text: 'Wo Asseln, Würmer und Pilze arbeiten, wird jedes Blatt wieder zu Erde.',
    boughtText: 'Bodenleben gefördert',
  },
  {
    id: 'wet-care', branch: 'water', name: 'Feuchte halten', icon: '💦', minStage: GROVE,
    cost: REPEATABLE_RESEARCH_BASE, repeatable: REPEATABLE,
    requiresAny: ['pond-deepen', 'spring-brook'],
    effects: [groupGrowth('mosses', 4), groupSeeds('mosses', 4)], summary: 'Moose & Farne +4 % 🌿 und 🌰 je Rang',
    text: 'Ein Graben weniger, ein nasser Fleck mehr – das Moos wächst wieder.',
    boughtText: 'Feuchte gehalten',
  },
  {
    id: 'old-branches', branch: 'crown', name: 'Altäste stehen lassen', icon: '🦉', minStage: GROVE,
    cost: REPEATABLE_RESEARCH_BASE, repeatable: REPEATABLE,
    requiresAny: ['light-crown-2', 'dense-crown-2'],
    effects: [groupSeeds('trees', 1)], summary: 'Bäume +1 % 🌰 je Rang',
    text: 'Totes Holz in der Krone ist Lebensraum – niemand sägt es ab.',
    boughtText: 'Altäste bleiben',
  },
  {
    id: 'hem-abundance', branch: 'hem', name: 'Blütenfülle', icon: '🏵️', minStage: GROVE,
    cost: REPEATABLE_RESEARCH_BASE, repeatable: REPEATABLE,
    requiresAny: ['bloom-store', 'bee-wall'],
    effects: [groupSeeds('flowers', 2)], summary: 'Blumen +2 % 🌰 je Rang',
    text: 'Jedes Jahr ein paar neue Arten am Saum – die Wildbienen finden sie.',
    boughtText: 'Saum blüht reicher',
  },
  {
    id: 'meadow-care', branch: 'open', name: 'Wiese pflegen', icon: '🪻', minStage: GROVE,
    cost: REPEATABLE_RESEARCH_BASE, repeatable: REPEATABLE,
    requiresAny: ['meadow-2', 'drystone-wall'],
    effects: [groupGrowth('flowers', 2)], summary: 'Blumen +2 % 🌿 je Rang',
    text: 'Gemäht wird mit der Sense, das Heu bleibt liegen, bis es aussamt.',
    boughtText: 'Wiese gepflegt',
  },
  {
    id: 'seed-refine', branch: 'seed', name: 'Saatgut veredeln', icon: '🧺', minStage: GROVE,
    cost: REPEATABLE_RESEARCH_BASE, repeatable: REPEATABLE,
    requiresAny: ['seed-bank', 'nursery'],
    effects: [groupSeeds('shrubs', 2)], summary: 'Sträucher +2 % 🌰 je Rang',
    text: 'Nur die Samen der kräftigsten Sträucher kommen in die Tüte.',
    boughtText: 'Saatgut veredelt',
  },
];

export const RESEARCH_REPEATABLE_BY_ID: ReadonlyMap<string, ResearchNode> = new Map(
  RESEARCH_REPEATABLE.map((n) => [n.id, n]),
);
