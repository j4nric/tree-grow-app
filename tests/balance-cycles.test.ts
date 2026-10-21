import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, cycleTable, mean, median, monteCarloCycles, runCycles, type CycleRun } from '../scripts/simulate';
import { CYCLES, CYCLE_RUNS, FULL, HAIN, MAX_SECONDS } from './balance-setup';

/**
 * Neuer Zyklus über mehrere Zyklen am Stück (runCycles, echte Logik; DESIGN_V2.md 10 und
 * 15.4, Balancing 2.10): Waldgedächtnis, Kartenpool mit Tagebuch-Gewicht und Stammgäste.
 * Jeder Zyklus läuft bis zum Hain (frühester Neuer Zyklus), danach wählt die Strategie
 * Stammgäste (die Tiere mit dem größten Beitrag zu ihrem Maß).
 *
 * Ziele: Der zweite Zyklus ist 20–35 % schneller bis zum Hain, die ersten Stammgäste
 * kommen nach 1–2 Zyklen, Harmonie zahlt sich im Waldgedächtnis aus.
 */
const options = { targetStage: HAIN, maxSeconds: MAX_SECONDS, care: true, cycles: CYCLES };
const strategies = FULL ? [HARMONY, GROWTH, RANDOM] : [HARMONY, GROWTH];
const rows = strategies.map((strategy) => ({ strategy, runs: monteCarloCycles(strategy, CYCLE_RUNS, options) }));
const of = (id: string) => rows.find((r) => r.strategy.id === id)!.runs;
const hain = (runs: CycleRun[][], c: number) => median(runs.map((r) => r[c]!.result.stages[HAIN]?.time ?? NaN));

describe('Mehrere Zyklen (Waldgedächtnis, Stammgäste, Kartenpool)', () => {
  it('Protokoll', () => {
    if (FULL) console.log(cycleTable(rows));
    expect(rows.length).toBe(strategies.length);
  });

  it('jeder Zyklus erreicht den Hain; deterministisch', () => {
    for (const { strategy, runs } of rows) {
      for (const r of runs) {
        expect(r).toHaveLength(CYCLES);
        for (const c of r) expect(c.result.stages[HAIN], `${strategy.id} Zyklus ${c.number}`).not.toBeNull();
      }
    }
    const a = runCycles(HARMONY, { ...options, seed: 3 });
    expect(runCycles(HARMONY, { ...options, seed: 3 })).toEqual(a);
  });

  it('der zweite Zyklus ist 20–35 % schneller bis zum Hain, der dritte noch schneller', () => {
    for (const id of [HARMONY.id, GROWTH.id]) {
      const runs = of(id);
      const speedup = 1 - hain(runs, 1) / hain(runs, 0);
      // Im Check (wenige Durchgänge) etwas Spielraum: 18–37 %.
      expect(speedup, id).toBeGreaterThan(FULL ? 0.2 : 0.18);
      expect(speedup, id).toBeLessThan(FULL ? 0.35 : 0.37);
      expect(hain(runs, 2), id).toBeLessThan(hain(runs, 1));
    }
  });

  it('die ersten Stammgäste kommen nach 1–2 Zyklen und ziehen ein', () => {
    for (const id of [HARMONY.id, GROWTH.id]) {
      const runs = of(id);
      // Nach dem ersten Zyklus hat die Mehrheit einen Platz, nach dem zweiten jeder.
      expect(mean(runs.map((r) => (r[1]!.regulars.length > 0 ? 1 : 0))), id).toBeGreaterThan(0.5);
      for (const r of runs) expect(r[2]!.regulars.length, id).toBeGreaterThan(0);
      expect(mean(runs.map((r) => r[2]!.regularsMovedIn)), id).toBeGreaterThan(0.5);
    }
  });

  it('Kartenpool: in späteren Zyklen kommen weniger neue Arten dazu, das Tagebuch wächst trotzdem', () => {
    const runs = of(HARMONY.id);
    const fresh = (c: number) => mean(runs.map((r) => r[c]!.newSpecies));
    expect(fresh(0)).toBeGreaterThan(fresh(1));
    expect(fresh(1)).toBeGreaterThan(0);
  });

  it('Harmonie zahlt sich aus: über drei Zyklen mindestens so viel Waldgedächtnis wie der Wachstums-Spieler', () => {
    const total = (id: string) => mean(of(id).map((r) => r.reduce((sum, c) => sum + c.memoryGain, 0)));
    expect(total(HARMONY.id)).toBeGreaterThanOrEqual(total(GROWTH.id));
    // Erster Zyklus bis Hain: etwa ein Stammgast-Platz (25 Punkte), nicht drei.
    const first = mean(of(HARMONY.id).map((r) => r[0]!.memoryGain));
    expect(first).toBeGreaterThan(25);
    expect(first).toBeLessThan(50);
  });
});
