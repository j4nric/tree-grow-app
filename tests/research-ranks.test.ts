import { describe, expect, it } from 'vitest';
import { MAX_RESEARCH_RANK, RESEARCH_BY_ID, RESEARCH_REPEATABLE } from '../src/content/research';
import { WAYPOINT_COUNT } from '../src/content/waypoints';
import { effectiveForestMemory } from '../src/core/landscape';
import { evaluate, harmonyIncome, researchCostAt, researchEffects, researchRank, thresholdFor } from '../src/core/formulas';
import { deserialize, loadGame, serialize } from '../src/core/save';
import { MAX_HARMONY_POINTS, type DailyGoal, type GameState } from '../src/core/state';
import {
  isResearched,
  nextPlannedResearch,
  plannedResearchNeed,
  previewResearch,
  research,
  researchBlocker,
  researchComplete,
  researchCost,
  researchRankOf,
  setResearchAuto,
  simulateOffline,
  startNewCycle,
  tick,
} from '../src/core/tick';
import { offlineTick, stateAt } from './helpers';

/*
 * Wiederholbare Forschungsknoten und Forschungsplan (DESIGN_V2.md 28.6, 27.8; Phase 11, 2b –
 * enthält Phase 10, 4b): Rang statt „erforscht“, Kosten ⌈1.500 · 1,3^r⌉, Wirkung × Rang, Plan
 * mit wiederholten IDs, „Plan folgen“ in tick mit Halt (online = offline, auch mit f).
 */

/** Boden bis zur Gabel (Käferburg): `soil-life` ist offen. */
const SOIL_FORK = ['compost', 'leaf-litter', 'deadwood-pile', 'beetle-castle'];

/** Hain mit Tieren (⚖️-Zufluss > 0) und der Boden-Gabel. */
function grove(seed = 1): GameState {
  const state = stateAt(5, ['earthworm', 'robin', 'bee', 'vole', 'chanterelle'], seed);
  state.cycle.research = [...SOIL_FORK];
  return state;
}

/** Alle Wegpunkte erreicht: Die Raten hängen nur noch an Jahreszeit, Wetter und Forschung. */
function finishedGrove(seed = 1): GameState {
  const state = grove(seed);
  state.waypoint = WAYPOINT_COUNT;
  state.stage = 7;
  state.totalGrowth = thresholdFor(WAYPOINT_COUNT);
  return state;
}

/** ⚖️ je Sekunde in den Vorrat (Rate ohne f, ohne Wetter und Nacht). */
const income = (state: GameState) => harmonyIncome(evaluate(state, 'off').harmony, effectiveForestMemory(state));

