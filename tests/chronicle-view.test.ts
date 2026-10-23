import { describe, expect, it } from 'vitest';
import { CHAPTER_IDS, CHRONICLE_CHAPTERS, type ChapterId } from '../src/content/chronicle';
import { HOME_SITE, LANDSCAPE_SITES, type SiteId } from '../src/content/landscape';
import { COMMON_SPECIES, KENNARTEN, SPECIES } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { evaluate } from '../src/core/formulas';
import { createSite, type ChronicleEntry, type GameState } from '../src/core/state';
import { previewNewCycle } from '../src/core/tick';
import { toJournalView } from '../src/ui/adapters';
import { kennartCaption, kennartIndices, speciesGroups } from '../src/ui/album/pages/species-view';
import {
  CHRONICLE_TOTAL,
  chapterDate,
  chapterCountText,
  chapterNewsCount,
  chapterNewsText,
  chapterNotes,
  chapterTitle,
  chaptersSince,
  chronicleKeepsakes,
  chronicleMark,
  chronicleTargetText,
  chronicleTotalText,
  chronicleUnlockText,
  firstSnowWaitText,
  KENNART_READY_HINT,
  KENNART_READY_RESTING_HINT,
  secondsToWinter,
  siteChronicleView,
  siteIn,
} from '../src/ui/chronicle-view';
import { toReturnReportView } from '../src/ui/return-report-view';
import { guideSections } from '../src/ui/guide-view';
import { toJournalLandscapeView } from '../src/ui/journal-landscape-view';
import { toLandscapeMapView } from '../src/ui/landscape-view';
import { stateAt } from './helpers';

/**
 * Waldchronik und Kennarten im Album (DESIGN_V2.md 26.7, Phase 9, 3a): Texte und Ansichten ohne
 * DOM – U:Standort, Kennzahl, Siegel, Tagebuch der Wälder, Ziel-Wald, Andenken, Stempel,
 * Reihe „Kennarten“, Spielanleitung. Vor der Landschaft nichts (Spoiler-Regel).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const entry = (chapter: ChapterId, cycle: number | null = 7, season: ChronicleEntry['season'] = 'winter'): ChronicleEntry => ({ chapter, cycle, season });

/** Landschaft frei (Urwald-Erfolg, 300 Gedächtnis im Heimatwald); `chronicles` je Wald. */
function landscape(chronicles: Partial<Record<SiteId, ChronicleEntry[]>>, opts: { unlocked?: boolean; active?: SiteId } = {}): GameState {
  const state = stateAt(ANCIENT, [], 3);
  const unlocked = opts.unlocked ?? true;
  const sites = (Object.keys(chronicles) as SiteId[]).map((id) => ({ ...createSite(id), ancient: true, memory: id === HOME_SITE ? 0 : 300, chronicle: chronicles[id]! }));
  if (!sites.some((s) => s.id === HOME_SITE)) sites.unshift({ ...createSite(HOME_SITE), ancient: true, memory: 0, chronicle: [] });
  state.meta.landscape = { active: opts.active ?? HOME_SITE, sites, corridors: [], freeCorridors: [], announced: unlocked };
  state.meta.forestMemory = unlocked ? 300 : 100;
  if (unlocked) state.meta.achievements.push('ancient-forest');
  return state;
}

const full = (): ChronicleEntry[] => CHAPTER_IDS.map((c) => entry(c));

describe('Chronik: Texte', () => {
  it('Datum „7. Zyklus · Winter“, ohne Datum „schon früher“', () => {
    expect(chapterDate(entry('ancient', 7, 'winter'))).toBe('7. Zyklus · Winter');
    expect(chapterDate(entry('ancient', 12, null))).toBe('12. Zyklus');
    expect(chapterDate(entry('ancient', null, null))).toBe('schon früher');
  });

  it('Titel je Wald: Ereignis des Waldes, Kennart erst geschrieben beim Namen', () => {
    expect(chapterTitle('floodplain', 'signature', false)).toBe('Frühjahrshochwasser');
    expect(chapterTitle('floodplain', 'kennart', false)).toBe('Die Kennart');
    expect(chapterTitle('floodplain', 'kennart', true)).toBe('Die Kennart: Biber');
    expect(chapterTitle('home', 'ancient', true)).toBe('Uralt geworden');
  });

  it('Orte im Dativ', () => {
    expect(siteIn('home')).toBe('im Heimatwald');
    expect(siteIn('beechwood')).toBe('in den Buchenhallen');
    expect(siteIn('heath')).toBe('in der Kiefernheide');
    expect(siteIn('floodplain')).toBe('im Auwald am Fluss');
  });
});

