/**
 * Wegpunkte: Gesamt-Wachstum, bei dem jeweils eine Begegnung stattfindet.
 * Wegpunkt k (1-basiert) liegt bei WAYPOINT_BASE · k^WAYPOINT_POWER (gerundet).
 * Die Stufen fallen auf feste Wegpunkte (`Stage.waypoint` in stages.ts):
 * Keimling 1 · Setzling 3 · Junger Baum 6 · Alter Baum 12 · Hain 20 · Wald 28 · Urwald 36.
 *
 * Prototyp ohne Pflanzen: Exponent 3,2 statt 3,4 (DESIGN_V2.md 15.4). Ohne den Schub
 * der Begleitpflanzen bräuchte man mit 3,4 fast 2 h bis zum Hain. Kommen die Pflanzen
 * (Schritt 2.1), geht der Exponent zurück auf 3,4 – Simulation (scripts/simulate.ts)
 * dann erneut laufen lassen.
 */
export const WAYPOINT_BASE = 4;
export const WAYPOINT_POWER = 3.2;
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
