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
// 40 statt 20 seit Schritt 2.11: Das Waldgedächtnis hängt jetzt steil an H_max über 100,
// mit 20 Durchgängen schwankte das Verhältnis Wachstum/Harmonie in Zyklus 2 je Seed-Fenster
// zwischen 0,87 und 1,11 (mit 40, 12 Fenster: 0,90–1,02; Grenze im Check ≥ 0,84, siehe
// balance-cycles.test.ts und DESIGN_V2.md 15.4, Stand 2.11).
export const CYCLE_RUNS = Math.min(requested ?? 40, CYCLE_RUNS_MAX);
/**
 * Durchgänge über mehrere Zyklen mit Neustart in Hain, Wald und Urwald
 * (balance-restart.test.ts, Schritt 2.11b). Im Check wenige, weil ein Urwald-Zyklus lang ist.
 */
export const RESTART_RUNS_MAX = 100;
export const RESTART_RUNS = Math.min(requested ?? 12, RESTART_RUNS_MAX);
/** Zyklen am Stück. */
export const CYCLES = 3;

export const HAIN = 5;
export const WALD = 6;
export const URWALD = 7;
export const MAX_SECONDS = 6 * 3600;
