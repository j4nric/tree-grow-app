import { describe, expect, it } from 'vitest';
import {
  GROWTH,
  HARMONY,
  RANDOM,
  cycleTable,
  mean,
  median,
  memoryPathStats,
  memoryPathTable,
  restartGain,
  restartTable,
  restartTime,
  runCycles,
  type CycleRun,
  type RestartRow,
} from '../scripts/simulate';
import { CYCLES, CYCLE_RUNS, FULL, HAIN, MAX_SECONDS, RESTART_RUNS, URWALD, WALD } from './balance-setup';
import { cycles } from './balance-runs';

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
// Geteilt mit dem Neustart in Hain, Wald, Urwald (unten): tests/balance-runs.ts.
const rows = strategies.map((strategy) => ({ strategy, runs: cycles(strategy, CYCLE_RUNS, HAIN) }));
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
    // Seit Phase 11, 1e (Simulator: Gabel-Wahl je Strategie, der Harmonie-Spieler forscht auch
    // für ⚖️) im Check 0,495 statt 0,479 (Zyklus 2 bis Hain 29,0 statt 30,0 min) – vorläufig
    // < 0,52; die Messung Phase 11, 3b stellt die Gedächtnis-Schwellen nach (27.11, 28.10).
    expect(speedup(HARMONY.id)).toBeGreaterThan(0.3);
    expect(speedup(HARMONY.id)).toBeLessThan(FULL ? 0.45 : 0.52);
    expect(speedup(GROWTH.id)).toBeGreaterThan(FULL ? 0.18 : 0.16);
    // Seit Phase 10, 2b (Begegnungen nur Tiere: H_max höher, mehr Gedächtnis, 27.10) im Check
    // 0,42 – vorläufig < 0,45; Phase 10, 3b stellt die Gedächtnis-Schwellen nach (27.11).
    expect(speedup(GROWTH.id)).toBeLessThan(FULL ? 0.37 : 0.45);
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
    // Seit Phase 10, 2b im Check ~80 (H_max am Hain +5–7 ohne „Etwas keimt“, Vorab-Messung
    // 27.10: ~+16 Punkte) – vorläufig < 90; Phase 10, 3b hebt ggf. die Schwellen (27.11).
    const first = mean(of(HARMONY.id).map((r) => r[0]!.memoryGain));
    expect(first).toBeGreaterThan(45);
    expect(first).toBeLessThan(FULL ? 75 : 90);
  });
});

