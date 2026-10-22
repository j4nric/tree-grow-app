import { describe, expect, it } from 'vitest';
import { EVENTS_BY_ID } from '../src/content/events';
import {
  OVERHUNT_MAX_UNITS,
  OVERHUNT_PENALTY,
  PREDATION_EVENTS,
  STOCK_BASE,
  STOCK_RANGE,
  WEATHER_EVENT_FACTORS,
} from '../src/content/predation';
import { SEASON_SECONDS } from '../src/content/seasons';
import { SPECIES, SPECIES_BY_ID, TAG_NAMES } from '../src/content/species';
import { NICHE_IDS, type NicheId, type Tag } from '../src/content/types';
import { GENTLE_DAYS } from '../src/content/weather';
import {
  appearsContext,
  evaluate,
  evaluateEcosystem,
  overhuntUnits,
  speciesAppears,
  stockFor,
  unhuntedTags,
  type Ecosystem,
  type Evaluation,
} from '../src/core/formulas';
import { random, randomInt, type RngHolder } from '../src/core/rng';
import { seasonIdAt } from '../src/core/season';
import { deserialize, serialize } from '../src/core/save';
import type { GameState } from '../src/core/state';
import {
  chooseEventOption,
  declineEncounter,
  eligibleEvents,
  eventWeight,
  farewellVisitor,
  pickEvent,
  simulateOffline,
  tick,
} from '../src/core/tick';
import { dayIndex, weatherOfDay } from '../src/core/weather';
import { fakeSpecies, stateAt, withFakeSpecies } from './helpers';
import reference from './predation-main-reference.json';
import { referenceCases, referenceEcosystem, type ReferenceCase, type ReferenceValue } from './predation-reference';

/**
 * Räuber und Beute (DESIGN_V2.md 22, Schritt A und C): Bestand, Überjagung statt
 * Räuberdruck, Bedingung „ungejagt“, Massenjahre, Nahrungsnetz und Wetter-Gewichte.
 */

/** Ökosystem einer Stufe mit diesen Tieren in ihren Nischen (ohne Jahreszeit und Wetter). */
function eco(stage: number, animals: readonly string[], plants: readonly string[] = []): Ecosystem {
  const niches = Object.fromEntries(NICHE_IDS.map((n) => [n, [] as string[]])) as Record<NicheId, string[]>;
  for (const id of animals) niches[SPECIES_BY_ID.get(id)!.niche].push(id);
  return { stage, niches, plants, forestMemory: 0 };
}

/** Zufriedenheit einer Art, wenn sie allein mit `others` lebt, die sie nicht jagen. */
const alone = (stage: number, id: string, others: readonly string[] = []) =>
  evaluateEcosystem(eco(stage, [id, ...others])).animals[id]!.happiness;

/** Bisheriger Räuberdruck (bis main 9dde233): 0,10 je Jäger, höchstens 2 Jäger. */
const oldPenalty = (hunters: number) => 0.1 * Math.min(2, hunters);

describe('Bestand und Überjagung: Formeln (22.3, 22.4)', () => {
  it('Bestand: z⁰ 0 → 0,5, z⁰ 1 → 1,5; Unsinn bleibt in den Grenzen', () => {
    expect(stockFor(0)).toBe(STOCK_BASE);
    expect(stockFor(1)).toBe(STOCK_BASE + STOCK_RANGE);
    expect(stockFor(0.4)).toBeCloseTo(0.9);
    for (const z of [NaN, -1, -Infinity]) expect(stockFor(z)).toBe(0.5);
    for (const z of [2, 1e300, Infinity]) expect(stockFor(z)).toBe(1.5);
  });

  it('Überjagung: Jäger − Bestand, 0 ohne Jäger, höchstens 2 Einheiten', () => {
    expect(overhuntUnits(0, 0)).toBe(0);
    expect(overhuntUnits(0, 1.5)).toBe(0);
    expect(overhuntUnits(1, 1.5)).toBe(0);
    expect(overhuntUnits(2, 1.5)).toBeCloseTo(0.5);
    expect(overhuntUnits(3, 0.9)).toBe(OVERHUNT_MAX_UNITS); // 2,1 gedeckelt
    expect(overhuntUnits(1e9, 0.5)).toBe(OVERHUNT_MAX_UNITS);
    expect(overhuntUnits(NaN, 1)).toBe(0);
    expect(overhuntUnits(2, NaN)).toBe(2);
    expect(overhuntUnits(2, Infinity)).toBe(2); // unendlicher Bestand ist Unsinn → wie 0
    expect(OVERHUNT_PENALTY * OVERHUNT_MAX_UNITS).toBeCloseTo(oldPenalty(Infinity));
  });
});

