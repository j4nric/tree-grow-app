import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, memoryPathStats, memoryPathTable, monteCarloCycles, restartGain, restartTable, restartTime, type RestartRow } from '../scripts/simulate';
import { CYCLES, FULL, HAIN, MAX_SECONDS, RESTART_RUNS, URWALD, WALD } from './balance-setup';

/**
 * Neuer Zyklus erst später (Schritt 2.11b, DESIGN_V2.md 10 und 15.4): Jeder Zyklus läuft bis
 * Hain, Wald oder Urwald, dann Neustart. Schwelle und Obergrenze des Harmonie-Bonus gleiten
 * mit dem Wegpunkt (content/memory.ts, MEMORY_HARMONY_RULES; Hain 100 / 45 → Urwald 150 / 36).
 *
 * Ziele: (a) ab Zyklus 2 ist die Harmonie-Spielweise in jeder Stufe mindestens gleichauf
 * (Wachstum/Harmonie ≥ 0,97), (b) ein späterer Neustart bringt moderat mehr Gedächtnis als
 * im Hain (Urwald ≤ 1,5 × Hain), (c) der Hain bleibt wie in 2.11 (balance-cycles.test.ts),
 * (d) Gelegenheitsspieler (Zufall, nur im großen Lauf) bekommen später mehr als im Hain und
 * sind in Zyklus 2 ≥ 20 % schneller.
 *
 * Im Check nur 12 Durchgänge: Das Verhältnis Wachstum/Harmonie in Zyklus 2 streut dann je
 * Seed-Fenster stark (gemessen mit Schwellen je Stufe: Wald 0,87–1,12, Urwald 0,91–1,21; mit
 * der Hain-Schwelle für alle Stufen 0,83–0,96 bzw. 0,81–1,00; Check-Fenster jetzt 0,96 /
 * 0,91). Darum prüft der Check vor allem den Gedächtnis-Gewinn, der kaum streut, und das
 * Verhältnis nur grob.
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
    if (FULL) console.log(`${restartTable(rows)}\n\n${memoryPathTable(rows)}`);
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
      // Gedächtnis über drei Zyklen: mit der Hain-Schwelle für alle Stufen nur 11–15 Punkte mehr
      // (großer Lauf: Wald 250 / 236, Urwald 271 / 260), jetzt 50–60 (großer Lauf: Wald 226 / 164,
      // Urwald 243 / 193; Check: Wald 223 / 161, Urwald 238 / 189).
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
    // Harmonie-Spieler, Zyklus 1 (großer Lauf 1,46; mit der Hain-Schwelle 1,65).
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

  it('Vorschau beim Wachsen: kein Sprung beim Stufenwechsel, Rückgang je Wegpunkt klein', () => {
    // Die Schwelle steigt um 3,125 je Wegpunkt. Bleibt H_max an einem Wegpunkt gleich, sinkt die
    // Vorschau um höchstens ~10 Punkte (3 · 3,125 plus Rundung) – mit Schwellen je Stufe sprang
    // sie beim Erreichen von Wald bzw. Urwald im Mittel um 14–26 Punkte. Der Mittel-Verlauf
    // steigt (großer Lauf: größte Delle −1,2; Check bis −2,9, weil 12 Durchgänge streuen).
    for (const r of rows) {
      if (r.stage === HAIN) continue;
      for (let c = 0; c < CYCLES; c++) {
        const st = memoryPathStats(r.runs, c);
        expect(st.worstDrop, `${r.strategy.id} Stufe ${r.stage} Zyklus ${c + 1}`).toBeGreaterThanOrEqual(-10);
        expect(st.worstMeanDip, `${r.strategy.id} Stufe ${r.stage} Zyklus ${c + 1} Mittel`).toBeGreaterThanOrEqual(FULL ? -1.5 : -4);
      }
    }
  });
});
