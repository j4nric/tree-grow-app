/**
 * Offline-Ertrag (docs/DESIGN_V2.md 28.3). Reine Daten – die Anwendung (Ertragsfaktor f in
 * `tick`, `simulateOffline`) baut Phase 11, 1b in src/core.
 *
 * Abwesenheit a (höchstens MAX_OFFLINE_SECONDS = 8 h, core/tick.ts):
 *   die ersten OFFLINE_FULL_SECONDS   Ertragsfaktor f = 1
 *   der Rest                          Ertragsfaktor f = OFFLINE_YIELD
 * f wirkt auf Erträge (🌿, 🌰, ⚖️), nie auf die Zeit (Jahreszeiten, Wetter, Chronik laufen voll).
 * Beispiel: 2 h fort → 60 s voll + 7.140 s × 0,1 = Ertrag wie 774 s online.
 */

/** Anteil der Erträge nach den ersten OFFLINE_FULL_SECONDS (10 %). */
export const OFFLINE_YIELD = 0.1;

/** So viele Sekunden einer Abwesenheit zählen voll (Tab-Wechsel, Ruckler, kurzer Anruf). */
export const OFFLINE_FULL_SECONDS = 60;
