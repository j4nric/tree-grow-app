/**
 * Wegpunkte: Gesamt-Wachstum, bei dem jeweils eine Begegnung stattfindet.
 * Wegpunkt k (1-basiert) liegt bei WAYPOINT_BASE · k^WAYPOINT_POWER (gerundet).
 * Die Stufen fallen auf feste Wegpunkte (`Stage.waypoint` in stages.ts):
 * Keimling 1 · Setzling 3 · Junger Baum 6 · Alter Baum 12 · Hain 20 · Wald 28 · Urwald 36.
 *
 * Exponent 3,4 wie im Design (DESIGN_V2.md, Abschnitt 3). Bewusste Abweichung: Basis
 * 3,5 statt 4 (alle Wegpunkte 12,5 % früher). Seit Schritt 2.2 (32 Arten) läge auch
 * Basis 4 im Zielkorridor (Hain ~58 statt ~52 min, DESIGN_V2.md 15.4); der Wechsel
 * verschiebt aber die Kurve gespeicherter v3-Stände (Umrechnung beim Laden nötig) und
 * die Wegpunkt-Konstanten der e2e-Tests – darum vorerst 3,5, Wechsel als eigene Aufgabe.
 */
export const WAYPOINT_BASE = 3.5;
export const WAYPOINT_POWER = 3.4;
/** Letzter Wegpunkt (Urwald). Danach wächst der Baum weiter, aber ohne Begegnungen. */
export const WAYPOINT_COUNT = 36;

/** Benötigtes Gesamt-Wachstum für Wegpunkt k. Wegpunkt 0 = Start. */
export function waypointThreshold(k: number): number {
  if (k <= 0) return 0;
  return Math.round(WAYPOINT_BASE * Math.pow(k, WAYPOINT_POWER));
}

/** Vorberechnete Tabelle: WAYPOINT_THRESHOLDS[k] = waypointThreshold(k), k = 0 … WAYPOINT_COUNT. */
export const WAYPOINT_THRESHOLDS: readonly number[] = Array.from({ length: WAYPOINT_COUNT + 1 }, (_, k) =>
  waypointThreshold(k),
);
