/**
 * Waldgedächtnis: dauerhafter Bonus, der den Neuen Zyklus überdauert
 * (docs/DESIGN_V2.md, Abschnitt 10). Punkte gibt es beim Neuen Zyklus und als
 * Andenken für Spieler mit einem v1-Spielstand.
 */

/**
 * Jeder Punkt Waldgedächtnis: +1 % Wachstum und Samen (bis Schritt 2.10: +2 %). Mit +2 %
 * war der zweite Zyklus 44,3 % schneller bis zum Hain, jetzt 28,8 %; Ziel sind 20–35 %
 * (DESIGN_V2.md 15.4). Gespeicherte Punkte bleiben beim Laden alter Stände unverändert
 * (bewusst, siehe DESIGN_V2.md 14) – sie wirken nur halb so stark.
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
 * Waldgedächtnis beim Neuen Zyklus aus der höchsten Harmonie des Zyklus (H_max), zwei Teile.
 * H_max wird vorher einmal gerundet – wie in Panel, Statistik und Seitenleiste:
 *
 * 1. Sockel: 1 Punkt je MEMORY_HARMONY_DIVISOR H_max (wie seit Schritt 2.10) – für jede
 *    Spielweise, auch für ruhige Gelegenheitsspieler (H_max ~80 → 16 Punkte).
 * 2. Harmonie-Bonus (Schritt 2.11): MEMORY_PER_HARMONY_POINT Punkte je Harmoniepunkt über
 *    der Schwelle der erreichten Stufe, höchstens deren Obergrenze (MEMORY_HARMONY_RULES).
 *
 * Mit dem Sockel allein bekamen Harmonie- und Wachstums-Spieler gleich viel Gedächtnis
 * (je ~33 Punkte), weil ihre Harmonie beim Hain nur ~7 Punkte auseinanderliegt (110 gegen
 * 103); der Wachstums-Spieler blieb in jedem Zyklus ~13 % schneller. Mit dem Bonus ist die
 * Harmonie-Spielweise ab Zyklus 2 gleichauf (DESIGN_V2.md 15.4, Stand 2.11), und niemand
 * bekommt weniger als vorher.
 */
export const MEMORY_HARMONY_DIVISOR = 5;
export const MEMORY_PER_HARMONY_POINT = 3;

/** Schwelle und Obergrenze des Harmonie-Bonus ab einer Stufe. */
export interface MemoryHarmonyRule {
  /** Stufe (id in STAGES), ab der die Regel gilt. */
  stage: string;
  /** Höchste Harmonie über dieser Schwelle zählt extra. */
  threshold: number;
  /** Höchstens so viele Bonuspunkte. */
  maxPoints: number;
}

/**
 * Harmonie-Bonus je erreichter Stufe beim Neuen Zyklus (Schritt 2.11b, DESIGN_V2.md 10 und
 * 15.4). Es gilt die letzte Regel, deren Stufe erreicht ist; vor dem Hain (nur Vorschau) die
 * erste. Die Schwelle ist die typische Harmonie der Stufe – knapp unter der des
 * Wachstums-Spielers (H_max im ersten Zyklus, Simulation: Hain 104, Wald 127, Urwald 155;
 * Harmonie-Spieler 110 / 143 / 176). So trennt der Bonus die Spielweisen in jeder Stufe.
 * Mit der Hain-Schwelle für alle Stufen (2.11) bekamen im Wald und Urwald beide den vollen
 * Bonus (Urwald Zyklus 2: Wachstum/Harmonie 0,87) und ein Urwald-Zyklus brachte ~100 Punkte.
 * Die kleinere Obergrenze ab dem Wald hält den Gewinn bei höchstens ~1,5 × Hain: Sockel und
 * neue Arten wachsen mit der Stufe von selbst.
 */
export const MEMORY_HARMONY_RULES: readonly MemoryHarmonyRule[] = [
  { stage: 'grove', threshold: 100, maxPoints: 45 },
  { stage: 'forest', threshold: 120, maxPoints: 36 },
  { stage: 'ancient-forest', threshold: 150, maxPoints: 36 },
];

/** Waldgedächtnis beim Neuen Zyklus: Punkte je Art, die in diesem Zyklus neu ins Tagebuch kam. */
export const MEMORY_PER_NEW_SPECIES = 1;
/** Je so viele Punkte Waldgedächtnis gibt es einen Platz für einen Stammgast. */
export const MEMORY_PER_REGULAR_SLOT = 25;
/** Arten aus dem Naturtagebuch ziehen ab dem zweiten Zyklus mit diesem Gewicht (statt 1). */
export const JOURNAL_SPECIES_WEIGHT = 2;
