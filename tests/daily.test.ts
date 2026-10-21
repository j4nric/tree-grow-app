import { describe, expect, it, vi } from 'vitest';
import { DAILY_GOALS_BY_KIND, DAILY_RARE_MIN_STAGE, DAILY_SEED_SECONDS } from '../src/content/daily';
import { MAX_PENDING_ENCOUNTERS } from '../src/content/encounters';
import { SPECIES_BY_ID } from '../src/content/species';
import { SEASON_SECONDS } from '../src/content/seasons';
import {
  dailyStreak,
  dayKeyFromNumber,
  dayKeyOf,
  dayNumber,
  generateDailyGoals,
  isDayKey,
  roundTarget,
  updateDaily,
} from '../src/core/daily';
import { evaluate, seedSeconds } from '../src/core/formulas';
import { loadGame, serialize } from '../src/core/save';
import { SAVE_VERSION, createInitialState, type DailyGoal, type GameState } from '../src/core/state';
import {
  buyCare,
  chooseCard,
  chooseEventOption,
  declineEncounter,
  farewellVisitor,
  hostVisitor,
  plantSeed,
  rerollEncounter,
  simulateOffline,
  startNewCycle,
  tick,
} from '../src/core/tick';
import { addDays, grow, visit } from './daily-helpers';
import { stateAt } from './helpers';

// Wälder bis zum Urwald wachsen zu lassen dauert unter Last länger als die Standardgrenze.
vi.setConfig({ testTimeout: 60_000 });

/*
 * Tagesziele (DESIGN_V2.md 20): Tage, Auswahl (deterministisch, nach Stufe, schaffbar),
 * Fortschritt (aktiv / offline), Belohnung, Serie, Tageswechsel und Spielstand v12.
 */

const DAY = '2026-10-21';

/** Ziel mit Standardwerten (für Tests mit festen Zielen). */
const goal = (kind: DailyGoal['kind'], target: number, extra: Partial<DailyGoal> = {}): DailyGoal => ({
  kind,
  target,
  progress: 0,
  reward: 'seeds',
  done: false,
  ...extra,
});

/** Setzt feste Ziele für `day` (kein Tageswechsel mehr an diesem Tag). */
function withGoals(state: GameState, goals: DailyGoal[], day = DAY): GameState {
  state.meta.daily.day = day;
  state.meta.daily.goals = goals;
  return state;
}

/** Entscheidet die erste Begegnung von Hand (ablehnen, Ereignis: erste Option, Gast: ziehen lassen). */
function resolve(state: GameState): boolean {
  const type = state.pendingEncounters[0]?.type;
  const result =
    type === 'event' ? chooseEventOption(state, 0, 0) : type === 'visitor' ? farewellVisitor(state, 0) : declineEncounter(state, 0);
  return result.ok;
}

/** Wälder je Stufe (einmal gewachsen, für mehrere Tests). */
const forests = new Map<string, GameState>();
function forest(seed: number, stage: number): GameState {
  const key = `${seed}|${stage}`;
  if (!forests.has(key)) forests.set(key, grow(seed, stage));
  return structuredClone(forests.get(key)!);
}

