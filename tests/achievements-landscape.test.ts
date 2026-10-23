import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, type Achievement } from '../src/content/achievements';
import { CORRIDORS, HOME_SITE, SITE_IDS, type SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { checkAchievements, isAchieved, isAchievementVisible, isAchievementVisibleIn, targetOf, valueOf } from '../src/core/achievements';
import { thresholdFor } from '../src/core/formulas';
import { ANCIENT_STAGE, landscapeUnlocked } from '../src/core/landscape';
import { loadGame, serialize } from '../src/core/save';
import { SAVE_VERSION, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { buildCorridor, simulateOffline, startNewCycle, tick } from '../src/core/tick';
import { achievementCountText, toJournalAchievements } from '../src/ui/achievement-view';
import { stateAt } from './helpers';

/**
 * Erfolge der Waldlandschaft (DESIGN_V2.md 24.12, Phase 7 2a): Bedingungsarten `forests`,
 * `corridors` (mit `bought`), `ancientForests`, Sichtbarkeit `requires: 'landscape'`,
 * Zähler im Naturtagebuch, Nachtrag eines v14-Stands über die normale Prüfung und
 * online = offline.
 */

const byId = (id: string): Achievement => ACHIEVEMENTS_BY_ID.get(id)!;

const LANDSCAPE_IDS = ['forest-2', 'ancient-2', 'wildwechsel-1', 'corridor-1', 'landscape-trees', 'ancient-everywhere', 'corridors-all'];

function site(id: SiteId, memory = 0, ancient = false): LandscapeSite {
  return { ...createSite(id), memory, ancient };
}

/** Spielstand mit Landschaft (Heimatwald immer zuerst), freigeschaltet mit 300 Gedächtnis im Heimatwald. */
function withLandscape(
  stage: number,
  opts: { active?: SiteId; sites?: LandscapeSite[]; corridors?: string[]; free?: string[]; unlocked?: boolean } = {},
): GameState {
  const state = stateAt(stage, ['earthworm', 'robin', 'bee', 'bluetit', 'frog'], 11);
  const active = opts.active ?? HOME_SITE;
  const sites = [site(HOME_SITE, 300, true), ...(opts.sites ?? [])];
  if (!sites.some((s) => s.id === active)) sites.push(site(active));
  state.meta.forestMemory = active === HOME_SITE ? 300 : 0;
  for (const s of sites) if (s.id === active) s.memory = 0;
  state.meta.landscape = { active, sites, corridors: opts.corridors ?? [], freeCorridors: opts.free ?? [], announced: false };
  if (opts.unlocked ?? true) state.meta.achievements.push('ancient-forest');
  return state;
}

/** Urwald im Heimatwald, Landschaft frei. */
function ancientHome(): GameState {
  const state = withLandscape(ANCIENT_STAGE);
  state.meta.regulars = ['earthworm', 'robin', 'bee'];
  return state;
}

describe('Inhalte der Landschaft', () => {
  it('sieben Erfolge am Ende, in dieser Reihenfolge, alle mit requires: landscape', () => {
    expect(ACHIEVEMENTS.slice(-LANDSCAPE_IDS.length).map((a) => a.id)).toEqual(LANDSCAPE_IDS);
    for (const id of LANDSCAPE_IDS) expect(byId(id).requires, id).toBe('landscape');
    expect(byId('trees-all').requires).toBeUndefined();
  });

  it('jede Bedingung über die Landschaft trägt requires; sonst keiner', () => {
    for (const a of ACHIEVEMENTS) {
      const c = a.condition;
      const landscape =
        c.kind === 'forests' ||
        c.kind === 'corridors' ||
        c.kind === 'ancientForests' ||
        (c.kind === 'stat' && c.key === 'wildwechselChosen') ||
        a.id === 'landscape-trees';
      expect(a.requires === 'landscape', a.id).toBe(landscape);
    }
  });

  it('Ziele: forests/ancientForests „alle“ = Standorte, corridors „alle“ = Korridore; bought nie mit „alle“', () => {
    expect(targetOf({ kind: 'forests', atLeast: 'all' })).toBe(SITE_IDS.length);
    expect(targetOf({ kind: 'ancientForests', atLeast: 'all' })).toBe(SITE_IDS.length);
    expect(targetOf({ kind: 'corridors', atLeast: 'all' })).toBe(CORRIDORS.length);
    expect(targetOf(byId('forest-2').condition)).toBe(2);
    for (const a of ACHIEVEMENTS) {
      if (a.condition.kind === 'corridors' && a.condition.bought) expect(a.condition.atLeast, a.id).not.toBe('all');
    }
  });
});

describe('Bedingungen der Landschaft', () => {
  it('ohne Landschaft (kein meta.landscape): forests 1, corridors 0, ancientForests 0 bzw. 1 ab Urwald', () => {
    const s = stateAt(5);
    delete (s.meta as Partial<GameState['meta']>).landscape;
    expect(valueOf(s, { kind: 'forests', atLeast: 2 })).toBe(1);
    expect(valueOf(s, { kind: 'corridors', atLeast: 1 })).toBe(0);
    expect(valueOf(s, { kind: 'corridors', atLeast: 1, bought: true })).toBe(0);
    expect(valueOf(s, { kind: 'ancientForests', atLeast: 2 })).toBe(0);
    s.stage = ANCIENT_STAGE;
    expect(valueOf(s, { kind: 'ancientForests', atLeast: 2 })).toBe(1);
    expect(checkAchievements(s).filter((id) => LANDSCAPE_IDS.includes(id))).toEqual([]);
  });

  it('neues Spiel: kein Erfolg der Landschaft, Werte 1/0/0', () => {
    const s = stateAt(0);
    expect(valueOf(s, byId('forest-2').condition)).toBe(1);
    expect(valueOf(s, byId('corridors-all').condition)).toBe(0);
    expect(valueOf(s, byId('ancient-2').condition)).toBe(0);
    for (const id of LANDSCAPE_IDS) expect(isAchieved(s, byId(id)), id).toBe(false);
  });

  it('forests: bekannte Standorte je einmal; Grenze 2', () => {
    const s = withLandscape(0);
    expect(isAchieved(s, byId('forest-2'))).toBe(false);
    s.meta.landscape.sites.push(site('atlantis' as SiteId), site(HOME_SITE));
    expect(valueOf(s, byId('forest-2').condition)).toBe(1);
    s.meta.landscape.sites.push(site('carr'));
    expect(valueOf(s, byId('forest-2').condition)).toBe(2);
    expect(isAchieved(s, byId('forest-2'))).toBe(true);
    // Kaputte Liste zählt nichts.
    s.meta.landscape.sites = 'kaputt' as unknown as LandscapeSite[];
    expect(valueOf(s, byId('forest-2').condition)).toBe(0);
  });

  it('corridors: bekannte je einmal; bought ohne Gratis-Korridore; „alle“ erst mit allen zehn', () => {
    const s = withLandscape(0, { sites: [site('floodplain'), site('carr')], corridors: ['home-floodplain', 'home-floodplain', 'nope'], free: ['home-floodplain'] });
    expect(valueOf(s, { kind: 'corridors', atLeast: 1 })).toBe(1);
    expect(valueOf(s, byId('corridor-1').condition)).toBe(0);
    expect(isAchieved(s, byId('corridor-1'))).toBe(false);
    s.meta.landscape.corridors.push('floodplain-carr');
    expect(valueOf(s, byId('corridor-1').condition)).toBe(1);
    expect(isAchieved(s, byId('corridor-1'))).toBe(true);
    // Ein Gratis-Korridor, der (kaputt) nicht in corridors steht, zieht nichts ab.
    s.meta.landscape.freeCorridors.push('home-carr');
    expect(valueOf(s, byId('corridor-1').condition)).toBe(1);
    expect(isAchieved(s, byId('corridors-all'))).toBe(false);
    s.meta.landscape.corridors = CORRIDORS.slice(0, -1).map((c) => c.id);
    expect(valueOf(s, byId('corridors-all').condition)).toBe(CORRIDORS.length - 1);
    expect(isAchieved(s, byId('corridors-all'))).toBe(false);
    s.meta.landscape.corridors = CORRIDORS.map((c) => c.id);
    expect(isAchieved(s, byId('corridors-all'))).toBe(true);
    s.meta.landscape.corridors = null as unknown as string[];
    expect(valueOf(s, byId('corridors-all').condition)).toBe(0);
    expect(valueOf(s, byId('corridor-1').condition)).toBe(0);
  });

  it('ancientForests: gespeicherte ancient, aktiver Wald ab Stufe Urwald; unbekannte und doppelte zählen nicht', () => {
    const s = withLandscape(ANCIENT_STAGE - 1, { active: 'floodplain', sites: [site('carr', 0, false)] });
    expect(valueOf(s, byId('ancient-2').condition)).toBe(1);
    s.meta.landscape.sites.push(site('atlantis' as SiteId, 0, true), site(HOME_SITE, 0, true));
    expect(valueOf(s, byId('ancient-2').condition)).toBe(1);
    s.stage = ANCIENT_STAGE;
    expect(valueOf(s, byId('ancient-2').condition)).toBe(2);
    expect(isAchieved(s, byId('ancient-2'))).toBe(true);
    // NaN-Stufe zählt nicht als Urwald.
    s.stage = Number.NaN;
    expect(valueOf(s, byId('ancient-2').condition)).toBe(1);
  });

  it('ancientForests „alle“: erst wenn jeder der sechs Wälder einmal Urwald war', () => {
    const others = SITE_IDS.filter((id) => id !== HOME_SITE && id !== 'heath').map((id) => site(id, 0, true));
    const s = withLandscape(0, { active: 'heath', sites: others });
    expect(valueOf(s, byId('ancient-everywhere').condition)).toBe(SITE_IDS.length - 1);
    expect(isAchieved(s, byId('ancient-everywhere'))).toBe(false);
    s.stage = ANCIENT_STAGE;
    expect(isAchieved(s, byId('ancient-everywhere'))).toBe(true);
  });

  it('monoton: Gründen, Korridor kaufen, Wechsel hin und zurück – nichts geht verloren', () => {
    const s = ancientHome();
    expect(checkAchievements(s).filter((id) => LANDSCAPE_IDS.includes(id))).toEqual([]);
    const founded = startNewCycle(s, 1, undefined, 'floodplain');
    expect(founded.ok).toBe(true);
    if (!founded.ok) return;
    expect(founded.achievements).toContain('forest-2');
    expect(founded.achievements).not.toContain('corridor-1');
    const values = () => LANDSCAPE_IDS.map((id) => valueOf(s, byId(id).condition));
    const before = values();
    // Im Auwald bis zum Hain, zurück in den Heimatwald und wieder hin.
    Object.assign(s, { stage: 5, waypoint: 25 });
    expect(startNewCycle(s, 2, undefined, 'home').ok).toBe(true);
    expect(values()).toEqual(before);
    Object.assign(s, { stage: 5, waypoint: 25 });
    expect(startNewCycle(s, 3, undefined, 'floodplain').ok).toBe(true);
    expect(values()).toEqual(before);
    expect(s.meta.achievements).toContain('forest-2');
  });

  it('Korridor-Kauf mit buildCorridor schaltet corridor-1 frei, der Gratis-Korridor nicht', () => {
    const s = withLandscape(0, {
      sites: [site('floodplain', 200, true), site('carr', 0, false)],
      corridors: ['home-floodplain', 'home-carr'],
      free: ['home-floodplain', 'home-carr'],
    });
    s.meta.forestMemory = 700;
    expect(checkAchievements(s)).not.toContain('corridor-1');
    expect(buildCorridor(s, 'floodplain-carr')).toEqual({ ok: true });
    expect(checkAchievements(s)).toContain('corridor-1');
  });
});

describe('Sichtbarkeit und Zähler', () => {
  it('isAchievementVisible: verborgen vor der Freischaltung, sichtbar danach oder wenn schon erreicht', () => {
    const s = withLandscape(5, { unlocked: false });
    expect(landscapeUnlocked(s)).toBe(false);
    for (const id of LANDSCAPE_IDS) expect(isAchievementVisible(s, byId(id)), id).toBe(false);
    expect(isAchievementVisible(s, byId('trees-all'))).toBe(true);
    expect(isAchievementVisible(s, byId('sapling'))).toBe(true);
    // Schon erreicht (z. B. aus einem anderen Stand importiert): bleibt sichtbar.
    s.meta.achievements.push('forest-2');
    expect(isAchievementVisible(s, byId('forest-2'))).toBe(true);
    expect(isAchievementVisible(s, byId('ancient-2'))).toBe(false);
    s.meta.achievements.push('ancient-forest');
    expect(landscapeUnlocked(s)).toBe(true);
    for (const id of LANDSCAPE_IDS) expect(isAchievementVisible(s, byId(id)), id).toBe(true);
  });

  it('isAchievementVisibleIn: dieselbe Regel ohne Spielstand', () => {
    expect(isAchievementVisibleIn(byId('forest-2'), false)).toBe(false);
    expect(isAchievementVisibleIn(byId('forest-2'), false, true)).toBe(true);
    expect(isAchievementVisibleIn(byId('forest-2'), true)).toBe(true);
    expect(isAchievementVisibleIn(byId('trees-all'), false)).toBe(true);
    expect(ACHIEVEMENTS.filter((a) => isAchievementVisibleIn(a, false))).toHaveLength(27);
    expect(ACHIEVEMENTS.filter((a) => isAchievementVisibleIn(a, true))).toHaveLength(34);
  });

  it('Kacheln und Zähler: N/27 vor, N/34 nach der Freischaltung', () => {
    const before = withLandscape(5, { unlocked: false });
    const hidden = ACHIEVEMENTS.filter((a) => a.requires === 'landscape').length;
    expect(hidden).toBe(LANDSCAPE_IDS.length);
    expect(ACHIEVEMENTS.length - hidden).toBe(27);
    expect(achievementCountText(before)).toBe('0/27');
    const keys = toJournalAchievements(before).map((v) => v.key);
    expect(keys).toHaveLength(27);
    for (const id of LANDSCAPE_IDS) expect(keys).not.toContain(id);

    const after = withLandscape(5);
    expect(landscapeUnlocked(after)).toBe(true);
    expect(achievementCountText(after)).toBe('1/34');
    const tiles = toJournalAchievements(after);
    expect(tiles).toHaveLength(34);
    expect(tiles.filter((v) => !v.unlocked).slice(-LANDSCAPE_IDS.length).map((v) => v.key)).toEqual(LANDSCAPE_IDS);
    expect(tiles.find((v) => v.key === 'forest-2')!.progress).toBe('1/2');
    expect(tiles.find((v) => v.key === 'corridors-all')!.progress).toBe(`0/${CORRIDORS.length}`);
  });

  it('vor der Freischaltung erreichte (importierte) Erfolge der Landschaft erscheinen und zählen', () => {
    const s = withLandscape(5, { unlocked: false });
    s.meta.achievements.push('forest-2');
    expect(achievementCountText(s)).toBe('1/28');
    const tiles = toJournalAchievements(s);
    expect(tiles[0]).toMatchObject({ key: 'forest-2', unlocked: true });
    expect(tiles.filter((v) => LANDSCAPE_IDS.includes(v.key)).map((v) => v.key)).toEqual(['forest-2']);
  });
});

describe('Spielstand (2a ohne neue Version)', () => {
  it('v14-Stand mit drei Wäldern lädt und bekommt forest-2 und ancient-2 bei der ersten Prüfung (catchUp)', () => {
    expect(SAVE_VERSION).toBe(15);
    // Heimatwald 1000 Gedächtnis + Urwald = 12 🪶; Gründungen 3 + 5 = 8.
    const state = withLandscape(0, {
      active: 'carr',
      sites: [site('floodplain', 200, true)],
      corridors: ['home-floodplain', 'home-carr'],
      free: ['home-floodplain', 'home-carr'],
    });
    state.meta.landscape.sites[0]!.memory = 1000;
    state.meta.achievements = ['ancient-forest'];
    const loaded = loadGame(JSON.stringify({ ...JSON.parse(serialize(state)), version: 14 }), 0)!;
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.meta.landscape.sites.map((s) => s.id)).toEqual(['home', 'floodplain', 'carr']);
    expect(loaded.state.meta.achievements).toEqual(['ancient-forest']);
    // Wie catchUp in main.ts: die normale Prüfung nach dem Laden trägt nach.
    const fresh = checkAchievements(loaded.state);
    expect(fresh).toContain('forest-2');
    expect(fresh).toContain('ancient-2');
    expect(fresh).not.toContain('corridor-1');
    expect(checkAchievements(loaded.state)).toEqual([]);
    // Gespeichert und neu geladen: bleiben.
    const again = loadGame(serialize(loaded.state), 0)!.state;
    expect(again.meta.achievements).toEqual(expect.arrayContaining(['forest-2', 'ancient-2']));
  });

  it('gespeicherte Erfolge der Landschaft bleiben, auch wenn der Stand sie nicht mehr zeigt', () => {
    const state = withLandscape(0);
    state.meta.achievements.push('forest-2', 'corridors-all');
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded.meta.achievements).toEqual(['ancient-forest', 'forest-2', 'corridors-all']);
  });
});

describe('online = offline (Landschaft)', () => {
  it('kurz vor dem Urwald im 2. Wald: ein großer Tick und viele kleine schalten dieselben Erfolge frei', () => {
    const base = withLandscape(ANCIENT_STAGE - 1, { active: 'floodplain', corridors: ['home-floodplain'], free: ['home-floodplain'] });
    base.waypoint = STAGES[ANCIENT_STAGE]!.waypoint - 1;
    base.totalGrowth = thresholdFor(STAGES[ANCIENT_STAGE]!.waypoint) - 1;
    checkAchievements(base);
    expect(base.meta.achievements).not.toContain('ancient-2');
    const online = structuredClone(base);
    const offline = structuredClone(base);
    for (let i = 0; i < 600; i++) {
      tick(online, 1);
      checkAchievements(online);
    }
    simulateOffline(offline, 600);
    checkAchievements(offline);
    expect(offline.stage).toBe(ANCIENT_STAGE);
    expect(online.stage).toBe(ANCIENT_STAGE);
    expect(offline.meta.achievements).toContain('ancient-2');
    expect([...offline.meta.achievements].sort()).toEqual([...online.meta.achievements].sort());
  });
});
