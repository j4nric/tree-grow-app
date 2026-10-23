import { describe, expect, it } from 'vitest';
import {
  CORRIDORS,
  FOUNDING_COSTS,
  HOME_SITE,
  LANDSCAPE_UNLOCK_MEMORY,
  MAX_JAY_SEEDS,
  MAX_SITE_FAUNA,
  SITE_IDS,
  type SiteId,
} from '../src/content/landscape';
import { CARE } from '../src/content/care';
import { PLANTS } from '../src/content/plants';
import { SEASON_IDS, SEASON_SECONDS } from '../src/content/seasons';
import { SPECIES } from '../src/content/species';
import { NICHE_IDS, type NicheId } from '../src/content/types';
import {
  appearsContext,
  ecosystemOf,
  environmentEffects,
  evaluate,
  evaluateEcosystem,
  nicheSlots,
  plantSlots,
  regularSlots,
  regularSlotsOf,
  slotBonuses,
} from '../src/core/formulas';
import {
  ANCIENT_STAGE,
  corridorBetween,
  effectiveForestMemory,
  effectiveMemoryOf,
  jaySeeds,
  jaySeedsOfSite,
  landscapeAnnouncementDue,
  landscapeTraits,
  landscapeUnlocked,
  ownMemory,
} from '../src/core/landscape';
import { loadGame, serialize } from '../src/core/save';
import { MAX_FOREST_MEMORY, SAVE_VERSION, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import {
  buildCorridor,
  corridorBlocker,
  landscapeCorridors,
  markLandscapeAnnounced,
  previewNewCycle,
  recordDiscoveries,
  setRegulars,
  startNewCycle,
} from '../src/core/tick';
import { stateAt } from './helpers';

/**
 * Waldlandschaft in core/ (DESIGN_V2.md 24, Schritt A): Spielstand v14, abgeleitete Werte
 * (wirksames Gedächtnis, Hähersaat, Freischaltung), Eigenheiten und Gaben, Gründen,
 * Wechseln, Korridore, Laden. Inhalte prüft tests/landscape.test.ts, online = offline
 * tests/tick.test.ts.
 */

/** Ruhender Wald mit Gedächtnis (und optional Urwald) – mit den Kapiteln, die das Laden ableitet (v16). */
function site(id: SiteId, memory = 0, ancient = false, extra: Partial<LandscapeSite> = {}): LandscapeSite {
  const chronicle: LandscapeSite['chronicle'] = [];
  if (ancient) chronicle.push({ chapter: 'ancient', cycle: null, season: null });
  if (memory >= MAX_FOREST_MEMORY) chronicle.push({ chapter: 'memory', cycle: null, season: null });
  return { ...createSite(id), memory, ancient, chronicle, ...extra };
}

/** Spielstand mit Landschaft: aktiver Wald `active` mit eigenem Gedächtnis `own`. */
function withLandscape(
  stage: number,
  opts: { active?: SiteId; own?: number; sites?: LandscapeSite[]; corridors?: string[]; free?: string[]; animals?: string[]; unlocked?: boolean } = {},
): GameState {
  const state = stateAt(stage, opts.animals ?? [], 11);
  const active = opts.active ?? HOME_SITE;
  state.meta.forestMemory = opts.own ?? 0;
  const sites = opts.sites ?? [];
  const all = [site(HOME_SITE), ...sites.filter((s) => s.id !== HOME_SITE)];
  const home = sites.find((s) => s.id === HOME_SITE);
  if (home) all[0] = home;
  if (!all.some((s) => s.id === active)) all.push(site(active));
  for (const s of all) if (s.id === active) Object.assign(s, { memory: 0, regulars: [] });
  state.meta.landscape = { active, sites: all, corridors: opts.corridors ?? [], freeCorridors: opts.free ?? [], announced: false };
  if (opts.unlocked ?? true) state.meta.achievements.push('ancient-forest');
  return state;
}

/** Urwald im Heimatwald, Landschaft frei (300 Gedächtnis), mit ein paar Tieren. */
function ancientHome(own = 300): GameState {
  const state = withLandscape(ANCIENT_STAGE, { own, animals: ['earthworm', 'robin', 'bee', 'bluetit', 'frog'] });
  state.meta.regulars = ['earthworm', 'robin', 'bee'];
  return state;
}

describe('Spielstand v14: Startwerte', () => {
  it('SAVE_VERSION 14; neuer Stand: nur der Heimatwald, aktiv, ohne Korridore', () => {
    expect(SAVE_VERSION).toBe(16);
    const state = stateAt(0);
    expect(state.version).toBe(SAVE_VERSION);
    expect(state.meta.landscape).toEqual({
      active: 'home',
      sites: [{ id: 'home', memory: 0, regulars: [], ancient: false, mainTree: 'oak', fauna: [], chronicle: [] }],
      corridors: [],
      freeCorridors: [],
      announced: false,
    });
    expect(landscapeUnlocked(state)).toBe(false);
    expect(jaySeeds(state)).toEqual({ earned: 0, spent: 0, available: 0 });
  });

  it('ohne Freischaltung ändert sich nichts: Heimatwald ohne Eigenheit und Gabe, wirksam = eigenes', () => {
    const state = stateAt(5, ['earthworm', 'robin', 'bee'], 3);
    state.meta.forestMemory = 123.5;
    expect(effectiveForestMemory(state)).toBe(123.5);
    expect(regularSlotsOf(state)).toBe(regularSlots(123.5));
    expect(landscapeTraits('home', ['home'])).toEqual([]);
    const eco = ecosystemOf(state);
    expect(eco.forestMemory).toBe(123.5);
    expect(eco.habitats).toEqual([]);
    expect(environmentEffects(5, 'spring', 'oak', 'home', ['home'])).toEqual(environmentEffects(5, 'spring', 'oak'));
  });
});

describe('Rechenregeln (24.4, 24.6)', () => {
  it('wirksames Gedächtnis: eigenes + Zufluss (höchstens 500), höchstens 1000, nur über gebaute Korridore', () => {
    const base = { sites: [site('home', 600), site('carr', 300)] };
    expect(effectiveForestMemory(withLandscape(0, { ...base, active: 'floodplain', own: 0 }))).toBe(0);
    expect(effectiveForestMemory(withLandscape(0, { ...base, active: 'floodplain', corridors: ['home-floodplain'] }))).toBe(300);
    expect(effectiveForestMemory(withLandscape(0, { ...base, active: 'floodplain', corridors: ['home-floodplain', 'floodplain-carr'] }))).toBe(450);
    // Deckel des Zuflusses: 0,5 · (1000 + 1000) = 1000 → 500.
    const full = withLandscape(0, { active: 'floodplain', own: 100, sites: [site('home', 1000), site('carr', 1000)], corridors: ['home-floodplain', 'floodplain-carr'] });
    expect(effectiveForestMemory(full)).toBe(600);
    // Obergrenze MAX_FOREST_MEMORY.
    const late = withLandscape(0, { active: 'floodplain', own: 900, sites: [site('home', 1000)], corridors: ['home-floodplain'] });
    expect(effectiveForestMemory(late)).toBe(MAX_FOREST_MEMORY);
    // Korridore zu anderen Wäldern zählen nicht; Zufluss wird abgerundet, eigenes nicht.
    expect(effectiveForestMemory(withLandscape(0, { ...base, active: 'floodplain', corridors: ['home-carr'] }))).toBe(0);
    const odd = withLandscape(0, { active: 'floodplain', own: 10.5, sites: [site('home', 33)], corridors: ['home-floodplain'] });
    expect(effectiveForestMemory(odd)).toBe(10.5 + 16);
    // Der Heimatwald bekommt vom ruhenden Auwald; der Nachbar zählt mit seinem eigenen Gedächtnis.
    const home = withLandscape(0, { own: 400, sites: [site('floodplain', 200)], corridors: ['home-floodplain'] });
    expect(effectiveForestMemory(home)).toBe(500);
    expect(effectiveMemoryOf(home, 'floodplain')).toBe(400);
  });

  it('wirksames Gedächtnis: NaN, ±Infinity und negative Werte zählen als 0', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5]) {
      const state = withLandscape(0, { own: bad, sites: [site('floodplain', 100)], corridors: ['home-floodplain'] });
      expect(effectiveForestMemory(state)).toBe(50);
      expect(ownMemory(state, 'home')).toBe(0);
    }
  });

  it('Hähersaat: 1 je volle 100 eigenes Gedächtnis, +2 je erstem Urwald; Kosten aus Gründungen und gekauften Korridoren', () => {
    expect(jaySeedsOfSite(266, true)).toBe(4);
    expect(jaySeedsOfSite(99, false)).toBe(0);
    expect(jaySeedsOfSite(NaN, false)).toBe(0);
    expect(jaySeedsOfSite(5000, false)).toBe(10);
    const state = withLandscape(5, {
      own: 266,
      sites: [site('home', 0, true), site('floodplain', 1000, true), site('carr', 99)],
      corridors: ['home-floodplain', 'floodplain-carr', 'home-carr'],
      free: ['home-floodplain', 'floodplain-carr'],
    });
    // 2 + 2 (Heimatwald) + 10 + 2 (Auwald) + 0 (Bruch); Gründungen 3 + 5, gekauft: Wiesengraben 2.
    expect(jaySeeds(state)).toEqual({ earned: 16, spent: 10, available: 6 });
  });

  it('Hähersaat: der aktive Wald zählt als Urwald, sobald die Stufe erreicht ist; höchstens MAX_JAY_SEEDS', () => {
    const before = withLandscape(ANCIENT_STAGE - 1, { own: 300 });
    const at = withLandscape(ANCIENT_STAGE, { own: 300 });
    expect(jaySeeds(before).earned).toBe(3);
    expect(jaySeeds(at).earned).toBe(5);
    const max = withLandscape(ANCIENT_STAGE, { own: 1e9, sites: SITE_IDS.map((id) => site(id, 1e9, true)) });
    expect(jaySeeds(max).earned).toBe(MAX_JAY_SEEDS);
  });

  it('Freischaltung: Urwald-Erfolg und ≥ 250 eigenes Gedächtnis im Heimatwald – auch, wenn ein anderer Wald aktiv ist', () => {
    expect(landscapeUnlocked(withLandscape(0, { own: LANDSCAPE_UNLOCK_MEMORY }))).toBe(true);
    expect(landscapeUnlocked(withLandscape(0, { own: LANDSCAPE_UNLOCK_MEMORY - 1 }))).toBe(false);
    expect(landscapeUnlocked(withLandscape(0, { own: 1000, unlocked: false }))).toBe(false);
    const away = withLandscape(0, { active: 'floodplain', own: 0, sites: [site('home', 300)] });
    expect(landscapeUnlocked(away)).toBe(true);
  });

  it('Stammgast-Plätze aus dem wirksamen Gedächtnis (setRegulars, Vorschau)', () => {
    const state = withLandscape(5, { own: 50, sites: [site('floodplain', 100)], corridors: ['home-floodplain'], animals: ['earthworm', 'robin', 'bee', 'bluetit'] });
    expect(regularSlotsOf(state)).toBe(regularSlots(100));
    expect(setRegulars(state, ['earthworm', 'robin', 'bee', 'bluetit']).ok).toBe(true);
    expect(setRegulars(state, ['earthworm', 'robin', 'bee', 'bluetit', 'frog']).ok).toBe(false);
    expect(previewNewCycle(state).regularSlotsBefore).toBe(4);
  });
});

