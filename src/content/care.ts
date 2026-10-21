import type { CycleEffect } from './events';
import type { Condition, Effect, Tag } from './types';

/**
 * Pflegemaßnahmen (docs/DESIGN_V2.md, Abschnitt 8). Reine Daten – die Logik steht in
 * src/core/tick.ts (buyCare, careBlocker) und formulas.ts (Wirkungen, DESIGN_V2.md 8.2).
 *
 * Pflege ist die Samen-Senke des Spiels: Jede Maßnahme hat 1–3 Stufen („Ränge“), die
 * nacheinander mit Samen gekauft werden. Ein gekaufter Rang wirkt bis zum Neuen Zyklus;
 * die Wirkungen aller gekauften Ränge addieren sich. Die Kosten steigen je Rang stark
 * (mindestens ×3, bis ×8,6), Rang 1 gibt es ab Junger bzw. Alter Baum, spätere Ränge erst
 * ab Alter Baum, Hain oder Wald (`minStage`) – so wächst die Senke mit dem Einkommen mit,
 * und kein einzelner Kauf ist Pflicht.
 *
 * Wirkungen nutzen dieselben Typen wie die Ereignisse (events.ts):
 * - `cycle`: eine Wirkung bis zum Neuen Zyklus, Faktor 1. Für Pflege zusätzlich erlaubt:
 *   `growth`, `seeds`, `groupGrowth`, `groupSeeds` (dauerhaft statt nur `timed`).
 * - `habitat`: Das Ökosystem stellt das Merkmal bereit (1 Einheit wie eine Pflanze).
 * Negative Zahlen sind nur als bewusster „Verlierer“ einer Maßnahme erlaubt (Dichte Krone
 * kostet Licht) – jeder Rang bringt insgesamt etwas.
 */

/** Dauerhafte Wirkungen einer Maßnahme (Erweiterung von CycleEffect, events.ts). */
export type CareCycleEffect = CycleEffect | Extract<Effect, { kind: 'growth' | 'seeds' | 'groupGrowth' | 'groupSeeds' }>;

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
  /** Bedingungen wie `Species.appears` (alle müssen beim Kauf erfüllt sein). */
  requires?: readonly Condition[];
  /** Maßnahmen, die sich mit dieser ausschließen (gegenseitig eingetragen). */
  excludes?: readonly string[];
  /** Ränge in Kauf-Reihenfolge (1–3). Rang 1 bestimmt die Freischaltung. */
  ranks: readonly CareRank[];
}

const slot = (niche: 'litter' | 'hollows' | 'crown' | 'edge' | 'bark'): CareEffect => ({
  kind: 'cycle',
  effect: { kind: 'slot', niche, amount: 1 },
});

