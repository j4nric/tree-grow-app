import { describe, expect, it } from 'vitest';
import { CORRIDORS, CORRIDORS_BY_ID, LANDSCAPE_SITES, type SiteId } from '../src/content/landscape';
import { STAGES } from '../src/content/stages';
import { MAX_FOREST_MEMORY, createSite, type GameState, type LandscapeSite, type PendingEncounter } from '../src/core/state';
import { loadGame, serialize } from '../src/core/save';
import { declineEncounter, previewNewCycle, rerollEncounter, tick, type WildwechselCard } from '../src/core/tick';
import { toEncounterView } from '../src/ui/adapters';
import { guideSections } from '../src/ui/guide-view';
import { toLandscapeMapView } from '../src/ui/landscape-view';
import { toReturnReportView } from '../src/ui/return-report-view';
import {
  applyWildwechselMark,
  corridorViaText,
  corridorWildwechselText,
  createWildwechselMarks,
  siteFromText,
  siteInText,
  wildwechselCardText,
  wildwechselChanceText,
  wildwechselMarkOf,
  wildwechselReturnText,
} from '../src/ui/wildwechsel-view';
import { stateAt } from './helpers';

/**
 * Wildwechsel in der Oberfläche (DESIGN_V2.md 24.6, Roadmap Phase 7 → 1c): Textbausteine,
 * Markierung der Wildwechsel-Karten offener Begegnungen, Chance auf der Karte der Landschaft,
 * Rückkehr-Bericht und Spielanleitung.
 */

const SPOKES = ['home-floodplain', 'home-carr', 'home-beechwood', 'home-mountain', 'home-heath'];
const BEECH_FAUNA = ['robin', 'bluetit', 'squirrel', 'woodpecker', 'jay', 'deer', 'fox', 'owl', 'wolf', 'toad'];
const ANCIENT = STAGES.length - 1;

/** Alle sechs Wälder gegründet, aktiv `active`, mit Bestand der Nachbarn. */
function landscapeState(
  opts: { stage?: number; active?: SiteId; corridors?: string[]; fauna?: Partial<Record<SiteId, string[]>>; seed?: number; sites?: SiteId[] } = {},
): GameState {
  const state = stateAt(opts.stage ?? 4, ['earthworm', 'vole', 'chanterelle'], opts.seed ?? 7);
  const active = opts.active ?? 'home';
  state.meta.forestMemory = MAX_FOREST_MEMORY;
  state.meta.achievements.push('ancient-forest');
  const ids: SiteId[] = opts.sites ?? ['home', 'floodplain', 'carr', 'beechwood', 'mountain', 'heath'];
  const sites: LandscapeSite[] = ids.map((id) => ({
    ...createSite(id),
    memory: id === active ? 0 : MAX_FOREST_MEMORY,
    ancient: true,
    fauna: id === active ? [] : [...(opts.fauna?.[id] ?? [])],
  }));
  state.meta.landscape = { active, sites, corridors: opts.corridors ?? [], freeCorridors: [], announced: true };
  return state;
}

