/**
 * Waldgedächtnis: dauerhafter Bonus, der den Neuen Zyklus überdauert
 * (docs/DESIGN_V2.md, Abschnitt 10). Punkte gibt es beim Neuen Zyklus und als
 * Andenken für Spieler mit einem v1-Spielstand.
 */

/**
 * Jeder Punkt Waldgedächtnis: +1 % Wachstum und Samen (bis Schritt 2.10: +2 %). Mit +2 %
 * war der zweite Zyklus 42 % schneller bis zum Hain; Ziel sind 20–35 % (DESIGN_V2.md 15.4).
 */
export const FOREST_MEMORY_BONUS = 0.01;

/** Andenken „Die alte Eiche“ für v1-Spielstände ab dieser v1-Stufe (Junger Baum). */
export const V1_KEEPSAKE_MIN_STAGE = 3;
/** v1-Schwelle (Gesamtenergie) für „Junger Baum“ – falls die Stufe im alten Stand fehlt. */
export const V1_KEEPSAKE_MIN_ENERGY = 3_000;
export const V1_KEEPSAKE_ID = 'old-oak';
export const V1_KEEPSAKE_MEMORY = 5;

/** Andenken im Naturtagebuch: Name, Symbol und kurzer Text (unbekannte IDs zeigt die UI neutral). */
export const KEEPSAKE_INFO: Readonly<Record<string, { name: string; icon: string; text: string }>> = {
  [V1_KEEPSAKE_ID]: {
    name: 'Die alte Eiche',
    icon: '🌳',
    text: `Erinnerung an deinen ersten Baum: +${V1_KEEPSAKE_MEMORY} Waldgedächtnis.`,
  },
};

/** Neuer Zyklus ist ab dieser Stufe möglich (Index in STAGES: Hain). */
export const NEW_CYCLE_MIN_STAGE = 5;
/**
 * Waldgedächtnis beim Neuen Zyklus: 1 Punkt je so viel höchster Harmonie (H_max).
 * Seit Schritt 2.10 5 statt 10 (und 1 statt 2 Punkte je neuer Art): Vorher bekam der
 * Wachstums-Spieler klar mehr Gedächtnis als der Harmonie-Spieler (36 gegen 33), weil er
 * öfter tauscht und so mehr Arten entdeckt; jetzt im ersten Zyklus etwa gleich viel
 * (~33 Punkte, ein Stammgast), ab dem zweiten mehr für den Harmonie-Spieler.
 */
export const MEMORY_HARMONY_DIVISOR = 5;
/** Waldgedächtnis beim Neuen Zyklus: Punkte je Art, die in diesem Zyklus neu ins Tagebuch kam. */
export const MEMORY_PER_NEW_SPECIES = 1;
/** Je so viele Punkte Waldgedächtnis gibt es einen Platz für einen Stammgast. */
export const MEMORY_PER_REGULAR_SLOT = 25;
/** Arten aus dem Naturtagebuch ziehen ab dem zweiten Zyklus mit diesem Gewicht (statt 1). */
export const JOURNAL_SPECIES_WEIGHT = 2;
