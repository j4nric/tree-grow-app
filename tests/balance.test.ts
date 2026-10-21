import { describe, expect, it } from 'vitest';
import {
  GROWTH,
  HARMONY,
  RANDOM,
  STAGE_TARGETS,
  STRATEGIES,
  decisionStats,
  careTable,
  extrasTable,
  monteCarlo,
  report,
  runGame,
  stageStats,
  varietyBefore,
  varietyStats,
} from '../scripts/simulate';
import { CARE } from '../src/content/care';
import { EVENTS } from '../src/content/events';
import { VISITORS } from '../src/content/visitors';

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

  it('Begegnungs-Vielfalt bis zum Hain (Playtest-Befund, DESIGN_V2.md 7.7)', () => {
    for (const s of summaries) {
      const v = varietyBefore(s, HAIN);
      // Kaum identische Folge-Sets (Ziel < 10 %, gemessen ~0,5 %).
      expect(v.sameShare, s.strategy.name).toBeLessThan(0.05);
      // Neu würfeln ist fast immer möglich (Ziel > 70 %; gesperrt nur im Keimling).
      expect(v.rerollOpenShare, s.strategy.name).toBeGreaterThan(0.75);
      // Ab Setzling (fast) immer drei Karten.
      expect(v.fewCardsShare, s.strategy.name).toBeLessThan(0.05);
    }
    // Harmonie-Spieler: längste Strecke ohne lohnende Karte (Ziel < 15 min, gemessen ~8:40 min im 90-%-Quantil).
    const h = varietyBefore(harmony, HAIN);
    expect(h.droughtMedian).toBeLessThan(10 * 60);
    expect(h.droughtP90).toBeLessThan(15 * 60);
    expect(h.worthShare).toBeGreaterThan(0.8);
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

/**
 * Ereignisse und Durchreisende (Schritt 2.4): Die Logik fehlt noch in src/core/ – der
 * Simulator modelliert sie grob (scripts/extras.ts, DESIGN_V2.md 15.4). Geprüft wird,
 * ob die Inhalte und der Takt (Gewichte + Zwischenhalt, encounters.ts) ihr Ziel
 * erreichen: kürzere Durststrecken nach dem Hain, Tempo bis zum Hain im Korridor.
 */
describe('Ereignisse und Durchreisende (Modell)', () => {
  const extraStrategies = [HARMONY, GROWTH, RANDOM];
  const options = { targetStage: URWALD, maxSeconds: 6 * 3600, events: true };
  const withExtras = monteCarlo(extraStrategies, RUNS, options);
  const harmonyExtras = withExtras.find((s) => s.strategy.id === HARMONY.id)!;
  const WALD = 6;

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

  it('Durststrecken nach dem Hain werden kürzer (Harmonie-Spieler, 90-%-Quantil)', () => {
    for (const stage of [HAIN, WALD]) {
      const before = varietyStats(harmony, stage).droughtP90;
      const after = varietyStats(harmonyExtras, stage).droughtP90;
      expect(after, `Stufe ${stage}`).toBeLessThan(before);
    }
    expect(varietyStats(harmonyExtras, WALD).droughtP90).toBeLessThan(11 * 60);
  });
});

/**
 * Pflegemaßnahmen (Schritt 2.7, Modell scripts/extras.ts): die Samen-Senke. Verglichen
 * wird mit Ereignissen und Gästen (Stand 2.4) – einmal ohne, einmal mit Pflege.
 */
describe('Pflegemaßnahmen (Modell)', () => {
  const careStrategies = [HARMONY, GROWTH, RANDOM];
  const options = { targetStage: URWALD, maxSeconds: 6 * 3600, events: true };
  const without = monteCarlo(careStrategies, RUNS, options);
  const withCare = monteCarlo(careStrategies, RUNS, { ...options, care: true });
  const find = (list: typeof without, id: string) => list.find((s) => s.strategy.id === id)!;
  const WALD = 6;

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
