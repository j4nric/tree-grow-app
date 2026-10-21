/**
 * Waldgedächtnis: dauerhafter Bonus, der den Neuen Zyklus überdauert
 * (docs/DESIGN_V2.md, Abschnitt 10). Punkte gibt es beim Neuen Zyklus und als
 * Andenken für Spieler mit einem v1-Spielstand.
 */

/** Jeder Punkt Waldgedächtnis: +2 % Wachstum und Samen. */
export const FOREST_MEMORY_BONUS = 0.02;

/** Andenken „Die alte Eiche“ für v1-Spielstände ab dieser v1-Stufe (Junger Baum). */
export const V1_KEEPSAKE_MIN_STAGE = 3;
/** v1-Schwelle (Gesamtenergie) für „Junger Baum“ – falls die Stufe im alten Stand fehlt. */
export const V1_KEEPSAKE_MIN_ENERGY = 3_000;
export const V1_KEEPSAKE_ID = 'old-oak';
export const V1_KEEPSAKE_MEMORY = 5;

/** Neuer Zyklus ist ab dieser Stufe möglich (Index in STAGES: Hain). */
export const NEW_CYCLE_MIN_STAGE = 5;
/** Waldgedächtnis beim Neuen Zyklus: 1 Punkt je so viel höchster Harmonie (H_max). */
export const MEMORY_HARMONY_DIVISOR = 10;
/** Waldgedächtnis beim Neuen Zyklus: Punkte je Art, die in diesem Zyklus neu ins Tagebuch kam. */
export const MEMORY_PER_NEW_SPECIES = 2;
/** Je so viele Punkte Waldgedächtnis gibt es einen Platz für einen Stammgast. */
export const MEMORY_PER_REGULAR_SLOT = 25;
/** Arten aus dem Naturtagebuch ziehen ab dem zweiten Zyklus mit diesem Gewicht (statt 1). */
export const JOURNAL_SPECIES_WEIGHT = 2;
