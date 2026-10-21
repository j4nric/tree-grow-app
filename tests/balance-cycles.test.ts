import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, cycleTable, mean, median, monteCarloCycles, runCycles, type CycleRun } from '../scripts/simulate';
import { CYCLES, CYCLE_RUNS, FULL, HAIN, MAX_SECONDS } from './balance-setup';

/**
 * Neuer Zyklus über mehrere Zyklen am Stück (runCycles, echte Logik; DESIGN_V2.md 10 und
 * 15.4, Balancing 2.10): Waldgedächtnis, Kartenpool mit Tagebuch-Gewicht und Stammgäste.
 * Jeder Zyklus läuft bis zum Hain (frühester Neuer Zyklus), danach wählt die Strategie
 * Stammgäste (die Tiere mit dem größten Beitrag zu ihrem Maß).
 *
 * Ziele (Schritt 2.11): Der zweite Zyklus ist 20–35 % schneller bis zum Hain. Harmonie
 * lohnt sich über die Zyklen: Im ersten Zyklus ist der Wachstums-Spieler höchstens ~15 %
 * schneller, ab dem zweiten ist die Harmonie-Spielweise gleichauf (Waldgedächtnis aus
 * H_max über 100). Der Harmonie-Spieler bekommt seinen ersten Stammgast nach 1–2 Zyklen.
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

  it('der zweite Zyklus ist 18–37 % schneller bis zum Hain, der dritte noch schneller', () => {
    for (const id of [HARMONY.id, GROWTH.id]) {
      const runs = of(id);
      const speedup = 1 - hain(runs, 1) / hain(runs, 0);
      // Ziel 18–37 % (großer Lauf). Im Check (40 Durchgänge) je Seed-Fenster gemessen:
      // Harmonie 0,28–0,37, Wachstum 0,18–0,25 – dort 16–40 %.
      expect(speedup, id).toBeGreaterThan(FULL ? 0.18 : 0.16);
      expect(speedup, id).toBeLessThan(FULL ? 0.37 : 0.4);
      expect(hain(runs, 2), id).toBeLessThan(hain(runs, 1));
    }
  });

  it('die ersten Stammgäste kommen nach 1–2 Zyklen (Harmonie) bzw. meist nach 2 (Wachstum)', () => {
    const withRegulars = (runs: CycleRun[][], c: number) => mean(runs.map((r) => (r[c]!.regulars.length > 0 ? 1 : 0)));
    const h = of(HARMONY.id);
    // Harmonie: nach dem ersten Zyklus die Mehrheit, nach dem zweiten fast jeder
    // (Seed-Fenster mit 40 Durchgängen: 0,63–0,85 bzw. 0,85–1).
    expect(withRegulars(h, 1)).toBeGreaterThan(0.5);
    expect(withRegulars(h, 2)).toBeGreaterThan(0.8);
    expect(mean(h.map((r) => r[2]!.regularsMovedIn))).toBeGreaterThan(2);
    // Wachstum: Stammgäste sind eine Belohnung für Harmonie – nach zwei Zyklen die Mehrheit (0,65–0,88).
    const g = of(GROWTH.id);
    expect(withRegulars(g, 2)).toBeGreaterThan(0.5);
    expect(mean(g.map((r) => r[2]!.regularsMovedIn))).toBeGreaterThan(0.5);
  });

  it('Harmonie lohnt sich über die Zyklen: Zyklus 1 Wachstum ≤ ~15 % schneller, ab Zyklus 2 gleichauf', () => {
    const ratio = (c: number) => hain(of(GROWTH.id), c) / hain(of(HARMONY.id), c);
    if (FULL) console.log(`Hain Wachstum/Harmonie je Zyklus: ${[0, 1, 2].map((c) => ratio(c).toFixed(3)).join(' / ')}`);
    // Ziele (großer Lauf): Zyklus 1 ≥ 0,85, Zyklus 2 ≥ 0,97 (gleichauf), Zyklus 3 ≥ 1. Im
    // Check (40 Durchgänge) je Seed-Fenster gemessen (12 Fenster): Zyklus 1 0,81–0,88,
    // Zyklus 2 0,87–1,06, Zyklus 3 0,96–1,16 – dort ≥ 0,78 / 0,84 / 0,93.
    expect(ratio(0)).toBeGreaterThan(FULL ? 0.85 : 0.78);
    expect(ratio(0)).toBeLessThan(1);
    expect(ratio(1)).toBeGreaterThan(FULL ? 0.97 : 0.84);
    expect(ratio(2)).toBeGreaterThan(FULL ? 1 : 0.93);
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
