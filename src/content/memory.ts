/**
 * Waldgedächtnis: dauerhafter Bonus, der den Neuen Zyklus überdauert
 * (docs/DESIGN_V2.md, Abschnitt 10). Im Prototyp gibt es ihn nur als Andenken für
 * Spieler mit einem v1-Spielstand.
 */

/** Jeder Punkt Waldgedächtnis: +2 % Wachstum und Samen. */
export const FOREST_MEMORY_BONUS = 0.02;

/** Andenken „Die alte Eiche“ für v1-Spielstände ab dieser v1-Stufe (Junger Baum). */
export const V1_KEEPSAKE_MIN_STAGE = 3;
/** v1-Schwelle (Gesamtenergie) für „Junger Baum“ – falls die Stufe im alten Stand fehlt. */
export const V1_KEEPSAKE_MIN_ENERGY = 3_000;
export const V1_KEEPSAKE_ID = 'old-oak';
export const V1_KEEPSAKE_MEMORY = 5;