describe('Bestand und Überjagung im Ökosystem (Beispiele aus 22.4)', () => {
  it('Wühlmaus allein: voller Bestand 1,5, ungejagt', () => {
    const ev = evaluateEcosystem(eco(4, ['vole']));
    expect(ev.animals.vole).toMatchObject({ happiness: 1, stock: 1.5, overhunt: 0, hunters: 0 });
    expect(ev.foodWeb).toEqual([{ tag: 'kleinsaeuger', prey: ['vole'], hunters: [], controllers: [], stock: 1.5, supply: 1.5, state: 'unhunted' }]);
  });

  it('Wühlmaus + Waldkauz: Kauz satt (100 %), Wühlmaus verliert nichts (früher −10 %)', () => {
    const ev = evaluateEcosystem(eco(4, ['vole', 'owl']));
    expect(ev.animals.owl!.food).toBe(1);
    expect(ev.animals.vole).toMatchObject({ happiness: 1, stock: 1.5, overhunt: 0, hunters: 1 });
    expect(ev.animals.owl!.stock).toBeUndefined(); // stellt nichts bereit: keine Beute
    expect(ev.foodWeb[0]).toMatchObject({ tag: 'kleinsaeuger', hunters: ['owl'], state: 'balanced' });
  });

  it('Wühlmaus + Waldkauz + Rotfuchs: je 75 % Futter (1,5 / 2), Wühlmaus −5 % (früher je 50 % / −20 %)', () => {
    const ev = evaluateEcosystem(eco(4, ['vole', 'owl', 'fox']));
    expect(ev.animals.owl!.food).toBeCloseTo(0.75);
    expect(ev.animals.fox!.food).toBeCloseTo(0.75);
    expect(ev.animals.vole!.overhunt).toBeCloseTo(0.5);
    expect(ev.animals.vole!.happiness).toBeCloseTo(alone(4, 'vole') - 0.05);
    expect(ev.foodWeb[0]).toMatchObject({ tag: 'kleinsaeuger', prey: ['vole'], hunters: ['fox', 'owl'], stock: 1.5, state: 'overhunted' });
  });

  it('viele Jäger: höchstens −20 % (OVERHUNT_MAX_UNITS), auch bei kümmerlichem Bestand', () => {
    const hunters = ['h1', 'h2', 'h3', 'h4', 'h5'].map((id) =>
      fakeSpecies({ id, niche: 'edge', level: 'predator', food: ['kleinsaeuger'], unlock: 1 }),
    );
    withFakeSpecies(hunters, () => {
      const ev = evaluateEcosystem({ ...eco(4, ['vole']), niches: { ...eco(4, ['vole']).niches, edge: hunters.map((h) => h.id) } });
      expect(ev.animals.vole!.overhunt).toBe(OVERHUNT_MAX_UNITS);
      expect(ev.animals.vole!.happiness).toBeCloseTo(Math.max(0, alone(4, 'vole') - 0.2));
      // `hunters` (Anzeige) zählt nur Arten des Katalogs; die Überjagung zählt jedes lebende Tier.
      // Jäger teilen sich den Bestand: 1,5 für 5 → je 30 %.
      for (const h of hunters) expect(ev.animals[h.id]!.food).toBeCloseTo(0.3);
    });
  });

  it('Regenwurm mit Rotkehlchen und Maulwurf: Jäger werden vom Bestand satt, nicht von einer festen Einheit', () => {
    const ev = evaluateEcosystem(eco(4, ['earthworm', 'robin', 'mole']));
    const worm = ev.animals.earthworm!;
    expect(worm.stock).toBeCloseTo(stockFor(alone(4, 'earthworm', ['mole'])));
    // Futter der Würmer-Jäger = Bestand / Nachfrage (Rotkehlchen frisst auch Insekten – keine da).
    expect(ev.animals.robin!.food).toBeCloseTo(Math.min(1, Math.max(1, worm.stock!) / 2));
    expect(worm.overhunt).toBeCloseTo(overhuntUnits(2, Math.max(1, worm.stock!)));
    // Nur die Jäger des überjagten Merkmals werden genannt.
    expect(worm.overhuntedBy).toEqual(['mole', 'robin']);
  });

  it('kümmerlicher Bestand senkt das Futter nicht (Variante b: max(1, Bestand))', () => {
    const ev = evaluateEcosystem(eco(4, ['slug', 'hedgehog', 'toad']));
    const slug = ev.animals.slug!;
    expect(slug.stock!).toBeLessThan(1);
    // Schnecken: 1 Einheit für 2 Jäger (Igel, Erdkröte) – wie vor Welle 3, nicht 0,75 / 2.
    expect(ev.foodWeb.find((f) => f.tag === 'schnecken')).toMatchObject({ stock: slug.stock, supply: 1, state: 'overhunted' });
    expect(slug.overhunt).toBeCloseTo(1);
    expect(slug.overhuntedBy).toEqual(['hedgehog', 'toad']);
    expect(evaluateEcosystem(eco(4, ['slug', 'hedgehog'])).animals.hedgehog!.food).toBe(1);
  });

  it('Pflanzen und Ereignis-Merkmale bleiben bei 1 Einheit: Totholz aus der Sturmnacht', () => {
    const base = eco(4, ['woodpecker']);
    // Specht frisst Käfer/Insekten/Nüsse: Nüsse aus dem Hauptbaum (2 Einheiten), unverändert.
    const ev = evaluateEcosystem({ ...base, habitats: ['totholz'] });
    expect(ev.animals.woodpecker!.food).toBe(1);
    // Borkenkäfer stellt Totholz mit Bestand bereit; der Hirschkäfer frisst es – mit Habitat 1 + Bestand.
    const beetles = evaluateEcosystem({ ...eco(5, ['barkbeetle', 'stagbeetle']), habitats: [] });
    const stock = beetles.animals.barkbeetle!.stock!;
    expect(beetles.animals.stagbeetle!.food).toBeCloseTo(Math.min(1, stock));
  });

  it('Bestand nur für Tiere, die etwas bereitstellen; z⁰ hängt nicht an Jägern', () => {
    const ev = evaluateEcosystem(eco(5, ['vole', 'owl', 'fox', 'oakmoth', 'bluetit', 'squirrel', 'chanterelle']));
    for (const [id, st] of Object.entries(ev.animals)) {
      const sp = SPECIES_BY_ID.get(id)!;
      if (sp.provides.length > 0) expect(st.stock, id).toBeDefined();
      else expect(st.stock, id).toBeUndefined();
    }
    // Der Bestand der Wühlmaus ist derselbe mit und ohne Jäger (kein Kreis).
    expect(ev.animals.vole!.stock).toBe(evaluateEcosystem(eco(5, ['vole', 'oakmoth', 'squirrel', 'chanterelle'])).animals.vole!.stock);
  });

  it('ein Durchgang: Ergebnis unabhängig von der Reihenfolge in den Nischen', () => {
    const ids = ['earthworm', 'woodlouse', 'slug', 'hedgehog', 'robin', 'centipede', 'woodant', 'oakmoth', 'bluetit', 'vole'];
    const a = evaluateEcosystem(eco(5, ids));
    const b = evaluateEcosystem(eco(5, [...ids].reverse()));
    const sorted = (ev: Evaluation) =>
      Object.fromEntries(Object.entries(ev.animals).map(([id, st]) => [id, { ...st, overhuntedBy: st.overhuntedBy && [...st.overhuntedBy].sort() }]));
    expect(sorted(b)).toEqual(sorted(a));
    expect(b.harmony).toBeCloseTo(a.harmony, 12);
    expect(b.growth).toBeCloseTo(a.growth, 12);
    const norm = (ev: Evaluation) => ev.foodWeb.map((f) => ({ ...f, prey: [...f.prey].sort(), hunters: [...f.hunters].sort(), controllers: [...f.controllers].sort() }));
    expect(norm(b)).toEqual(norm(a));
  });
});

