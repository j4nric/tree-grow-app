import { describe, expect, it } from 'vitest';
import { YEAR_SECONDS } from '../src/content/seasons';
import { CARE_TO_RESEARCH, MIGRATION_HARMONY_MINUTES, RESEARCH, RESEARCH_BY_ID, type ResearchNode } from '../src/content/research';
import { MAX_SOWINGS } from '../src/content/sowing';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import {
  appearsContext,
  ecosystemOf,
  evaluate,
  evaluateEcosystem,
  harmonyIncome,
  harmonyIncomeFactor,
  researchEffects,
  researchSowing,
  thresholdFor,
} from '../src/core/formulas';
import { effectiveForestMemory } from '../src/core/landscape';
import { codeFromJson, deserialize, importCode, isNewerSave, loadGame, serialize } from '../src/core/save';
import { MAX_HARMONY_POINTS, SAVE_VERSION, createSite, type GameState } from '../src/core/state';
import {
  previewResearch,
  research,
  researchBlocker,
  simulateOffline,
  startNewCycle,
  tick,
} from '../src/core/tick';
import { isNewerSchema } from '../src/sync/policy';
import { CARE_V16, CARE_V16_BY_ID } from './fixtures/care-v16';
import { offlineTick, stateAt } from './helpers';

/*
 * Forschung und Harmonie-Vorrat (DESIGN_V2.md 27.3, 27.4, 27.7–27.9; Phase 10, 2a).
 * Bis v16 stand hier die Pflege (tests/care.test.ts); ihre Daten liegen eingefroren in
 * tests/fixtures/care-v16.ts und prüfen die Migration.
 */

/** Spielstand mit genug ⚖️ für alles. */
function rich(stage: number, animals: string[] = [], seed = 1): GameState {
  const state = stateAt(stage, animals, seed);
  state.harmonyPoints = 1e6;
  return state;
}

/** Ein Spielstand als v16-JSON: ohne die Felder von v17, mit Pflege-Rängen. */
function v16Raw(state: GameState, care: Record<string, unknown> | unknown, patch: (d: any) => void = () => {}): string {
  const d = JSON.parse(serialize(state));
  d.version = 16;
  delete d.harmonyPoints;
  delete d.cycle.research;
  delete d.cycle.sowings;
  delete d.cycle.sowing;
  delete d.cycle.freeSowing;
  delete d.meta.research;
  delete d.meta.stats.harmonyEarned;
  d.cycle.care = care;
  patch(d);
  return JSON.stringify(d);
}

/** Ein v17-Stand als JSON mit Änderungen. */
function v17Raw(state: GameState, patch: (d: any) => void): string {
  const d = JSON.parse(serialize(state));
  patch(d);
  return JSON.stringify(d);
}

const node = (id: string): ResearchNode => RESEARCH_BY_ID.get(id)!;

/** Alle (transitiven) Voraussetzungen eines Knotens. */
function prerequisites(id: string, out = new Set<string>()): Set<string> {
  const n = node(id);
  for (const p of [...(n.requires ?? []), ...(n.requiresAny ?? [])]) {
    if (!out.has(p)) {
      out.add(p);
      prerequisites(p, out);
    }
  }
  return out;
}

