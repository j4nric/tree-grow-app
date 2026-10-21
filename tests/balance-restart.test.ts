import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, memoryPathStats, memoryPathTable, monteCarloCycles, restartGain, restartTable, restartTime, type RestartRow } from '../scripts/simulate';
import { CYCLES, FULL, HAIN, MAX_SECONDS, RESTART_RUNS, URWALD, WALD } from './balance-setup';

/**
 * Neuer Zyklus erst später (Schritt 2.11b, DESIGN_V2.md 10 und 15.4): Jeder Zyklus läuft bis
 * Hain, Wald oder Urwald, dann Neustart. Schwelle und Obergrenze des Harmonie-Bonus gleiten
 * mit dem Wegpunkt (content/memory.ts, MEMORY_HARMONY_RULES; Hain 100 / 45 → Urwald 150 / 38).
 *
 * Ziele: (a) ab Zyklus 2 ist die Harmonie-Spielweise in jeder Stufe mindestens gleichauf
 * (Wachstum/Harmonie ≥ 0,97), (b) ein späterer Neustart bringt moderat mehr Gedächtnis als
 * im Hain (Urwald ≤ 1,5 × Hain), (c) der Hain bleibt wie in 2.11 (balance-cycles.test.ts),
 * (d) Gelegenheitsspieler (Zufall, nur im großen Lauf) bekommen später mehr als im Hain und
 * sind in Zyklus 2 ≥ 20 % schneller.
 *
 * Im Check nur 12 Durchgänge, die Werte streuen je Seed-Fenster stark. Gemessen mit
 * gleitender Schwelle in 11 Fenstern (Seed-Start 500, 1000 = Check, 2000, 3001, 4500, 7777,
 * 9999, 12345, 15000, 20000, 31337):
 * - Wachstum/Harmonie je Zyklus 2 / 3: Wald 0,85–1,16, Urwald 0,81–1,13; Zyklus 2 + 3
 *   zusammen Wald 0,86–1,15, Urwald 0,86–1,06,
 * - Gedächtnis-Vorsprung Harmonie über drei Zyklen: Wald 36–82, Urwald 24–67 Punkte;
 *   in Zyklus 1 Wald +7,5 bis +23, Urwald +4,5 bis +24,
 * - Urwald/Hain-Gewinn des Harmonie-Spielers 1,29–1,76, Urwald-Gewinn 81–94,
 * - Mittel-Verlauf der Vorschau: größte Delle −2,9 bis −5,0 (großer Lauf −1,2),
 * - größter Rückgang an einem Wegpunkt immer genau −10 (Formel-Grenze; seit der Sperrklinke,
 *   Spielstand v10, gar keiner mehr),
 * - Wachstums-Spieler: Gewinn Wald bzw. Urwald in einem Fenster (31337) unter dem Hain
 *   (64,7 / 62,3 / 63,3; großer Lauf 48,8 / 58,0 / 72,4).
 * (Die Fenster-Spannen stammen von vor der Sperrklinke; sie hebt vor allem den Gewinn des
 * Wachstums-Spielers, siehe DESIGN_V2.md 15.4 „Stand Sperrklinke“.)
 * Darum prüft der Check vor allem den Gedächtnis-Vorsprung und die Formel-Grenze; Verhältnis
 * und Gewinn-Quotient nur grob, Mittel-Verlauf und Reihenfolge beim Wachstums-Spieler nur im
 * großen Lauf.
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
      expect(total(HARMONY.id) - total(GROWTH.id), `Stufe ${stage}`).toBeGreaterThan(FULL ? 30 : 15);
      expect(restartGain(row(stage, HARMONY.id), 0), `Stufe ${stage}`).toBeGreaterThan(restartGain(row(stage, GROWTH.id), 0) + (FULL ? 10 : 2));
      // Großer Lauf: Zyklus 2 und 3 ≥ 0,97. Check (12 Durchgänge, Seed-Fenster siehe oben):
      // grob ≥ 0,76 je Zyklus und über beide Zyklen zusammen ≥ 0,8.
      expect(ratio(stage, 1), `Stufe ${stage} Zyklus 2`).toBeGreaterThan(FULL ? 0.97 : 0.76);
      expect(ratio(stage, 2), `Stufe ${stage} Zyklus 3`).toBeGreaterThan(FULL ? 0.97 : 0.76);
      const later = (id: string) => restartTime(row(stage, id), 1) + restartTime(row(stage, id), 2);
      expect(later(GROWTH.id) / later(HARMONY.id), `Stufe ${stage} Zyklus 2 + 3`).toBeGreaterThan(FULL ? 0.97 : 0.8);
    }
  });

  it('(b) späterer Neustart bringt moderat mehr: Wald > Hain, Urwald > Wald, Urwald ≤ ~1,5 × Hain', () => {
    // Im Check nur der Harmonie-Spieler: Beim Wachstums-Spieler liegen die Gewinne mit 12
    // Durchgängen manchmal gleichauf (Seed-Fenster siehe oben).
    for (const s of FULL ? strategies : [HARMONY]) {
      const gain = (stage: number) => restartGain(row(stage, s.id), 0);
      expect(gain(WALD), s.id).toBeGreaterThan(gain(HAIN));
      expect(gain(URWALD), s.id).toBeGreaterThan(gain(WALD));
    }
    // Harmonie-Spieler, Zyklus 1 (großer Lauf 1,46 und 88; mit der Hain-Schwelle 1,65 und 100;
    // Check-Fenster 1,29–1,76 und 81–94).
    const harmony = (stage: number) => restartGain(row(stage, HARMONY.id), 0);
    expect(harmony(URWALD) / harmony(HAIN)).toBeLessThan(FULL ? 1.5 : 1.9);
    expect(harmony(URWALD)).toBeLessThan(FULL ? 95 : 100);
  });

  it('(d) Gelegenheitsspieler: später mehr Gedächtnis als im Hain, Zyklus 2 ≥ 20 % schneller (großer Lauf)', () => {
    if (!FULL) return;
    for (const stage of [WALD, URWALD]) {
      const r = row(stage, RANDOM.id);
      expect(restartGain(r, 0), `Stufe ${stage}`).toBeGreaterThan(restartGain(row(HAIN, RANDOM.id), 0));
      expect(1 - restartTime(r, 1) / restartTime(r, 0), `Stufe ${stage}`).toBeGreaterThan(0.2);
    }
  });

  it('Vorschau beim Wachsen: sinkt nie (Sperrklinke seit v10)', () => {
    // Die Schwelle steigt um 3,125 je Wegpunkt. Bleibt H_max an einem Wegpunkt gleich, sank die
    // Vorschau bis v9 um bis zu 10 Punkte (3 · 3,125 = 9,375, nach dem Abrunden ≤ 10). Seit v10
    // merkt sich der Zyklus den besten Harmonie-Anteil (`cycle.bestHarmonyMemory`) – in keinem
    // Durchgang sinkt die Vorschau an einem Wegpunkt. Gilt in jedem Seed-Fenster.
    for (const r of rows) {
      if (r.stage === HAIN) continue;
      for (let c = 0; c < CYCLES; c++) {
        const st = memoryPathStats(r.runs, c);
        expect(st.worstDrop, `${r.strategy.id} Stufe ${r.stage} Zyklus ${c + 1}`).toBeGreaterThanOrEqual(0);
        expect(st.dropShare, `${r.strategy.id} Stufe ${r.stage} Zyklus ${c + 1}`).toBe(0);
      }
    }
  });
});
