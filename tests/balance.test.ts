import { describe, expect, it } from 'vitest';
import {
  GROWTH,
  HARMONY,
  RANDOM,
  STAGE_TARGETS,
  STRATEGIES,
  decisionStats,
  monteCarlo,
  report,
  runGame,
  stageStats,
} from '../scripts/simulate';

/**
 * Balancing des v2-Spiels (Tiere und Pflanzen) mit der echten Spiellogik
 * (scripts/simulate.ts, DESIGN_V2.md 15.4). Die Grenzen sind bewusst großzügig: Der Test
 * soll grobe Fehlentwicklungen zeigen, nicht einzelne Zahlen festnageln.
 *
 * Tabellen im Protokoll:   SIM_LOG=1 npx vitest run tests/balance.test.ts
 * Mehr Durchgänge (Doku):  SIM_LOG=1 SIM_RUNS=500 npx vitest run tests/balance.test.ts
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUNS = Number(env.SIM_RUNS ?? 100);
const HAIN = 5;
const URWALD = 7;

const summaries = monteCarlo(STRATEGIES, RUNS, { targetStage: URWALD, maxSeconds: 6 * 3600 });
const byId = (id: string) => summaries.find((s) => s.strategy.id === id)!;
const harmony = byId(HARMONY.id);

describe('Balancing v2 (echte Logik)', () => {
  it('Protokoll', () => {
    if (env.SIM_LOG) console.log(report(summaries, HAIN));
    expect(summaries.length).toBe(STRATEGIES.length);
  });

  it('alle Strategien erreichen den Hain, ohne NaN', () => {
    for (const s of summaries) {
      expect(stageStats(s, HAIN).reachedShare, s.strategy.name).toBe(1);
      for (const r of s.runs) {
        expect(Number.isFinite(r.final.harmony) && Number.isFinite(r.final.seeds), s.strategy.name).toBe(true);
      }
    }
  });

  it('ist deterministisch: gleicher Seed, gleiches Ergebnis', () => {
    const a = runGame(HARMONY, { seed: 5, targetStage: HAIN, maxSeconds: 3 * 3600 });
    const b = runGame(HARMONY, { seed: 5, targetStage: HAIN, maxSeconds: 3 * 3600 });
    expect(b).toEqual(a);
  });

  it('Zeit bis zu den Stufen liegt im Zielkorridor (Harmonie-Spieler, eher etwas darüber)', () => {
    for (const t of STAGE_TARGETS) {
      const time = stageStats(harmony, t.stage).time;
      // Keimling: nur Obergrenze. Sonst 0,7 – 1,35 × Ziel (lieber etwas langsamer).
      if (t.stage > 1) expect(time, `Stufe ${t.stage} (${t.label})`).toBeGreaterThan(0.7 * t.seconds);
      expect(time, `Stufe ${t.stage} (${t.label})`).toBeLessThan((t.stage === 1 ? 1 : 1.35) * t.seconds);
    }
  });

  it('Begegnungstakt bis zum Hain: früh < 1 min, danach im Median höchstens 8 min, nie über 15 min', () => {
    expect(stageStats(harmony, 1).gapMedian).toBeLessThan(60);
    for (let stage = 1; stage < HAIN; stage++) {
      const st = stageStats(harmony, stage);
      expect(st.gapMedian, `Stufe ${stage}`).toBeGreaterThan(10);
      expect(st.gapMedian, `Stufe ${stage}`).toBeLessThan(8 * 60);
      expect(st.gapMax, `Stufe ${stage}`).toBeLessThan(15 * 60);
    }
  });

  it('Harmonie-Strategie hat die höchste Harmonie beim Hain (mindestens 1 Punkt Vorsprung)', () => {
    // Seit Schritt 2.2 (32 Arten) liegt das Harmonie-Streben wieder klar vorn; mit den
    // Lebensgemeinschaften (2.3) ~4 Punkte vor dem besten Stapler (DESIGN_V2.md 15.4).
    const best = stageStats(harmony, HAIN).harmony;
    for (const s of summaries.filter((x) => x !== harmony)) {
      expect(stageStats(s, HAIN).harmony, s.strategy.name).toBeLessThan(best - 1);
    }
    // Zufall ist spürbar schlechter als bewusstes Spiel.
    expect(stageStats(byId(RANDOM.id), HAIN).harmony).toBeLessThan(best - 1);
  });

  it('kein Gattungs-Stapeln dominiert klar (deutlich schneller UND mindestens so harmonisch)', () => {
    const ref = stageStats(harmony, HAIN);
    for (const s of summaries.filter((x) => x.strategy.id.startsWith('stack-'))) {
      const st = stageStats(s, HAIN);
      const muchFaster = st.time < 0.9 * ref.time;
      expect(muchFaster && st.harmony >= ref.harmony, s.strategy.name).toBe(false);
    }
  });

  it('kein Gattungs-Stapeln ist mehr als 10 % schneller als das Harmonie-Streben (Pilze!)', () => {
    const ref = stageStats(harmony, HAIN);
    for (const s of summaries.filter((x) => x.strategy.id.startsWith('stack-'))) {
      expect(stageStats(s, HAIN).time, s.strategy.name).toBeGreaterThan(0.9 * ref.time);
    }
  });

  it('Wachstums-Streben ist schneller, aber nicht übermächtig', () => {
    const g = stageStats(byId(GROWTH.id), HAIN);
    const h = stageStats(harmony, HAIN);
    expect(g.time).toBeLessThanOrEqual(h.time * 1.02);
    expect(g.time).toBeGreaterThan(h.time * 0.75);
    expect(g.harmony).toBeGreaterThan(h.harmony * 0.85);
  });

  it('Pflanzen sind die Samen-Senke: jede Strategie setzt und pflanzt bis zum Hain', () => {
    for (const s of summaries) {
      const st = stageStats(s, HAIN);
      expect(st.plants, s.strategy.name).toBeGreaterThanOrEqual(4);
      expect(st.counts.plantsBought, s.strategy.name).toBeGreaterThan(1);
      expect(st.counts.plantEncounters, s.strategy.name).toBeGreaterThan(2);
      expect(st.spentPlants, s.strategy.name).toBeGreaterThan(0);
    }
    // Der Harmonie-Spieler hält die Pflanzen gut versorgt.
    expect(stageStats(harmony, HAIN).supply).toBeGreaterThan(0.9);
  });

  it('Lebensgemeinschaften: der Harmonie-Spieler findet welche, sie dominieren die Harmonie aber nicht', () => {
    const h = stageStats(harmony, HAIN);
    expect(h.communities).toBeGreaterThan(0.5);
    expect(h.discovered).toBeGreaterThanOrEqual(h.communities);
    for (const s of summaries) {
      const st = stageStats(s, HAIN);
      // Höchstens ein Viertel der Harmonie stammt aus Lebensgemeinschaften.
      expect(st.communityHarmony, s.strategy.name).toBeLessThan(0.25 * st.harmony);
    }
    // Bewusstes Spiel findet mehr als Zufall.
    expect(h.communityHarmony).toBeGreaterThan(stageStats(byId(RANDOM.id), HAIN).communityHarmony);
  });

  it('es gibt echte Wahlen, aber nicht nur', () => {
    const d = decisionStats(byId(RANDOM.id), HAIN);
    expect(d.realShare).toBeGreaterThan(0.3);
    expect(d.realShare).toBeLessThan(0.98);
  });
});