describe('Kosten und Rang (28.6)', () => {
  it('Tabelle 28.6: ⌈1.500 · 1,3^r⌉ je Rang, JS-Gleitkomma 2.536 bei r = 2', () => {
    const state = grove();
    const costs: number[] = [];
    for (let r = 0; r < 8; r++) {
      state.cycle.researchRanks = r > 0 ? { 'soil-life': r } : {};
      costs.push(researchCost(state, 'soil-life')!);
    }
    expect(costs).toEqual([1_500, 1_950, 2_536, 3_296, 4_285, 5_570, 7_241, 9_413]);
    for (const node of RESEARCH_REPEATABLE) expect(researchCostAt(node, 0), node.id).toBe(1_500);
    // Einmalige Knoten: fester Preis, unbekannte: undefined.
    expect(researchCost(state, 'humus')).toBe(430);
    expect(researchCost(state, 'drache')).toBeUndefined();
  });

  it('Grenzen: höchster Rang kostet Infinity, kaputte Ränge zählen als 0 bzw. Obergrenze', () => {
    const node = RESEARCH_BY_ID.get('soil-life')!;
    expect(Number.isFinite(researchCostAt(node, MAX_RESEARCH_RANK - 1))).toBe(true);
    expect(researchCostAt(node, MAX_RESEARCH_RANK)).toBe(Infinity);
    expect(researchCostAt(node, Number.NaN)).toBe(Infinity);
    expect(researchCostAt(node, -1)).toBe(Infinity);
    expect(researchCostAt(RESEARCH_BY_ID.get('compost')!, 7)).toBe(100);
    const ranks = { a: Number.NaN, b: -3, c: 2.7, d: 1e9, e: Infinity, f: 0, g: 'x' as unknown as number, h: 5 };
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'nope'].map((id) => researchRank(ranks, id))).toEqual([
      0, 0, 2, MAX_RESEARCH_RANK, MAX_RESEARCH_RANK, 0, 0, 5, 0,
    ]);
    expect(researchRank(undefined, 'a')).toBe(0);
    // Einmalige Knoten haben nie einen Rang.
    const state = grove();
    state.cycle.researchRanks = { compost: 3 };
    expect(researchRankOf(state, 'compost')).toBe(0);
  });

  it('Blocker: Stufe, Gabel, Vorrat – und „owned“ erst beim höchsten Rang', () => {
    const young = stateAt(4);
    young.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile'];
    young.harmonyPoints = 1e6;
    expect(researchBlocker(young, 'soil-life')).toBe('stage');
    const state = stateAt(5);
    state.harmonyPoints = 1e6;
    expect(researchBlocker(state, 'soil-life')).toBe('requires');
    // Beide Wege der Gabel öffnen den Knoten.
    for (const fork of ['beetle-castle', 'fungus-garden']) {
      const s = stateAt(5);
      s.cycle.research = ['compost', 'leaf-litter', 'deadwood-pile', fork];
      s.harmonyPoints = 1_500;
      expect(researchBlocker(s, 'soil-life'), fork).toBeNull();
      s.harmonyPoints = 1_499.99;
      expect(researchBlocker(s, 'soil-life'), fork).toBe('too-expensive');
    }
    const g = grove();
    g.harmonyPoints = 1e12;
    g.cycle.researchRanks = { 'soil-life': 5 };
    expect(researchBlocker(g, 'soil-life')).toBeNull();
    expect(isResearched(g, 'soil-life')).toBe(true);
    expect(researchComplete(g, 'soil-life')).toBe(false);
    g.cycle.researchRanks = { 'soil-life': MAX_RESEARCH_RANK };
    expect(researchBlocker(g, 'soil-life')).toBe('owned');
    expect(researchComplete(g, 'soil-life')).toBe(true);
    expect(previewResearch(g, 'soil-life')).toBeNull();
    // NaN im Vorrat: zu teuer, kein Absturz.
    g.cycle.researchRanks = {};
    g.harmonyPoints = Number.NaN;
    expect(researchBlocker(g, 'soil-life')).toBe('too-expensive');
  });

  it('research kauft Rang für Rang: Vorrat, Ränge, Kauf-Reihenfolge und Statistik', () => {
    const state = grove();
    state.harmonyPoints = 9_000;
    const bought = state.meta.stats.careRanksBought;
    const results = [research(state, 'soil-life'), research(state, 'soil-life'), research(state, 'soil-life')];
    expect(results.map((r) => r.ok && r.harmony)).toEqual([-1_500, -1_950, -2_536]);
    expect(state.harmonyPoints).toBe(9_000 - 1_500 - 1_950 - 2_536);
    expect(state.cycle.researchRanks).toEqual({ 'soil-life': 3 });
    expect(state.cycle.research).toEqual([...SOIL_FORK, 'soil-life', 'soil-life', 'soil-life']);
    expect(state.meta.stats.careRanksBought).toBe(bought + 3);
    expect(researchCost(state, 'soil-life')).toBe(3_296);
    expect(research(state, 'soil-life')).toEqual({ ok: false, error: 'too-expensive' });
  });
});

