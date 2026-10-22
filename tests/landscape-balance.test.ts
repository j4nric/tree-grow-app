import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, formatTime, median, runCycles, type Strategy } from '../scripts/simulate';
import {
  firstCycleOf,
  firstCycleTable,
  harmonyTable,
  medianOrNull,
  milestoneTable,
  peakTable,
  runLandscape,
  siteRun,
  type LandscapeSummary,
} from '../scripts/landscape';
import { LANDSCAPE_SITES, SITE_IDS } from '../src/content/landscape';
import { env } from './balance-setup';

/**
 * Waldlandschaft (DESIGN_V2.md 24.10) mit der echten Logik aus core/ (scripts/landscape.ts).
 * Eine ganze Landschaft sind 70–90 Zyklen bis zum Urwald – der große Lauf nur auf Wunsch:
 *
 *   SIM_LANDSCAPE=1 SIM_LANDSCAPE_RUNS=20 npx vitest run tests/landscape-balance.test.ts --silent=false
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

function summary(label: string, strategy: Strategy, runs = RUNS): LandscapeSummary {
  return { label, runs: Array.from({ length: runs }, (_, k) => runLandscape({ ...options, strategy, seed: 1001 + k })) };
}

describe('Waldlandschaft – Simulation (kurz)', { timeout: 120_000 }, () => {
  it('ein Harmonie-Spieler schaltet die Landschaft frei und gründet den zweiten Wald (echte Logik)', () => {
    const run = runLandscape({ strategy: HARMONY, seed: 1001, maxCycles: 5, cycleMaxSeconds: 6 * 3600 });
    expect(run.unlockAt).not.toBeNull();
    expect(Object.keys(run.foundedAt).length).toBeGreaterThanOrEqual(2);
    expect(run.jayEarned).toBeGreaterThanOrEqual(run.jaySpent);
    const second = run.cycles.find((c) => c.site !== 'home');
    // Der zweite Wald startet mit Zufluss über den Gratis-Korridor, nicht bei 0.
    expect(second?.effective).toBeGreaterThan(0);
    expect(second?.ownBefore).toBe(0);
  });
});

describe.skipIf(!LARGE)('Waldlandschaft – Simulation (großer Lauf)', () => {
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
    expect(median(runs.map((r) => r[13]!.memory))).toBe(1000);
  });

  it('Spielweisen', () => {
    const rows = [summary('Harmonie', HARMONY), summary('Wachstum', GROWTH), summary('Zufall', RANDOM, Math.min(RUNS, 10))];
    const complete = rows.map((r) => medianOrNull(r.runs.map((x) => x.completeAt)));
    const maxed = rows.map((r) => medianOrNull(r.runs.map((x) => x.allMaxedAt)));
    console.log(`${milestoneTable(rows)}\n\n${firstCycleTable(rows)}\n\n${harmonyTable(rows)}\n\n${peakTable(rows)}`);
    console.log(
      `Wachstum gegenüber Harmonie: vollständig ${((complete[0]! / complete[1]! - 1) * 100).toFixed(1)} % schneller, alle voll ${((maxed[0]! / maxed[1]! - 1) * 100).toFixed(1)} % schneller`,
    );
    const h = rows[0]!;
    // (a) Jeder neue Wald startet deutlich schneller als der Heimatwald.
    const first = [0, 1, 2, 3, 4, 5].map((k) => medianOrNull(h.runs.map((run) => firstCycleOf(run, k))));
    expect(first[1]!).toBeLessThanOrEqual(0.5 * first[0]!);
    for (let k = 2; k <= 5; k++) expect(first[k]!).toBeLessThanOrEqual(1.1 * first[k - 1]!);
    // (b) Vollständig nach 12–30 h.
    expect(complete[0]!).toBeGreaterThan(12 * 3600);
    expect(complete[0]!).toBeLessThan(30 * 3600);
    // (d) Größenordnung.
    for (const r of rows) {
      expect(complete[rows.indexOf(r)], r.label).not.toBeNull();
      for (const run of r.runs) {
        expect(run.maxGrowth).toBeLessThan(1e5);
        expect(run.lifetimeGrowth).toBeLessThan(1e9);
      }
    }
  });

  it('Waldtypen im Vergleich (wie die Baumarten, 17.4)', () => {
    const lines = ['| Wald | Leitbaum | Harmonie: Urwald | gegenüber Heimatwald | Wachstum: Urwald | gegenüber Heimatwald |', '|---|---|---|---|---|---|'];
    const home: Record<string, number> = {};
    const cells: Record<string, string[]> = {};
    const deviations: string[] = [];
    for (const strategy of [HARMONY, GROWTH]) {
      for (const site of SITE_IDS) {
        const t = median(Array.from({ length: SITE_RUNS }, (_, k) => siteRun(strategy, site, 3000 + k, 200).seconds ?? 6 * 3600));
        if (site === 'home') home[strategy.id] = t;
        const rel = t / home[strategy.id]! - 1;
        (cells[site] ??= []).push(formatTime(t), `${rel >= 0 ? '+' : '−'}${Math.abs(rel * 100).toFixed(1).replace('.', ',')} %`);
        if (Math.abs(rel) >= 0.05) deviations.push(`${strategy.id} ${site} ${(rel * 100).toFixed(1)} %`);
      }
    }
    for (const s of LANDSCAPE_SITES) lines.push(`| ${s.icon} ${s.name} | ${s.leadTree ?? 'oak'} | ${cells[s.id]!.join(' | ')} |`);
    console.log(lines.join('\n'));
    expect(deviations).toEqual([]);
  });
});
