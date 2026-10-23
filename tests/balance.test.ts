import { describe, expect, it } from 'vitest';
import {
  GROWTH,
  HARMONY,
  RANDOM,
  STAGE_TARGETS,
  STRATEGIES,
  careTable,
  decisionStats,
  earlyStats,
  extrasTable,
  monteCarlo,
  report,
  runGame,
  stageStats,
  varietyBefore,
  varietyStats,
  type Summary,
} from '../scripts/simulate';
import { EVENTS } from '../src/content/events';
import { VISITORS } from '../src/content/visitors';
import { RESEARCH } from '../src/content/research';
import { CARE_RUNS, FULL, HAIN, MAX_SECONDS, RUNS, URWALD, WALD } from './balance-setup';
import { firstCycle, firstCycleTarget } from './balance-runs';

/**
 * Balancing des v2-Spiels mit der echten Spiellogik und ALLEN Systemen: Tiere, Pflanzen,
 * Pflege, Ereignisse, Gäste, Jahreszeiten (scripts/simulate.ts, DESIGN_V2.md 15.4, Stand
 * Schritt 2.10). Die Grenzen sind großzügig genug für die wenigen Durchgänge im Check;
 * genaue Zahlen liefert der große Lauf.
 *
 * Im Check: Harmonie-Spieler bis zum Urwald, Wachstums- und Zufallsspieler bis zum Wald,
 * alle übrigen bis zum Hain.
 * Großer Lauf (alle bis Urwald, Tabellen):   npm run balance
 */
const MAIN = [HARMONY, GROWTH, RANDOM];
const options = { maxSeconds: MAX_SECONDS, care: true };
// Wie weit gespielt wird: im Check nur so weit, wie die Prüfungen schauen (Laufzeit;
// firstCycleTarget). Die Durchgänge teilt sich die Datei mit „Pflegemaßnahmen“ (unten).
const summaries = STRATEGIES.map((s) => firstCycle(s, RUNS, firstCycleTarget(s)));
const main = summaries.filter((s) => MAIN.includes(s.strategy));
const byId = (id: string) => summaries.find((s) => s.strategy.id === id)!;
const harmony = byId(HARMONY.id);

