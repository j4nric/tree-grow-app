import { describe, expect, it } from 'vitest';
import {
  CORRIDORS_BY_ID,
  FEATURED_GENUS_WEIGHT,
  HOME_SITE,
  LANDSCAPE_SITES_BY_ID,
  WILDWECHSEL_CHANCE,
  WILDWECHSEL_MAX_CHANCE,
  type SiteId,
} from '../src/content/landscape';
import { DAILY_RARE_MIN_RARITY } from '../src/content/daily';
import { SPECIES_BY_ID } from '../src/content/species';
import { evaluate, nicheSlots, slotBonuses } from '../src/core/formulas';
import { featuredGenera, wildwechselChance, wildwechselRoute, wildwechselRoutes } from '../src/core/landscape';
import { normalizeSeed } from '../src/core/rng';
import { loadGame, serialize } from '../src/core/save';
import { MAX_FOREST_MEMORY, createSite, type GameState, type LandscapeSite } from '../src/core/state';
import {
  drawAnimals,
  drawCards,
  drawEncounter,
  drawWildwechsel,
  rerollBlocker,
  rerollEncounter,
  simulateOffline,
  startNewCycle,
  tick,
  type TickReport,
} from '../src/core/tick';
import { stateAt } from './helpers';

/**
 * Wildwechsel (DESIGN_V2.md 24.6, Schritt B): Karten aus dem Bestand (`fauna`) der Nachbarn
 * über gebaute Korridore und das Gewicht der Gattungen eines Waldtyps (`featured`).
 */

const SPOKES = ['home-floodplain', 'home-carr', 'home-beechwood', 'home-mountain', 'home-heath'];

/** Bestand der Buchenhallen: lauter Arten, die im Heimatwald (Alter Baum) passen könnten. */
const BEECH_FAUNA = ['robin', 'bluetit', 'squirrel', 'woodpecker', 'jay', 'deer', 'fox', 'owl', 'wolf', 'toad'];