describe('Forschung: Blocker (27.7)', () => {
  it('in der festgelegten Reihenfolge', () => {
    const state = stateAt(3, [], 1);
    expect(researchBlocker(state, 'nope')).toBe('unknown-node');
    expect(researchBlocker(state, 'pond')).toBe('stage'); // Waldtümpel ab Alter Baum
    expect(researchBlocker(state, 'nest-boxes')).toBe('too-expensive');
    state.harmonyPoints = node('nest-boxes').cost;
    expect(researchBlocker(state, 'nest-boxes')).toBeNull();
    expect(research(state, 'nest-boxes').ok).toBe(true);
    expect(researchBlocker(state, 'nest-boxes')).toBe('owned');
    // Voraussetzung fehlt (Waldtümpel braucht Kompost), Bedingung (Insektenhotel: ≥ 1 Insekt).
    const old = rich(4, ['earthworm']);
    expect(researchBlocker(old, 'pond')).toBe('requires');
    expect(researchBlocker(old, 'insect-hotel')).toBe('requires');
    expect(research(old, 'wildflower-hem').ok).toBe(true);
    expect(researchBlocker(old, 'insect-hotel')).toBe('condition');
    const bee = rich(4, ['bee']);
    research(bee, 'wildflower-hem');
    expect(researchBlocker(bee, 'insect-hotel')).toBeNull();
    // `requiresAny`: Großes Insektenhotel braucht Blütenvorrat ODER Wildbienenwand.
    const forest = rich(6, ['bee']);
    for (const id of ['wildflower-hem', 'insect-hotel']) expect(research(forest, id).ok).toBe(true);
    expect(researchBlocker(forest, 'insect-hotel-3')).toBe('requires');
    expect(research(forest, 'bee-wall').ok).toBe(true);
    expect(researchBlocker(forest, 'insect-hotel-3')).toBeNull();
    // NaN im Vorrat (kaputter Zustand im Speicher): zu teuer, nie kaufbar.
    const broken = stateAt(3, [], 1);
    broken.harmonyPoints = Number.NaN;
    expect(researchBlocker(broken, 'nest-boxes')).toBe('too-expensive');
  });

  it('Gabeln: der andere Weg ist ausgeschlossen – bei der Krone auf allen drei Ebenen', () => {
    const state = rich(6);
    for (const id of ['nest-boxes', 'light-crown']) expect(research(state, id).ok).toBe(true);
    for (const id of ['dense-crown', 'dense-crown-2', 'dense-crown-3']) expect(researchBlocker(state, id), id).toBe('excluded');
    expect(research(state, 'dense-crown')).toEqual({ ok: false, error: 'excluded' });
    expect(researchBlocker(state, 'light-crown-2')).toBeNull();
    // Saat: Samenbank oder Anzuchtbeet.
    for (const id of ['seed-sorting', 'nursery']) expect(research(state, id).ok).toBe(true);
    expect(researchBlocker(state, 'seed-bank')).toBe('excluded');
  });
});

