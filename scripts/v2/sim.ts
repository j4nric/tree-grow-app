/**
 * Design v2 – Monte-Carlo-Prototyp. Spielt viele Durchgänge mit verschiedenen
 * Kartenwahl-Strategien und misst Harmonie, Wachstum, Takt der Begegnungen,
 * Zeit bis zu den Stufen und wie „echt“ die Wahl zwischen den Karten ist.
 *
 * Vereinfachungen gegenüber dem Design (docs/DESIGN_V2.md, Abschnitt „Simulation“):
 * keine Pflegemaßnahmen, kein Prestige, der Spieler entscheidet sofort (online).
 * Zeit läuft ereignisgesteuert: Zwischen zwei Entscheidungen sind die Raten konstant.
 *
 * Ausführen: npx vitest run tests/design-v2.test.ts --silent=false
 */
import {
  CARDS_PER_ENCOUNTER,
  DECLINE_SEED_SHARE,
  ENCOUNTER_WEIGHTS,
  EVENTS,
  GENERA,
  GENUS_NAMES,
  PLANTS,
  PLANT_SLOTS,
  RARITY_WEIGHTS,
  REROLL_COST_SHARE,
  SCRIPTED_ENCOUNTERS,
  SPECIES,
  STAGE_NAMES,
  STAGE_WAYPOINTS,
  VISITORS,
  VISITOR_WAYPOINTS,
  plantCost,
  waypointThreshold,
  type EncounterType,
  type Genus,
  type Species,
} from './content';
import {
  allAnimals,
  appearsIn,
  cloneEco,
  emptyEco,
  evaluate,
  isValid,
  nicheSlots,
  speciesOf,
  type Eco,
  type Evaluation,
} from './model';
import { Rng } from './rng';

// ---------------------------------------------------------------------------
// Begegnungen und Optionen
// ---------------------------------------------------------------------------

export type Card =
  | { kind: 'animal'; id: string }
  | { kind: 'plant'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'visitor'; id: string };

export interface Encounter {
  type: EncounterType;
  cards: Card[];
}

export interface Option {
  /** Index der Karte oder −1 für „Ablehnen“. */
  card: number;
  label: string;
  eco: Eco;
  seeds: number;
  ev: Evaluation;
}

export interface RunState {
  eco: Eco;
  rng: Rng;
  time: number;
  totalGrowth: number;
  seeds: number;
  waypoint: number;
  plantsBought: number;
  rerollsThisEncounter: number;
  eventsSeen: string[];
}

function stageForWaypoint(wp: number): number {
  let s = 0;
  for (let i = 0; i < STAGE_WAYPOINTS.length; i++) if (wp >= STAGE_WAYPOINTS[i]!) s = i;
  return s;
}

function rarityBoost(eco: Eco): number {
  return allAnimals(eco).includes('flyagaric') ? 5 : 0;
}

/** Zieht bis zu drei verschiedene Tierkarten nach Seltenheitsgewichten. */
export function drawAnimals(eco: Eco, rng: Rng, count: number): Card[] {
  const slots = nicheSlots(eco);
  const present = new Set(allAnimals(eco));
  const eligible = SPECIES.filter(
    (s) => s.unlock <= eco.stage && slots[s.niche] > 0 && !present.has(s.id) && appearsIn(eco, s),
  );
  const cards: Card[] = [];
  const boost = rarityBoost(eco);
  const base = RARITY_WEIGHTS[eco.stage]!;
  const weights = [base[0] - 3 * boost, base[1] + boost, base[2] + boost, base[3] + boost];
  const taken = new Set<string>();
  for (let i = 0; i < count; i++) {
    const byRarity = [0, 1, 2, 3].map((r) => eligible.filter((s) => s.rarity === r && !taken.has(s.id)));
    const r = rng.weighted(weights.map((w, idx) => (byRarity[idx]!.length > 0 ? w : 0)));
    if (r < 0) break;
    const sp = rng.pick(byRarity[r]!);
    taken.add(sp.id);
    cards.push({ kind: 'animal', id: sp.id });
  }
  return cards;
}