/** Alle sechs Wälder gegründet (voll, Urwald – bezahlt jeden Korridor), aktiv `active`. */
function landscapeState(
  opts: {
    stage?: number;
    active?: SiteId;
    corridors?: string[];
    fauna?: Partial<Record<SiteId, string[]>>;
    animals?: string[];
    seed?: number;
    /** Gegründete Wälder (Standard: alle sechs). */
    sites?: SiteId[];
  } = {},
): GameState {
  const state = stateAt(opts.stage ?? 4, opts.animals ?? ['earthworm', 'vole', 'chanterelle'], opts.seed ?? 7);
  const active = opts.active ?? HOME_SITE;
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

/** Anteil der Ziehungen mit Wildwechsel-Karte über `n` Startwerte. */
function wildwechselRate(state: GameState, n: number): number {
  let hits = 0;
  for (let i = 1; i <= n; i++) {
    state.rngState = normalizeSeed(i);
    if (drawWildwechsel(state, ['earthworm', 'vole', 'chanterelle'])) hits++;
  }
  return hits / n;
}

describe('Chance je Korridor (24.6)', () => {
  it('0 ohne Korridor, WILDWECHSEL_CHANCE je Korridor am aktiven Wald, höchstens WILDWECHSEL_MAX_CHANCE', () => {
    expect(WILDWECHSEL_CHANCE).toBe(0.1);
    expect(WILDWECHSEL_MAX_CHANCE).toBe(0.3);
    expect(wildwechselChance(stateAt(4))).toBe(0);
    expect(wildwechselChance(landscapeState())).toBe(0);
    expect(wildwechselChance(landscapeState({ corridors: ['home-beechwood'] }))).toBeCloseTo(0.1, 12);
    expect(wildwechselChance(landscapeState({ corridors: ['home-beechwood', 'home-heath'] }))).toBeCloseTo(0.2, 12);
    expect(wildwechselChance(landscapeState({ corridors: SPOKES.slice(0, 3) }))).toBe(0.3);
    expect(wildwechselChance(landscapeState({ corridors: SPOKES }))).toBe(0.3);
    // Korridore, die den aktiven Wald nicht berühren, zählen nicht.
    expect(wildwechselChance(landscapeState({ corridors: ['floodplain-carr', 'heath-beechwood'] }))).toBe(0);
    expect(wildwechselChance(landscapeState({ active: 'carr', corridors: ['floodplain-carr', 'carr-heath', 'home-beechwood'] }))).toBeCloseTo(0.2, 12);
    // Unbekannte oder doppelte IDs (nur in kaputten Ständen zur Laufzeit) zählen nicht bzw. einmal.
    expect(wildwechselChance(landscapeState({ corridors: ['home-beechwood', 'home-beechwood', 'nope'] }))).toBeCloseTo(0.1, 12);
  });

  it('die gemessene Häufigkeit entspricht der Chance (1, 2 Korridore, gedeckelt bei 5)', () => {
    const fauna = { beechwood: BEECH_FAUNA, heath: BEECH_FAUNA, floodplain: BEECH_FAUNA, carr: BEECH_FAUNA, mountain: BEECH_FAUNA };
    const n = 20_000;
    for (const [corridors, chance] of [
      [['home-beechwood'], 0.1],
      [['home-beechwood', 'home-heath'], 0.2],
      [SPOKES, 0.3],
    ] as const) {
      const state = landscapeState({ corridors: [...corridors], fauna });
      expect(wildwechselRate(state, n)).toBeCloseTo(chance, 1);
      expect(Math.abs(wildwechselRate(state, n) - chance)).toBeLessThan(0.01);
    }
  });
});

describe('Kein Wildwechsel ohne Korridor', () => {
  it('ohne gebauten Korridor: kein Wurf (Zufall unverändert), keine Karte – auch mit vollem Bestand der Nachbarn', () => {
    const state = landscapeState({ fauna: { beechwood: BEECH_FAUNA } });
    for (let i = 1; i <= 200; i++) {
      state.rngState = normalizeSeed(i);
      const cards = ['earthworm', 'vole', 'chanterelle'];
      expect(drawWildwechsel(state, cards)).toBeNull();
      expect(state.rngState).toBe(normalizeSeed(i));
      expect(cards).toEqual(['earthworm', 'vole', 'chanterelle']);
    }
    expect(wildwechselRoutes(state)).toEqual([]);
    expect(wildwechselRoute(state, 'owl')).toBeNull();
  });

  it('ohne Korridor ziehen Begegnungen genau wie vor Schritt B (gleicher Zufall wie ohne Landschaft)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const plain = stateAt(4, ['earthworm'], seed);
      plain.waypoint = 14;
      const withLandscape = landscapeState({ sites: ['home', 'beechwood'], fauna: { beechwood: BEECH_FAUNA }, animals: ['earthworm'], seed });
      withLandscape.waypoint = 14;
      withLandscape.meta.forestMemory = plain.meta.forestMemory;
      expect(drawEncounter(withLandscape)).toEqual(drawEncounter(plain));
      expect(withLandscape.rngState).toBe(plain.rngState);
    }
  });

  it('ein Korridor, der den aktiven Wald nicht berührt, bringt nichts', () => {
    const state = landscapeState({ corridors: ['heath-beechwood'], fauna: { beechwood: BEECH_FAUNA, heath: BEECH_FAUNA } });
    expect(wildwechselRate(state, 500)).toBe(0);
  });

  it('Korridor, aber leerer Bestand des Nachbarn: gewürfelt wird, eine Karte gibt es nicht', () => {
    const state = landscapeState({ corridors: ['home-beechwood'] });
    expect(wildwechselRate(state, 500)).toBe(0);
  });
});

