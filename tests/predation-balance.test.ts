import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, formatTime, mean, median, monteCarlo, runCycles, stageStats, type Summary } from '../scripts/simulate';
import { evaluate } from '../src/core/formulas';
import { createInitialState } from '../src/core/state';
import { env, HAIN, MAX_SECONDS, URWALD, WALD } from './balance-setup';

/**
 * Räuber und Beute (DESIGN_V2.md 22.9) mit der echten Logik: Stufenzeiten, Harmonie,
 * Zufriedenheit, Waldgedächtnis, Massenjahre und Ereignisse je Durchgang (alle Systeme mit
 * Pflege, Eiche, Einzelwetter wie online). Läuft nur auf Wunsch:
 *
 *   SIM_PREDATION=1 SIM_PREDATION_RUNS=100 npx vitest run tests/predation-balance.test.ts --silent=false
 *
 * SIM_PREDATION_CYCLES=1 rechnet zusätzlich drei Zyklen bis zum Hain (60 Durchgänge).
 * SIM_PREDATION_LABEL beschriftet die Zeilen (z. B. „vorher“ auf einem älteren Stand).
 */
const ON = !!env.SIM_PREDATION;
const RUNS = Number(env.SIM_PREDATION_RUNS ?? 40);
const CYCLE_RUNS = Number(env.SIM_PREDATION_CYCLE_RUNS ?? 60);
const LABEL = env.SIM_PREDATION_LABEL ?? 'Räuber und Beute';
const MASS_YEARS = ['caterpillar-year', 'vole-year', 'beetle-year', 'slug-year'];
const WEATHER_EVENTS = ['storm', 'windthrow', 'toad-migration', 'rain', 'late-frost', 'heatwave', 'midsummer', 'bee-swarm', 'mushroom-autumn', 'snow-break'];

/** Anteil der Durchgänge, in denen das Ereignis bis zum Ende vorkam (je Zyklus höchstens einmal). */
const share = (s: Summary, id: string) => s.runs.filter((r) => (r.final.seen ?? []).includes(id)).length / s.runs.length;

describe.skipIf(!ON)('Räuber und Beute (Messung)', () => {
  it('Stufenzeiten, Harmonie, Massenjahre bis zum Urwald', () => {
    // Sanity: der Spielstand rechnet (auch auf älteren Ständen ohne foodWeb).
    expect(Number.isFinite(evaluate(createInitialState(0, 1)).harmony)).toBe(true);
    const summaries = monteCarlo([HARMONY, GROWTH, RANDOM], RUNS, { targetStage: URWALD, maxSeconds: MAX_SECONDS, care: true });
    const lines = [
      '| Variante | Strategie | Junger Baum | Alter Baum | Hain | Wald | Urwald | ⚖️ Hain / Wald | Ø 😊 Hain | Gedächtnis Hain / Urwald | Ereignisse je Durchgang |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    const extra: string[] = [];
    for (const s of summaries) {
      const times = [3, 4, 5, 6, 7].map((k) => formatTime(stageStats(s, k).time));
      const hain = stageStats(s, HAIN);
      const wald = stageStats(s, WALD);
      const arrive = s.runs.map((r) => r.memoryPath.find((p) => p.waypoint >= 20)?.after ?? NaN).filter(Number.isFinite);
      const end = s.runs.map((r) => r.memoryPath.at(-1)?.after ?? NaN).filter(Number.isFinite);
      const events = mean(s.runs.map((r) => r.final.counts.events));
      lines.push(
        `| ${LABEL} | ${s.strategy.name} | ${times.join(' | ')} | ${hain.harmony.toFixed(1)} / ${wald.harmony.toFixed(1)} | ${(100 * hain.happiness).toFixed(1)} % | ${median(arrive).toFixed(0)} / ${median(end).toFixed(0)} | ${events.toFixed(1)} |`,
      );
      extra.push(
        `${s.strategy.id}: Massenjahre ${MASS_YEARS.map((id) => `${id} ${share(s, id).toFixed(2)}`).join(' · ')}` +
          `\n   Wetter-Ereignisse ${WEATHER_EVENTS.map((id) => `${id} ${share(s, id).toFixed(2)}`).join(' · ')}`,
      );
    }
    console.log(`\n${lines.join('\n')}\n${extra.join('\n')}`);
  }, 3_600_000);

  it.skipIf(!env.SIM_PREDATION_CYCLES)('drei Zyklen bis zum Hain', () => {
    const lines = ['| Variante | Strategie | Zyklus 1 | Zyklus 2 | Zyklus 3 |', '|---|---|---|---|---|'];
    for (const strategy of [HARMONY, GROWTH, RANDOM]) {
      const runs = Array.from({ length: CYCLE_RUNS }, (_, i) =>
        runCycles(strategy, { seed: 1000 + 7 * i, targetStage: HAIN, maxSeconds: MAX_SECONDS, care: true, cycles: 3 }),
      );
      const cols = [0, 1, 2].map((c) => {
        const time = median(runs.map((r) => r[c]!.result.stages[HAIN]?.time ?? NaN).filter(Number.isFinite));
        return `${formatTime(time)} · ${median(runs.map((r) => r[c]!.maxHarmony)).toFixed(1)} · +${median(runs.map((r) => r[c]!.memoryGain))}`;
      });
      lines.push(`| ${LABEL} | ${strategy.name} | ${cols.join(' | ')} |`);
    }
    console.log(`\n${lines.join('\n')}`);
  }, 3_600_000);
});
