import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, cycleTable, mean, median, monteCarloCycles, runCycles, type CycleRun } from '../scripts/simulate';
import { CYCLES, CYCLE_RUNS, FULL, HAIN, MAX_SECONDS } from './balance-setup';

/**
 * Neuer Zyklus über mehrere Zyklen am Stück (runCycles, echte Logik; DESIGN_V2.md 10 und
 * 15.4, Balancing 2.10): Waldgedächtnis, Kartenpool mit Tagebuch-Gewicht und Stammgäste.
 * Jeder Zyklus läuft bis zum Hain (frühester Neuer Zyklus), danach wählt die Strategie
 * Stammgäste (die Tiere mit dem größten Beitrag zu ihrem Maß).
 *
 * Ziele (Schritt 2.11): Harmonie lohnt sich über die Zyklen – im ersten Zyklus ist der
 * Wachstums-Spieler höchstens ~15 % schneller, ab dem zweiten ist die Harmonie-Spielweise
 * gleichauf (Waldgedächtnis: Sockel H_max / 5 plus Bonus für H_max über 100). Zyklus 2 ist
 * für jede Spielweise spürbar schneller (Gelegenheitsspieler ≥ 20 %, Harmonie ≤ 45 %),
 * die ersten Stammgäste kommen nach 1–2 Zyklen.
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

  it('der zweite Zyklus ist spürbar schneller bis zum Hain (Harmonie ≤ 45 %, Wachstum ≥ 18 %), der dritte noch schneller', () => {
    const speedup = (id: string) => 1 - hain(of(id), 1) / hain(of(id), 0);
    // Ziele (großer Lauf, Schritt 2.11): Harmonie 30–45 %, Wachstum 18–37 %. Im Check
    // (40 Durchgänge) je Seed-Fenster gemessen (12 Fenster, H_max gerundet): Harmonie
    // 0,39–0,44, Wachstum 0,32–0,39 – dort 0,30–0,48 bzw. 0,16–0,40.
    expect(speedup(HARMONY.id)).toBeGreaterThan(0.3);
    expect(speedup(HARMONY.id)).toBeLessThan(FULL ? 0.45 : 0.48);
    expect(speedup(GROWTH.id)).toBeGreaterThan(FULL ? 0.18 : 0.16);
    expect(speedup(GROWTH.id)).toBeLessThan(FULL ? 0.37 : 0.4);
    for (const id of [HARMONY.id, GROWTH.id]) expect(hain(of(id), 2), id).toBeLessThan(hain(of(id), 1));
    // Der Zufallsspieler (nur im großen Lauf) steht für ruhige Gelegenheitsspieler: Zyklus 2
    // mindestens 20 % schneller (Seed-Fenster mit 40 Durchgängen: 0,19–0,26).
    if (FULL) expect(speedup(RANDOM.id)).toBeGreaterThan(0.2);
  });

  it('die ersten Stammgäste kommen nach 1–2 Zyklen und ziehen ein', () => {
    for (const id of [HARMONY.id, GROWTH.id]) {
      const runs = of(id);
      // Nach dem ersten Zyklus hat die Mehrheit einen Platz, nach dem zweiten jeder.
      expect(mean(runs.map((r) => (r[1]!.regulars.length > 0 ? 1 : 0))), id).toBeGreaterThan(0.5);
      for (const r of runs) expect(r[2]!.regulars.length, id).toBeGreaterThan(0);
      expect(mean(runs.map((r) => r[2]!.regularsMovedIn)), id).toBeGreaterThan(0.5);
    }
    // Harmonie bringt mehr Stammgäste (Seed-Fenster: 4,6–5,4 gegen 2,4–3,1 eingezogen).
    expect(mean(of(HARMONY.id).map((r) => r[2]!.regularsMovedIn))).toBeGreaterThan(mean(of(GROWTH.id).map((r) => r[2]!.regularsMovedIn)));
  });

  it('Harmonie lohnt sich über die Zyklen: Zyklus 1 Wachstum ≤ ~15 % schneller, ab Zyklus 2 gleichauf', () => {
    const ratio = (c: number) => hain(of(GROWTH.id), c) / hain(of(HARMONY.id), c);
    if (FULL) console.log(`Hain Wachstum/Harmonie je Zyklus: ${[0, 1, 2].map((c) => ratio(c).toFixed(3)).join(' / ')}`);
    // Ziele (großer Lauf): Zyklus 1 ≥ 0,85, Zyklus 2 ≥ 0,97 (gleichauf), Zyklus 3 ≥ 1. Im
    // Check (40 Durchgänge) je Seed-Fenster gemessen (12 Fenster, H_max gerundet): Zyklus 1
    // 0,83–0,90 (das Check-Fenster selbst: 0,904), Zyklus 2 0,90–1,02, Zyklus 3 0,89–1,09 –
    // dort ≥ 0,78 / 0,84 / 0,88.
    expect(ratio(0)).toBeGreaterThan(FULL ? 0.85 : 0.78);
    expect(ratio(0)).toBeLessThan(1);
    expect(ratio(1)).toBeGreaterThan(FULL ? 0.97 : 0.84);
    expect(ratio(2)).toBeGreaterThan(FULL ? 1 : 0.88);
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
    // Erster Zyklus bis Hain: etwa zwei Stammgast-Plätze (je 25 Punkte), nicht vier
    // (seit 2.11 mit Harmonie-Bonus ~59; Seed-Fenster 55–61).
    const first = mean(of(HARMONY.id).map((r) => r[0]!.memoryGain));
    expect(first).toBeGreaterThan(45);
    expect(first).toBeLessThan(75);
  });
});