describe('Regeln der Wildwechsel-Karte (24.6)', () => {
  /** Alle Wildwechsel-Arten über viele Startwerte (immer mit Treffer: 3 Korridore = 30 %). */
  function drawnSpecies(state: GameState, n = 3000, cards = ['earthworm', 'vole', 'chanterelle']): Set<string> {
    const out = new Set<string>();
    for (let i = 1; i <= n; i++) {
      state.rngState = normalizeSeed(i);
      const copy = [...cards];
      const w = drawWildwechsel(state, copy);
      if (!w) continue;
      out.add(w.species);
      // Genau eine Karte ersetzt, an der gemeldeten Stelle; keine Doppel.
      expect(copy[w.card]).toBe(w.species);
      expect(copy.filter((_, k) => k !== w.card)).toEqual(cards.filter((_, k) => k !== w.card));
      expect(new Set(copy).size).toBe(copy.length);
    }
    return out;
  }

  it('Freischalt-Stufe und offene Nische ja, Erscheinungsbedingung nein; nichts, was schon lebt', () => {
    const state = landscapeState({
      // Ohne Auwald (seine Gabe gäbe überall einen Tümpel-Platz) und ohne Kleinsäuger.
      sites: ['home', 'beechwood', 'heath', 'carr'],
      corridors: ['home-beechwood', 'home-heath', 'home-carr'],
      fauna: { beechwood: BEECH_FAUNA },
      animals: ['earthworm', 'chanterelle', 'robin'],
    });
    const slots = nicheSlots(state.stage, state.niches, slotBonuses(state));
    // Vorbedingungen: Waldkauz hat Höhlen-Platz, aber seine Erscheinungsbedingung (Kleinsäuger)
    // fehlt; Wolf erst ab Stufe 6; Erdkröte ohne Tümpel-Platz im Heimatwald.
    expect(slots.hollows).toBeGreaterThan(0);
    for (let i = 1; i <= 300; i++) {
      state.rngState = normalizeSeed(i);
      expect(drawCards(state, 'animal')).not.toContain('owl');
    }
    expect(SPECIES_BY_ID.get('wolf')!.unlock).toBeGreaterThan(state.stage);
    expect(slots.pond).toBe(0);
    const drawn = drawnSpecies(state);
    expect(drawn.has('owl')).toBe(true);
    expect(drawn.has('wolf')).toBe(false);
    expect(drawn.has('toad')).toBe(false);
    expect(drawn.has('robin')).toBe(false); // lebt schon hier
    for (const id of drawn) expect(BEECH_FAUNA).toContain(id);
  });

  it('nie eine Art, die schon auf einer anderen Karte liegt', () => {
    const state = landscapeState({ corridors: SPOKES, fauna: { beechwood: ['owl', 'deer'] } });
    const drawn = drawnSpecies(state, 2000, ['owl', 'vole', 'chanterelle']);
    expect([...drawn]).toEqual(['deer']);
  });

  it('ohne Karten keine Wildwechsel-Karte (sie ersetzt nur) und kein Wurf', () => {
    const state = landscapeState({ corridors: SPOKES, fauna: { beechwood: BEECH_FAUNA } });
    const before = state.rngState;
    expect(drawWildwechsel(state, [])).toBeNull();
    expect(state.rngState).toBe(before);
  });

  it('Weg: erster gebauter Korridor, dessen Nachbar die Art im Bestand hat; je Art einmal', () => {
    const state = landscapeState({
      corridors: ['home-heath', 'home-beechwood'],
      fauna: { beechwood: ['owl', 'deer'], heath: ['deer', 'bee'], mountain: ['wolf'] },
    });
    expect(wildwechselRoutes(state)).toEqual([
      { species: 'deer', from: 'heath', corridor: 'home-heath' },
      { species: 'bee', from: 'heath', corridor: 'home-heath' },
      { species: 'owl', from: 'beechwood', corridor: 'home-beechwood' },
    ]);
    expect(wildwechselRoute(state, 'owl')).toEqual({ species: 'owl', from: 'beechwood', corridor: 'home-beechwood' });
    expect(wildwechselRoute(state, 'wolf')).toBeNull(); // Bergmischwald ohne Korridor
    expect(CORRIDORS_BY_ID.get(wildwechselRoute(state, 'owl')!.corridor)!.name).toBe('Schlehenhecke');
  });

  it('neu würfeln bringt keine Wildwechsel-Karte (nur am Wegpunkt)', () => {
    // Nur der Waldkauz käme über den Korridor; normal kann er nicht erscheinen (keine Kleinsäuger).
    const state = landscapeState({
      sites: ['home', 'beechwood', 'heath', 'carr'],
      corridors: ['home-beechwood', 'home-heath', 'home-carr'],
      fauna: { beechwood: ['owl'] },
      animals: ['earthworm'],
    });
    state.seeds = 1e12;
    state.pendingEncounters = [{ type: 'animal', cards: ['vole', 'chanterelle', 'robin'], rerolls: 0 }];
    for (let i = 0; i < 40; i++) {
      state.pendingEncounters[0]!.rerolls = 0;
      expect(rerollEncounter(state, 0)).toEqual({ ok: true });
      expect(state.pendingEncounters[0]!.cards).not.toContain('owl');
    }
  });
});