/** Zufällige Ökosysteme (eigener Zufall, unabhängig von Math.random – reproduzierbar). */
function randomEcosystems(count: number, seed: number): Ecosystem[] {
  const rng: RngHolder = { rngState: seed };
  const out: Ecosystem[] = [];
  for (let i = 0; i < count; i++) {
    const stage = 1 + randomInt(rng, 7);
    const pool = SPECIES.filter((s) => s.unlock <= stage);
    const ids = pool.filter(() => random(rng) < 0.35).map((s) => s.id);
    const e = eco(stage, ids, random(rng) < 0.5 ? ['hazel', 'moss'] : []);
    const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
    out.push({ ...e, season: seasons[randomInt(rng, 4)], mainTree: random(rng) < 0.5 ? 'oak' : 'pine' });
  }
  return out;
}

describe('Invarianten auf 400 zufälligen Ökosystemen', () => {
  const ecosystems = randomEcosystems(400, 2026);

  it('Überjagung nie stärker als der bisherige Räuberdruck; Werte in ihren Grenzen', () => {
    let hunted = 0;
    let relieved = 0;
    for (const e of ecosystems) {
      const ev = evaluateEcosystem(e);
      for (const [id, st] of Object.entries(ev.animals)) {
        expect(st.overhunt, id).toBeGreaterThanOrEqual(0);
        expect(st.overhunt, id).toBeLessThanOrEqual(OVERHUNT_MAX_UNITS);
        expect(OVERHUNT_PENALTY * st.overhunt, id).toBeLessThanOrEqual(oldPenalty(st.hunters) + 1e-12);
        if (st.hunters === 0) expect(st.overhunt, id).toBe(0);
        if (st.stock !== undefined) {
          expect(st.stock).toBeGreaterThanOrEqual(0.5);
          expect(st.stock).toBeLessThanOrEqual(1.5);
        }
        expect(st.happiness).toBeGreaterThanOrEqual(0);
        expect(st.happiness).toBeLessThanOrEqual(1);
        expect(Number.isFinite(st.food)).toBe(true);
        if (st.hunters > 0) hunted++;
        if (st.hunters > 0 && OVERHUNT_PENALTY * st.overhunt < oldPenalty(st.hunters)) relieved++;
      }
      expect(Number.isFinite(ev.harmony) && Number.isFinite(ev.growth) && Number.isFinite(ev.seeds)).toBe(true);
    }
    // Nicht leer: Es gab gejagte Beute, und meist ist sie jetzt besser dran.
    expect(hunted).toBeGreaterThan(200);
    // Ab 3 Jägern bei Bestand ≤ 1 bleibt es bei −20 %, sonst weniger.
    expect(relieved).toBeGreaterThan(hunted / 2);
  });

  it('Nahrungsnetz: eine Zeile je Beute-Merkmal mit Beute, Zustand passt zu Jägern und Bestand', () => {
    const order = Object.keys(TAG_NAMES) as Tag[];
    for (const e of ecosystems) {
      const ev = evaluateEcosystem(e);
      const ctx = appearsContext(e);
      const rows = ev.foodWeb.map((f) => f.tag);
      expect(rows).toEqual(order.filter((t) => rows.includes(t))); // Reihenfolge wie TAG_NAMES
      expect(rows).not.toContain('hoehle'); // Merkmale ohne Jäger im Katalog erscheinen nie
      for (const f of ev.foodWeb) {
        expect(f.prey.length).toBeGreaterThan(0);
        expect(f.stock).toBeCloseTo(f.prey.reduce((s, id) => s + ev.animals[id]!.stock!, 0), 12);
        expect(f.supply).toBeCloseTo(f.prey.reduce((s, id) => s + Math.max(1, ev.animals[id]!.stock!), 0), 12);
        for (const id of f.hunters) expect(SPECIES_BY_ID.get(id)!.food).toContain(f.tag);
        expect(f.state === 'unhunted').toBe(ctx.unhunted.has(f.tag));
        if (f.state === 'unhunted') expect(f.hunters.length + f.controllers.length).toBe(0);
        const over = f.prey.some((b) => f.hunters.filter((h) => h !== b).length > f.supply);
        expect(f.state === 'overhunted').toBe(over);
      }
    }
  });
});