describe('Wirkung × Rang (28.6)', () => {
  it('researchEffects multipliziert je Rang; ohne Rang keine Wirkung, IDs im Verlauf zählen nicht', () => {
    expect(researchEffects([], { 'soil-life': 3 }).effects).toEqual([{ kind: 'groupGrowth', group: 'trees', pct: 3 }]);
    expect(researchEffects(undefined, { 'wet-care': 2 }).effects).toEqual([
      { kind: 'groupGrowth', group: 'mosses', pct: 8 },
      { kind: 'groupSeeds', group: 'mosses', pct: 8 },
    ]);
    expect(researchEffects(['soil-life', 'soil-life']).effects).toEqual([]);
    expect(researchEffects(['soil-life'], { 'soil-life': 0 }).effects).toEqual([]);
    expect(researchEffects([], { 'soil-life': Number.NaN, compost: 4 }).effects).toEqual([]);
    // Einmalige Knoten wie bisher, wiederholbare dahinter (feste RESEARCH-Reihenfolge).
    expect(researchEffects(['humus'], { 'seed-refine': 1 }).effects).toEqual([
      { kind: 'water', amount: 2 },
      { kind: 'harmony', points: 3 },
      { kind: 'groupSeeds', group: 'shrubs', pct: 2 },
    ]);
  });

  it('evaluate: Bäume (mit Hauptbaum) wachsen je Rang schneller, Harmonie bleibt; Cache kennt den Rang', () => {
    const state = grove();
    const before = evaluate(state);
    state.cycle.researchRanks = { 'soil-life': 10 };
    const after = evaluate(state);
    expect(after.growth).toBeGreaterThan(before.growth);
    expect(after.harmony).toBe(before.harmony);
    // Ein Rang mehr ist ein neuer Schlüssel – nicht der Wert von eben aus dem Cache.
    state.cycle.researchRanks = { 'soil-life': 11 };
    expect(evaluate(state).growth).toBeGreaterThan(after.growth);
    state.cycle.researchRanks = {};
    expect(evaluate(state)).toEqual(before);
  });

  it('previewResearch zeigt den nächsten Rang – genau das, was der Kauf bringt', () => {
    const state = grove();
    state.harmonyPoints = 1e6;
    research(state, 'soil-life');
    const preview = previewResearch(state, 'soil-life')!;
    expect(preview.growth).toBeGreaterThan(evaluate(state).growth);
    research(state, 'soil-life');
    expect(evaluate(state)).toEqual(preview);
  });
});