describe('Textbausteine', () => {
  it('jeder Korridor hat einen Weg mit Artikel, jeder Wald eine Herkunft', () => {
    for (const c of CORRIDORS) {
      const via = corridorViaText(c.id);
      expect(via).toMatch(/^(über|durch) (den|die|das) /);
      expect(via.endsWith(c.name)).toBe(true);
    }
    for (const s of LANDSCAPE_SITES) {
      expect(siteFromText(s.id)).toMatch(/^aus (dem|den|der) /);
      expect(siteInText(s.id)).toMatch(/^(im|in den|in der) /);
      expect(siteFromText(s.id).endsWith(s.name)).toBe(true);
      expect(siteInText(s.id).endsWith(s.name)).toBe(true);
    }
  });

  it('Karte: „kommt über die Schlehenhecke aus den Buchenhallen“', () => {
    expect(wildwechselCardText({ corridor: 'home-beechwood', from: 'beechwood' })).toBe(
      'kommt über die Schlehenhecke aus den Buchenhallen',
    );
    expect(wildwechselCardText({ corridor: 'home-heath', from: 'home' })).toBe('kommt über die Feldhecke aus dem Heimatwald');
    expect(wildwechselCardText({ corridor: 'mountain-floodplain', from: 'mountain' })).toBe(
      'kommt durch die Bachschlucht aus dem Bergmischwald',
    );
  });

  it('unbekannte Korridore und Wälder fallen auf den Namen zurück, ohne Artikel zu raten', () => {
    expect(corridorViaText('gibt-es-nicht')).toBe('über einen Korridor');
    expect(siteFromText('nirgendwo' as SiteId)).toBe('aus „nirgendwo“');
  });

  it('Korridor-Zusatz nur mit Bestand, Einzahl und Mehrzahl', () => {
    expect(corridorWildwechselText('beechwood', 0)).toBeNull();
    expect(corridorWildwechselText('beechwood', 1)).toBe('🦌 Wildwechsel aus den Buchenhallen (1 Art im Bestand)');
    expect(corridorWildwechselText('heath', 7)).toBe('🦌 Wildwechsel aus der Kiefernheide (7 Arten im Bestand)');
  });

  it('Rückkehr-Bericht: Zahl der Begegnungen mit Wildwechsel', () => {
    expect(wildwechselReturnText(0)).toBeNull();
    expect(wildwechselReturnText(1)).toBe('🦌 Wildwechsel: Eine Begegnung bringt ein Tier über einen Korridor aus dem Nachbarwald.');
    expect(wildwechselReturnText(3)).toBe('🦌 Wildwechsel: 3 Begegnungen bringen Tiere über Korridore aus Nachbarwäldern.');
  });
});

describe('Chance am aktiven Wald', () => {
  it('ohne Landschaft und ohne möglichen Korridor: nichts', () => {
    expect(wildwechselChanceText(stateAt(2), false)).toBeNull();
  });

  it('ohne Korridor, aber baubar: Hinweis mit 10 % je Korridor und Deckel 30 %', () => {
    expect(wildwechselChanceText(landscapeState(), true)).toBe(
      '🦌 Wildwechsel: Baue einen Korridor zu einem Nachbarwald, dann wechseln von dort Tiere zu dir – 10 % je Korridor, höchstens 30 %.',
    );
  });

  it('je Korridor am aktiven Wald 10 %, höchstens 30 %; Ort im Dativ', () => {
    expect(wildwechselChanceText(landscapeState({ corridors: ['home-beechwood'] }), false)).toBe(
      '🦌 Wildwechsel im Heimatwald: 10 % je Tierbegegnung',
    );
    expect(wildwechselChanceText(landscapeState({ corridors: ['home-beechwood', 'home-heath'] }), false)).toContain('20 %');
    expect(wildwechselChanceText(landscapeState({ corridors: SPOKES }), false)).toContain('30 %');
    // Korridore fern vom aktiven Wald zählen nicht.
    expect(wildwechselChanceText(landscapeState({ active: 'heath', corridors: ['home-beechwood', 'home-heath'] }), false)).toBe(
      '🦌 Wildwechsel in der Kiefernheide: 10 % je Tierbegegnung',
    );
  });
});