describe('nie schlechter als vor Räuber und Beute (Variante b, Referenz main 9dde233)', () => {
  const ref = reference as unknown as { cases: ReferenceCase[]; values: ReferenceValue[] };

  it('die Referenz-Ökosysteme sind dieselben (Arten und Zufall unverändert)', () => {
    expect(referenceCases()).toEqual(ref.cases);
  });

  it('kein Tier weniger zufrieden oder schlechter gefüttert, keine Harmonie niedriger', () => {
    let better = 0;
    let fedBetter = 0;
    ref.cases.forEach((c, i) => {
      const old = ref.values[i]!;
      const ev = evaluateEcosystem(referenceEcosystem(c));
      expect(ev.harmony, `#${i}`).toBeGreaterThanOrEqual(old.harmony - 1e-6);
      if (ev.harmony > old.harmony + 1e-6) better++;
      for (const [id, [happiness, food]] of Object.entries(old.animals)) {
        const st = ev.animals[id]!;
        expect(st.happiness, `#${i} ${id}`).toBeGreaterThanOrEqual(happiness - 1e-6);
        expect(st.food, `#${i} ${id}`).toBeGreaterThanOrEqual(food - 1e-6);
        if (st.food > food + 1e-6) fedBetter++;
      }
    });
    // Nicht leer: Die Regel wirkt wirklich (Harmonie und Futter oft besser).
    expect(better).toBeGreaterThan(ref.cases.length / 3);
    expect(fedBetter).toBeGreaterThan(50);
  });
});

