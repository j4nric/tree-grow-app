import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS_BY_ID } from '../src/content/achievements';
import { CORRIDORS_BY_ID, HOME_SITE, SITE_IDS, type SiteId } from '../src/content/landscape';
import { SEASON_SECONDS } from '../src/content/seasons';
import { MAIN_TREES } from '../src/content/trees';
import { achievementProgress, checkAchievements, isAchieved } from '../src/core/achievements';
import { appearsContext, cardStatus, ecosystemOf, environmentEffects, evaluate } from '../src/core/formulas';
import { ANCIENT_STAGE, wildwechselRoute } from '../src/core/landscape';
import { SAVE_KEY, codeFromJson, exportCode, importCode, isNewerSave, loadGame, serialize, storedSaveIsNewer } from '../src/core/save';
import { MAX_FOREST_MEMORY, SAVE_VERSION, createSite, type GameState, type LandscapeSite, type PendingEncounter } from '../src/core/state';
import {
  MAX_STAT_COUNT,
  chooseCard,
  drawEncounter,
  isTreeUnlocked,
  isTreeVisible,
  previewNewCycle,
  recordDiscoveries,
  rerollEncounter,
  simulateOffline,
  startNewCycle,
  tick,
  unlockedTrees,
} from '../src/core/tick';
import { isNewerSchema } from '../src/sync/policy';
import { stateAt } from './helpers';
import { MemoryStorage } from './memory-storage';

/**
 * Hauptbäume je Waldtyp und Spielstand v15 (DESIGN_V2.md 25, Phase 7 → 2b): Weißtanne und
 * Schwarzerle (Freischaltung über den Standort, Wirkung in evaluate), Wildwechsel-Markierung
 * `PendingEncounter.via` (24.6) mit dem Zähler `wildwechselChosen`, die Erfolge
 * `wildwechsel-1` und `landscape-trees` (24.12, 25.7), Migration v14 → v15 und robustes Laden.
 */

const SPOKES = ['home-floodplain', 'home-carr', 'home-beechwood', 'home-mountain', 'home-heath'];
const BEECH_FAUNA = ['robin', 'bluetit', 'squirrel', 'woodpecker', 'jay', 'deer', 'fox', 'owl', 'wolf', 'toad'];

/**
 * Stand mit Landschaft: Heimatwald und `founded` gegründet (ruhende Wälder voll und Urwald – die
 * Hähersaat bezahlt jede Gründung und jeden Korridor), aktiv `active`. `unlocked: false` = ohne
 * Freischaltung (kein Urwald-Erfolg, kein Gedächtnis).
 */
function landscape(
  stage: number,
  opts: {
    active?: SiteId;
    founded?: SiteId[];
    corridors?: string[];
    fauna?: Partial<Record<SiteId, string[]>>;
    animals?: string[];
    seed?: number;
    unlocked?: boolean;
  } = {},
): GameState {
  const state = stateAt(stage, opts.animals ?? [], opts.seed ?? 3);
  const active = opts.active ?? HOME_SITE;
  const unlocked = opts.unlocked ?? true;
  const ids = [...new Set<SiteId>([HOME_SITE, ...(opts.founded ?? []), active])];
  const sites: LandscapeSite[] = ids.map((id) => ({
    ...createSite(id),
    memory: id === active || !unlocked ? 0 : MAX_FOREST_MEMORY,
    ancient: unlocked && id !== active,
    fauna: id === active ? [] : [...(opts.fauna?.[id] ?? [])],
    // Was das Laden ab v16 ableitet: ruhende volle Urwälder haben „Uralt“ und „Gedächtnis“.
    chronicle:
      unlocked && id !== active
        ? [
            { chapter: 'ancient' as const, cycle: null, season: null },
            { chapter: 'memory' as const, cycle: null, season: null },
          ]
        : [],
  }));
  state.meta.forestMemory = unlocked ? 300 : 0;
  if (unlocked) state.meta.achievements.push('ancient-forest');
  state.meta.landscape = { active, sites, corridors: opts.corridors ?? [], freeCorridors: [], announced: unlocked };
  return state;
}

/** Stand mit Baumart und Jahreszeit (ohne Landschaft – die Wirkung hängt nicht an der Freischaltung). */
function withTree(stage: number, mainTree: GameState['cycle']['mainTree'], season: 0 | 1 | 2 | 3 = 0, animals: string[] = []): GameState {
  const state = stateAt(stage, animals, 1);
  state.cycle.mainTree = mainTree;
  state.cycle.elapsed = season * SEASON_SECONDS;
  return state;
}

const siteTree = (state: GameState, id: SiteId) => state.meta.landscape.sites.find((s) => s.id === id)?.mainTree;

