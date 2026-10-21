/**
 * Wegpunkte: Gesamt-Wachstum, bei dem jeweils eine Begegnung stattfindet.
 * Wegpunkt k (1-basiert) liegt bei WAYPOINT_BASE · k^WAYPOINT_POWER (gerundet).
 * Die Stufen fallen auf feste Wegpunkte (`Stage.waypoint` in stages.ts):
 * Keimling 1 · Setzling 3 · Junger Baum 6 · Alter Baum 12 · Hain 20 · Wald 28 · Urwald 36.
 *
 * Balancing 2.10 (DESIGN_V2.md 3 und 15.4): 3,5 · k^3,5. Mit allen Systemen (Pflege,
 * Ereignisse, Gäste, Jahreszeiten) kam der Harmonie-Spieler mit 3,5 · k^3,4 nach ~44 min
 * zum Hain (Ziel 60). Basis 4 hätte alle Wegpunkte gleich stark verschoben (Setzling 46 s,
 * Hain nur ~48 min); der größere Exponent streckt dagegen vor allem das späte Spiel
 * (Setzling +12 %, Hain +35 %, Urwald +43 %) – so liegen alle Stufen im Ziel.
 * Gespeicherte Stände bis v6 (3,5 · k^3,4) rechnet das Laden um (save.ts, v6GrowthToV7).
 */
export const WAYPOINT_BASE = 3.5;
export const WAYPOINT_POWER = 3.5;
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
