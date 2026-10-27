import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS_BY_ID } from '../src/content/achievements';
import { CHAPTER_IDS, CHRONICLE_CHAPTERS, CHRONICLE_HARMONY, type ChapterId } from '../src/content/chronicle';
import { NOCTURNAL_BY_SPECIES } from '../src/content/daytime';
import { EVENTS_BY_ID } from '../src/content/events';
import { HOME_SITE, LANDSCAPE_SITES, SITE_IDS, type SiteId } from '../src/content/landscape';
import { PLANTS } from '../src/content/plants';
import { EVENT_SEASONS, SEASON_IDS, SEASON_SECONDS, YEAR_SECONDS, type SeasonId } from '../src/content/seasons';
import { COMMON_SPECIES, KENNARTEN, SPECIES, SPECIES_BY_ID, isKennart, kennartSite } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { checkAchievements, isAchieved, targetOf } from '../src/core/achievements';
import { appearsContext, ecosystemOf, evaluateEcosystem, speciesAppears } from '../src/core/formulas';
import {
  ANCIENT_STAGE,
  chronicleComplete,
  chronicleOf,
  completedChronicles,
  hasChapter,
  kennartOf,
  keepsakeOf,
  oldSiteOf,
  writeChapter,
} from '../src/core/landscape';
import { codeFromJson, importCode, isNewerSave, loadGame, serialize } from '../src/core/save';
import { MAX_FOREST_MEMORY, SAVE_VERSION, createSite, type ChronicleEntry, type GameState, type LandscapeSite } from '../src/core/state';
import { chooseEventOption, drawAnimals, recordDiscoveries, simulateOffline, startNewCycle, tick } from '../src/core/tick';
import { isNewerSchema } from '../src/sync/policy';
import { stateAt } from './helpers';

/**
 * Waldchronik und Kennarten (DESIGN_V2.md 26.3–26.6, Phase 9, 2b): Inhalte, Bedingung `site`,
 * die sechs Kapitel an ihren Stellen (online = offline), Erfolge, Spielstand v16 (Migration
 * v15 → v16 und robustes Laden).
 */

const undated = (chapter: ChapterId): ChronicleEntry => ({ chapter, cycle: null, season: null });

/**
 * Stand mit Landschaft: aktiver Wald `active` (Stufe `stage`), dazu der Heimatwald. `unlocked`:
 * Landschaft frei (Urwald-Erfolg und 300 Gedächtnis im Heimatwald), `ancient`: der aktive Wald
 * war schon einmal Urwald.
 */
function forest(stage: number, opts: { active?: SiteId; unlocked?: boolean; ancient?: boolean; animals?: string[]; seed?: number } = {}): GameState {
  const state = stateAt(stage, opts.animals ?? [], opts.seed ?? 7);
  const active = opts.active ?? HOME_SITE;
  const unlocked = opts.unlocked ?? true;
  const sites: LandscapeSite[] = [{ ...createSite(HOME_SITE), ancient: unlocked && active !== HOME_SITE, memory: active === HOME_SITE ? 0 : 300 }];
  if (sites[0]!.ancient) sites[0]!.chronicle = [undated('ancient')];
  if (active !== HOME_SITE) sites.push(createSite(active));
  const entry = sites.find((s) => s.id === active)!;
  entry.ancient = opts.ancient ?? false;
  if (entry.ancient) entry.chronicle = [undated('ancient')];
  state.meta.landscape = { active, sites, corridors: [], freeCorridors: [], announced: unlocked };
  state.meta.forestMemory = unlocked && active === HOME_SITE ? 300 : 0;
  if (unlocked) state.meta.achievements.push('ancient-forest');
  return state;
}

const chapters = (state: GameState, site: SiteId = state.meta.landscape.active) => chronicleOf(state, site).map((e) => e.chapter);

// ---------------------------------------------------------------------------