/**
 * Neuer Zyklus erst später (Schritt 2.11b, DESIGN_V2.md 10 und 15.4): Jeder Zyklus läuft bis
 * Hain, Wald oder Urwald, dann Neustart. Sockel-Teiler, Schwelle und Obergrenze gleiten mit
 * dem Wegpunkt (content/memory.ts, MEMORY_HARMONY_RULES; Hain 5 / 100 / 45 → Wald 6 / 148 /
 * 48 → Urwald 7 / 164 / 48, abgeglichen mit der Sperrklinke, Spielstand v10).
 *
 * Ziele: (a) ab Zyklus 2 ist die Harmonie-Spielweise in jeder Stufe mindestens gleichauf
 * (Wachstum/Harmonie über Zyklus 2 + 3 ≥ 0,97, je Zyklus ≥ 0,95), (b) ein späterer Neustart bringt moderat mehr Gedächtnis als
 * im Hain (Urwald ≤ 1,5 × Hain), (c) der Hain bleibt wie in 2.11 (balance-cycles.test.ts),
 * (d) Gelegenheitsspieler (Zufall, nur im großen Lauf) bekommen später mehr als im Hain und
 * sind in Zyklus 2 ≥ 20 % schneller, (e) die Urwald-Schwelle liegt ~10 unter der typischen
 * Harmonie des Harmonie-Spielers (tests/cycle.test.ts, „typische Verläufe“).
 *
 * Im Check nur 12 Durchgänge, die Werte streuen je Seed-Fenster stark. Gemessen nach dem
 * Abgleich mit der Sperrklinke in 11 Fenstern (Seed-Start 500, 1000 = Check, 2000, 3001,
 * 4500, 7777, 9999, 12345, 15000, 20000, 31337):
 * - Wachstum/Harmonie je Zyklus 2 / 3: Wald 0,87–1,12, Urwald 0,89–1,07; Zyklus 2 + 3
 *   zusammen Wald 0,885–1,01, Urwald 0,91–1,05,
 * - Gedächtnis-Vorsprung Harmonie über drei Zyklen: Wald 32–64, Urwald 39–59 Punkte;
 *   in Zyklus 1 Wald +3,1 bis +17,6, Urwald +8,2 bis +18,3,
 * - Urwald/Hain-Gewinn des Harmonie-Spielers 1,29–1,76, Urwald-Gewinn 78–93,
 * - Reihenfolge Hain < Wald < Urwald beim Gewinn auch beim Wachstums-Spieler in allen
 *   Fenstern (vor dem Abgleich in einem Fenster nicht),
 * - Vorschau sinkt an keinem Wegpunkt (Sperrklinke).
 * Mit 200 Durchgängen (DESIGN_V2.md 15.4, „Stand Abgleich Sperrklinke“) streut Zyklus 2 je
 * Fenster noch um ±0,04 (Wald 0,948–1,032, Urwald 0,947–1,011). Seit dem Playtest Amphibien
 * (Laubfrosch, Kammmolch) liegt Wald, Zyklus 2 etwa 1 % tiefer – ein kleiner echter Effekt,
 * weil jetzt auch der Wachstums-Spieler Amphibien-Karten bekommt (Mittel dreier Fenster
 * 0,975 → 0,965, großer Lauf 0,994 → 0,966). Darum gilt ≥ 0,97 über Zyklus 2 + 3 zusammen,
 * je Zyklus ≥ 0,95.
 * Darum prüft der Check vor allem den Gedächtnis-Vorsprung; Verhältnis und Gewinn-Quotient
 * nur grob, Mittel-Verlauf und Reihenfolge beim Wachstums-Spieler nur im großen Lauf.
 */
