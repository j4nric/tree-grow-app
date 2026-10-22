import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, formatTime, median, runCycles, type Strategy } from '../scripts/simulate';
import {
  firstCycleOf,
  firstCycleTable,
  medianOrNull,
  milestoneTable,
  peakTable,
  runLandscape,
  siteRun,
  type LandscapeRules,
  type LandscapeSummary,
} from '../scripts/landscape';
import { LANDSCAPE_SITES, SITE_IDS } from '../src/content/landscape';
import { env } from './balance-setup';

/**
 * Waldlandschaft (DESIGN_V2.md 24.10): Modell auf der echten Logik (scripts/landscape.ts) –
 * die Landschaft selbst ist noch nicht in core/. Nur im großen Lauf, weil eine ganze
 * Landschaft 70–90 Zyklen bis zum Urwald sind (~15 s je Durchgang):
 *
 *   SIM_LANDSCAPE=1 SIM_LANDSCAPE_RUNS=20 npx vitest run tests/landscape-balance.test.ts --silent=false   # ~25 min
 *
 * Ziele (24.10): (a) jeder neue Wald erreicht seinen ersten Urwald schneller als der
 * Heimatwald (2. Wald ≤ 0,5 ×, danach nie langsamer als ~1,1 × der vorige), (b) die Landschaft
 * ist für den Harmonie-Spieler nach 12–30 h Spielzeit vollständig (lange Motivation, ohne
 * zähe Strecken), (c) Waldtypen ±5 % wie die Hauptbaum-Arten, (d) alle Zahlen bleiben weit
 * unter 1e15 (kein break_infinity.js nötig).
 */
const LARGE = !!env.SIM_LANDSCAPE;
const RUNS = Number(env.SIM_LANDSCAPE_RUNS ?? 20);
const SITE_RUNS = Number(env.SIM_LANDSCAPE_SITE_RUNS ?? 80);
const options = { maxCycles: 250, cycleMaxSeconds: 6 * 3600 };

function summary(label: string, strategy: Strategy, rules: Partial<LandscapeRules> = {}, runs = RUNS): LandscapeSummary {
  return { label, runs: Array.from({ length: runs }, (_, k) => runLandscape({ ...options, strategy, seed: 1001 + k, rules })) };
}

describe.skipIf(!LARGE)('Waldlandschaft – Modell (großer Lauf)', () => {
  it('Heute: Urwald-Neustarts bis zum vollen Waldgedächtnis (ohne Landschaft)', () => {
    const cycles = 16;
    const runs = Array.from({ length: RUNS }, (_, k) => runCycles(HARMONY, { seed: 1001 + k, targetStage: 7, maxSeconds: 6 * 3600, care: true, cycles }));
    const lines = ['| Zyklus | Gedächtnis zu Beginn | Gewinn | Urwald nach | Spielzeit gesamt |', '|---|---|---|---|---|'];
    let total = 0;
    for (let c = 0; c < cycles; c++) {
      const t = median(runs.map((r) => r[c]!.result.stages[7]?.time ?? r[c]!.result.final.time));
      total += t;
      lines.push(`| ${c + 1} | ${median(runs.map((r) => r[c]!.memory))} | ${median(runs.map((r) => r[c]!.memoryGain))} | ${formatTime(t)} | ${(total / 3600).toFixed(1).replace('.', ',')} h |`);
    }
    console.log(lines.join('\n'));
    // Das Gedächtnis ist nach höchstens 14 Urwald-Zyklen voll – danach gibt es heute nichts mehr zu gewinnen.
    expect(median(runs.map((r) => r[13]!.memory))).toBe(1000);
  });

  it('Varianten der Regeln (Harmonie-Spieler)', () => {
    const rows = [
      summary('A: Zufluss 0,2, kein Deckel, Korridor kaufen', HARMONY, { inflow: 0.2, inflowCap: 1000, freeCorridor: false }),
      summary('B: Zufluss 0,2, kein Deckel, Korridor mit der Gründung', HARMONY, { inflow: 0.2, inflowCap: 1000 }),
      summary('C: Zufluss 0,35, Deckel 500', HARMONY, { inflow: 0.35 }),
      summary('**D: Zufluss 0,5, Deckel 500 (gewählt)**', HARMONY),
      summary('E: Zufluss 0,5, kein Deckel', HARMONY, { inflowCap: 1000 }),
      summary('F: wie D, ohne Eigenheiten und Gaben', HARMONY, { siteEffects: false }),
    ];
    console.log(`${milestoneTable(rows)}\n\n${firstCycleTable(rows)}\n\n${peakTable(rows)}`);
    const d = rows[3]!;
    // (a) Jeder neue Wald startet deutlich schneller als der Heimatwald.
    const first = [0, 1, 2, 3, 4, 5].map((k) => medianOrNull(d.runs.map((run) => firstCycleOf(run, k))));
    expect(first[1]!).toBeLessThanOrEqual(0.5 * first[0]!);
    for (let k = 2; k <= 5; k++) expect(first[k]!).toBeLessThanOrEqual(1.1 * first[k - 1]!);
    // (b) Vollständig nach 12–30 h.
    const complete = medianOrNull(d.runs.map((r) => r.completeAt))!;
    expect(complete).toBeGreaterThan(12 * 3600);
    expect(complete).toBeLessThan(30 * 3600);
    // (d) Größenordnung.
    for (const r of d.runs) {
      expect(r.maxGrowth).toBeLessThan(1e5);
      expect(r.lifetimeGrowth).toBeLessThan(1e9);
    }
  });

  it('Spielweisen (Regeln D)', () => {
    const rows = [summary('Harmonie', HARMONY), summary('Wachstum', GROWTH), summary('Zufall', RANDOM, {}, Math.min(RUNS, 10))];
    console.log(`${milestoneTable(rows)}\n\n${firstCycleTable(rows)}\n\n${peakTable(rows)}`);
    for (const r of rows) expect(medianOrNull(r.runs.map((x) => x.completeAt)), r.label).not.toBeNull();
  });

  it('Waldtypen im Vergleich (wie die Baumarten, 17.4)', () => {
    const lines = ['| Wald | Leitbaum | Harmonie: Urwald | gegenüber Heimatwald | Wachstum: Urwald | gegenüber Heimatwald |', '|---|---|---|---|---|---|'];
    const home: Record<string, number> = {};
    const cells: Record<string, string[]> = {};
    for (const strategy of [HARMONY, GROWTH]) {
      for (const site of SITE_IDS) {
        const t = median(Array.from({ length: SITE_RUNS }, (_, k) => siteRun(strategy, site, 3000 + k, 200).seconds ?? 6 * 3600));
        if (site === 'home') home[strategy.id] = t;
        const rel = t / home[strategy.id]! - 1;
        (cells[site] ??= []).push(formatTime(t), `${rel >= 0 ? '+' : '−'}${Math.abs(rel * 100).toFixed(1).replace('.', ',')} %`);
        expect(Math.abs(rel), `${strategy.id} ${site}`).toBeLessThan(0.05);
      }
    }
    for (const s of LANDSCAPE_SITES) lines.push(`| ${s.icon} ${s.name} | ${s.leadTree ?? 'oak'} | ${cells[s.id]!.join(' | ')} |`);
    console.log(lines.join('\n'));
  });
});
