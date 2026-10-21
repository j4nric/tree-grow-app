import { describe, expect, it } from 'vitest';
import { GROWTH, HARMONY, RANDOM, formatTime, median, monteCarlo, stageStats, type Summary } from '../scripts/simulate';
import { DAILY_GOAL_COUNT, DAILY_SEED_SECONDS } from '../src/content/daily';
import { FULL, HAIN, RUNS } from './balance-setup';

/**
 * Tagesziele und Balancing (DESIGN_V2.md 20.6): Die Belohnungen dürfen das Tempo nicht
 * bestimmen – Ziel < 5 % der Samen der ersten Stunde. Der Simulator spielt die Tagesziele
 * hier mit (`RunOptions.daily`), verfolgt sie aber nicht gezielt; alle übrigen
 * Balancing-Tabellen laufen ohne Tagesziele.
 *
 * Zwei Fälle: ein neuer Spieler (Ziele des Starttags, Stufe Samen) und einer, bei dem nach
 * 30 Minuten Mitternacht ist (zweiter Satz Ziele auf höherer Stufe). Dazu eine Obergrenze:
 * zweimal alle Ziele zur Samenrate am Ende der Stunde.
 */
const HOUR = 3600;
const DAY = '2026-10-21';
const base = { maxSeconds: HOUR, care: true, targetStage: 7 };
const runs = Math.min(RUNS, FULL ? 200 : 20);
const STRATS = [HARMONY, GROWTH, RANDOM];

const earned = (s: Summary['runs'][number]['final']) => s.earnedPassive + s.earnedDecline + s.earnedExtras + s.earnedDaily;

function shares(summary: Summary) {
  const xs = summary.runs.map((r) => r.final);
  const share = xs.map((f) => f.earnedDaily / Math.max(1e-9, earned(f)));
  // Obergrenze: zweimal alle Ziele mit Samen-Sekunden zur Rate am Ende der Stunde.
  const bound = xs.map((f) => (2 * DAILY_GOAL_COUNT * DAILY_SEED_SECONDS * f.seedsRate) / Math.max(1e-9, earned(f)));
  return {
    share: median(share),
    max: Math.max(...share),
    bound: median(bound),
    seeds: median(xs.map((f) => f.earnedDaily)),
    done: median(xs.map((f) => f.dailyDone)),
    total: median(xs.map(earned)),
  };
}

const oneDay = STRATS.map((s) => monteCarlo([s], runs, { ...base, daily: DAY })[0]!);
const twoDays = STRATS.map((s) => monteCarlo([s], runs, { ...base, daily: DAY, dailyNextDayAt: HOUR / 2, dailyNextDay: '2026-10-22' })[0]!);

describe('Tagesziele: Anteil an den Samen der ersten Stunde', () => {
  it('Protokoll', () => {
    if (!FULL) return;
    const pct = (x: number) => `${(x * 100).toFixed(2).replace('.', ',')} %`;
    const rows = ['| Strategie | Fall | erfüllt (Median) | Samen aus Zielen | Samen gesamt | Anteil (Median / max) | Obergrenze |', '|---|---|---|---|---|---|---|'];
    for (const [label, list] of [['ein Tag', oneDay], ['Mitternacht nach 30 min', twoDays]] as const) {
      for (const summary of list) {
        const x = shares(summary);
        rows.push(
          `| ${summary.strategy.name} | ${label} | ${x.done} | ${Math.round(x.seeds)} | ${Math.round(x.total)} | ${pct(x.share)} / ${pct(x.max)} | ${pct(x.bound)} |`,
        );
      }
    }
    console.log(rows.join('\n'));
  });

  it('bleibt unter 5 % (auch mit Tageswechsel nach 30 min), Obergrenze unter 5 %', () => {
    for (const summary of [...oneDay, ...twoDays]) {
      const x = shares(summary);
      expect(x.share, summary.strategy.name).toBeLessThan(0.05);
      expect(x.max, summary.strategy.name).toBeLessThan(0.05);
      expect(x.bound, summary.strategy.name).toBeLessThan(0.05);
    }
  });

  it('der neue Spieler erfüllt am ersten Tag Ziele (Stufe Samen: Begegnungen, Wachstum, Samen)', () => {
    for (const summary of oneDay) expect(shares(summary).done, summary.strategy.name).toBeGreaterThanOrEqual(2);
  });
});

describe('Tagesziele: Tempo bis zum Hain unverändert', () => {
  const opts = { maxSeconds: 2 * HOUR, care: true, targetStage: HAIN };
  const without = monteCarlo([HARMONY], runs, opts)[0]!;
  const withDaily = monteCarlo([HARMONY], runs, { ...opts, daily: DAY })[0]!;
  it('Harmonie-Spieler: Hain mit und ohne Tagesziele innerhalb ±3 %', () => {
    const a = stageStats(without, HAIN).time;
    const b = stageStats(withDaily, HAIN).time;
    if (FULL) console.log(`Hain ohne / mit Tageszielen: ${formatTime(a)} / ${formatTime(b)}`);
    expect(Math.abs(b - a) / a).toBeLessThan(0.03);
  });
});