describe('Karte der Landschaft', () => {
  it('nennt die Chance und hebt gebaute Korridore mit Bestand drüben hervor', () => {
    const state = landscapeState({
      stage: ANCIENT,
      corridors: ['home-beechwood', 'home-heath', 'heath-beechwood'],
      fauna: { beechwood: BEECH_FAUNA, heath: [] },
    });
    const view = toLandscapeMapView(state, previewNewCycle(state))!;
    expect(view.wildwechsel).toBe('🦌 Wildwechsel im Heimatwald: 20 % je Tierbegegnung');
    const byId = new Map(view.corridors.map((c) => [c.id, c]));
    expect(byId.get('home-beechwood')!.wildwechsel).toBe('🦌 Wildwechsel aus den Buchenhallen (10 Arten im Bestand)');
    // Nachbar ohne Bestand: verbunden, aber kein Wildwechsel.
    expect(byId.get('home-heath')!.wildwechsel).toBeNull();
    // Gebaut, aber nicht am aktiven Wald.
    expect(byId.get('heath-beechwood')!.wildwechsel).toBeNull();
    // Nicht gebaut.
    expect(byId.get('home-carr')!.wildwechsel).toBeNull();
  });

  it('ohne Korridor am aktiven Wald: Hinweis, solange einer baubar ist', () => {
    const state = landscapeState({ stage: ANCIENT });
    const view = toLandscapeMapView(state, previewNewCycle(state))!;
    expect(view.wildwechsel).toContain('Baue einen Korridor');
    // Nur der Heimatwald gegründet: kein Korridor möglich, kein Hinweis.
    const alone = landscapeState({ stage: ANCIENT, sites: ['home'] });
    expect(toLandscapeMapView(alone, previewNewCycle(alone))!.wildwechsel).toBeNull();
  });
});

