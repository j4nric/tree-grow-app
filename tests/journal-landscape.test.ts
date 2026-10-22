import { describe, expect, it } from 'vitest';
import { LANDSCAPE_SITES, LANDSCAPE_SITES_BY_ID, LANDSCAPE_UNLOCK_MEMORY, type SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { MAIN_TREES_BY_ID } from '../src/content/trees';
import { evaluate } from '../src/core/formulas';
import { ANCIENT_STAGE, jaySeeds } from '../src/core/landscape';
import { createSite, type GameState, type LandscapeSite } from '../src/core/state';
import { toJournalView } from '../src/ui/adapters';
import {
  FAUNA_HIGHLIGHTS,
  faunaHighlightsText,
  journalLandscapeCount,
  memoryText,
  regularsText,
  toJournalLandscapeView,
} from '../src/ui/journal-landscape-view';
import { stateAt } from './helpers';

/**
 * Naturtagebuch, Reiter „Landschaft“ (DESIGN_V2.md 24.11) – View-Model ohne DOM:
 * Sichtbarkeit (Spoiler), Angaben je Wald, Korridore, Hähersaat-Bilanz.
 */

const GROVE = STAGES.findIndex((s) => s.id === 'grove');

function withLandscape(
  opts: {
    stage?: number;
    own?: number;
    active?: SiteId;
    sites?: LandscapeSite[];
    corridors?: string[];
    free?: string[];
    achievement?: boolean;
    animals?: string[];
  } = {},
): GameState {
  const state = stateAt(opts.stage ?? GROVE, opts.animals ?? [], 3);
  state.meta.forestMemory = opts.own ?? 300;
  if (opts.achievement ?? true) state.meta.achievements.push('ancient-forest');
  state.meta.landscape = {
    active: opts.active ?? 'home',
    sites: opts.sites ?? [{ ...createSite('home'), ancient: true }],
    corridors: opts.corridors ?? [],
    freeCorridors: opts.free ?? [],
    announced: true,
  };
  return state;
}

const row = (site: { rows: { key: string; value: string; label: string }[] }, key: string) =>
  site.rows.find((r) => r.key === key);

describe('Reiter „Landschaft“: Sichtbarkeit (Spoiler-Regel)', () => {
  it('vor der Freischaltung: keine Ansicht, kein Zähler, kein Standort-Name im Tagebuch', () => {
    const state = withLandscape({ own: LANDSCAPE_UNLOCK_MEMORY - 1 });
    expect(toJournalLandscapeView(state)).toBeNull();
    const journal = toJournalView(state, evaluate(state));
    expect(journal.landscape).toBeNull();
    expect(journal.tabCounts.landscape).toBe('');
    const json = JSON.stringify(journal);
    for (const s of LANDSCAPE_SITES.filter((x) => x.id !== 'home')) expect(json).not.toContain(s.name);
    expect(json).not.toContain('🪶');
  });

  it('ohne Urwald-Erfolg auch mit viel Gedächtnis verborgen', () => {
    expect(toJournalLandscapeView(withLandscape({ own: 900, achievement: false }))).toBeNull();
  });

  it('nach der Freischaltung sichtbar, Zähler = gegründete Wälder', () => {
    const state = withLandscape({ own: LANDSCAPE_UNLOCK_MEMORY });
    const view = toJournalLandscapeView(state)!;
    expect(view).not.toBeNull();
    expect(view.sites.map((s) => s.id)).toEqual(['home']);
    expect(journalLandscapeCount(view)).toBe(`1/${LANDSCAPE_SITES.length}`);
    expect(toJournalView(state, evaluate(state)).tabCounts.landscape).toBe('1/6');
    expect(view.summary).toBe('1 von 6 Wäldern gegründet · 0 von 10 Korridoren');
    expect(view.sitesHint).toBe('5 Wälder warten noch – gründen kannst du im Bereich „Neuer Zyklus“.');
    expect(view.corridors).toEqual([]);
  });
});

describe('Reiter „Landschaft“: Angaben je Wald', () => {
  /** Heimatwald ruht (400 eigen), aktiv ist der Auwald (100 eigen), Mühlbach gratis, Hohlweg nicht gebaut. */
  const linked = () =>
    withLandscape({
      own: 100,
      active: 'floodplain',
      animals: ['robin', 'blackwoodpecker'],
      sites: [
        { ...createSite('home'), memory: 400, ancient: true, regulars: ['robin', 'owl'], mainTree: 'beech', fauna: ['robin', 'owl', 'jay', 'woodpecker', 'blackwoodpecker', 'woodant'] },
        { ...createSite('floodplain'), memory: 0 },
      ],
      corridors: ['home-floodplain'],
      free: ['home-floodplain'],
    });

  it('Name, Waldtyp, Reihenfolge der Gründung, aktiver Wald markiert', () => {
    const view = toJournalLandscapeView(linked())!;
    expect(view.sites.map((s) => s.id)).toEqual(['home', 'floodplain']);
    const [home, flood] = view.sites;
    expect(home!.name).toBe('Heimatwald');
    expect(home!.forestType).toBe(LANDSCAPE_SITES_BY_ID.get('home')!.forestType);
    expect(home!.active).toBe(false);
    expect(flood!.name).toBe('Auwald am Fluss');
    expect(flood!.forestType).toBe('Hartholzaue');
    expect(flood!.active).toBe(true);
  });

  it('Gedächtnis eigen/wirksam: aktiver aus meta.forestMemory, Zufluss über Korridore', () => {
    const [home, flood] = toJournalLandscapeView(linked())!.sites;
    // Heimatwald: 400 eigen + 0,5 · 100 = 450; Auwald: 100 + 0,5 · 400 = 300.
    expect(row(home!, 'memory')!.value).toBe('400 eigen · 450 wirksam');
    expect(row(flood!, 'memory')!.value).toBe('100 eigen · 300 wirksam');
    expect(memoryText(1000, 1000)).toBe('1.000 eigen · 1.000 wirksam');
  });

  it('Urwald ja/nein; beim aktiven zählt die erreichte Stufe Urwald', () => {
    const state = linked();
    let [home, flood] = toJournalLandscapeView(state)!.sites;
    expect(home!.ancient).toBe(true);
    expect(row(home!, 'ancient')!.value).toMatch(/^ja/);
    expect(flood!.ancient).toBe(false);
    expect(row(flood!, 'ancient')!.value).toBe('noch nicht – der erste bringt 2 🪶');
    state.stage = ANCIENT_STAGE;
    [, flood] = toJournalLandscapeView(state)!.sites;
    expect(flood!.ancient).toBe(true);
  });

  it('Leitbaum aus den Daten, dazu zuletzt gewachsener bzw. jetziger Hauptbaum', () => {
    const state = linked();
    state.cycle.mainTree = 'oak';
    const [home, flood] = toJournalLandscapeView(state)!.sites;
    // Heimatwald und Auwald haben keinen eigenen Leitbaum → Stieleiche.
    expect(row(home!, 'lead')!.value).toBe('🌳 Stieleiche');
    expect(row(home!, 'tree')).toEqual({ key: 'tree', label: 'Zuletzt gewachsen', value: '🍂 Rotbuche' });
    expect(row(flood!, 'tree')).toEqual({ key: 'tree', label: 'Hauptbaum jetzt', value: '🌳 Stieleiche' });
    const heath = withLandscape({
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('heath'), mainTree: 'oak' }],
    });
    const lead = LANDSCAPE_SITES_BY_ID.get('heath')!.leadTree!;
    const tree = MAIN_TREES_BY_ID.get(lead)!;
    expect(row(toJournalLandscapeView(heath)!.sites[1]!, 'lead')!.value).toBe(`${tree.icon} ${tree.name}`);
  });

  it('Stammgäste: aktiver aus meta.regulars, ruhender aus dem Eintrag', () => {
    const state = linked();
    state.meta.regulars = ['blackwoodpecker'];
    const [home, flood] = toJournalLandscapeView(state)!.sites;
    expect(row(home!, 'regulars')!.value).toBe('Rotkehlchen und Waldkauz');
    expect(row(flood!, 'regulars')!.value).toBe('Schwarzspecht');
    state.meta.regulars = [];
    expect(row(toJournalLandscapeView(state)!.sites[1]!, 'regulars')!.value).toBe('keine');
    expect(regularsText(['robin', 'unbekannt', 'robin'])).toBe('Rotkehlchen');
  });

  it('Tiere: ruhender Wald mit Bestand beim Verlassen, aktiver mit laufendem Bestand', () => {
    const state = linked();
    // Nur entdeckte Arten nennen (Spoiler-Regel).
    state.meta.journal.species.push('owl', 'jay', 'woodpecker', 'woodant');
    const [home, flood] = toJournalLandscapeView(state)!.sites;
    const fauna = row(home!, 'fauna')!;
    expect(fauna.label).toBe('Zuletzt gesehen');
    // Seltenste zuerst, höchstens FAUNA_HIGHLIGHTS, Rest gezählt.
    expect(FAUNA_HIGHLIGHTS).toBe(4);
    expect(fauna.value).toBe('Schwarzspecht (legendär), Waldkauz (besonders), Buntspecht (selten), Eichelhäher (selten) und 2 weitere Arten');
    expect(row(flood!, 'fauna')).toEqual({ key: 'fauna', label: 'Lebt gerade hier', value: 'Schwarzspecht (legendär) und Rotkehlchen' });
  });

  it('Tiere: unentdeckte und unbekannte Arten fehlen; ohne Tiere keine Zeile', () => {
    expect(faunaHighlightsText(['robin', 'owl', 'nope'], ['robin'])).toBe('Rotkehlchen');
    expect(faunaHighlightsText(['owl'], [])).toBeNull();
    expect(faunaHighlightsText(['robin', 'robin', 'jay', 'owl', 'woodpecker', 'blackwoodpecker'], ['robin', 'jay', 'owl', 'woodpecker', 'blackwoodpecker'])).toMatch(
      /und 1 weitere Art$/,
    );
    const state = withLandscape();
    expect(row(toJournalLandscapeView(state)!.sites[0]!, 'fauna')).toBeUndefined();
  });
});