describe('Chronik: U:Standort', () => {
  it('sechs Zettel in fester Reihenfolge – geschrieben mit Datum, offen mit Hinweis ohne Spoiler', () => {
    const state = landscape({ floodplain: [entry('ancient', null, null), entry('first-snow', 7, 'winter')] });
    const view = siteChronicleView(state, 'floodplain')!;
    expect(view.chapters.map((c) => c.id)).toEqual(CHAPTER_IDS);
    expect(view.count).toBe('Chronik 2 / 6');
    expect(view.chapters[0]).toMatchObject({ written: true, date: 'schon früher', hint: null });
    expect(view.chapters[1]).toMatchObject({ written: true, date: '7. Zyklus · Winter', title: 'Erster Schnee im Urwald' });
    const open = view.chapters.filter((c) => !c.written);
    expect(open).toHaveLength(4);
    for (const c of open) {
      expect(c.date).toBeNull();
      // Kennart im alten, ruhenden Wald: eigener Hinweis (F2), sonst der aus den Inhalten.
      if (c.id === 'kennart') expect(c.hint).toBe(KENNART_READY_RESTING_HINT);
      else expect(c.hint).toBe(CHRONICLE_CHAPTERS.find((x) => x.id === c.id)!.hint);
    }
    // Keine Kennart beim Namen, solange das Kapitel offen ist.
    expect(JSON.stringify(view)).not.toContain('Biber');
    expect(view.open).toEqual(['Ereignis', 'Kennart', 'Einklang', 'Gedächtnis']);
    expect(view.keepsake).toBeNull();
    expect(view.complete).toBe(false);
  });

  it('vollständig: Andenken des Waldes', () => {
    const view = siteChronicleView(landscape({ floodplain: full() }), 'floodplain')!;
    expect(view.complete).toBe(true);
    expect(view.keepsake?.name).toBe('Biberholz');
    expect(view.open).toEqual([]);
  });

  it('vor der Landschaft und für nicht gegründete Wälder: nichts', () => {
    const locked = landscape({ home: [entry('ancient')] }, { unlocked: false });
    expect(siteChronicleView(locked, 'home')).toBeNull();
    expect(chronicleTotalText(locked)).toBe('');
    expect(chronicleKeepsakes(locked)).toEqual([]);
    expect(chronicleTargetText(locked, 'home')).toBeNull();
    expect(siteChronicleView(landscape({}), 'carr')).toBeNull();
  });
});

