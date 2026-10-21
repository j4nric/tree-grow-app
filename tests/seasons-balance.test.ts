import { describe, expect, it } from 'vitest';
import { ENCOUNTER_WEIGHTS } from '../src/content/encounters';
import { GROWTH, HARMONY, RANDOM, environmentTable, monteCarlo, stageStats, type Summary } from '../scripts/simulate';
import { restoreWeights } from '../scripts/season-model';

/**
 * Jahreszeiten und Hauptbaum-Arten im groben Modell (scripts/season-model.ts,
 * DESIGN_V2.md 16.5 und 17.4) – die Logik fehlt noch. Der Test prüft die Design-Ziele:
 * Jahreszeiten lassen das Tempo im Korridor und bremsen den Harmonie-Spieler nicht;
 * keine Baumart ist deutlich besser oder schlechter als die Eiche.
 *
 * Tabellen im Protokoll:   SIM_LOG=1 npx vitest run tests/seasons-balance.test.ts
 * Mehr Durchgänge (Doku):  SIM_LOG=1 SIM_SEASON_RUNS=200 npx vitest run tests/seasons-balance.test.ts
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUNS = Number(env.SIM_SEASON_RUNS ?? 30);
const HAIN = 5;
const options = { targetStage: env.SIM_LOG ? 7 : HAIN, maxSeconds: 6 * 3600 };
// Mit SIM_SEASON_ALL alle drei Spielertypen, sonst nur der Harmonie-Spieler.
const strategies = env.SIM_SEASON_ALL ? [HARMONY, GROWTH, RANDOM] : [HARMONY];

const run = (extra: object) => monteCarlo(strategies, RUNS, { ...options, ...extra });
const base = run({});
const seasons = run({ seasons: true });
const trees = {
  oak: run({ seasons: true, mainTree: 'oak' }),
  beech: run({ seasons: true, mainTree: 'beech' }),
  pine: run({ seasons: true, mainTree: 'pine' }),
};
const harmonyOf = (s: Summary[]) => s.find((x) => x.strategy.id === HARMONY.id)!;

describe('Jahreszeiten und Baumarten (grobes Modell)', () => {
  it('Protokoll', () => {
    if (env.SIM_LOG) {
      for (const [i, strategy] of strategies.entries()) {
        console.log(
          `#### ${strategy.name} (${RUNS} Durchgänge)\n\n` +
            environmentTable([
              { label: 'ohne Jahreszeiten (heute)', summary: base[i]! },
              { label: 'Jahreszeiten', summary: seasons[i]! },
              { label: 'Jahreszeiten + Eiche', summary: trees.oak[i]! },
              { label: 'Jahreszeiten + Buche', summary: trees.beech[i]! },
              { label: 'Jahreszeiten + Kiefer', summary: trees.pine[i]! },
            ]),
        );
      }
    }
    expect(base.length).toBe(strategies.length);
  });

  it('setzt die im Modell geänderten Begegnungsgewichte zurück', () => {
    const before = ENCOUNTER_WEIGHTS.map((r) => [...r]);
    restoreWeights();
    expect(ENCOUNTER_WEIGHTS.map((r) => [...r])).toEqual(before);
    expect(ENCOUNTER_WEIGHTS[3]).toEqual([65, 25, 10, 0]);
  });

  it('Jahreszeiten: Hain höchstens 10 % früher oder später, Harmonie nicht niedriger', () => {
    const a = stageStats(harmonyOf(base), HAIN);
    const b = stageStats(harmonyOf(seasons), HAIN);
    expect(b.reachedShare).toBe(1);
    expect(b.time / a.time).toBeGreaterThan(0.9);
    expect(b.time / a.time).toBeLessThan(1.1);
    expect(b.harmony).toBeGreaterThan(a.harmony - 1);
  });

  it('Baumarten: jede erreicht den Hain innerhalb ±10 % der Eiche, Harmonie ±8 Punkte', () => {
    const oak = stageStats(harmonyOf(trees.oak), HAIN);
    for (const [id, s] of Object.entries(trees)) {
      const st = stageStats(harmonyOf(s), HAIN);
      expect(st.time / oak.time, id).toBeGreaterThan(0.9);
      expect(st.time / oak.time, id).toBeLessThan(1.1);
      expect(Math.abs(st.harmony - oak.harmony), id).toBeLessThan(8);
    }
  });
});