describe('Forschungsplan (27.8, 28.6)', () => {
  it('Neuer Zyklus: der Plan merkt sich jeden Rang an seiner Stelle; Ränge beginnen bei 0', () => {
    const state = grove();
    state.harmonyPoints = 1e6;
    for (const id of ['soil-life', 'humus', 'soil-life']) expect(research(state, id).ok, id).toBe(true);
    expect(startNewCycle(state, 1_000).ok).toBe(true);
    expect(state.meta.research.plan).toEqual([...SOIL_FORK, 'soil-life', 'humus', 'soil-life']);
    expect(state.cycle.researchRanks).toEqual({});
    expect(state.cycle.research).toEqual([]);
  });

  it('nächster Eintrag: erledigt (k-ter Rang), überspringen (Gabel anders), warten (Stufe), sparen', () => {
    const state = grove();
    state.meta.research.plan = ['compost', 'soil-life', 'light-crown', 'soil-life', 'nest-boxes'];
    state.harmonyPoints = 0;
    // compost erledigt; soil-life Rang 1 fehlt → sparen.
    expect(nextPlannedResearch(state)).toEqual({ index: 1, id: 'soil-life', blocker: 'too-expensive' });
    state.cycle.researchRanks = { 'soil-life': 1 };
    // light-crown: braucht Nistkästen (erreichbar) → warten statt überspringen.
    expect(nextPlannedResearch(state)).toEqual({ index: 2, id: 'light-crown', blocker: 'requires' });
    // Gabel anders entschieden (Dichte Krone) → überspringen; zweiter Rang ist dran.
    state.cycle.research.push('nest-boxes', 'dense-crown');
    expect(nextPlannedResearch(state)).toEqual({ index: 3, id: 'soil-life', blocker: 'too-expensive' });
    state.cycle.researchRanks = { 'soil-life': 2 };
    expect(nextPlannedResearch(state)).toBeNull();
    // Stufe fehlt: der Plan wartet (nichts dahinter wird vorgezogen).
    const young = stateAt(3);
    young.meta.research.plan = ['nest-boxes', 'pond', 'compost'];
    young.cycle.research = ['nest-boxes'];
    young.harmonyPoints = 1e6;
    expect(nextPlannedResearch(young)).toEqual({ index: 1, id: 'pond', blocker: 'stage' });
    // Unbekannte IDs (nur in manipulierten Ständen) und voll ausgebaute Ränge werden übersprungen.
    state.meta.research.plan = ['drache', 'soil-life', 'soil-life', 'soil-life', 'humus'];
    state.cycle.researchRanks = { 'soil-life': MAX_RESEARCH_RANK };
    expect(nextPlannedResearch(state)).toMatchObject({ index: 4, id: 'humus' });
    // Was an einem ausgeschlossenen Knoten hängt, ist ebenfalls unerreichbar.
    state.meta.research.plan = ['light-crown-2', 'humus'];
    expect(nextPlannedResearch(state)).toMatchObject({ index: 1, id: 'humus' });
  });

  it('setResearchAuto schaltet nur den Schalter; ohne ihn kauft tick nichts', () => {
    const state = grove();
    state.meta.research.plan = ['soil-life'];
    state.harmonyPoints = 5_000;
    tick(state, 1);
    expect(state.cycle.researchRanks).toEqual({});
    expect(setResearchAuto(state, true)).toEqual({ ok: true });
    expect(state.meta.research.auto).toBe(true);
    expect(state.cycle.researchRanks).toEqual({});
    const report = tick(state, 0.5);
    expect(report.research).toEqual(['soil-life']);
    expect(state.cycle.researchRanks).toEqual({ 'soil-life': 1 });
    setResearchAuto(state, false);
    expect(state.meta.research.auto).toBe(false);
  });

  it('kauft streng in Plan-Reihenfolge, auch mehrere in einem Tick; der Vorrat reicht genau', () => {
    const state = grove();
    state.cycle.research = [];
    state.meta.research = { plan: [...SOIL_FORK, 'soil-life', 'humus'], auto: true };
    // Kompost 100 + Laub 80 + Totholz 600 + Käferburg 850 = 1.630; reicht nicht für Bodenleben.
    state.harmonyPoints = 1_630;
    const report = tick(state, 1e-9);
    expect(report.research).toEqual(SOIL_FORK);
    expect(state.cycle.research).toEqual(SOIL_FORK);
    // Humus (430, billiger) wird nicht vorgezogen: Der Plan spart auf Bodenleben.
    expect(nextPlannedResearch(state)).toMatchObject({ id: 'soil-life', blocker: 'too-expensive' });
    expect(plannedResearchNeed(state)).toBe(1_500);
  });

  it('Halt bei den Kosten: Kauf genau, wenn der Zufluss (× f) sie erreicht', () => {
    for (const f of [1, 0.1]) {
      const state = finishedGrove();
      state.meta.research = { plan: ['soil-life', 'soil-life'], auto: true };
      const rate = income(state) * f;
      expect(rate).toBeGreaterThan(0);
      // Fünf Sekunden vor den Kosten (alles im ersten Frühling: Rate konstant).
      const t = 5;
      state.harmonyPoints = 1_500 - rate * t;
      // Kurz davor: nichts gekauft.
      tick(state, t * 0.999, 'off', f);
      expect(state.cycle.researchRanks, String(f)).toEqual({});
      tick(state, t * 0.002, 'off', f);
      expect(state.cycle.researchRanks, String(f)).toEqual({ 'soil-life': 1 });
      // Nach dem Kauf beginnt der Vorrat bei (fast) 0 – gekauft wurde am Halt, nicht später.
      expect(state.harmonyPoints, String(f)).toBeCloseTo(rate * t * 0.001, 6);
    }
  });

  it('der Plan kauft nicht für den Spieler: Tagesziel „erforschen“ zählt nur von Hand', () => {
    const goal: DailyGoal = { kind: 'care', target: 5, progress: 0, reward: 'seeds', done: false };
    const state = grove();
    state.meta.daily.goals = [goal];
    state.meta.research = { plan: ['soil-life'], auto: true };
    state.harmonyPoints = 1e5;
    tick(state, 1);
    expect(state.cycle.researchRanks).toEqual({ 'soil-life': 1 });
    expect(state.meta.daily.goals[0]!.progress).toBe(0);
    research(state, 'soil-life');
    expect(state.meta.daily.goals[0]!.progress).toBe(1);
  });

  it('Kosten über dem höchsten Vorrat: kein Halt, keine Endlosschleife', () => {
    const state = finishedGrove();
    state.meta.research = { plan: ['soil-life'], auto: true };
    state.cycle.researchRanks = { 'soil-life': 150 };
    expect(researchCost(state, 'soil-life')!).toBeGreaterThan(MAX_HARMONY_POINTS);
    expect(plannedResearchNeed(state)).toBe(Infinity);
    tick(state, 3600, 'off');
    expect(state.cycle.researchRanks).toEqual({ 'soil-life': 150 });
  });
});