export function drawPlants(eco: Eco, rng: Rng, count: number): Card[] {
  const pool = PLANTS.filter((p) => p.unlock <= eco.stage).map((p) => p.id);
  const cards: Card[] = [];
  while (cards.length < count && pool.length > 0) {
    const i = rng.int(pool.length);
    cards.push({ kind: 'plant', id: pool[i]! });
    pool.splice(i, 1);
  }
  return cards;
}

export function drawEncounter(run: RunState): Encounter {
  const { eco, rng } = run;
  let type: EncounterType = SCRIPTED_ENCOUNTERS[run.waypoint - 1] ?? (['animal', 'plant', 'event', 'visitor'] as const)[rng.weighted(ENCOUNTER_WEIGHTS[eco.stage]!)]!;
  if (type === 'event') {
    const events = EVENTS.filter((e) => e.unlock <= eco.stage && !run.eventsSeen.includes(e.id));
    if (events.length === 0) type = 'animal';
    else {
      // Jedes Ereignis höchstens einmal pro Zyklus.
      const event = rng.pick(events);
      run.eventsSeen.push(event.id);
      return { type, cards: [{ kind: 'event', id: event.id }] };
    }
  }
  if (type === 'visitor') return { type, cards: [{ kind: 'visitor', id: rng.pick(VISITORS).id }] };
  if (type === 'plant') return { type, cards: drawPlants(eco, rng, CARDS_PER_ENCOUNTER) };
  const cards = drawAnimals(eco, rng, CARDS_PER_ENCOUNTER);
  if (cards.length === 0) return { type: 'plant', cards: drawPlants(eco, rng, CARDS_PER_ENCOUNTER) };
  return { type, cards };
}

/** Alle Möglichkeiten, eine Begegnung aufzulösen (inkl. Ablehnen). */
export function optionsFor(run: RunState, enc: Encounter): Option[] {
  const { eco } = run;
  const options: Option[] = [];
  const nextPlant = plantCost(run.eco.plants.length);
  const push = (card: number, label: string, next: Eco, seeds = 0) => {
    if (!isValid(next)) return;
    options.push({ card, label, eco: next, seeds, ev: evaluate(next) });
  };
  enc.cards.forEach((card, i) => {
    if (card.kind === 'animal') {
      const sp = speciesOf(card.id);
      const slots = nicheSlots(eco)[sp.niche];
      const occupants = eco.animals[sp.niche];
      if (occupants.length < slots) {
        const next = cloneEco(eco);
        next.animals[sp.niche].push(sp.id);
        push(i, `${sp.name} zieht ein`, next);
      } else {
        for (const old of occupants) {
          const next = cloneEco(eco);
          next.animals[sp.niche] = occupants.map((x) => (x === old ? sp.id : x));
          push(i, `${sp.name} statt ${speciesOf(old).name}`, next);
        }
      }
    } else if (card.kind === 'plant') {
      const slots = PLANT_SLOTS[eco.stage] ?? 0;
      if (eco.plants.length < slots) {
        const next = cloneEco(eco);
        next.plants.push(card.id);
        push(i, `${card.id} keimt`, next);
      } else {
        for (const old of new Set(eco.plants)) {
          const next = cloneEco(eco);
          next.plants[next.plants.indexOf(old)] = card.id;
          push(i, `${card.id} statt ${old}`, next);
        }
      }
    } else if (card.kind === 'event') {
      const event = EVENTS.find((e) => e.id === card.id)!;
      const next = cloneEco(eco);
      next.envTags.push(...event.keep.tags);
      next.envEffects.push(...event.keep.effects);
      push(i, event.keep.label, next);
      push(-1, event.take.label, cloneEco(eco), event.take.seedShare * nextPlant);
      return;
    } else {
      const next = cloneEco(eco);
      next.visitors.push({ id: card.id, until: run.waypoint + VISITOR_WAYPOINTS });
      push(i, `${card.id} rastet`, next);
    }
  });
  if (enc.type !== 'event') push(-1, 'Ablehnen', cloneEco(eco), DECLINE_SEED_SHARE * nextPlant);
  return options;
}

