import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, PATIENCE_SECONDS, type Achievement } from '../src/content/achievements';
import { COMMUNITIES } from '../src/content/communities';
import { CORRIDORS, LANDSCAPE_SITES, SITE_IDS } from '../src/content/landscape';
import { EVENTS } from '../src/content/events';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { PLANTS } from '../src/content/plants';
import { YEAR_SECONDS } from '../src/content/seasons';
import { COMMON_SPECIES, KENNARTEN, SPECIES } from '../src/content/species';
import { CHAPTER_IDS } from '../src/content/chronicle';
import { STAGES } from '../src/content/stages';
import { MAIN_TREES } from '../src/content/trees';
import { GENERA } from '../src/content/types';
import { VISITORS } from '../src/content/visitors';
import {
  achievementProgress,
  checkAchievements,
  hasAchievement,
  isAchieved,
  targetOf,
  unlockedAchievements,
  valueOf,
} from '../src/core/achievements';
import { codeFromJson, exportCode, importCode, loadGame, serialize } from '../src/core/save';
import { SAVE_VERSION, createInitialState, createSite, createStats, type GameState } from '../src/core/state';
import { recordDiscoveries, simulateOffline, startNewCycle, tick } from '../src/core/tick';
import {
  achievementCountText,
  achievementUnlockedText,
  achievementsBackfilledText,
  progressText,
  toAchievementTimeProgress,
  toJournalAchievements,
} from '../src/ui/achievement-view';
import { stateAt } from './helpers';

/**
 * Erfolge (DESIGN_V2.md 18, Spielstand v9): Inhalte, jede Bedingungsart, checkAchievements,
 * Neuer Zyklus, online = offline, Migration v8 → v9, robustes Laden, Export/Import und die
 * Texte der Oberfläche.
 */

const byId = (id: string): Achievement => ACHIEVEMENTS_BY_ID.get(id)!;

/** Hain mit Tieren und Pflanzen – bereit für den Neuen Zyklus. */
function groveState(seed = 5): GameState {
  const state = stateAt(NEW_CYCLE_MIN_STAGE, ['earthworm', 'robin', 'bluetit', 'bee'], seed);
  state.plants = ['hazel', 'moss'];
  state.seeds = 1234;
  state.meta.journal.plants = ['hazel', 'moss'];
  recordDiscoveries(state);
  return state;
}

/** Der aktuelle Stand als Rohdaten mit Patch. */
function raw(state: GameState, patch: (data: Record<string, any>) => void): string {
  const data = JSON.parse(serialize(state));
  patch(data);
  return JSON.stringify(data);
}