describe('online = offline mit Plan (27.8, 28.3)', { timeout: 60_000 }, () => {
  /** Hain mit Plan über den Boden-Ast, vier Ränge und Humus; Vorrat knapp unter den ersten Kosten. */
  function planned(seed: number): GameState {
    const state = grove(seed);
    state.meta.research = { plan: [...SOIL_FORK, 'soil-life', 'humus', 'soil-life', 'soil-life', 'soil-life'], auto: true };
    state.harmonyPoints = 1_300;
    return state;
  }

  function expectSame(a: GameState, b: GameState): void {
    expect(b.cycle.research).toEqual(a.cycle.research);
    expect(b.cycle.researchRanks).toEqual(a.cycle.researchRanks);
    expect(b.waypoint).toBe(a.waypoint);
    expect(b.niches).toEqual(a.niches);
    expect(b.pendingEncounters).toEqual(a.pendingEncounters);
    expect(b.rngState).toBe(a.rngState);
    expect(b.harmonyPoints).toBeCloseTo(a.harmonyPoints, 6);
    expect(b.totalGrowth).toBeCloseTo(a.totalGrowth, 6);
    expect(b.seeds).toBeCloseTo(a.seeds, 6);
  }

  it('Einzelwetter: viele kleine Ticks = ein großer Tick', () => {
    const small = planned(7);
    const big = planned(7);
    const seconds = 3 * 3600;
    for (let i = 0; i < seconds; i++) tick(small, 1);
    tick(big, seconds);
    expect(big.cycle.researchRanks['soil-life']).toBeGreaterThanOrEqual(1);
    expect(big.cycle.research).toContain('humus');
    expectSame(small, big);
  });

  it('Mittel mit f: Sekunden-Ticks wie offline = simulateOffline (60 s voll, Rest × 0,1)', () => {
    const small = planned(11);
    const offline = planned(11);
    // Die 10 % brauchen lange: 8 h, damit nach den vollen Sekunden noch etwas gekauft wird.
    const seconds = 8 * 3600;
    for (let i = 0; i < seconds; i++) offlineTick(small, i, 1, 'average');
    const report = simulateOffline(offline, seconds);
    expect(report.research.length).toBeGreaterThan(0);
    expect(report.research).toEqual(offline.cycle.research.slice(SOIL_FORK.length));
    expect(offline.cycle.researchRanks['soil-life'] ?? 0).toBeGreaterThanOrEqual(1);
    expectSame(small, offline);
  });

  it('lange Sprünge über Jahre halten am Plan (kein Jahr über die Kosten hinweg)', () => {
    const a = finishedGrove(3);
    a.meta.research = { plan: ['soil-life', 'soil-life', 'soil-life'], auto: true };
    a.harmonyPoints = 0;
    const b = structuredClone(a);
    // Ein riesiger Tick (Jahressprünge im Mittel) gegen Tagesschritte im selben Modus.
    const seconds = 40 * 3600;
    tick(a, seconds, 'average', 0.1);
    for (let t = 0; t < seconds; t += 180) tick(b, 180, 'average', 0.1);
    expect(a.cycle.researchRanks['soil-life']).toBeGreaterThanOrEqual(1);
    expect(b.cycle.researchRanks).toEqual(a.cycle.researchRanks);
    expect(b.harmonyPoints).toBeCloseTo(a.harmonyPoints, 4);
    expect(b.totalGrowth / a.totalGrowth).toBeCloseTo(1, 9);
  });
});

