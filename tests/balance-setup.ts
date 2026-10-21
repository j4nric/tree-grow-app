/**
 * Gemeinsame Einstellungen der Balancing-Tests (tests/balance*.test.ts,
 * tests/seasons-balance.test.ts; DESIGN_V2.md 15.4). Idee aus dem Branch
 * claude/v2-tests-schneller.
 *
 * Im normalen `npm run check` laufen wenige Durchgänge mit festen Seeds – schnell und
 * deterministisch; die Grenzen halten so viel Abstand, dass sie damit stabil sind. Der
 * große Lauf für die Tabellen der Doku:
 *
 *   npm run balance        # SIM_LOG=1, SIM_RUNS=500: alle Tabellen, alle Strategien bis Urwald
 *
 * `SIM_RUNS` setzt die Zahl der Durchgänge für alle Dateien (Zyklen und Baumarten nehmen
 * davon höchstens CYCLE_RUNS_MAX bzw. TREE_RUNS_MAX, damit der große Lauf in Minuten bleibt).
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export { env };
/** Großer Lauf (npm run balance): Tabellen ins Protokoll, alle Strategien bis zum Urwald. */
export const FULL = !!env.SIM_LOG;
const requested = env.SIM_RUNS ? Number(env.SIM_RUNS) : null;
/** Durchgänge je Strategie im Spiel mit allen Systemen (balance.test.ts). */
export const RUNS = requested ?? 40;
/** Durchgänge für den Vergleich mit/ohne Pflege (balance-care.test.ts). */
export const CARE_RUNS = requested ?? 30;
/** Durchgänge je Strategie und Baumart (seasons-balance.test.ts). */
export const TREE_RUNS_MAX = 300;
export const TREE_RUNS = Math.min(requested ?? 30, TREE_RUNS_MAX);
/** Durchgänge über mehrere Zyklen (balance-cycles.test.ts). */
export const CYCLE_RUNS_MAX = 200;
export const CYCLE_RUNS = Math.min(requested ?? 20, CYCLE_RUNS_MAX);
/** Zyklen am Stück. */
export const CYCLES = 3;

export const HAIN = 5;
export const WALD = 6;
export const URWALD = 7;
export const MAX_SECONDS = 6 * 3600;
