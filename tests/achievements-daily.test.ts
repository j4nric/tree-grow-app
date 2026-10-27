import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, type Achievement } from '../src/content/achievements';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { achievementProgress, checkAchievements, isAchievementVisibleIn, targetOf, valueOf } from '../src/core/achievements';
import { updateDaily } from '../src/core/daily';
import { loadGame, serialize } from '../src/core/save';
import { SAVE_VERSION, createInitialState, type DailyGoal, type GameState } from '../src/core/state';
import { simulateOffline, startNewCycle, tick } from '../src/core/tick';
import { addDays } from './daily-helpers';
import { stateAt } from './helpers';

/*
 * Erfolge der Tagesziele (DESIGN_V2.md 26.5, Phase 9 / 1d): Bedingungsart `daily` über die
 * Zähler in `meta.daily` (seit v12), „Sieben Morgen“ und „Fünfzig Handgriffe“, Nachtrag beim
 * Laden – ohne neue Spielstand-Version.
 */

const byId = (id: string): Achievement => ACHIEVEMENTS_BY_ID.get(id)!;
const DAY = '2026-10-21';

const goal = (kind: DailyGoal['kind'], target: number, extra: Partial<DailyGoal> = {}): DailyGoal => ({
  kind,
  target,
  progress: 0,
  reward: 'seeds',
  done: false,
  ...extra,
});

function withDaily(patch: Partial<GameState['meta']['daily']>): GameState {
  const s = createInitialState(0, 7);
  Object.assign(s.meta.daily, patch);
  return s;
}

describe('Inhalt (26.5)', () => {
  it('„Sieben Morgen“ und „Fünfzig Handgriffe“ wie im Entwurf, immer sichtbar', () => {
    expect(byId('daily-streak-7')).toMatchObject({
      icon: '🌅',
      title: 'Sieben Morgen',
      description: 'Sieben Tage in Folge ein Tagesziel erfüllt.',
      condition: { kind: 'daily', key: 'bestStreak', atLeast: 7 },
    });
    expect(byId('daily-50')).toMatchObject({
      icon: '🧺',
      title: 'Fünfzig Handgriffe',
      description: 'Fünfzig Tagesziele erfüllt.',
      condition: { kind: 'daily', key: 'goalsDone', atLeast: 50 },
    });
    for (const id of ['daily-streak-7', 'daily-50']) {
      expect(byId(id).requires).toBeUndefined();
      expect(isAchievementVisibleIn(byId(id), false)).toBe(true);
    }
    // Katalog seit Phase 11, 2c: 40 (Phase 9, 2b: Chronik und Kennarten, 26.5; dazu Ausbau, 28.4).
    expect(ACHIEVEMENTS).toHaveLength(40);
  });

  it('stehen vor den Erfolgen der Landschaft (die bleiben am Ende)', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    const firstLandscape = ACHIEVEMENTS.findIndex((a) => a.requires === 'landscape');
    expect(ids.indexOf('daily-streak-7')).toBeLessThan(firstLandscape);
    expect(ids.indexOf('daily-50')).toBe(ids.indexOf('daily-streak-7') + 1);
  });
});

describe('Bedingungsart daily', () => {
  it('liest bestStreak, goalsDone und perfectDays', () => {
    const s = withDaily({ bestStreak: 4, goalsDone: 12, perfectDays: 3 });
    expect(valueOf(s, { kind: 'daily', key: 'bestStreak', atLeast: 7 })).toBe(4);
    expect(valueOf(s, { kind: 'daily', key: 'goalsDone', atLeast: 50 })).toBe(12);
    expect(valueOf(s, { kind: 'daily', key: 'perfectDays', atLeast: 1 })).toBe(3);
    expect(targetOf({ kind: 'daily', key: 'perfectDays', atLeast: 5 })).toBe(5);
  });

  it('Grenzfälle: 0, NaN, negativ, Bruch, keine Zahl, sehr groß, fehlendes meta.daily', () => {
    const c = { kind: 'daily', key: 'goalsDone', atLeast: 50 } as const;
    const value = (v: unknown) => valueOf(withDaily({ goalsDone: v as number }), c);
    expect(value(0)).toBe(0);
    expect(value(NaN)).toBe(0);
    expect(value(-5)).toBe(0);
    expect(value(49.9)).toBe(49);
    expect(value('50')).toBe(0);
    expect(value(1e300)).toBe(1e300);
    expect(value(Infinity)).toBe(Infinity);
    const s = createInitialState(0, 7);
    delete (s.meta as Partial<GameState['meta']>).daily;
    expect(valueOf(s, c)).toBe(0);
    expect(checkAchievements(s)).not.toContain('daily-50');
  });

  it('Schwellen: 6 / 49 noch nicht, 7 / 50 schon', () => {
    const below = withDaily({ bestStreak: 6, goalsDone: 49 });
    expect(checkAchievements(below)).toEqual([]);
    const at = withDaily({ bestStreak: 7, goalsDone: 50 });
    expect(checkAchievements(at)).toEqual(['daily-streak-7', 'daily-50']);
    expect(checkAchievements(at)).toEqual([]);
    expect(achievementProgress(below, byId('daily-streak-7'))).toEqual({ value: 6, target: 7 });
    expect(achievementProgress(withDaily({ goalsDone: 80 }), byId('daily-50'))).toEqual({ value: 50, target: 50 });
  });

  it('nach dem Abriss der Serie zählt die beste Serie – und der Erfolg bleibt', () => {
    const s = withDaily({ streak: 7, bestStreak: 7, lastDay: DAY });
    expect(checkAchievements(s)).toEqual(['daily-streak-7']);
    s.meta.daily.streak = 0;
    expect(checkAchievements(s)).toEqual([]);
    expect(s.meta.achievements).toContain('daily-streak-7');
  });
});