describe('Determinismus und online = offline', () => {
  it('gleicher Stand → gleiche Begegnung und gleicher Zufall', () => {
    const a = landscapeState({ corridors: SPOKES, fauna: { beechwood: BEECH_FAUNA }, seed: 5 });
    a.waypoint = 14;
    const b = structuredClone(a);
    for (let i = 0; i < 30; i++) {
      expect(drawEncounter(a)).toEqual(drawEncounter(b));
      expect(a.rngState).toBe(b.rngState);
    }
  });

  /** Sammelt die Wildwechsel-Karten vieler kleiner Ticks. */
  function smallTicks(state: GameState, seconds: number, mode: 'live' | 'average'): TickReport['wildwechsel'] {
    const out: TickReport['wildwechsel'] = [];
    for (let i = 0; i < seconds; i++) out.push(...tick(state, 1, mode).wildwechsel);
    return out;
  }

  it('kleine Ticks = großer Tick (live) und = simulateOffline (Mittel), mit Wildwechsel im Bericht', { timeout: 60_000 }, () => {
    // Einen Startwert suchen, bei dem in der ersten Stunde ein Wildwechsel kommt (deterministisch).
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const start = landscapeState({ corridors: SPOKES, fauna: { beechwood: BEECH_FAUNA, heath: ['bee', 'peacock', 'glowworm'] }, seed });
      start.meta.forestMemory = 200; // langsamer – mehrere Wegpunkte in einer Stunde, nicht alle in der ersten Minute
      const seconds = 3600;
      const small = structuredClone(start);
      const big = structuredClone(start);
      const smallAvg = structuredClone(start);
      const offline = structuredClone(start);
      const liveSmall = smallTicks(small, seconds, 'live');
      const liveBig = tick(big, seconds).wildwechsel;
      const avgSmall = smallTicks(smallAvg, seconds, 'average');
      const report = simulateOffline(offline, seconds);
      for (const [x, y] of [[small, big], [smallAvg, offline]] as const) {
        expect(y.waypoint).toBe(x.waypoint);
        expect(y.pendingEncounters).toEqual(x.pendingEncounters);
        expect(y.rngState).toBe(x.rngState);
        expect(y.niches).toEqual(x.niches);
      }
      expect(liveBig).toEqual(liveSmall);
      expect(report.wildwechsel).toEqual(avgSmall);
      if (liveSmall.length === 0) continue;
      found = true;
      // Die gemeldete Karte liegt wirklich in einer offenen Begegnung, der Weg stimmt.
      for (const w of liveSmall) {
        expect(small.pendingEncounters[w.encounter]!.type).toBe('animal');
        expect(small.pendingEncounters[w.encounter]!.cards[w.card]).toBe(w.species);
        expect(wildwechselRoute(small, w.species)).toEqual({ species: w.species, from: w.from, corridor: w.corridor });
      }
    }
    expect(found).toBe(true);
  });
});

describe('Index der Begegnung im Bericht', () => {
  it('großer Tick mit mehreren Begegnungen und Zwischenhalten: pendingEncounters[encounter].cards[card] ist die Art', () => {
    // Hain: Zwischenhalte legen Ereignisse und Gäste dazwischen, die Indizes verschieben sich.
    let checked = 0;
    for (let seed = 1; seed <= 300 && checked < 3; seed++) {
      const state = landscapeState({
        stage: 5,
        corridors: SPOKES,
        fauna: { beechwood: BEECH_FAUNA, heath: ['bee', 'peacock', 'glowworm', 'stagbeetle'], carr: ['treefrog', 'snail', 'salamander'] },
        seed,
      });
      state.meta.forestMemory = 0;
      const report = tick(state, 3 * 3600);
      if (report.wildwechsel.length === 0 || report.interludes === 0 || state.pendingEncounters.length < 2) continue;
      for (const w of report.wildwechsel) {
        expect(state.pendingEncounters[w.encounter]!.type).toBe('animal');
        expect(state.pendingEncounters[w.encounter]!.cards[w.card]).toBe(w.species);
      }
      // Indizes je Begegnung verschieden, aufsteigend (Reihenfolge der Wegpunkte).
      const indices = report.wildwechsel.map((w) => w.encounter);
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      expect(new Set(indices).size).toBe(indices.length);
      if (report.wildwechsel.some((w) => w.encounter > 0)) checked++;
    }
    expect(checked).toBe(3);
  });
});