describe('Chronik: Landschaft, Tagebuch, Ziel-Wald', () => {
  it('Kennzahl „📜 n / 36 Kapitel“ über alle Wälder', () => {
    expect(CHRONICLE_TOTAL).toBe(36);
    const state = landscape({ home: [entry('ancient'), entry('memory')], floodplain: full() });
    expect(chronicleTotalText(state)).toBe('📜 8 / 36 Kapitel');
  });

  it('Karte: Chronik je Standort und Wachssiegel nur bei vollständiger Chronik', () => {
    const state = landscape({ home: [entry('ancient')], floodplain: full() });
    const view = toLandscapeMapView(state, previewNewCycle(state))!;
    expect(view.chronicle).toBe('📜 7 / 36 Kapitel');
    const site = (id: SiteId) => view.sites.find((s) => s.id === id)!;
    expect(site('floodplain').seal).toBe('🪵');
    expect(site('floodplain').chronicle).toBe('Chronik 6 / 6 – vollständig');
    expect(site('home').seal).toBeNull();
    expect(site('home').chronicle).toBe('Chronik 1 / 6 – offen: Erster Schnee, Ereignis, Kennart, Einklang, Gedächtnis');
    expect(site('carr').chronicle).toBeNull();
  });

  it('Tagebuch der Wälder: Zeile „Chronik“', () => {
    const journal = toJournalLandscapeView(landscape({ home: [entry('ancient')], floodplain: full() }))!;
    const row = (id: string) => journal.sites.find((s) => s.id === id)!.rows.find((r) => r.key === 'chronicle');
    expect(row('home')).toEqual({ key: 'chronicle', label: 'Chronik', value: '1 / 6 – offen: Erster Schnee, Ereignis, Kennart, Einklang, Gedächtnis' });
    expect(row('floodplain')?.value).toBe('6 / 6 – vollständig');
    // F9: „Chronik“ steht ganz oben (mobil lag sie unter langen Listen).
    for (const site of journal.sites) expect(site.rows[0]?.key, site.id).toBe('chronicle');
  });

  it('Ziel-Wald: offene Kapitel; ein neuer Wald beginnt seine Chronik', () => {
    const state = landscape({ home: [entry('ancient'), entry('memory'), entry('harmony'), entry('signature')] });
    expect(chronicleTargetText(state, 'home')).toBe('📜 Chronik 4 / 6 – offen: Erster Schnee, Kennart');
    expect(chronicleTargetText(state, 'carr')).toBe('📜 Chronik 0 / 6 – ein neuer Wald beginnt seine Chronik.');
  });
});

describe('Chronik: Stempel und Rückkehr-Bericht', () => {
  it('neue Kapitel seit dem letzten Stand – je Wald ein Satz, vollständig mit Andenken', () => {
    const state = landscape({ home: [entry('ancient')], floodplain: full().slice(0, 5) });
    const mark = chronicleMark(state);
    expect(chaptersSince(state, mark)).toEqual([]);
    state.meta.landscape.sites.find((s) => s.id === 'floodplain')!.chronicle.push(entry('memory'));
    state.meta.landscape.sites.find((s) => s.id === 'home')!.chronicle.push(entry('signature'), entry('harmony'));
    const news = chaptersSince(state, mark);
    expect(news).toEqual([
      { site: 'home', chapter: 'signature' },
      { site: 'home', chapter: 'harmony' },
      { site: 'floodplain', chapter: 'memory' },
    ]);
    expect(chapterNewsText(state, news)).toBe(
      '📜 Neue Kapitel im Heimatwald: Eichelmast – der Häher legt Vorräte an, Voller Einklang. ' +
        '📜 Neues Kapitel im Auwald am Fluss: Ein Wald erinnert sich. Die Chronik ist vollständig – Andenken: 🪵 Biberholz.',
    );
  });

  it('vor der Landschaft still; die Freischaltung nennt die Kapitel des Heimatwalds', () => {
    const locked = landscape({ home: [entry('ancient'), entry('memory'), entry('harmony')] }, { unlocked: false });
    expect(chapterNewsText(locked, [{ site: 'home', chapter: 'harmony' }])).toBe('');
    expect(chronicleUnlockText(locked)).toBe('📜 Im Heimatwald stehen schon 3 Kapitel der Chronik.');
    expect(chronicleUnlockText(landscape({ home: [entry('ancient')] }))).toBe('📜 Im Heimatwald steht schon 1 Kapitel der Chronik.');
    expect(chronicleUnlockText(landscape({ home: [] }))).toBe('');
  });
});