describe('Zählen über updateDaily', () => {
  it('der siebte Morgen in Folge und das fünfzigste Ziel schalten beide frei', () => {
    const s = withDaily({
      day: DAY,
      goals: [goal('decide', 1, { progress: 1 }), goal('growth', 1e12)],
      streak: 6,
      bestStreak: 6,
      lastDay: addDays(DAY, -1),
      goalsDone: 49,
    });
    expect(checkAchievements(s)).toEqual([]);
    const result = updateDaily(s, DAY);
    expect(result.completed).toHaveLength(1);
    expect(s.meta.daily).toMatchObject({ streak: 7, bestStreak: 7, goalsDone: 50 });
    expect(checkAchievements(s)).toEqual(['daily-streak-7', 'daily-50']);
  });

  it('nach einer Lücke beginnt die Serie neu – kein Erfolg', () => {
    const s = withDaily({ day: DAY, goals: [goal('decide', 1, { progress: 1 })], streak: 6, bestStreak: 6, lastDay: addDays(DAY, -2), goalsDone: 3 });
    updateDaily(s, DAY);
    expect(s.meta.daily).toMatchObject({ streak: 1, bestStreak: 6 });
    expect(checkAchievements(s)).toEqual([]);
  });
});

describe('Zyklen, Ticks und online = offline', () => {
  it('der Neue Zyklus behält die Zähler (meta) – die Bedingung bleibt erfüllt', () => {
    const s = stateAt(NEW_CYCLE_MIN_STAGE, ['earthworm', 'robin'], 5);
    Object.assign(s.meta.daily, { bestStreak: 9, goalsDone: 61 });
    const result = startNewCycle(s, 1);
    expect(result.ok).toBe(true);
    expect(s.cycle.number).toBe(2);
    expect(s.meta.achievements).toEqual(expect.arrayContaining(['daily-streak-7', 'daily-50']));
    expect(valueOf(s, byId('daily-50').condition)).toBe(61);
  });

  it('Ticks ändern die Zähler nicht: viele kleine Ticks und ein Offline-Tick ergeben dieselben Erfolge', () => {
    const online = withDaily({ bestStreak: 7, goalsDone: 12 });
    const offline = withDaily({ bestStreak: 7, goalsDone: 12 });
    const unlockedOnline: string[] = [];
    for (let i = 0; i < 120; i++) {
      tick(online, 5);
      unlockedOnline.push(...checkAchievements(online));
    }
    simulateOffline(offline, 600);
    const unlockedOffline = checkAchievements(offline);
    expect(online.meta.daily).toEqual(offline.meta.daily);
    expect(unlockedOnline).toContain('daily-streak-7');
    expect(unlockedOnline.filter((id) => id.startsWith('daily-'))).toEqual(unlockedOffline.filter((id) => id.startsWith('daily-')));
  });
});

describe('Nachtrag beim Laden (wie 12.6, ohne neue Spielstand-Version)', () => {
  it('Stände v12 … aktuell mit erfüllten Zählern laden; die erste Prüfung trägt beide nach, die zweite nichts', () => {
    for (let version = 12; version <= SAVE_VERSION; version++) {
      const s = createInitialState(0, 3);
      Object.assign(s.meta.daily, { streak: 2, bestStreak: 8, lastDay: DAY, goalsDone: 57, perfectDays: 9 });
      const data = JSON.parse(serialize(s));
      data.version = version;
      const loaded = loadGame(JSON.stringify(data), 0);
      expect(loaded, `v${version}`).not.toBeNull();
      const state = loaded!.state;
      expect(state.version).toBe(SAVE_VERSION);
      expect(state.meta.daily, `v${version}`).toMatchObject({ bestStreak: 8, goalsDone: 57, perfectDays: 9 });
      expect(checkAchievements(state), `v${version}`).toEqual(expect.arrayContaining(['daily-streak-7', 'daily-50']));
      const again = loadGame(serialize(state), 0)!.state;
      expect(again.meta.achievements).toEqual(expect.arrayContaining(['daily-streak-7', 'daily-50']));
      expect(checkAchievements(again)).toEqual([]);
    }
  });

  it('kaputte Zähler im Spielstand: lädt, kein Erfolg', () => {
    const data = JSON.parse(serialize(createInitialState(0, 3)));
    data.meta.daily = { ...data.meta.daily, bestStreak: 'sieben', goalsDone: NaN, perfectDays: -4 };
    const state = loadGame(JSON.stringify(data), 0)!.state;
    expect(checkAchievements(state).filter((id) => id.startsWith('daily-'))).toEqual([]);
  });

  it('älterer Stand ohne Tagesziele (v11): lädt, kein Erfolg der Tagesziele', () => {
    const data = JSON.parse(serialize(createInitialState(0, 3)));
    data.version = 11;
    delete data.meta.daily;
    const state = loadGame(JSON.stringify(data), 0)!.state;
    expect(state.meta.daily.goalsDone).toBe(0);
    expect(checkAchievements(state).filter((id) => id.startsWith('daily-'))).toEqual([]);
  });
});