describe('Bedingung „ungejagt“ (22.5)', () => {
  const raupen = { appears: [{ kind: 'unhunted' as const, tag: 'raupen' as Tag }] };

  it('Beute ohne Jäger: ja; ein Räuber, der sie frisst, oder eine Art, die sie klein hält: nein', () => {
    expect(speciesAppears(eco(4, ['oakmoth']), raupen)).toBe(true);
    expect(speciesAppears(eco(4, ['oakmoth', 'bluetit']), raupen)).toBe(false); // frisst Raupen
    expect(speciesAppears(eco(4, ['oakmoth', 'woodant']), raupen)).toBe(false); // ⊘ Raupen (control)
    expect(speciesAppears(eco(4, []), raupen)).toBe(false); // keine Beute
    expect(speciesAppears(eco(4, ['bluetit']), raupen)).toBe(false);
    // Ein Pflanzenfresser, der Raupen nur „frisst“, ohne Räuber zu sein, zählt nicht als Jäger.
    const grazer = fakeSpecies({ id: 'grazer', niche: 'crown', level: 'herbivore', food: ['raupen'] });
    withFakeSpecies([grazer], () => {
      expect(speciesAppears(eco(4, ['oakmoth', 'grazer']), raupen)).toBe(true);
    });
  });

  it('nur in Ereignissen: keine Art und kein Gast nutzt „ungejagt“ als Wunsch oder Bedingung', () => {
    for (const sp of SPECIES) expect([...sp.needs, ...(sp.appears ?? [])].some((c) => c.kind === 'unhunted'), sp.id).toBe(false);
    const users = [...EVENTS_BY_ID.values()].filter((e) => (e.appears ?? []).some((c) => c.kind === 'unhunted')).map((e) => e.id);
    expect(users.sort()).toEqual(PREDATION_EVENTS.map((e) => e.id).sort());
  });

  it('gleich in evaluate (Wunsch) und appearsContext; unhuntedTags', () => {
    const wish = fakeSpecies({ id: 'wisher', niche: 'edge', level: 'herbivore', food: ['nektar'], needs: [{ kind: 'unhunted', tag: 'kleinsaeuger' }] });
    withFakeSpecies([wish], () => {
      expect(evaluateEcosystem(eco(4, ['vole', 'wisher'])).animals.wisher!.needs).toEqual([true]);
      expect(evaluateEcosystem(eco(4, ['vole', 'owl', 'wisher'])).animals.wisher!.needs).toEqual([false]);
    });
    const species = ['vole', 'oakmoth', 'slug', 'woodant'].map((id) => SPECIES_BY_ID.get(id)!);
    // Waldameise frisst Insekten (auch die eigenen) und hält Raupen klein.
    expect([...unhuntedTags(species)].sort()).toEqual(['kleinsaeuger', 'schnecken']);
    expect([...appearsContext(eco(4, ['vole', 'oakmoth', 'slug', 'woodant'])).unhunted].sort()).toEqual(['kleinsaeuger', 'schnecken']);
  });
});

/** Spielstand an einem Tag der gewünschten Jahreszeit (nach der Schonzeit). */
function stateIn(stage: number, animals: string[], season: 'spring' | 'summer' | 'autumn' | 'winter', seed = 1): GameState {
  const state = stateAt(stage, animals, seed);
  const index = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
  state.cycle.elapsed = (GENTLE_DAYS + index) * SEASON_SECONDS + 1;
  expect(seasonIdAt(state.cycle.elapsed)).toBe(season);
  return state;
}

const eligibleIds = (state: GameState) => eligibleEvents(state).map((e) => e.id);