describe('Inhalte', () => {
  it('20–40 Erfolge, eindeutige IDs, Titel, Symbol und Beschreibung', () => {
    // Obergrenze seit Phase 9 (2b): 37 Erfolge, davon 27 ohne Landschaft (DESIGN_V2.md 26.5).
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(40);
    expect(ACHIEVEMENTS_BY_ID.size).toBe(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map((a) => a.title)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.id, a.id).toMatch(/^[a-z0-9-]+$/);
      expect(a.icon.length, a.id).toBeGreaterThan(0);
      expect(a.title.length, a.id).toBeGreaterThan(0);
      expect(a.description, a.id).toMatch(/\.$/);
    }
  });

  it('Ziele sind erreichbar: > 0 und höchstens so groß wie die Inhalte', () => {
    for (const a of ACHIEVEMENTS) {
      const c = a.condition;
      const target = targetOf(c);
      expect(target, a.id).toBeGreaterThan(0);
      expect(Number.isFinite(target), a.id).toBe(true);
      if (c.kind === 'stage') expect(target, a.id).toBeLessThan(STAGES.length);
      if (c.kind === 'journal') {
        const total = { species: SPECIES.length, kennarten: SPECIES.length, plants: PLANTS.length, communities: COMMUNITIES.length }[c.what];
        expect(target, a.id).toBeLessThanOrEqual(total);
      }
      if (c.kind === 'genera') expect(target, a.id).toBeLessThanOrEqual(GENERA.length);
      if (c.kind === 'trees') expect(target, a.id).toBeLessThanOrEqual(MAIN_TREES.length);
      if (c.kind === 'forests' || c.kind === 'ancientForests' || c.kind === 'chronicles') expect(target, a.id).toBeLessThanOrEqual(SITE_IDS.length);
      if (c.kind === 'corridors') expect(target, a.id).toBeLessThanOrEqual(CORRIDORS.length);
      // Gekauft höchstens 10 − Gratis-Korridore: hinge an der Gründungs-Reihenfolge (24.12).
      if (c.kind === 'corridors' && c.bought) expect(c.atLeast, a.id).not.toBe('all');
      if (c.kind === 'stat') expect(Object.keys(createStats()), a.id).toContain(c.key);
    }
  });

  it('verraten nichts: keine Namen von Arten, Pflanzen, Gemeinschaften, Gästen, Ereignissen, Standorten, Korridoren oder Hauptbäumen', () => {
    const names = [...SPECIES, ...PLANTS, ...COMMUNITIES, ...VISITORS, ...EVENTS, ...LANDSCAPE_SITES, ...CORRIDORS, ...MAIN_TREES].map((x) =>
      'name' in x ? x.name : '',
    );
    // Auch die Waldtypen der Standorte (z. B. „Hartholzaue“).
    names.push(...LANDSCAPE_SITES.map((x) => x.forestType));
    for (const a of ACHIEVEMENTS) {
      const text = `${a.title} ${a.description}`;
      for (const name of names.filter((n) => n.length > 3)) expect(text, `${a.id}: ${name}`).not.toContain(name);
    }
  });

  it('decken das ganze Spiel ab (jede Bedingungsart mindestens einmal)', () => {
    const kinds = new Set(ACHIEVEMENTS.map((a) => a.condition.kind));
    expect([...kinds].sort()).toEqual(['ancientForests', 'chronicles', 'corridors', 'cycleTime', 'cycles', 'daily', 'forests', 'genera', 'journal', 'stage', 'stat', 'trees']);
  });
});

