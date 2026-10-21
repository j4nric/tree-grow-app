import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, monteCarloCycles, restartGain, restartTable, restartTime, type RestartRow } from '../scripts/simulate';
import { CYCLES, FULL, HAIN, MAX_SECONDS, RESTART_RUNS, URWALD, WALD } from './balance-setup';

/**
 * Neuer Zyklus erst später (Schritt 2.11b, DESIGN_V2.md 10 und 15.4): Jeder Zyklus läuft bis
 * Hain, Wald oder Urwald, dann Neustart. Der Harmonie-Bonus des Waldgedächtnisses hat je
 * erreichter Stufe eine eigene Schwelle (content/memory.ts, MEMORY_HARMONY_RULES).
 *
 * Ziele: (a) ab Zyklus 2 ist die Harmonie-Spielweise in jeder Stufe mindestens gleichauf
 * (Wachstum/Harmonie ≥ 0,97), (b) ein späterer Neustart bringt moderat mehr Gedächtnis als
 * im Hain (Urwald ≤ 1,5 × Hain), (c) der Hain bleibt wie in 2.11 (balance-cycles.test.ts),
 * (d) Gelegenheitsspieler (Zufall, nur im großen Lauf) bekommen später mehr als im Hain und
 * sind in Zyklus 2 ≥ 20 % schneller.
 *
 * Im Check nur 12 Durchgänge: Das Verhältnis Wachstum/Harmonie in Zyklus 2 streut dann je
 * Seed-Fenster stark (Wald 0,87–1,12, Urwald 0,91–1,21; mit der Hain-Schwelle für alle Stufen
 * 0,83–0,96 bzw. 0,81–1,00). Darum prüft der Check vor allem den Gedächtnis-Gewinn, der
 * kaum streut, und das Verhältnis nur grob.
 */
const options = { maxSeconds: MAX_SECONDS, care: true, cycles: CYCLES };
const strategies = FULL ? [HARMONY, GROWTH, RANDOM] : [HARMONY, GROWTH];
const rows: RestartRow[] = [HAIN, WALD, URWALD].flatMap((stage) =>
  strategies.map((strategy) => ({ stage, strategy, runs: monteCarloCycles(strategy, RESTART_RUNS, { ...options, targetStage: stage }) })),
);
const row = (stage: number, id: string) => rows.find((r) => r.stage === stage && r.strategy.id === id)!;
const ratio = (stage: number, c: number) => restartTime(row(stage, GROWTH.id), c) / restartTime(row(stage, HARMONY.id), c);

describe('Neustart in Hain, Wald oder Urwald (Waldgedächtnis mit Schwelle je Stufe)', () => {
  it('Protokoll', () => {
    if (FULL) console.log(restartTable(rows));
    expect(rows).toHaveLength(3 * strategies.length);
  });

  it('jeder Zyklus erreicht seine Ziel-Stufe', () => {
    for (const r of rows) {
      for (const run of r.runs) {
        expect(run).toHaveLength(CYCLES);
        for (const c of run) expect(c.result.stages[r.stage], `${r.strategy.id} Stufe ${r.stage} Zyklus ${c.number}`).not.toBeNull();
      }
    }
  });

  it('(a) Harmonie bringt in Wald und Urwald deutlich mehr Gedächtnis und ist ab Zyklus 2 gleichauf', () => {
    for (const stage of [WALD, URWALD]) {
      // Gedächtnis über drei Zyklen: mit der Hain-Schwelle für alle Stufen nur ~15 Punkte mehr
      // (Wald 249 / 234, Urwald 271 / 258), jetzt ~40 (Check: Wald 208 / 166, Urwald 234 / 200).
      const total = (id: string) => row(stage, id).runs.reduce((sum, run) => sum + run.reduce((a, c) => a + c.memoryGain, 0), 0) / RESTART_RUNS;
      expect(total(HARMONY.id) - total(GROWTH.id), `Stufe ${stage}`).toBeGreaterThan(FULL ? 30 : 20);
      expect(restartGain(row(stage, HARMONY.id), 0), `Stufe ${stage}`).toBeGreaterThan(restartGain(row(stage, GROWTH.id), 0) + (FULL ? 10 : 3));
      // Großer Lauf: Zyklus 2 und 3 ≥ 0,97. Check (12 Durchgänge, Seed-Fenster siehe oben):
      // grob ≥ 0,84 je Zyklus und über beide Zyklen zusammen ≥ 0,85.
      expect(ratio(stage, 1), `Stufe ${stage} Zyklus 2`).toBeGreaterThan(FULL ? 0.97 : 0.84);
      expect(ratio(stage, 2), `Stufe ${stage} Zyklus 3`).toBeGreaterThan(FULL ? 0.97 : 0.84);
      const later = (id: string) => restartTime(row(stage, id), 1) + restartTime(row(stage, id), 2);
      expect(later(GROWTH.id) / later(HARMONY.id), `Stufe ${stage} Zyklus 2 + 3`).toBeGreaterThan(FULL ? 0.97 : 0.85);
    }
  });

  it('(b) späterer Neustart bringt moderat mehr: Wald > Hain, Urwald > Wald, Urwald ≤ ~1,5 × Hain', () => {
    for (const s of strategies) {
      const gain = (stage: number) => restartGain(row(stage, s.id), 0);
      expect(gain(WALD), s.id).toBeGreaterThan(gain(HAIN));
      expect(gain(URWALD), s.id).toBeGreaterThan(gain(WALD));
    }
    // Harmonie-Spieler, Zyklus 1 (großer Lauf ~1,45; mit der Hain-Schwelle ~1,66).
    const harmony = (stage: number) => restartGain(row(stage, HARMONY.id), 0);
    expect(harmony(URWALD) / harmony(HAIN)).toBeLessThan(FULL ? 1.5 : 1.6);
    expect(harmony(URWALD)).toBeLessThan(95);
  });

  it('(d) Gelegenheitsspieler: später mehr Gedächtnis als im Hain, Zyklus 2 ≥ 20 % schneller (großer Lauf)', () => {
    if (!FULL) return;
    for (const stage of [WALD, URWALD]) {
      const r = row(stage, RANDOM.id);
      expect(restartGain(r, 0), `Stufe ${stage}`).toBeGreaterThan(restartGain(row(HAIN, RANDOM.id), 0));
      expect(1 - restartTime(r, 1) / restartTime(r, 0), `Stufe ${stage}`).toBeGreaterThan(0.2);
    }
  });
});