describe('Eigenheiten und Gaben (24.2)', () => {
  it('Auwald aktiv: +2 💧, Pilze −15 % 😊, ab Junger Baum +2 Plätze Waldtümpel, Merkmal Feuchte', () => {
    const env = environmentEffects(3, undefined, 'oak', 'floodplain', ['home', 'floodplain']);
    expect(env.effects).toEqual(expect.arrayContaining([{ kind: 'water', amount: 2 }, { kind: 'slot', niche: 'pond', amount: 2 }]));
    expect(env.happiness).toContainEqual({ kind: 'happiness', genus: 'fungi', points: -15 });
    const young = withLandscape(3, { active: 'floodplain' });
    const sapling = withLandscape(2, { active: 'floodplain' });
    expect(evaluate(young).slots.pond).toBe(2);
    expect(evaluate(sapling).slots.pond).toBe(0);
    expect(nicheSlots(3, young.niches, slotBonuses(young)).pond).toBe(2);
    expect(ecosystemOf(young).habitats).toContain('feucht');
    expect(appearsContext(ecosystemOf(young)).tags.has('feucht')).toBe(true);
  });

  it('Gaben wirken in allen Wäldern, sobald gegründet – auch im Heimatwald (Auwald: +1 Waldtümpel ab Alter Baum)', () => {
    const without = withLandscape(4);
    const withGift = withLandscape(4, { sites: [site('floodplain', 0)] });
    expect(evaluate(without).slots.pond).toBe(0);
    expect(evaluate(withGift).slots.pond).toBe(1);
    expect(slotBonuses(withGift)).toContainEqual({ niche: 'pond', amount: 1 });
    // Die Eigenheit des Auwalds gilt dort nicht (nur die Gabe).
    expect(ecosystemOf(withGift).habitats).not.toContain('feucht');
  });

  it('Eigenheiten verändern evaluate (Cache-Schlüssel: Standort und Gaben)', () => {
    const home = withLandscape(5, { animals: ['earthworm', 'robin', 'chanterelle', 'bee'] });
    const away = structuredClone(home);
    away.meta.landscape.sites.push(site('heath'));
    away.meta.landscape.active = 'heath';
    const a = evaluate(home);
    const b = evaluate(away);
    expect(b).not.toEqual(a);
    expect(evaluate(home)).toEqual(a);
  });
});

