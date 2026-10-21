import type { Condition, Effect, Genus } from './types';

/**
 * Durchreisende (docs/DESIGN_V2.md 7.5): Gäste auf Zeit. Reine Daten – die Logik folgt
 * in Schritt 2.4 (core-engineer, Umsetzungsnotiz in DESIGN_V2.md 7.8).
 *
 * Regeln:
 * - Ein Gast belegt keine Nische. Der Renderer zeigt Gäste über ihre ID (`SceneVisitor`);
 *   die IDs `cranes`, `bramblings` und `hummingbird-moth` haben eigene Bilder, alle
 *   anderen erscheinen als kleiner Schwarm.
 * - Jede Durchreise ist eine Wahl:
 *   „bewirten“ kostet `hostCost` Samen-Sekunden und der Gast bleibt `stay` Sekunden
 *   Spielzeit – solange wirken seine `effects` (Faktor 1, nicht mit Zufriedenheit
 *   skaliert) und er zählt für die Gattungsboni seiner `genus`;
 *   „ziehen lassen“ bringt sofort `farewellSeeds` Samen-Sekunden als Dank.
 * - Samen-Sekunden: Sekunden × aktuelle Samenrate (🌰/s laut `evaluate`), mindestens
 *   SEED_SECONDS_MIN_SEEDS (events.ts). Reichen die Samen nicht, bleibt nur „ziehen lassen“.
 * - Jeder Gast kommt höchstens einmal pro Zyklus, ab `minStage` und wenn alle
 *   `appears`-Bedingungen erfüllt sind (Prüfung wie `speciesAppears`).
 */

/** Wirkungen eines Gastes während seines Aufenthalts. */
export type VisitorEffect = Extract<Effect, { kind: 'growth' | 'seeds' | 'groupGrowth' | 'groupSeeds' | 'harmony' }>;

export interface Visitor {
  id: string;
  name: string;
  icon: string;
  /** Gattung für Gattungsboni und Darstellung (zählt nur, solange er bleibt). */
  genus: Genus;
  /** Stimmungstext (ein Satz). */
  text: string;
  /** Ab dieser Stufe (Index in STAGES). */
  minStage: number;
  /** Bedingungen wie `Species.appears`. */
  appears?: readonly Condition[];
  /** Aufenthalt in Sekunden Spielzeit, wenn er bewirtet wird. */
  stay: number;
  effects: readonly VisitorEffect[];
  /** Wirkung in Kurzform für die Karte. */
  summary: string;
  /** Bewirten kostet so viele Samen-Sekunden. */
  hostCost: number;
  /** Ziehen lassen bringt so viele Samen-Sekunden. */
  farewellSeeds: number;
}

/** Knopftexte der beiden Wahlmöglichkeiten. */
export const VISITOR_HOST_LABEL = 'Bewirten';
export const VISITOR_FAREWELL_LABEL = 'Ziehen lassen';

export const VISITORS: readonly Visitor[] = [
  // --- ab Alter Baum ----------------------------------------------------------
  {
    id: 'cranes', name: 'Kranichzug', icon: '🦢', genus: 'birds', minStage: 4,
    text: 'Trompetend ziehen sie nach Süden und rasten eine Nacht.',
    stay: 480, effects: [{ kind: 'seeds', pct: 25 }], summary: '+25 % 🌰 für 8 min',
    hostCost: 40, farewellSeeds: 15,
  },
  {
    id: 'bramblings', name: 'Bergfinken-Schwarm', icon: '🐦', genus: 'birds', minStage: 4,
    text: 'Ein Schwarm aus dem Norden plündert die Eicheln.',
    appears: [{ kind: 'tag', tag: 'nuesse' }],
    stay: 420, effects: [{ kind: 'growth', pct: 12 }, { kind: 'seeds', pct: 12 }], summary: '+12 % 🌿 und 🌰 für 7 min',
    hostCost: 40, farewellSeeds: 15,
  },
  {
    id: 'hummingbird-moth', name: 'Taubenschwänzchen', icon: '🦋', genus: 'insects', minStage: 4,
    text: 'Ein Falter, der vor den Blüten schwirrt wie ein Kolibri.',
    appears: [{ kind: 'group', group: 'flowers', min: 1 }],
    stay: 360, effects: [{ kind: 'groupSeeds', group: 'flowers', pct: 60 }, { kind: 'harmony', points: 2 }],
    summary: 'Blumen +60 % 🌰, +2 ⚖️ für 6 min',
    hostCost: 30, farewellSeeds: 15,
  },
  {
    id: 'swallows', name: 'Schwalbenschwarm', icon: '🐦', genus: 'birds', minStage: 4,
    text: 'Vor dem Abflug jagen sie in Schwärmen über der Lichtung nach Mücken.',
    appears: [{ kind: 'genus', genus: 'insects', min: 2 }],
    stay: 420, effects: [{ kind: 'growth', pct: 10 }, { kind: 'harmony', points: 3 }], summary: '+10 % 🌿, +3 ⚖️ für 7 min',
    hostCost: 40, farewellSeeds: 15,
  },
  // --- ab Hain ----------------------------------------------------------------
  {
    id: 'boars', name: 'Wildschwein-Rotte', icon: '🐗', genus: 'mammals', minStage: 5,
    text: 'Sie pflügen den Boden nach Eicheln um – im aufgewühlten Boden keimt es gut.',
    appears: [{ kind: 'tag', tag: 'nuesse' }],
    stay: 480, effects: [{ kind: 'growth', pct: 15 }], summary: '+15 % 🌿 für 8 min',
    hostCost: 60, farewellSeeds: 20,
  },
  {
    id: 'peregrine', name: 'Wanderfalke', icon: '🦅', genus: 'birds', minStage: 5,
    text: 'Er rastet auf dem höchsten Ast und hält Ausschau über den Wipfeln.',
    stay: 600, effects: [{ kind: 'harmony', points: 6 }], summary: '+6 ⚖️ für 10 min',
    hostCost: 50, farewellSeeds: 15,
  },
  {
    id: 'stag-flight', name: 'Hirschkäfer-Hochzeitsflug', icon: '🪲', genus: 'insects', minStage: 5,
    text: 'An einem warmen Juniabend brummen die Hirschkäfer schwerfällig um die Krone.',
    appears: [{ kind: 'tag', tag: 'totholz' }],
    stay: 360, effects: [{ kind: 'growth', pct: 8 }, { kind: 'harmony', points: 4 }], summary: '+8 % 🌿, +4 ⚖️ für 6 min',
    hostCost: 40, farewellSeeds: 15,
  },
  // --- ab Wald ----------------------------------------------------------------
  {
    id: 'waxwings', name: 'Seidenschwänze', icon: '🐦', genus: 'birds', minStage: 6,
    text: 'Gäste aus der Taiga mit gelben Schwanzspitzen – sie fressen die Sträucher leer.',
    appears: [{ kind: 'tag', tag: 'beeren' }],
    stay: 420, effects: [{ kind: 'seeds', pct: 25 }, { kind: 'groupGrowth', group: 'shrubs', pct: 30 }],
    summary: '+25 % 🌰, Sträucher +30 % 🌿 für 7 min',
    hostCost: 45, farewellSeeds: 15,
  },
];

export const VISITORS_BY_ID: ReadonlyMap<string, Visitor> = new Map(VISITORS.map((v) => [v.id, v]));