describe('Forschung: Erforschen und Wirkung', () => {
  it('zieht genau die Kosten vom Vorrat ab, hängt den Knoten an, zählt die Statistik', () => {
    const state = stateAt(3, [], 1);
    state.harmonyPoints = 1000;
    state.seeds = 50;
    const result = research(state, 'leaf-litter');
    expect(result).toEqual({ ok: true, harmony: -80 });
    expect(state.harmonyPoints).toBe(920);
    expect(state.seeds).toBe(50); // Samen bleiben unberührt
    expect(state.cycle.research).toEqual(['leaf-litter']);
    expect(state.meta.stats.careRanksBought).toBe(1);
    research(state, 'compost');
    expect(state.cycle.research).toEqual(['leaf-litter', 'compost']); // Kauf-Reihenfolge
  });

  it('Wirkungen addieren sich über den Weg (Lichte Krone I–III: +3, +2, +2 ☀️)', () => {
    const state = rich(6);
    research(state, 'nest-boxes');
    const base = evaluate(state).light;
    research(state, 'light-crown');
    expect(evaluate(state).light).toBeCloseTo(base + 3);
    research(state, 'light-crown-2');
    research(state, 'light-crown-3');
    expect(evaluate(state).light).toBeCloseTo(base + 7);
  });

  it('negative Lichtwirkung (Dichte Krone) – Licht fällt nie unter 0', () => {
    const state = rich(4);
    research(state, 'nest-boxes');
    const before = evaluate(state);
    research(state, 'dense-crown');
    const after = evaluate(state);
    expect(after.light).toBeCloseTo(Math.max(0, before.light - 2));
    expect(after.slots.crown).toBe(before.slots.crown + 1);
    const dark = rich(4);
    dark.cycle.research = ['nest-boxes', 'dense-crown'];
    dark.stage = 0; // Samen: 0 Licht
    expect(evaluate(dark).light).toBe(0);
  });

  it('Nistkästen öffnen Höhlen schon im Jungen Baum und bringen das Merkmal Baumhöhle', () => {
    const state = rich(3);
    expect(evaluate(state).slots.hollows).toBe(0);
    expect(appearsContext(ecosystemOf(state)).tags.has('hoehle')).toBe(false);
    research(state, 'nest-boxes');
    expect(evaluate(state).slots.hollows).toBe(1);
    expect(appearsContext(ecosystemOf(state)).tags.has('hoehle')).toBe(true);
  });

  it('Harmonie-Wirkung; die Bedingung gilt nur beim Erforschen', () => {
    const state = rich(4, ['bee', 'earthworm']);
    research(state, 'wildflower-hem');
    const before = evaluate(state).harmony;
    research(state, 'insect-hotel');
    expect(evaluate(state).harmony).toBeCloseTo(before + 3);
    state.niches.edge = []; // Biene weg: die Wirkung bleibt
    const without = evaluate(state).harmony;
    state.cycle.research = ['wildflower-hem'];
    expect(evaluate(state).harmony).toBeCloseTo(without - 3);
  });

  it('`happiness` je Gattung (Pilzgarten: Pilze +15 Prozentpunkte, vor der Begrenzung)', () => {
    const state = rich(5, ['porcini', 'earthworm']);
    for (const id of ['leaf-litter', 'compost', 'deadwood-pile']) expect(research(state, id).ok).toBe(true);
    const z0 = evaluate(state).animals.porcini!.happiness;
    const worm0 = evaluate(state).animals.earthworm!.happiness;
    expect(research(state, 'fungus-garden').ok).toBe(true);
    const z1 = evaluate(state).animals.porcini!.happiness;
    expect(z1).toBeCloseTo(Math.min(1, z0 + 0.15), 12);
    expect(z1).toBeGreaterThan(z0);
    // Andere Gattungen bleiben (Regenwurm ist kein Pilz).
    expect(evaluate(state).animals.earthworm!.happiness).toBeCloseTo(worm0, 12);
    expect(researchEffects(['fungus-garden']).happiness).toEqual([{ kind: 'happiness', genus: 'fungi', points: 15 }]);
  });

  it('Aussaat-Wirkungen berühren evaluate nicht; researchSowing summiert sie', () => {
    const state = rich(4);
    const before = evaluate(state);
    research(state, 'seed-sorting');
    research(state, 'seed-bank');
    expect(evaluate(state)).toEqual(before);
    expect(researchSowing(state.cycle.research, 'sowCards')).toBe(1);
    expect(researchSowing(state.cycle.research, 'sowCost')).toBe(-25);
    expect(researchSowing(['nursery'], 'sowFreeReroll')).toBe(1);
    expect(researchSowing(undefined, 'sowCards')).toBe(0);
    // Unbekannte IDs und Doppel zählen nicht.
    expect(researchEffects(['nope', 'compost', 'compost']).habitats).toEqual(['feucht']);
  });

  it('Wirkungen hängen nur von der Menge ab, nicht von der Kauf-Reihenfolge (bitgenau)', () => {
    const ids = ['wildflower-hem', 'insect-hotel', 'compost', 'leaf-litter', 'humus', 'nest-boxes', 'dense-crown', 'dense-crown-2', 'pond'];
    expect(researchEffects([...ids].reverse())).toEqual(researchEffects(ids));
    const a = rich(5, ['bee', 'earthworm', 'robin']);
    const b = structuredClone(a);
    a.cycle.research = ids;
    b.cycle.research = [...ids].reverse();
    const first = JSON.stringify(evaluateEcosystem(ecosystemOf(a)));
    expect(JSON.stringify(evaluateEcosystem(ecosystemOf(b)))).toBe(first);
  });

  it('Erforschen führt H_max nach; Vorschau = Zustand danach', () => {
    const state = rich(4, ['bee', 'earthworm']);
    research(state, 'wildflower-hem');
    const preview = previewResearch(state, 'insect-hotel')!;
    research(state, 'insect-hotel');
    expect(evaluate(state).harmony).toBeCloseTo(preview.harmony);
    expect(state.cycle.maxHarmony).toBeGreaterThanOrEqual(preview.harmony - 1e-9);
    expect(previewResearch(state, 'nope')).toBeNull();
    expect(previewResearch(state, 'insect-hotel')).toBeNull(); // schon erforscht
  });

  it('Ausgeben senkt den Harmonie-Bonus nie (27.4): er hängt an der Produktion, nicht am Vorrat', () => {
    const state = rich(4, ['bee', 'earthworm']);
    const before = evaluate(state);
    state.harmonyPoints = 0;
    expect(evaluate(state)).toBe(before); // gleicher Cache-Eintrag
    state.harmonyPoints = 1e6;
    research(state, 'seed-sorting'); // keine Wirkung auf evaluate
    expect(evaluate(state).multiplier).toBe(before.multiplier);
    expect(state.harmonyPoints).toBe(1e6 - node('seed-sorting').cost);
  });
});