describe('Reiter „Landschaft“: Korridore und Hähersaat', () => {
  it('gebaute Korridore mit Enden und Herkunft (gratis bzw. gekauft)', () => {
    const state = withLandscape({
      own: 500,
      sites: [
        { ...createSite('home'), ancient: true },
        { ...createSite('floodplain'), memory: 200 },
        { ...createSite('carr'), memory: 100 },
      ],
      corridors: ['home-floodplain', 'home-carr', 'floodplain-carr', 'unbekannt'],
      free: ['home-floodplain', 'home-carr'],
    });
    const view = toJournalLandscapeView(state)!;
    expect(view.corridors.map((c) => c.id)).toEqual(['home-floodplain', 'home-carr', 'floodplain-carr']);
    expect(view.corridors[0]).toEqual({
      id: 'home-floodplain',
      icon: '💧',
      name: 'Mühlbach',
      ends: 'Heimatwald – Auwald am Fluss',
      note: 'mit der Gründung, gratis',
    });
    expect(view.corridors[2]!.note).toBe('gebaut für 3 🪶');
    expect(view.summary).toBe('3 von 6 Wäldern gegründet · 3 von 10 Korridoren');
  });

  it('Hähersaat-Bilanz wie core (verdient/ausgegeben/verfügbar)', () => {
    const state = withLandscape({
      own: 500,
      sites: [{ ...createSite('home'), ancient: true }, { ...createSite('floodplain'), memory: 200, ancient: true }],
      corridors: ['home-floodplain'],
      free: ['home-floodplain'],
    });
    const seeds = jaySeeds(state);
    // 5 + 2 (Heimat) + 2 + 2 (Auwald) = 11 verdient, 3 für die Gründung.
    expect(seeds).toEqual({ earned: 11, spent: 3, available: 8 });
    const view = toJournalLandscapeView(state)!;
    expect(view.jaySeeds).toEqual([
      { key: 'earned', label: 'Verdient', value: '11 🪶' },
      { key: 'spent', label: 'Ausgegeben', value: '3 🪶' },
      { key: 'available', label: 'Verfügbar', value: '8 🪶' },
    ]);
    expect(view.jaySeedsNote).toContain('1 🪶 je 100 eigenes Waldgedächtnis');
  });

  it('alle sechs Wälder: kein Hinweis auf weitere', () => {
    const state = withLandscape({ sites: LANDSCAPE_SITES.map((s) => ({ ...createSite(s.id), ancient: s.id === 'home' })) });
    const view = toJournalLandscapeView(state)!;
    expect(view.sites).toHaveLength(6);
    expect(view.sitesHint).toBeNull();
    expect(journalLandscapeCount(view)).toBe('6/6');
  });
});
