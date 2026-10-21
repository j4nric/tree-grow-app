/**
 * Balancing-Simulator für das v2-Spiel – auf der ECHTEN Spiellogik aus src/core/
 * (tick, chooseCard, declineEncounter, rerollEncounter, plantSeed, evaluate,
 * previewChoice …). Anders als scripts/v2/ (Referenzmodell des vollen Designs) misst er
 * genau das, was der Spieler erlebt: Tier- und Pflanzenbegegnungen, Pflanzen setzen.
 *
 * Der Spieler löst jede Begegnung sofort auf (online) und setzt Pflanzen, sobald die
 * Samen reichen und es sich nach seiner Strategie lohnt. Die Zeit läuft ereignisgesteuert
 * von Wegpunkt zu Wegpunkt bzw. bis zum nächsten Pflanzenkauf (tick() rechnet dazwischen
 * exakt).
 *
 * Ausführen (Tabellen im Protokoll, DESIGN_V2.md Abschnitt 15.4):
 *   SIM_LOG=1 SIM_RUNS=500 npx vitest run tests/balance.test.ts
 */
import { GENUS_INFO, SPECIES_BY_ID } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { GENERA, type Genus } from '../src/content/types';
import {
  cardStatus,
  declineReward,
  evaluate,
  nextPlantCost,
  plantSlots,
  previewChoice,
  previewPlant,
  secondsToNextWaypoint,
  type Evaluation,
} from '../src/core/formulas';
import { normalizeSeed, randomInt, type RngHolder } from '../src/core/rng';
import { allAnimals, createInitialState, type GameState, type PendingEncounterType } from '../src/core/state';
import {
  allWaypointsReached,
  chooseCard,
  declineEncounter,
  plantSeed,
  rerollBlocker,
  rerollEncounter,
  tick,
  unlockedPlants,
} from '../src/core/tick';

// ---------------------------------------------------------------------------
// Optionen einer Begegnung
// ---------------------------------------------------------------------------

/**
 * Eine Möglichkeit, eine Karte zu spielen (bei voller Nische je zu entlassendem Tier,
 * bei vollem Pflanzring je zu ersetzender Pflanze).
 */
export interface Option {
  card: number;
  kind: PendingEncounterType;
  /** Art- oder Pflanzen-ID der Karte. */
  id: string;
  replace?: string;
  ev: Evaluation;
}