describe('Freischaltung je Standort (25.2)', () => {
  it('vor der Landschaft: Weißtanne und Schwarzerle verborgen und gesperrt, die Baumwahl zeigt drei Arten', () => {
    const state = stateAt(5);
    for (const id of ['oak', 'beech', 'pine']) expect(isTreeVisible(state, id), id).toBe(true);
    for (const id of ['fir', 'alder']) {
      expect(isTreeVisible(state, id), id).toBe(false);
      expect(isTreeUnlocked(state, id), id).toBe(false);
    }
    expect(unlockedTrees(state)).toEqual(['oak']);
    expect(previewNewCycle(state).trees.map((t) => t.id)).toEqual(['oak', 'beech', 'pine']);
    // Nicht freigeschaltet, auch wenn der Stand die Landschaft hätte, aber nicht freigeschaltet ist.
    const locked = landscape(5, { unlocked: false });
    expect(isTreeVisible(locked, 'fir')).toBe(false);
  });

  it('Landschaft frei, Standort nicht gegründet: sichtbar, gesperrt (mit Hinweis in den Daten)', () => {
    const state = landscape(5);
    expect(isTreeVisible(state, 'fir')).toBe(true);
    expect(isTreeUnlocked(state, 'fir')).toBe(false);
    const trees = previewNewCycle(state).trees;
    expect(trees.map((t) => t.id)).toEqual(['oak', 'beech', 'pine', 'fir', 'alder']);
    expect(trees.filter((t) => t.unlocked).map((t) => t.id)).toEqual(['oak']);
  });

  it('je Standort: Bergmischwald → Weißtanne, Erlenbruch → Schwarzerle; unbekannte Arten nie', () => {
    expect(unlockedTrees(landscape(5, { founded: ['mountain'] }))).toEqual(['oak', 'fir']);
    expect(unlockedTrees(landscape(5, { founded: ['carr'] }))).toEqual(['oak', 'alder']);
    expect(unlockedTrees(landscape(5, { founded: ['carr', 'mountain', 'heath'] }))).toEqual(['oak', 'fir', 'alder']);
    // Gegründet zählt auch als aktiver Wald.
    expect(isTreeUnlocked(landscape(5, { active: 'mountain' }), 'fir')).toBe(true);
    // Der gerade gegründete Standort gilt schon als gegründet – nur für seine Art.
    const state = landscape(5);
    expect(isTreeUnlocked(state, 'fir', 'mountain')).toBe(true);
    expect(isTreeUnlocked(state, 'fir', 'carr')).toBe(false);
    expect(isTreeUnlocked(state, 'alder', 'mountain')).toBe(false);
    for (const id of ['maple', '', 'constructor']) {
      expect(isTreeUnlocked(state, id), id).toBe(false);
      expect(isTreeVisible(state, id), id).toBe(false);
    }
  });

  it('gesperrt: startNewCycle mit Weißtanne → tree-locked, nichts ändert sich (auch beim Gründen des falschen Standorts)', () => {
    for (const [tree, site] of [
      ['fir', undefined],
      ['alder', 'mountain'],
      ['fir', 'carr'],
    ] as const) {
      const state = landscape(ANCIENT_STAGE);
      const before = structuredClone(state);
      expect(startNewCycle(state, 9, tree, site), `${tree} ${site}`).toEqual({ ok: false, error: 'tree-locked' });
      expect(state).toEqual(before);
    }
  });

  it('Gründen: Leitbaum vorausgewählt und in einem Schritt freigeschaltet; danach in jedem Wald wählbar', () => {
    const state = landscape(ANCIENT_STAGE);
    const preview = previewNewCycle(state).landscape.sites;
    expect(preview.find((s) => s.id === 'mountain')!.mainTree).toBe('fir');
    expect(preview.find((s) => s.id === 'carr')!.mainTree).toBe('alder');
    // Buche ist (ohne Begleitpflanze) nicht frei: Buchenhallen fallen auf die Eiche zurück.
    expect(preview.find((s) => s.id === 'beechwood')!.mainTree).toBe('oak');

    const result = startNewCycle(state, 9, undefined, 'mountain');
    expect(result).toMatchObject({ ok: true, site: 'mountain', founded: true });
    expect(state.cycle.mainTree).toBe('fir');
    expect(siteTree(state, 'mountain')).toBe('fir');
    expect(state.meta.stats.grownTrees).toEqual(['oak', 'fir']);

    // Ausdrücklich gewählt gelingt es genauso.
    const explicit = landscape(ANCIENT_STAGE);
    expect(startNewCycle(explicit, 9, 'fir', 'mountain').ok).toBe(true);
    expect(explicit.cycle.mainTree).toBe('fir');

    // Zurück in den Heimatwald – mit der Weißtanne.
    Object.assign(state, { stage: 5, waypoint: 25 });
    expect(startNewCycle(state, 10, 'fir', 'home').ok).toBe(true);
    expect(state.meta.landscape.active).toBe('home');
    expect(state.cycle.mainTree).toBe('fir');
    expect(siteTree(state, 'mountain')).toBe('fir');
  });

  it('Erlenbruch gründen: Schwarzerle vorausgewählt', () => {
    const state = landscape(ANCIENT_STAGE);
    expect(startNewCycle(state, 9, undefined, 'carr')).toMatchObject({ ok: true, founded: true });
    expect(state.cycle.mainTree).toBe('alder');
    expect(state.meta.stats.grownTrees).toContain('alder');
  });
});