describe('R:Arten: Andenken und Reihe „Kennarten“', () => {
  it('Andenken der sechs Chroniken – offen ohne Namen, vollständig mit Text', () => {
    const state = landscape({ home: [entry('ancient')], floodplain: full() });
    const list = chronicleKeepsakes(state);
    expect(list.map((k) => k.key)).toEqual(LANDSCAPE_SITES.map((s) => s.id));
    const flood = list.find((k) => k.key === 'floodplain')!;
    expect(flood).toMatchObject({ complete: true, icon: '🪵', name: 'Biberholz', site: '🌊 Auwald am Fluss · Chronik vollständig' });
    const home = list.find((k) => k.key === 'home')!;
    expect(home).toMatchObject({ complete: false, name: '???', site: '🌳 Heimatwald · Chronik 1 / 6' });
    // F8: offene Andenken nennen ihre offenen Kapitel statt sechsmal desselben Satzes.
    expect(home.text).toBe('Noch offen: Erster Schnee, Ereignis, Kennart, Einklang, Gedächtnis.');
    expect(list.find((k) => k.key === 'carr')!.text).toBe('Mit der Gründung beginnt seine Chronik.');
    expect(JSON.stringify(home)).not.toContain('Eichel des Hähers');
    expect(list.find((k) => k.key === 'carr')!.site).toBe('🐸 Erlenbruch · noch nicht gegründet');
    // Zähler „Andenken“ zählt vollständige Chroniken mit.
    const view = toJournalView(state, evaluate(state));
    expect(view.chronicles).toEqual(list);
    const without = landscape({ home: [entry('ancient')], floodplain: full().slice(0, 5) });
    expect(Number(view.tabCounts.keepsakes)).toBe(Number(toJournalView(without, evaluate(without)).tabCounts.keepsakes) + 1);
  });

  it('Kennarten in eigener Reihe, Gattungen ohne sie – zusammen alle Arten', () => {
    const kennarten = kennartIndices();
    expect(kennarten.map((i) => SPECIES[i]!.id)).toEqual(KENNARTEN.map((s) => s.id));
    // Hinten in SPECIES: Die Gattungen aus COMMON_SPECIES haben dieselben Indizes.
    expect(Math.min(...kennarten)).toBe(COMMON_SPECIES.length);
    const common = speciesGroups(COMMON_SPECIES).flatMap((g) => g.indices);
    expect(new Set([...common, ...kennarten]).size).toBe(SPECIES.length);
    expect(kennartCaption(kennarten[1]!)).toBe('🌊 Auwald am Fluss');
    expect(kennartCaption(0)).toBeNull();
  });
});

describe('Spielanleitung „Chroniken und Kennarten“', () => {
  it('erst mit der Landschaft, nach „Waldlandschaft“, ohne Kennart beim Namen', () => {
    expect(guideSections({ landscape: false }).some((s) => s.id === 'chronicle')).toBe(false);
    const sections = guideSections({ landscape: true });
    const ids = sections.map((s) => s.id);
    expect(ids.indexOf('chronicle')).toBe(ids.indexOf('landscape') + 1);
    const text = sections.find((s) => s.id === 'chronicle')!.paragraphs.join(' ');
    expect(sections.find((s) => s.id === 'chronicle')!.title).toBe('Chroniken und Kennarten');
    for (const c of CHRONICLE_CHAPTERS) expect(text).toContain(c.title);
    expect(text).toContain('36 Kapitel');
    for (const name of ['Biber', 'Moorfrosch', 'Luchs', 'Stachelbart']) expect(text).not.toContain(name);
  });
});

