import { describe, expect, it } from 'vitest';
import { HOME_SITE, type SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { createSite, type ChronicleEntry, type GameState } from '../src/core/state';
import { toCardView, toEventView } from '../src/ui/adapters';
import { KENNART_ICON, KENNART_LABEL, kennartMark, signatureChapterText, siteInOld } from '../src/ui/chronicle-view';
import { stateAt } from './helpers';

/**
 * Playtest Phase 9, F5: Kennart-Karten in U:Begegnung hervorgehoben (Band, Wald, Kapitel) und
 * das Ereignis des Waldes mit dem Hinweis, dass es ein Kapitel der Chronik schreibt. Vor der
 * Landschaft nichts (Spoiler-Regel, 26.4 „still mitgeschrieben“).
 */

const ANCIENT = STAGES.findIndex((s) => s.id === 'ancient-forest');
const entry = (chapter: ChronicleEntry['chapter']): ChronicleEntry => ({ chapter, cycle: 3, season: 'summer' });

/** Landschaft frei (300 Gedächtnis im Heimatwald), `active` gegründet und aktiv; `chronicles` je Wald. */
function landscape(active: SiteId, chronicles: Partial<Record<SiteId, ChronicleEntry[]>> = {}, unlocked = true): GameState {
  const state = stateAt(ANCIENT, [], 3);
  const ids = new Set<SiteId>([HOME_SITE, active, ...(Object.keys(chronicles) as SiteId[])]);
  const sites = [...ids].map((id) => ({ ...createSite(id), ancient: true, memory: id === active ? 0 : 300, chronicle: chronicles[id] ?? [] }));
  state.meta.landscape = { active, sites, corridors: [], freeCorridors: [], announced: unlocked };
  state.meta.forestMemory = unlocked ? 300 : 100;
  if (unlocked) state.meta.achievements.push('ancient-forest');
  return state;
}

describe('F5: Kennart auf der Karte', () => {
  it('„im alten …“ mit dem richtigen Artikel', () => {
    expect(siteInOld('floodplain')).toBe('im alten Auwald am Fluss');
    expect(siteInOld('beechwood')).toBe('in den alten Buchenhallen');
    expect(siteInOld('heath')).toBe('in der alten Kiefernheide');
  });

  it('im eigenen, aktiven Wald: Band, Wald und das Kapitel, das ihr Einzug schreibt', () => {
    const mark = kennartMark(landscape('floodplain'), 'beaver')!;
    expect(mark).toEqual({
      site: 'floodplain',
      icon: KENNART_ICON,
      label: KENNART_LABEL,
      text: 'Lebt nur im alten Auwald am Fluss.',
      chapter: '📜 Zieht sie ein, schreibt der Wald das Kapitel „Die Kennart: Biber“.',
    });
  });

  it('Wildwechsel in einen anderen Wald: Kapitel zählt nur zu Hause', () => {
    const mark = kennartMark(landscape('home', { floodplain: [] }), 'beaver')!;
    expect(mark.chapter).toBe('📜 Ihr Kapitel „Die Kennart: Biber“ schreibt nur der Wald, in dem sie zu Hause ist.');
  });

  it('Kapitel schon geschrieben: Band ohne Kapitel-Zeile', () => {
    const mark = kennartMark(landscape('floodplain', { floodplain: [entry('kennart')] }), 'beaver')!;
    expect(mark.text).toBe('Lebt nur im alten Auwald am Fluss.');
    expect(mark.chapter).toBeUndefined();
  });

  it('gewöhnliche Arten und vor der Landschaft: keine Markierung', () => {
    expect(kennartMark(landscape('floodplain'), 'earthworm')).toBeNull();
    expect(kennartMark(landscape('home', {}, false), 'beaver')).toBeNull();
    expect(kennartMark(landscape('floodplain'), 'gibt-es-nicht')).toBeNull();
  });

  it('toCardView trägt die Markierung, andere Karten nicht', () => {
    const state = landscape('floodplain');
    state.pendingEncounters = [{ type: 'animal', cards: ['beaver', 'earthworm'], rerolls: 0 }];
    expect(toCardView(state, 0, 0)!.kennart?.site).toBe('floodplain');
    expect(toCardView(state, 0, 1)!.kennart).toBeUndefined();
  });
});

describe('F5: Ereignis des Waldes schreibt ein Kapitel', () => {
  it('im aktiven Wald, solange das Kapitel offen ist', () => {
    expect(signatureChapterText(landscape('floodplain'), 'rain')).toBe(
      '📜 Schreibt ein Kapitel der Chronik: „Frühjahrshochwasser“ – gleich, wie du dich entscheidest.',
    );
    expect(signatureChapterText(landscape('heath'), 'beetle-year')).toContain('„Das Käferjahr“');
  });

  it('nicht für andere Ereignisse, andere Wälder, ein geschriebenes Kapitel oder vor der Landschaft', () => {
    expect(signatureChapterText(landscape('floodplain'), 'storm')).toBeNull();
    expect(signatureChapterText(landscape('home'), 'rain')).toBeNull();
    expect(signatureChapterText(landscape('floodplain', { floodplain: [entry('signature')] }), 'rain')).toBeNull();
    // Heimatwald vor der Landschaft: still mitgeschrieben, kein Hinweis.
    expect(signatureChapterText(landscape('home', {}, false), 'mast-year')).toBeNull();
  });

  it('toEventView setzt `chapter` nur beim Ereignis des Waldes', () => {
    const state = landscape('floodplain');
    state.pendingEncounters = [
      { type: 'event', cards: ['rain'], rerolls: 0 },
      { type: 'event', cards: ['storm'], rerolls: 0 },
    ];
    expect(toEventView(state, 0)!.chapter).toContain('Frühjahrshochwasser');
    expect(toEventView(state, 1)!.chapter).toBeUndefined();
    expect('chapter' in toEventView(state, 1)!).toBe(false);
  });
});