describe('Wirkung in evaluate (25.3)', () => {
  it('Weißtanne: +1 Platz Stamm & Rinde ab Junger Baum, −1 ☀️ erst ab Alter Baum, Vögel +10 % 😊', () => {
    expect(evaluate(withTree(2, 'fir')).slots.bark).toBe(evaluate(withTree(2, 'oak')).slots.bark);
    expect(evaluate(withTree(3, 'fir')).slots.bark).toBe(evaluate(withTree(3, 'oak')).slots.bark + 1);
    expect(evaluate(withTree(3, 'fir')).light).toBe(evaluate(withTree(3, 'oak')).light);
    expect(evaluate(withTree(4, 'fir')).light).toBe(evaluate(withTree(4, 'oak')).light - 1);
    expect(environmentEffects(0, undefined, 'fir').happiness).toEqual([{ kind: 'happiness', genus: 'birds', points: 10 }]);
  });

  it('Weißtanne: winterfest (kein Abzug im Winter), Nadeln, keine Nüsse', () => {
    expect(evaluate(withTree(4, 'oak', 3), 'off').growthBonus).toBeCloseTo(-0.1);
    expect(evaluate(withTree(4, 'fir', 3), 'off').growthBonus).toBeCloseTo(0);
    // Der Licht-Abzug ist eine Eigenheit, kein Abzug der Jahreszeit: er bleibt auch im Winter.
    expect(evaluate(withTree(4, 'fir', 3), 'off').light).toBe(evaluate(withTree(4, 'oak', 3), 'off').light - 1);
    const ctx = appearsContext(ecosystemOf(withTree(4, 'fir')));
    expect(ctx.tags.has('nadeln')).toBe(true);
    expect(ctx.tags.has('nuesse')).toBe(false);
    expect(appearsContext(ecosystemOf(withTree(4, 'oak'))).tags.has('nuesse')).toBe(true);
    expect(evaluate(withTree(4, 'fir', 0, ['squirrel'])).animals.squirrel!.food).toBe(0);
  });

  it('Schwarzerle: Waldtümpel ab Junger Baum mit einem Platz – ohne Pflege; die Karte passt hinein', () => {
    expect(evaluate(withTree(2, 'alder')).slots.pond).toBe(0);
    expect(evaluate(withTree(3, 'alder')).slots.pond).toBe(1);
    expect(evaluate(withTree(3, 'oak')).slots.pond).toBe(0);
    for (const [tree, ok] of [
      ['alder', true],
      ['oak', false],
    ] as const) {
      const state = withTree(4, tree);
      state.pendingEncounters = [{ type: 'animal', cards: ['frog'], rerolls: 0 }];
      expect(cardStatus(state, 0, 0) === 'free', tree).toBe(ok);
      expect(chooseCard(state, 0, 0).ok, tree).toBe(ok);
    }
  });

  it('Schwarzerle: Blumen +15 % 🌿 (nur Blumen), Amphibien +10 % 😊, nicht winterfest, keine Nüsse', () => {
    const flowers = (tree: 'oak' | 'alder', plants: string[]) => {
      const state = withTree(2, tree);
      state.plants = plants;
      return evaluate(state, 'off');
    };
    expect(flowers('alder', ['anemone']).plantGrowth / flowers('oak', ['anemone']).plantGrowth).toBeCloseTo(1.15, 10);
    expect(flowers('alder', ['anemone']).plantSeeds).toBeCloseTo(flowers('oak', ['anemone']).plantSeeds, 10);
    expect(flowers('alder', ['moss']).plantGrowth).toBeCloseTo(flowers('oak', ['moss']).plantGrowth, 10);
    expect(environmentEffects(0, undefined, 'alder').happiness).toEqual([{ kind: 'happiness', genus: 'amphibians', points: 10 }]);
    expect(evaluate(withTree(4, 'alder', 3), 'off').growthBonus).toBeCloseTo(-0.1);
    expect(appearsContext(ecosystemOf(withTree(4, 'alder'))).tags.has('nuesse')).toBe(false);
  });

  it('Grenzfall: Art ohne gegründeten Standort zur Laufzeit (kaputter Stand) – evaluate rechnet ohne Absturz', () => {
    const state = withTree(7, 'fir');
    state.meta.forestMemory = Number.NaN;
    const ev = evaluate(state);
    expect(Number.isFinite(ev.growth)).toBe(true);
    expect(ev.slots.bark).toBe(evaluate(withTree(7, 'oak')).slots.bark + 1);
  });
});

/** Alle Wälder gegründet, drei Korridore am Heimatwald (30 %), Bestand in den Buchenhallen; Wegpunkt 14. */
function wildState(seed: number): GameState {
  const state = landscape(4, {
    founded: [...SITE_IDS],
    corridors: SPOKES.slice(0, 3),
    fauna: { beechwood: BEECH_FAUNA },
    animals: ['earthworm', 'vole', 'chanterelle'],
    seed,
  });
  state.waypoint = 14;
  return state;
}

/** Stand mit genau einer offenen Tierbegegnung, die eine Wildwechsel-Karte trägt. */
function withViaEncounter(): GameState {
  for (let seed = 1; seed <= 500; seed++) {
    const state = wildState(seed);
    const encounter = drawEncounter(state);
    if (encounter?.via) {
      state.pendingEncounters = [encounter];
      // Im Spiel ist der Bestand der Nachbarn entdeckt (sonst verwirft das Laden ihn und den Weg).
      for (const id of BEECH_FAUNA) if (!state.meta.journal.species.includes(id)) state.meta.journal.species.push(id);
      return state;
    }
  }
  throw new Error('kein Startwert mit Wildwechsel');
}