describe('Massenjahre (22.5)', () => {
  it('vier Ereignisse in EVENTS, ohne Lebensraum-Arten (Schritt A)', () => {
    expect(PREDATION_EVENTS.map((e) => e.id)).toEqual(['caterpillar-year', 'vole-year', 'beetle-year', 'slug-year']);
    for (const e of PREDATION_EVENTS) {
      expect(EVENTS_BY_ID.get(e.id)).toBe(e);
      for (const o of e.options) {
        for (const x of o.effects) {
          if (x.kind === 'nextEncounter') for (const id of x.ids) expect(SPECIES_BY_ID.has(id), id).toBe(true);
          if (x.kind === 'cycle' && x.effect.kind === 'slot') expect(NICHE_IDS).toContain(x.effect.niche);
        }
      }
    }
  });

  it('Raupenjahr: ab Alter Baum, Frühling/Sommer, nur solange Raupen ungejagt sind', () => {
    expect(eligibleIds(stateIn(4, ['oakmoth'], 'summer'))).toContain('caterpillar-year');
    expect(eligibleIds(stateIn(4, ['oakmoth'], 'spring'))).toContain('caterpillar-year');
    expect(eligibleIds(stateIn(4, ['oakmoth'], 'autumn'))).not.toContain('caterpillar-year');
    expect(eligibleIds(stateIn(3, ['oakmoth'], 'summer'))).not.toContain('caterpillar-year');
    expect(eligibleIds(stateIn(4, ['oakmoth', 'bluetit'], 'summer'))).not.toContain('caterpillar-year');
    expect(eligibleIds(stateIn(4, ['oakmoth', 'woodant'], 'summer'))).not.toContain('caterpillar-year');
    expect(eligibleIds(stateIn(4, [], 'summer'))).not.toContain('caterpillar-year');
    const seen = stateIn(4, ['oakmoth'], 'summer');
    seen.cycle.seen.push('caterpillar-year');
    expect(eligibleIds(seen)).not.toContain('caterpillar-year');
  });

  it('Mäusejahr, Käferjahr, Schneckenjahr: Stufe, Jahreszeit und Jäger', () => {
    expect(eligibleIds(stateIn(4, ['vole'], 'autumn'))).toContain('vole-year');
    expect(eligibleIds(stateIn(4, ['vole'], 'winter'))).not.toContain('vole-year');
    expect(eligibleIds(stateIn(4, ['vole', 'owl'], 'autumn'))).not.toContain('vole-year');
    expect(eligibleIds(stateIn(4, ['vole', 'fox'], 'autumn'))).not.toContain('vole-year');
    expect(eligibleIds(stateIn(5, ['barkbeetle'], 'summer'))).toContain('beetle-year');
    expect(eligibleIds(stateIn(4, ['barkbeetle'], 'summer'))).not.toContain('beetle-year');
    expect(eligibleIds(stateIn(5, ['barkbeetle', 'woodpecker'], 'summer'))).not.toContain('beetle-year');
    expect(eligibleIds(stateIn(5, ['stagbeetle'], 'summer'))).toContain('beetle-year'); // Hirschkäfer ist auch Käfer
    expect(eligibleIds(stateIn(4, ['slug'], 'spring'))).toContain('slug-year');
    expect(eligibleIds(stateIn(4, ['slug'], 'summer'))).not.toContain('slug-year');
    for (const hunter of ['hedgehog', 'glowworm', 'toad']) {
      expect(eligibleIds(stateIn(4, ['slug', hunter], 'spring')), hunter).not.toContain('slug-year');
    }
  });

  it('Einladung: die nächste Begegnung bietet die Jäger an; danach ist die Beute gejagt', () => {
    const state = stateIn(4, ['vole'], 'autumn', 7);
    state.pendingEncounters = [{ type: 'event', cards: ['vole-year'], rerolls: 0 }];
    state.cycle.seen.push('vole-year');
    expect(chooseEventOption(state, 0, 0)).toMatchObject({ ok: true });
    expect(state.cycle.forced).toEqual({ type: 'animal', ids: ['owl', 'fox'] });
    // Übersteht Speichern und Laden (Vorgabe nur mit IDs, die ein Ereignis vorgibt).
    expect(deserialize(serialize(state), 0)!.cycle.forced).toEqual(state.cycle.forced);
  });

  it('Geschenk-Optionen überstehen Speichern und Laden', () => {
    const state = stateIn(4, ['slug'], 'spring', 3);
    state.pendingEncounters = [{ type: 'event', cards: ['slug-year'], rerolls: 0 }];
    state.cycle.seen.push('slug-year');
    expect(chooseEventOption(state, 0, 1)).toMatchObject({ ok: true });
    expect(state.cycle.bonuses).toEqual([{ source: 'slug-year', effect: { kind: 'water', amount: 2 } }]);
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.cycle.bonuses).toEqual(state.cycle.bonuses);
    expect(evaluate(loaded)).toEqual(evaluate(state));
  });

  it('nichts stirbt: 8 h überjagte Beute – Nischen unverändert, Abzug höchstens wie bisher', () => {
    const animals = ['vole', 'owl', 'fox', 'earthworm', 'robin', 'mole', 'slug', 'hedgehog'];
    const state = stateAt(5, animals, 11);
    const niches = structuredClone(state.niches);
    for (let h = 0; h < 8; h++) {
      tick(state, 3600, 'average');
      state.pendingEncounters = [];
      expect(state.niches).toEqual(niches);
      const ev = evaluate(state);
      for (const id of animals) {
        const st = ev.animals[id]!;
        expect(st.happiness, id).toBeGreaterThanOrEqual(0);
        expect(OVERHUNT_PENALTY * st.overhunt, id).toBeLessThanOrEqual(oldPenalty(st.hunters) + 1e-12);
      }
      expect(ev.animals.vole!.overhunt).toBeGreaterThan(0); // wirklich überjagt
    }
  });
});

