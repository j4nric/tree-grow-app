import { describe, expect, it } from 'vitest';
import {
  GROWTH,
  HARMONY,
  RANDOM,
  STAGE_TARGETS,
  extrasTable,
  longestDrought,
  mean,
  monteCarlo,
  runGame,
  stageStats,
  varietyStats,
} from '../scripts/simulate';
import { EVENTS } from '../src/content/events';
import { VISITORS } from '../src/content/visitors';
import { EVENT_RUNS, FULL, HAIN, MAX_SECONDS, URWALD, env } from './balance-setup';

/** Vergleich: dieselben Strategien und Seeds ohne Ereignisse (Stand heute). */
const RUNS = EVENT_RUNS;
/** Geprüft wird der Harmonie-Spieler; Wachstum und Zufall nur für die Tabellen (npm run balance). */
const STRATEGIES_HERE = FULL ? [HARMONY, GROWTH, RANDOM] : [HARMONY];
const base = monteCarlo(STRATEGIES_HERE, RUNS, { targetStage: URWALD, maxSeconds: MAX_SECONDS });
const byId = (id: string) => base.find((s) => s.strategy.id === id)!;
const harmony = byId(HARMONY.id);

/**
 * Ereignisse und Durchreisende (Schritt 2.4): Die Logik fehlt noch in src/core/ – der
 * Simulator modelliert sie grob (scripts/extras.ts, DESIGN_V2.md 15.4). Geprüft wird,
 * ob die Inhalte und der Takt (Gewichte + Zwischenhalt, encounters.ts) ihr Ziel
 * erreichen: kürzere Durststrecken nach dem Hain, Tempo bis zum Hain im Korridor.
 */
describe('Ereignisse und Durchreisende (Modell)', () => {
  const extraStrategies = STRATEGIES_HERE;
  const options = { targetStage: URWALD, maxSeconds: MAX_SECONDS, events: true };
  const withExtras = monteCarlo(extraStrategies, RUNS, options);
  const harmonyExtras = withExtras.find((s) => s.strategy.id === HARMONY.id)!;
  const WALD = HAIN + 1;

  it('Protokoll', () => {
    if (env.SIM_LOG) console.log(extrasTable(extraStrategies.map((s) => byId(s.id)), withExtras));
    expect(withExtras.length).toBe(extraStrategies.length);
  });

  it('ist deterministisch und ohne NaN', () => {
    const a = runGame(HARMONY, { seed: 9, ...options });
    expect(runGame(HARMONY, { seed: 9, ...options })).toEqual(a);
    for (const s of withExtras) for (const r of s.runs) expect(Number.isFinite(r.final.seeds) && r.final.seeds >= 0).toBe(true);
  });

  it('es kommen Ereignisse und Gäste – aber nie mehr, als es gibt', () => {
    for (const r of harmonyExtras.runs) {
      expect(r.final.counts.events).toBeLessThanOrEqual(EVENTS.length);
      expect(r.final.counts.visitors).toBeLessThanOrEqual(VISITORS.length);
    }
    const c = harmonyExtras.runs.map((r) => r.final.counts);
    expect(c.reduce((sum, x) => sum + x.events, 0) / c.length).toBeGreaterThan(4);
    expect(c.reduce((sum, x) => sum + x.visitors, 0) / c.length).toBeGreaterThan(3);
  });

  it('Tempo bis zum Hain bleibt im Zielkorridor (Harmonie-Spieler)', () => {
    for (const t of STAGE_TARGETS.filter((x) => x.stage > 1)) {
      const time = stageStats(harmonyExtras, t.stage).time;
      expect(time, t.label).toBeGreaterThan(0.7 * t.seconds);
      expect(time, t.label).toBeLessThan(1.35 * t.seconds);
    }
    // Höchstens 10 % schneller als ohne.
    expect(stageStats(harmonyExtras, HAIN).time).toBeGreaterThan(0.9 * stageStats(harmony, HAIN).time);
  });

  it('Durststrecken nach dem Hain werden kürzer (Harmonie-Spieler)', () => {
    // Mittel der längsten Durststrecke je Durchgang – stabiler als das 90-%-Quantil bei
    // wenigen Durchgängen (500 Durchgänge: Hain 90 % 10:07 → 7:39 min, DESIGN_V2.md 15.4).
    // Längste Strecke in Hain und Wald zusammen: deutlich kürzer; je Stufe nicht länger.
    const longest = (runs: typeof harmony.runs, stages: number[]) =>
      mean(runs.map((r) => Math.max(...stages.map((st) => longestDrought(r, st) ?? 0))));
    const before = longest(harmony.runs, [HAIN, WALD]);
    const after = longest(harmonyExtras.runs, [HAIN, WALD]);
    if (env.SIM_LOG) console.log(`Längste Durststrecke nach dem Hain (Mittel): ${before.toFixed(0)} → ${after.toFixed(0)} s`);
    expect(after).toBeLessThan(0.92 * before);
    for (const stage of [HAIN, WALD]) {
      expect(longest(harmonyExtras.runs, [stage]), `Stufe ${stage}`).toBeLessThan(longest(harmony.runs, [stage]));
    }
    expect(varietyStats(harmonyExtras, WALD).droughtP90).toBeLessThan(11 * 60);
  });
});