describe('Wildwechsel-Markierung PendingEncounter.via (24.6)', () => {
  it('drawEncounter setzt via: Index der Karte und der gebaute Korridor am aktiven Wald', () => {
    const state = withViaEncounter();
    const e = state.pendingEncounters[0]!;
    expect(e.type).toBe('animal');
    const via = e.via!;
    expect(Number.isInteger(via.card) && via.card >= 0 && via.card < e.cards.length).toBe(true);
    const species = e.cards[via.card]!;
    expect(wildwechselRoute(state, species)!.corridor).toBe(via.corridor);
    expect(CORRIDORS_BY_ID.get(via.corridor)!.sites).toContain('home');
    expect(state.meta.landscape.corridors).toContain(via.corridor);
  });

  it('ohne Korridor nie via; im Tick passt via genau zum Bericht', () => {
    const plain = stateAt(4, ['earthworm'], 5);
    plain.waypoint = 14;
    for (let i = 0; i < 100; i++) expect(drawEncounter(plain)?.via).toBeUndefined();
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked < 3; seed++) {
      const state = wildState(seed);
      state.meta.forestMemory = 200;
      const report = tick(state, 3600);
      if (report.wildwechsel.length === 0) continue;
      for (const w of report.wildwechsel) expect(state.pendingEncounters[w.encounter]!.via).toEqual({ card: w.card, corridor: w.corridor });
      expect(state.pendingEncounters.filter((e) => e.via).length).toBe(report.wildwechsel.length);
      checked++;
    }
    expect(checked).toBe(3);
  });

  it('chooseCard zählt wildwechselChosen nur für die Wildwechsel-Karte; Erfolg wildwechsel-1', () => {
    const state = withViaEncounter();
    const other = structuredClone(state);
    const via = state.pendingEncounters[0]!.via!;
    expect(chooseCard(state, 0, via.card).ok).toBe(true);
    expect(state.meta.stats.wildwechselChosen).toBe(1);
    expect(state.meta.stats.cardsChosen).toBe(1);
    expect(checkAchievements(state)).toContain('wildwechsel-1');

    const cards = other.pendingEncounters[0]!.cards;
    if (cards.length > 1) {
      expect(chooseCard(other, 0, (via.card + 1) % cards.length).ok).toBe(true);
      expect(other.meta.stats.cardsChosen).toBe(1);
      expect(other.meta.stats.wildwechselChosen).toBe(0);
      expect(checkAchievements(other)).not.toContain('wildwechsel-1');
    }
    // Eine Pflanzenbegegnung mit (unsinnigem) via zählt nicht.
    const plant = stateAt(2, [], 1);
    plant.pendingEncounters = [{ type: 'plant', cards: ['moss'], rerolls: 0, via: { card: 0, corridor: 'home-beechwood' } }];
    expect(chooseCard(plant, 0, 0).ok).toBe(true);
    expect(plant.meta.stats.wildwechselChosen).toBe(0);
  });

  it('Zähler bleibt bei MAX_STAT_COUNT stehen', () => {
    const state = withViaEncounter();
    state.meta.stats.wildwechselChosen = MAX_STAT_COUNT;
    expect(chooseCard(state, 0, state.pendingEncounters[0]!.via!.card).ok).toBe(true);
    expect(state.meta.stats.wildwechselChosen).toBe(MAX_STAT_COUNT);
  });

  it('Neu würfeln löscht via (neue Karten)', () => {
    const state = withViaEncounter();
    state.seeds = 1e12;
    expect(rerollEncounter(state, 0)).toEqual({ ok: true });
    expect('via' in state.pendingEncounters[0]!).toBe(false);
    expect(loadGame(serialize(state), 0)!.state.pendingEncounters[0]!.via).toBeUndefined();
  });

  it('Neuladen und Export/Import behalten via (Roundtrip gleich)', () => {
    const state = withViaEncounter();
    // Von Hand gebauter Stand: H_max nachführen wie nach einer Aktion (das Laden tut es auch).
    recordDiscoveries(state);
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded.pendingEncounters).toEqual(state.pendingEncounters);
    // Der von Hand gebaute Stand wird beim ersten Laden bereinigt (Bestand, Wegpunkt) – danach stabil.
    expect(loadGame(serialize(loaded), 0)!.state).toEqual(loaded);
    const imported = importCode(exportCode(state), 0, { keepClock: true });
    expect(imported.ok && imported.result.state.pendingEncounters).toEqual(state.pendingEncounters);
    // Und gezählt wird nach dem Neuladen genauso.
    expect(chooseCard(loaded, 0, loaded.pendingEncounters[0]!.via!.card).ok).toBe(true);
    expect(loaded.meta.stats.wildwechselChosen).toBe(1);
  });

  it('Laden: ungültiges via fällt weg, die Begegnung bleibt', () => {
    const state = withViaEncounter();
    state.meta.landscape.corridors.push('floodplain-carr');
    const e = state.pendingEncounters[0]!;
    const valid = e.via!;
    const load = (via: unknown, patch: Partial<Record<keyof PendingEncounter, unknown>> = {}, version = SAVE_VERSION) => {
      const data = JSON.parse(serialize(state));
      data.version = version;
      data.pendingEncounters[0] = { ...data.pendingEncounters[0], ...patch, via };
      return loadGame(JSON.stringify(data), 0)!.state.pendingEncounters[0];
    };
    expect(load(valid)!.via).toEqual(valid);
    for (const bad of [
      null,
      'x',
      [],
      42,
      { card: -1, corridor: valid.corridor },
      { card: 0.5, corridor: valid.corridor },
      { card: '0', corridor: valid.corridor },
      { card: e.cards.length, corridor: valid.corridor },
      { card: 1e400, corridor: valid.corridor },
      { card: valid.card },
      { card: valid.card, corridor: 'nope' },
      // gebaut, aber nicht am aktiven Wald
      { card: valid.card, corridor: 'floodplain-carr' },
      // am aktiven Wald, aber nicht gebaut
      { card: valid.card, corridor: 'home-heath' },
    ]) {
      const loaded = load(JSON.parse(JSON.stringify(bad) ?? 'null'));
      expect(loaded, JSON.stringify(bad)).toBeDefined();
      expect(loaded!.cards).toEqual(e.cards);
      expect('via' in loaded!, JSON.stringify(bad)).toBe(false);
    }
    // Ältere Version: ein Feld gleichen Namens zählt nicht.
    expect(load(valid, {}, 14)!.via).toBeUndefined();
    // Pflanzen kennen keinen Wildwechsel.
    expect(load({ card: 0, corridor: valid.corridor }, { type: 'plant', cards: ['moss'] })?.via).toBeUndefined();
  });

  it('Laden: der Weg muss der Weg der Art sein (wildwechselRoute) – sonst keine Markierung', () => {
    const state = withViaEncounter();
    const via = state.pendingEncounters[0]!.via!;
    const load = (patch: (data: { meta: { landscape: { sites: LandscapeSite[] } }; pendingEncounters: PendingEncounter[] }) => void) => {
      const data = JSON.parse(serialize(state));
      patch(data);
      return loadGame(JSON.stringify(data), 0)!.state.pendingEncounters[0]!;
    };
    expect(load(() => {}).via).toEqual(via);
    // Gebaut und am aktiven Wald, aber die Art lebt nicht drüben.
    const other = ['home-floodplain', 'home-carr'].find((c) => c !== via.corridor)!;
    expect(load((d) => (d.pendingEncounters[0]!.via = { card: via.card, corridor: other })).via).toBeUndefined();
    // Bestand des Nachbarn leer: kein Weg mehr.
    expect(load((d) => d.meta.landscape.sites.forEach((s) => (s.fauna = []))).via).toBeUndefined();
  });

  it('Laden: ungültige Karten davor verschieben den Index; eine verworfene Karte verliert die Markierung', () => {
    const state = withViaEncounter();
    const e = state.pendingEncounters[0]!;
    const via = e.via!;
    const species = e.cards[via.card]!;
    const load = (cards: unknown[], card: number) => {
      const data = JSON.parse(serialize(state));
      data.pendingEncounters[0] = { ...data.pendingEncounters[0], cards, via: { card, corridor: via.corridor } };
      return loadGame(JSON.stringify(data), 0)!.state.pendingEncounters[0]!;
    };
    const shifted = load(['drache', 7, species], 2);
    expect(shifted.cards).toEqual([species]);
    expect(shifted.via).toEqual({ card: 0, corridor: via.corridor });
    const dropped = load([species, 'drache'], 1);
    expect(dropped.cards).toEqual([species]);
    expect(dropped.via).toBeUndefined();
  });
});