/** Erster Tag nach der Schonzeit mit diesem Wetter in dieser Jahreszeit. */
function dayWith(state: GameState, weather: string, season: string): number {
  for (let d = GENTLE_DAYS; d < 4000; d++) {
    if (seasonIdAt(d * SEASON_SECONDS) === season && weatherOfDay(state.cycle, d) === weather) return d;
  }
  throw new Error(`kein Tag mit ${weather} im ${season}`);
}

describe('Wetter → Ereignis-Gewichte (22.6)', () => {
  it('eventWeight: Faktor des Tageswetters, sonst 1', () => {
    const state = stateAt(3, ['earthworm'], 5);
    state.cycle.elapsed = dayWith(state, 'storm', 'autumn') * SEASON_SECONDS + 10;
    expect(weatherOfDay(state.cycle, dayIndex(state.cycle.elapsed))).toBe('storm');
    expect(eventWeight(state, 'storm')).toBe(3);
    expect(eventWeight(state, 'windthrow')).toBe(3);
    expect(eventWeight(state, 'leaf-fall')).toBe(1);
    expect(eventWeight(state, 'nope')).toBe(1);
    expect(eventWeight(state, '__proto__')).toBe(1);
    // Mittelmodus (offline) mit dem echten Tag; ohne Wetter (`off`) gleich verteilt.
    expect(eventWeight(state, 'storm', 'average')).toBe(3);
    expect(eventWeight(state, 'storm', 'off')).toBe(1);
    state.cycle.elapsed = dayWith(state, 'mild', 'autumn') * SEASON_SECONDS + 10;
    expect(eventWeight(state, 'storm')).toBe(1);
    // Kaputte Spielzeit: wie Tag 0 („Wechselhaft“), Gewicht 1.
    state.cycle.elapsed = NaN;
    expect(eventWeight(state, 'storm')).toBe(1);
  });

  it('jede Wetterlage mit Faktoren kommt im Spiel vor; die Faktoren sind endlich und > 1', () => {
    for (const [w, factors] of Object.entries(WEATHER_EVENT_FACTORS)) {
      const state = stateAt(3, [], 1);
      const season = ['spring', 'summer', 'autumn', 'winter'].find((s) => {
        try {
          dayWith(state, w, s);
          return true;
        } catch {
          return false;
        }
      });
      expect(season, w).toBeDefined();
      for (const f of Object.values(factors!)) expect(Number.isFinite(f) && f > 1).toBe(true);
    }
  });

  it('Häufigkeit bei Sturm: Sturmnacht ≈ ×3 gegenüber einem milden Tag', () => {
    const state = stateAt(3, ['earthworm', 'robin'], 9);
    const share = (day: number) => {
      const s = structuredClone(state);
      s.cycle.elapsed = day * SEASON_SECONDS + 10;
      const events = eligibleEvents(s);
      expect(events.map((e) => e.id)).toContain('storm');
      let storm = 0;
      const n = 30_000;
      for (let i = 0; i < n; i++) if (pickEvent(s, events).id === 'storm') storm++;
      return { share: storm / n, count: events.length, weight: events.reduce((sum, e) => sum + eventWeight(s, e.id), 0) };
    };
    const stormy = share(dayWith(state, 'storm', 'autumn'));
    const mild = share(dayWith(state, 'mild', 'autumn'));
    expect(stormy.count).toBe(mild.count); // dieselben Ereignisse, nur andere Gewichte
    expect(mild.share).toBeCloseTo(1 / mild.count, 1);
    expect(stormy.share).toBeCloseTo(3 / stormy.weight, 1);
    expect(Math.abs(stormy.share - 3 / stormy.weight)).toBeLessThan(0.015);
    expect(Math.abs(mild.share - 1 / mild.count)).toBeLessThan(0.015);
    // Chancenverhältnis Sturmnacht : ein anderes Ereignis ≈ 3 : 1.
    const odds = stormy.share / ((1 - stormy.share) / (stormy.count - 1));
    expect(odds).toBeGreaterThan(2.6);
    expect(odds).toBeLessThan(3.4);
  });

  it('deterministisch: gleicher Stand → gleiches Ereignis; der Zufall des Wetters bleibt unberührt', () => {
    const state = stateAt(4, ['vole', 'oakmoth'], 21);
    state.cycle.elapsed = dayWith(state, 'storm', 'autumn') * SEASON_SECONDS + 3;
    const a = structuredClone(state);
    const b = structuredClone(state);
    const picks = (s: GameState) => Array.from({ length: 50 }, () => pickEvent(s, eligibleEvents(s)).id);
    expect(picks(a)).toEqual(picks(b));
    expect(a.rngState).toBe(b.rngState);
    // Je Ziehung genau ein Zufallswert (wie vorher `pick`).
    const c = structuredClone(state);
    pickEvent(c, eligibleEvents(c));
    random(state);
    expect(c.rngState).toBe(state.rngState);
  });
});