describe('Balancing v2 (echte Logik, alle Systeme)', () => {
  it('Protokoll', () => {
    if (FULL) console.log(report(summaries, HAIN));
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
    const a = runGame(HARMONY, { seed: 5, targetStage: HAIN, ...options });
    const b = runGame(HARMONY, { seed: 5, targetStage: HAIN, ...options });
    expect(b).toEqual(a);
  });

  it('Stufenzeiten des Harmonie-Spielers: 0,8–1,25 × Ziel (Keimling < 30 s), Hain 55–65 min (Check 52–68)', () => {
    for (const t of STAGE_TARGETS) {
      const st = stageStats(harmony, t.stage);
      if (st.reachedShare < 1) continue; // Urwald nur im großen Lauf
      if (t.stage === 1) {
        expect(st.time, 'Keimling').toBeLessThan(t.seconds);
        continue;
      }
      expect(st.time, `Stufe ${t.stage} (${t.label})`).toBeGreaterThan(0.8 * t.seconds);
      expect(st.time, `Stufe ${t.stage} (${t.label})`).toBeLessThan(1.25 * t.seconds);
    }
    // Ziel 55–65 min (großer Lauf). Im Check (wenige Durchgänge, feste Seeds) schwankt der
    // Median je nach Seed-Startwert um gut ±1 min (z. B. 65,5 min) – dort 52–68 min.
    const hain = stageStats(harmony, HAIN).time;
    expect(hain).toBeGreaterThan((FULL ? 55 : 52) * 60);
    expect(hain).toBeLessThan((FULL ? 65 : 68) * 60);
  });

  it('erste Minuten: Setzling nach etwa 45 s (40–50 s, mit Frühlingsbonus)', () => {
    for (const s of [harmony, byId(GROWTH.id)]) {
      const sapling = stageStats(s, 2).time;
      expect(sapling, s.strategy.name).toBeGreaterThan(40);
      expect(sapling, s.strategy.name).toBeLessThan(50);
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

  it('Harmonie-Strategie hat die höchste Harmonie beim Hain (großer Lauf: ≥ 1 Punkt Vorsprung, Check: niemand ≥ 5 vorn)', () => {
    // Ziel (großer Lauf): mindestens 1 Punkt vor jeder anderen Strategie. „Bodenleben
    // stapeln“ liegt nur ~2 Punkte dahinter (500 Durchgänge: 106,7 gegen 104,8); mit 40
    // Durchgängen schwankt der Abstand je Seed-Fenster stark (8 Fenster: vor dem Playtest
    // „frühes Spiel“ −2,9 bis +4,9, danach −3,8 bis +3,3 Punkte). Im Check darum nur: keine
    // Strategie liegt deutlich (5 Punkte) vor dem Harmonie-Spieler.
    const best = stageStats(harmony, HAIN).harmony;
    for (const s of summaries.filter((x) => x !== harmony)) {
      expect(stageStats(s, HAIN).harmony, s.strategy.name).toBeLessThan(FULL ? best - 1 : best + 5);
    }
  });

  it('kein Gattungs-Stapeln dominiert: nie mehr als 10 % schneller, nie deutlich schneller UND so harmonisch', () => {
    const ref = stageStats(harmony, HAIN);
    for (const s of summaries.filter((x) => x.strategy.id.startsWith('stack-'))) {
      const st = stageStats(s, HAIN);
      expect(st.time, s.strategy.name).toBeGreaterThan(0.9 * ref.time);
      expect(st.time < 0.95 * ref.time && st.harmony >= ref.harmony, s.strategy.name).toBe(false);
    }
  });

  it('Wachstums-Streben: schneller, aber höchstens ~15 %, mit spürbar weniger Harmonie', () => {
    const g = stageStats(byId(GROWTH.id), HAIN);
    const h = stageStats(harmony, HAIN);
    expect(g.time).toBeLessThan(h.time);
    expect(g.time).toBeGreaterThan(0.85 * h.time);
    expect(g.harmony).toBeLessThan(h.harmony - 3);
    // Ziel ≥ 0,85 × Harmonie (großer Lauf); im Check seed-abhängig bis 0,83 – dort ≥ 0,80.
    expect(g.harmony).toBeGreaterThan((FULL ? 0.85 : 0.8) * h.harmony);
  });

  it('die Aussaat ist eine Samen-Senke: jede Strategie sät bis zum Hain, bewertende auch zum Tauschen', () => {
    for (const s of summaries) {
      const st = stageStats(s, HAIN);
      expect(st.plants, s.strategy.name).toBeGreaterThanOrEqual(4);
      // Aussaaten bis zum Hain: mindestens den Ring gefüllt (5 Plätze im Alten Baum).
      expect(st.counts.plantsBought, s.strategy.name).toBeGreaterThanOrEqual(4);
      expect(st.counts.plantEncounters, s.strategy.name).toBeGreaterThan(4);
      expect(st.spentPlants, s.strategy.name).toBeGreaterThan(0);
    }
    // Ziel 27.11: 8–15 Aussaaten bis zum Hain, davon ≥ 2 Tausch (Check: Harmonie 13,6, Wachstum 12,5).
    for (const s of [harmony, byId(GROWTH.id)]) {
      const st = stageStats(s, HAIN);
      expect(st.counts.plantsBought, s.strategy.name).toBeGreaterThan(8);
      expect(st.counts.plantsBought, s.strategy.name).toBeLessThan(18);
    }
    expect(stageStats(harmony, HAIN).supply).toBeGreaterThan(0.9);
  });

  it('Begegnungs-Vielfalt bis zum Hain (Playtest-Befund, DESIGN_V2.md 7.7)', () => {
    for (const s of summaries) {
      const v = varietyBefore(s, HAIN);
      expect(v.sameShare, s.strategy.name).toBeLessThan(0.05);
      expect(v.rerollOpenShare, s.strategy.name).toBeGreaterThan(0.75);
      expect(v.fewCardsShare, s.strategy.name).toBeLessThan(0.05);
    }
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
      expect(st.communityHarmony, s.strategy.name).toBeLessThan(0.25 * st.harmony);
    }
    expect(h.communityHarmony).toBeGreaterThan(stageStats(byId(RANDOM.id), HAIN).communityHarmony);
  });

  it('es gibt echte Wahlen, aber nicht nur', () => {
    const d = decisionStats(byId(RANDOM.id), HAIN);
    expect(d.realShare).toBeGreaterThan(0.3);
    expect(d.realShare).toBeLessThan(0.98);
  });
});

/**
 * Frühes Spiel (Playtest-Befund „zäher Abschnitt 2:30–4:20“, DESIGN_V2.md 8 und 15.4):
 * In den ersten sechs Minuten soll es etwa alle 30–60 s etwas zu tun geben, und Samen
 * haben schon im Setzling einen Zweck (kleine Pflege-Ränge ab Setzling). Kennzahlen aus
 * scripts/simulate.ts (earlyStats): längste Pause ohne Entscheidung (Begegnung, Pflanze,
 * Pflege) und der höchste Samenbestand vor dem Jungen Baum. Ziele gelten im großen Lauf;
 * im Check (40 Durchgänge, feste Seeds) mit Abstand, in 8 Seed-Fenstern geprüft.
 */
describe('Frühes Spiel: Takt der Entscheidungen und Samen mit Zweck', () => {
  it('Harmonie- und Wachstums-Spieler: längste Pause in den ersten 6 min im Median ≤ 75 s (Check 85 s)', () => {
    for (const s of [harmony, byId(GROWTH.id)]) {
      const e = earlyStats(s, 360);
      expect(e.pauseMedian, s.strategy.name).toBeLessThan((FULL ? 75 : 85));
      expect(e.pauseP90, s.strategy.name).toBeLessThan((FULL ? 95 : 110));
    }
  });

  it('jede Strategie: längste Pause in den ersten 6 min im Median unter 2 min', () => {
    for (const s of summaries) expect(earlyStats(s, 360).pauseMedian, s.strategy.name).toBeLessThan((FULL ? 105 : 120));
  });

  it('die ersten 10 min werden nicht zäher (Harmonie-Spieler: Median ≤ 2:15 min, Check 2:30)', () => {
    expect(earlyStats(harmony).pauseMedian).toBeLessThan((FULL ? 135 : 150));
  });

  it('Samen stapeln sich vor dem Jungen Baum nicht (Höchststand im Mittel < 250 🌰, Check 260)', () => {
    // Bis v16 kosteten Kompost und Laub 200 🌰; in 2a (Forschung mit ⚖️) vorübergehend < 400
    // (Check: Harmonie-Spieler ~313 🌰). Seit der Aussaat (Phase 10, 2b) ist sie die Senke:
    // Check Harmonie-Spieler 255, Wachstums-Spieler 227 🌰 – wieder unter der alten Grenze.
    for (const s of [harmony, byId(GROWTH.id)]) expect(earlyStats(s).seedPeak, s.strategy.name).toBeLessThan(FULL ? 250 : 260);
  });
});

describe('Wirtschaft (Samen-Senke, Neu würfeln, Bewirten)', () => {
  it('Samenbestand beim Hain unter 10 Minuten Produktion, Forschung wird gekauft', () => {
    // Bis v16 war die Pflege die Samen-Senke (< 10 min); in 2a (Forschung mit ⚖️) vorübergehend
    // < 45 min (~36 min, DESIGN_V2.md 27.10). Seit der Aussaat (Phase 10, 2b) mit Tausch im vollen
    // Ring wieder darunter (Check: Harmonie-Spieler 8,8, Wachstums-Spieler 5,1 min; 13–14 bzw.
    // ~12,5 Aussaaten bis zum Hain). Ziel 27.11 ≤ 15 min; Phase 10, 3a misst mit 500 Durchgängen.
    for (const s of [harmony, byId(GROWTH.id)]) {
      const st = stageStats(s, HAIN);
      expect(st.seeds / st.seedsRate / 60, s.strategy.name).toBeLessThan(10);
      expect(st.spentCare, s.strategy.name).toBeGreaterThan(0);
    }
  });

  it('Neu würfeln ist bezahlbar: bis zum Hain fast nie „zu teuer“', () => {
    for (const s of summaries) expect(rerollTooExpensiveBefore(s, HAIN), s.strategy.name).toBeLessThan(0.05);
  });

  it('Bewirten ist bezahlbar: der Harmonie-Spieler kann fast jeden Gast bewirten', () => {
    const guests = harmony.runs.flatMap((r) => r.variety.filter((v) => v.type === 'visitor'));
    expect(guests.length).toBeGreaterThan(0);
    expect(guests.filter((v) => v.worthwhile).length / guests.length).toBeGreaterThan(0.8);
  });
});

/** Anteil der Kartenbegegnungen vor `beforeStage`, bei denen Neu würfeln zu teuer war. */
function rerollTooExpensiveBefore(s: Summary, beforeStage: number): number {
  const vs = s.runs.flatMap((r) => r.variety.filter((v) => v.stage < beforeStage && v.type === 'animal'));
  return vs.filter((v) => v.rerollBlocked === 'too-expensive').length / Math.max(1, vs.length);
}

/**
 * Ereignisse und Durchreisende (echte Logik seit 2.4): Inhalte und Takt (Gewichte +
 * Zwischenhalt, encounters.ts) erreichen ihr Ziel – kurze Durststrecken nach dem Hain,
 * Ereignisse und Gäste kommen wirklich.
 */
describe('Ereignisse und Durchreisende', () => {
  it('Protokoll', () => {
    if (FULL) console.log(extrasTable(main));
    expect(main.length).toBe(MAIN.length);
  });

  it('ohne NaN und ohne negative Samen', () => {
    for (const s of summaries) for (const r of s.runs) expect(Number.isFinite(r.final.seeds) && r.final.seeds >= 0).toBe(true);
  });

  it('es kommen Ereignisse und Gäste – aber nie mehr, als es gibt', () => {
    for (const r of harmony.runs) {
      expect(r.final.counts.events).toBeLessThanOrEqual(EVENTS.length);
      expect(r.final.counts.visitors).toBeLessThanOrEqual(VISITORS.length);
    }
    const c = harmony.runs.map((r) => r.final.counts);
    expect(c.reduce((sum, x) => sum + x.events, 0) / c.length).toBeGreaterThan(4);
    expect(c.reduce((sum, x) => sum + x.visitors, 0) / c.length).toBeGreaterThan(3);
    expect(c.reduce((sum, x) => sum + x.hosted, 0)).toBeGreaterThan(0.5 * c.reduce((sum, x) => sum + x.visitors, 0));
  });

  it('Durststrecken nach dem Hain bleiben kurz (Harmonie-Spieler: Median < 9 min, 90 % < 11 min)', () => {
    // Ziel DESIGN_V2.md 7.2: 90-%-Quantil < 11 min (großer Lauf). Mit den wenigen Durchgängen
    // im Check schwankt das Quantil um ±1,5 min – dort zählt der stabile Median, das Quantil
    // bekommt Spielraum (Idee aus claude/v2-tests-schneller).
    for (const stage of [HAIN, WALD]) {
      const v = varietyStats(harmony, stage);
      expect(v.droughtMedian, `Stufe ${stage}`).toBeLessThan(9 * 60);
      expect(v.droughtP90, `Stufe ${stage}`).toBeLessThan((FULL ? 11 : 12.5) * 60);
    }
  });
});

/**
 * Pflegemaßnahmen (Schritt 2.7, echte Logik): die Samen-Senke. Verglichen werden dieselben
 * Durchgänge (gleiche Seeds) mit und ohne Pflege, jeweils mit Ereignissen, Gästen und
 * Jahreszeiten.
 *
 * Bis Phase 6 eine eigene Datei (balance-care.test.ts). Die Durchgänge mit Pflege sind
 * dieselben wie oben (gleiche Seeds und Optionen, nur bis zum Wald) – darum hier, damit sie
 * nur einmal gerechnet werden (tests/balance-runs.ts). Im Check nur CARE_RUNS Durchgänge bis
 * zum Wald; der große Lauf (npm run balance) bis zum Urwald.
 */
describe('Pflegemaßnahmen', () => {
  const careStrategies = [HARMONY, GROWTH, RANDOM];
  const options = { targetStage: FULL ? URWALD : WALD, maxSeconds: MAX_SECONDS };
  // Ohne Pflege brauchen die Prüfungen nur die bewertenden Strategien; alle drei nur fürs Protokoll.
  const without = monteCarlo(FULL ? careStrategies : [HARMONY, GROWTH], CARE_RUNS, options);
  const withCare = careStrategies.map((s) => firstCycle(s, CARE_RUNS, options.targetStage));
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

  it('Forschung kostet ⚖️, die Aussaat ist die Samen-Senke: Reserve beim Hain < 10, im Wald < 12 min (bewertende Strategien)', () => {
    for (const id of [HARMONY.id, GROWTH.id]) {
      for (const stage of [HAIN, WALD]) {
        const before = stageStats(find(without, id), stage);
        const after = stageStats(find(withCare, id), stage);
        // Bestand in Minuten Produktion: höchstens halb so groß wie ohne Pflege; beim Hain unter
        // 10 min (Ziel 2.10), im Wald unter 12 min – dort wird auf die Wald-Ränge
        // (30.000–45.000 🌰) gespart, die erst mit dem Wald kaufbar werden. Von Wetter und Nacht
        // (DESIGN_V2.md 21.10: 14,6 min) bis zu den Lebensräumen galten 15 min; seit den
        // Lebensräumen (Samen-Senke ab Junger Baum, 23.10) wieder 12 min. Gemessen (Phase 6,
        // DESIGN_V2.md 15.4 „Stand Balancing Phase 6“): Harmonie-Spieler im Wald 7,2 / 7,6 /
        // 8,3 min in drei Seed-Fenstern à 30 Durchgänge (Check-Fenster 7,2), großer Lauf siehe dort.
        //
        // Seit v17 (Phase 10, 2a) kostet die Forschung ⚖️ statt 🌰: Sie senkt die Reserve nicht
        // mehr (darum kein „halb so groß“), die Senke ist seit 2b die Aussaat – mit und ohne
        // Forschung. Check: Harmonie-Spieler Hain 8,8 / Wald 9,0 min (ohne Forschung 8,0 / 12,7),
        // Wachstums-Spieler 5,1 / 9,3 (5,9 / 8,8). Ziel 27.11 ≤ 15 min; Messung Phase 10, 3a.
        const minutes = (st: typeof before) => st.seeds / st.seedsRate / 60;
        expect(minutes(after), `${id}, Stufe ${stage}`).toBeLessThan(1.25 * minutes(before));
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
    const different = RESEARCH.filter((c) => Math.abs(ranksAt(HARMONY.id, c.id) - ranksAt(GROWTH.id, c.id)) >= 0.3);
    expect(different.length).toBeGreaterThanOrEqual(2);
    // Die Kronen schließen sich aus: Beide kommen vor (je Strategie oder über die Strategien).
    const crowns = ['light-crown', 'dense-crown'].map((m) => careStrategies.reduce((sum, s) => sum + ranksAt(s.id, m), 0));
    for (const c of crowns) expect(c).toBeGreaterThan(0.1);
  });
});