describe('Gründen, Wechseln, Korridore (24.5, 24.6)', () => {
  it('Vorschau: gesperrt vor der Freischaltung, danach Gründen nur aus dem Urwald und nur nebenan', () => {
    const locked = withLandscape(ANCIENT_STAGE, { own: 100, unlocked: false });
    expect(previewNewCycle(locked).landscape.sites.filter((s) => !s.active).every((s) => s.blocker === 'site-locked')).toBe(true);
    const grove = withLandscape(5, { own: 400 });
    expect(previewNewCycle(grove).landscape.sites.find((s) => s.id === 'floodplain')!.blocker).toBe('needs-ancient-forest');
    const early = withLandscape(4, { own: 400 });
    expect(previewNewCycle(early).landscape.sites.find((s) => s.id === 'floodplain')!.blocker).toBe('cycle-locked');
    const ring = withLandscape(ANCIENT_STAGE, { active: 'floodplain', own: 0, sites: [site('home', 400, true)], corridors: ['home-floodplain'], free: ['home-floodplain'] });
    const p = previewNewCycle(ring).landscape;
    expect(p.sites.find((s) => s.id === 'beechwood')!.blocker).toBe('not-adjacent');
    expect(p.sites.find((s) => s.id === 'carr')).toMatchObject({ blocker: null, cost: FOUNDING_COSTS[1], freeCorridor: 'floodplain-carr' });
    expect(p.sites.find((s) => s.id === 'home')).toMatchObject({ founded: true, blocker: null });
  });

  it('Gründung aus dem Urwald: Gewinn dem alten Wald, ancient, Gratis-Korridor, Stammgäste mitgebracht, Gedächtnis 0', () => {
    const state = ancientHome();
    const preview = previewNewCycle(state);
    const fl = preview.landscape.sites.find((s) => s.id === 'floodplain')!;
    expect(fl).toMatchObject({ founded: false, blocker: null, cost: FOUNDING_COSTS[0], freeCorridor: 'home-floodplain' });
    expect(fl.effectiveMemory).toBe(Math.floor(0.5 * preview.memoryAfter));
    const animals = ['earthworm', 'robin', 'bee', 'bluetit', 'frog'].filter((id) => Object.values(state.niches).some((n) => n.includes(id)));
    const result = startNewCycle(state, 5, undefined, 'floodplain');
    expect(result).toMatchObject({ ok: true, site: 'floodplain', founded: true, landscapeUnlocked: false });
    const l = state.meta.landscape;
    expect(l.active).toBe('floodplain');
    expect(l.sites.map((s) => s.id)).toEqual(['home', 'floodplain']);
    expect(l.sites[0]).toMatchObject({ memory: preview.memoryAfter, ancient: true, regulars: ['earthworm', 'robin', 'bee'], mainTree: 'oak' });
    expect(l.sites[0]!.fauna).toEqual(animals);
    expect(l.sites[1]).toEqual({ id: 'floodplain', memory: 0, regulars: [], ancient: false, mainTree: 'oak', fauna: [], chronicle: [] });
    // Kapitel „Uralt geworden“ im alten Wald, gestempelt mit dem endenden Zyklus (26.4).
    expect(l.sites[0]!.chronicle).toEqual([{ chapter: 'ancient', cycle: 1, season: 'spring' }]);
    expect(result.ok && result.chapters).toEqual([{ site: 'home', chapter: 'ancient' }]);
    expect(l.corridors).toEqual(['home-floodplain']);
    expect(l.freeCorridors).toEqual(['home-floodplain']);
    expect(state.meta.forestMemory).toBe(0);
    expect(effectiveForestMemory(state)).toBe(fl.effectiveMemory);
    expect(state.meta.regulars).toEqual(['earthworm', 'robin', 'bee'].slice(0, regularSlotsOf(state)));
    // Hähersaat: 3 (Gedächtnis) + 2 (Urwald) − 3 (Gründung).
    expect(jaySeeds(state)).toEqual({ earned: Math.floor(preview.memoryAfter / 100) + 2, spent: 3, available: Math.floor(preview.memoryAfter / 100) - 1 });
    expect(state.stage).toBe(0);
    expect(state.cycle.number).toBe(2);
  });

  it('Wechsel hin und zurück erhält Gedächtnis und Stammgäste beider Wälder', () => {
    const state = ancientHome();
    expect(startNewCycle(state, 1, undefined, 'floodplain').ok).toBe(true);
    const homeMemory = state.meta.landscape.sites[0]!.memory;
    // Im Auwald bis zum Hain wachsen, eigene Stammgäste wählen, zurück in den Heimatwald.
    Object.assign(state, { stage: 5, waypoint: 25 });
    state.meta.forestMemory = 60;
    state.meta.journal.species.push('toad');
    expect(setRegulars(state, ['toad']).ok).toBe(true);
    const gain = previewNewCycle(state).memoryGain;
    const back = startNewCycle(state, 2, undefined, 'home');
    expect(back).toMatchObject({ ok: true, site: 'home', founded: false });
    expect(state.meta.forestMemory).toBe(homeMemory);
    expect(state.meta.regulars).toEqual(['earthworm', 'robin', 'bee']);
    expect(state.meta.landscape.sites[1]).toMatchObject({ id: 'floodplain', memory: 60 + gain, regulars: ['toad'], ancient: false });
    expect(state.meta.landscape.sites[0]).toMatchObject({ memory: 0, regulars: [] });
    // Und wieder hin: die Stammgäste des Auwalds sind zurück.
    Object.assign(state, { stage: 5, waypoint: 25 });
    expect(startNewCycle(state, 3, undefined, 'floodplain').ok).toBe(true);
    expect(state.meta.regulars).toEqual(['toad']);
    expect(ownMemory(state, 'floodplain')).toBe(60 + gain);
  });

  it('Fehler ändern nichts: gesperrt, kein Urwald, nicht nebenan, zu wenig Hähersaat, unbekannt, Baum gesperrt', () => {
    const cases: [GameState, SiteId, string][] = [
      [withLandscape(ANCIENT_STAGE, { own: 100, unlocked: false }), 'floodplain', 'site-locked'],
      [withLandscape(5, { own: 400 }), 'floodplain', 'needs-ancient-forest'],
      [withLandscape(ANCIENT_STAGE, { active: 'floodplain', sites: [site('home', 400, true)], corridors: ['home-floodplain'], free: ['home-floodplain'] }), 'beechwood', 'not-adjacent'],
      [withLandscape(ANCIENT_STAGE, { own: 250, sites: [site('floodplain', 0)], corridors: ['home-floodplain'], free: ['home-floodplain'] }), 'carr', 'not-enough-jay-seeds'],
      [withLandscape(ANCIENT_STAGE, { own: 300 }), 'atlantis' as SiteId, 'site-locked'],
      [withLandscape(4, { own: 300 }), 'floodplain', 'cycle-locked'],
    ];
    for (const [state, target, error] of cases) {
      const before = structuredClone(state);
      expect(startNewCycle(state, 9, undefined, target), `${target}: ${error}`).toEqual({ ok: false, error });
      expect(state).toEqual(before);
    }
    const tree = ancientHome();
    const before = structuredClone(tree);
    expect(startNewCycle(tree, 9, 'beech', 'floodplain')).toEqual({ ok: false, error: 'tree-locked' });
    expect(tree).toEqual(before);
  });

  it('Freischaltung im selben Neustart: Gewinn hebt den Heimatwald über 250 – gründen geht sofort, Meldung einmal', () => {
    const state = ancientHome(LANDSCAPE_UNLOCK_MEMORY - 1);
    state.meta.achievements = []; // Erfolg kommt erst mit dem Neustart (checkAchievements)
    state.cycle.maxHarmony = 150;
    const preview = previewNewCycle(state);
    expect(preview.memoryAfter).toBeGreaterThanOrEqual(LANDSCAPE_UNLOCK_MEMORY);
    expect(preview.landscape).toMatchObject({ unlocked: false, unlockedAfter: true });
    const result = startNewCycle(state, 1, undefined, 'heath');
    expect(result).toMatchObject({ ok: true, founded: true, landscapeUnlocked: true });
    expect(state.meta.achievements).toContain('ancient-forest');
  });

  it('Vorauswahl der Baumart: Leitbaum (falls freigeschaltet), sonst Eiche; beim Wechsel die zuletzt dort gewachsene', () => {
    const a = ancientHome();
    expect(previewNewCycle(a).landscape.sites.find((s) => s.id === 'beechwood')!.mainTree).toBe('oak');
    a.meta.journal.plants.push('beech');
    expect(previewNewCycle(a).landscape.sites.find((s) => s.id === 'beechwood')!.mainTree).toBe('beech');
    expect(startNewCycle(a, 1, undefined, 'beechwood').ok).toBe(true);
    expect(a.cycle.mainTree).toBe('beech');
    Object.assign(a, { stage: 5, waypoint: 25 });
    expect(startNewCycle(a, 2, 'oak', 'home').ok).toBe(true);
    expect(a.meta.landscape.sites.find((s) => s.id === 'beechwood')!.mainTree).toBe('beech');
    Object.assign(a, { stage: 5, waypoint: 25 });
    expect(startNewCycle(a, 3, undefined, 'beechwood').ok).toBe(true);
    expect(a.cycle.mainTree).toBe('beech');
  });

  it('ohne Standort wie bisher: Neuer Zyklus im aktiven Wald, Landschaft unverändert bis auf ancient/mainTree', () => {
    const state = ancientHome();
    const result = startNewCycle(state, 1);
    expect(result).toMatchObject({ ok: true, site: 'home', founded: false });
    expect(state.meta.landscape).toEqual({
      active: 'home',
      sites: [{ id: 'home', memory: 0, regulars: [], ancient: true, mainTree: 'oak', fauna: [], chronicle: [{ chapter: 'ancient', cycle: 1, season: 'spring' }] }],
      corridors: [],
      freeCorridors: [],
      announced: false,
    });
  });

  it('Korridor bauen: nur zwischen gegründeten Wäldern, Kosten aus der Hähersaat, wirkt sofort', () => {
    const state = withLandscape(3, {
      own: 400,
      sites: [site('home', 0, true), site('floodplain', 200), site('carr', 0)],
      corridors: ['home-floodplain', 'home-carr'],
      free: ['home-floodplain', 'home-carr'],
      active: 'home',
    });
    // 4 + 2 + 2 = 8 verdient, 3 + 5 = 8 ausgegeben.
    expect(jaySeeds(state).available).toBe(0);
    expect(corridorBlocker(state, 'floodplain-carr')).toBe('not-enough-jay-seeds');
    expect(corridorBlocker(state, 'home-beechwood')).toBe('site-locked');
    expect(corridorBlocker(state, 'home-floodplain')).toBe('corridor-built');
    expect(corridorBlocker(state, 'nope')).toBe('unknown-corridor');
    state.meta.forestMemory = 700;
    expect(jaySeeds(state).available).toBe(3);
    const before = effectiveMemoryOf(state, 'carr');
    expect(buildCorridor(state, 'floodplain-carr')).toEqual({ ok: true });
    expect(effectiveMemoryOf(state, 'carr')).toBe(before + 100);
    expect(jaySeeds(state).available).toBe(0);
    expect(buildCorridor(state, 'floodplain-carr')).toEqual({ ok: false, error: 'corridor-built' });
    expect(landscapeCorridors(state).map((c) => c.id)).toEqual(CORRIDORS.map((c) => c.id));
    expect(landscapeCorridors(state).find((c) => c.id === 'floodplain-carr')).toMatchObject({ built: true, free: false, blocker: 'corridor-built' });
  });

  it('Meldung zur Freischaltung: fällig, bis die UI sie markiert – einmal, dauerhaft, übersteht Speichern', () => {
    const locked = withLandscape(5, { own: 100 });
    expect(landscapeAnnouncementDue(locked)).toBe(false);
    expect(markLandscapeAnnounced(locked)).toBe(false);
    expect(locked.meta.landscape.announced).toBe(false);
    const state = withLandscape(5, { own: 300 });
    expect(landscapeAnnouncementDue(state)).toBe(true);
    // Ohne UI bleibt sie fällig – auch über Neustarts und Speichern/Laden hinweg.
    Object.assign(state, { stage: 5, waypoint: 25 });
    expect(startNewCycle(state, 1).ok).toBe(true);
    const reloaded = loadGame(serialize(state), 0)!.state;
    expect(landscapeAnnouncementDue(reloaded)).toBe(true);
    expect(markLandscapeAnnounced(reloaded)).toBe(true);
    expect(markLandscapeAnnounced(reloaded)).toBe(false);
    expect(landscapeAnnouncementDue(reloaded)).toBe(false);
    expect(loadGame(serialize(reloaded), 0)!.state.meta.landscape.announced).toBe(true);
  });

  it('ungültiger aktiver Wald (kaputter Stand zur Laufzeit): Neuer Zyklus im Heimatwald statt Fehler', () => {
    const state = withLandscape(5, { own: 40, sites: [site('floodplain', 70)], corridors: ['home-floodplain'] });
    state.meta.landscape.active = 'atlantis' as SiteId;
    expect(effectiveForestMemory(state)).toBe(40 + 35);
    const result = startNewCycle(state, 1);
    expect(result).toMatchObject({ ok: true, site: 'home', founded: false });
    expect(state.meta.landscape.active).toBe('home');
    // Fehlt sogar der Heimatwald, wird er ergänzt – vorn, vor den übrigen Wäldern.
    const noHome = withLandscape(5, { own: 10, sites: [site('carr', 50)] });
    noHome.meta.landscape.sites = noHome.meta.landscape.sites.filter((s) => s.id !== 'home');
    expect(startNewCycle(noHome, 1)).toMatchObject({ ok: true, site: 'home' });
    expect(noHome.meta.landscape.sites.map((s) => s.id)).toEqual(['home', 'carr']);
  });

  it('jeder Standort liegt am Heimatwald (corridorBetween)', () => {
    for (const id of SITE_IDS) if (id !== HOME_SITE) expect(corridorBetween(HOME_SITE, id), id).toBeDefined();
    expect(corridorBetween('home', 'home')).toBeUndefined();
  });
});