describe('Harmonie-Vorrat: Ertrag p/60 · G (27.3)', () => {
  it('harmonyIncome: Produktion je Minute, nie negativ, kaputte Werte → 0', () => {
    expect(harmonyIncome(120, 0)).toBeCloseTo(2, 12);
    expect(harmonyIncome(120, 100)).toBeCloseTo(4, 12);
    expect(harmonyIncome(120, 1000)).toBeCloseTo(22, 12);
    expect(harmonyIncome(120, 5000)).toBeCloseTo(22, 12); // Gedächtnis begrenzt
    expect(harmonyIncome(-5, 0)).toBe(0);
    expect(harmonyIncome(Number.NaN, 0)).toBe(0);
    expect(harmonyIncome(Number.POSITIVE_INFINITY, 0)).toBe(0);
    expect(harmonyIncome(0, 0)).toBe(0);
    expect(harmonyIncomeFactor(Number.NaN)).toBe(1);
    expect(harmonyIncomeFactor(-10)).toBe(1);
  });

  it('tick: Vorrat wächst um H/60 · G je Sekunde (Gedächtnis 0 / 100 / 1000)', () => {
    for (const memory of [0, 100, 1000]) {
      const state = stateAt(4, ['bee', 'earthworm', 'robin'], 1);
      state.meta.forestMemory = memory;
      const h = evaluate(state, 'off').harmony;
      expect(h).toBeGreaterThan(0);
      tick(state, 10, 'off');
      expect(state.harmonyPoints, `Gedächtnis ${memory}`).toBeCloseTo((h / 60) * (1 + memory / 100) * 10, 9);
      expect(state.meta.stats.harmonyEarned).toBeCloseTo(state.harmonyPoints, 9);
    }
  });

  it('Landschaft: der Korridor-Zufluss zählt im Gedächtnisfaktor mit (wirksames Gedächtnis)', () => {
    const state = stateAt(4, ['bee', 'earthworm'], 1);
    state.meta.forestMemory = 100;
    state.meta.landscape.sites.push({ ...createSite('carr'), memory: 800 });
    state.meta.landscape.corridors = ['home-carr'];
    const memory = effectiveForestMemory(state);
    expect(memory).toBeGreaterThan(100);
    const h = evaluate(state, 'off').harmony;
    tick(state, 10, 'off');
    expect(state.harmonyPoints).toBeCloseTo(harmonyIncome(h, memory) * 10, 9);
  });

  it('online gleich offline: viele kleine Ticks = ein großer = simulateOffline', () => {
    const base = stateAt(5, ['earthworm', 'robin', 'bee'], 77);
    base.harmonyPoints = 5;
    base.cycle.research = ['compost', 'leaf-litter', 'humus'];
    const small = structuredClone(base);
    const big = structuredClone(base);
    for (let i = 0; i < 3600; i++) tick(small, 1);
    tick(big, 3600);
    expect(big.harmonyPoints).toBeGreaterThan(5);
    expect(big.harmonyPoints).toBeCloseTo(small.harmonyPoints, 6);
    expect(big.meta.stats.harmonyEarned).toBeCloseTo(small.meta.stats.harmonyEarned, 6);
    const online = structuredClone(base);
    const offline = structuredClone(base);
    // Wie simulateOffline: Mittelwetter, erste 60 s voll, danach 10 % (28.3).
    for (let i = 0; i < 3600; i++) offlineTick(online, i, 1);
    const report = simulateOffline(offline, 3600);
    expect(offline.harmonyPoints).toBeCloseTo(online.harmonyPoints, 6);
    expect(offline.cycle.research).toEqual(online.cycle.research);
    expect(report.harmony).toBeCloseTo(offline.harmonyPoints - 5, 9);
  });

  it('Schnellvorlauf über ganze Jahre rechnet den Vorrat wie Schritt für Schritt', () => {
    const base = stateAt(7, ['earthworm', 'robin', 'bee'], 3);
    base.waypoint = WAYPOINT_COUNT;
    base.totalGrowth = thresholdFor(WAYPOINT_COUNT);
    const jump = structuredClone(base);
    const steps = structuredClone(base);
    tick(jump, 12 * YEAR_SECONDS, 'average');
    for (let i = 0; i < (12 * YEAR_SECONDS) / 60; i++) tick(steps, 60, 'average');
    expect(jump.harmonyPoints).toBeGreaterThan(0);
    expect(jump.harmonyPoints / steps.harmonyPoints).toBeCloseTo(1, 9);
  });

  it('Obergrenze MAX_HARMONY_POINTS; kaputter Vorrat zählt als 0', () => {
    const state = stateAt(4, ['bee', 'earthworm'], 1);
    state.harmonyPoints = MAX_HARMONY_POINTS - 1;
    tick(state, 100, 'off');
    expect(state.harmonyPoints).toBe(MAX_HARMONY_POINTS);
    expect(state.meta.stats.harmonyEarned).toBeCloseTo(1, 6); // nur, was wirklich ankam
    const broken = stateAt(4, ['bee', 'earthworm'], 1);
    broken.harmonyPoints = Number.NaN;
    broken.meta.stats.harmonyEarned = Number.NaN;
    tick(broken, 10, 'off');
    expect(Number.isFinite(broken.harmonyPoints)).toBe(true);
    expect(broken.harmonyPoints).toBeGreaterThan(0);
    expect(Number.isFinite(broken.meta.stats.harmonyEarned)).toBe(true);
  });
});