// ---------------------------------------------------------------------------
// Strategien
// ---------------------------------------------------------------------------

export type Choice = number | 'reroll';

export interface Strategy {
  id: string;
  name: string;
  /** Wählt eine Option (Index) oder würfelt neu. */
  choose(run: RunState, enc: Encounter, options: Option[], current: Evaluation): Choice;
  /** Bewertung für das Setzen von Pflanzen mit Samen (höher = besser), null = zufällig. */
  plantValue: ((ev: Evaluation) => number) | null;
}

const byHarmony = (ev: Evaluation) => ev.harmony + 1e-6 * ev.growth;
const byYield = (ev: Evaluation) => ev.growth + 1e-6 * ev.harmony;

function argmax(options: Option[], value: (o: Option) => number): number {
  let best = -1;
  let bestValue = -Infinity;
  options.forEach((o, i) => {
    const v = value(o);
    if (v > bestValue) {
      bestValue = v;
      best = i;
    }
  });
  return best;
}

function canReroll(run: RunState): boolean {
  return run.rerollsThisEncounter < 1 && run.seeds >= rerollCost(run);
}

export function rerollCost(run: RunState): number {
  return REROLL_COST_SHARE * plantCost(run.eco.plants.length) * Math.pow(2, run.rerollsThisEncounter);
}

function greedy(id: string, name: string, value: (ev: Evaluation) => number): Strategy {
  return {
    id,
    name,
    plantValue: value,
    choose(run, enc, options, current) {
      const best = argmax(options, (o) => value(o.ev));
      const takesCard = options[best]!.card >= 0;
      if (enc.type === 'animal' && (!takesCard || value(options[best]!.ev) <= value(current)) && canReroll(run)) return 'reroll';
      return best;
    },
  };
}

export const RANDOM: Strategy = {
  id: 'random',
  name: 'Zufällig',
  plantValue: null,
  choose(run, enc, options) {
    const cardIdx = run.rng.int(enc.cards.length);
    const forCard = options.filter((o) => o.card === cardIdx);
    if (forCard.length === 0) return options.length - 1;
    if (forCard.length === 1 || enc.type === 'event') return options.indexOf(run.rng.pick(enc.type === 'event' ? options : forCard));
    // Volle Nische: zufällig ersetzen oder ablehnen.
    const pool = [...forCard, options[options.length - 1]!];
    return options.indexOf(run.rng.pick(pool));
  },
};

export const HARMONY = greedy('harmony', 'Gierig nach Harmonie', byHarmony);
export const YIELD = greedy('yield', 'Gierig nach Wachstum', byYield);

export const RAREST: Strategy = {
  id: 'rarest',
  name: 'Immer die seltenste Karte',
  plantValue: byHarmony,
  choose(run, enc, options, current) {
    if (enc.type !== 'animal') return HARMONY.choose(run, enc, options, current);
    const rarity = (o: Option) => (o.card >= 0 ? speciesOf((enc.cards[o.card] as { id: string }).id).rarity : -1);
    const top = Math.max(...options.map(rarity));
    return argmax(options, (o) => (rarity(o) === top ? byHarmony(o.ev) : -Infinity));
  },
};

export function stacker(genus: Genus): Strategy {
  return {
    id: `stack-${genus}`,
    name: `${GENUS_NAMES[genus]} stapeln`,
    plantValue: byHarmony,
    choose(run, enc, options, current) {
      if (enc.type !== 'animal') return HARMONY.choose(run, enc, options, current);
      const matches = (o: Option) => o.card >= 0 && speciesOf((enc.cards[o.card] as { id: string }).id).genus === genus;
      // Keine passende Karte: einmal neu würfeln, sonst wie der Harmonie-Spieler.
      if (!options.some(matches)) return canReroll(run) ? 'reroll' : argmax(options, (o) => byHarmony(o.ev));
      // Lieber einen Fremden ersetzen als einen eigenen.
      const own = (o: Option) => allAnimals(o.eco).filter((id) => speciesOf(id).genus === genus).length;
      return argmax(options, (o) => (matches(o) ? own(o) * 1000 + byHarmony(o.ev) : -Infinity));
    },
  };
}

