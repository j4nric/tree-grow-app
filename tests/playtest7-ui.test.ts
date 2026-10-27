/**
 * Funde aus dem Playtest Phase 7 (ROADMAP 4b, Owner `ui-dev`): Wetter des Waldtyps in der
 * Wetter-Notiz (S1), auf Karte, Tagebuch und in der Spielanleitung (S2), im Rückkehr-Bericht (S3,
 * siehe auch tests/return-report-view.test.ts), Satzgrenzen beim Zusammenführen (S4), Grund der
 * Vorauswahl in der Baumwahl (S5) sowie die kleinen Kann-Funde (Symbol Erlenbruch, Sperrgrund auf
 * der Karte, Zahl + Symbol, „erneut tippen“, Erklärung „Feuchte“).
 */
import { describe, expect, it } from 'vitest';
import { LANDSCAPE_SITES, LANDSCAPE_SITES_BY_ID, type SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { WEATHERS } from '../src/content/weather';
import { ANCIENT_STAGE } from '../src/core/landscape';
import { createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { previewNewCycle, type SiteChoice } from '../src/core/tick';
import { confirmAgainText, confirmVerb } from '../src/ui/confirm';
import { toCyclePanelView, treeChoiceFor } from '../src/ui/cycle-view';
import { joinSentences, keepNumberWithIcon } from '../src/ui/format';
import { guideSections } from '../src/ui/guide-view';
import { toJournalLandscapeView } from '../src/ui/journal-landscape-view';
import { siteHabitatNote, siteStatus, siteWeatherIcon, toLandscapeMapView } from '../src/ui/landscape-view';
import { corridorBuildLabel, siteChoiceView } from '../src/ui/album/pages/landscape-page-view';
import { averagedWeatherText, siteWeatherLine, toWeatherBadgeView } from '../src/ui/weather-view';
import { stateAt } from './helpers';

const OLD_TREE = STAGES.findIndex((s) => s.id === 'old-tree');

/** Stand mit Landschaft; `active` = Wald des laufenden Zyklus. */
function withLandscape(stage: number, active: SiteId = 'home', extra: LandscapeSite[] = []): GameState {
  const state = stateAt(stage, ['earthworm'], 3);
  state.meta.forestMemory = 300;
  state.meta.achievements.push('ancient-forest');
  const corridors = extra.map((s) => `home-${s.id}`);
  state.meta.landscape = {
    active,
    sites: [{ ...createSite('home'), ancient: true, memory: 300 }, ...extra],
    corridors,
    freeCorridors: corridors,
    announced: true,
  };
  return state;
}

const mapOf = (state: GameState) => toLandscapeMapView(state, previewNewCycle(state))!;

describe('S1 – Wetter des Waldes in der Notiz „Wetter heute“', () => {
  it('im Bergmischwald: eine Zeile mit Wald und Wetter des Waldtyps', () => {
    const state = withLandscape(OLD_TREE, 'mountain', [{ ...createSite('mountain', 'fir') }]);
    const line = 'Wetter im Bergmischwald: 🌨️ Viel Neuschnee im Winter, Steigungsregen am Hang.';
    expect(siteWeatherLine(state)).toBe(line);
    expect(toWeatherBadgeView(state).site).toBe(line);
  });

  it('Präposition je Wald („in der Kiefernheide“, „in den Buchenhallen“)', () => {
    expect(siteWeatherLine(withLandscape(OLD_TREE, 'heath', [{ ...createSite('heath', 'pine') }]))).toMatch(/^Wetter in der Kiefernheide: 🌡️ /);
    expect(siteWeatherLine(withLandscape(OLD_TREE, 'beechwood', [{ ...createSite('beechwood') }]))).toMatch(/^Wetter in den Buchenhallen: /);
  });

  it('im Heimatwald und ohne Landschaft: keine Zeile', () => {
    expect(siteWeatherLine(withLandscape(OLD_TREE))).toBeNull();
    expect(toWeatherBadgeView(stateAt(OLD_TREE, [], 1)).site).toBeNull();
  });
});

describe('S2 – Wetter je Standort auf Karte, im Tagebuch und in der Anleitung', () => {
  it('Karte: Zeichen der häufigsten Lage je Standort, Heimatwald ohne', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    const icons = Object.fromEntries(map.sites.map((s) => [s.id, s.weatherIcon]));
    expect(icons).toEqual({ home: null, floodplain: '🌧️', carr: '🌫️', beechwood: '🌫️', mountain: '🌨️', heath: '🌡️' });
    for (const s of map.sites) expect(s.weatherIcon).toBe(siteWeatherIcon(s.id));
  });

  it('Tagebuch der Wälder: Zeile „Wetter“ für gegründete Wälder außer dem Heimatwald', () => {
    const journal = toJournalLandscapeView(withLandscape(OLD_TREE, 'mountain', [{ ...createSite('mountain', 'fir') }]))!;
    const rows = (id: string) => journal.sites.find((s) => s.id === id)!.rows;
    expect(rows('home').some((r) => r.key === 'weather')).toBe(false);
    expect(rows('mountain').find((r) => r.key === 'weather')).toEqual({
      key: 'weather',
      label: 'Wetter',
      value: '🌨️ Viel Neuschnee im Winter, Steigungsregen am Hang.',
    });
  });

  it('Spielanleitung: Kapitel „Wetter“ nennt das Wetter jedes Waldtyps – erst mit der Landschaft', () => {
    const text = (landscape: boolean, id: string) => guideSections({ landscape }).find((s) => s.id === id)!.paragraphs.join(' ');
    const others = LANDSCAPE_SITES.filter((s) => s.weatherSummary);
    expect(others.length).toBe(5);
    for (const s of others) {
      expect(text(true, 'weather')).toContain(`${s.icon} ${s.name}: `);
      expect(text(true, 'weather')).toContain(s.weatherSummary);
      // Spoiler-Regel: vorher kein Wort von den Wäldern.
      expect(text(false, 'weather')).not.toContain(s.name);
    }
    expect(text(true, 'landscape')).toContain('Auch das Wetter hängt am Waldtyp');
    expect(text(true, 'landscape')).toContain('Bergmischwald');
    for (const p of guideSections({ landscape: true }).flatMap((s) => s.paragraphs)) expect(p.trim()).not.toBe('');
  });
});

describe('S3 – gemitteltes Wetter nennt den Wald', () => {
  it('außerhalb des Heimatwalds mit Präposition, sonst wie bisher', () => {
    const report = { averaged: true, weather: ['snow' as const, 'snow' as const] };
    expect(averagedWeatherText(report, 'mountain')).toBe('Wetter im Bergmischwald gemittelt (2 × Neuschnee).');
    expect(averagedWeatherText({ averaged: true, weather: [] }, 'carr')).toBe('Wetter im Erlenbruch gemittelt.');
    expect(averagedWeatherText(report, 'home')).toBe('Wetter gemittelt (2 × Neuschnee).');
    expect(averagedWeatherText(report)).toBe('Wetter gemittelt (2 × Neuschnee).');
  });
});

describe('S4 – Meldungen mit Satzgrenze verbinden', () => {
  it('jeder Teil endet mit einem Satzzeichen, auch nach schließenden Anführungszeichen', () => {
    expect(joinSentences('🏅 2 neue Erfolge: „A“ und „B“', '🪶 Ein Eichelhäher trägt Eicheln davon.')).toBe(
      '🏅 2 neue Erfolge: „A“ und „B“. 🪶 Ein Eichelhäher trägt Eicheln davon.',
    );
    expect(joinSentences('… und 1 weitere', 'Weiter.')).toBe('… und 1 weitere. Weiter.');
    expect(joinSentences('Schon fertig.', 'Wirklich?', 'Ja!')).toBe('Schon fertig. Wirklich? Ja!');
    expect(joinSentences('„Zitat.“', 'Danach')).toBe('„Zitat.“ Danach.');
  });

  it('ein einzelner Teil bleibt unverändert, leere fallen weg', () => {
    expect(joinSentences('🏅 Erfolg: „Bunter Saum“')).toBe('🏅 Erfolg: „Bunter Saum“');
    expect(joinSentences(null, '', undefined, '  ', 'Nur das')).toBe('Nur das');
    expect(joinSentences()).toBe('');
  });
});

describe('S5 – Baumwahl erklärt die Vorauswahl', () => {
  const siteOf = (state: GameState, id: SiteId) => toCyclePanelView(state).landscape!.sites.find((s) => s.id === id)!;

  it('ohne Ziel: „Wächst jetzt im Heimatwald“ an der laufenden Art (statt „(jetzt)“ am Namen)', () => {
    const view = toCyclePanelView(withLandscape(ANCIENT_STAGE));
    const oak = view.trees.find((t) => t.id === 'oak')!;
    expect(oak).toMatchObject({ name: 'Stieleiche', current: true, note: 'Wächst jetzt im Heimatwald' });
    expect(view.trees.filter((t) => t.note !== null)).toHaveLength(1);
    // Ohne Landschaft ohne Ortsangabe.
    expect(toCyclePanelView(stateAt(5, [], 1)).trees.find((t) => t.current)!.note).toBe('Wächst jetzt');
  });

  it('Bergmischwald gründen: Weißtanne mit Grund, die Eiche behält „Wächst jetzt“', () => {
    const state = withLandscape(ANCIENT_STAGE);
    const view = toCyclePanelView(state);
    const choice = treeChoiceFor(view, siteOf(state, 'mountain'));
    expect(choice.current).toBe('fir');
    expect(choice.trees.find((t) => t.id === 'fir')!.note).toBe('Leitbaum im Bergmischwald – die Gründung schaltet sie frei, darum vorausgewählt.');
    expect(choice.trees.find((t) => t.id === 'oak')!.note).toBe('Wächst jetzt im Heimatwald');
    expect(treeChoiceFor(view, siteOf(state, 'carr')).trees.find((t) => t.id === 'alder')!.note).toBe(
      'Leitbaum im Erlenbruch – die Gründung schaltet sie frei, darum vorausgewählt.',
    );
  });

  it('Leitbaum schon frei: kurzer Grund; Leitbaum gesperrt: kein Grund an der Ersatz-Art', () => {
    const state = withLandscape(ANCIENT_STAGE);
    state.meta.journal.plants.push('beech');
    const view = toCyclePanelView(state);
    const beech = treeChoiceFor(view, siteOf(state, 'beechwood'));
    expect(beech.current).toBe('beech');
    expect(beech.trees.find((t) => t.id === 'beech')!.note).toBe('Leitbaum in den Buchenhallen – darum vorausgewählt.');
    // Kiefernheide ohne Kiefer: Die Eiche wächst als Ersatz – sie ist nicht Leitbaum.
    const heath = treeChoiceFor(view, siteOf(state, 'heath'));
    expect(heath.current).toBe('oak');
    expect(heath.trees.find((t) => t.id === 'oak')!.note).toBe('Wächst jetzt im Heimatwald');
  });

  it('Wechsel in einen gegründeten Wald: die zuletzt dort gewachsene Art', () => {
    const state = withLandscape(ANCIENT_STAGE, 'home', [{ ...createSite('mountain', 'fir'), memory: 50 }]);
    const choice = treeChoiceFor(toCyclePanelView(state), siteOf(state, 'mountain'));
    expect(choice.current).toBe('fir');
    expect(choice.trees.find((t) => t.id === 'fir')!.note).toBe('Zuletzt im Bergmischwald gewachsen – darum vorausgewählt.');
  });
});

describe('Kann-Funde', () => {
  it('K1: Waldsymbole unterscheiden sich von allen Wettersymbolen und untereinander', () => {
    const weatherIcons = new Set(WEATHERS.map((w) => w.icon));
    for (const s of LANDSCAPE_SITES) expect(weatherIcons.has(s.icon), s.id).toBe(false);
    expect(new Set(LANDSCAPE_SITES.map((s) => s.icon)).size).toBe(LANDSCAPE_SITES.length);
    expect(LANDSCAPE_SITES_BY_ID.get('carr')!.icon).toBe('🐸');
  });

  it('K3: gesperrte Standorte nennen den Grund kurz', () => {
    const choice = (blocker: SiteChoice['blocker'], cost: number | null = 5): SiteChoice => ({
      id: 'heath',
      founded: false,
      active: false,
      memory: 0,
      effectiveMemory: 0,
      ancient: false,
      mainTree: 'oak',
      unlockedTrees: ['oak'],
      cost,
      freeCorridor: null,
      blocker,
    });
    expect(siteStatus(choice('needs-ancient-forest'))).toBe('erst im Urwald · 5 🪶');
    expect(siteStatus(choice('cycle-locked'))).toBe('erst im Urwald · 5 🪶');
    expect(siteStatus(choice('not-adjacent'))).toBe('nicht nebenan · 5 🪶');
    expect(siteStatus(choice('not-enough-jay-seeds'))).toBe('zu wenig 🪶 · 5 🪶');
    expect(siteStatus(choice('site-locked', null))).toBe('gesperrt');
    expect(siteStatus(choice(null, 3))).toBe('gründen · 3 🪶');
  });

  it('K3: nach einer Gründung (neuer Wald noch kein Urwald) steht „erst im Urwald“ auf der Karte', () => {
    const state = withLandscape(OLD_TREE, 'mountain', [{ ...createSite('mountain', 'fir') }]);
    const map = mapOf(state);
    for (const s of map.sites.filter((x) => !x.founded)) expect(s.status).toMatch(/^erst im Urwald · \d+ 🪶$/);
  });

  it('K5: Zahl und Symbol bleiben zusammen', () => {
    expect(keepNumberWithIcon('der erste bringt 2 🪶.')).toBe('der erste bringt 2 🪶.');
    expect(keepNumberWithIcon('(3 🪶) · +10 % 🌿')).toBe('(3 🪶) · +10 % 🌿');
    // Playtest Phase 11, F5: auch „%“ bleibt an der Zahl.
    expect(keepNumberWithIcon('Pflanzen +11,5 % 🌿')).toBe('Pflanzen +11,5\u00a0% 🌿');
    expect(keepNumberWithIcon('Gründen 🪶')).toBe('Gründen 🪶');
  });

  it('K6: „erneut tippen“ bei Touch, „erneut klicken“ sonst – überall dieselbe Wendung', () => {
    const touch = { matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) } as unknown as Window;
    const mouse = { matchMedia: () => ({ matches: false }) } as unknown as Window;
    expect(confirmVerb(touch)).toBe('tippen');
    expect(confirmVerb(mouse)).toBe('klicken');
    expect(confirmVerb(undefined)).toBe('klicken');
    expect(confirmAgainText('Wirklich neu beginnen?', 'tippen')).toBe('Wirklich neu beginnen? Zum Bestätigen erneut tippen');
    expect(corridorBuildLabel({ name: 'Altwasser', cost: 3 }, true, 'tippen')).toEqual({
      text: 'Wirklich bauen? Erneut tippen',
      label: 'Altwasser wirklich bauen? Zum Bestätigen erneut tippen',
    });
    expect(corridorBuildLabel({ name: 'Altwasser', cost: 3 }, true, 'klicken').text).toBe('Wirklich bauen? Erneut klicken');
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    const flood = map.sites.find((s) => s.id === 'floodplain')!;
    expect(siteChoiceView(map, flood, 'floodplain', 'klicken').hint).toContain('Erneut klicken: doch hier bleiben.');
    expect(siteChoiceView(map, flood, 'floodplain', 'tippen').hint).toContain('Erneut tippen: doch hier bleiben.');
  });

  it('K7: „Feuchte“ wird an feuchten Wäldern erklärt', () => {
    const map = mapOf(withLandscape(ANCIENT_STAGE));
    const note = (id: SiteId) => map.sites.find((s) => s.id === id)!.habitatNote;
    expect(note('floodplain')).toMatch(/^💧 Feuchte heißt: /);
    expect(note('carr')).toBe(siteHabitatNote('carr'));
    expect(note('mountain')).toBeNull();
    expect(note('home')).toBeNull();
    // Jeder Wald mit „Feuchte“ in der Eigenheit hat die Erklärung.
    for (const s of map.sites) if (s.gains?.includes('Feuchte')) expect(s.habitatNote, s.id).not.toBeNull();
  });
});