/**
 * Spielt `hours` Stunden in Abschnitten: online je Sekunde (Modus `mode`), offline in einem
 * Stück (simulateOffline) bzw. als ein großer Tick. Nach jedem Abschnitt dieselben Entscheidungen:
 * Ereignisse → Geschenk (Option 2), Gäste ziehen lassen, Karten ablehnen – so bleibt die
 * Beute ungejagt und Massenjahre kommen.
 */
function playChunks(state: GameState, chunks: number, seconds: number, step: (s: GameState, dt: number) => void): GameState {
  for (let c = 0; c < chunks; c++) {
    step(state, seconds);
    while (state.pendingEncounters.length > 0) {
      const type = state.pendingEncounters[0]!.type;
      if (type === 'event') chooseEventOption(state, 0, 1);
      else if (type === 'visitor') farewellVisitor(state, 0);
      else declineEncounter(state, 0);
    }
  }
  return state;
}

describe('online = offline mit Massenjahren und Wetter-Gewichten', { timeout: 120_000 }, () => {
  const start = () => {
    const s = stateAt(4, ['vole', 'oakmoth', 'slug', 'earthworm'], 77);
    s.plants = ['hazel'];
    s.cycle.elapsed = GENTLE_DAYS * SEASON_SECONDS;
    return s;
  };
  const MASS_YEARS = PREDATION_EVENTS.map((e) => e.id);

  it('Mittel: Sekunden-Ticks = simulateOffline je 10 min', () => {
    const online = playChunks(start(), 24, 600, (s, dt) => {
      for (let i = 0; i < dt; i++) tick(s, 1, 'average');
    });
    const offline = playChunks(start(), 24, 600, (s, dt) => {
      expect(simulateOffline(s, dt).averaged).toBe(true);
    });
    expect(online.cycle.seen.some((id) => MASS_YEARS.includes(id))).toBe(true);
    expect(offline.cycle.seen).toEqual(online.cycle.seen);
    expect(offline.cycle.bonuses).toEqual(online.cycle.bonuses);
    expect(offline.cycle.timed).toEqual(online.cycle.timed);
    expect(offline.waypoint).toBe(online.waypoint);
    expect(offline.rngState).toBe(online.rngState);
    expect(offline.cycle.elapsed).toBeCloseTo(online.cycle.elapsed, 6);
    expect(offline.totalGrowth).toBeCloseTo(online.totalGrowth, 4);
    expect(offline.seeds).toBeCloseTo(online.seeds, 4);
  });

  it('Einzelwetter: Sekunden-Ticks = ein großer Tick je 10 min', () => {
    const small = playChunks(start(), 24, 600, (s, dt) => {
      for (let i = 0; i < dt; i++) tick(s, 1);
    });
    const big = playChunks(start(), 24, 600, (s, dt) => {
      tick(s, dt);
    });
    expect(small.cycle.seen.some((id) => MASS_YEARS.includes(id))).toBe(true);
    expect(big.cycle.seen).toEqual(small.cycle.seen);
    expect(big.cycle.bonuses).toEqual(small.cycle.bonuses);
    expect(big.waypoint).toBe(small.waypoint);
    expect(big.rngState).toBe(small.rngState);
    expect(big.totalGrowth).toBeCloseTo(small.totalGrowth, 4);
  });
});