describe('Laden (28.8, Ränge im Verlauf)', () => {
  it('Roundtrip: Ränge und Verlauf mit wiederholten IDs bleiben, Plan auch', () => {
    const state = grove();
    state.harmonyPoints = 1e6;
    for (const id of ['soil-life', 'humus', 'soil-life']) research(state, id);
    state.meta.research = { plan: ['compost', 'soil-life', 'soil-life', 'soil-life'], auto: true };
    const loaded = deserialize(serialize(state), 0)!;
    expect(loaded.cycle.research).toEqual(state.cycle.research);
    expect(loaded.cycle.researchRanks).toEqual({ 'soil-life': 2 });
    expect(loaded.meta.research).toEqual(state.meta.research);
    expect(serialize(deserialize(serialize(loaded), 0)!)).toBe(serialize(loaded));
  });

  it('robust: Verlauf höchstens so oft wie der Rang, Plan je Rang höchstens 200 Einträge, einmalige je einmal', () => {
    const state = grove();
    const raw = JSON.parse(serialize(state));
    raw.cycle.research = [...SOIL_FORK, 'soil-life', 'compost', 'soil-life', 'soil-life', 'wet-care'];
    raw.cycle.researchRanks = { 'soil-life': 2, 'wet-care': 3 };
    raw.meta.research = {
      plan: ['compost', 'compost', ...Array.from({ length: 300 }, () => 'soil-life'), 'drache', 'humus'],
      auto: true,
    };
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    // Doppelter Kompost fällt weg, Bodenleben auf Rang 2 gekürzt; Feuchte halten ohne Gabel → weg.
    expect(loaded.cycle.research).toEqual([...SOIL_FORK, 'soil-life', 'soil-life']);
    expect(loaded.cycle.researchRanks).toEqual({ 'soil-life': 2 });
    expect(loaded.meta.research.plan).toEqual(['compost', ...Array.from({ length: MAX_RESEARCH_RANK }, () => 'soil-life'), 'humus']);
    expect(loaded.meta.research.auto).toBe(true);
  });

  it('Stand aus Phase 11, 2a (v18, Ränge ohne Verlauf) lädt unverändert', () => {
    const state = grove();
    const raw = JSON.parse(serialize(state));
    raw.cycle.researchRanks = { 'soil-life': 4 };
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.version).toBe(18);
    expect(loaded.cycle.research).toEqual(SOIL_FORK);
    expect(loaded.cycle.researchRanks).toEqual({ 'soil-life': 4 });
    expect(researchCost(loaded, 'soil-life')).toBe(4_285);
  });

  it('Verlauf vor der Gabel oder vor dem Hain fällt weg (Voraussetzung wie beim Kauf)', () => {
    const raw = JSON.parse(serialize(stateAt(5)));
    raw.cycle.research = ['soil-life', ...SOIL_FORK, 'soil-life'];
    raw.cycle.researchRanks = { 'soil-life': 2 };
    const loaded = loadGame(JSON.stringify(raw), 0)!.state;
    expect(loaded.cycle.research).toEqual([...SOIL_FORK, 'soil-life']);
    expect(loaded.cycle.researchRanks).toEqual({ 'soil-life': 2 });
    const young = JSON.parse(serialize(stateAt(4)));
    young.cycle.research = [...SOIL_FORK.slice(0, 3), 'soil-life'];
    young.cycle.researchRanks = { 'soil-life': 1 };
    const y = loadGame(JSON.stringify(young), 0)!.state;
    expect(y.cycle.research).toEqual(SOIL_FORK.slice(0, 3));
    expect(y.cycle.researchRanks).toEqual({});
  });
});