describe('Neuer Zyklus (27.8)', () => {
  it('setzt Vorrat, Forschung und Aussaat zurück und schreibt den Plan', () => {
    const state = rich(5, ['earthworm']);
    research(state, 'leaf-litter');
    research(state, 'compost');
    state.cycle.sowings = 4;
    state.cycle.sowing = { cards: ['hazel'], rerolls: 1 };
    state.meta.stats.harmonyEarned = 1234;
    state.meta.research.auto = true;
    expect(startNewCycle(state, 0).ok).toBe(true);
    expect(state.harmonyPoints).toBe(0);
    expect(state.cycle.research).toEqual([]);
    expect(state.cycle.sowings).toBe(0);
    expect(state.cycle.sowing).toBeNull();
    expect(state.cycle.freeSowing).toBeNull();
    expect(state.meta.research).toEqual({ plan: ['leaf-litter', 'compost'], auto: true });
    expect(state.meta.stats.harmonyEarned).toBe(1234);
    expect(state.meta.stats.careRanksBought).toBe(2);
  });

  it('ein Zyklus ohne Forschung lässt den bisherigen Plan stehen', () => {
    const state = rich(5, ['earthworm']);
    state.meta.research.plan = ['compost'];
    startNewCycle(state, 0);
    expect(state.meta.research.plan).toEqual(['compost']);
  });
});

