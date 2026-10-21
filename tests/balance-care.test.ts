import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, STAGE_TARGETS, careTable, monteCarlo, runGame, stageStats } from '../scripts/simulate';
import { CARE } from '../src/content/care';
import { FULL, HAIN, MAX_SECONDS, MODEL_RUNS, URWALD, env } from './balance-setup';

const RUNS = MODEL_RUNS;

/**
 * Pflegemaßnahmen (Schritt 2.7, Modell scripts/extras.ts): die Samen-Senke. Verglichen
 * wird mit Ereignissen und Gästen (Stand 2.4) – einmal ohne, einmal mit Pflege.
 */
describe('Pflegemaßnahmen (Modell)', () => {
  // Geprüft werden Harmonie und Wachstum; der Zufall nur für die Tabellen (npm run balance).
  const careStrategies = FULL ? [HARMONY, GROWTH, RANDOM] : [HARMONY, GROWTH];
  const options = { targetStage: URWALD, maxSeconds: MAX_SECONDS, events: true };
  const without = monteCarlo(careStrategies, RUNS, options);
  const withCare = monteCarlo(careStrategies, RUNS, { ...options, care: true });
  const find = (list: typeof without, id: string) => list.find((s) => s.strategy.id === id)!;
  const WALD = HAIN + 1;

  it('Protokoll', () => {
    if (env.SIM_LOG) console.log(careTable(without, withCare));
    expect(withCare.length).toBe(careStrategies.length);
  });

  it('ist deterministisch und ohne negative Samen', () => {
    const a = runGame(HARMONY, { seed: 11, ...options, care: true });
    expect(runGame(HARMONY, { seed: 11, ...options, care: true })).toEqual(a);
    for (const s of withCare) for (const r of s.runs) expect(r.final.seeds).toBeGreaterThanOrEqual(0);
  });

  it('senkt die Samenreserve beim Hain und im Wald deutlich (bewertende Strategien)', () => {
    for (const id of [HARMONY.id, GROWTH.id]) {
      for (const stage of [HAIN, WALD]) {
        const before = stageStats(find(without, id), stage);
        const after = stageStats(find(withCare, id), stage);
        // Bestand in Minuten Produktion: höchstens halb so groß wie ohne Pflege, unter 10 min.
        const minutes = (st: typeof before) => st.seeds / st.seedsRate / 60;
        expect(minutes(after), `${id}, Stufe ${stage}`).toBeLessThan(0.5 * minutes(before));
        expect(minutes(after), `${id}, Stufe ${stage}`).toBeLessThan(10);
        expect(after.spentCare, `${id}, Stufe ${stage}`).toBeGreaterThan(0);
      }
    }
  });

  it('Hain-Tempo bleibt im Korridor, Pflege ist kein großer Sprung', () => {
    const hain = STAGE_TARGETS.find((t) => t.stage === HAIN)!;
    const time = stageStats(find(withCare, HARMONY.id), HAIN).time;
    expect(time).toBeGreaterThan(0.7 * hain.seconds);
    expect(time).toBeLessThan(1.3 * hain.seconds);
    for (const id of [HARMONY.id, GROWTH.id]) {
      expect(stageStats(find(withCare, id), HAIN).time, id).toBeGreaterThan(0.9 * stageStats(find(without, id), HAIN).time);
    }
  });

  it('kein Pflichtkauf: Harmonie- und Wachstums-Spieler setzen andere Schwerpunkte', () => {
    const ranksAt = (id: string, measure: string) =>
      find(withCare, id).runs.reduce((sum, r) => sum + (r.stages[HAIN]?.careRanks[measure] ?? 0), 0) / RUNS;
    const different = CARE.filter((c) => Math.abs(ranksAt(HARMONY.id, c.id) - ranksAt(GROWTH.id, c.id)) >= 0.3);
    expect(different.length).toBeGreaterThanOrEqual(2);
    // Die Kronen schließen sich aus: Beide kommen vor (je Strategie oder über die Strategien).
    const crowns = ['light-crown', 'dense-crown'].map((m) => careStrategies.reduce((sum, s) => sum + ranksAt(s.id, m), 0));
    for (const c of crowns) expect(c).toBeGreaterThan(0.1);
  });
});
