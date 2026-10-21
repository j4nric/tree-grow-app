import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, STAGE_TARGETS, environmentTable, monteCarlo, stageStats, type Summary } from '../scripts/simulate';

/**
 * Jahreszeiten und Hauptbaum-Arten mit der ECHTEN Logik (DESIGN_V2.md 15.4, 16, 17). Die
 * Jahreszeiten laufen in jedem Durchgang mit; verglichen werden die drei Baumarten im
 * ersten Zyklus (ohne Waldgedächtnis). Der Test prüft die Design-Ziele: Das Tempo bleibt
 * im Korridor und nah am Stand ohne Jahreszeiten, keine Baumart ist deutlich besser oder
 * schlechter als die Eiche.
 *
 * Tabellen im Protokoll:   SIM_LOG=1 npx vitest run tests/seasons-balance.test.ts
 * Mehr Durchgänge (Doku):  SIM_LOG=1 SIM_SEASON_ALL=1 SIM_SEASON_RUNS=200 npx vitest run tests/seasons-balance.test.ts
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUNS = Number(env.SIM_SEASON_RUNS ?? 30);
const HAIN = 5;
const options = { targetStage: env.SIM_LOG ? 7 : HAIN, maxSeconds: 6 * 3600 };
// Mit SIM_SEASON_ALL alle drei Spielertypen, sonst nur der Harmonie-Spieler.
const strategies = env.SIM_SEASON_ALL ? [HARMONY, GROWTH, RANDOM] : [HARMONY];

/**
 * Stand ohne Jahreszeiten und Baumarten (Schritt 2.4, echte Logik, Harmonie-Spieler,
 * 100 Durchgänge, DESIGN_V2.md 15.4): Hain nach 45:44 min, Harmonie 100,1.
 */
const BEFORE = { hainSeconds: 45 * 60 + 44, harmony: 100.1 };

const run = (extra: object) => monteCarlo(strategies, RUNS, { ...options, ...extra });
const trees = {
  oak: run({ mainTree: 'oak' }),
  beech: run({ mainTree: 'beech' }),
  pine: run({ mainTree: 'pine' }),
};
const harmonyOf = (s: Summary[]) => s.find((x) => x.strategy.id === HARMONY.id)!;

describe('Jahreszeiten und Baumarten (echte Logik)', () => {
  it('Protokoll', () => {
    if (env.SIM_LOG) {
      for (const [i, strategy] of strategies.entries()) {
        console.log(
          `#### ${strategy.name} (${RUNS} Durchgänge)\n\n` +
            environmentTable([
              { label: 'Eiche', summary: trees.oak[i]! },
              { label: 'Buche', summary: trees.beech[i]! },
              { label: 'Kiefer', summary: trees.pine[i]! },
            ]),
        );
      }
    }
    expect(trees.oak.length).toBe(strategies.length);
  });

  it('Jahreszeiten (Eiche): Hain im Korridor und höchstens 10 % neben dem Stand ohne, Harmonie nicht niedriger', () => {
    const oak = stageStats(harmonyOf(trees.oak), HAIN);
    const target = STAGE_TARGETS.find((t) => t.stage === HAIN)!.seconds;
    expect(oak.reachedShare).toBe(1);
    expect(oak.time).toBeGreaterThan(0.7 * target);
    expect(oak.time / BEFORE.hainSeconds).toBeGreaterThan(0.9);
    expect(oak.time / BEFORE.hainSeconds).toBeLessThan(1.1);
    expect(oak.harmony).toBeGreaterThan(BEFORE.harmony - 2);
  });

  it('Baumarten: jede erreicht den Hain innerhalb ±10 % der Eiche, Harmonie ±8 Punkte', () => {
    const oak = stageStats(harmonyOf(trees.oak), HAIN);
    for (const [id, s] of Object.entries(trees)) {
      const st = stageStats(harmonyOf(s), HAIN);
      expect(st.reachedShare, id).toBe(1);
      expect(st.time / oak.time, id).toBeGreaterThan(0.9);
      expect(st.time / oak.time, id).toBeLessThan(1.1);
      expect(Math.abs(st.harmony - oak.harmony), id).toBeLessThan(8);
    }
  });
});