describe('Laden v14 (24.8)', () => {
  /** Ganze Landschaft: Auwald aktiv, Heimatwald und Bruch ruhend. */
  function landscapeState(): GameState {
    const state = withLandscape(4, {
      active: 'floodplain',
      own: 520, // bezahlt alles: 4 + 2 (Heimatwald) + 5 (Auwald) ≥ 3 + 5 + 2
      sites: [site('home', 400, true, { regulars: ['earthworm', 'robin'], fauna: ['earthworm', 'robin', 'bee'] }), site('carr', 50)],
      corridors: ['home-floodplain', 'floodplain-carr', 'home-carr'],
      free: ['home-floodplain', 'floodplain-carr'],
      animals: ['earthworm', 'robin', 'bee', 'toad', 'frog', 'newt'],
    });
    state.meta.regulars = ['toad'];
    return state;
  }

  const raw = (state: GameState, patch: (data: any) => void = () => {}): string => {
    const data = JSON.parse(serialize(state));
    patch(data);
    return JSON.stringify(data);
  };

  it('Roundtrip mit ganzer Landschaft; Tümpel-Plätze des Auwalds zählen beim Kürzen der Nischen', () => {
    const state = landscapeState();
    recordDiscoveries(state); // H_max wie nach dem Laden
    // Alter Baum im Auwald: 2 (Eigenheit) + 1 (Gabe) Plätze Waldtümpel.
    expect(evaluate(state).slots.pond).toBe(3);
    const loaded = loadGame(serialize(state), 0)!;
    expect(loaded.state).toEqual(state);
    expect(loaded.landscapeUnlocked).toBe(false);
    expect(loaded.state.niches.pond).toEqual(['toad', 'frog', 'newt']);
  });

  it('v13 → v14: Heimatwald aktiv, Gedächtnis und Stammgäste bleiben, ancient aus dem Urwald-Erfolg, Meldung einmal', () => {
    const state = stateAt(5, ['earthworm', 'robin', 'bee'], 4);
    state.meta.forestMemory = 260;
    state.meta.regulars = ['earthworm'];
    state.meta.achievements.push('ancient-forest');
    state.cycle.mainTree = 'oak';
    const v13 = raw(state, (d) => {
      d.version = 13;
      delete d.meta.landscape;
    });
    const loaded = loadGame(v13, 0)!;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.meta.forestMemory).toBe(260);
    expect(loaded.state.meta.regulars).toEqual(['earthworm']);
    expect(loaded.state.meta.landscape).toEqual({
      active: 'home',
      sites: [{ id: 'home', memory: 0, regulars: [], ancient: true, mainTree: 'oak', fauna: [], chronicle: [{ chapter: 'ancient', cycle: null, season: null }] }],
      corridors: [],
      freeCorridors: [],
      announced: false,
    });
    expect(loaded.landscapeUnlocked).toBe(true);
    // Unter 250 oder ohne Erfolg: keine Meldung, ancient nur mit Erfolg.
    const low = loadGame(raw(state, (d) => ((d.version = 13), (d.meta.forestMemory = 249))), 0)!;
    expect(low.landscapeUnlocked).toBe(false);
    const noAncient = loadGame(raw(state, (d) => ((d.version = 13), (d.meta.achievements = []))), 0)!;
    expect(noAncient.state.meta.landscape.sites[0]!.ancient).toBe(false);
    // Ein Feld gleichen Namens in einem v13-Stand zählt nicht.
    const fake = loadGame(raw(landscapeState(), (d) => (d.version = 13)), 0)!;
    expect(fake.state.meta.landscape.sites.map((s) => s.id)).toEqual(['home']);
    expect(fake.state.meta.landscape.active).toBe('home');
  });

  it('jede Version v2 … v13 lädt ohne Absturz mit Heimatwald-Landschaft', () => {
    const state = stateAt(5, ['earthworm', 'robin'], 8);
    for (let version = 2; version <= 13; version++) {
      const loaded = loadGame(raw(state, (d) => (d.version = version)), 0);
      expect(loaded, `v${version}`).not.toBeNull();
      expect(loaded!.state.version).toBe(SAVE_VERSION);
      expect(loaded!.state.meta.landscape.active).toBe('home');
      expect(loaded!.state.meta.landscape.sites.map((s) => s.id)).toEqual(['home']);
    }
  });

  it('robust: unbekannte IDs, Doppel, fehlender Heimatwald, kaputte Zahlen und Typen', () => {
    const state = landscapeState();
    const loaded = loadGame(
      raw(state, (d) => {
        d.meta.landscape.sites = [
          { id: 'carr', memory: 1e9, regulars: ['toad', 'toad', 'unicorn', 'robin'], ancient: 'yes', mainTree: 'baobab', fauna: [...SPECIES.map((s) => s.id), 'x'] },
          { id: 'carr', memory: 5 },
          { id: 'atlantis', memory: 3 },
          { id: 'floodplain', memory: 77, regulars: ['bee'] },
          null,
          'home',
        ];
        d.meta.landscape.corridors = ['home-floodplain', 'floodplain-carr', 'floodplain-carr', 'home-heath', 'nope', 42];
        d.meta.landscape.freeCorridors = ['home-floodplain', 'floodplain-carr', 'home-heath'];
        d.meta.landscape.announced = 'yes';
        // Alle Arten entdeckt: Der Bestand wird nur auf MAX_SITE_FAUNA gekürzt (nicht auf das Tagebuch).
        d.meta.journal.species = SPECIES.map((s) => s.id);
      }),
      0,
    )!.state;
    const l = loaded.meta.landscape;
    expect(l.sites.map((s) => s.id)).toEqual(['home', 'carr', 'floodplain']);
    expect(l.sites[0]).toEqual({ id: 'home', memory: 0, regulars: [], ancient: false, mainTree: 'oak', fauna: [], chronicle: [] });
    const carr = l.sites[1]!;
    expect(carr.memory).toBe(MAX_FOREST_MEMORY);
    expect(carr.ancient).toBe(false);
    expect(carr.mainTree).toBe('oak');
    expect(carr.fauna).toHaveLength(MAX_SITE_FAUNA);
    // 'unicorn' unbekannt, 'toad' je einmal; 'robin' ist entdeckt.
    expect(carr.regulars).toEqual(['toad', 'robin']);
    // Aktiver Wald: Gedächtnis 0, keine geparkten Stammgäste.
    expect(l.active).toBe('floodplain');
    expect(l.sites[2]).toMatchObject({ memory: 0, regulars: [] });
    expect(loaded.meta.forestMemory).toBe(520);
    expect(l.corridors).toEqual(['home-floodplain', 'floodplain-carr']);
    expect(l.freeCorridors).toEqual(['home-floodplain', 'floodplain-carr']);
    expect(l.announced).toBe(false); // nur echtes true zählt
    for (const bad of [null, 'x', 7, [], { sites: 'x', corridors: {}, active: 3 }]) {
      const s = loadGame(raw(state, (d) => (d.meta.landscape = bad)), 0)!.state;
      expect(s.meta.landscape.sites.map((x) => x.id)).toEqual(['home']);
      expect(s.meta.landscape.active).toBe('home');
      // Nicht umgebucht: das Gedächtnis des Auwalds steht jetzt beim Heimatwald – spielbar.
      expect(s.meta.forestMemory).toBe(520);
    }
  });

  it('robust: Gedächtnis ganzzahlig, Stammgäste ruhender Wälder auf ihre Plätze gekürzt', () => {
    const state = landscapeState();
    const loaded = loadGame(
      raw(state, (d) => {
        d.meta.forestMemory = 600; // bezahlt beide Gründungen: 6 + 2 (Urwald im Heimatwald) = 8
        d.meta.landscape.sites[0].memory = 30.9; // ohne Korridor: 1 Platz
        d.meta.landscape.sites[0].regulars = ['earthworm', 'robin', 'bee', 'toad', 'frog'];
        d.meta.landscape.corridors = [];
        d.meta.landscape.freeCorridors = [];
      }),
      0,
    )!.state;
    const home = loaded.meta.landscape.sites[0]!;
    expect(home.memory).toBe(30);
    expect(home.regulars).toEqual(['earthworm']);
    expect(loaded.meta.landscape.sites.map((s) => s.id)).toEqual(['home', 'carr', 'floodplain']);
  });

  it('robust: Gratis-Korridore ⊆ Korridore, höchstens einer je gegründetem Wald (an diesem Wald)', () => {
    const state = landscapeState();
    const loaded = loadGame(
      raw(state, (d) => {
        d.meta.forestMemory = 1000;
        d.meta.landscape.freeCorridors = ['home-carr', 'home-floodplain', 'floodplain-carr', 'home-heath'];
      }),
      0,
    )!.state;
    // home-carr belegt den Bruch, home-floodplain den Auwald – floodplain-carr hat kein freies Ende mehr.
    expect(loaded.meta.landscape.corridors).toEqual(['home-floodplain', 'floodplain-carr', 'home-carr']);
    expect(loaded.meta.landscape.freeCorridors).toEqual(['home-carr', 'home-floodplain']);
  });

  it('Kosten-Prüfung: erst gekaufte Korridore (zuletzt gebaute zuerst), dann zuletzt gegründete ruhende Wälder – nie der aktive', () => {
    // Verdient: Heimatwald 1 (Gedächtnis 100), aktiver Auwald 0; ausgegeben: 3 + 5 + 7 + Korridore.
    const state = withLandscape(2, {
      active: 'floodplain',
      own: 0,
      sites: [site('home', 100), site('carr', 0), site('heath', 0)],
      corridors: ['home-floodplain', 'floodplain-carr', 'home-heath', 'carr-heath', 'home-carr'],
      free: ['home-floodplain', 'floodplain-carr', 'home-heath'],
    });
    const loaded = loadGame(serialize(state), 0)!.state;
    const l = loaded.meta.landscape;
    expect(l.active).toBe('floodplain');
    expect(l.sites.map((s) => s.id)).toEqual(['home', 'floodplain']);
    expect(l.corridors).toEqual(['home-floodplain']);
    expect(l.freeCorridors).toEqual(['home-floodplain']);
    // Mehr ist nicht zu holen: Heimatwald und aktiver Wald bleiben, verfügbar 0.
    expect(jaySeeds(loaded)).toEqual({ earned: 1, spent: 3, available: 0 });

    // Genug für die Wälder, nicht für alle Korridore: der zuletzt gekaufte fällt zuerst.
    const rich = withLandscape(2, {
      active: 'floodplain',
      own: 0,
      sites: [site('home', 1000, true), site('carr', 0)],
      corridors: ['home-floodplain', 'home-carr', 'floodplain-carr'],
      free: ['home-floodplain'],
    });
    // Verdient 12, Gründungen 8, Korridore 2 + 3 → 13 > 12.
    const r = loadGame(serialize(rich), 0)!.state.meta.landscape;
    expect(r.corridors).toEqual(['home-floodplain', 'home-carr']);
    expect(r.sites.map((s) => s.id)).toEqual(['home', 'carr', 'floodplain']);
  });

  it('ein v13-Client erkennt einen v14-Stand als neuer (Neuer-Stand-Schutz)', async () => {
    const { isNewerSave } = await import('../src/core/save');
    expect(isNewerSave(serialize(landscapeState()))).toBe(false);
    expect(isNewerSave(JSON.stringify({ version: SAVE_VERSION + 1 }))).toBe(true);
    const { isNewerSchema } = await import('../src/sync/policy');
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, 13)).toBe(true);
  });
});

