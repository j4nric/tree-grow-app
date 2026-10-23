import type { ResearchCycleEffect } from '../../src/content/research';
import type { Condition, NicheId, Tag } from '../../src/content/types';

/**
 * Eingefrorene Pflege bis Spielstand v16 (src/content/care.ts und MEADOW_CARE/WALL_CARE aus
 * habitats.ts, Stand vor Phase 10, 2a). Seit v17 ersetzt der Forschungsbaum die Pflege
 * (DESIGN_V2.md 27.7); die Daten hier prüfen nur noch die Abbildung Pflege → Knoten
 * (CARE_TO_RESEARCH, tests/research.test.ts) und die Migration v16 → v17 (tests/research-core.test.ts).
 * NICHT ändern – sie beschreiben alte Spielstände.
 */

/** Dauerhafte Wirkungen einer Maßnahme (Erweiterung von CycleEffect, events.ts). */
export type CareCycleEffect = ResearchCycleEffect;

export type CareEffect = { kind: 'cycle'; effect: CareCycleEffect } | { kind: 'habitat'; tag: Tag };

export interface CareRank {
  /** Kosten in 🌰 (fest, keine Samen-Sekunden: Wer später kauft, zahlt weniger Minuten Produktion). */
  cost: number;
  /** Ab dieser Stufe (Index in STAGES) kaufbar; mindestens die der Maßnahme. */
  minStage: number;
  effects: readonly CareEffect[];
  /** Wirkung in Kurzform, z. B. „+3 ☀️“. */
  summary: string;
}

export interface CareMeasure {
  id: string;
  name: string;
  icon: string;
  /** Stimmungstext (ein Satz). */
  text: string;
  /** Kurze Bestätigung nach dem Kauf, z. B. „Nistkästen angebracht“ (UI: schwebender Hinweis). */
  boughtText: string;
  /** Bedingungen wie `Species.appears` (alle müssen beim Kauf erfüllt sein). */
  requires?: readonly Condition[];
  /** Maßnahmen, die sich mit dieser ausschließen (gegenseitig eingetragen). */
  excludes?: readonly string[];
  /** Ränge in Kauf-Reihenfolge (1–3). Rang 1 bestimmt die Freischaltung. */
  ranks: readonly CareRank[];
}

const slot = (niche: NicheId, amount = 1): CareEffect => ({
  kind: 'cycle',
  effect: { kind: 'slot', niche, amount },
});

const MEADOW_CARE: CareMeasure = {
    id: 'meadow', name: 'Waldwiese', icon: '🌾',
    text: 'Einmal im Jahr gemäht, sonst in Ruhe gelassen – so blüht und zirpt die Lichtung.',
    boughtText: 'Wiese angelegt',
    ranks: [
      { cost: 2_400, minStage: 3, summary: '+2 Plätze Waldwiese', effects: [slot('meadow', 2)] },
      {
        cost: 16_000, minStage: 5, summary: '+2 Plätze Waldwiese, +2 ☀️',
        effects: [slot('meadow', 2), { kind: 'cycle', effect: { kind: 'light', amount: 2 } }],
      },
    ],
};

const WALL_CARE: CareMeasure = {
    id: 'drystone-wall', name: 'Trockenmauer', icon: '🪨',
    text: 'Lesesteine ohne Mörtel, in der Sonne geschichtet – jede Ritze ein Zuhause.',
    boughtText: 'Mauer geschichtet',
    ranks: [
      {
        cost: 12_000, minStage: 5, summary: '+2 Plätze Trockenmauer, +2 ☀️',
        effects: [slot('wall', 2), { kind: 'cycle', effect: { kind: 'light', amount: 2 } }],
      },
      {
        // 36.000 statt 32.000 🌰 aus dem Entwurf: Jeder Rang kostet mindestens das Dreifache (care.ts).
        cost: 36_000, minStage: 6, summary: '+2 Plätze Trockenmauer, +2 ⚖️',
        effects: [slot('wall', 2), { kind: 'cycle', effect: { kind: 'harmony', points: 2 } }],
      },
    ],
};