describe('Gattungen des Waldtyps (featured, × FEATURED_GENUS_WEIGHT)', () => {
  /** Verhältnis der ersten Karte: Rotkehlchen (Vogel) zu Regenwurm (Bodenleben), beide Seltenheit 0. */
  function robinToEarthworm(active: SiteId, n = 30_000): number {
    const state = landscapeState({ active, animals: ['vole'] });
    let robin = 0;
    let earthworm = 0;
    for (let i = 1; i <= n; i++) {
      state.rngState = normalizeSeed(i);
      const first = drawAnimals(state)[0];
      if (first === 'robin') robin++;
      if (first === 'earthworm') earthworm++;
    }
    return robin / earthworm;
  }

  it('Auwald (Vögel, Amphibien): Vögel × 1,5 in ihrer Seltenheit; Heimatwald ohne Gewicht', () => {
    expect(FEATURED_GENUS_WEIGHT).toBe(1.5);
    expect(LANDSCAPE_SITES_BY_ID.get('floodplain')!.featured).toContain('birds');
    expect(featuredGenera(landscapeState({ active: 'floodplain' }))).toEqual(['amphibians', 'birds']);
    expect(featuredGenera(stateAt(0))).toEqual([]);
    expect(Math.abs(robinToEarthworm('floodplain') - 1.5)).toBeLessThan(0.12);
    expect(Math.abs(robinToEarthworm('home') - 1)).toBeLessThan(0.1);
  });

  it('im Heimatwald zieht drawAnimals wie vor Schritt B (gleicher Zufall wie ohne Landschaft)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const plain = stateAt(4, ['vole'], seed);
      const home = landscapeState({ sites: ['home', 'beechwood'], animals: ['vole'], seed });
      home.meta.forestMemory = plain.meta.forestMemory;
      expect(drawAnimals(home)).toEqual(drawAnimals(plain));
      expect(home.rngState).toBe(plain.rngState);
    }
  });

  it('auch ab dem zweiten Zyklus (Tagebuch-Gewicht, featured = []) wie vor Schritt B', () => {
    const journal = ['robin', 'bluetit', 'owl', 'woodpecker', 'deer', 'bee', 'slug'];
    for (let seed = 1; seed <= 50; seed++) {
      const plain = stateAt(4, ['vole'], seed);
      const home = landscapeState({ sites: ['home', 'beechwood'], animals: ['vole'], seed });
      home.meta.forestMemory = plain.meta.forestMemory;
      for (const s of [plain, home]) {
        s.cycle.number = 3;
        s.meta.journal.species.push(...journal);
      }
      expect(featuredGenera(home)).toEqual([]);
      expect(drawAnimals(home)).toEqual(drawAnimals(plain));
      expect(home.rngState).toBe(plain.rngState);
    }
  });

  it('Belohnung der Tagesziele: minRarity gilt auch mit featured', () => {
    const state = landscapeState({ active: 'floodplain', animals: ['vole'] });
    state.cycle.number = 2;
    state.meta.journal.species.push('robin', 'toad', 'newt');
    let drawn = 0;
    for (let i = 1; i <= 500; i++) {
      state.rngState = normalizeSeed(i);
      for (const id of drawAnimals(state, [], state, DAILY_RARE_MIN_RARITY)) {
        expect(SPECIES_BY_ID.get(id)!.rarity).toBeGreaterThanOrEqual(DAILY_RARE_MIN_RARITY);
        drawn++;
      }
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it('Auwald: rerollBlocker sieht dieselben Karten voraus, die rerollEncounter zieht', () => {
    const state = landscapeState({ active: 'floodplain', corridors: SPOKES, fauna: { home: BEECH_FAUNA }, animals: ['vole'] });
    state.seeds = 1e12;
    state.pendingEncounters = [{ type: 'animal', cards: ['robin', 'toad', 'earthworm'], rerolls: 0 }];
    for (let i = 0; i < 30; i++) {
      state.pendingEncounters[0]!.rerolls = 0;
      expect(rerollBlocker(state, 0)).toBeNull();
      const expected = drawCards(state, 'animal', state.pendingEncounters[0]!.cards, { rngState: state.rngState });
      expect(rerollEncounter(state, 0)).toEqual({ ok: true });
      expect(state.pendingEncounters[0]!.cards).toEqual(expected);
    }
  });
});

describe('Spielstände', () => {
  it('v13 ohne Landschaft lädt und zieht wie bisher: kein Wildwechsel', () => {
    const state = stateAt(4, ['earthworm'], 9);
    const data = JSON.parse(serialize(state));
    data.version = 13;
    delete data.meta.landscape;
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(wildwechselChance(loaded)).toBe(0);
    expect(wildwechselRoutes(loaded)).toEqual([]);
    loaded.waypoint = 14;
    const reference = structuredClone(loaded);
    expect(drawEncounter(loaded)).toEqual(drawEncounter(reference));
    const report = tick(loaded, 3600);
    expect(report.wildwechsel).toEqual([]);
  });

  it('v14 mit kaputtem oder fehlendem Bestand lädt; nur bekannte Arten wandern', () => {
    const state = landscapeState({ corridors: ['home-beechwood', 'home-heath'] });
    state.meta.journal.species.push('owl', 'deer');
    const data = JSON.parse(serialize(state));
    const beech = data.meta.landscape.sites.find((s: { id: string }) => s.id === 'beechwood');
    beech.fauna = [42, 'unknown-animal', 'owl', 'owl', null, { id: 'deer' }];
    const heath = data.meta.landscape.sites.find((s: { id: string }) => s.id === 'heath');
    delete heath.fauna;
    const loaded = loadGame(JSON.stringify(data), 0)!.state;
    expect(loaded.version).toBe(state.version);
    expect(wildwechselRoutes(loaded)).toEqual([{ species: 'owl', from: 'beechwood', corridor: 'home-beechwood' }]);
    expect(wildwechselRate(loaded, 2000)).toBeGreaterThan(0.15);
  });

  it('Laden: Bestand ruhender Wälder nur aus entdeckten Arten (wie die Stammgäste)', () => {
    const state = landscapeState({ corridors: ['home-beechwood'], fauna: { beechwood: ['owl', 'deer', 'wolf'] } });
    state.meta.journal.species.push('owl', 'wolf');
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(loaded.meta.landscape.sites.find((s) => s.id === 'beechwood')!.fauna).toEqual(['owl', 'wolf']);
    expect(wildwechselRoutes(loaded).map((r) => r.species)).toEqual(['owl', 'wolf']);
  });

  it('kein neues Feld: Wildwechsel ändert am Format nichts (Roundtrip gleich)', () => {
    const state = landscapeState({ corridors: SPOKES, fauna: { beechwood: BEECH_FAUNA } });
    tick(state, 1800);
    const loaded = loadGame(serialize(state), 0)!.state;
    expect(Object.keys(loaded.pendingEncounters[0] ?? {}).sort()).toEqual(['cards', 'rerolls', 'type']);
    expect(loaded.pendingEncounters).toEqual(state.pendingEncounters);
  });

  it('fauna wird beim Verlassen geschrieben und kommt im neuen Wald über den Gratis-Korridor', () => {
    const state = landscapeState({ stage: 7, corridors: [] });
    // Nur Heimatwald und Auwald: den Rest der Landschaft entfernen.
    state.meta.landscape.sites = state.meta.landscape.sites.filter((s) => s.id === 'home');
    state.niches.hollows.push('owl');
    state.meta.journal.species.push('owl');
    const result = startNewCycle(state, 0, undefined, 'floodplain');
    expect(result.ok).toBe(true);
    expect(state.meta.landscape.corridors).toEqual(['home-floodplain']);
    expect(state.meta.landscape.sites.find((s) => s.id === 'home')!.fauna).toContain('owl');
    expect(wildwechselRoute(state, 'owl')).toEqual({ species: 'owl', from: 'home', corridor: 'home-floodplain' });
    expect(wildwechselChance(state)).toBeCloseTo(0.1, 12);
  });
});

describe('Grenzfälle', () => {
  it('NaN-Gedächtnis und Unsinn im Spielstand zur Laufzeit: kein Absturz', () => {
    const state = landscapeState({ corridors: ['home-beechwood', 'nope', 'home-beechwood'], fauna: { beechwood: ['unknown', 'owl'] } });
    state.meta.forestMemory = Number.NaN;
    expect(wildwechselChance(state)).toBeCloseTo(0.1, 12);
    let hit = false;
    for (let i = 1; i <= 300; i++) {
      state.rngState = normalizeSeed(i);
      const w = drawWildwechsel(state, ['earthworm']);
      if (w) {
        hit = true;
        expect(w).toEqual({ species: 'owl', from: 'beechwood', corridor: 'home-beechwood', card: 0 });
      }
    }
    expect(hit).toBe(true);
  });

  it('aktiver Wald nicht gegründet (kaputter Stand): es gilt der Heimatwald', () => {
    const state = landscapeState({ corridors: ['home-beechwood'], fauna: { beechwood: ['owl'] } });
    state.meta.landscape.active = 'mountain';
    state.meta.landscape.sites = state.meta.landscape.sites.filter((s) => s.id !== 'mountain');
    expect(wildwechselRoutes(state)).toEqual([{ species: 'owl', from: 'beechwood', corridor: 'home-beechwood' }]);
    expect(evaluate(state).growth).toBeGreaterThan(0);
  });
});
