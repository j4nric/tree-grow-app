import { describe, expect, it } from 'vitest';
import { GOAL, GROWTH, HARMONY, formatTime, mean, monteCarlo, stageStats, type Summary } from '../scripts/simulate';
import { FULL, HAIN, MAX_SECONDS, RUNS, URWALD, WALD } from './balance-setup';

/**
 * Ausbau gegen „ohne Ausbau“ (Phase 11, 3a; DESIGN_V2.md 28.10): gleiche Seeds, alle Systeme mit
 * Forschung, einmal mit und einmal ohne Ausbau. Ziele: Hain 50–58 min, Urwald 2:00–2:13 h
 * (Harmonie), Wachstum ÷ Harmonie ≥ 0,85, H am Hain ±3 und in Wald/Urwald ±5 gegenüber ohne
 * Ausbau, Gedächtnis-Vorsprung Harmonie − Wachstum am Hain ≥ 15.
 *
 * Nur im großen Lauf (npm run balance; höchstens CMP_RUNS_MAX Durchgänge je Fall) – im Check
 * prüfen tests/balance.test.ts (Takt, Samen-Senke) und die Inhaltstests den Ausbau.
 */
const CMP_RUNS_MAX = 200;
const runs = Math.min(RUNS, CMP_RUNS_MAX);
const options = { targetStage: URWALD, maxSeconds: MAX_SECONDS, care: true };
const rows = FULL
  ? [HARMONY, GROWTH].map((strategy) => ({
      strategy,
      with: monteCarlo([strategy], runs, { ...options, upgrades: true })[0]!,
      without: monteCarlo([strategy], runs, { ...options, upgrades: false })[0]!,
    }))
  : [];

/** Gedächtnis-Vorschau beim Erreichen des Hains (nach der Wahl am Wegpunkt), Mittel. */
const memoryAtHain = (s: Summary) => mean(s.runs.map((r) => r.memoryPath[0]?.after ?? NaN));
const time = (s: Summary, stage: number) => stageStats(s, stage).time;
const pct = (a: number, b: number) => `${a < b ? '−' : '+'}${(Math.abs(a / b - 1) * 100).toFixed(1).replace('.', ',')} %`;

describe.skipIf(!FULL)('Ausbau gegen ohne Ausbau (Phase 11, 3a, großer Lauf)', () => {
  it('Protokoll', () => {
    const lines = [
      `| Strategie | Ausbau | Hain | Wald | Urwald | H Hain / Wald / Urwald | Gedächtnis-Vorschau am Hain | Tempo Hain / Urwald gegenüber ohne (${runs} Durchgänge) |`,
      '|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rows) {
      for (const [label, s] of [['ohne', r.without], ['mit', r.with]] as const) {
        const h = [HAIN, WALD, URWALD].map((st) => stageStats(s, st).harmony.toFixed(1).replace('.', ',')).join(' / ');
        const tempo = label === 'mit' ? `${pct(time(s, HAIN), time(r.without, HAIN))} / ${pct(time(s, URWALD), time(r.without, URWALD))}` : '–';
        lines.push(
          `| ${r.strategy.name} | ${label} | ${formatTime(time(s, HAIN))} | ${formatTime(time(s, WALD))} | ${formatTime(time(s, URWALD))} | ${h} | ${memoryAtHain(s).toFixed(1).replace('.', ',')} | ${tempo} |`,
        );
      }
    }
    console.log(lines.join('\n'));
    expect(rows).toHaveLength(2);
  });

  it('Tempo: Hain 50–58 min, Urwald 2:00–2:13 h, Ausbau schneller als ohne (Harmonie)', () => {
    const h = rows[0]!;
    expect(time(h.with, HAIN)).toBeGreaterThan(50 * 60);
    expect(time(h.with, HAIN)).toBeLessThan(58 * 60);
    expect(time(h.with, URWALD)).toBeGreaterThan(120 * 60);
    expect(time(h.with, URWALD)).toBeLessThan(133 * 60);
    for (const st of [HAIN, URWALD]) expect(time(h.with, st)).toBeLessThan(time(h.without, st));
  });

  it('Wachstum ÷ Harmonie ≥ 0,85 (Hain, Urwald)', () => {
    for (const st of [HAIN, URWALD]) expect(time(rows[1]!.with, st) / time(rows[0]!.with, st), `Stufe ${st}`).toBeGreaterThan(0.85);
  });

  it('Harmonie bleibt: H am Hain ±3, Wald und Urwald ±5 gegenüber ohne Ausbau; Gedächtnis-Vorsprung ≥ 15', () => {
    for (const r of rows) {
      for (const [st, tol] of [[HAIN, 3], [WALD, 5], [URWALD, 5]] as const) {
        const d = stageStats(r.with, st).harmony - stageStats(r.without, st).harmony;
        expect(Math.abs(d), `${r.strategy.id}, Stufe ${st}`).toBeLessThan(tol);
      }
    }
    expect(memoryAtHain(rows[0]!.with) - memoryAtHain(rows[1]!.with)).toBeGreaterThan(15);
  });
});

/**
 * Naiver Spieler „folgt der Zielzeile“ (Phase 11, 3b; Playtest 5b, Fund F1): Karten und Forschung
 * wie der Harmonie-Spieler, Samen nur für das, was die Zielzeile nennt (kein Tausch, keine
 * Rücklage). Ziel: Wer der Zielzeile folgt, liegt nahe am Harmonie-Spieler (≤ 10 % langsamer bis
 * Hain und Wald) – sie führt nicht in die Irre (vorher schlug sie leere Nischen vor).
 */
describe.skipIf(!FULL)('Zielzeilen-Spieler (Phase 11, 3b, großer Lauf)', () => {
  const goal = FULL ? monteCarlo([GOAL], runs, { ...options, upgrades: true })[0]! : null;

  it('Protokoll und Tempo nahe am Harmonie-Spieler (≤ 10 % langsamer bis Hain und Wald)', () => {
    const h = rows[0]!.with;
    const g = goal!;
    const lines = ['| Strategie | Hain | Wald | Urwald | H Hain / Wald / Urwald | Aussaaten bis Hain (Tausch) | Ausbau-Käufe bis Hain |', '|---|---|---|---|---|---|---|'];
    for (const s of [h, g]) {
      const st = stageStats(s, HAIN);
      const harmony = [HAIN, WALD, URWALD].map((x) => stageStats(s, x).harmony.toFixed(1).replace('.', ',')).join(' / ');
      lines.push(
        `| ${s.strategy.name} | ${formatTime(time(s, HAIN))} | ${formatTime(time(s, WALD))} | ${formatTime(time(s, URWALD))} | ${harmony} | ${st.counts.plantsBought.toFixed(1).replace('.', ',')} (${st.counts.plantsSwapped.toFixed(1).replace('.', ',')}) | ${Math.round(st.counts.upgradesBought)} |`,
      );
    }
    console.log(lines.join('\n'));
    for (const st of [HAIN, WALD]) expect(time(g, st) / time(h, st), `Stufe ${st}`).toBeLessThan(1.1);
  });
});