describe('Spielstand v15 (25.5)', () => {
  /** Stand im Bergmischwald mit Weißtanne, Erlenbruch ruhend mit Schwarzerle, beide gewachsen. */
  function firState(): GameState {
    const state = landscape(5, { active: 'mountain', founded: ['carr'], corridors: ['home-mountain', 'home-carr'] });
    state.meta.landscape.freeCorridors = ['home-mountain', 'home-carr'];
    state.cycle.mainTree = 'fir';
    state.meta.landscape.sites.find((s) => s.id === 'mountain')!.mainTree = 'fir';
    state.meta.landscape.sites.find((s) => s.id === 'carr')!.mainTree = 'alder';
    state.meta.stats.grownTrees = ['oak', 'alder', 'fir'];
    state.meta.stats.wildwechselChosen = 3;
    return state;
  }

  it('SAVE_VERSION 16 (seit v15): Stand mit Weißtanne und Schwarzerle lädt und behält beide (Roundtrip gleich)', () => {
    expect(SAVE_VERSION).toBe(16);
    const state = firState();
    recordDiscoveries(state);
    expect(state.version).toBe(16);
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded).toEqual(state);
    expect(loaded.cycle.mainTree).toBe('fir');
    expect(siteTree(loaded, 'carr')).toBe('alder');
    expect(loaded.meta.stats.wildwechselChosen).toBe(3);
  });

  it('v14 → v15: nur ein Versionssprung, wildwechselChosen 0 (ein Feld gleichen Namens zählt nicht)', () => {
    const state = landscape(5, { founded: ['beechwood'], corridors: ['home-beechwood'] });
    state.meta.landscape.freeCorridors = ['home-beechwood'];
    state.meta.stats.wildwechselChosen = 0;
    const data = JSON.parse(serialize(state));
    data.version = 14;
    data.meta.stats.wildwechselChosen = 7;
    const loaded = loadGame(JSON.stringify(data), 0)!;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.meta.stats.wildwechselChosen).toBe(0);
    expect(loaded.state).toEqual(loadGame(serialize(state), 0)!.state);
    expect(loaded.landscapeUnlocked).toBe(false);
  });

  it('jede Version v2 … v14 lädt ohne Absturz: Zähler 0, Eiche', () => {
    for (let version = 2; version <= 14; version++) {
      const data = JSON.parse(serialize(stateAt(5, ['earthworm', 'robin'], version)));
      data.version = version;
      // Was ein älterer Stand nie hatte, darf trotzdem nicht stören.
      data.cycle.mainTree = 'fir';
      const loaded = loadGame(JSON.stringify(data), 0);
      expect(loaded, `v${version}`).not.toBeNull();
      expect(loaded!.state.version, `v${version}`).toBe(SAVE_VERSION);
      expect(loaded!.state.meta.stats.wildwechselChosen, `v${version}`).toBe(0);
      expect(loaded!.state.cycle.mainTree, `v${version}`).toBe('oak');
    }
  });

  it('Weißtanne ohne gegründeten Bergmischwald → Eiche; Schwarzerle nur mit Erlenbruch (Zyklus, Wälder, grownTrees)', () => {
    const state = landscape(5, { founded: ['beechwood'], corridors: ['home-beechwood'] });
    state.meta.landscape.freeCorridors = ['home-beechwood'];
    const data = JSON.parse(serialize(state));
    data.cycle.mainTree = 'fir';
    data.meta.landscape.sites.find((s: LandscapeSite) => s.id === 'home').mainTree = 'fir';
    data.meta.landscape.sites.find((s: LandscapeSite) => s.id === 'beechwood').mainTree = 'alder';
    data.meta.stats.grownTrees = ['oak', 'alder', 'fir'];
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(loaded.cycle.mainTree).toBe('oak');
    expect(siteTree(loaded, 'home')).toBe('oak');
    expect(siteTree(loaded, 'beechwood')).toBe('oak');
    expect(loaded.meta.stats.grownTrees).toEqual(['oak']);
    // Ruhender Wald mit Rotbuche ohne Begleitpflanze: ebenso Eiche (dieselbe Regel).
    data.meta.landscape.sites.find((s: LandscapeSite) => s.id === 'beechwood').mainTree = 'beech';
    expect(siteTree(loadGame(JSON.stringify(data), 0)!.state, 'beechwood')).toBe('oak');
  });

  it('v14-Stand: ruhender Heimatwald mit Rotbuche ohne Begleitpflanze → Eiche (neue Laderegel)', () => {
    const state = landscape(5, { active: 'beechwood', corridors: ['home-beechwood'] });
    state.meta.landscape.freeCorridors = ['home-beechwood'];
    const data = JSON.parse(serialize(state));
    data.version = 14;
    data.meta.landscape.sites.find((s: LandscapeSite) => s.id === 'home').mainTree = 'beech';
    expect(siteTree(loadGame(JSON.stringify(data), 0)!.state, 'home')).toBe('oak');
    // Mit der Begleitpflanze im Tagebuch bleibt sie.
    data.meta.journal.plants = ['beech'];
    expect(siteTree(loadGame(JSON.stringify(data), 0)!.state, 'home')).toBe('beech');
  });

  it('die Landschaft wird vor dem Hauptbaum geladen: aktiver Bergmischwald behält die Weißtanne', () => {
    const state = firState();
    // Ohne Erlenbruch: grownTrees verliert die Erle, die Tanne bleibt.
    const data = JSON.parse(serialize(state));
    data.meta.landscape.sites = data.meta.landscape.sites.filter((s: LandscapeSite) => s.id !== 'carr');
    data.meta.landscape.corridors = ['home-mountain'];
    data.meta.landscape.freeCorridors = ['home-mountain'];
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(loaded.cycle.mainTree).toBe('fir');
    expect(siteTree(loaded, 'mountain')).toBe('fir');
    expect(loaded.meta.stats.grownTrees).toEqual(['oak', 'fir']);
  });

  it('Kosten-Prüfung verwirft den Bergmischwald (manipuliert) → aus der Weißtanne wird eine Eiche, kein Absturz', () => {
    const state = landscape(5, { founded: ['mountain', 'carr'], corridors: ['home-mountain', 'home-carr'] });
    state.meta.landscape.freeCorridors = ['home-mountain', 'home-carr'];
    const data = JSON.parse(serialize(state));
    // Keine Hähersaat verdient: Gedächtnis 0, kein Urwald.
    data.meta.forestMemory = 0;
    for (const s of data.meta.landscape.sites) Object.assign(s, { memory: 0, ancient: false });
    data.cycle.mainTree = 'fir';
    data.meta.stats.grownTrees = ['oak', 'fir', 'alder'];
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(loaded.meta.landscape.sites.map((s) => s.id)).toEqual(['home']);
    expect(loaded.cycle.mainTree).toBe('oak');
    expect(loaded.meta.stats.grownTrees).toEqual(['oak']);
  });

  it('unbekannte IDs werden wie bisher zur Eiche; kaputte Zähler → 0 bzw. Grenze', () => {
    const state = firState();
    const data = JSON.parse(serialize(state));
    data.cycle.mainTree = 'maple';
    data.meta.landscape.sites.find((s: LandscapeSite) => s.id === 'carr').mainTree = 42;
    data.meta.stats.grownTrees = ['maple', null, 'alder', 'alder'];
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(loaded.cycle.mainTree).toBe('oak');
    expect(siteTree(loaded, 'mountain')).toBe('oak');
    expect(siteTree(loaded, 'carr')).toBe('oak');
    expect(loaded.meta.stats.grownTrees).toEqual(['alder', 'oak']);
    const count = (value: string) =>
      loadGame(serialize(state).replace('"wildwechselChosen":3', `"wildwechselChosen":${value}`), 0)!.state.meta.stats.wildwechselChosen;
    expect(count('-1')).toBe(0);
    expect(count('"x"')).toBe(0);
    expect(count('null')).toBe(0);
    expect(count('2.7')).toBe(2);
    expect(count('1e400')).toBe(MAX_STAT_COUNT);
  });

  it('Schutz vor neueren Ständen: ein v14-Spiel lehnt v15 ab (Abgleich, Import), dieses Spiel lehnt neuere ab', () => {
    // Ein v14-Client (Schema 14) blockiert den Abgleich mit diesem Stand.
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, 14)).toBe(true);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, SAVE_VERSION)).toBe(false);
    const json = serialize(firState());
    expect(isNewerSave(json)).toBe(false);
    const v16 = JSON.stringify({ ...JSON.parse(json), version: SAVE_VERSION + 1 });
    expect(isNewerSave(v16)).toBe(true);
    expect(importCode(codeFromJson(v16), 0)).toEqual({ ok: false, error: 'newer' });
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, json);
    expect(storedSaveIsNewer(storage)).toBe(false);
    storage.setItem(SAVE_KEY, JSON.stringify({ ...JSON.parse(json), version: 14 }));
    expect(storedSaveIsNewer(storage)).toBe(false);
    storage.setItem(SAVE_KEY, v16);
    expect(storedSaveIsNewer(storage)).toBe(true);
  });
});

