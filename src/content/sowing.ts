/**
 * Aussaat: Pflanzen mit Samen kaufen (docs/DESIGN_V2.md 27.6). Reine Daten – die Logik
 * (`sow`, `sowingCost`, `chooseSowing` …) baut Phase 10, 2b in src/core.
 *
 * Preis der n-ten Aussaat im Zyklus (n = bisherige Aussaaten, `cycle.sowings`):
 *   n = 0:  0 (die erste ist ein Geschenk, Wegpunkt 2 öffnet sie)
 *   n ≥ 1:  ⌈ SOWING_BASE · SOWING_GROWTH^(n−1) · Rabatt · Saatzeit ⌉ 🌰
 *           Rabatt = max(SOWING_MIN_COST_FACTOR, 1 + Σ sowCost / 100) (Forschung „Samenbank“),
 *           Saatzeit = SPRING_SOWING_FACTOR im Frühling, sonst 1.
 * Beispiel: n = 2 → ⌈20 · 1,75⌉ = 35 🌰; mit Samenbank im Frühling ⌈35 · 0,75 · 0,8⌉ = 21 🌰.
 *
 * Zurücklegen zahlt wie Ablehnen DECLINE_SEED_SECONDS Samen-Sekunden (encounters.ts), Neu
 * würfeln kostet wie bei Tieren REROLL_BASE_COST · REROLL_COST_GROWTH^Würfe (encounters.ts).
 */

/** Preis der zweiten Aussaat (n = 1) in 🌰. */
export const SOWING_BASE = 20;

/** Jede weitere Aussaat im Zyklus kostet das 1,75-Fache (auch beim Tausch im vollen Ring). */
export const SOWING_GROWTH = 1.75;

/** Ab Keimling (Index in STAGES): der erste Pflanzplatz. */
export const SOWING_MIN_STAGE = 1;

/** „Saatzeit“: Im Frühling kostet die Aussaat 20 % weniger. */
export const SPRING_SOWING_FACTOR = 0.8;

/** Untergrenze des Rabatt-Faktors aus `sowCost` (höchstens −75 %). */
export const SOWING_MIN_COST_FACTOR = 0.25;

/** Höchstens so viele Karten je Aussaat (3 wie eine Begegnung + Σ sowCards). */
export const MAX_SOWING_CARDS = 4;

/** Obergrenze für `cycle.sowings` beim robusten Laden (27.9). */
export const MAX_SOWINGS = 200;
