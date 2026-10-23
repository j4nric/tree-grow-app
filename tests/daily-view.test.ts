import { describe, expect, it } from 'vitest';
import { COMMUNITIES } from '../src/content/communities';
import { DAILY_SEED_SECONDS } from '../src/content/daily';
import { seedSeconds } from '../src/core/formulas';
import type { DailyGoal } from '../src/core/state';
import { SLIP_MIN_CHARS } from '../src/ui/album/stamp-rules';
import { dailyCompletedText, dailyGoalDoneText, dailyGoalText, dailyProgressText, toDailyView } from '../src/ui/daily-view';
import { seedsLabel } from '../src/ui/view-format';
import { stateAt } from './helpers';

const goal = (kind: DailyGoal['kind'], target: number, extra: Partial<DailyGoal> = {}): DailyGoal => ({
  kind,
  target,
  progress: 0,
  reward: 'seeds',
  done: false,
  ...extra,
});

describe('Texte der Tagesziele', () => {
  it('deutsch, mit Gattung, Jahreszeit und Rätselhinweis', () => {
    expect(dailyGoalText(goal('decide', 2))).toBe('Entscheide 2 Begegnungen – annehmen, ablehnen oder ziehen lassen.');
    expect(dailyGoalText(goal('decide', 1))).toBe('Entscheide eine Begegnung – annehmen, ablehnen oder ziehen lassen.');
    expect(dailyGoalText(goal('observe', 2, { genus: 'mammals', season: 'winter' }))).toBe(
      'Beobachte im Winter 2 Arten der Säugetiere in deinem Wald.',
    );
    expect(dailyGoalText(goal('observe', 1, { genus: 'soil', season: 'winter' }))).toBe(
      'Beobachte im Winter eine Art des Bodenlebens in deinem Wald.',
    );
    expect(dailyGoalText(goal('satisfaction', 75, { genus: 'soil' }))).toBe('Bring die Zufriedenheit deines Bodenlebens auf 75 %.');
    expect(dailyGoalText(goal('satisfaction', 90, { genus: 'insects' }))).toBe('Bring die Zufriedenheit deiner Insekten auf 90 %.');
    expect(dailyGoalText(goal('harmony', 300, { harmony: 25 }))).toBe('Halte die Harmonie-Produktion 5 Minuten lang bei mindestens 25 ⚖️/min.');
    expect(dailyGoalText(goal('community', 1, { community: 'humus' }))).toBe(
      'Ein Rätsel unter Arten › Gemeinschaften: „Aus Laub wird Erde, aus Erde wird Leben.“ Entdecke diese Lebensgemeinschaft.',
    );
    expect(dailyGoalText(goal('growth', 1200))).toBe('Lass deinen Baum um 1.200 🌿 wachsen.');
    expect(dailyGoalText(goal('seeds', 30))).toBe('Sammle 30 🌰.');
    for (const kind of ['plant', 'care'] as const) expect(dailyGoalText(goal(kind, 1))).not.toMatch(/[{}]/);
  });

  it('Fortschritt je Art', () => {
    expect(dailyProgressText(goal('decide', 3, { progress: 2 }))).toBe('2/3');
    expect(dailyProgressText(goal('harmony', 300, { progress: 150.7 }))).toBe('2:30/5:00 min');
    expect(dailyProgressText(goal('satisfaction', 75, { progress: 62 }))).toBe('62/75 %');
    expect(dailyProgressText(goal('growth', 1200, { progress: 345.9 }))).toBe('345/1.200 🌿');
    expect(dailyProgressText(goal('seeds', 30, { progress: 99 }))).toBe('30/30 🌰');
  });
});

describe('Ansicht und Hinweise', () => {
  it('Karte: Anteil, Belohnung, Zusammenfassung, Serie', () => {
    const state = stateAt(3, ['earthworm']);
    state.meta.daily.day = '2026-10-21';
    state.meta.daily.goals = [goal('decide', 2, { progress: 1 }), goal('plant', 1, { progress: 1, done: true }), goal('growth', 100, { reward: 'rare' })];
    state.meta.daily.streak = 3;
    state.meta.daily.lastDay = '2026-10-21';
    const view = toDailyView(state, '2026-10-21');
    expect(view.goals.map((g) => [g.share, g.done, g.reward])).toEqual([
      [0.5, false, `+${seedsLabel(seedSeconds(state, DAILY_SEED_SECONDS))} 🌰`],
      [1, true, '✓ erfüllt'],
      [0, false, '🎴 seltene Begegnung'],
    ]);
    expect(view.summary).toBe('1/3 erfüllt');
    expect(view.streakText).toBe('🌞 3 Tage in Folge');
    expect(toDailyView(state, '2026-10-23').streakText).toBe('');
    for (const g of state.meta.daily.goals) g.done = true;
    expect(toDailyView(state, '2026-10-21').summary).toBe('Alle erfüllt – bis morgen!');
  });

  it('Hinweis nach dem Erfüllen: kurz, damit er ein Stempel bleibt (S8)', () => {
    const g = goal('plant', 1, { done: true });
    expect(dailyCompletedText([], false, 0)).toBe('');
    expect(dailyCompletedText([{ goal: g, seeds: 120, rare: false }], false, 1)).toBe('✅ Tagesziel: Begleitpflanze gesetzt · +120 🌰');
    expect(dailyCompletedText([{ goal: g, seeds: 0, rare: true }], true, 4)).toBe(
      '✅ Tagesziel: Begleitpflanze gesetzt · 🎴 seltene Begegnung wartet · Alle erfüllt · 🌞 4 Tage!',
    );
    expect(dailyCompletedText([{ goal: g, seeds: 12, rare: false }, { goal: g, seeds: 8.5, rare: false }], true, 1)).toBe(
      '✅ 2 Tagesziele: +12 🌰 · +8,5 🌰 · Alle erfüllt!',
    );
  });

  it('Kurzform jeder Zielart bleibt unter der Zettel-Grenze (90 Zeichen) – auch mit Belohnung und Serie', () => {
    const goals = [
      goal('decide', 2),
      goal('observe', 3, { genus: 'amphibians', season: 'autumn' }),
      goal('satisfaction', 75, { genus: 'mammals' }),
      goal('community', 1, { community: COMMUNITIES[0]!.id }),
      goal('plant', 1),
      goal('care', 1),
      goal('harmony', 300, { harmony: 120 }),
      goal('growth', 1_234_567),
      goal('seeds', 98_765),
    ];
    expect(dailyGoalDoneText(goals[0]!)).toBe('2 Begegnungen entschieden');
    expect(dailyGoalDoneText(goals[1]!)).toBe('3 Arten der Amphibien beobachtet');
    expect(dailyGoalDoneText(goals[2]!)).toBe('Säugetiere zu 75 % zufrieden');
    expect(dailyGoalDoneText(goal('satisfaction', 60, { genus: 'soil' }))).toBe('Bodenleben zu 60 % zufrieden');
    expect(dailyGoalDoneText(goals[6]!)).toBe('Harmonie 5 Min. gehalten');
    for (const g of goals) {
      const text = dailyCompletedText([{ goal: g, seeds: 10_255.4, rare: false }], true, 12);
      expect([...text].length, text).toBeLessThanOrEqual(SLIP_MIN_CHARS);
    }
  });
});