export const CARE: readonly CareMeasure[] = [
  // --- ab Junger Baum ---------------------------------------------------------
  {
    id: 'leaf-litter', name: 'Laub liegen lassen', icon: '🍂',
    text: 'Im Herbst bleibt das Laub, wo es fällt.',
    ranks: [
      { cost: 600, minStage: 3, effects: [slot('litter')], summary: '+1 Platz Laubstreu' },
      {
        cost: 4_000, minStage: 5, summary: '+2 💧, +3 ⚖️',
        effects: [{ kind: 'cycle', effect: { kind: 'water', amount: 2 } }, { kind: 'cycle', effect: { kind: 'harmony', points: 3 } }],
      },
    ],
  },
  {
    id: 'nest-boxes', name: 'Nistkästen', icon: '🏠',
    text: 'Ein Holzkasten mit kleinem Flugloch. Gemütlich – und leicht zu finden.',
    ranks: [
      { cost: 900, minStage: 3, effects: [{ kind: 'habitat', tag: 'hoehle' }, slot('hollows')], summary: 'Baumhöhle, +1 Platz Höhlen' },
      { cost: 6_000, minStage: 5, effects: [slot('crown')], summary: '+1 Platz Krone' },
    ],
  },
  {
    id: 'wildflower-hem', name: 'Wildblumen-Saum', icon: '🌼',
    text: 'Margeriten, Klee und hohes Gras am Rand des Baums.',
    ranks: [
      {
        cost: 700, minStage: 3, summary: 'Blumen +40 % 🌰',
        effects: [{ kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 40 } }],
      },
      { cost: 6_000, minStage: 4, effects: [slot('edge')], summary: '+1 Platz Waldsaum' },
      {
        cost: 20_000, minStage: 6, summary: 'Blumen +40 % 🌿 und 🌰',
        effects: [
          { kind: 'cycle', effect: { kind: 'groupGrowth', group: 'flowers', pct: 40 } },
          { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 40 } },
        ],
      },
    ],
  },
  // --- ab Alter Baum ----------------------------------------------------------
  {
    id: 'deadwood-pile', name: 'Totholzhaufen', icon: '🪵',
    text: 'Ein Stapel alter Äste – Kinderstube für Käfer, Versteck für Igel.',
    ranks: [
      { cost: 2_500, minStage: 4, effects: [{ kind: 'habitat', tag: 'totholz' }], summary: 'Totholz' },
      {
        cost: 8_000, minStage: 5, summary: '+1 Platz Stamm & Rinde, +2 ⚖️',
        effects: [slot('bark'), { kind: 'cycle', effect: { kind: 'harmony', points: 2 } }],
      },
    ],
  },
  {
    id: 'light-crown', name: 'Lichte Krone', icon: '☀️',
    text: 'Ein paar Äste weniger – Sonnenflecken tanzen über den Boden.',
    excludes: ['dense-crown'],
    ranks: [
      { cost: 3_000, minStage: 4, effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 3 } }], summary: '+3 ☀️' },
      { cost: 10_000, minStage: 5, effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 2 } }], summary: '+2 ☀️' },
      { cost: 30_000, minStage: 6, effects: [{ kind: 'cycle', effect: { kind: 'light', amount: 2 } }], summary: '+2 ☀️' },
    ],
  },
  {
    id: 'dense-crown', name: 'Dichte Krone', icon: '🌳',
    text: 'Ein Dach aus Blättern, unter dem Vögel sicher brüten.',
    excludes: ['light-crown'],
    ranks: [
      {
        cost: 3_000, minStage: 4, summary: '+1 Platz Krone, −2 ☀️',
        effects: [slot('crown'), { kind: 'cycle', effect: { kind: 'light', amount: -2 } }],
      },
      {
        cost: 10_000, minStage: 5, summary: 'Bäume +10 % 🌿',
        effects: [{ kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } }],
      },
      {
        cost: 30_000, minStage: 6, summary: 'Bäume +10 % 🌿',
        effects: [{ kind: 'cycle', effect: { kind: 'groupGrowth', group: 'trees', pct: 10 } }],
      },
    ],
  },
  {
    id: 'pond', name: 'Waldtümpel', icon: '💧',
    text: 'Eine feuchte Senke, in der sich der Regen sammelt.',
    ranks: [
      {
        cost: 4_000, minStage: 4, summary: 'Feuchte, +3 💧',
        effects: [{ kind: 'habitat', tag: 'feucht' }, { kind: 'cycle', effect: { kind: 'water', amount: 3 } }],
      },
      {
        cost: 12_000, minStage: 5, summary: '+3 💧, +2 ⚖️',
        effects: [{ kind: 'cycle', effect: { kind: 'water', amount: 3 } }, { kind: 'cycle', effect: { kind: 'harmony', points: 2 } }],
      },
    ],
  },
  {
    id: 'insect-hotel', name: 'Insektenhotel', icon: '🐝',
    text: 'Hohle Stängel und gebohrte Löcher – jedes Zimmer ist bald belegt.',
    requires: [{ kind: 'genus', genus: 'insects', min: 1 }],
    ranks: [
      { cost: 2_000, minStage: 4, effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 3 } }], summary: '+3 ⚖️' },
      {
        cost: 7_000, minStage: 5, summary: 'Blumen und Sträucher +25 % 🌰',
        effects: [
          { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'flowers', pct: 25 } },
          { kind: 'cycle', effect: { kind: 'groupSeeds', group: 'shrubs', pct: 25 } },
        ],
      },
      { cost: 25_000, minStage: 6, effects: [{ kind: 'cycle', effect: { kind: 'harmony', points: 4 } }], summary: '+4 ⚖️' },
    ],
  },
];

export const CARE_BY_ID: ReadonlyMap<string, CareMeasure> = new Map(CARE.map((c) => [c.id, c]));
