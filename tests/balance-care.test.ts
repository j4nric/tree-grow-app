import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, STAGE_TARGETS, careTable, monteCarlo, runGame, stageStats } from '../scripts/simulate';
import { CARE } from '../src/content/care';
import { CARE_RUNS, FULL, HAIN, MAX_SECONDS, URWALD, WALD } from './balance-setup';

/**
 * Pflegemaßnahmen (Schritt 2.7, echte Logik): die Samen-Senke. Verglichen werden dieselben
 * Durchgänge (gleiche Seeds) mit und ohne Pflege, jeweils mit Ereignissen, Gästen und
 * Jahreszeiten.
 *
 * Eigene Datei, damit Vitest sie parallel zu balance.test.ts rechnet. Im Check nur
 * CARE_RUNS Durchgänge bis zum Wald; der große Lauf (npm run balance) bis zum Urwald.
 */
describe('Pflegemaßnahmen', () => {
  const careStrategies = [HARMONY, GROWTH, RANDOM];
  const options = { targetStage: FULL ? URWALD : WALD, maxSeconds: MAX_SECONDS };
  // Ohne Pflege brauchen die Prüfungen nur die bewertenden Strategien; alle drei nur fürs Protokoll.
  const without = monteCarlo(FULL ? careStrategies : [HARMONY, GROWTH], CARE_RUNS, options);
  const withCare = monteCarlo(careStrategies, CARE_RUNS, { ...options, care: true });
  const find = (list: typeof without, id: string) => list.find((s) => s.strategy.id === id)!;

  it('Protokoll', () => {
    if (FULL) console.log(careTable(without, withCare));
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
        // Bestand in Minuten Produktion: höchstens halb so groß wie ohne Pflege; beim Hain unter
        // 10 min (Ziel 2.10), im Wald unter 12 min – dort wird auf die Wald-Ränge
        // (30.000–45.000 🌰) gespart, die erst mit dem Wald kaufbar werden.
        const minutes = (st: typeof before) => st.seeds / st.seedsRate / 60;
        expect(minutes(after), `${id}, Stufe ${stage}`).toBeLessThan(0.5 * minutes(before));
        expect(minutes(after), `${id}, Stufe ${stage}`).toBeLessThan(stage === HAIN ? 10 : 12);
        expect(after.spentCare, `${id}, Stufe ${stage}`).toBeGreaterThan(0);
      }
    }
  });

  it('Hain-Tempo bleibt im Korridor, Pflege ist kein großer Sprung', () => {
    const hain = STAGE_TARGETS.find((t) => t.stage === HAIN)!;
    const time = stageStats(find(withCare, HARMONY.id), HAIN).time;
    expect(time).toBeGreaterThan(0.8 * hain.seconds);
    expect(time).toBeLessThan(1.25 * hain.seconds);
    for (const id of [HARMONY.id, GROWTH.id]) {
      expect(stageStats(find(withCare, id), HAIN).time, id).toBeGreaterThan(0.9 * stageStats(find(without, id), HAIN).time);
    }
  });

  it('kein Pflichtkauf: Harmonie- und Wachstums-Spieler setzen andere Schwerpunkte', () => {
    const ranksAt = (id: string, measure: string) =>
      find(withCare, id).runs.reduce((sum, r) => sum + (r.stages[HAIN]?.careRanks[measure] ?? 0), 0) / CARE_RUNS;
    const different = CARE.filter((c) => Math.abs(ranksAt(HARMONY.id, c.id) - ranksAt(GROWTH.id, c.id)) >= 0.3);
    expect(different.length).toBeGreaterThanOrEqual(2);
    // Die Kronen schließen sich aus: Beide kommen vor (je Strategie oder über die Strategien).
    const crowns = ['light-crown', 'dense-crown'].map((m) => careStrategies.reduce((sum, s) => sum + ranksAt(s.id, m), 0));
    for (const c of crowns) expect(c).toBeGreaterThan(0.1);
  });
});
