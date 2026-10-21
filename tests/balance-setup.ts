/**
 * Gemeinsame Einstellungen der Balancing-Tests (tests/balance*.test.ts, DESIGN_V2.md 15.4).
 *
 * Im normalen `npm run check` laufen wenige Durchgänge mit festen Seeds (schnell und
 * deterministisch); die Grenzen in den Tests halten so viel Abstand, dass sie auch dann
 * stabil sind. Für die Tabellen der Doku:
 *
 *   npm run balance        # SIM_RUNS=500, SIM_LOG=1: alle Tabellen, alle Strategien bis Urwald
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export { env };
/** Großer Lauf (npm run balance): alle Tabellen, alle Strategien bis zum Urwald. */
export const FULL = !!env.SIM_LOG;
/** Durchgänge je Strategie, Spiel ohne Modell-Zusätze. */
export const RUNS = Number(env.SIM_RUNS ?? 50);
/** Durchgänge je Strategie für das Pflege-Modell. */
export const MODEL_RUNS = Number(env.SIM_RUNS ?? 40);
/**
 * Durchgänge für das Ereignis-Modell (nur Harmonie-Spieler): Die Durststrecken streuen
 * stark – mit 60 Durchgängen ist ihr Rückgang (~15 %) deutlich vom Rauschen getrennt.
 */
export const EVENT_RUNS = Number(env.SIM_RUNS ?? 60);
export const HAIN = 5;
export const WALD = 6;
export const URWALD = 7;
export const MAX_SECONDS = 6 * 3600;