export const STRATEGIES: readonly Strategy[] = [RANDOM, HARMONY, YIELD, RAREST, ...GENERA.map(stacker)];

// ---------------------------------------------------------------------------
// Ein Durchgang
// ---------------------------------------------------------------------------

export interface DecisionStat {
  /** Harmonie-Gewinn der besten und zweitbesten Karte (je mit bester Platzierung). */
  best: number;
  second: number;
  /** Relativer Wachstumsgewinn der besten und zweitbesten Karte. */
  bestGrowth: number;
  secondGrowth: number;
  /** Anzahl der Karten, die in Harmonie, Wachstum oder Samen von keiner anderen übertroffen werden. */
  pareto: number;
}

export interface RunResult {
  stageTimes: (number | null)[];
  stageHarmony: (number | null)[];
  stageGrowth: (number | null)[];
  stageSeeds: (number | null)[];
  /** Tiere und Begleitpflanzen beim Erreichen der Stufe. */
  stageAnimals: (number | null)[];
  stagePlants: (number | null)[];
  finalEco: Eco;
  /** Wartezeit vor jeder Begegnung, mit der Stufe, in der gewartet wurde. */
  gaps: { stage: number; seconds: number }[];
  decisions: DecisionStat[];
  fullNiche: number;
  animalEncounters: number;
  rerolls: number;
  declines: number;
  rareTaken: number[];
  finalHarmony: number;
  finalGrowth: number;
  finalHappiness: number;
  genusCounts: Record<Genus, number>;
  communities: number;
  time: number;
}

export interface RunOptions {
  seed: number;
  /** Simulation endet mit Erreichen dieser Stufe. */
  targetStage: number;
  maxSeconds: number;
}

export function runGame(strategy: Strategy, options: RunOptions): RunResult {
  const run: RunState = {
    eco: emptyEco(),
    rng: new Rng(options.seed * 2654435761),
    time: 0,
    totalGrowth: 0,
    seeds: 0,
    waypoint: 0,
    plantsBought: 0,
    rerollsThisEncounter: 0,
    eventsSeen: [],
  };
  const n = STAGE_NAMES.length;
  const result: RunResult = {
    stageTimes: Array(n).fill(null),
    stageHarmony: Array(n).fill(null),
    stageGrowth: Array(n).fill(null),
    stageSeeds: Array(n).fill(null),
    stageAnimals: Array(n).fill(null),
    stagePlants: Array(n).fill(null),
    finalEco: run.eco,
    gaps: [],
    decisions: [],
    fullNiche: 0,
    animalEncounters: 0,
    rerolls: 0,
    declines: 0,
    rareTaken: [0, 0, 0, 0],
    finalHarmony: 0,
    finalGrowth: 0,
    finalHappiness: 0,
    genusCounts: { birds: 0, insects: 0, mammals: 0, soil: 0, fungi: 0 },
    communities: 0,
    time: 0,
  };
  result.stageTimes[0] = 0;
  let lastEncounter = 0;
  const targetWaypoint = STAGE_WAYPOINTS[options.targetStage]!;

  while (run.waypoint < targetWaypoint && run.time < options.maxSeconds) {
    const ev = evaluate(run.eco);
    const toWaypoint = (waypointThreshold(run.waypoint + 1) - run.totalGrowth) / ev.growth;
    const plan = planPlant(run, strategy, ev);
    const toPlant = plan ? Math.max(0, (plan.cost - run.seeds) / Math.max(ev.seeds, 1e-9)) : Infinity;
    const dt = Math.min(toWaypoint, toPlant);
    run.time += dt;
    run.totalGrowth += ev.growth * dt;
    run.seeds += ev.seeds * dt;

    if (plan && toPlant <= toWaypoint) {
      run.seeds = Math.max(0, run.seeds - plan.cost);
      run.eco.plants.push(plan.id);
      run.plantsBought++;
      continue;
    }

    // Wegpunkt erreicht
    run.waypoint++;
    result.gaps.push({ stage: run.eco.stage, seconds: run.time - lastEncounter });
    lastEncounter = run.time;
    const stage = stageForWaypoint(run.waypoint);
    if (stage > run.eco.stage) {
      for (let s = run.eco.stage + 1; s <= stage; s++) result.stageTimes[s] = run.time;
      run.eco.stage = stage;
      const atStage = evaluate(run.eco);
      result.stageHarmony[stage] = atStage.harmony;
      result.stageGrowth[stage] = atStage.growth;
      result.stageSeeds[stage] = atStage.seeds;
      result.stageAnimals[stage] = allAnimals(run.eco).length;
      result.stagePlants[stage] = run.eco.plants.length;
    }
    run.eco.visitors = run.eco.visitors.filter((v) => v.until > run.waypoint);
    resolveEncounter(run, strategy, result);
  }

  const final = evaluate(run.eco);
  result.finalHarmony = final.harmony;
  result.finalGrowth = final.growth;
  result.finalHappiness = final.avgHappiness;
  result.communities = final.communities.length;
  for (const id of allAnimals(run.eco)) result.genusCounts[speciesOf(id).genus]++;
  result.time = run.time;
  result.finalEco = run.eco;
  return result;
}