export const CARE_V16: readonly CareMeasure[] = [
  // --- ab Setzling (kleine Ränge, je 200 🌰) ------------------------------------
  {
    id: 'compost', name: 'Kompost', icon: '♻️',
    text: 'Eine Handvoll Kompost an den Wurzeln hält den Boden feucht – ein Festmahl für das Bodenleben.',
    boughtText: 'Kompost eingearbeitet',
    ranks: [
      { cost: 200, minStage: 2, effects: [{ kind: 'habitat', tag: 'feucht' }], summary: 'Feuchte (für Regenwurm & Co.)' },
    ],
  },
  {
    id: 'leaf-litter', name: 'Laub liegen lassen', icon: '🍂',
    text: 'Im Herbst bleibt das Laub, wo es fällt.',
    boughtText: 'Laub bleibt liegen',
    ranks: [
      { cost: 200, minStage: 2, effects: [slot('litter')], summary: '+1 Platz Laubstreu' },
      {
        cost: 7_000, minStage: 5, summary: '+2 💧, +3 ⚖️',
        effects: [{ kind: 'cycle', effect: { kind: 'water', amount: 2 } }, { kind: 'cycle', effect: { kind: 'harmony', points: 3 } }],
      },
    ],
  },
  // --- ab Junger Baum ---------------------------------------------------------
  {
    id: 'nest-boxes', name: 'Nistkästen', icon: '🏠',
    text: 'Ein Holzkasten mit kleinem Flugloch. Gemütlich – und leicht zu finden.',
    boughtText: 'Nistkästen angebracht',
    ranks: [
      { cost: 650, minStage: 3, effects: [{ kind: 'habitat', tag: 'hoehle' }, slot('hollows')], summary: 'Baumhöhle, +1 Platz Höhlen' },
      { cost: 11_000, minStage: 5, effects: [slot('crown')], summary: '+1 Platz Krone' },
    ],
  },
  {
    id: 'wildflower-hem', name: 'Wildblumen-Saum', icon: '🌼',
    text: 'Margeriten, Klee und hohes Gras am Rand des Baums.',
    boughtText: 'Wildblumen gesät',
    ranks: [
      {
        cost: 900, minStage: 3, summary: 'Blumen +40 % 🌰',
        effects: [{ kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 40 } }],
      },
      { cost: 8_000, minStage: 4, effects: [slot('edge')], summary: '+1 Platz Waldsaum' },
      {
        cost: 30_000, minStage: 6, summary: 'Blumen +40 % 🌿 und 🌰',
        effects: [
          { kind: 'cycle', effect: { kind: 'groupGrowth', group: 'flowers', pct: 40 } },
          { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 40 } },
        ],
      },
    ],
  },
  // Lebensraum Waldwiese (DESIGN_V2.md 23.2, Daten in habitats.ts)
  MEADOW_CARE,
  // --- ab Alter Baum ----------------------------------------------------------
  {
    // Öffnet seit den Lebensräumen (DESIGN_V2.md 23.2) den Totholzhaufen: Rang 1 4.500 🌰
    // (vorher 3.500) mit 2 Plätzen, Rang 2 einen dritten.
    id: 'deadwood-pile', name: 'Totholzhaufen', icon: '🪵',
    text: 'Ein Stapel alter Äste – Kinderstube für Käfer, Versteck für Igel.',
    boughtText: 'Totholz aufgeschichtet',
    ranks: [
      {
        cost: 4_500, minStage: 4, summary: 'Totholz, +2 Plätze Totholzhaufen',
        effects: [{ kind: 'habitat', tag: 'totholz' }, slot('deadwood', 2)],
      },
      {
        cost: 14_000, minStage: 5, summary: '+1 Platz Stamm & Rinde, +1 Platz Totholzhaufen, +2 ⚖️',
        effects: [slot('bark'), slot('deadwood'), { kind: 'cycle', effect: { kind: 'harmony', points: 2 } }],
      },
    ],
  },
  {
    id: 'light-crown', name: 'Lichte Krone', icon: '☀️',
    text: 'Ein paar Äste weniger – Sonnenflecken tanzen über den Boden.',
    boughtText: 'Krone gelichtet',
    excludes: ['dense-crown'],
    ranks: [
      { cost: 4_000, minStage: 4, effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 3 } }], summary: '+3 ☀️' },
      { cost: 15_000, minStage: 5, effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 2 } }], summary: '+2 ☀️' },
      { cost: 45_000, minStage: 6, effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 2 } }], summary: '+2 ☀️' },
    ],
  },
  {
    id: 'dense-crown', name: 'Dichte Krone', icon: '🌳',
    text: 'Ein Dach aus Blättern, unter dem Vögel sicher brüten.',
    boughtText: 'Krone dicht gelassen',
    excludes: ['light-crown'],
    ranks: [
      {
        cost: 4_000, minStage: 4, summary: '+1 Platz Krone, −2 ☀️',
        effects: [slot('crown'), { kind: 'cycle', effect: { kind: 'light', amount: -2 } }],
      },
      {
        cost: 15_000, minStage: 5, summary: 'Bäume +10 % 🌿',
        effects: [{ kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } }],
      },
      {
        cost: 45_000, minStage: 6, summary: 'Bäume +10 % 🌿',
        effects: [{ kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } }],
      },
    ],
  },
  {
    id: 'pond', name: 'Waldtümpel', icon: '💧',
    text: 'Eine feuchte Senke, in der sich der Regen sammelt.',
    boughtText: 'Tümpel angelegt',
    // Öffnet die Nische Waldtümpel für die Amphibien (DESIGN_V2.md 5.5).
    ranks: [
      {
        cost: 7_500, minStage: 4, summary: 'Feuchte, +3 💧, +2 Plätze Waldtümpel',
        effects: [{ kind: 'habitat', tag: 'feucht' }, { kind: 'cycle', effect: { kind: 'water', amount: 3 } }, slot('pond', 2)],
      },
      {
        cost: 22_500, minStage: 5, summary: '+3 💧, +2 ⚖️, +2 Plätze Waldtümpel',
        effects: [
          { kind: 'cycle', effect: { kind: 'water', amount: 3 } },
          { kind: 'cycle', effect: { kind: 'harmony', points: 2 } },
          slot('pond', 2),
        ],
      },
    ],
  },
  {
    id: 'insect-hotel', name: 'Insektenhotel', icon: '🐝',
    text: 'Hohle Stängel und gebohrte Löcher – jedes Zimmer ist bald belegt.',
    boughtText: 'Insektenhotel aufgestellt',
    requires: [{ kind: 'genus', genus: 'insects', min: 1 }],
    ranks: [
      { cost: 2_700, minStage: 4, effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 3 } }], summary: '+3 ⚖️' },
      {
        cost: 12_500, minStage: 5, summary: 'Blumen und Sträucher +25 % 🌰',
        effects: [
          { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 25 } },
          { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'shrubs', pct: 25 } },
        ],
      },
      { cost: 38_000, minStage: 6, effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 4 } }], summary: '+4 ⚖️' },
    ],
  },
  // --- ab Hain: Lebensraum Trockenmauer (DESIGN_V2.md 23.2, Daten in habitats.ts) ---
  WALL_CARE,
];

export const CARE_V16_BY_ID: ReadonlyMap<string, CareMeasure> = new Map(CARE_V16.map((c) => [c.id, c]));