describe('Erfolge (24.12, 25.7)', () => {
  const byId = (id: string) => ACHIEVEMENTS_BY_ID.get(id)!;

  it('landscape-trees erst mit allen fünf Arten; trees-all bleibt bei drei erreichbar', () => {
    expect(byId('landscape-trees')).toMatchObject({ requires: 'landscape', condition: { kind: 'trees', atLeast: 'all' } });
    expect(byId('wildwechsel-1')).toMatchObject({ requires: 'landscape', condition: { kind: 'stat', key: 'wildwechselChosen', atLeast: 1 } });
    const state = landscape(5);
    state.meta.stats.grownTrees = ['oak', 'beech', 'pine'];
    expect(isAchieved(state, byId('trees-all'))).toBe(true);
    expect(achievementProgress(state, byId('landscape-trees'))).toEqual({ value: 3, target: MAIN_TREES.length });
    state.meta.stats.grownTrees.push('fir');
    expect(isAchieved(state, byId('landscape-trees'))).toBe(false);
    state.meta.stats.grownTrees.push('alder');
    expect(isAchieved(state, byId('landscape-trees'))).toBe(true);
    expect(checkAchievements(state)).toEqual(expect.arrayContaining(['trees-all', 'landscape-trees']));
  });

  it('wildwechsel-1: 0/1, nach einer gewählten Wildwechsel-Karte erfüllt; NaN zählt nicht', () => {
    const state = landscape(5);
    expect(achievementProgress(state, byId('wildwechsel-1'))).toEqual({ value: 0, target: 1 });
    state.meta.stats.wildwechselChosen = Number.NaN;
    expect(isAchieved(state, byId('wildwechsel-1'))).toBe(false);
    state.meta.stats.wildwechselChosen = 1;
    expect(isAchieved(state, byId('wildwechsel-1'))).toBe(true);
  });

  it('Gründen von Bergmischwald und Erlenbruch bringt landscape-trees (mit Buche und Kiefer)', () => {
    const state = landscape(ANCIENT_STAGE);
    state.meta.stats.grownTrees = ['oak', 'beech', 'pine', 'alder'];
    const result = startNewCycle(state, 9, undefined, 'mountain');
    expect(result.ok && result.achievements).toContain('landscape-trees');
  });
});