function planPlant(run: RunState, strategy: Strategy, ev: Evaluation): { id: string; cost: number } | null {
  const eco = run.eco;
  if (eco.plants.length >= (PLANT_SLOTS[eco.stage] ?? 0)) return null;
  const pool = PLANTS.filter((p) => p.unlock <= eco.stage);
  if (pool.length === 0) return null;
  const cost = plantCost(run.eco.plants.length);
  if (!strategy.plantValue) {
    // Zufallsspieler: setzt eine zufällige Pflanze (deterministisch je Zustand gewählt).
    const p = pool[(run.plantsBought * 7 + run.waypoint) % pool.length]!;
    return { id: p.id, cost };
  }
  const now = strategy.plantValue(ev);
  let best: { id: string; value: number } | null = null;
  for (const p of pool) {
    const next = cloneEco(eco);
    next.plants.push(p.id);
    const value = strategy.plantValue(evaluate(next));
    if (value > now + 1e-9 && (!best || value > best.value)) best = { id: p.id, value };
  }
  return best ? { id: best.id, cost } : null;
}

function resolveEncounter(run: RunState, strategy: Strategy, result: RunResult): void {
  run.rerollsThisEncounter = 0;
  let enc = drawEncounter(run);
  for (;;) {
    const current = evaluate(run.eco);
    const options = optionsFor(run, enc);
    if (enc.type === 'animal' || enc.type === 'plant') recordDecision(enc, options, current, result);
    if (enc.type === 'animal' && run.rerollsThisEncounter === 0) {
      result.animalEncounters++;
      if (enc.cards.some((c) => run.eco.animals[speciesOf(c.id).niche].length >= nicheSlots(run.eco)[speciesOf(c.id).niche])) result.fullNiche++;
    }
    const choice = strategy.choose(run, enc, options, current);
    if (choice === 'reroll') {
      run.seeds -= rerollCost(run);
      run.rerollsThisEncounter++;
      result.rerolls++;
      const redrawn = enc.type === 'animal' ? drawAnimals(run.eco, run.rng, CARDS_PER_ENCOUNTER) : drawPlants(run.eco, run.rng, CARDS_PER_ENCOUNTER);
      enc = { type: enc.type, cards: redrawn.length > 0 ? redrawn : enc.cards };
      continue;
    }
    const option = options[choice]!;
    if (option.card < 0 && enc.type !== 'event') result.declines++;
    if (option.card >= 0 && enc.cards[option.card]!.kind === 'animal') {
      result.rareTaken[speciesOf(enc.cards[option.card]!.id).rarity]!++;
    }
    run.eco = option.eco;
    run.seeds += option.seeds;
    return;
  }
}

