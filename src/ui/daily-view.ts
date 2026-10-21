/**
 * Tagesziele für die Seitenleiste (DESIGN_V2.md 19.4): Texte, Fortschritt und Hinweise aus
 * dem Spielstand. Reine Funktionen (ohne DOM) – getestet in tests/daily-view.test.ts.
 */
import { COMMUNITIES_BY_ID } from '../content/communities';
import { DAILY_GOALS_BY_KIND, DAILY_SEED_SECONDS } from '../content/daily';
import type { SeasonId } from '../content/seasons';
import type { Genus } from '../content/types';
import { dailyStreak, type DailyCompletion } from '../core/daily';
import { seedSeconds } from '../core/formulas';
import type { DailyGoal, GameState } from '../core/state';
import { formatNumber } from './format';
import { seedsLabel } from './view-format';

export interface DailyGoalView {
  /** Stabil je Tag und Ziel (Art), für den Neuaufbau. */
  key: string;
  icon: string;
  text: string;
  /** Anteil 0–1 für den Balken. */
  share: number;
  /** Fortschritt als Text, z. B. „2/3“, „2:30/5:00 min“, „60/75 %“. */
  progress: string;
  /** Werte für die ARIA-Fortschrittsanzeige (gerundet). */
  now: number;
  max: number;
  done: boolean;
  /** Belohnung, z. B. „+120 🌰“ oder „🎴 seltene Begegnung“; nach dem Erfüllen „erfüllt“. */
  reward: string;
}

export interface DailyView {
  /** Tag der Ziele (Teil des Schlüssels). */
  day: string;
  goals: DailyGoalView[];
  done: number;
  /** „2/3 erfüllt“ bzw. „Alle erfüllt – bis morgen!“. */
  summary: string;
  /** Serie, wie sie heute gilt (0 nach einer Lücke). */
  streak: number;
  /** „🌞 3 Tage in Folge“; leer ohne Serie. */
  streakText: string;
}

const SEASON_IN: Readonly<Record<SeasonId, string>> = {
  spring: 'im Frühling',
  summer: 'im Sommer',
  autumn: 'im Herbst',
  winter: 'im Winter',
};

/** Gattung im Genitiv (Artikel, Wort) – „der Vögel“, „des Bodenlebens“. */
const GENUS_GENITIVE: Readonly<Record<Genus, readonly [string, string]>> = {
  birds: ['der', 'Vögel'],
  insects: ['der', 'Insekten'],
  mammals: ['der', 'Säugetiere'],
  soil: ['des', 'Bodenlebens'],
  fungi: ['der', 'Pilze'],
  amphibians: ['der', 'Amphibien'],
};

const genitive = (genus: Genus | undefined) => (genus ? GENUS_GENITIVE[genus].join(' ') : '');
const possessive = (genus: Genus | undefined) => {
  if (!genus) return '';
  const [article, word] = GENUS_GENITIVE[genus];
  return `${article === 'des' ? 'deines' : 'deiner'} ${word}`;
};

/** „1:05“ aus Sekunden (abgerundet). */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Text eines Ziels (Vorlage aus content/daily.ts mit eingesetzten Werten). */
export function dailyGoalText(goal: DailyGoal): string {
  const template = DAILY_GOALS_BY_KIND.get(goal.kind)?.text ?? '';
  const values: Record<string, string> = {
    n: formatNumber(goal.target),
    species: goal.target === 1 ? 'eine Art' : `${formatNumber(goal.target)} Arten`,
    encounters: goal.target === 1 ? 'eine Begegnung' : `${formatNumber(goal.target)} Begegnungen`,
    genus: genitive(goal.genus),
    yourGenus: possessive(goal.genus),
    season: goal.season ? SEASON_IN[goal.season] : '',
    harmony: formatNumber(goal.harmony ?? 0),
    minutes: formatNumber(Math.round(goal.target / 60)),
    hint: (goal.community ? COMMUNITIES_BY_ID.get(goal.community)?.hint : undefined) ?? '',
  };
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

/** Fortschritt als Text. */
export function dailyProgressText(goal: DailyGoal): string {
  const p = Math.min(goal.target, Math.max(0, goal.progress));
  switch (goal.kind) {
    case 'harmony':
      return `${clock(p)}/${clock(goal.target)} min`;
    case 'satisfaction':
      return `${formatNumber(Math.floor(p))}/${formatNumber(goal.target)} %`;
    case 'growth':
      return `${formatNumber(Math.floor(p))}/${formatNumber(goal.target)} 🌿`;
    case 'seeds':
      return `${formatNumber(Math.floor(p))}/${formatNumber(goal.target)} 🌰`;
    default:
      return `${formatNumber(Math.floor(p))}/${formatNumber(goal.target)}`;
  }
}

/** „1 Tag“ / „3 Tage“. */
const days = (n: number) => `${formatNumber(n)} ${n === 1 ? 'Tag' : 'Tage'}`;

/** Ansicht der Tagesziele für `today` (Serie gilt nach einer Lücke als 0). */
export function toDailyView(state: GameState, today: string): DailyView {
  const daily = state.meta.daily;
  const seeds = `+${seedsLabel(seedSeconds(state, DAILY_SEED_SECONDS))} 🌰`;
  const goals = daily.goals.map((g): DailyGoalView => {
    const share = g.target > 0 ? Math.min(1, Math.max(0, g.progress / g.target)) : 0;
    return {
      key: `${daily.day}|${g.kind}`,
      icon: DAILY_GOALS_BY_KIND.get(g.kind)?.icon ?? '•',
      text: dailyGoalText(g),
      share: g.done ? 1 : share,
      progress: dailyProgressText(g),
      now: Math.floor(Math.min(g.target, Math.max(0, g.progress))),
      max: g.target,
      done: g.done,
      reward: g.done ? '✓ erfüllt' : g.reward === 'rare' ? '🎴 seltene Begegnung' : seeds,
    };
  });
  const done = goals.filter((g) => g.done).length;
  const streak = dailyStreak(state, today);
  return {
    day: daily.day,
    goals,
    done,
    summary: goals.length > 0 && done === goals.length ? 'Alle erfüllt – bis morgen!' : `${done}/${goals.length} erfüllt`,
    streak,
    streakText: streak > 0 ? `🌞 ${days(streak)} in Folge` : '',
  };
}

/**
 * Hinweis nach erfüllten Zielen, z. B. „✅ Tagesziel erfüllt: Setze eine Begleitpflanze … +120 🌰“.
 * Mehrere in einem Satz; bei allen erfüllt mit Serie. '' wenn nichts erfüllt wurde.
 */
export function dailyCompletedText(completed: readonly DailyCompletion[], perfect: boolean, streak: number): string {
  if (completed.length === 0) return '';
  const rewards = (c: DailyCompletion) => (c.rare ? '🎴 Eine seltene Begegnung wartet.' : `+${seedsLabel(c.seeds)} 🌰`);
  const head =
    completed.length === 1
      ? `✅ Tagesziel erfüllt: ${dailyGoalText(completed[0]!.goal)} ${rewards(completed[0]!)}`
      : `✅ ${formatNumber(completed.length)} Tagesziele erfüllt: ${completed.map(rewards).join(' · ')}`;
  return perfect ? `${head} Alle Tagesziele geschafft${streak > 1 ? ` – ${days(streak)} in Folge` : ''}!` : head;
}