describe('Bedingungen', () => {
  it('stage: Stufe des laufenden Zyklus', () => {
    const s = stateAt(1);
    expect(isAchieved(s, byId('sapling'))).toBe(false);
    s.stage = 2;
    expect(isAchieved(s, byId('sapling'))).toBe(true);
    expect(isAchieved(s, byId('grove'))).toBe(false);
    s.stage = STAGES.length - 1;
    expect(isAchieved(s, byId('ancient-forest'))).toBe(true);
  });

  it('stage: nachweislich erreichte Stufe (minStage) zählt mit, ohne den Stand zu ändern', () => {
    const s = stateAt(0);
    expect(isAchieved(s, byId('grove'), { minStage: NEW_CYCLE_MIN_STAGE })).toBe(true);
    expect(isAchieved(s, byId('ancient-forest'), { minStage: NEW_CYCLE_MIN_STAGE })).toBe(false);
    // Kaputte Werte zählen nicht; die höhere der beiden Stufen gilt.
    expect(valueOf(s, byId('sapling').condition, { minStage: Number.NaN })).toBe(0);
    expect(valueOf(s, byId('sapling').condition, { minStage: -3 })).toBe(0);
    s.stage = 6;
    expect(valueOf(s, byId('grove').condition, { minStage: NEW_CYCLE_MIN_STAGE })).toBe(6);
    s.stage = 0;
    expect(checkAchievements(s, { minStage: NEW_CYCLE_MIN_STAGE })).toEqual(['sapling', 'grove']);
    expect(s.stage).toBe(0);
    expect(checkAchievements(s)).toEqual([]);
  });

  it('journal: Arten, Pflanzen, Gemeinschaften – nur bekannte IDs, je einmal; „alle“', () => {
    const s = createInitialState(0, 1);
    s.meta.journal.species = ['robin', 'robin', 'drache', 'bee', 'mole', 'vole'];
    expect(valueOf(s, byId('species-5').condition)).toBe(4);
    s.meta.journal.species.push('earthworm');
    expect(isAchieved(s, byId('species-5'))).toBe(true);
    expect(achievementProgress(s, byId('species-16'))).toEqual({ value: 5, target: 16 });
    // „Alle Bewohner“ ohne Kennarten (26.3): erreichbar ohne Landschaft; Kennarten zählen eigens.
    s.meta.journal.species = COMMON_SPECIES.map((x) => x.id);
    expect(targetOf(byId('species-all').condition)).toBe(SPECIES.length - KENNARTEN.length);
    expect(isAchieved(s, byId('species-all'))).toBe(true);
    expect(valueOf(s, byId('kennarten-all').condition)).toBe(0);
    s.meta.journal.species = [...KENNARTEN.map((x) => x.id), 'robin'];
    expect(valueOf(s, byId('species-all').condition)).toBe(1);
    expect(targetOf(byId('kennarten-all').condition)).toBe(6);
    expect(isAchieved(s, byId('kennarten-all'))).toBe(true);
    expect(isAchieved(s, byId('species-all'))).toBe(false);
    s.meta.journal.species = SPECIES.map((x) => x.id);
    expect(isAchieved(s, byId('species-all'))).toBe(true);

    s.meta.journal.plants = PLANTS.slice(0, 4).map((p) => p.id);
    expect(isAchieved(s, byId('plants-5'))).toBe(false);
    s.meta.journal.plants = PLANTS.map((p) => p.id);
    expect(isAchieved(s, byId('plants-5'))).toBe(true);
    expect(isAchieved(s, byId('plants-all'))).toBe(true);

    s.meta.journal.communities = [COMMUNITIES[0]!.id];
    expect(isAchieved(s, byId('community-1'))).toBe(true);
    expect(isAchieved(s, byId('community-5'))).toBe(false);
    s.meta.journal.communities = COMMUNITIES.map((c) => c.id);
    expect(isAchieved(s, byId('community-all'))).toBe(true);
  });

  it('genera: jede Gattung mindestens einmal im Tagebuch', () => {
    const s = createInitialState(0, 1);
    const one = (g: string) => SPECIES.find((x) => x.genus === g)!.id;
    s.meta.journal.species = GENERA.slice(0, -1).map(one);
    expect(achievementProgress(s, byId('all-genera'))).toEqual({ value: GENERA.length - 1, target: GENERA.length });
    s.meta.journal.species.push(one(GENERA[GENERA.length - 1]!), 'drache');
    expect(isAchieved(s, byId('all-genera'))).toBe(true);
  });

  it('stat: Zähler, beste Harmonie und Spielzeit; NaN und Negatives zählen als 0', () => {
    const s = createInitialState(0, 1);
    s.meta.stats.visitorsHosted = 9;
    expect(isAchieved(s, byId('visitor-1'))).toBe(true);
    expect(isAchieved(s, byId('visitor-10'))).toBe(false);
    s.meta.stats.visitorsHosted = 10;
    expect(isAchieved(s, byId('visitor-10'))).toBe(true);
    s.meta.stats.bestHarmony = 59.49;
    expect(isAchieved(s, byId('harmony-30'))).toBe(true);
    expect(isAchieved(s, byId('harmony-60'))).toBe(false);
    // Gerundet wie in der Anzeige (#42): „59,5“ steht dort als 60 – also erreicht.
    s.meta.stats.bestHarmony = 59.5;
    expect(valueOf(s, byId('harmony-60').condition)).toBe(60);
    expect(isAchieved(s, byId('harmony-60'))).toBe(true);
    expect(achievementProgress(s, byId('harmony-60'))).toEqual({ value: 60, target: 60 });
    s.meta.stats.bestHarmony = 149.4;
    expect(isAchieved(s, byId('harmony-150'))).toBe(false);
    s.meta.stats.bestHarmony = 149.5;
    expect(isAchieved(s, byId('harmony-150'))).toBe(true);
    s.meta.stats.bestHarmony = Number.NaN;
    expect(valueOf(s, byId('harmony-30').condition)).toBe(0);
    s.meta.stats.bestHarmony = Number.POSITIVE_INFINITY;
    expect(isAchieved(s, byId('harmony-150'))).toBe(true);
    s.meta.stats.playSeconds = PATIENCE_SECONDS;
    expect(isAchieved(s, byId('patience'))).toBe(true);
    s.meta.stats.eventsDecided = Number.NaN;
    s.meta.stats.careRanksBought = -5;
    expect(valueOf(s, byId('events-5').condition)).toBe(0);
    expect(valueOf(s, byId('care-10').condition)).toBe(0);
    s.meta.stats.careRanksBought = Number.POSITIVE_INFINITY;
    expect(isAchieved(s, byId('care-10'))).toBe(true);
    expect(achievementProgress(s, byId('care-10'))).toEqual({ value: 10, target: 10 });
  });

  it('cycles: abgeschlossene Zyklen = Nummer − 1', () => {
    const s = createInitialState(0, 1);
    expect(valueOf(s, byId('cycle-1').condition)).toBe(0);
    s.cycle.number = 4;
    expect(isAchieved(s, byId('cycle-3'))).toBe(true);
    expect(isAchieved(s, byId('cycle-10'))).toBe(false);
    s.cycle.number = 1e9;
    expect(isAchieved(s, byId('cycle-10'))).toBe(true);
  });

  it('trees: drei Hauptbaum-Arten gewachsen (unbekannte und doppelte zählen nicht)', () => {
    const s = createInitialState(0, 1);
    s.meta.stats.grownTrees = ['oak', 'oak', 'drache' as 'oak', 'beech'];
    // Fest drei (24.12, 25.7) – unabhängig davon, wie viele Arten es gibt.
    expect(byId('trees-all').condition).toEqual({ kind: 'trees', atLeast: 3 });
    expect(achievementProgress(s, byId('trees-all'))).toEqual({ value: 2, target: 3 });
    expect(isAchieved(s, byId('trees-all'))).toBe(false);
    s.meta.stats.grownTrees = MAIN_TREES.map((t) => t.id);
    expect(isAchieved(s, byId('trees-all'))).toBe(true);
  });

  it('cycleTime: ein volles Jahr im laufenden Zyklus', () => {
    const s = createInitialState(0, 1);
    s.cycle.elapsed = YEAR_SECONDS - 1e-9;
    expect(isAchieved(s, byId('full-year'))).toBe(false);
    s.cycle.elapsed = YEAR_SECONDS;
    expect(isAchieved(s, byId('full-year'))).toBe(true);
    s.cycle.elapsed = Number.NaN;
    expect(isAchieved(s, byId('full-year'))).toBe(false);
  });
});