describe('Spielstand v17: Speichern und robustes Laden (27.9)', () => {
  it('SAVE_VERSION 17; Roundtrip gleich, zweites Laden ändert nichts', () => {
    expect(SAVE_VERSION).toBe(18);
    const state = rich(5, ['bee', 'earthworm']);
    for (const id of ['compost', 'pond', 'wildflower-hem', 'insect-hotel', 'seed-sorting']) expect(research(state, id).ok).toBe(true);
    state.harmonyPoints = 321.5;
    state.cycle.sowings = 3;
    state.cycle.sowing = { cards: ['hazel', 'anemone', 'nettle', 'bramble'], rerolls: 2 };
    state.meta.research = { plan: ['compost', 'pond'], auto: true };
    state.meta.stats.harmonyEarned = 999.25;
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.version).toBe(18);
    expect(loaded.harmonyPoints).toBe(state.harmonyPoints);
    expect(loaded.cycle.research).toEqual(state.cycle.research);
    expect(loaded.cycle.sowings).toBe(3);
    expect(loaded.cycle.sowing).toEqual(state.cycle.sowing);
    expect(loaded.meta.research).toEqual(state.meta.research);
    expect(loaded.meta.stats.harmonyEarned).toBe(999.25);
    expect(evaluate(loaded)).toEqual(evaluate(state));
    expect(deserialize(serialize(loaded), 0)).toEqual(loaded);
  });

  it('Vorrat: endlich und ≥ 0, sonst 0; höchstens MAX_HARMONY_POINTS', () => {
    const state = stateAt(4, [], 1);
    const load = (value: unknown) => deserialize(v17Raw(state, (d) => (d.harmonyPoints = value)), 0)!.harmonyPoints;
    expect(load(123.5)).toBe(123.5);
    expect(load(-5)).toBe(0);
    expect(load(null)).toBe(0);
    expect(load('100')).toBe(0);
    expect(load(2e12)).toBe(MAX_HARMONY_POINTS);
    const inf = v17Raw(state, (d) => (d.harmonyPoints = 0)).replace('"harmonyPoints":0', '"harmonyPoints":1e400');
    expect(deserialize(inf, 0)!.harmonyPoints).toBe(MAX_HARMONY_POINTS);
    const missing = v17Raw(state, (d) => delete d.harmonyPoints);
    expect(deserialize(missing, 0)!.harmonyPoints).toBe(0);
  });

  it('Forschung: bekannte IDs je einmal, Stufe erreicht, Voraussetzungen davor, Gabel: zuerst gekaufter Weg', () => {
    const load = (stage: number, value: unknown) =>
      deserialize(v17Raw(stateAt(stage, [], 1), (d) => (d.cycle.research = value)), 0)!.cycle.research;
    expect(load(4, ['nope', 'compost', 'compost', 'pond', 'humus'])).toEqual(['compost', 'pond']);
    // Voraussetzung erst dahinter: der Knoten fällt (eine echte Kauf-Reihenfolge hat sie davor).
    expect(load(4, ['pond', 'compost'])).toEqual(['compost']);
    expect(load(4, ['nest-boxes', 'dense-crown', 'light-crown'])).toEqual(['nest-boxes', 'dense-crown']);
    // Was an einem verworfenen Knoten hängt, fällt mit.
    expect(load(6, ['light-crown', 'nest-boxes', 'light-crown-2'])).toEqual(['nest-boxes']);
    // `condition` gilt nur beim Erforschen (kein Insekt im Stand).
    expect(load(4, ['wildflower-hem', 'insect-hotel'])).toEqual(['wildflower-hem', 'insect-hotel']);
    for (const bad of [null, 'compost', { compost: 1 }, [1, 2]]) expect(load(4, bad)).toEqual([]);
    // Riesige Listen: höchstens alle Knoten.
    expect(load(7, Array.from({ length: 10_000 }, (_, i) => RESEARCH[i % RESEARCH.length]!.id)).length).toBeLessThanOrEqual(RESEARCH.length);
  });

  it('ein v17-Stand mit `cycle.care` (manipuliert): die Pflege wird ignoriert', () => {
    const raw = v17Raw(stateAt(4, [], 1), (d) => (d.cycle.care = { pond: 1, compost: 1 }));
    const loaded = deserialize(raw, 0)!;
    expect(loaded.cycle.research).toEqual([]);
    expect('care' in loaded.cycle).toBe(false);
  });

  it('Aussaat-Felder: Zähler, offene und geschenkte Aussaat', () => {
    const state = stateAt(4, [], 1);
    state.plants = ['hazel', 'anemone'];
    const load = (patch: (d: any) => void) => deserialize(v17Raw(state, patch), 0)!.cycle;
    expect(load((d) => (d.cycle.sowings = 3)).sowings).toBe(3);
    expect(load((d) => (d.cycle.sowings = MAX_SOWINGS)).sowings).toBe(MAX_SOWINGS);
    for (const bad of [2.5, -1, MAX_SOWINGS + 1, 'x', null]) expect(load((d) => (d.cycle.sowings = bad)).sowings, String(bad)).toBe(2);
    // Offene Aussaat: nur bekannte, freigeschaltete Pflanzen, verschieden, höchstens 3 (+ sowCards).
    expect(load((d) => (d.cycle.sowing = { cards: ['nope', 'hazel', 'hazel', 'beech'], rerolls: 2.7 })).sowing).toEqual({
      cards: ['hazel', 'beech'],
      rerolls: 2,
    });
    expect(load((d) => (d.cycle.sowing = { cards: ['hazel', 'anemone', 'nettle', 'bramble'], rerolls: -1 })).sowing).toEqual({
      cards: ['hazel', 'anemone', 'nettle'],
      rerolls: 0,
    });
    const sorted = load((d) => {
      d.cycle.research = ['seed-sorting'];
      d.cycle.sowing = { cards: ['hazel', 'anemone', 'nettle', 'bramble', 'elder'], rerolls: 0 };
    });
    expect(sorted.sowing!.cards).toEqual(['hazel', 'anemone', 'nettle', 'bramble']);
    for (const bad of [null, 'x', { cards: [] }, { cards: ['nope'] }, { cards: 'hazel' }]) {
      expect(load((d) => (d.cycle.sowing = bad)).sowing).toBeNull();
    }
    // Pflanze erst ab einer späteren Stufe (Eberesche ab Junger Baum = 3): bei Stufe 2 verworfen.
    const early = stateAt(2, [], 1);
    expect(deserialize(v17Raw(early, (d) => (d.cycle.sowing = { cards: ['rowan', 'hazel'], rerolls: 0 })), 0)!.cycle.sowing!.cards).toEqual(['hazel']);
    // Vogelsaat: nur IDs, die ein gezogenes Ereignis vorgibt.
    expect(load((d) => (d.cycle.freeSowing = { ids: ['rowan', 'elder'] })).freeSowing).toBeNull();
    expect(
      load((d) => {
        d.cycle.seen = ['bird-sown'];
        d.cycle.freeSowing = { ids: ['rowan', 'nope', 'elder', 'rowan'] };
      }).freeSowing,
    ).toEqual({ ids: ['rowan', 'elder'] });
    expect(load((d) => ((d.cycle.seen = ['bird-sown']), (d.cycle.freeSowing = { ids: ['hazel'] }))).freeSowing).toBeNull();
  });

  it('Forschungsplan und gesammelte Harmonie', () => {
    const state = stateAt(4, [], 1);
    const load = (patch: (d: any) => void) => deserialize(v17Raw(state, patch), 0)!.meta;
    expect(load((d) => (d.meta.research = { plan: ['compost', 'nope', 'compost', 'pond'], auto: 'yes' })).research).toEqual({
      plan: ['compost', 'pond'],
      auto: false,
    });
    expect(load((d) => (d.meta.research = { plan: [], auto: true })).research).toEqual({ plan: [], auto: true });
    for (const bad of [null, 'x', [1]]) expect(load((d) => (d.meta.research = bad)).research).toEqual({ plan: [], auto: false });
    expect(load((d) => (d.meta.stats.harmonyEarned = -1)).stats.harmonyEarned).toBe(0);
    expect(load((d) => (d.meta.stats.harmonyEarned = 50.5)).stats.harmonyEarned).toBe(50.5);
  });

  it('Versionsprüfung: ein v16-Spiel sieht den Stand als neuer (Abgleich und Import)', () => {
    const json = serialize(rich(4));
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, 16)).toBe(true);
    expect(isNewerSchema({ version: 1, actionVersion: 1, device: 'a', schema: SAVE_VERSION }, SAVE_VERSION)).toBe(false);
    const newer = JSON.stringify({ ...JSON.parse(json), version: SAVE_VERSION + 1 });
    expect(isNewerSave(newer)).toBe(true);
    expect(importCode(codeFromJson(newer), 0)).toEqual({ ok: false, error: 'newer' });
    expect(isNewerSave(json)).toBe(false);
  });
});