describe('Markierung offener Begegnungen', () => {
  const encounter = (cards: string[]): PendingEncounter => ({ type: 'animal', cards, rerolls: 0 });
  const card = (over: Partial<WildwechselCard> = {}): WildwechselCard => ({
    species: 'owl',
    from: 'beechwood',
    corridor: 'home-beechwood',
    encounter: 1,
    card: 2,
    ...over,
  });

  it('merkt sich die Karte am Objekt – Indizes dürfen sich danach verschieben', () => {
    const marks = createWildwechselMarks();
    const list = [encounter(['vole', 'robin']), encounter(['vole', 'robin', 'owl'])];
    expect(marks.record(list, [card()])).toBe(1);
    expect(marks.lookup(list[1])).toEqual({ species: 'owl', from: 'beechwood', corridor: 'home-beechwood', card: 2 });
    expect(marks.lookup(list[0])).toBeNull();
    // Der Spieler entscheidet über die erste Begegnung: Die zweite rückt nach vorn.
    list.shift();
    expect(marks.lookup(list[0])?.species).toBe('owl');
    expect(marks.lookup(undefined)).toBeNull();
  });

  it('passt der Bericht nicht zur Begegnung, wird nichts markiert', () => {
    const marks = createWildwechselMarks();
    const list = [encounter(['vole', 'robin', 'fox'])];
    expect(marks.record(list, [card({ encounter: 0 })])).toBe(0);
    expect(marks.record(list, [card({ encounter: 5 })])).toBe(0);
    expect(marks.record([{ type: 'plant', cards: ['a', 'b', 'owl'], rerolls: 0 }], [card({ encounter: 0 })])).toBe(0);
    expect(marks.lookup(list[0])).toBeNull();
  });

  it('neue Karten (Neu würfeln) oder eine gleich aussehende Kopie (Neuladen): keine Markierung', () => {
    const marks = createWildwechselMarks();
    const e = encounter(['vole', 'robin', 'owl']);
    marks.record([e], [card({ encounter: 0 })]);
    const copy = structuredClone(e);
    expect(marks.lookup(copy)).toBeNull();
    e.cards = ['vole', 'robin', 'owl'];
    expect(marks.lookup(e)).toBeNull();
  });

  it('echter Tick: Markierung überlebt Entscheidungen davor und (über via) das Neuladen, nicht Neu würfeln', () => {
    let checked = false;
    for (let seed = 1; seed <= 300 && !checked; seed++) {
      const state = landscapeState({
        stage: 5,
        corridors: SPOKES,
        fauna: { beechwood: BEECH_FAUNA, heath: ['bee', 'peacock', 'glowworm', 'stagbeetle'], carr: ['treefrog', 'snail', 'salamander'] },
        seed,
      });
      state.meta.forestMemory = 0;
      const report = tick(state, 3 * 3600);
      const w = report.wildwechsel.find((x) => x.encounter > 0);
      if (!w) continue;
      const first = state.pendingEncounters[0]!;
      if (first.type !== 'animal' && first.type !== 'plant') continue;
      const marks = createWildwechselMarks();
      expect(marks.record(state.pendingEncounters, report.wildwechsel)).toBe(report.wildwechsel.length);
      const target = state.pendingEncounters[w.encounter]!;
      // Die erste Begegnung ablehnen: Die Indizes verschieben sich um eins.
      expect(declineEncounter(state, 0).ok).toBe(true);
      expect(state.pendingEncounters[w.encounter - 1]).toBe(target);
      const mark = marks.lookup(state.pendingEncounters[w.encounter - 1]);
      expect(mark).toEqual({ species: w.species, from: w.from, corridor: w.corridor, card: w.card });

      // Ansicht: genau die Karte der Art bekommt den Weg.
      const view = toEncounterView(state, w.encounter - 1)!;
      applyWildwechselMark(view, mark);
      const routed = view.cards.filter((c) => c.route);
      expect(routed.map((c) => c.id)).toEqual([w.species]);
      expect(routed[0]!.route).toBe(wildwechselCardText(w));

      // Seit v15 steht dieselbe Markierung im Spielstand (`via`).
      expect(wildwechselMarkOf(state, state.pendingEncounters[w.encounter - 1])).toEqual(mark);

      // Neuladen: andere Objekte – die WeakMap kennt sie nicht, `via` schon (gleicher Hinweis).
      const loaded = loadGame(serialize(state), state.lastTick)!.state;
      expect(marks.lookup(loaded.pendingEncounters[w.encounter - 1])).toBeNull();
      expect(wildwechselMarkOf(loaded, loaded.pendingEncounters[w.encounter - 1])).toEqual(mark);

      // Neu würfeln: neue Karten – kein Hinweis mehr (via gelöscht).
      state.seeds = 1e9;
      if (rerollEncounter(state, w.encounter - 1).ok) {
        expect(marks.lookup(state.pendingEncounters[w.encounter - 1])).toBeNull();
        expect(wildwechselMarkOf(state, state.pendingEncounters[w.encounter - 1])).toBeNull();
      }
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('ohne Markierung oder bei anderen Begegnungen bleibt die Ansicht unverändert', () => {
    const state = stateAt(4, ['earthworm'], 3);
    state.pendingEncounters = [encounter(['vole', 'robin'])];
    const view = toEncounterView(state, 0)!;
    const before = JSON.stringify(view);
    applyWildwechselMark(view, null);
    applyWildwechselMark(view, { species: 'owl', from: 'beechwood', corridor: 'home-beechwood', card: 1 });
    expect(JSON.stringify(view)).toBe(before);
  });
});

describe('Rückkehr-Bericht und Spielanleitung', () => {
  const base = { seconds: 3600, growth: 100, seeds: 10, autoDeclined: 0, declinedSeeds: 0 };

  it('nennt die Zahl der Wildwechsel-Begegnungen als eigenen Punkt', () => {
    const w = { species: 'owl', from: 'beechwood' as SiteId, corridor: 'home-beechwood', encounter: 0, card: 0 };
    const view = toReturnReportView({ away: 3600, report: { ...base, wildwechsel: [w, { ...w, encounter: 1 }] }, waiting: 2 });
    expect(view.details).toContain('🦌 Wildwechsel: 2 Begegnungen bringen Tiere über Korridore aus Nachbarwäldern.');
    expect(view.more).toBe(true);
    const none = toReturnReportView({ away: 3600, report: { ...base, wildwechsel: [] }, waiting: 0 });
    expect(none.details.join(' ')).not.toContain('Wildwechsel');
  });

  it('Abschnitt „Waldlandschaft“ erklärt den Wildwechsel erst nach der Freischaltung', () => {
    const text = (unlocked: boolean) =>
      guideSections({ landscape: unlocked })
        .find((s) => s.id === 'landscape')!
        .paragraphs.join(' ');
    expect(text(true)).toContain('🦌 Wildwechsel');
    expect(text(true)).toContain('10 % Chance (zusammen höchstens 30 %)');
    expect(text(true)).toContain(CORRIDORS_BY_ID.get('home-beechwood')!.name);
    expect(text(false)).not.toContain('Wildwechsel');
  });
});
