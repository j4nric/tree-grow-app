import { HARMONY, GROWTH, RANDOM, branchCycles, runCycles, runStages, type CycleRun, type RunResult, type Strategy, type Summary } from '../scripts/simulate';
import { CYCLES, CYCLE_RUNS, FULL, HAIN, MAX_SECONDS, RESTART_RUNS, RUNS, URWALD, WALD } from './balance-setup';

/**
 * Gemeinsame Durchgänge der Balancing-Tests (DESIGN_V2.md 15.4, „Laufzeit der Tests“).
 *
 * Mehrere Prüfungen brauchen dieselben Durchgänge (gleiche Strategie, gleiche Seeds 1000 + 7 i,
 * Eiche, alle Systeme mit Pflege) – nur bis zu verschiedenen Stufen. Ein Durchgang bis zum Wald
 * ist bis zum Hain genau derselbe wie einer bis zum Hain (die Ziel-Stufe beendet nur die
 * Schleife). Darum rechnet dieses Modul jeden Durchgang einmal bis zur höchsten gebrauchten
 * Stufe und liefert für jede Ziel-Stufe genau das Ergebnis, das ein eigener Lauf ergäbe
 * (Checkpoints in runGame; `tests/balance-runs.test.ts` prüft die Gleichheit).
 *
 * Der Zwischenspeicher lebt im Modul, also je Testdatei (Vitest rechnet jede Datei in einem
 * eigenen Worker): Geteilt wird innerhalb von balance.test.ts (Spiel mit allen Systemen und
 * Pflege) und innerhalb von balance-cycles.test.ts (Zyklen und Neustart in Hain, Wald, Urwald).
 */

/** Stufen, für die Ergebnisse aufgehoben werden (Ziel-Stufen der Tests). */
const KEPT_STAGES = [HAIN, WALD, URWALD] as const;

/**
 * Wie weit eine Strategie im Spiel mit allen Systemen läuft: der Harmonie-Spieler bis zum
 * Urwald, Wachstum und Zufall im großen Lauf bis zum Urwald (im Check bis zum Wald), die übrigen
 * (seltenste Karte, Stapler) nur bis zum Hain – nur so weit, wie Prüfungen und Tabellen schauen.
 * Bis Phase 11, 3a liefen im großen Lauf auch die Stapler bis zum Urwald (nur für die Gabel-Tabellen
 * „Wald“ und „Ende“; ~25 min der ~60 min von `npm run balance`).
 */
export function firstCycleTarget(strategy: Strategy): number {
  if (strategy === HARMONY) return URWALD;
  if (strategy === GROWTH || strategy === RANDOM) return FULL ? URWALD : WALD;
  return HAIN;
}

const firstCycles = new Map<string, { runs: number; target: number; byStage: Map<number, RunResult[]> }>();

/**
 * Erster Zyklus mit allen Systemen und Pflege (maxSeconds MAX_SECONDS, Eiche): die ersten
 * `runs` Durchgänge bis `targetStage` (Hain, Wald oder Urwald) – genau wie
 * `monteCarlo([strategy], runs, { targetStage, maxSeconds: MAX_SECONDS, care: true })`.
 */
export function firstCycle(strategy: Strategy, runs: number, targetStage: number): Summary {
  if (!(KEPT_STAGES as readonly number[]).includes(targetStage)) throw new Error(`Ziel-Stufe ${targetStage} wird nicht aufgehoben`);
  let entry = firstCycles.get(strategy.id);
  if (!entry || entry.runs < runs || entry.target < targetStage) {
    // Einmal so weit und so oft, wie irgendein Test es braucht (RUNS ist die größte Zahl).
    const target = Math.max(targetStage, firstCycleTarget(strategy), entry?.target ?? 0);
    const n = Math.max(runs, RUNS, entry?.runs ?? 0);
    const stages = KEPT_STAGES.filter((s) => s <= target);
    const byStage = new Map<number, RunResult[]>(stages.map((s) => [s, []]));
    for (let i = 0; i < n; i++) {
      const results = runStages(strategy, stages, { seed: 1000 + 7 * i, maxSeconds: MAX_SECONDS, care: true });
      for (const s of stages) byStage.get(s)!.push(results.get(s)!);
    }
    entry = { runs: n, target, byStage };
    firstCycles.set(strategy.id, entry);
  }
  return { strategy, runs: entry.byStage.get(targetStage)!.slice(0, runs) };
}

const cycleRows = new Map<string, Map<number, CycleRun[][]>>();

/**
 * Drei Zyklen am Stück (CYCLES), jeder bis `targetStage`, dann Neuer Zyklus – genau wie
 * `monteCarloCycles(strategy, runs, { targetStage, maxSeconds: MAX_SECONDS, care: true, cycles: CYCLES })`.
 * Hain: CYCLE_RUNS Durchgänge (balance-cycles), Wald und Urwald: RESTART_RUNS (Neustart). Die
 * ersten RESTART_RUNS Seeds spielen den ersten Zyklus nur einmal bis zum Urwald und zweigen
 * an Hain und Wald ab (branchCycles).
 */
export function cycles(strategy: Strategy, runs: number, targetStage: number): CycleRun[][] {
  let rows = cycleRows.get(strategy.id);
  if (!rows) {
    rows = new Map<number, CycleRun[][]>(KEPT_STAGES.map((s) => [s, []]));
    const options = { maxSeconds: MAX_SECONDS, care: true, cycles: CYCLES };
    for (let i = 0; i < Math.max(CYCLE_RUNS, RESTART_RUNS); i++) {
      const seed = 1000 + 7 * i;
      if (i < RESTART_RUNS) {
        for (const [s, run] of branchCycles(strategy, KEPT_STAGES, { ...options, seed })) rows.get(s)!.push(run);
      } else {
        rows.get(HAIN)!.push(runCycles(strategy, { ...options, seed, targetStage: HAIN }));
      }
    }
    cycleRows.set(strategy.id, rows);
  }
  const list = rows.get(targetStage);
  if (!list || list.length < runs) throw new Error(`Zyklen bis Stufe ${targetStage}: nur ${list?.length ?? 0} von ${runs} Durchgängen`);
  return list.slice(0, runs);
}