describe('Inhalt: Kennarten (26.3)', () => {
  it('sechs Kennarten, je Wald genau eine, mit genau einer Bedingung `site` auf ihren Wald', () => {
    expect(KENNARTEN.map((s) => s.id)).toEqual(['dormouse', 'beaver', 'moorfrog', 'hericium', 'lynx', 'nightjar']);
    expect(LANDSCAPE_SITES.map((s) => s.kennart)).toEqual(['dormouse', 'beaver', 'moorfrog', 'hericium', 'lynx', 'nightjar']);
    for (const site of LANDSCAPE_SITES) {
      const sp = SPECIES_BY_ID.get(site.kennart)!;
      expect(sp, site.id).toBeDefined();
      const conditions = (sp.appears ?? []).filter((c) => c.kind === 'site');
      expect(conditions, sp.id).toEqual([{ kind: 'site', site: site.id }]);
      expect(kennartSite(sp)).toBe(site.id);
      expect(kennartOf(site.id)).toBe(sp.id);
      // Besonders, ab Hain, keine Fähigkeit – nur vorhandene Wirkungsarten.
      expect(sp.rarity, sp.id).toBe(2);
      expect(sp.unlock, sp.id).toBe(STAGES.findIndex((s) => s.id === 'grove'));
      expect(sp.effects.some((e) => e.kind === 'ability'), sp.id).toBe(false);
      // Nie ein Wunsch `site` (die Bedingung ist nur fürs Erscheinen).
      expect(sp.needs.some((c) => c.kind === 'site'), sp.id).toBe(false);
    }
    // Nur Kennarten tragen `site`. Keine Kennart hat eine weitere Bedingung (Playtest Phase 9, 4b:
    // „Reh“ sperrte den Luchs für Spieler ohne Reh) – jeder alte Wald zeigt seine Kennart.
    for (const s of SPECIES) expect(kennartSite(s) !== null, s.id).toBe(isKennart(s.id));
    for (const k of KENNARTEN) expect(k.appears, k.id).toEqual([{ kind: 'site', site: kennartSite(k) }]);
    // Der Luchs frisst weiter Rehe (Nahrungsnetz), braucht sie aber nicht zum Erscheinen.
    expect(SPECIES_BY_ID.get('lynx')!.food).toContain('rehe');
    expect(COMMON_SPECIES.length + KENNARTEN.length).toBe(SPECIES.length);
  });

  it('Haselmaus und Ziegenmelker sind nachtaktiv, nicht im Winter', () => {
    for (const id of ['dormouse', 'nightjar']) {
      const n = NOCTURNAL_BY_SPECIES.get(id)!;
      expect(n, id).toBeDefined();
      expect(n.seasons, id).not.toContain('winter');
      expect(n.effects, id).toEqual([{ kind: 'seeds', pct: 6 }]);
    }
  });
});

describe('Inhalt: Chronik (26.4)', () => {
  it('sechs Kapitel mit Symbol, Titel und Hinweis ohne Namen; Schwelle 230 (gemessen in Phase 11, 3c)', () => {
    expect(CHAPTER_IDS).toEqual(['ancient', 'first-snow', 'signature', 'kennart', 'harmony', 'memory']);
    expect(CHRONICLE_CHAPTERS.map((c) => c.id)).toEqual([...CHAPTER_IDS]);
    expect(CHRONICLE_HARMONY).toBe(230);
    const names = [...SPECIES, ...LANDSCAPE_SITES].map((x) => x.name);
    for (const c of CHRONICLE_CHAPTERS) {
      expect(c.icon.length, c.id).toBeGreaterThan(0);
      expect(c.title.length, c.id).toBeGreaterThan(0);
      for (const name of names) expect(c.hint, `${c.id}: ${name}`).not.toContain(name);
    }
  });

  it('Ereignis des Waldes: bekannte ID, die dort vorkommen kann; Andenken mit kurzen Texten', () => {
    const expected: Record<SiteId, string> = {
      home: 'mast-year',
      floodplain: 'rain',
      carr: 'toad-migration',
      beechwood: 'mast-year',
      mountain: 'snow-break',
      heath: 'beetle-year',
    };
    for (const site of LANDSCAPE_SITES) {
      expect(site.chronicleEvent, site.id).toBe(expected[site.id]);
      const event = EVENTS_BY_ID.get(site.chronicleEvent)!;
      expect(event, site.id).toBeDefined();
      expect(event.minStage, site.id).toBeLessThan(STAGES.length);
      const seasons = EVENT_SEASONS[site.chronicleEvent];
      expect(seasons === undefined || seasons.length > 0, site.id).toBe(true);
      // Ein Faktor des Waldes darf das Ereignis nie ausschließen.
      expect(site.eventFactors[site.chronicleEvent] ?? 1, site.id).toBeGreaterThan(0);
      expect(site.chronicleEventTitle.length, site.id).toBeGreaterThan(0);
      expect(site.keepsake.icon.length, site.id).toBeGreaterThan(0);
      expect(site.keepsake.name.length, site.id).toBeGreaterThan(0);
      expect(site.keepsake.text.length, site.id).toBeLessThanOrEqual(120);
      expect(keepsakeOf(site.id)).toBe(site.keepsake);
    }
  });
});