function recordDecision(enc: Encounter, options: Option[], current: Evaluation, result: RunResult): void {
  if (enc.cards.length < 2) return;
  const perCard = enc.cards
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
  const gs = perCard.map((c) => c.g).sort((a, b) => b - a);
  // Pareto-Front über (Harmonie, Wachstum, Samen): Karten, die keine andere klar übertrifft.
  const eps = 1e-9;
  const front = perCard.filter(
    (c) =>
      !perCard.some(
        (d) => d !== c && d.h >= c.h - eps && d.g >= c.g - eps && d.s >= c.s - eps && (d.h > c.h + eps || d.g > c.g + eps || d.s > c.s + eps),
      ),
  );
  result.decisions.push({ best: hs[0]!, second: hs[1]!, bestGrowth: gs[0]!, secondGrowth: gs[1]!, pareto: front.length });
}

// ---------------------------------------------------------------------------
// Monte Carlo und Auswertung
// ---------------------------------------------------------------------------

export interface Summary {
  strategy: Strategy;
  runs: RunResult[];
}

export function monteCarlo(strategies: readonly Strategy[], runs: number, options: Omit<RunOptions, 'seed'>): Summary[] {
  return strategies.map((strategy) => ({
    strategy,
    runs: Array.from({ length: runs }, (_, i) => runGame(strategy, { ...options, seed: i + 1 })),
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

/** Kennzahlen je Strategie bei Erreichen einer Stufe. */
export function strategyStats(summary: Summary, stage: number) {
  const reached = summary.runs.filter((r) => r.stageTimes[stage] != null);
  return {
    reachedShare: reached.length / summary.runs.length,
    time: median(reached.map((r) => r.stageTimes[stage]!)),
    harmony: mean(reached.map((r) => r.stageHarmony[stage]!)),
    growth: mean(reached.map((r) => r.stageGrowth[stage]!)),
    finalHarmony: mean(summary.runs.map((r) => r.finalHarmony)),
    finalGrowth: mean(summary.runs.map((r) => r.finalGrowth)),
    happiness: mean(summary.runs.map((r) => r.finalHappiness)),
    communities: mean(summary.runs.map((r) => r.communities)),
  };
}

export function strategyTable(summaries: Summary[], stage: number): string {
  const lines = [
    `| Strategie | ${STAGE_NAMES[stage]} erreicht nach (Median) | Harmonie bei ${STAGE_NAMES[stage]} | Wachstum/s bei ${STAGE_NAMES[stage]} | Harmonie am Ende | Wachstum/s am Ende | Ø Zufriedenheit | Lebensgemeinschaften |`,
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const st = strategyStats(s, stage);
    lines.push(
      `| ${s.strategy.name} | ${formatTime(st.time)} | ${fmt(st.harmony)} | ${fmt(st.growth)} | ${fmt(st.finalHarmony)} | ${fmt(st.finalGrowth)} | ${fmt(st.happiness * 100)} % | ${fmt(st.communities, 1)} |`,
    );
  }
  return lines.join('\n');
}

export function stageTable(summary: Summary, targets: readonly (string | null)[]): string {
  const lines = [
    '| Stufe | Ziel | Median | 10–90 % | Ø Harmonie | Ø Wachstum/s | Ø Samen/s | Tiere / Pflanzen | Begegnungen im Abschnitt | Takt Median | Takt 90 % |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (let s = 1; s < STAGE_NAMES.length; s++) {
    const reached = summary.runs.filter((r) => r.stageTimes[s] != null);
    if (reached.length === 0) continue;
    const times = reached.map((r) => r.stageTimes[s]!);
    const gaps = summary.runs.flatMap((r) => r.gaps.filter((g) => g.stage === s).map((g) => g.seconds));
    const perRun = mean(summary.runs.map((r) => r.gaps.filter((g) => g.stage === s).length));
    lines.push(
      `| ${STAGE_NAMES[s]} | ${targets[s] ?? '–'} | ${formatTime(median(times))} | ${formatTime(quantile(times, 0.1))} – ${formatTime(quantile(times, 0.9))} | ${fmt(mean(reached.map((r) => r.stageHarmony[s]!)))} | ${fmt(mean(reached.map((r) => r.stageGrowth[s]!)), 1)} | ${fmt(mean(reached.map((r) => r.stageSeeds[s]!)), 1)} | ${fmt(mean(reached.map((r) => r.stageAnimals[s]!)), 1)} / ${fmt(mean(reached.map((r) => r.stagePlants[s]!)), 1)} | ${fmt(perRun, 1)} | ${formatTime(median(gaps))} | ${formatTime(quantile(gaps, 0.9))} |`,
    );
  }
  return lines.join('\n');
}

/** Wie oft ist die Wahl „echt“? */
export function decisionStats(summary: Summary) {
  const ds = summary.runs.flatMap((r) => r.decisions);
  const n = Math.max(1, ds.length);
  const isClose = (d: DecisionStat) => d.best - d.second <= Math.max(CLOSE_ABSOLUTE, CLOSE_RELATIVE * Math.abs(d.best));
  return {
    count: ds.length,
    /** Mindestens zwei Karten sind in einer der drei Größen vorn (Zielkonflikt). */
    paretoShare: ds.filter((d) => d.pareto >= 2).length / n,
    /** Die zwei besten Karten liegen in der Harmonie nah beieinander. */
    closeShare: ds.filter(isClose).length / n,
    /** Echte Wahl: Zielkonflikt oder knapp – und mindestens eine Karte lohnt sich. */
    realShare: ds.filter((d) => (d.pareto >= 2 || isClose(d)) && (d.best > 0 || d.bestGrowth > 0)).length / n,
    /** Eine Karte ist in allem besser und deutlich vorn. */
    obviousShare: ds.filter((d) => d.pareto < 2 && !isClose(d)).length / n,
    /** Keine Karte verbessert Harmonie oder Wachstum (Ablehnen/Neu würfeln naheliegend). */
    allBadShare: ds.filter((d) => d.best <= 0 && d.bestGrowth <= 0).length / n,
    medianGap: median(ds.map((d) => d.best - d.second)),
  };
}

/** „Knapp“: Abstand der zwei besten Karten höchstens 2 Harmonie oder 30 %. */
export const CLOSE_ABSOLUTE = 2;
export const CLOSE_RELATIVE = 0.3;

export function decisionTable(summaries: Summary[]): string {
  const lines = [
    '| Strategie | Entscheidungen | echte Wahl | davon Zielkonflikt (Pareto ≥ 2) | knapp (Harmonie) | eindeutig | keine Karte lohnt | Median Abstand (Harmonie) |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const d = decisionStats(s);
    lines.push(
      `| ${s.strategy.name} | ${d.count} | ${fmt(d.realShare * 100)} % | ${fmt(d.paretoShare * 100)} % | ${fmt(d.closeShare * 100)} % | ${fmt(d.obviousShare * 100)} % | ${fmt(d.allBadShare * 100)} % | ${fmt(d.medianGap, 1)} |`,
    );
  }
  return lines.join('\n');
}

export function miscTable(summaries: Summary[]): string {
  const lines = [
    '| Strategie | Tier-Begegnungen | davon Nische voll | Neu gewürfelt | Abgelehnt | gezogene Seltenheit g/s/b/l | Tiere je Gattung (V/I/S/B/P) |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const r = s.runs;
    const enc = mean(r.map((x) => x.animalEncounters));
    const full = mean(r.map((x) => x.fullNiche));
    const rare = [0, 1, 2, 3].map((i) => fmt(mean(r.map((x) => x.rareTaken[i]!)), 1)).join(' / ');
    const genus = GENERA.map((g) => fmt(mean(r.map((x) => x.genusCounts[g])), 1)).join(' / ');
    lines.push(
      `| ${s.strategy.name} | ${fmt(enc, 1)} | ${fmt(full, 1)} | ${fmt(mean(r.map((x) => x.rerolls)), 1)} | ${fmt(mean(r.map((x) => x.declines)), 1)} | ${rare} | ${genus} |`,
    );
  }
  return lines.join('\n');
}

/** Für Tests und Doku: Seltenheiten der Arten. */
export function rarityCounts(): number[] {
  const out = [0, 0, 0, 0];
  for (const s of SPECIES as readonly Species[]) out[s.rarity]!++;
  return out;
}