describe('Tage „JJJJ-MM-TT“', () => {
  it('Schlüssel, Tagesnummer und Rückweg (Schaltjahr, Jahreswechsel)', () => {
    expect(dayKeyOf(2026, 3, 7)).toBe('2026-03-07');
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('2026-10-22') - dayNumber('2026-10-21')).toBe(1);
    expect(dayNumber('2025-01-01') - dayNumber('2024-12-31')).toBe(1);
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-28')).toBe(2);
    for (const n of [-1000, 0, 19000, 20382, 30000]) expect(dayNumber(dayKeyFromNumber(n))).toBe(n);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('ungültige Tage', () => {
    for (const bad of ['', '2026-02-30', '2026-13-01', '2026-1-1', '21.10.2026', 'x', null, 42]) expect(isDayKey(bad)).toBe(false);
    expect(isDayKey('2024-02-29')).toBe(true);
    expect(isDayKey('2025-02-29')).toBe(false);
  });

  it('Zielwerte auf zwei geltende Ziffern abgerundet', () => {
    expect([0, 0.4, 7.6, 12.9, 384, 4567, NaN].map(roundTarget)).toEqual([1, 1, 7, 12, 380, 4500, 1]);
  });
});

describe('Auswahl der Ziele', () => {
  it('deterministisch und ohne Nebenwirkung: gleicher Stand + Tag → gleiche Ziele', () => {
    const state = forest(3, 4);
    const before = serialize(state);
    const a = generateDailyGoals(state, DAY);
    expect(serialize(state)).toBe(before);
    expect(generateDailyGoals(structuredClone(state), DAY)).toEqual(a);
    // Über zehn Tage nicht immer dasselbe; ein anderer Startwert gibt andere Tage.
    const days = Array.from({ length: 10 }, (_, i) => JSON.stringify(generateDailyGoals(state, addDays(DAY, i))));
    expect(new Set(days).size).toBeGreaterThan(3);
    const other = structuredClone(state);
    other.meta.daily.seed = 12345;
    const otherDays = Array.from({ length: 10 }, (_, i) => JSON.stringify(generateDailyGoals(other, addDays(DAY, i))));
    expect(otherDays).not.toEqual(days);
  });

  it('nach Stufe gefiltert: drei verschiedene Arten, „Umbauen“ und „Halten“ nie zusammen, selten erst ab Junger Baum', () => {
    for (let stage = 0; stage <= 7; stage++) {
      for (const seed of [1, 2]) {
        const state = forest(seed, stage);
        expect(state.stage).toBe(stage);
        for (let d = 0; d < 15; d++) {
          const goals = generateDailyGoals(state, addDays(DAY, d));
          expect(goals.length, `Stufe ${stage}`).toBe(3);
          expect(new Set(goals.map((g) => g.kind)).size).toBe(goals.length);
          const groups = new Set(goals.map((g) => DAILY_GOALS_BY_KIND.get(g.kind)!.group).filter(Boolean));
          expect(groups.size).toBeLessThanOrEqual(1);
          for (const g of goals) {
            expect(DAILY_GOALS_BY_KIND.get(g.kind)!.minStage, g.kind).toBeLessThanOrEqual(stage);
            expect(g.target).toBeGreaterThan(0);
            expect(g.progress).toBe(0);
            if (g.reward === 'rare') expect(stage).toBeGreaterThanOrEqual(DAILY_RARE_MIN_STAGE);
          }
          if (stage === 0) expect(goals.map((g) => g.kind).sort()).toEqual(['decide', 'growth', 'seeds']);
        }
      }
    }
  });

  it('keine unmöglichen Ziele: ein kurzer Besuch (≤ 15 min) erfüllt alle – auf jeder Stufe', () => {
    for (let stage = 0; stage <= 7; stage++) {
      for (const seed of [1, 2]) {
        for (let d = 0; d < 8; d++) {
          const state = forest(seed, stage);
          const day = addDays(DAY, d);
          visit(state, day, 900);
          const open = state.meta.daily.goals.filter((g) => !g.done);
          expect(open, `Stufe ${stage}, Seed ${seed}, ${day}`).toEqual([]);
        }
      }
    }
  });

  it('Parameter passen zum Wald: beobachtete Arten leben, Gemeinschaft noch unentdeckt, Zufriedenheit über dem jetzigen Wert', () => {
    for (let d = 0; d < 30; d++) {
      const state = forest(2, 5);
      for (const g of generateDailyGoals(state, addDays(DAY, d))) {
        if (g.kind === 'observe') {
          const n = Object.values(state.niches).flat().filter((id) => SPECIES_BY_ID.get(id)!.genus === g.genus).length;
          expect(g.target).toBeLessThanOrEqual(n);
        }
        if (g.kind === 'community') expect(state.meta.journal.communities).not.toContain(g.community);
        if (g.kind === 'satisfaction') expect(g.target).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('Fortschritt: aktiv und offline', () => {
  it('Begegnungen zählen nur, wenn der Spieler entscheidet – nicht beim automatischen Ablehnen (online wie offline)', () => {
    const state = withGoals(stateAt(3), [goal('decide', 3)]);
    // Viel Zeit: Der Stapel läuft voll, überzählige Begegnungen werden automatisch abgelehnt.
    const report = simulateOffline(state, 3600);
    expect(report.autoDeclined).toBeGreaterThan(0);
    updateDaily(state, DAY, { offline: true });
    expect(state.meta.daily.goals[0]!.progress).toBe(0);
    expect(resolve(state)).toBe(true);
    expect(resolve(state)).toBe(true);
    expect(state.meta.daily.goals[0]!.progress).toBe(2);
    expect(state.meta.daily.goals[0]!.done).toBe(false);
    expect(resolve(state)).toBe(true);
    const result = updateDaily(state, DAY, {});
    expect(result.completed.map((c) => c.goal.kind)).toEqual(['decide']);
  });

  it('jede Entscheidung zählt einmal (Karte wählen, Gast bewirten, Pflanze, Pflege) – Neu würfeln nicht', () => {
    const state = withGoals(stateAt(5), [goal('decide', 3), goal('plant', 1), goal('care', 1)]);
    state.seeds = 1e6;
    state.pendingEncounters = [
      { type: 'animal', cards: ['earthworm', 'woodlouse'], rerolls: 0 },
      { type: 'visitor', cards: ['cranes'], rerolls: 0 },
    ];
    expect(rerollEncounter(state, 0).ok).toBe(true);
    expect(state.meta.daily.goals[0]!.progress).toBe(0);
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(hostVisitor(state, 0).ok).toBe(true);
    expect(state.meta.daily.goals[0]!.progress).toBe(2);
    expect(plantSeed(state, 'moss').ok).toBe(true);
    expect(buyCare(state, 'compost').ok).toBe(true);
    expect(state.meta.daily.goals.map((g) => g.progress)).toEqual([2, 1, 1]);
    const result = updateDaily(state, DAY, {});
    expect(result.completed.map((c) => c.goal.kind)).toEqual(['plant', 'care']);
  });

  it('Wachstum, Samen und Harmonie zählen nur aktiv gespielte Sekunden', () => {
    const state = withGoals(stateAt(3, ['earthworm', 'woodlouse', 'bluetit']), [
      goal('growth', 1e9),
      goal('seeds', 1e9),
      goal('harmony', 300, { harmony: 1 }),
    ]);
    const ev = evaluate(state);
    expect(ev.harmony).toBeGreaterThan(1);
    updateDaily(state, DAY, { offline: true, activeSeconds: 100 });
    expect(state.meta.daily.goals.map((g) => g.progress)).toEqual([0, 0, 0]);
    updateDaily(state, DAY, { activeSeconds: 10 });
    const [g, s, h] = state.meta.daily.goals;
    expect(g!.progress).toBeCloseTo(ev.growth * 10, 9);
    expect(s!.progress).toBeCloseTo(ev.seeds * 10, 9);
    expect(h!.progress).toBe(10);
    // Unter der Schwelle zählt die Zeit nicht.
    h!.harmony = 1e6;
    updateDaily(state, DAY, { activeSeconds: 10 });
    expect(h!.progress).toBe(10);
  });

  it('Beobachten nur aktiv und in der richtigen Jahreszeit; Zufriedenheit und Gemeinschaft auch offline', () => {
    const state = withGoals(stateAt(3, ['earthworm', 'woodlouse']), [
      goal('observe', 2, { genus: 'soil', season: 'summer' }),
      goal('satisfaction', 1, { genus: 'soil' }),
      goal('community', 1, { community: 'humus' }),
    ]);
    updateDaily(state, DAY, { offline: true });
    const [observe, satisfaction, community] = state.meta.daily.goals;
    expect(observe!.progress).toBe(0);
    expect(satisfaction!.done).toBe(true);
    expect(community!.done).toBe(false);
    // Frühling: noch nicht; im Sommer offline: nicht; im Sommer aktiv: erfüllt.
    updateDaily(state, DAY, {});
    expect(observe!.progress).toBe(0);
    state.cycle.elapsed = SEASON_SECONDS + 1;
    updateDaily(state, DAY, { offline: true });
    expect(observe!.progress).toBe(0);
    updateDaily(state, DAY, {});
    expect(observe!.done).toBe(true);
    state.meta.journal.communities.push('humus');
    updateDaily(state, DAY, { offline: true });
    expect(community!.done).toBe(true);
  });
});

describe('Belohnung', () => {
  it('Samen-Sekunden wie beim Ablehnen, Zähler, ein Hinweis je Ziel', () => {
    const state = withGoals(stateAt(5, ['earthworm', 'woodlouse', 'bluetit']), [goal('growth', 1), goal('seeds', 1e9)]);
    state.seeds = 100;
    const expected = seedSeconds(state, DAILY_SEED_SECONDS);
    expect(expected).toBeGreaterThan(5);
    const result = updateDaily(state, DAY, { activeSeconds: 1 });
    expect(result.completed).toEqual([{ goal: state.meta.daily.goals[0], seeds: expected, rare: false }]);
    expect(state.seeds).toBeCloseTo(100 + expected, 9);
    expect(state.meta.daily.goalsDone).toBe(1);
    // Ein erfülltes Ziel belohnt nie zweimal.
    expect(updateDaily(state, DAY, { activeSeconds: 1 }).completed).toEqual([]);
    expect(state.meta.daily.goalsDone).toBe(1);
  });

  it('seltene Begegnung: Tierkarten ab „selten“; bei vollem Stapel stattdessen Samen', () => {
    const state = withGoals(stateAt(4), [goal('growth', 1, { reward: 'rare' })]);
    const result = updateDaily(state, DAY, { activeSeconds: 1 });
    expect(result.completed[0]).toMatchObject({ rare: true, seeds: 0 });
    const encounter = state.pendingEncounters.at(-1)!;
    expect(encounter.type).toBe('animal');
    expect(encounter.cards.length).toBeGreaterThan(0);
    for (const id of encounter.cards) expect(SPECIES_BY_ID.get(id)!.rarity).toBeGreaterThanOrEqual(1);

    const full = withGoals(stateAt(4), [goal('growth', 1, { reward: 'rare' })]);
    for (let i = 0; i < MAX_PENDING_ENCOUNTERS; i++) full.pendingEncounters.push({ type: 'animal', cards: ['earthworm'], rerolls: 0 });
    const fallback = updateDaily(full, DAY, { activeSeconds: 1 });
    expect(fallback.completed[0]!.rare).toBe(false);
    expect(fallback.completed[0]!.seeds).toBe(seedSeconds(full, DAILY_SEED_SECONDS));
    expect(full.pendingEncounters.length).toBe(MAX_PENDING_ENCOUNTERS);
  });
});

describe('Serie und Tageswechsel', () => {
  /** Erfüllt am Tag `day` das erste Ziel (Wachstum mit Zielwert 1). */
  function play(state: GameState, day: string) {
    updateDaily(state, day, {});
    state.meta.daily.goals = [goal('growth', 1), goal('seeds', 1e12)];
    return updateDaily(state, day, { activeSeconds: 1 });
  }

  it('Serie wächst Tag für Tag, eine Lücke setzt sie zurück – ohne weitere Strafe', () => {
    const state = stateAt(2, ['earthworm']);
    play(state, '2026-10-21');
    expect(state.meta.daily.streak).toBe(1);
    play(state, '2026-10-22');
    expect(state.meta.daily.streak).toBe(2);
    expect(dailyStreak(state, '2026-10-23')).toBe(2); // gestern erfüllt: Serie läuft noch
    expect(dailyStreak(state, '2026-10-24')).toBe(0); // ein Tag fehlt
    const seeds = state.seeds;
    const rolled = updateDaily(state, '2026-10-24', {});
    expect(rolled.rolled).toBe(true);
    expect(state.meta.daily.streak).toBe(0);
    expect(state.seeds).toBe(seeds); // nichts weggenommen
    expect(state.meta.daily.goalsDone).toBe(2);
    play(state, '2026-10-24');
    expect(state.meta.daily.streak).toBe(1);
    expect(state.meta.daily.bestStreak).toBe(2);
    expect(state.meta.daily.lastDay).toBe('2026-10-24');
  });

  it('alle Ziele erfüllt: perfekter Tag, einmal', () => {
    const state = withGoals(stateAt(2, ['earthworm']), [goal('growth', 1), goal('seeds', 1e-6)]);
    const result = updateDaily(state, DAY, { activeSeconds: 1 });
    expect(result.perfect).toBe(true);
    expect(state.meta.daily.perfectDays).toBe(1);
    expect(updateDaily(state, DAY, { activeSeconds: 1 }).perfect).toBe(false);
    expect(state.meta.daily.perfectDays).toBe(1);
  });

  it('gleicher Tag und zurückgestellte Uhr: keine neuen Ziele; neuer Tag: neue Ziele mit frischem Fortschritt', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse']);
    expect(updateDaily(state, DAY, {}).rolled).toBe(true);
    const goals = structuredClone(state.meta.daily.goals);
    expect(goals.length).toBeGreaterThanOrEqual(2);
    expect(updateDaily(state, DAY, {}).rolled).toBe(false);
    expect(updateDaily(state, '2026-10-20', {}).rolled).toBe(false);
    expect(updateDaily(state, 'kaputt', {}).rolled).toBe(false);
    expect(state.meta.daily.day).toBe(DAY);
    expect(state.meta.daily.goals.map((g) => g.kind)).toEqual(goals.map((g) => g.kind));
    expect(updateDaily(state, '2026-10-22', {}).rolled).toBe(true);
    expect(state.meta.daily.day).toBe('2026-10-22');
    expect(state.meta.daily.goals.every((g) => g.progress === 0 && !g.done)).toBe(true);
  });

  it('Neuer Zyklus: Tag, Serie und erfüllte Ziele bleiben, offene passen sich an und bleiben schaffbar', () => {
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      for (let d = 0; d < 8; d++) {
        const day = addDays(DAY, d);
        const state = forest(seed, 6);
        updateDaily(state, day, {});
        const [first, ...rest] = state.meta.daily.goals;
        // Das erste Ziel ist erfüllt, ein Wachstums-/Samen-Ziel halb.
        first!.done = true;
        first!.progress = first!.target;
        for (const g of rest) if (g.kind === 'growth' || g.kind === 'seeds') g.progress = g.target / 2;
        const before = structuredClone(state.meta.daily);
        expect(startNewCycle(state, 0).ok).toBe(true);
        const after = state.meta.daily;
        expect(after.day).toBe(before.day);
        expect(after.goals[0]).toEqual(before.goals[0]);
        expect(after.goals.length).toBe(before.goals.length);
        after.goals.forEach((g, i) => {
          const old = before.goals[i]!;
          if (old.done || g.kind !== old.kind) return;
          expect(g.reward).toBe(old.reward);
          // Wachstum und Samen: neuer Zielwert für den jungen Baum, Anteil bleibt.
          if (g.kind === 'growth' || g.kind === 'seeds') {
            expect(g.target).toBeLessThan(old.target);
            expect(g.progress / g.target).toBeCloseTo(0.5, 9);
          }
        });
        expect(updateDaily(state, day, {}).rolled).toBe(false);
        // Schaffbar: Ein kurzer Besuch im neuen Zyklus erfüllt alle Ziele.
        visit(state, day, 900);
        expect(state.meta.daily.goals.filter((g) => !g.done), `Seed ${seed}, ${day}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBe(24);
  });

  it('Tag mehr als einen Tag in der Zukunft: zurück auf heute, neue Ziele, Serie 0; ein Tag Vorsprung (Zeitzone) bleibt', () => {
    const state = stateAt(3, ['earthworm', 'woodlouse']);
    updateDaily(state, '2026-10-30', {});
    state.meta.daily.streak = 4;
    state.meta.daily.bestStreak = 4;
    state.meta.daily.lastDay = '2026-10-30';
    const result = updateDaily(state, DAY, {});
    expect(result.rolled).toBe(true);
    expect(state.meta.daily).toMatchObject({ day: DAY, streak: 0, bestStreak: 4, lastDay: '' });
    expect(state.meta.daily.goals.map((g) => g.kind)).toEqual(generateDailyGoals(state, DAY).map((g) => g.kind));
    // Danach läuft der Tag normal weiter.
    expect(updateDaily(state, DAY, {}).rolled).toBe(false);
    expect(updateDaily(state, '2026-10-22', {}).rolled).toBe(true);
    // Nur ein Tag Vorsprung (anderes Gerät östlich der Datumsgrenze): nichts zurücksetzen.
    const ahead = stateAt(3, ['earthworm']);
    updateDaily(ahead, '2026-10-22', {});
    ahead.meta.daily.streak = 2;
    ahead.meta.daily.lastDay = '2026-10-22';
    expect(updateDaily(ahead, DAY, {}).rolled).toBe(false);
    expect(ahead.meta.daily.streak).toBe(2);
    expect(dailyStreak(ahead, DAY)).toBe(2);
  });

  it('Serie bei negativer Lücke (Zeitzone, Uhr zurück) weiter angezeigt', () => {
    const state = stateAt(2);
    state.meta.daily.streak = 3;
    state.meta.daily.lastDay = '2026-10-22';
    expect(dailyStreak(state, '2026-10-21')).toBe(3);
    expect(dailyStreak(state, '2026-10-20')).toBe(3);
    expect(dailyStreak(state, '2026-10-24')).toBe(0);
  });

  it('Wachstum und Samen zählen die tatsächlich gutgeschriebene Menge, wenn sie übergeben wird', () => {
    const state = withGoals(stateAt(3, ['earthworm']), [goal('growth', 1e9), goal('seeds', 1e9)]);
    updateDaily(state, DAY, { activeSeconds: 10, produced: { growth: 12.5, seeds: 3 } });
    expect(state.meta.daily.goals.map((g) => g.progress)).toEqual([12.5, 3]);
    updateDaily(state, DAY, { offline: true, produced: { growth: 100, seeds: 100 } });
    updateDaily(state, DAY, { produced: { growth: NaN, seeds: -5 } });
    expect(state.meta.daily.goals.map((g) => g.progress)).toEqual([12.5, 3]);
  });
});

describe('Spielstand v12', () => {
  it('v11 → v12: Tagesziele mit festem Startwert, noch kein Tag, keine Serie; zweimal Laden gleich', () => {
    const state = createInitialState(0, 99);
    tick(state, 30);
    const { daily: _daily, ...meta } = state.meta;
    const raw = JSON.stringify({ ...state, version: 11, meta });
    const a = loadGame(raw, 0)!.state;
    const b = loadGame(raw, 0)!.state;
    expect(SAVE_VERSION).toBe(12);
    expect(a.version).toBe(12);
    expect(a.meta.daily).toMatchObject({ day: '', goals: [], streak: 0, bestStreak: 0, lastDay: '', goalsDone: 0, perfectDays: 0 });
    expect(a.meta.daily.seed).toBeGreaterThan(0);
    expect(b.meta.daily.seed).toBe(a.meta.daily.seed);
    // Ein Feld gleichen Namens in einem v11-Stand zählt nicht.
    const forged = loadGame(JSON.stringify({ ...state, version: 11, meta: { ...meta, daily: { seed: 7, streak: 99 } } }), 0)!.state;
    expect(forged.meta.daily.streak).toBe(0);
    expect(forged.meta.daily.seed).toBe(a.meta.daily.seed);
  });

  it('Roundtrip mit Zielen und Serie', () => {
    const state = forest(2, 4);
    play2(state);
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded.meta.daily).toEqual(state.meta.daily);
  });

  /** Ein gespielter Tag mit Fortschritt und Serie. */
  function play2(state: GameState) {
    updateDaily(state, '2026-10-20', {});
    visit(state, '2026-10-20', 900);
    updateDaily(state, DAY, {});
    updateDaily(state, DAY, { activeSeconds: 3 });
    expect(state.meta.daily.streak).toBe(1);
  }

  it('robustes Laden: unbekannte Arten, fehlende Parameter, kaputte Zahlen, zu viele Ziele, ungültiger Tag', () => {
    const state = createInitialState(0, 5);
    const daily = {
      seed: 0,
      day: DAY,
      goals: [
        { kind: 'fly-to-moon', target: 1, progress: 0, reward: 'seeds', done: false },
        { kind: 'observe', target: 2, progress: 1, reward: 'seeds', done: false }, // ohne Gattung
        { kind: 'growth', target: 100, progress: 1e9, reward: 'gold', done: false },
        { kind: 'growth', target: 50, progress: 1, reward: 'seeds', done: false }, // doppelt
        { kind: 'decide', target: NaN, progress: 0, reward: 'seeds', done: false },
        { kind: 'satisfaction', target: 80, progress: -5, genus: 'soil', reward: 'rare', done: 'ja' },
        { kind: 'community', target: 1, progress: 0, community: 'humus', reward: 'seeds', done: true },
        { kind: 'harmony', target: 300, progress: 0, harmony: 20, reward: 'seeds', done: false },
      ],
      streak: -3,
      bestStreak: 'viel',
      lastDay: '2026-02-30',
      goalsDone: 2.7,
      perfectDays: 1e12,
    };
    const loaded = loadGame(JSON.stringify({ ...state, meta: { ...state.meta, daily } }), 0)!.state.meta.daily;
    expect(loaded.seed).toBeGreaterThan(0);
    expect(loaded.goals).toEqual([
      { kind: 'growth', target: 100, progress: 100, reward: 'seeds', done: false },
      { kind: 'satisfaction', target: 80, progress: 0, genus: 'soil', reward: 'rare', done: false },
      { kind: 'community', target: 1, progress: 1, community: 'humus', reward: 'seeds', done: true },
    ]);
    expect(loaded).toMatchObject({ day: DAY, streak: 0, bestStreak: 0, lastDay: '', goalsDone: 2, perfectDays: 1e9 });
    const noDay = loadGame(JSON.stringify({ ...state, meta: { ...state.meta, daily: { ...daily, day: '21.10.' } } }), 0)!.state.meta.daily;
    expect(noDay.day).toBe('');
    expect(noDay.goals).toEqual([]);
    // Fehlt das Feld ganz (v12), gibt es Startwerte statt eines Absturzes.
    const missing = loadGame(JSON.stringify({ ...state, meta: { ...state.meta, daily: null } }), 0)!.state.meta.daily;
    expect(missing).toMatchObject({ day: '', goals: [], streak: 0 });
  });
});
