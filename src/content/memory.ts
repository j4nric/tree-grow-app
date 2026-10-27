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
 * 1. Sockel: 1 Punkt je D Punkte H_max – für jede Spielweise, auch für ruhige
 *    Gelegenheitsspieler (Hain: D = MEMORY_HARMONY_DIVISOR = 5 wie seit Schritt 2.10,
 *    H_max ~80 → 16 Punkte). Seit dem Abgleich mit der Sperrklinke gleitet D mit dem Wegpunkt
 *    (MEMORY_HARMONY_RULES: Wald 6, Urwald 7).
 * 2. Harmonie-Bonus (Schritt 2.11): MEMORY_PER_HARMONY_POINT Punkte je Harmoniepunkt über
 *    der Schwelle des erreichten Wegpunkts, höchstens dessen Obergrenze (MEMORY_HARMONY_RULES).
 *
 * Mit dem Sockel allein bekamen Harmonie- und Wachstums-Spieler gleich viel Gedächtnis
 * (je ~33 Punkte), weil ihre Harmonie beim Hain nur ~7 Punkte auseinanderliegt (110 gegen
 * 103); der Wachstums-Spieler blieb in jedem Zyklus ~13 % schneller. Mit dem Bonus ist die
 * Harmonie-Spielweise ab Zyklus 2 gleichauf (DESIGN_V2.md 15.4, Stand 2.11), und niemand
 * bekommt weniger als vorher.
 */
export const MEMORY_HARMONY_DIVISOR = 5;
export const MEMORY_PER_HARMONY_POINT = 3;

/** Sockel-Teiler, Schwelle und Obergrenze des Harmonie-Bonus beim Erreichen einer Stufe (Stützstelle). */
export interface MemoryHarmonyRule {
  /** Stufe (id in STAGES); die Werte gelten genau an ihrem Wegpunkt. */
  stage: string;
  /** Sockel: 1 Punkt je so viele Punkte höchster Harmonie. */
  divisor: number;
  /** Höchste Harmonie über dieser Schwelle zählt extra. */
  threshold: number;
  /** Höchstens so viele Bonuspunkte. */
  maxPoints: number;
}

/**
 * Waldgedächtnis beim Neuen Zyklus je Stufe (DESIGN_V2.md 10 und 15.4, „Stand Abgleich
 * Sperrklinke“): Stützstellen am Wegpunkt einer Stufe, dazwischen gleiten Teiler, Schwelle und
 * Obergrenze linear mit jedem Wegpunkt (memoryHarmonyBonus in core/formulas.ts). Davor gilt
 * die erste, danach die letzte Stützstelle. Der Hain hatte bis Phase 11, 3b die Werte aus 2.11 (5 / 100 / 45).
 * Die Zahlen im folgenden Absatz sind der Stand des Abgleichs mit der Sperrklinke (vor Phase 10).
 *
 * Warum so: Seit der Sperrklinke (Spielstand v10) zählt der beste Wert des ganzen Verlaufs.
 * Beide Spielweisen halten damit ihren Wert vom Ende des Hain-Wegpunkts fest (H_max ~115
 * bzw. ~107 bei 100 / 45). Der Wachstums-Spieler holte sich darüber hinaus Spitzen: Seine
 * Harmonie liegt im Wald (H_max ~133) und kurz vor dem Urwald nahe an einer gleichmäßig
 * steigenden Schwelle, und der Sockel wuchs von selbst mit (Urwald 155 / 5 = 31). Darum:
 * - Die Schwelle steigt bis zum Wald steil (148, +6 je Wegpunkt) und danach flach (164 im
 *   Urwald, +2): Sie liegt ab dem Wald zwischen den Spielweisen – über dem Wachstums-Spieler
 *   (Wald ~133, Urwald ~155), und der Harmonie-Spieler (Wald ~147 am Ende des Wegpunkts,
 *   Urwald ~174) überholt sie im Lauf der Stufe Wald. Im Urwald bringt die typische Harmonie
 *   des Harmonie-Spielers 30 Punkte Bonus, die des Wachstums-Spielers keinen.
 * - Der Sockel sinkt (1 Punkt je 6 bzw. 7 statt je 5), die Obergrenze steigt auf 48 (voll
 *   ab Schwelle + 16): Später zählt mehr die Harmonie über der Schwelle und weniger, was
 *   ohnehin mitwächst. So bleibt der Urwald-Gewinn des Harmonie-Spielers bei ~1,45 × Hain.
 *   Die Obergrenze steigt höchstens so schnell, wie der Sockel sinkt (bei 50 nicht mehr):
 *   Bei gleicher H_max bringt ein späterer Wegpunkt nie mehr als ein früherer – darauf
 *   verlässt sich das Laden (Obergrenze der Sperrklinke = Wert zur Hain-Regel).
 * Nur die Schwelle zu verschieben reichte nicht: Mit 150 / 38 (2.11b) oder einer Urwald-
 * Schwelle bis 164 blieb der Wachstums-Spieler im Urwald ab Zyklus 2 im Mittel mehrerer
 * Seed-Fenster ≥ 3 % schneller; eine Schwelle von 180 läge über der Harmonie des typischen
 * Harmonie-Spielers.
 *
 * Phase 11, 3b (DESIGN_V2.md 27.11 Stellschraube 1, 28.10): Seit Phase 10 und 11 (Begegnungen nur
 * Tiere, Ausbau) liegt die Harmonie des Harmonie-Spielers höher – Hain 122 statt ~110, Wald 167
 * statt ~147, Urwald 206 statt ~174 (Wachstum 108 / 144 / 182). Die Schwellen sind darum mit
 * derselben Lage zur typischen Harmonie gehoben: Hain 100 → 112, Wald 148 → 168 (der Harmonie-
 * Spieler überholt sie im Lauf der Stufe; ganzzahlig +7 je Wegpunkt), Urwald 164 → 196 (~10 unter
 * dem Harmonie-Spieler, Ziel e; der Wachstums-Spieler liegt überall darunter). Sockel-Teiler und
 * Obergrenzen bleiben – die Formel auch. Gemessen: DESIGN_V2.md 15.4, „Stand Phase 11, 3b“.
 */
export const MEMORY_HARMONY_RULES: readonly MemoryHarmonyRule[] = [
  { stage: 'grove', divisor: MEMORY_HARMONY_DIVISOR, threshold: 112, maxPoints: 45 },
  { stage: 'forest', divisor: 6, threshold: 168, maxPoints: 48 },
  { stage: 'ancient-forest', divisor: 7, threshold: 196, maxPoints: 48 },
];

/** Waldgedächtnis beim Neuen Zyklus: Punkte je Art, die in diesem Zyklus neu ins Tagebuch kam. */
export const MEMORY_PER_NEW_SPECIES = 1;
/** Je so viele Punkte Waldgedächtnis gibt es einen Platz für einen Stammgast. */
export const MEMORY_PER_REGULAR_SLOT = 25;
/** Arten aus dem Naturtagebuch ziehen ab dem zweiten Zyklus mit diesem Gewicht (statt 1). */
export const JOURNAL_SPECIES_WEIGHT = 2;