describe('Neustart in Hain, Wald oder Urwald (Waldgedächtnis mit Schwelle je Stufe)', () => {
  // Bis Phase 6 eine eigene Datei (balance-restart.test.ts). Die ersten RESTART_RUNS Seeds
  // spielen ihren ersten Zyklus nur einmal bis zum Urwald und zweigen an Hain und Wald ab;
  // der Neustart im Hain sind dieselben Durchgänge wie oben (tests/balance-runs.ts).
  const rows: RestartRow[] = [HAIN, WALD, URWALD].flatMap((stage) =>
    strategies.map((strategy) => ({ stage, strategy, runs: cycles(strategy, RESTART_RUNS, stage) })),
  );
  const row = (stage: number, id: string) => rows.find((r) => r.stage === stage && r.strategy.id === id)!;
  const ratio = (stage: number, c: number) => restartTime(row(stage, GROWTH.id), c) / restartTime(row(stage, HARMONY.id), c);

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
      // (großer Lauf: Wald 250 / 236, Urwald 271 / 260), jetzt ~55–60 (großer Lauf: Wald 231 / 174,
      // Urwald 246 / 187; Check: Wald 47, Urwald 59 Punkte Vorsprung).
      const total = (id: string) => row(stage, id).runs.reduce((sum, run) => sum + run.reduce((a, c) => a + c.memoryGain, 0), 0) / RESTART_RUNS;
      // Seit v17 (Phase 10, 2a, Forschung mit ⚖️ statt Pflege mit 🌰) im Check nur ~23 (Wald):
      // Beide Spieler forschen jetzt mit Harmonie, der Wachstums-Spieler holt beim Gedächtnis auf.
      // Vorläufig > 15; seit 2b (Begegnungen nur Tiere: auch der Wachstums-Spieler bekommt mehr
      // Arten und Harmonie) im Check ~15 (Urwald) – vorläufig > 8. Bleibt für Phase 10, 3b
      // markiert: misst neu und hebt ggf. die Gedächtnis-Schwellen (27.11).
      expect(total(HARMONY.id) - total(GROWTH.id), `Stufe ${stage}`).toBeGreaterThan(FULL ? 30 : 8);
      expect(restartGain(row(stage, HARMONY.id), 0), `Stufe ${stage}`).toBeGreaterThan(restartGain(row(stage, GROWTH.id), 0) + (FULL ? 10 : 2));
      // Großer Lauf: Zyklus 2 und 3 je ≥ 0,95, zusammen ≥ 0,97. Check (12 Durchgänge,
      // Seed-Fenster siehe oben): grob ≥ 0,82 je Zyklus und über beide Zyklen zusammen ≥ 0,86.
      // Je Zyklus 0,95 statt 0,97 seit dem Playtest Amphibien: Wald, Zyklus 2 je 200er-Fenster
      // (Seed-Start 1000 / 50000 / 90000) vorher 0,994 / 0,973 / 0,958, danach 0,966 / 0,972 /
      // 0,958 – Mittel 0,975 → 0,965, ein kleiner echter Effekt (~1 %; der Wachstums-Spieler
      // bekommt jetzt auch Amphibien-Karten), im Ziel „gleichauf“. Darum kombiniert geprüft
      // (DESIGN_V2.md 15.4, „Stand Playtest Amphibien“).
      expect(ratio(stage, 1), `Stufe ${stage} Zyklus 2`).toBeGreaterThan(FULL ? 0.95 : 0.82);
      expect(ratio(stage, 2), `Stufe ${stage} Zyklus 3`).toBeGreaterThan(FULL ? 0.95 : 0.82);
      const later = (id: string) => restartTime(row(stage, id), 1) + restartTime(row(stage, id), 2);
      expect(later(GROWTH.id) / later(HARMONY.id), `Stufe ${stage} Zyklus 2 + 3`).toBeGreaterThan(FULL ? 0.97 : 0.86);
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
    // Harmonie-Spieler, Zyklus 1 (großer Lauf 1,44 und 87 nach dem frühen Spiel, vorher 1,45 und 88; 2.11b 1,46 und 88, mit Sperrklinke
    // vor dem Abgleich 1,53 und 93; mit der Hain-Schwelle 1,65 und 100; Check-Fenster 1,29–1,76
    // und 78–93). Seit Räuber und Beute (DESIGN_V2.md 22.9, Futter = max(1, Bestand)) großer
    // Lauf 1,36 und 94,9 – knapp unter der Grenze: Die Beute ist zufriedener, H_max höher
    // (Urwald, Zyklus 1: 186,6). Steigt der Wert weiter, MEMORY_HARMONY_RULES prüfen (ROADMAP).
    const harmony = (stage: number) => restartGain(row(stage, HARMONY.id), 0);
    expect(harmony(URWALD) / harmony(HAIN)).toBeLessThan(FULL ? 1.5 : 1.9);
    // Seit Phase 10, 2b (H_max höher ohne „Etwas keimt“, 27.10) im Check 105,5 – vorläufig < 115;
    // Phase 10, 3b hebt die Gedächtnis-Schwellen T um ΔH_max (27.11, Stellschraube 1).
    expect(harmony(URWALD)).toBeLessThan(FULL ? 95 : 115);
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
    // Die Schwelle steigt mit dem Wegpunkt. Bleibt H_max an einem Wegpunkt gleich, sank die
    // Vorschau bis v9 um bis zu 10 Punkte (2.11b: 3 · 3,125 = 9,375, nach dem Abrunden ≤ 10). Seit v10
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