describe('Bedingung `site`: Kennarten nur im alten Wald und nie vor der Landschaft', () => {
  it('vor der Freischaltung erscheint keine Kennart – auch nicht im Urwald', () => {
    const state = forest(ANCIENT_STAGE, { unlocked: false });
    expect(oldSiteOf(state)).toBeUndefined();
    const ctx = appearsContext(ecosystemOf(state));
    expect(ctx.oldSite).toBeUndefined();
    for (const k of KENNARTEN) expect(speciesAppears(ctx, k), k.id).toBe(false);
    // Viele Ziehungen: nie eine Kennart.
    for (let seed = 1; seed <= 300; seed++) {
      const s = forest(ANCIENT_STAGE, { unlocked: false, seed });
      for (const id of drawAnimals(s)) expect(isKennart(id), `${seed}: ${id}`).toBe(false);
    }
  });

  it('frei, aktiver Wald alt (schon Urwald oder jetzt Urwald): genau seine Kennart erscheint', () => {
    // Heimatwald im Hain, noch nie Urwald: nicht alt.
    const young = forest(5);
    expect(oldSiteOf(young)).toBeUndefined();
    expect(speciesAppears(appearsContext(ecosystemOf(young)), SPECIES_BY_ID.get('dormouse')!)).toBe(false);
    // Jetzt Urwald: alt.
    const now = forest(ANCIENT_STAGE);
    expect(oldSiteOf(now)).toBe('home');
    const ctx = appearsContext(ecosystemOf(now));
    expect(speciesAppears(ctx, SPECIES_BY_ID.get('dormouse')!)).toBe(true);
    for (const k of KENNARTEN.filter((x) => x.id !== 'dormouse')) expect(speciesAppears(ctx, k), k.id).toBe(false);
    // Schon einmal Urwald, jetzt Hain: alt.
    const old = forest(5, { active: 'floodplain', ancient: true });
    expect(oldSiteOf(old)).toBe('floodplain');
    expect(speciesAppears(appearsContext(ecosystemOf(old)), SPECIES_BY_ID.get('beaver')!)).toBe(true);
    expect(speciesAppears(appearsContext(ecosystemOf(old)), SPECIES_BY_ID.get('dormouse')!)).toBe(false);
    // Der Luchs erscheint im alten Bergmischwald auch ohne Reh (Playtest Phase 9, 4b), mit Reh ebenso.
    const mountain = forest(5, { active: 'mountain', ancient: true });
    expect(speciesAppears(appearsContext(ecosystemOf(mountain)), SPECIES_BY_ID.get('lynx')!)).toBe(true);
    const withDeer = forest(5, { active: 'mountain', ancient: true, animals: ['deer'] });
    expect(speciesAppears(appearsContext(ecosystemOf(withDeer)), SPECIES_BY_ID.get('lynx')!)).toBe(true);
    // Nur im alten: derselbe Wald, noch nie Urwald.
    expect(speciesAppears(appearsContext(ecosystemOf(forest(5, { active: 'mountain' }))), SPECIES_BY_ID.get('lynx')!)).toBe(false);
  });

  it('wird im alten Wald wirklich gezogen (Haselmaus im Heimatwald)', () => {
    let seen = 0;
    for (let seed = 1; seed <= 400 && seen === 0; seed++) {
      // Sträucher braucht sie nicht zum Erscheinen; die Krone ist ab dem Hain offen.
      if (drawAnimals(forest(ANCIENT_STAGE, { seed })).includes('dormouse')) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('Teil-Stände ohne Erfolgsliste: keine Kennart, kein Absturz', () => {
    const state = forest(ANCIENT_STAGE);
    const partial = { stage: state.stage, meta: { forestMemory: 300, landscape: state.meta.landscape } } as unknown as GameState;
    expect(oldSiteOf(partial)).toBeUndefined();
  });
});

describe('Kapitel an ihren Stellen (26.4)', () => {
  it('„Erster Schnee im Urwald“: an der Grenze zum Winter, nur im Urwald – online = offline', () => {
    const make = () => {
      const s = forest(ANCIENT_STAGE, { seed: 31 });
      s.cycle.elapsed = 3 * SEASON_SECONDS - 10; // zehn Sekunden vor dem Winter
      return s;
    };
    const online = make();
    const reports = [];
    for (let i = 0; i < 20; i++) reports.push(tick(online, 1, 'average'));
    const offline = make();
    const report = simulateOffline(offline, 20);
    const big = make();
    const bigReport = tick(big, 20, 'average');
    expect(chronicleOf(online, 'home')).toEqual([{ chapter: 'first-snow', cycle: 1, season: 'winter' }]);
    expect(chronicleOf(offline, 'home')).toEqual(chronicleOf(online, 'home'));
    expect(chronicleOf(big, 'home')).toEqual(chronicleOf(online, 'home'));
    expect(reports.flatMap((r) => r.chapters)).toEqual([{ site: 'home', chapter: 'first-snow' }]);
    expect(report.chapters).toEqual([{ site: 'home', chapter: 'first-snow' }]);
    expect(bigReport.chapters).toEqual(report.chapters);
    // Ein weiterer Winter schreibt nichts mehr.
    expect(tick(online, YEAR_SECONDS, 'average').chapters).toEqual([]);
    // Unter dem Urwald kein Schnee-Kapitel.
    const grove = forest(5, { seed: 31 });
    grove.cycle.elapsed = 3 * SEASON_SECONDS - 10;
    tick(grove, 20);
    expect(chapters(grove)).toEqual([]);
  });

  it('Schnellvorlauf über ganze Jahre schreibt dasselbe wie Schritt für Schritt (Jahreszeit im Stempel)', () => {
    const make = () => {
      const s = forest(ANCIENT_STAGE, { seed: 5 });
      // Hinter der Schonzeit, am Jahresanfang: Der Mittel-Modus springt über ganze Jahre.
      s.cycle.elapsed = 2 * YEAR_SECONDS;
      s.pendingEncounters = [];
      return s;
    };
    const stepped = make();
    for (let i = 0; i < 12; i++) tick(stepped, SEASON_SECONDS, 'average');
    const skipped = make();
    const report = tick(skipped, 3 * YEAR_SECONDS, 'average');
    expect(chronicleOf(skipped, 'home')).toEqual(chronicleOf(stepped, 'home'));
    expect(chapters(skipped)).toContain('first-snow');
    expect(report.chapters.map((c) => c.chapter)).toEqual(chapters(skipped));
    expect(chronicleOf(skipped, 'home').find((e) => e.chapter === 'first-snow')!.season).toBe('winter');
  });

  it('„Voller Einklang“ im Schnellvorlauf: dieselbe Jahreszeit im Stempel wie Schritt für Schritt', () => {
    /**
     * Urwald hinter der Schonzeit, am Jahresanfang (Frühling), ohne Begegnungen und Zeit-Boni –
     * der Mittel-Modus springt dann über ganze Jahre (skipYears). `drop`: so viele Arten (ab
     * `offset`, reihum) fehlen, damit die Harmonie im Frühling knapp unter der Schwelle liegt.
     */
    const ids = COMMON_SPECIES.map((s) => s.id);
    const make = (offset: number, drop: number) => {
      const gone = new Set(Array.from({ length: drop }, (_, i) => ids[(offset + i) % ids.length]!));
      const s = forest(ANCIENT_STAGE, { seed: 11, animals: ids.filter((id) => !gone.has(id)) });
      s.plants = PLANTS.map((p) => p.id);
      s.cycle.elapsed = 2 * YEAR_SECONDS;
      s.pendingEncounters = [];
      return s;
    };
    /** Harmonie je Jahreszeit, so wie tick sie an den Grenzen nachführt (Mittelwetter). */
    const harmonies = (s: GameState) => {
      const eco = ecosystemOf(s, {}, 'average');
      return SEASON_IDS.map((id) => evaluateEcosystem({ ...eco, season: id }).harmony);
    };
    // Zustand suchen, in dem H_max erst nach dem Frühling (≥ CHRONICLE_HARMONY) wird: Arten
    // reihum weglassen, bis der Frühling unter der Schwelle liegt – eine andere Jahreszeit
    // muss dann noch darüber liegen. Deterministisch, robust gegen Balancing-Änderungen.
    let found: { offset: number; drop: number } | null = null;
    for (let offset = 0; offset < ids.length && !found; offset++) {
      for (let drop = 0; drop < ids.length; drop++) {
        const h = harmonies(make(offset, drop));
        if (h[0]! >= CHRONICLE_HARMONY) continue;
        if (Math.max(...h) >= CHRONICLE_HARMONY) found = { offset, drop };
        break;
      }
    }
    expect(found, 'Zustand mit H_max ≥ Schwelle erst nach dem Frühling').not.toBeNull();
    const { offset, drop } = found!;
    const h = harmonies(make(offset, drop));
    // Erwartet: die erste Grenze ab Frühlingsbeginn (Sommer, Herbst, Winter, Frühling) mit
    // Harmonie ≥ Schwelle – nie der Frühling selbst.
    const expected = [1, 2, 3, 0].map((i) => SEASON_IDS[i]!).find((id) => h[SEASON_IDS.indexOf(id)]! >= CHRONICLE_HARMONY) as SeasonId;
    expect(expected).not.toBe('spring');

    const stepped = make(offset, drop);
    expect(stepped.cycle.maxHarmony).toBeLessThan(CHRONICLE_HARMONY);
    for (let i = 0; i < 12; i++) tick(stepped, SEASON_SECONDS, 'average');
    const skipped = make(offset, drop);
    const report = tick(skipped, 3 * YEAR_SECONDS, 'average');
    // Ohne Wegpunkt und Bonus-Ablauf gilt der Schnellvorlauf (sonst prüfte der Test nichts).
    expect(report.waypoints).toBe(0);
    expect(skipped.cycle.elapsed).toBe(5 * YEAR_SECONDS);
    const harmony = (s: GameState) => chronicleOf(s, HOME_SITE).find((e) => e.chapter === 'harmony');
    expect(harmony(stepped)).toEqual({ chapter: 'harmony', cycle: 1, season: expected });
    expect(harmony(skipped)).toEqual(harmony(stepped));
    expect(chronicleOf(skipped, HOME_SITE)).toEqual(chronicleOf(stepped, HOME_SITE));
    expect(report.chapters).toContainEqual({ site: HOME_SITE, chapter: 'harmony' });
    expect(skipped.cycle.maxHarmony).toBeCloseTo(stepped.cycle.maxHarmony, 9);
  });

  it('„Ereignis des Waldes“: das Ereignis des aktiven Waldes, gleich welche Option – andere nicht', () => {
    const state = forest(5, { active: 'floodplain', ancient: true });
    state.pendingEncounters.push({ type: 'event', cards: ['storm'], rerolls: 0 });
    expect(chooseEventOption(state, 0, 0).ok).toBe(true);
    expect(hasChapter(state, 'floodplain', 'signature')).toBe(false);
    state.pendingEncounters.push({ type: 'event', cards: ['rain'], rerolls: 0 });
    expect(chooseEventOption(state, 0, 1).ok).toBe(true);
    expect(chronicleOf(state, 'floodplain').find((e) => e.chapter === 'signature')).toEqual({ chapter: 'signature', cycle: 1, season: 'spring' });
    // Das Mastjahr ist das Ereignis des Heimatwalds und der Buchenhallen – hier zählt es nicht.
    state.pendingEncounters.push({ type: 'event', cards: ['mast-year'], rerolls: 0 });
    expect(chooseEventOption(state, 0, 0).ok).toBe(true);
    expect(chapters(state, HOME_SITE)).toEqual(['ancient']);
  });

  it('„Die Kennart“: nur die eigene Kennart im aktiven Wald (auch als Stammgast oder Wildwechsel)', () => {
    const state = forest(5, { active: 'floodplain', ancient: true, animals: ['dormouse'] });
    recordDiscoveries(state);
    expect(hasChapter(state, 'floodplain', 'kennart')).toBe(false);
    expect(hasChapter(state, HOME_SITE, 'kennart')).toBe(false);
    state.niches.pond = ['beaver'];
    state.cycle.bonuses.push({ source: 'rain', effect: { kind: 'slot', niche: 'pond', amount: 1 } });
    recordDiscoveries(state);
    expect(chronicleOf(state, 'floodplain').at(-1)).toEqual({ chapter: 'kennart', cycle: 1, season: 'spring' });
  });

  it('„Voller Einklang“: H_max ≥ CHRONICLE_HARMONY im aktiven Wald; darunter nicht', () => {
    const state = forest(5);
    state.cycle.maxHarmony = CHRONICLE_HARMONY - 0.5;
    recordDiscoveries(state);
    expect(hasChapter(state, HOME_SITE, 'harmony')).toBe(false);
    state.cycle.maxHarmony = CHRONICLE_HARMONY;
    recordDiscoveries(state);
    expect(hasChapter(state, HOME_SITE, 'harmony')).toBe(true);
    // NaN oder Unsinn schreibt nichts.
    const broken = forest(5);
    broken.cycle.maxHarmony = Number.NaN;
    recordDiscoveries(broken);
    expect(hasChapter(broken, HOME_SITE, 'harmony')).toBe(false);
  });

  it('„Uralt geworden“ und „Ein Wald erinnert sich“ beim Neuen Zyklus, gestempelt mit dem endenden Zyklus', () => {
    const state = forest(ANCIENT_STAGE);
    state.meta.forestMemory = MAX_FOREST_MEMORY;
    state.cycle.number = 4;
    state.cycle.elapsed = 2 * SEASON_SECONDS + 1;
    const result = startNewCycle(state, 1);
    expect(result.ok && result.chapters).toEqual([
      { site: 'home', chapter: 'ancient' },
      { site: 'home', chapter: 'memory' },
    ]);
    expect(chronicleOf(state, HOME_SITE)).toEqual([
      { chapter: 'ancient', cycle: 4, season: 'autumn' },
      { chapter: 'memory', cycle: 4, season: 'autumn' },
    ]);
    // Ohne Urwald und mit wenig Gedächtnis: nichts.
    const grove = forest(5);
    const r = startNewCycle(grove, 1);
    expect(r.ok && r.chapters).toEqual([]);
    expect(chapters(grove)).toEqual([]);
  });

  it('ruhende Wälder schreiben nichts; ein Kapitel steht nur einmal', () => {
    const state = forest(ANCIENT_STAGE, { active: 'carr', ancient: true });
    state.cycle.maxHarmony = 300;
    recordDiscoveries(state);
    expect(chapters(state, 'carr')).toEqual(['ancient', 'harmony']);
    expect(chapters(state, HOME_SITE)).toEqual(['ancient']);
    expect(writeChapter(state, 'carr', 'harmony')).toBe(false);
    expect(writeChapter(state, 'mountain', 'harmony')).toBe(false); // nicht gegründet
    expect(chapters(state, 'carr')).toEqual(['ancient', 'harmony']);
  });

  it('vor der Landschaft schreibt der Heimatwald still mit', () => {
    const state = forest(ANCIENT_STAGE, { unlocked: false, seed: 8 });
    state.cycle.elapsed = 3 * SEASON_SECONDS - 1;
    state.cycle.maxHarmony = 260;
    // An der Grenze zuerst der Schnee, danach führt H_max den Einklang nach.
    expect(tick(state, 2).chapters.map((c) => c.chapter)).toEqual(['first-snow', 'harmony']);
  });
});

describe('Vollständige Chroniken und Erfolge (26.5)', () => {
  const complete = (): ChronicleEntry[] => CHAPTER_IDS.map(undated);

  it('chronicleComplete, completedChronicles und die Erfolge chronicle-1, chronicle-all, kennarten-all', () => {
    const state = forest(5);
    expect(completedChronicles(state)).toEqual([]);
    state.meta.landscape.sites[0]!.chronicle = complete().slice(0, 5);
    expect(chronicleComplete(state, HOME_SITE)).toBe(false);
    state.meta.landscape.sites[0]!.chronicle = complete();
    expect(chronicleComplete(state, HOME_SITE)).toBe(true);
    expect(completedChronicles(state)).toEqual([HOME_SITE]);
    expect(isAchieved(state, ACHIEVEMENTS_BY_ID.get('chronicle-1')!)).toBe(true);
    expect(isAchieved(state, ACHIEVEMENTS_BY_ID.get('chronicle-all')!)).toBe(false);
    expect(targetOf(ACHIEVEMENTS_BY_ID.get('chronicle-all')!.condition)).toBe(SITE_IDS.length);
    state.meta.landscape.sites = SITE_IDS.map((id) => ({ ...createSite(id), chronicle: complete() }));
    state.meta.journal.species.push(...KENNARTEN.map((k) => k.id));
    const fresh = checkAchievements(state);
    expect(fresh).toEqual(expect.arrayContaining(['chronicle-1', 'chronicle-all', 'kennarten-all']));
    for (const id of ['chronicle-1', 'chronicle-all', 'kennarten-all']) expect(ACHIEVEMENTS_BY_ID.get(id)!.requires).toBe('landscape');
  });

  it('kaputte Chroniken zählen nicht (keine Liste, unbekannte Wälder)', () => {
    const state = forest(5);
    (state.meta.landscape.sites[0] as { chronicle: unknown }).chronicle = 'voll';
    expect(completedChronicles(state)).toEqual([]);
    expect(chronicleOf(state, HOME_SITE)).toEqual([]);
  });
});

describe('Spielstand v16 (26.6)', () => {
  const raw = (state: GameState, patch: (data: Record<string, any>) => void = () => {}): string => {
    const data = JSON.parse(serialize(state));
    patch(data);
    return JSON.stringify(data);
  };

  /** Landschaft mit drei Wäldern: Heimatwald voll und uralt, Auwald aktiv, Erlenbruch jung. */
  function v16State(): GameState {
    const state = forest(5, { active: 'floodplain', ancient: true, animals: ['earthworm', 'robin'] });
    const home = state.meta.landscape.sites[0]!;
    home.memory = MAX_FOREST_MEMORY;
    home.chronicle = [
      { chapter: 'ancient', cycle: 2, season: 'winter' },
      { chapter: 'first-snow', cycle: 2, season: 'winter' },
      { chapter: 'memory', cycle: 5, season: 'summer' },
    ];
    state.meta.landscape.sites.push({ ...createSite('carr'), memory: 200 });
    state.meta.landscape.corridors = ['home-floodplain', 'home-carr'];
    state.meta.landscape.freeCorridors = ['home-floodplain', 'home-carr'];
    state.cycle.number = 6;
    state.meta.journal.species.push('beaver');
    state.meta.landscape.sites[1]!.chronicle.push({ chapter: 'kennart', cycle: 6, season: 'spring' }, { chapter: 'signature', cycle: 6, season: 'spring' });
    return state;
  }

  it('SAVE_VERSION 16; Roundtrip gleich, zweites Laden ändert nichts', () => {
    expect(SAVE_VERSION).toBe(18);
    const state = v16State();
    recordDiscoveries(state);
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded).toEqual(state);
    expect(loadGame(serialize(loaded), 0)!.state).toEqual(loaded);
  });

  it('Migration v15 → v16: abgeleitete Kapitel ohne Datum, sonst nichts – ein Feld gleichen Namens zählt nicht', () => {
    const state = v16State();
    const v15 = raw(state, (d) => {
      d.version = 15;
      // Ein v15-Stand kennt keine Kennarten; eine erfundene Chronik zählt nicht.
      d.meta.journal.species = d.meta.journal.species.filter((id: string) => id !== 'beaver');
      d.meta.landscape.sites[1].chronicle = [{ chapter: 'harmony', cycle: 1, season: 'spring' }];
    });
    const loaded = loadGame(v15, 0)!.state;
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(chronicleOf(loaded, HOME_SITE)).toEqual([undated('ancient'), undated('memory')]);
    expect(chronicleOf(loaded, 'floodplain')).toEqual([undated('ancient')]);
    expect(chronicleOf(loaded, 'carr')).toEqual([]);
    // Aktiver Wald: Gedächtnis aus `meta.forestMemory`.
    const active = raw(state, (d) => {
      d.version = 15;
      d.meta.forestMemory = MAX_FOREST_MEMORY;
    });
    expect(chronicleOf(loadGame(active, 0)!.state, 'floodplain')).toEqual([undated('ancient'), undated('memory')]);
  });

  it('jede Version v2 … v15 lädt ohne Absturz als v16', () => {
    const state = forest(5, { animals: ['earthworm', 'robin'] });
    for (let version = 2; version <= 15; version++) {
      const loaded = loadGame(raw(state, (d) => (d.version = version)), 0);
      expect(loaded, `v${version}`).not.toBeNull();
      expect(loaded!.state.version, `v${version}`).toBe(SAVE_VERSION);
      for (const site of loaded!.state.meta.landscape.sites) expect(Array.isArray(site.chronicle), `v${version}`).toBe(true);
      // Ab v14 mit Landschaft (Heimatwald uralt nur mit dem Erfolg): abgeleitet.
      const home = chronicleOf(loaded!.state, HOME_SITE);
      expect(home.every((e) => e.cycle === null && e.season === null), `v${version}`).toBe(true);
    }
  });

  it('robust: unbekannte und doppelte Kapitel, kaputte Stempel, unbelegte Kapitel fallen weg; fehlende abgeleitete kommen dazu', () => {
    const state = v16State();
    const loaded = loadGame(
      raw(state, (d) => {
        d.meta.landscape.sites[0].chronicle = [
          { chapter: 'memory', cycle: 99, season: 'monsoon' }, // Zyklus > laufender, Jahreszeit unbekannt → null
          { chapter: 'memory', cycle: 1, season: 'spring' }, // doppelt
          { chapter: 'dragon', cycle: 1, season: 'spring' }, // unbekannt
          null,
          'harmony',
          { chapter: 'harmony', cycle: 2.5, season: 'summer' },
          { chapter: 'signature', cycle: 0, season: 'winter' },
          { chapter: 'kennart', cycle: 3, season: 'autumn' }, // Haselmaus nicht im Tagebuch
        ];
        // Erlenbruch: nie Urwald, wenig Gedächtnis – „uralt“, „Gedächtnis“ und „Schnee“ unbelegt.
        d.meta.landscape.sites[2].chronicle = [
          { chapter: 'ancient', cycle: 1, season: 'spring' },
          { chapter: 'memory', cycle: 1, season: 'spring' },
          { chapter: 'first-snow', cycle: 1, season: 'winter' },
          { chapter: 'harmony', cycle: 1, season: 'summer' },
        ];
        // Auwald: kein Array.
        d.meta.landscape.sites[1].chronicle = { chapter: 'ancient' };
      }),
      0,
    )!.state;
    expect(chronicleOf(loaded, HOME_SITE)).toEqual([
      { chapter: 'memory', cycle: null, season: null },
      { chapter: 'harmony', cycle: null, season: 'summer' },
      { chapter: 'signature', cycle: null, season: 'winter' },
      undated('ancient'), // ergänzt
    ]);
    expect(chronicleOf(loaded, 'carr')).toEqual([{ chapter: 'harmony', cycle: 1, season: 'summer' }]);
    expect(chronicleOf(loaded, 'floodplain')).toEqual([undated('ancient')]);
    for (const site of loaded.meta.landscape.sites) expect(site.chronicle.length).toBeLessThanOrEqual(CHAPTER_IDS.length);
    // Riesige Listen: höchstens sechs Einträge.
    const huge = loadGame(
      raw(state, (d) => {
        d.meta.landscape.sites[0].chronicle = Array.from({ length: 10_000 }, (_, i) => ({ chapter: CHAPTER_IDS[i % 6], cycle: 1, season: 'spring' }));
      }),
      0,
    )!.state;
    expect(chronicleOf(huge, HOME_SITE).length).toBeLessThanOrEqual(CHAPTER_IDS.length);
  });

  it('Kennarten reisen mit v16 (Tagebuch, Nischen, Bestand); v15-Geräte lehnen den Stand ab', () => {
    const state = v16State();
    state.niches.pond = ['beaver'];
    state.cycle.bonuses.push({ source: 'rain', effect: { kind: 'slot', niche: 'pond', amount: 1 } });
    state.cycle.seen.push('rain');
    state.meta.landscape.sites[0]!.fauna = ['dormouse'];
    state.meta.journal.species.push('dormouse');
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded.niches.pond).toEqual(['beaver']);
    expect(loaded.meta.journal.species).toEqual(expect.arrayContaining(['beaver', 'dormouse']));
    expect(loaded.meta.landscape.sites[0]!.fauna).toEqual(['dormouse']);
    // Versionsprüfung (25.5): ein v15-Spiel sieht den Stand als neuer – beim Abgleich und beim Import.
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, 15)).toBe(true);
    expect(isNewerSave(raw(state, (d) => (d.version = SAVE_VERSION + 1)))).toBe(true);
    expect(importCode(codeFromJson(raw(state, (d) => (d.version = SAVE_VERSION + 1))), 0)).toEqual({ ok: false, error: 'newer' });
  });
});