describe('online = offline mit den neuen Hauptbäumen', { timeout: 60_000 }, () => {
  it('Schwarzerle im Erlenbruch und Weißtanne im Bergmischwald: kleine Ticks = großer Tick, Zähler gleich', () => {
    for (const [active, tree] of [
      ['carr', 'alder'],
      ['mountain', 'fir'],
    ] as const) {
      const start = landscape(3, {
        active,
        founded: [...SITE_IDS],
        corridors: active === 'carr' ? ['home-carr', 'floodplain-carr'] : ['home-mountain', 'beechwood-mountain'],
        fauna: { home: BEECH_FAUNA, beechwood: BEECH_FAUNA, floodplain: ['toad', 'frog', 'newt'] },
        animals: ['earthworm', 'robin', 'vole'],
        seed: 21,
      });
      start.cycle.mainTree = tree;
      start.meta.landscape.sites.find((s) => s.id === active)!.mainTree = tree;
      start.meta.forestMemory = 50;
      const small = structuredClone(start);
      const big = structuredClone(start);
      for (let i = 0; i < 3600; i++) tick(small, 1);
      tick(big, 3600);
      expect(big.waypoint, tree).toBe(small.waypoint);
      expect(big.pendingEncounters, tree).toEqual(small.pendingEncounters);
      expect(big.rngState, tree).toBe(small.rngState);
      expect(big.niches, tree).toEqual(small.niches);
      expect(big.totalGrowth / small.totalGrowth, tree).toBeCloseTo(1, 6);
      expect(big.meta.stats, tree).toEqual({ ...small.meta.stats, playSeconds: big.meta.stats.playSeconds });
      expect(big.stage, tree).toBeGreaterThan(3);
    }
  });
});