describe('Migration v16 → v17 (27.9)', () => {
  /** Lädt einen v16-Stand der Stufe mit diesen Pflege-Rängen; gibt die Forschung zurück. */
  const migrate = (stage: number, care: unknown, animals: string[] = []) => loadGame(v16Raw(stateAt(stage, animals, 1), care), 0)!.state;

  it('die eingefrorene Pflege passt zur Tabelle (Fixture = Stand v16)', () => {
    expect(Object.keys(CARE_TO_RESEARCH)).toEqual(CARE_V16.map((c) => c.id));
  });

  it('jede Zeile der Tabelle: Ränge → Knoten, fehlende Voraussetzungen geschenkt, keine Wirkung geht verloren', () => {
    for (const measure of CARE_V16) {
      const nodes = CARE_TO_RESEARCH[measure.id]!;
      for (let rank = 1; rank <= measure.ranks.length; rank++) {
        const research = migrate(7, { [measure.id]: rank }).cycle.research;
        const label = `${measure.id} Rang ${rank}`;
        // Die Knoten der Ränge 1 … rank sind da.
        expect(research, label).toEqual(expect.arrayContaining(nodes.slice(0, rank)));
        // Alles andere ist eine (transitive) Voraussetzung davon.
        const allowed = new Set(nodes.slice(0, rank));
        for (const id of nodes.slice(0, rank)) for (const p of prerequisites(id)) allowed.add(p);
        for (const id of research) expect(allowed.has(id), `${label}: ${id}`).toBe(true);
        // In RESEARCH-Reihenfolge und gültig (jede Voraussetzung steht davor).
        expect(research, label).toEqual(RESEARCH.filter((n) => research.includes(n.id)).map((n) => n.id));
        research.forEach((id, i) => {
          const before = research.slice(0, i);
          expect((node(id).requires ?? []).every((p) => before.includes(p)), `${label}: ${id}`).toBe(true);
          const any = node(id).requiresAny ?? [];
          expect(any.length === 0 || any.some((p) => before.includes(p)), `${label}: ${id}`).toBe(true);
        });
        // Jede Wirkung der gekauften Ränge steckt in den Knoten.
        const effects = researchEffects(research);
        for (const r of measure.ranks.slice(0, rank)) {
          for (const e of r.effects) {
            if (e.kind === 'cycle') expect(effects.effects, label).toContainEqual(e.effect);
            else expect(effects.habitats, label).toContain(e.tag);
          }
        }
      }
    }
  });

  it('Beispiele: geschenkte Voraussetzungen (27.9)', () => {
    expect(migrate(5, { 'leaf-litter': 2 }).cycle.research).toEqual(['compost', 'leaf-litter', 'humus']);
    expect(migrate(4, { 'insect-hotel': 1 }).cycle.research).toEqual(['wildflower-hem', 'insect-hotel']);
    expect(migrate(6, { 'insect-hotel': 3 }).cycle.research).toEqual(['wildflower-hem', 'insect-hotel', 'bloom-store', 'insect-hotel-3']);
    expect(migrate(5, { 'dense-crown': 2 }).cycle.research).toEqual(['nest-boxes', 'dense-crown', 'dense-crown-2']);
    expect(migrate(4, { pond: 1 }).cycle.research).toEqual(['compost', 'pond']);
    expect(migrate(5, { 'drystone-wall': 1 }).cycle.research).toEqual(['meadow', 'drystone-wall']);
    expect(migrate(5, { 'deadwood-pile': 2 }).cycle.research).toEqual(['leaf-litter', 'deadwood-pile', 'beetle-castle']);
  });

  it('Ränge über der Stufe gekappt, kaputte Ränge verworfen (wie bis v16)', () => {
    // Alter Baum (4): Tümpel Rang 2, Laub Rang 2 erst ab Hain; Lichte Krone Rang 1 + Nistkästen geschenkt.
    expect(migrate(4, { pond: 2, 'leaf-litter': 2, 'light-crown': 3 }).cycle.research).toEqual([
      'compost',
      'leaf-litter',
      'pond',
      'nest-boxes',
      'light-crown',
    ]);
    // Junger Baum (3): Maßnahmen ab Alter Baum fallen weg.
    expect(migrate(3, { pond: 2, 'leaf-litter': 2, 'wildflower-hem': 3 }).cycle.research).toEqual(['leaf-litter', 'wildflower-hem']);
    expect(
      migrate(4, { pond: 99, 'leaf-litter': 1.7, nope: 1, 'nest-boxes': -3, 'light-crown': 'zwei', 'dense-crown': null }).cycle.research,
    ).toEqual(['compost', 'leaf-litter', 'pond']);
    for (const bad of [null, [1, 2], 'x', undefined]) expect(migrate(4, bad).cycle.research).toEqual([]);
  });

  it('beide Kronen: nur die erste in Tabellen-Reihenfolge (Lichte vor Dichte)', () => {
    expect(migrate(6, { 'dense-crown': 3, 'light-crown': 1 }).cycle.research).toEqual(['nest-boxes', 'light-crown']);
    expect(migrate(6, { 'dense-crown': 2, 'light-crown': 0 }).cycle.research).toEqual(['nest-boxes', 'dense-crown', 'dense-crown-2']);
    const keys = Object.keys(CARE_TO_RESEARCH);
    expect(keys.indexOf('light-crown')).toBeLessThan(keys.indexOf('dense-crown'));
    expect(CARE_V16_BY_ID.get('light-crown')!.excludes).toContain('dense-crown');
  });

  it('Startguthaben round(10 · H), ohne Gedächtnisfaktor; v16-Felder mit v17-Namen zählen nicht', () => {
    const raw = v16Raw(stateAt(4, ['bee', 'earthworm', 'robin'], 1), { 'insect-hotel': 1 }, (d) => {
      d.harmonyPoints = 99_999;
      d.meta.forestMemory = 200;
      d.meta.stats.harmonyEarned = 777;
      d.meta.research = { plan: ['compost'], auto: true };
      d.cycle.research = ['compost'];
    });
    const { state } = loadGame(raw, 0)!;
    const h = evaluate(state).harmony;
    expect(h).toBeGreaterThan(0);
    expect(state.harmonyPoints).toBe(Math.round(MIGRATION_HARMONY_MINUTES * h));
    expect(state.meta.stats.harmonyEarned).toBe(0);
    expect(state.meta.research).toEqual({ plan: [], auto: false });
    expect(state.cycle.research).toEqual(['wildflower-hem', 'insect-hotel']);
    // Das Insektenhotel zählt in H mit (+3).
    const without = loadGame(v16Raw(stateAt(4, ['bee', 'earthworm', 'robin'], 1), {}), 0)!.state;
    expect(state.harmonyPoints).toBeGreaterThan(without.harmonyPoints);
  });

  it('Aussaat-Zähler = Begleitpflanzen im Ring; nichts offen', () => {
    const state = stateAt(4, [], 1);
    state.plants = ['hazel', 'anemone', 'nettle'];
    const loaded = loadGame(
      v16Raw(state, {}, (d) => {
        d.cycle.sowings = 0;
        d.cycle.sowing = { cards: ['hazel'], rerolls: 0 };
      }),
      0,
    )!.state;
    expect(loaded.cycle.sowings).toBe(3);
    expect(loaded.cycle.sowing).toBeNull();
    expect(loaded.cycle.freeSowing).toBeNull();
  });

  it('migrierter Stand: zweites Laden ändert nichts; Spiel läuft weiter', () => {
    const first = loadGame(v16Raw(stateAt(5, ['bee', 'earthworm'], 1), { 'leaf-litter': 2, 'insect-hotel': 2, pond: 1 }), 0)!.state;
    expect(first.version).toBe(SAVE_VERSION);
    const second = deserialize(serialize(first), 0)!;
    expect(second).toEqual(first);
    const before = second.harmonyPoints;
    tick(second, 60);
    expect(second.harmonyPoints).toBeGreaterThan(before);
  });
});