/** Alle gültigen Platzierungen der Karten der ersten offenen Begegnung. */
export function optionsFor(state: GameState): Option[] {
  const enc = state.pendingEncounters[0];
  if (!enc) return [];
  const out: Option[] = [];
  enc.cards.forEach((id, card) => {
    const status = cardStatus(state, 0, card);
    if (status === 'free') {
      const ev = previewChoice(state, 0, card);
      if (ev) out.push({ card, kind: enc.type, id, ev });
    } else if (status === 'full') {
      const candidates =
        enc.type === 'plant' ? [...new Set(state.plants)] : state.niches[SPECIES_BY_ID.get(id)!.niche];
      for (const replace of candidates) {
        const ev = previewChoice(state, 0, card, replace);
        if (ev) out.push({ card, kind: enc.type, id, replace, ev });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Strategien
// ---------------------------------------------------------------------------

export type Action = { kind: 'choose'; option: Option } | { kind: 'decline' } | { kind: 'reroll' };

export interface Strategy {
  id: string;
  name: string;
  /** Entscheidet über die erste offene Begegnung. `rng` ist der eigene Zufall der Strategie. */
  decide(state: GameState, options: Option[], current: Evaluation, rng: RngHolder): Action;
  /**
   * Bewertung für das Setzen von Pflanzen mit Samen (höher = besser; gesetzt wird nur,
   * was verbessert). null = Zufallsspieler: setzt irgendeine freigeschaltete Pflanze.
   */
  plantValue: ((ev: Evaluation) => number) | null;
}

const byHarmony = (ev: Evaluation) => ev.harmony + 1e-6 * ev.growth;
const byGrowth = (ev: Evaluation) => ev.growth + 1e-6 * ev.harmony;

function best(options: Option[], value: (o: Option) => number): Option | null {
  let top: Option | null = null;
  let topValue = -Infinity;
  for (const o of options) {
    const v = value(o);
    if (v > topValue) {
      top = o;
      topValue = v;
    }
  }
  return top;
}

/**
 * Höchstens ein Wurf je Tierbegegnung (wie scripts/v2/sim.ts), und nur, wenn die Logik
 * ihn zulässt (Samen reichen, es gibt andere Karten – rerollBlocker liefert sonst
 * 'too-expensive' / 'no-alternatives'). Pflanzenbegegnungen werden nicht neu gewürfelt.
 */
function canReroll(state: GameState): boolean {
  const enc = state.pendingEncounters[0];
  return !!enc && enc.type === 'animal' && enc.rerolls < 1 && rerollBlocker(state, 0) === null;
}

const isPlantEncounter = (state: GameState) => state.pendingEncounters[0]?.type === 'plant';

/** Nimmt die beste Option, wenn sie verbessert; sonst einmal neu würfeln, sonst ablehnen. */
function greedy(id: string, name: string, value: (ev: Evaluation) => number): Strategy {
  return {
    id,
    name,
    plantValue: value,
    decide(state, options, current) {
      const top = best(options, (o) => value(o.ev));
      if (top && value(top.ev) > value(current)) return { kind: 'choose', option: top };
      return canReroll(state) ? { kind: 'reroll' } : { kind: 'decline' };
    },
  };
}

export const RANDOM: Strategy = {
  id: 'random',
  name: 'Zufällig',
  plantValue: null,
  decide(state, options, _current, rng) {
    const cards = state.pendingEncounters[0]!.cards;
    const card = randomInt(rng, cards.length);
    const mine = options.filter((o) => o.card === card);
    if (mine.length === 0) return { kind: 'decline' };
    if (mine.length === 1 && mine[0]!.replace === undefined) return { kind: 'choose', option: mine[0]! };
    // Volle Nische / voller Ring: zufällig ersetzen oder ablehnen.
    const k = randomInt(rng, mine.length + 1);
    return k < mine.length ? { kind: 'choose', option: mine[k]! } : { kind: 'decline' };
  },
};

export const HARMONY = greedy('harmony', 'Gierig nach Harmonie', byHarmony);
export const GROWTH = greedy('growth', 'Gierig nach Wachstum', byGrowth);

export const RAREST: Strategy = {
  id: 'rarest',
  name: 'Immer die seltenste Karte',
  plantValue: byHarmony,
  decide(state, options, current, rng) {
    if (isPlantEncounter(state)) return HARMONY.decide(state, options, current, rng);
    if (options.length === 0) return { kind: 'decline' };
    const rarity = (o: Option) => SPECIES_BY_ID.get(o.id)!.rarity;
    const top = Math.max(...options.map(rarity));
    return { kind: 'choose', option: best(options, (o) => (rarity(o) === top ? byHarmony(o.ev) : -Infinity))! };
  },
};

export function stacker(genus: Genus): Strategy {
  return {
    id: `stack-${genus}`,
    name: `${GENUS_INFO[genus].name} stapeln`,
    plantValue: byHarmony,
    decide(state, options, current, rng) {
      // Pflanzen wählt der Stapler wie der Harmonie-Spieler.
      if (isPlantEncounter(state)) return HARMONY.decide(state, options, current, rng);
      const isOwn = (id: string) => SPECIES_BY_ID.get(id)!.genus === genus;
      const own = options.filter((o) => isOwn(o.id) && (o.replace === undefined || !isOwn(o.replace)));
      // Lieber ein freier Platz oder ein fremdes Tier ersetzen; nie ein eigenes.
      if (own.length > 0) return { kind: 'choose', option: best(own, (o) => byHarmony(o.ev))! };
      if (canReroll(state)) return { kind: 'reroll' };
      return HARMONY.decide(state, options, current, rng);
    },
  };
}

export const STRATEGIES: readonly Strategy[] = [RANDOM, HARMONY, GROWTH, RAREST, ...GENERA.map(stacker)];

// ---------------------------------------------------------------------------
// Ein Durchgang
// ---------------------------------------------------------------------------

/** Kennzahlen einer Begegnung: Wie „echt“ war die Wahl? (Definition wie scripts/v2/sim.ts) */
export interface DecisionStat {
  /** Stufe, in der die Begegnung stattfand. */
  stage: number;
  /** Harmonie-Gewinn der besten und zweitbesten Karte (je mit bester Platzierung). */
  best: number;
  second: number;
  /** Relativer Wachstumsgewinn der besten Karte. */
  bestGrowth: number;
  /** Karten, die in Harmonie, Wachstum oder Samen von keiner anderen übertroffen werden. */
  pareto: number;
}

/** Zähler eines Durchgangs (kumuliert). */
export interface Counts {
  /** Begegnungen, die der Spieler gesehen hat (ohne automatisch abgelehnte). */
  encounters: number;
  /** … davon „Etwas keimt“ (Pflanzenkarten). */
  plantEncounters: number;
  /** … davon Tierbegegnungen mit mindestens einer Karte, deren Nische voll ist. */
  fullNiche: number;
  rerolls: number;
  declines: number;
  /** Automatisch abgelehnt (keine Art kam in Frage oder Warteschlange voll). */
  autoDeclined: number;
  /** Gewählte Tierkarten je Seltenheit. */
  rarityTaken: number[];
  /** Gewählte Pflanzenkarten (gratis) und mit Samen gesetzte Pflanzen. */
  plantsTaken: number;
  plantsBought: number;
}

/** Schnappschuss des Durchgangs (beim Erreichen einer Stufe oder zu einer festen Zeit). */
export interface Snapshot {
  time: number;
  stage: number;
  harmony: number;
  growth: number;
  seedsRate: number;
  happiness: number;
  animals: number;
  plants: number;
  /** Versorgung V der Begleitpflanzen (0–1). */
  supply: number;
  genus: Record<Genus, number>;
  /** Samen-Bestand. */
  seeds: number;
  /** Bisher verdient: passiv (Baum × Harmonie) und durch (automatisches) Ablehnen. */
  earnedPassive: number;
  earnedDecline: number;
  /** Bisher ausgegeben für Neu würfeln und für Pflanzen. */
  spent: number;
  spentPlants: number;
  counts: Counts;
}

export interface RunResult {
  /** Schnappschuss beim Erreichen jeder Stufe – vor der Wahl an diesem Wegpunkt. */
  stages: (Snapshot | null)[];
  /** Schnappschüsse zu den Zeiten SAMPLE_MINUTES (solange der Durchgang läuft). */
  samples: (Snapshot | null)[];
  /** Wartezeit vor jeder Begegnung, mit der Stufe, in der gewartet wurde. */
  gaps: { stage: number; seconds: number }[];
  decisions: DecisionStat[];
  /** Vielfalt: eine Zeile je Begegnung (erste Ziehung), siehe VarietyStat. */
  variety: VarietyStat[];
  final: Snapshot;
}

/**
 * Vielfalt einer Begegnung (Playtest-Befund „immer dieselben Karten“, DESIGN_V2.md 7.7).
 * Gemessen an der ersten Ziehung, „lohnend“ auch nach Neu würfeln.
 */
export interface VarietyStat {
  stage: number;
  /** Spielzeit (s), zu der die Begegnung aufgelöst wurde. */
  time: number;
  type: PendingEncounterType;
  /** Anzahl Karten der ersten Ziehung. */
  cards: number;
  /** Gleiches Karten-Set wie die vorige Begegnung desselben Typs. */
  sameAsPrevious: boolean;
  /** Warum „Neu würfeln“ bei der ersten Ziehung gesperrt war (null = möglich). */
  rerollBlocked: string | null;
  /** Mindestens eine angebotene Karte verbessert Harmonie oder Wachstum. */
  worthwhile: boolean;
}

export interface RunOptions {
  seed: number;
  /** Simulation endet mit Erreichen dieser Stufe. */
  targetStage: number;
  maxSeconds: number;
}

/** Zeitpunkte (Minuten) für den Samen-Verlauf. */
export const SAMPLE_MINUTES: readonly number[] = [5, 10, 20, 30, 45, 60, 90, 120, 180];

export function runGame(strategy: Strategy, options: RunOptions): RunResult {
  const state = createInitialState(0, options.seed);
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  let time = 0;
  let lastWaypointTime = 0;
  const book = { earnedPassive: 0, earnedDecline: 0, spent: 0, spentPlants: 0 };
  const counts: Counts = {
    encounters: 0,
    plantEncounters: 0,
    fullNiche: 0,
    rerolls: 0,
    declines: 0,
    autoDeclined: 0,
    rarityTaken: [0, 0, 0, 0],
    plantsTaken: 0,
    plantsBought: 0,
  };
  const result: RunResult = {
    stages: Array(STAGES.length).fill(null),
    samples: SAMPLE_MINUTES.map(() => null),
    gaps: [],
    decisions: [],
    variety: [],
    final: null as unknown as Snapshot,
  };
  const snapshot = (): Snapshot => {
    const ev = evaluate(state);
    const genus = Object.fromEntries(GENERA.map((g) => [g, 0])) as Record<Genus, number>;
    for (const id of allAnimals(state)) genus[SPECIES_BY_ID.get(id)!.genus]++;
    return {
      time,
      stage: state.stage,
      harmony: ev.harmony,
      growth: ev.growth,
      seedsRate: ev.seeds,
      happiness: ev.avgHappiness,
      animals: allAnimals(state).length,
      plants: state.plants.length,
      supply: ev.supply,
      genus,
      seeds: state.seeds,
      ...book,
      counts: { ...counts, rarityTaken: [...counts.rarityTaken] },
    };
  };
  result.stages[0] = snapshot();
  let sample = 0;

  while (state.stage < options.targetStage && time < options.maxSeconds && !allWaypointsReached(state)) {
    // Pflanzen setzen, solange es sich lohnt und die Samen reichen.
    for (let plan = planPlant(state, strategy, counts); plan !== null; plan = planPlant(state, strategy, counts)) {
      const cost = nextPlantCost(state);
      if (!plantSeed(state, plan).ok) break;
      book.spentPlants += cost;
      counts.plantsBought++;
    }
    const plan = planPlant(state, strategy, counts);
    const seedsRate = evaluate(state).seeds;
    // Bis die nächste geplante Pflanze bezahlbar ist (+1 µs gegen Rundung).
    const toPlant =
      plan !== null && seedsRate > 0 ? Math.max(0, (nextPlantCost(state) - state.seeds) / seedsRate) + 1e-6 : Infinity;
    const stageBefore = state.stage;
    const nextSample = (SAMPLE_MINUTES[sample] ?? Infinity) * 60;
    const dt = Math.min(secondsToNextWaypoint(state), toPlant, nextSample - time, options.maxSeconds - time);
    if (!(dt < Infinity)) break;
    const seedsBefore = state.seeds;
    const report = tick(state, dt);
    time += dt;
    const autoSeeds = report.autoDeclined * declineReward();
    book.earnedPassive += state.seeds - seedsBefore - autoSeeds;
    book.earnedDecline += autoSeeds;
    counts.autoDeclined += report.autoDeclined;
    if (time >= nextSample - 1e-9) result.samples[sample++] = snapshot();
    if (report.waypoints === 0) continue;
    result.gaps.push({ stage: stageBefore, seconds: time - lastWaypointTime });
    lastWaypointTime = time;
    for (let s = stageBefore + 1; s <= state.stage; s++) result.stages[s] = snapshot();
    resolveAll(state, strategy, rng, counts, book, result.decisions, result.variety, time);
  }
  result.final = snapshot();
  return result;
}

/**
 * Welche Pflanze würde die Strategie als Nächstes setzen? null, wenn der Ring voll ist,
 * nichts freigeschaltet ist oder (bei bewertenden Strategien) keine Pflanze verbessert.
 * Der Zufallsspieler nimmt eine je Zustand feste, aber beliebige Pflanze (wie scripts/v2/sim.ts).
 */
function planPlant(state: GameState, strategy: Strategy, counts: Counts): string | null {
  if (state.plants.length >= plantSlots(state.stage)) return null;
  const pool = unlockedPlants(state);
  if (pool.length === 0) return null;
  if (!strategy.plantValue) return pool[(counts.plantsBought * 7 + state.waypoint) % pool.length]!;
  const now = strategy.plantValue(evaluate(state));
  let top: { id: string; value: number } | null = null;
  for (const id of pool) {
    const ev = previewPlant(state, id);
    if (!ev) continue;
    const value = strategy.plantValue(ev);
    if (value > now + 1e-9 && (!top || value > top.value)) top = { id, value };
  }
  return top?.id ?? null;
}

function resolveAll(
  state: GameState,
  strategy: Strategy,
  rng: RngHolder,
  counts: Counts,
  book: { earnedDecline: number; spent: number },
  decisions: DecisionStat[],
  variety: VarietyStat[],
  time: number,
): void {
  // Schutz gegen Endlosschleifen: jede Strategie würfelt höchstens einmal je Begegnung.
  for (let guard = 0; state.pendingEncounters.length > 0 && guard < 50; guard++) {
    const enc = state.pendingEncounters[0]!;
    const current = evaluate(state);
    const options = optionsFor(state);
    const improves = options.some((o) => o.ev.harmony > current.harmony + 1e-9 || o.ev.growth > current.growth + 1e-9);
    if (enc.rerolls === 0) {
      variety.push({
        stage: state.stage,
        time,
        type: enc.type,
        cards: enc.cards.length,
        sameAsPrevious: sameCards(lastCards.get(variety) ?? {}, enc.type, enc.cards),
        rerollBlocked: rerollBlocker(state, 0),
        worthwhile: improves,
      });
      rememberCards(variety, enc.type, enc.cards);
      counts.encounters++;
      if (enc.type === 'plant') counts.plantEncounters++;
      else if (enc.cards.some((_, c) => cardStatus(state, 0, c) === 'full')) counts.fullNiche++;
    }
    else if (improves) variety[variety.length - 1]!.worthwhile = true;
    recordDecision(state, options, current, decisions);
    const action = strategy.decide(state, options, current, rng);
    const before = state.seeds;
    if (action.kind === 'reroll' && rerollEncounter(state, 0).ok) {
      counts.rerolls++;
      book.spent += before - state.seeds;
      continue;
    }
    if (action.kind === 'choose') {
      const { option } = action;
      if (!chooseCard(state, 0, option.card, option.replace).ok) {
        throw new Error(`Ungültige Wahl ${option.id} (${strategy.id})`);
      }
      if (option.kind === 'plant') counts.plantsTaken++;
      else counts.rarityTaken[SPECIES_BY_ID.get(option.id)!.rarity]!++;
    } else {
      declineEncounter(state, 0);
      counts.declines++;
      book.earnedDecline += state.seeds - before;
    }
  }
}

/** Letztes Karten-Set je Begegnungstyp, je Durchgang (am variety-Array festgemacht). */
const lastCards = new WeakMap<VarietyStat[], Partial<Record<PendingEncounterType, string[]>>>();

function rememberCards(variety: VarietyStat[], type: PendingEncounterType, cards: readonly string[]): void {
  const map = lastCards.get(variety) ?? {};
  map[type] = [...cards];
  lastCards.set(variety, map);
}

function sameCards(
  map: Partial<Record<PendingEncounterType, string[]>>,
  type: PendingEncounterType,
  cards: readonly string[],
): boolean {
  const prev = map[type];
  return !!prev && prev.length === cards.length && cards.every((c) => prev.includes(c));
}

function recordDecision(state: GameState, options: Option[], current: Evaluation, decisions: DecisionStat[]): void {
  const cards = state.pendingEncounters[0]!.cards;
  const perCard = cards
    .map((_, i) => {
      const mine = options.filter((o) => o.card === i);
      if (mine.length === 0) return null;
      // Jede Karte mit ihrer besten Platzierung (nach Harmonie).
      const o = mine.reduce((a, b) => (b.ev.harmony > a.ev.harmony ? b : a));
      return {
        h: o.ev.harmony - current.harmony,
        g: o.ev.growth / current.growth - 1,
        s: o.ev.seeds / Math.max(current.seeds, 1e-9) - 1,
      };
    })
    .filter((c): c is { h: number; g: number; s: number } => c !== null);
  if (perCard.length < 2) return;
  const hs = perCard.map((c) => c.h).sort((a, b) => b - a);
  const eps = 1e-9;
  // Pareto-Front über (Harmonie, Wachstum, Samen): Karten, die keine andere klar übertrifft.
  const front = perCard.filter(
    (c) =>
      !perCard.some(
        (d) =>
          d !== c &&
          d.h >= c.h - eps &&
          d.g >= c.g - eps &&
          d.s >= c.s - eps &&
          (d.h > c.h + eps || d.g > c.g + eps || d.s > c.s + eps),
      ),
  );
  decisions.push({
    stage: state.stage,
    best: hs[0]!,
    second: hs[1]!,
    bestGrowth: Math.max(...perCard.map((c) => c.g)),
    pareto: front.length,
  });
}

// ---------------------------------------------------------------------------
// Monte Carlo und Auswertung
// ---------------------------------------------------------------------------

export interface Summary {
  strategy: Strategy;
  runs: RunResult[];
}

export function monteCarlo(
  strategies: readonly Strategy[],
  runs: number,
  options: Omit<RunOptions, 'seed'>,
): Summary[] {
  return strategies.map((strategy) => ({
    strategy,
    runs: Array.from({ length: runs }, (_, i) => runGame(strategy, { ...options, seed: 1000 + 7 * i })),
  }));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : values.reduce((s, v) => s + v, 0) / values.length;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')} h`;
}

const fmt = (x: number, digits = 0) => (Number.isFinite(x) ? x.toFixed(digits).replace('.', ',') : '–');

const snapshotsAt = (summary: Summary, stage: number): Snapshot[] =>
  summary.runs.map((r) => r.stages[stage]).filter((s): s is Snapshot => s != null);

/** Kennzahlen einer Strategie beim Erreichen einer Stufe. */
export function stageStats(summary: Summary, stage: number) {
  const reached = snapshotsAt(summary, stage);
  const times = reached.map((s) => s.time);
  // Takt: Wartezeit vor den Begegnungen, die WÄHREND dieser Stufe erreicht werden.
  const gaps = summary.runs.flatMap((r) => r.gaps.filter((g) => g.stage === stage).map((g) => g.seconds));
  const m = (f: (s: Snapshot) => number) => mean(reached.map(f));
  return {
    reachedShare: reached.length / summary.runs.length,
    time: median(times),
    timeP10: quantile(times, 0.1),
    timeP90: quantile(times, 0.9),
    harmony: m((s) => s.harmony),
    growth: m((s) => s.growth),
    seedsRate: m((s) => s.seedsRate),
    happiness: m((s) => s.happiness),
    animals: m((s) => s.animals),
    plants: m((s) => s.plants),
    supply: m((s) => s.supply),
    genus: GENERA.map((g) => m((s) => s.genus[g])),
    seeds: m((s) => s.seeds),
    earnedPassive: m((s) => s.earnedPassive),
    earnedDecline: m((s) => s.earnedDecline),
    spent: m((s) => s.spent),
    spentPlants: m((s) => s.spentPlants),
    counts: {
      encounters: m((s) => s.counts.encounters),
      plantEncounters: m((s) => s.counts.plantEncounters),
      plantsTaken: m((s) => s.counts.plantsTaken),
      plantsBought: m((s) => s.counts.plantsBought),
      fullNiche: m((s) => s.counts.fullNiche),
      rerolls: m((s) => s.counts.rerolls),
      declines: m((s) => s.counts.declines),
      autoDeclined: m((s) => s.counts.autoDeclined),
      rarityTaken: [0, 1, 2, 3].map((i) => m((s) => s.counts.rarityTaken[i]!)),
    },
    gapMedian: median(gaps),
    gapMax: gaps.length > 0 ? Math.max(...gaps) : NaN,
    gapsPerRun: gaps.length / summary.runs.length,
  };
}

/** „Knapp“: Abstand der zwei besten Karten höchstens 2 Harmonie oder 30 %. */
export const CLOSE_ABSOLUTE = 2;
export const CLOSE_RELATIVE = 0.3;

/** Wie „echt“ ist die Wahl in den Begegnungen vor Erreichen von `beforeStage`? */
export function decisionStats(summary: Summary, beforeStage: number) {
  const ds = summary.runs.flatMap((r) => r.decisions.filter((d) => d.stage < beforeStage));
  const n = Math.max(1, ds.length);
  const close = (d: DecisionStat) => d.best - d.second <= Math.max(CLOSE_ABSOLUTE, CLOSE_RELATIVE * Math.abs(d.best));
  const worthIt = (d: DecisionStat) => d.best > 0 || d.bestGrowth > 0;
  return {
    /** Begegnungen (inkl. neu gewürfelter Karten) mit mindestens zwei spielbaren Karten. */
    count: ds.length,
    /** Echte Wahl: Zielkonflikt (Pareto ≥ 2) oder knapp – und mindestens eine Karte lohnt sich. */
    realShare: ds.filter((d) => (d.pareto >= 2 || close(d)) && worthIt(d)).length / n,
    /** Eine Karte ist in allem besser und deutlich vorn. */
    obviousShare: ds.filter((d) => d.pareto < 2 && !close(d)).length / n,
    /** Keine Karte verbessert Harmonie oder Wachstum. */
    allBadShare: ds.filter((d) => !worthIt(d)).length / n,
  };
}

/**
 * Vielfalt der Begegnungen in Stufe `stage` (Begegnungen, die in dieser Stufe stattfanden).
 * Durststrecke: Zeit seit der letzten lohnenden Begegnung (bzw. Spielstart), gemessen an
 * jeder lohnenden Begegnung dieser Stufe und am Ende der Stufe (Erreichen der nächsten).
 */
export function varietyStats(summary: Summary, stage: number) {
  const vs = summary.runs.flatMap((r) => r.variety.filter((v) => v.stage === stage));
  const n = Math.max(1, vs.length);
  const droughts = summary.runs.map((r) => longestDrought(r, stage)).filter((d): d is number => d !== null);
  const share = (f: (v: VarietyStat) => boolean) => vs.filter(f).length / n;
  return {
    count: vs.length,
    sameShare: share((v) => v.sameAsPrevious),
    sameAnimalShare:
      vs.filter((v) => v.type === 'animal' && v.sameAsPrevious).length / Math.max(1, vs.filter((v) => v.type === 'animal').length),
    samePlantShare:
      vs.filter((v) => v.type === 'plant' && v.sameAsPrevious).length / Math.max(1, vs.filter((v) => v.type === 'plant').length),
    fewCardsShare: share((v) => v.cards <= 2),
    rerollOpenShare: share((v) => v.rerollBlocked === null),
    rerollTooExpensiveShare: share((v) => v.rerollBlocked === 'too-expensive'),
    rerollNoAltShare: share((v) => v.rerollBlocked === 'no-alternatives' || v.rerollBlocked === 'no-cards'),
    worthShare: share((v) => v.worthwhile),
    /** Längste Durststrecke je Durchgang (s): Median, 90-%-Quantil, Maximum. */
    droughtMedian: median(droughts),
    droughtP90: quantile(droughts, 0.9),
    droughtMax: droughts.length > 0 ? Math.max(...droughts) : NaN,
  };
}

/** Längste Strecke (s) ohne lohnende Begegnung, die in Stufe `stage` endet; null, wenn die Stufe nie lief. */
export function longestDrought(run: RunResult, stage: number): number | null {
  const start = run.stages[stage]?.time;
  if (start === undefined) return null;
  const end = run.stages[stage + 1]?.time ?? run.final.time;
  let last = 0;
  let longest = 0;
  for (const v of run.variety) {
    if (!v.worthwhile) continue;
    if (v.time > start && v.time <= end) longest = Math.max(longest, v.time - last);
    if (v.time > end) break;
    last = v.time;
  }
  // Strecke, die beim Erreichen der nächsten Stufe noch läuft.
  return Math.max(longest, end - last);
}

/** Vielfalt aller Begegnungen vor Erreichen von `beforeStage` (Ziele: DESIGN_V2.md 7.7). */
export function varietyBefore(summary: Summary, beforeStage: number) {
  const vs = summary.runs.flatMap((r) => r.variety.filter((v) => v.stage < beforeStage));
  const n = Math.max(1, vs.length);
  const share = (f: (v: VarietyStat) => boolean) => vs.filter(f).length / n;
  // Längste Durststrecke je Durchgang über alle Stufen vor `beforeStage`.
  const droughts = summary.runs.map((r) => {
    const ds = Array.from({ length: beforeStage - 1 }, (_, i) => longestDrought(r, i + 1) ?? 0);
    return Math.max(0, ...ds);
  });
  return {
    sameShare: share((v) => v.sameAsPrevious),
    /** Ab Setzling (im Keimling gibt es nur 2 Pflanzen und 3 Arten – gewollt). */
    fewCardsShare: vs.filter((v) => v.stage >= 2 && v.cards <= 2).length / Math.max(1, vs.filter((v) => v.stage >= 2).length),
    rerollOpenShare: share((v) => v.rerollBlocked === null),
    worthShare: share((v) => v.worthwhile),
    droughtMedian: median(droughts),
    droughtP90: quantile(droughts, 0.9),
    droughtMax: Math.max(...droughts),
  };
}

export function varietyTable(summary: Summary, upTo: number): string {
  const lines = [
    '| Stufe | Begegnungen | gleiches Set wie vorige (Tier / Pflanze) | nur 1–2 Karten | Neu würfeln möglich | gesperrt: zu teuer / keine Alternative | lohnend | längste Durststrecke Median / 90 % / max |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (let s = 1; s <= upTo; s++) {
    const v = varietyStats(summary, s);
    if (v.count === 0) continue;
    const pct = (x: number) => `${fmt(x * 100)} %`;
    lines.push(
      `| ${STAGES[s]!.name} | ${fmt(v.count / summary.runs.length, 1)} | ${pct(v.sameShare)} (${pct(v.sameAnimalShare)} / ${pct(v.samePlantShare)}) | ${pct(v.fewCardsShare)} | ${pct(v.rerollOpenShare)} | ${pct(v.rerollTooExpensiveShare)} / ${pct(v.rerollNoAltShare)} | ${pct(v.worthShare)} | ${formatTime(v.droughtMedian)} / ${formatTime(v.droughtP90)} / ${formatTime(v.droughtMax)} |`,
    );
  }
  return lines.join('\n');
}

export function strategyTable(summaries: Summary[], stage: number): string {
  const name = STAGES[stage]!.name;
  const lines = [
    `| Strategie | ${name} nach (Median) | ⚖️ Harmonie | 🌿/s | 🌰/s | Ø Zufriedenheit | Tiere ${GENERA.map((g) => GENUS_INFO[g].icon).join('/')} | Pflanzen | Versorgung | echte Wahl |`,
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const st = stageStats(s, stage);
    const d = decisionStats(s, stage);
    lines.push(
      `| ${s.strategy.name} | ${formatTime(st.time)} | ${fmt(st.harmony, 1)} | ${fmt(st.growth, 1)} | ${fmt(st.seedsRate, 2)} | ${fmt(st.happiness * 100)} % | ${st.genus.map((g) => fmt(g, 1)).join(' / ')} | ${fmt(st.plants, 1)} | ${fmt(st.supply * 100)} % | ${fmt(d.realShare * 100)} % |`,
    );
  }
  return lines.join('\n');
}

export function stageTable(summary: Summary, targets: readonly (string | null)[]): string {
  const lines = [
    '| Stufe | Ziel | Median | 10–90 % | ⚖️ | 🌿/s | 🌰/s | Ø Zufr. | Tiere / Pflanzen | Begegnungen im Abschnitt | Takt Median | Takt max |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (let s = 1; s < STAGES.length; s++) {
    const st = stageStats(summary, s);
    if (st.reachedShare === 0) continue;
    const share = st.reachedShare < 1 ? ` (${fmt(st.reachedShare * 100)} % erreicht)` : '';
    lines.push(
      `| ${STAGES[s]!.name}${share} | ${targets[s] ?? '–'} | ${formatTime(st.time)} | ${formatTime(st.timeP10)} – ${formatTime(st.timeP90)} | ${fmt(st.harmony)} | ${fmt(st.growth, 1)} | ${fmt(st.seedsRate, 2)} | ${fmt(st.happiness * 100)} % | ${fmt(st.animals, 1)} / ${fmt(st.plants, 1)} | ${fmt(st.gapsPerRun, 1)} | ${formatTime(st.gapMedian)} | ${formatTime(st.gapMax)} |`,
    );
  }
  return lines.join('\n');
}

/** Samen-Verlauf über die Spielzeit (Mittel über alle Durchgänge, die so lange liefen). */
export function seedTable(summary: Summary): string {
  const lines = [
    '| Zeit | Stufe (Median) | Bestand 🌰 | verdient passiv | verdient Ablehnen | ausgegeben Pflanzen | ausgegeben Neu würfeln | Pflanzen (gesetzt / gekeimt) | Bestand in Minuten Produktion |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  SAMPLE_MINUTES.forEach((minutes, i) => {
    const xs = summary.runs.map((r) => r.samples[i]).filter((s): s is Snapshot => s != null);
    if (xs.length < summary.runs.length / 2) return;
    const m = (f: (s: Snapshot) => number) => mean(xs.map(f));
    const stage = STAGES[Math.round(median(xs.map((s) => s.stage)))]!.name;
    lines.push(
      `| ${minutes} min | ${stage} | ${fmt(m((s) => s.seeds))} | ${fmt(m((s) => s.earnedPassive))} | ${fmt(m((s) => s.earnedDecline))} | ${fmt(m((s) => s.spentPlants))} | ${fmt(m((s) => s.spent))} | ${fmt(m((s) => s.counts.plantsBought), 1)} / ${fmt(m((s) => s.counts.plantsTaken), 1)} | ${fmt(m((s) => s.seeds) / Math.max(m((s) => s.seedsRate), 1e-9) / 60, 1)} |`,
    );
  });
  return lines.join('\n');
}

export function miscTable(summaries: Summary[], stage: number): string {
  const lines = [
    '| Strategie | Begegnungen | davon Pflanzen | Tier: Nische voll | neu gewürfelt | abgelehnt | autom. abgelehnt | gewählt g / s / b / l | Pflanzen gekeimt / gesetzt | eindeutig | keine Karte lohnt |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const c = stageStats(s, stage).counts;
    const d = decisionStats(s, stage);
    lines.push(
      `| ${s.strategy.name} | ${fmt(c.encounters, 1)} | ${fmt(c.plantEncounters, 1)} | ${fmt(c.fullNiche, 1)} | ${fmt(c.rerolls, 1)} | ${fmt(c.declines, 1)} | ${fmt(c.autoDeclined, 1)} | ${c.rarityTaken.map((x) => fmt(x, 1)).join(' / ')} | ${fmt(c.plantsTaken, 1)} / ${fmt(c.plantsBought, 1)} | ${fmt(d.obviousShare * 100)} % | ${fmt(d.allBadShare * 100)} % |`,
    );
  }
  return lines.join('\n');
}

/** Zielzeiten (DESIGN_V2.md, Abschnitt 3 und 15.4) für den harmonie-orientierten Spieler. */
export const STAGE_TARGETS: readonly { stage: number; seconds: number; label: string }[] = [
  { stage: 1, seconds: 30, label: '< 30 s' },
  { stage: 2, seconds: 60, label: '~ 1 min' },
  { stage: 3, seconds: 4 * 60, label: '~ 4 min' },
  { stage: 4, seconds: 20 * 60, label: '~ 20 min' },
  { stage: 5, seconds: 60 * 60, label: '~ 60 min' },
];

export const TARGET_LABELS: readonly (string | null)[] = STAGES.map(
  (_, s) => STAGE_TARGETS.find((t) => t.stage === s)?.label ?? null,
);

/** Vollständiger Bericht als Markdown (Protokoll und DESIGN_V2.md 15.4). */
export function report(summaries: Summary[], focusStage: number): string {
  const harmony = summaries.find((s) => s.strategy.id === 'harmony') ?? summaries[0]!;
  const random = summaries.find((s) => s.strategy.id === 'random');
  const name = STAGES[focusStage]!.name;
  return [
    `#### Strategien beim Erreichen von „${name}“ (${harmony.runs.length} Durchgänge je Strategie)`,
    '',
    strategyTable(summaries, focusStage),
    '',
    '#### Stufen und Takt – Gierig nach Harmonie',
    '',
    stageTable(harmony, TARGET_LABELS),
    ...(random ? ['', '#### Stufen und Takt – Zufällig', '', stageTable(random, TARGET_LABELS)] : []),
    '',
    '#### Samen über die Zeit – Gierig nach Harmonie',
    '',
    seedTable(harmony),
    ...(random ? ['', '#### Samen über die Zeit – Zufällig', '', seedTable(random)] : []),
    '',
    `#### Vielfalt der Begegnungen – Gierig nach Harmonie`,
    '',
    varietyTable(harmony, STAGES.length - 2),
    ...(random ? ['', '#### Vielfalt der Begegnungen – Zufällig', '', varietyTable(random, STAGES.length - 2)] : []),
    '',
    `#### Begegnungen bis ${name} (Mittel je Durchgang)`,
    '',
    miscTable(summaries, focusStage),
  ].join('\n');
}