describe('checkAchievements', () => {
  it('neues Spiel: nichts; schaltet frei, hängt an, idempotent, ACHIEVEMENTS-Reihenfolge', () => {
    const s = createInitialState(0, 1);
    expect(checkAchievements(s)).toEqual([]);
    expect(s.meta.achievements).toEqual([]);
    s.meta.stats.visitorsHosted = 1;
    s.stage = 2;
    expect(checkAchievements(s)).toEqual(['sapling', 'visitor-1']);
    expect(checkAchievements(s)).toEqual([]);
    s.meta.stats.bestHarmony = 30;
    expect(checkAchievements(s)).toEqual(['harmony-30']);
    expect(s.meta.achievements).toEqual(['sapling', 'visitor-1', 'harmony-30']);
    expect(hasAchievement(s, 'harmony-30')).toBe(true);
    expect(unlockedAchievements(s).map((a) => a.id)).toEqual(s.meta.achievements);
  });

  it('freigeschaltet bleibt freigeschaltet, auch wenn die Bedingung nicht mehr gilt', () => {
    const s = stateAt(5);
    expect(checkAchievements(s)).toEqual(['sapling', 'grove']);
    s.stage = 0;
    expect(checkAchievements(s)).toEqual([]);
    expect(s.meta.achievements).toEqual(['sapling', 'grove']);
  });

  it('alles erfüllt: alle auf einmal, danach schneller Ausstieg', () => {
    const s = createInitialState(0, 1);
    s.stage = STAGES.length - 1;
    s.meta.journal.species = SPECIES.map((x) => x.id);
    s.meta.journal.plants = PLANTS.map((p) => p.id);
    s.meta.journal.communities = COMMUNITIES.map((c) => c.id);
    s.meta.stats = { ...createStats(), playSeconds: 1e300, bestHarmony: 1e300, visitorsHosted: 99, eventsDecided: 99, careRanksBought: 99, wildwechselChosen: 1, grownTrees: MAIN_TREES.map((t) => t.id) };
    s.cycle.number = 11;
    s.cycle.elapsed = YEAR_SECONDS;
    s.meta.daily = { ...s.meta.daily, bestStreak: 1e300, goalsDone: 1e300, perfectDays: 1e300 };
    // Ganze Landschaft: alle Wälder Urwald, alle Korridore, die Speichen gratis.
    const spokes = CORRIDORS.filter((c) => c.sites.includes('home')).map((c) => c.id);
    s.meta.landscape = {
      active: 'home',
      // Jede Chronik vollständig (26.4).
      sites: SITE_IDS.map((id) => ({
        ...createSite(id),
        memory: 1000,
        ancient: true,
        chronicle: CHAPTER_IDS.map((chapter) => ({ chapter, cycle: null, season: null })),
      })),
      corridors: CORRIDORS.map((c) => c.id),
      freeCorridors: spokes,
      announced: true,
    };
    expect(checkAchievements(s)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(checkAchievements(s)).toEqual([]);
  });
});

describe('Neuer Zyklus', () => {
  it('prüft vor dem Zurücksetzen (Stufe, Jahr) und danach (Zyklen, Baumarten)', () => {
    const s = groveState();
    s.cycle.elapsed = YEAR_SECONDS;
    s.meta.journal.plants.push('beech', 'pine');
    s.meta.stats.grownTrees = ['oak', 'beech'];
    const result = startNewCycle(s, 1, 'pine');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const id of ['sapling', 'grove', 'full-year', 'cycle-1', 'trees-all']) expect(result.achievements).toContain(id);
    // Vor dem Zurücksetzen erreichte Erfolge stehen vor denen danach.
    expect(result.achievements.indexOf('grove')).toBeLessThan(result.achievements.indexOf('cycle-1'));
    expect(s.meta.achievements).toEqual(result.achievements);
    expect(s.stage).toBe(0);
  });

  it('gesperrter Zyklus: nichts geprüft, nichts geändert', () => {
    const s = stateAt(2);
    expect(startNewCycle(s, 1).ok).toBe(false);
    expect(s.meta.achievements).toEqual([]);
  });
});