describe('Große Zahlen (24.9): kein break_infinity.js', () => {
  it('voll ausgebaute Landschaft (alle Gaben, wirksam 1000, Urwald, starke Arten, beste Jahreszeit): 🌿/s < 1e5', () => {
    let best = 0;
    for (const active of SITE_IDS) {
      const state = withLandscape(ANCIENT_STAGE, {
        active,
        own: MAX_FOREST_MEMORY,
        sites: SITE_IDS.map((id) => site(id, MAX_FOREST_MEMORY, true)),
        corridors: CORRIDORS.map((c) => c.id),
      });
      for (const m of CARE) {
        if ((m.excludes ?? []).some((x) => (state.cycle.care[x] ?? 0) > 0)) continue;
        state.cycle.care[m.id] = m.ranks.length;
      }
      // Pflanzring: die wüchsigste Pflanze, so oft es geht.
      const plant = [...PLANTS].filter((p) => p.unlock <= ANCIENT_STAGE).sort((a, b) => b.growth - a.growth)[0]!;
      state.plants = Array.from({ length: plantSlots(ANCIENT_STAGE) }, () => plant.id);
      // Gierig: jeweils die Art, die das Wachstum am meisten hebt, bis keine mehr hilft oder passt.
      for (let round = 0; round < 80; round++) {
        const now = evaluate(state);
        let pick: { id: string; niche: NicheId; gain: number } | null = null;
        for (const sp of SPECIES) {
          if (sp.unlock > ANCIENT_STAGE || NICHE_IDS.some((n) => state.niches[n].includes(sp.id))) continue;
          if (state.niches[sp.niche].length >= now.slots[sp.niche]) continue;
          const copy = structuredClone(state);
          copy.niches[sp.niche].push(sp.id);
          const gain = evaluateEcosystem(ecosystemOf(copy)).growth - now.growth;
          if (!pick || gain > pick.gain) pick = { id: sp.id, niche: sp.niche, gain };
        }
        if (!pick || pick.gain <= 0) break;
        state.niches[pick.niche].push(pick.id);
      }
      expect(effectiveForestMemory(state)).toBe(MAX_FOREST_MEMORY);
      for (let i = 0; i < SEASON_IDS.length; i++) {
        state.cycle.elapsed = i * SEASON_SECONDS + 1;
        best = Math.max(best, evaluate(state).growth, evaluate(state, 'average').growth);
      }
    }
    expect(best).toBeGreaterThan(1e3);
    expect(best).toBeLessThan(1e5);
    // Viele Auswertungen: unter Last braucht der Lauf mehr als die üblichen 5 s.
  }, 30_000);
});