describe('Playtest Phase 9: Funde ui-dev (F2–F4, F7)', () => {
  it('F2: offene Kennart im alten Wald – ohne Spoiler, aktiv bzw. ruhend', () => {
    // Heimatwald noch nie Urwald, Zyklus vor dem Urwald: der allgemeine Hinweis.
    const young = landscape({ home: [] });
    young.meta.landscape.sites[0]!.ancient = false;
    young.stage = ANCIENT - 1;
    const hintOf = (s: GameState, site: SiteId) => siteChronicleView(s, site)!.chapters.find((c) => c.id === 'kennart')!.hint;
    expect(hintOf(young, 'home')).toBe(CHRONICLE_CHAPTERS.find((c) => c.id === 'kennart')!.hint);
    // Der laufende Zyklus erreicht den Urwald: jetzt kann sie kommen.
    young.stage = ANCIENT;
    expect(hintOf(young, 'home')).toBe(KENNART_READY_HINT);
    // Alter, ruhender Wald: erst, wenn man wieder dort wächst.
    expect(hintOf(landscape({ floodplain: [] }), 'floodplain')).toBe(KENNART_READY_RESTING_HINT);
    for (const t of [KENNART_READY_HINT, KENNART_READY_RESTING_HINT]) for (const k of KENNARTEN) expect(t).not.toContain(k.name);
  });

  it('F3: Restzeit bis zum Winter – im Winter bis zum nächsten', () => {
    expect(secondsToWinter(0)).toBe(540);
    expect(secondsToWinter(461)).toBe(79);
    expect(secondsToWinter(540)).toBe(720);
    expect(secondsToWinter(700)).toBe(560);
    expect(secondsToWinter(720 * 3 + 100)).toBe(440);
    expect(secondsToWinter(Number.NaN)).toBe(540);
  });

  it('F3: Verweilen im Urwald nennt, worauf man wartet – nur aktiver Wald, Urwald, Kapitel offen', () => {
    const state = landscape({ home: [entry('ancient')], floodplain: [] });
    state.cycle.elapsed = 461;
    expect(firstSnowWaitText(state)).toBe('❄️ Noch 1:19 min bis zum Winter – bleib, dann schreibt der Wald „Erster Schnee“.');
    expect(firstSnowWaitText(state, 'home')).toBe(firstSnowWaitText(state));
    // Anderes Ziel: Der Hinweis nennt den Wald, in dem man verweilen würde.
    expect(firstSnowWaitText(state, undefined, true)).toBe('❄️ Noch 1:19 min bis zum Winter – bleibst du, schreibt die Chronik im Heimatwald „Erster Schnee“.');
    // Ruhender Wald, vor dem Urwald, Kapitel schon geschrieben, vor der Landschaft: nichts.
    expect(firstSnowWaitText(state, 'floodplain')).toBeNull();
    const young = landscape({ home: [] });
    young.stage = ANCIENT - 1;
    expect(firstSnowWaitText(young)).toBeNull();
    expect(firstSnowWaitText(landscape({ home: [entry('first-snow')] }))).toBeNull();
    expect(firstSnowWaitText(landscape({ home: [] }, { unlocked: false }))).toBeNull();
  });

  it('F4: Kapitel als eigener Stempel, vollständige Chronik als Zettel mit Andenken', () => {
    const state = landscape({ home: [entry('ancient')], floodplain: full() });
    const notes = chapterNotes(state, [
      { site: 'home', chapter: 'harmony' },
      { site: 'floodplain', chapter: 'memory' },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({ text: '📜 Neues Kapitel im Heimatwald: Voller Einklang.', keepsake: null });
    expect(notes[1]!.keepsake?.icon).toBe('🪵');
    expect(notes[1]!.text).toBe(
      '📜 Die Chronik im Auwald am Fluss ist vollständig! Letztes Kapitel: Ein Wald erinnert sich. Andenken: Biberholz – „Ein Ast, rundum benagt, glatt wie gedrechselt.“',
    );
    expect(chapterNotes(state, [])).toEqual([]);
    expect(chapterNotes(landscape({ home: [] }, { unlocked: false }), [{ site: 'home', chapter: 'harmony' }])).toEqual([]);
  });

  it('F7: Kurzfassung des Rückkehr-Berichts zählt neue Kapitel', () => {
    const state = landscape({ home: [entry('ancient')] });
    const news = [
      { site: 'home' as const, chapter: 'harmony' as const },
      { site: 'home' as const, chapter: 'harmony' as const },
      { site: 'floodplain' as const, chapter: 'memory' as const },
    ];
    expect(chapterNewsCount(state, news)).toBe(2);
    expect(chapterNewsCount(landscape({ home: [] }, { unlocked: false }), news)).toBe(0);
    expect(chapterCountText(0)).toBe('');
    expect(chapterCountText(1)).toBe('📜 1 neues Kapitel');
    expect(chapterCountText(3)).toBe('📜 3 neue Kapitel');
    const report = { seconds: 3600, growth: 100, seeds: 10, autoDeclined: 0, declinedSeeds: 0 };
    const view = toReturnReportView({ away: 3600, report, waiting: 0, chapters: 2, notes: ['📜 Neue Kapitel …'] });
    expect(view.headline).toContain(' · 📜 2 neue Kapitel');
    expect(toReturnReportView({ away: 3600, report, waiting: 0 }).headline).not.toContain('📜');
  });
});