describe('online = offline', () => {
  it('viele kleine Ticks mit Prüfung je Tick und ein großer mit einer Prüfung: dieselben Erfolge', () => {
    const online = groveState(1234);
    startNewCycle(online, 0);
    const offline = structuredClone(online);
    for (let i = 0; i < 2 * 3600; i++) {
      tick(online, 1);
      checkAchievements(online);
    }
    simulateOffline(offline, 2 * 3600);
    checkAchievements(offline);
    // Jahr und Stufen sind in 2 Stunden sicher dabei.
    expect(offline.meta.achievements).toContain('full-year');
    expect([...offline.meta.achievements].sort()).toEqual([...online.meta.achievements].sort());
    // Gleichzeitig freigeschaltete folgen ACHIEVEMENTS – offline also genau diese Reihenfolge.
    const order = ACHIEVEMENTS.map((a) => a.id);
    const offlineFresh = offline.meta.achievements.filter((id) => !['grove', 'sapling', 'cycle-1'].includes(id));
    expect(offlineFresh).toEqual([...offlineFresh].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });

  it('tick allein schaltet nichts frei (Prüfung erst durch checkAchievements)', () => {
    const s = groveState(7);
    tick(s, YEAR_SECONDS);
    expect(s.meta.achievements).toEqual([]);
    expect(checkAchievements(s)).toContain('full-year');
  });
});

describe('Spielstand v9', () => {
  /** Ein v8-Stand ohne `meta.achievements` (wie vor diesem Update gespeichert). */
  function rawV8(state: GameState, patch: (d: Record<string, any>) => void = () => {}): string {
    return raw(state, (d) => {
      d.version = 8;
      delete d.meta.achievements;
      patch(d);
    });
  }

  it('v8 → v9: schaltet still frei, was der Stand erfüllt, und meldet die Anzahl', () => {
    expect(SAVE_VERSION).toBe(17);
    const s = groveState(3);
    s.meta.stats.visitorsHosted = 2;
    s.cycle.number = 2;
    const loaded = loadGame(rawV8(s), 0)!;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    const expected = structuredClone(loaded.state);
    expected.meta.achievements = [];
    checkAchievements(expected);
    expect(loaded.state.meta.achievements).toEqual(expected.meta.achievements);
    expect(loaded.state.meta.achievements).toEqual(expect.arrayContaining(['sapling', 'grove', 'visitor-1', 'cycle-1']));
    expect(loaded.achievementsBackfilled).toBe(loaded.state.meta.achievements.length);
    // Danach ist nichts mehr nachzutragen – kein zweiter Hinweis.
    expect(checkAchievements(loaded.state)).toEqual([]);
    const again = loadGame(serialize(loaded.state), 0)!;
    expect(again.achievementsBackfilled).toBe(0);
    expect(again.state).toEqual(loaded.state);
  });

  it('v8 → v9 ab Zyklus 2: Stufen bis Hain kommen mit (Neuer Zyklus setzt Hain voraus)', () => {
    const s = createInitialState(0, 1);
    s.cycle.number = 4; // drei abgeschlossene Zyklen, jetzt wieder als Samen
    const loaded = loadGame(rawV8(s), 0)!;
    expect(loaded.state.stage).toBe(0); // Stand nicht verfälscht
    expect(loaded.state.meta.achievements).toEqual(['sapling', 'grove', 'cycle-1', 'cycle-3']);
    expect(loaded.state.meta.achievements).not.toContain('ancient-forest'); // nicht nachweisbar
    expect(loaded.achievementsBackfilled).toBe(4);
    expect(checkAchievements(loaded.state)).toEqual([]);
    // Erster Zyklus: nur, was der Stand zeigt.
    const first = loadGame(rawV8(stateAt(1)), 0)!;
    expect(first.state.meta.achievements).toEqual([]);
    expect(first.achievementsBackfilled).toBe(0);
  });

  it('v2 … v8 laden ohne Absturz; Nachtrag = Anzahl, zweites Laden trägt nichts nach', () => {
    for (let version = 2; version <= 8; version++) {
      for (const base of [createInitialState(0, 1), groveState(version)]) {
        base.cycle.number = version % 2 === 0 ? 1 : 3;
        const text = raw(base, (d) => {
          d.version = version;
          delete d.meta.achievements;
          if (version < 8) delete d.meta.stats;
        });
        const loaded = loadGame(text, 0);
        expect(loaded, `v${version}`).not.toBeNull();
        const { state, achievementsBackfilled } = loaded!;
        expect(state.version, `v${version}`).toBe(SAVE_VERSION);
        expect(achievementsBackfilled, `v${version}`).toBe(state.meta.achievements.length);
        const again = loadGame(serialize(state), 0)!;
        expect(again.achievementsBackfilled, `v${version}`).toBe(0);
        expect(again.state.meta.achievements, `v${version}`).toEqual(state.meta.achievements);
      }
      // Minimaler Stand dieser Version (fast alles fehlt).
      const bare = loadGame(JSON.stringify({ version, totalGrowth: 1e6, lastTick: 1 }), 10);
      expect(bare, `v${version} minimal`).not.toBeNull();
      expect(bare!.achievementsBackfilled).toBe(bare!.state.meta.achievements.length);
    }
  });

  it('v8 mit fremdem `meta.achievements`: zählt nicht', () => {
    const s = createInitialState(0, 1);
    const loaded = loadGame(rawV8(s, (d) => (d.meta.achievements = ['patience', 'cycle-10'])), 0)!;
    expect(loaded.state.meta.achievements).toEqual([]);
    expect(loaded.achievementsBackfilled).toBe(0);
  });

  it('ältere Stände (v1, v3, v7) laden ohne Absturz', () => {
    const v1 = loadGame(JSON.stringify({ version: 1, stage: 4, totalEnergy: 1e6, lastTick: 5 }), 10)!;
    expect(v1.state.meta.achievements).toEqual([]);
    expect(v1.achievementsBackfilled).toBe(0);
    const v3 = loadGame(JSON.stringify({ version: 3, totalGrowth: 1e9, seeds: 1, lastTick: 1, meta: { journal: { species: ['robin'] } } }), 10)!;
    expect(v3.state.meta.achievements.length).toBe(v3.achievementsBackfilled);
    expect(v3.state.meta.achievements).toContain('ancient-forest');
    const v7 = loadGame(rawV8(groveState(), (d) => ((d.version = 7), delete d.meta.stats)), 0)!;
    expect(v7.state.meta.achievements).toContain('grove');
  });

  it('robustes Laden: unbekannte IDs, Duplikate, falsche Typen; Erreichtes bleibt', () => {
    const s = createInitialState(0, 1);
    const load = (achievements: unknown) => loadGame(raw(s, (d) => (d.meta.achievements = achievements)), 0)!;
    for (const broken of [undefined, null, 'grove', 42, {}, [1, null, {}]]) {
      const r = load(broken);
      expect(r.state.meta.achievements, String(broken)).toEqual([]);
      expect(r.achievementsBackfilled).toBe(0);
    }
    // Nicht prüfbar (frühere Zyklen) – bleibt, auch wenn der Stand es gerade nicht zeigt.
    expect(load(['cycle-10', 'drache', 'grove', 'cycle-10', '__proto__', 7]).state.meta.achievements).toEqual(['cycle-10', 'grove']);
  });

  it('Roundtrip und Export/Import erhalten die Erfolge; ein v8-Code wird nachgetragen', () => {
    const s = groveState(9);
    checkAchievements(s);
    expect(s.meta.achievements.length).toBeGreaterThan(0);
    expect(loadGame(serialize(s), 0)!.state).toEqual(s);
    const imported = importCode(exportCode(s), 123);
    expect(imported.ok && imported.result.state.meta.achievements).toEqual(s.meta.achievements);
    expect(imported.ok && imported.result.achievementsBackfilled).toBe(0);
    const old = importCode(codeFromJson(rawV8(s)), 123);
    expect(old.ok && old.result.state.meta.achievements).toEqual(s.meta.achievements);
    expect(old.ok && old.result.achievementsBackfilled).toBe(s.meta.achievements.length);
  });
});

describe('Oberfläche: Texte und Naturtagebuch', () => {
  it('Hinweis beim Freischalten: einer, mehrere, viele, unbekannte', () => {
    expect(achievementUnlockedText([])).toBeNull();
    expect(achievementUnlockedText(undefined)).toBeNull();
    expect(achievementUnlockedText(['drache'])).toBeNull();
    expect(achievementUnlockedText(['grove'])).toBe('🏅 Erfolg: „Nicht mehr allein“');
    expect(achievementUnlockedText(['sapling', 'grove'])).toBe('🏅 2 neue Erfolge: „Ein dünner Stamm“ und „Nicht mehr allein“');
    expect(achievementUnlockedText(['sapling', 'grove', 'cycle-1', 'patience', 'drache'])).toBe(
      '🏅 4 neue Erfolge: „Ein dünner Stamm“, „Nicht mehr allein“, „Ein neuer Anfang“ und 1 weitere',
    );
  });

  it('Sammelhinweis nach der Migration', () => {
    expect(achievementsBackfilledText(0)).toBeNull();
    expect(achievementsBackfilledText(Number.NaN)).toBeNull();
    expect(achievementsBackfilledText(1)).toBe('🏅 1 Erfolg nachgetragen – zu finden unter Ziele › Erfolge.');
    expect(achievementsBackfilledText(7)).toBe('🏅 7 Erfolge nachgetragen – zu finden unter Ziele › Erfolge.');
  });

  it('Sammelhinweis nach der Migration mit neuen Erfolgen aus der Offline-Zeit: ein Satz', () => {
    expect(achievementsBackfilledText(3, [])).toBe('🏅 3 Erfolge nachgetragen – zu finden unter Ziele › Erfolge.');
    expect(achievementsBackfilledText(3, ['drache'])).toBe('🏅 3 Erfolge nachgetragen – zu finden unter Ziele › Erfolge.');
    expect(achievementsBackfilledText(3, ['plants-5'])).toBe('🏅 3 Erfolge nachgetragen, dazu neu: „Bunter Saum“ – zu finden unter Ziele › Erfolge.');
    expect(achievementsBackfilledText(1, ['sapling', 'grove'])).toBe(
      '🏅 1 Erfolg nachgetragen, dazu 2 neue: „Ein dünner Stamm“ und „Nicht mehr allein“ – zu finden unter Ziele › Erfolge.',
    );
    // Nichts nachgetragen: der gewohnte Hinweis für neue Erfolge.
    expect(achievementsBackfilledText(0, ['grove'])).toBe('🏅 Erfolg: „Nicht mehr allein“');
    expect(achievementsBackfilledText(Number.NaN, [])).toBeNull();
  });

  it('Kacheln: erreichte zuerst (Freischalt-Reihenfolge), dann offene mit Fortschritt', () => {
    const s = stateAt(5, ['robin', 'bee', 'earthworm']);
    s.meta.stats.visitorsHosted = 3;
    s.meta.stats.bestHarmony = 59.7;
    s.meta.stats.playSeconds = 2 * 3600 + 30;
    s.meta.achievements = ['visitor-1', 'grove'];
    const view = toJournalAchievements(s);
    // Ohne Landschaft fehlen ihre Erfolge (24.12).
    const visible = ACHIEVEMENTS.filter((a) => !a.requires);
    expect(view).toHaveLength(visible.length);
    expect(view.slice(0, 2).map((v) => [v.key, v.unlocked])).toEqual([
      ['visitor-1', true],
      ['grove', true],
    ]);
    expect(view.slice(2).every((v) => !v.unlocked)).toBe(true);
    const at = (id: string) => view.find((v) => v.key === id)!;
    expect(at('grove').progress).toBeUndefined();
    expect(at('sapling').progress).toBeUndefined(); // Stufe: keine Zahl
    expect(at('species-5').progress).toBe('3/5');
    expect(at('visitor-10').progress).toBe('3/10');
    expect(at('harmony-60').progress).toBe('59/60'); // 59,7 gerundet 60, aber nie „60/60“ ohne Erfolg
    s.meta.stats.bestHarmony = 58.6;
    expect(progressText(s, byId('harmony-60'))).toBe('59/60'); // wie die Anzeige
    expect(progressText(s, byId('harmony-150'))).toBe('59/150');
    expect(at('patience').progress).toBe('2 Std./10 Std.');
    expect(at('full-year').progress).toBe('0 Sek./12 Min.');
    expect(progressText(s, byId('species-all'))).toBe(`3/${COMMON_SPECIES.length}`);
    expect(achievementCountText(s)).toBe(`2/${visible.length}`);
  });

  it('Zeit-Erfolge: laufender Fortschritt außerhalb der Signatur, nur offene', () => {
    const s = createInitialState(0, 1);
    s.cycle.elapsed = 90;
    s.meta.stats.playSeconds = 3 * 3600;
    const view = toJournalAchievements(s);
    expect(view.filter((v) => v.live).map((v) => v.key)).toEqual(['full-year', 'patience']);
    expect(toAchievementTimeProgress(s)).toEqual([
      { key: 'full-year', progress: '1 Min./12 Min.' },
      { key: 'patience', progress: '3 Std./10 Std.' },
    ]);
    s.meta.achievements = ['patience'];
    expect(toAchievementTimeProgress(s).map((p) => p.key)).toEqual(['full-year']);
    expect(toJournalAchievements(s).find((v) => v.key === 'patience')!.live).toBeUndefined();
  });

  it('offene Kacheln verraten keine Namen von Unentdecktem', () => {
    const s = createInitialState(0, 1);
    const text = JSON.stringify(toJournalAchievements(s));
    for (const x of [...SPECIES, ...PLANTS, ...COMMUNITIES]) expect(text).not.toContain(x.name);
  });
});