describe('„Zuerst gesehen“ meta.journal.firstSeen (25.10)', () => {
  it('neues Spiel leer; die erste Wahl einer Art trägt Zyklus und Jahreszeit ein, spätere nicht', () => {
    const state = stateAt(4, [], 1);
    expect(state.meta.journal.firstSeen).toEqual({ species: {}, plants: {} });
    state.cycle.number = 3;
    state.cycle.elapsed = 3 * SEASON_SECONDS + 10; // Winter
    state.pendingEncounters = [{ type: 'animal', cards: ['robin'], rerolls: 0 }];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(state.meta.journal.firstSeen.species).toEqual({ robin: { cycle: 3, season: 'winter' } });
    // Wieder gewählt (anderer Zyklus, andere Jahreszeit): bleibt beim ersten Mal.
    for (const n of Object.keys(state.niches) as (keyof GameState['niches'])[]) state.niches[n] = state.niches[n].filter((x) => x !== 'robin');
    state.cycle.number = 4;
    state.cycle.elapsed = 0;
    state.pendingEncounters = [{ type: 'animal', cards: ['robin'], rerolls: 0 }];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(state.meta.journal.firstSeen.species.robin).toEqual({ cycle: 3, season: 'winter' });
  });

  it('schon im Tagebuch (vor v15 entdeckt): kein Wert; Pflanzen über die Karte „Etwas keimt“', () => {
    const state = stateAt(4, ['earthworm'], 1);
    state.meta.journal.species.push('robin');
    state.pendingEncounters = [{ type: 'animal', cards: ['robin'], rerolls: 0 }];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(state.meta.journal.firstSeen.species).toEqual({});
    state.cycle.elapsed = SEASON_SECONDS; // Sommer
    state.pendingEncounters = [{ type: 'plant', cards: ['hazel'], rerolls: 0 }];
    expect(chooseCard(state, 0, 0).ok).toBe(true);
    expect(state.meta.journal.firstSeen.plants).toEqual({ hazel: { cycle: 1, season: 'summer' } });
  });

  it('Roundtrip gleich; v14 → v15 leer, auch wenn ein Feld gleichen Namens dasteht', () => {
    const state = stateAt(4, [], 1);
    state.pendingEncounters = [{ type: 'animal', cards: ['robin'], rerolls: 0 }];
    chooseCard(state, 0, 0);
    expect(loadGame(serialize(state), 0)!.state.meta.journal.firstSeen).toEqual(state.meta.journal.firstSeen);
    const data = JSON.parse(serialize(state));
    data.version = 14;
    const old = loadGame(JSON.stringify(data), 0)!.state;
    expect(old.meta.journal.firstSeen).toEqual({ species: {}, plants: {} });
    expect(old.meta.journal.species).toContain('robin');
  });

  it('robustes Laden: nur bekannte, im Tagebuch stehende IDs, gültiger Zyklus und Jahreszeit', () => {
    const state = stateAt(4, ['earthworm', 'robin'], 1);
    state.cycle.number = 5;
    state.meta.journal.plants.push('hazel');
    const data = JSON.parse(serialize(state));
    data.meta.journal.firstSeen = {
      species: JSON.parse(
        '{"__proto__": {"cycle": 1, "season": "spring"}, "earthworm": {"cycle": 2, "season": "autumn"}, "robin": {"cycle": 6, "season": "spring"},' +
          ' "wolf": {"cycle": 1, "season": "spring"}, "drache": {"cycle": 1, "season": "spring"}}',
      ),
      plants: { hazel: { cycle: 1, season: 'monsoon' }, moss: { cycle: 1, season: 'spring' } },
    };
    const loaded = loadGame(JSON.stringify(data), 0)!.state.meta.journal.firstSeen;
    expect(loaded).toEqual({ species: { earthworm: { cycle: 2, season: 'autumn' } }, plants: {} });
    expect(Object.getPrototypeOf(loaded.species)).toBe(Object.prototype);
    for (const bad of [null, 'x', 42, [], { cycle: 0, season: 'spring' }, { cycle: 1.5, season: 'spring' }, { cycle: '1', season: 'spring' }, { cycle: 1 }]) {
      data.meta.journal.firstSeen = { species: { earthworm: bad }, plants: bad };
      expect(loadGame(JSON.stringify(data), 0)!.state.meta.journal.firstSeen, JSON.stringify(bad)).toEqual({ species: {}, plants: {} });
    }
    for (const bad of [null, 'x', 42, []]) {
      data.meta.journal.firstSeen = bad;
      expect(loadGame(JSON.stringify(data), 0)!.state.meta.journal.firstSeen).toEqual({ species: {}, plants: {} });
    }
    data.meta.journal.firstSeen = { species: { earthworm: { cycle: 1e400, season: 'spring' } }, plants: {} };
    expect(loadGame(JSON.stringify(data).replace('"cycle":null', '"cycle":1e400'), 0)!.state.meta.journal.firstSeen.species).toEqual({});
  });

  it('das Laden erfindet nichts: Pflanzen im Ring, die im Tagebuch fehlen, kommen ohne Wert dazu', () => {
    const state = stateAt(4, [], 1);
    state.plants = ['hazel'];
    const data = JSON.parse(serialize(state));
    data.meta.journal.plants = [];
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(loaded.meta.journal.plants).toContain('hazel');
    expect(loaded.meta.journal.firstSeen.plants).toEqual({});
  });

  it('online = offline: Ticks und Offline-Simulation tragen nichts ein (nur Aktionen entdecken)', () => {
    const start = stateAt(3, ['earthworm', 'robin'], 31);
    start.pendingEncounters = [{ type: 'animal', cards: ['bluetit'], rerolls: 0 }];
    chooseCard(start, 0, 0);
    const before = structuredClone(start.meta.journal.firstSeen);
    const small = structuredClone(start);
    const big = structuredClone(start);
    const offline = structuredClone(start);
    for (let i = 0; i < 1800; i++) tick(small, 1);
    tick(big, 1800);
    simulateOffline(offline, 1800);
    for (const s of [small, big, offline]) expect(s.meta.journal.firstSeen).toEqual(before);
  });
});
