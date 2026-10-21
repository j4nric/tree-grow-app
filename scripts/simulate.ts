/**
 * Balancing-Simulator für das v2-Spiel – auf der ECHTEN Spiellogik aus src/core/
 * (tick, chooseCard, declineEncounter, rerollEncounter, plantSeed, evaluate,
 * previewChoice …) – er misst genau das, was der Spieler erlebt: Tier- und
 * Pflanzenbegegnungen, Pflanzen setzen, Pflege, Ereignisse, Gäste, Jahreszeiten,
 * Baumarten und (runCycles) mehrere Zyklen mit Waldgedächtnis und Stammgästen. Das
 * frühere Referenzmodell scripts/v2/ ist seit Schritt 2.10 entfernt.
 *
 * Der Spieler löst jede Begegnung sofort auf (online) und setzt Pflanzen, sobald die
 * Samen reichen und es sich nach seiner Strategie lohnt. Ereignisse und Durchreisende
 * (Schritt 2.4) kommen aus der echten Logik (drawEncounter, Zwischenhalt) und werden mit
 * chooseEventOption / hostVisitor / farewellVisitor aufgelöst. Die Zeit läuft
 * ereignisgesteuert von Halt zu Halt (Wegpunkt, Zwischenhalt, Ablauf eines Bonus,
 * nächster Pflanzenkauf); tick() rechnet dazwischen exakt.
 *
 * Ausführen (Tabellen im Protokoll, DESIGN_V2.md Abschnitt 15.4):
 *   npm run balance    # großer Lauf: alle Balancing-Tests mit vielen Durchgängen und Tabellen
 * Im normalen `npm run check` laufen dieselben Tests mit wenigen Durchgängen (feste Seeds,
 * Einstellungen in tests/balance-setup.ts).
 *
 * Jahreszeiten laufen immer mit (echte Logik, DESIGN_V2.md 16): Der Simulator hält an
 * jeder Jahreszeitgrenze an, damit Kauf-Zeitpunkte mit der richtigen Rate geplant werden.
 * `RunOptions.mainTree` wählt die Art des Hauptbaums für den (ersten) Zyklus – ohne
 * Freischaltung, damit die Arten vergleichbar sind (DESIGN_V2.md 17.4; Tabellen:
 * tests/seasons-balance.test.ts).
 */
import { COMMUNITIES } from '../src/content/communities';
import { GENUS_INFO, SPECIES_BY_ID } from '../src/content/species';
import { NEW_CYCLE_MIN_STAGE } from '../src/content/memory';
import { STAGES } from '../src/content/stages';
import { GENERA, NICHE_IDS, type EncounterType, type Genus } from '../src/content/types';
import { CARE } from '../src/content/care';
import { EVENTS_BY_ID } from '../src/content/events';
import {
  cardStatus,
  declineReward,
  evaluate,
  nextPlantCost,
  plantSlots,
  previewChoice,
  previewPlant,
  regularSlots,
  secondsToNextWaypoint,
  type Evaluation,
} from '../src/core/formulas';
import { normalizeSeed, randomInt, type RngHolder } from '../src/core/rng';
import { allAnimals, createInitialState, type GameState, type PendingEncounterType } from '../src/core/state';
import {
  allWaypointsReached,
  buyCare,
  careBlocker,
  careRank,
  chooseCard,
  chooseEventOption,
  declineEncounter,
  farewellVisitor,
  hostBlocker,
  hostVisitor,
  interludeThreshold,
  nextExpiry,
  nextCareRank,
  isTreeUnlocked,
  plantSeed,
  previewNewCycle,
  previewCare,
  rerollBlocker,
  rerollEncounter,
  setRegulars,
  startNewCycle,
  tick,
  unlockedPlants,
} from '../src/core/tick';
import { seasonIndex, secondsToNextSeason } from '../src/core/season';
import type { MainTreeId } from '../src/content/trees';

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
 * Höchstens ein Wurf je Tierbegegnung (wie im früheren Prototyp scripts/v2), und nur,
 * wenn die Logik ihn zulässt (Samen reichen, es gibt andere Karten – rerollBlocker liefert sonst
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

/** Kennzahlen einer Begegnung: Wie „echt“ war die Wahl? (Definition wie im früheren Prototyp scripts/v2) */
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
  /** Ereignisse, Gäste, davon bewirtet. */
  events: number;
  visitors: number;
  hosted: number;
  /** Nur mit `care`: gekaufte Pflege-Ränge. */
  careBought: number;
  /** Eingezogene Stammgäste (ab Zyklus 2). */
  regulars: number;
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
  /** Tiere (Art-IDs) und Pflanzen im Ökosystem. */
  animalIds: string[];
  /** Summe der 🌿-Boni (nach Fraß) und Anteil der Begleitpflanzen an 🌿/s. */
  growthBonus: number;
  plantGrowth: number;
  plantIds: string[];
  plants: number;
  /** Versorgung V der Begleitpflanzen (0–1). */
  supply: number;
  genus: Record<Genus, number>;
  /** Aktive Lebensgemeinschaften (IDs) und ihre Harmonie (inkl. Lichterabend). */
  communities: string[];
  communityHarmony: number;
  /** Im Naturtagebuch entdeckte Lebensgemeinschaften (auch gerade nicht aktive). */
  discovered: number;
  /** Samen-Bestand. */
  seeds: number;
  /** Bisher verdient: passiv (Baum × Harmonie) und durch (automatisches) Ablehnen. */
  earnedPassive: number;
  earnedDecline: number;
  /** Bisher ausgegeben für Neu würfeln und für Pflanzen. */
  spent: number;
  spentPlants: number;
  /** Samen aus Ereignissen und Gästen bzw. fürs Bewirten ausgegeben. */
  earnedExtras: number;
  spentVisitors: number;
  /** Nur mit `care`: für Pflege ausgegeben. */
  spentCare: number;
  /** Gekaufte Ränge je Maßnahme. */
  careRanks: Record<string, number>;
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
  type: EncounterType;
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
  /** Pflegemaßnahmen kaufen (echte Logik, Schritt 2.7). Standard: aus – zum Vergleich. */
  care?: boolean;
  /** Art des Hauptbaums (Standard: Stieleiche wie im ersten Zyklus). */
  mainTree?: MainTreeId;
}

/** Zeitpunkte (Minuten) für den Samen-Verlauf. */
export const SAMPLE_MINUTES: readonly number[] = [5, 10, 20, 30, 45, 60, 90, 120, 180];

/**
 * Ein Zyklus. Ohne `from` beginnt ein neues Spiel (erster Zyklus); mit `from` läuft der
 * Zyklus auf diesem Spielstand weiter (runCycles: nach startNewCycle) und mit dem Zufall
 * der Strategie aus dem vorigen Zyklus.
 */
export function runGame(
  strategy: Strategy,
  options: RunOptions,
  from?: { state: GameState; rng: RngHolder },
): RunResult {
  const state = from?.state ?? createInitialState(0, options.seed);
  if (options.mainTree) state.cycle.mainTree = options.mainTree;
  const rng: RngHolder = from?.rng ?? { rngState: normalizeSeed(options.seed * 7919 + 17) };
  let time = 0;
  let lastWaypointTime = 0;
  const book = { earnedPassive: 0, earnedDecline: 0, spent: 0, spentPlants: 0, earnedExtras: 0, spentVisitors: 0, spentCare: 0 };
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
    events: 0,
    visitors: 0,
    hosted: 0,
    careBought: 0,
    regulars: 0,
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
      animalIds: allAnimals(state),
      growthBonus: ev.growthBonus - ev.damage,
      plantGrowth: ev.plantGrowth,
      plantIds: [...state.plants],
      plants: state.plants.length,
      supply: ev.supply,
      genus,
      communities: ev.communities.filter((c) => c.active).map((c) => c.id),
      communityHarmony: ev.breakdown.communities,
      discovered: state.meta.journal.communities.length,
      seeds: state.seeds,
      ...book,
      careRanks: { ...state.cycle.care },
      counts: { ...counts, rarityTaken: [...counts.rarityTaken] },
    };
  };
  result.stages[0] = snapshot();
  let sample = 0;

  // planPlant bewertet jede Pflanze (teuer) und hängt nur vom Ökosystem (wie der
  // Cache-Schlüssel von evaluate), vom Wegpunkt und von der Zahl gesetzter Pflanzen ab –
  // darum je Zustand nur einmal rechnen (gleiche Ergebnisse; Idee aus dem Branch
  // claude/v2-tests-schneller).
  let planKey = '';
  let planValue: string | null = null;
  const nextPlan = (): string | null => {
    const c = state.cycle;
    const key = [
      state.waypoint,
      counts.plantsBought,
      state.plants.join(','),
      NICHE_IDS.map((n) => state.niches[n].join(',')).join(';'),
      JSON.stringify([c.care, c.bonuses, c.habitats, c.timed.map((t) => t.effect), c.visitors.map((v) => v.id)]),
      seasonIndex(c.elapsed),
    ].join('|');
    if (key !== planKey) {
      planKey = key;
      planValue = planPlant(state, strategy, counts);
    }
    return planValue;
  };

  while (state.stage < options.targetStage && time < options.maxSeconds && !allWaypointsReached(state)) {
    // Pflanzen setzen, solange es sich lohnt und die Samen reichen.
    for (let plan = nextPlan(); plan !== null; plan = nextPlan()) {
      const cost = nextPlantCost(state);
      if (!plantSeed(state, plan).ok) break;
      book.spentPlants += cost;
      counts.plantsBought++;
    }
    const plan = nextPlan();
    // Pflege: kaufen, was die Strategie anspart, sobald es reicht (Pflanzen haben Vorrang).
    let careNeed: number | null = null;
    if (options.care) {
      for (let target = careTarget(state, strategy); target; target = careTarget(state, strategy)) {
        const cost = nextCareRank(state, target)!.cost;
        const reserve = plan !== null ? nextPlantCost(state) : 0;
        if (state.seeds < cost + reserve) {
          careNeed = cost + reserve;
          break;
        }
        const before = state.seeds;
        if (!buyCare(state, target).ok) break;
        book.spentCare += before - state.seeds;
        counts.careBought++;
      }
    }
    const ev = evaluate(state);
    // Bis die nächste geplante Pflanze bezahlbar ist (+1 µs gegen Rundung).
    const toPlant =
      plan !== null && ev.seeds > 0 ? Math.max(0, (nextPlantCost(state) - state.seeds) / ev.seeds) + 1e-6 : Infinity;
    const stageBefore = state.stage;
    const nextSample = (SAMPLE_MINUTES[sample] ?? Infinity) * 60;
    const toWaypoint = secondsToNextWaypoint(state);
    // Zwischenhalt und Ablauf von Boni: dort anhalten, damit Zeitpunkte und Raten stimmen.
    const interlude = interludeThreshold(state);
    const toInterlude = interlude < Infinity && ev.growth > 0 ? Math.max(0, interlude - state.totalGrowth) / ev.growth : Infinity;
    // Jahreszeitgrenze: Raten wechseln, Käufe neu planen.
    const toSeason = secondsToNextSeason(state.cycle.elapsed);
    const toCare = careNeed !== null && ev.seeds > 0 ? Math.max(0, (careNeed - state.seeds) / ev.seeds) + 1e-6 : Infinity;
    const dt = Math.min(toWaypoint, toPlant, nextSample - time, nextExpiry(state), toInterlude, toSeason, toCare, options.maxSeconds - time);
    if (!(dt < Infinity)) break;
    const seedsBefore = state.seeds;
    const report = tick(state, dt);
    time += dt;
    const autoSeeds = report.autoDeclined * declineReward();
    book.earnedPassive += state.seeds - seedsBefore - autoSeeds;
    book.earnedDecline += autoSeeds;
    counts.autoDeclined += report.autoDeclined;
    counts.regulars += report.regulars.length;
    if (time >= nextSample - 1e-9) result.samples[sample++] = snapshot();
    if (report.waypoints === 0) {
      // Zwischenhalt (ab Hain): zählt als Begegnung für Takt und Durststrecke.
      if (report.interludes > 0) {
        result.gaps.push({ stage: state.stage, seconds: time - lastWaypointTime });
        lastWaypointTime = time;
        resolveAll(state, strategy, rng, counts, book, result.decisions, result.variety, time);
      }
      continue;
    }
    result.gaps.push({ stage: stageBefore, seconds: time - lastWaypointTime });
    lastWaypointTime = time;
    for (let s = stageBefore + 1; s <= state.stage; s++) result.stages[s] = snapshot();
    resolveAll(state, strategy, rng, counts, book, result.decisions, result.variety, time);
  }
  result.final = snapshot();
  return result;
}

// ---------------------------------------------------------------------------
// Mehrere Zyklen am Stück (Neuer Zyklus, Waldgedächtnis, Stammgäste, Kartenpool)
// ---------------------------------------------------------------------------

/** Ein Zyklus aus runCycles. */
export interface CycleRun {
  /** Nummer des Zyklus (ab 1). */
  number: number;
  result: RunResult;
  /** Waldgedächtnis zu Beginn des Zyklus und Gewinn an seinem Ende (previewNewCycle). */
  memory: number;
  memoryGain: number;
  /** Höchste Harmonie des Zyklus (H_max, ungerundet) beim Neustart. */
  maxHarmony: number;
  /** Arten, die in diesem Zyklus neu ins Tagebuch kamen. */
  newSpecies: number;
  /** Gewählte Stammgäste in diesem Zyklus und wie viele davon eingezogen sind. */
  regulars: string[];
  regularsMovedIn: number;
}

export interface CycleOptions extends RunOptions {
  /** Anzahl Zyklen am Stück (jeder endet mit Erreichen von `targetStage`). */
  cycles: number;
}

/**
 * Stammgäste für den nächsten Zyklus: Tiere des Ökosystems am Ende des Zyklus, sortiert
 * nach ihrem Beitrag zum Maß der Strategie (Wert mit minus Wert ohne das Tier, echte
 * Logik). Der Zufallsspieler nimmt sie in fester, beliebiger Reihenfolge.
 */
function rankRegulars(state: GameState, strategy: Strategy): string[] {
  const animals = allAnimals(state);
  if (!strategy.plantValue) return animals;
  const value = strategy.plantValue;
  const now = value(evaluate(state));
  const contribution = new Map<string, number>();
  for (const id of animals) {
    const copy = structuredClone(state);
    const niche = SPECIES_BY_ID.get(id)!.niche;
    copy.niches[niche] = copy.niches[niche].filter((x) => x !== id);
    contribution.set(id, now - value(evaluate(copy)));
  }
  return [...animals].sort((a, b) => contribution.get(b)! - contribution.get(a)!);
}

/**
 * Spielt `cycles` Zyklen am Stück mit der echten Logik: Jeder Zyklus endet mit Erreichen
 * von `targetStage` (mindestens Hain), danach `startNewCycle` (Waldgedächtnis, Tagebuch
 * bleibt, Kartenpool mit Tagebuch-Gewicht) und die Wahl der Stammgäste (rankRegulars,
 * so viele, wie Plätze da sind). Sie ziehen ab dem nächsten Wegpunkt ein.
 */
export function runCycles(strategy: Strategy, options: CycleOptions): CycleRun[] {
  const state = createInitialState(0, options.seed);
  const rng: RngHolder = { rngState: normalizeSeed(options.seed * 7919 + 17) };
  const out: CycleRun[] = [];
  let regulars: string[] = [];
  for (let n = 1; n <= options.cycles; n++) {
    const memory = state.meta.forestMemory;
    const result = runGame(strategy, options, { state, rng });
    const preview = previewNewCycle(state);
    out.push({
      number: n,
      result,
      memory,
      memoryGain: preview.memoryGain,
      maxHarmony: preview.maxHarmony,
      newSpecies: preview.newSpecies,
      regulars,
      regularsMovedIn: result.final.counts.regulars,
    });
    if (n === options.cycles) break;
    const ranked = rankRegulars(state, strategy);
    const started = startNewCycle(state, 0, isTreeUnlocked(state, options.mainTree ?? 'oak') ? options.mainTree : 'oak');
    if (!started.ok) throw new Error(`Neuer Zyklus gescheitert: ${started.error}`);
    regulars = ranked.slice(0, regularSlots(state.meta.forestMemory));
    if (!setRegulars(state, regulars).ok) throw new Error('Stammgäste nicht wählbar');
  }
  return out;
}

/** Wie viel Samen ist eine Sekunde Wachstum wert? (Bewertung der Ereignis-Optionen) */
const SEED_VALUE = 0.4;
/** Horizont für Wirkungen „bis zum Zyklusende“ (s). */
const CYCLE_HORIZON = 1800;
/** Pauschaler Wert (s Wachstum) einer vorgegebenen nächsten Begegnung. */
const FORCED_VALUE = 45;

/**
 * Wert einer Ereignis-Option in „Sekunden Wachstum“ – auf einer Kopie des Spielstands
 * mit der echten Aktion gerechnet: zusätzliche Wachstums-Sekunden plus SEED_VALUE ×
 * zusätzliche Samen-Sekunden über die Wirkdauer, sofortige Samen in Samen-Sekunden.
 */
function eventOptionValue(state: GameState, optionIndex: number): number {
  const before = evaluate(state);
  const copy = structuredClone(state);
  const result = chooseEventOption(copy, 0, optionIndex);
  if (!result.ok) return -Infinity;
  const after = evaluate(copy);
  const event = EVENTS_BY_ID.get(state.pendingEncounters[0]!.cards[0]!)!;
  let span = 0;
  let forced = 0;
  for (const e of event.options[optionIndex]!.effects) {
    if (e.kind === 'timed') span = Math.max(span, e.seconds);
    else if (e.kind === 'cycle' || e.kind === 'habitat') span = Math.max(span, CYCLE_HORIZON);
    else if (e.kind === 'nextEncounter') forced = FORCED_VALUE;
  }
  const seeds = Math.max(1e-9, before.seeds);
  const gain = after.growth / Math.max(1e-9, before.growth) - 1 + SEED_VALUE * (after.seeds / seeds - 1);
  return SEED_VALUE * ((result.seeds ?? 0) / seeds) + span * gain + forced;
}

/**
 * Ereignis oder Gast an der Spitze der Warteschlange auflösen (echte Logik). Ereignis:
 * Zufallsspieler wählt zufällig, alle anderen die Option mit dem höchsten Wert. Gast:
 * bewirten, wenn die Samen reichen (Zufallsspieler: in der Hälfte der Fälle), sonst
 * ziehen lassen. Ereignisse zählen als lohnend (jedes hat eine Option mit Wirkung außer
 * Samen), Gäste, wenn Bewirten bezahlbar ist.
 */
function resolveExtra(
  state: GameState,
  strategy: Strategy,
  rng: RngHolder,
  counts: Counts,
  book: { earnedExtras: number; spentVisitors: number },
  variety: VarietyStat[],
  time: number,
): void {
  const enc = state.pendingEncounters[0]!;
  counts.encounters++;
  let worthwhile = true;
  if (enc.type === 'event') {
    counts.events++;
    const n = EVENTS_BY_ID.get(enc.cards[0]!)?.options.length ?? 1;
    let choice = 0;
    if (strategy.plantValue === null) choice = randomInt(rng, n);
    else {
      let best = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = eventOptionValue(state, i);
        if (v > best) {
          best = v;
          choice = i;
        }
      }
    }
    const result = chooseEventOption(state, 0, choice);
    if (!result.ok) throw new Error(`Ereignis-Wahl gescheitert: ${result.error}`);
    book.earnedExtras += result.seeds ?? 0;
  } else {
    counts.visitors++;
    // Lohnend, wenn Bewirten bezahlbar ist (wie „lohnende Karte“ – egal, was gewählt wird).
    worthwhile = hostBlocker(state, 0) === null;
    const wants = strategy.plantValue === null ? randomInt(rng, 2) === 0 : true;
    const hosted = wants ? hostVisitor(state, 0) : null;
    if (hosted?.ok) {
      counts.hosted++;
      book.spentVisitors -= hosted.seeds ?? 0;
    } else {
      const result = farewellVisitor(state, 0);
      if (result.ok) book.earnedExtras += result.seeds ?? 0;
    }
  }
  variety.push({ stage: state.stage, time, type: enc.type, cards: 1, sameAsPrevious: false, rerollBlocked: 'no-reroll', worthwhile });
}

/** Pauschaler Wert (relativer Gewinn) eines Platzes bzw. Merkmals – wirkt erst, wenn genutzt. */
const CARE_SLOT_VALUE = 0.03;
const CARE_HABITAT_VALUE = 0.02;

/**
 * Welchen Pflege-Rang spart die Strategie als Nächstes an? Nur Ränge, die bis auf die
 * Samen kaufbar sind (careBlocker). Bewertende Strategien: bester Wert je Samen über
 * CYCLE_HORIZON (Vorschau mit der echten Logik, previewCare; Plätze und Merkmale
 * pauschal), nur wenn er etwas bringt. Zufallsspieler: ein beliebiger, aber je Zustand
 * fester Rang. null = nichts.
 */
function careTarget(state: GameState, strategy: Strategy): string | null {
  const offers = CARE.filter((m) => {
    const b = careBlocker(state, m.id);
    return b === null || b === 'too-expensive';
  });
  if (offers.length === 0) return null;
  if (!strategy.plantValue) {
    const bought = CARE.reduce((sum, m) => sum + careRank(state, m.id), 0);
    return offers[(bought * 5 + state.waypoint) % offers.length]!.id;
  }
  const now = evaluate(state);
  let top: string | null = null;
  let topValue = 0;
  for (const m of offers) {
    const next = nextCareRank(state, m.id)!;
    const after = previewCare(state, m.id);
    if (!after) continue;
    let nominal = 0;
    for (const e of next.effects) {
      if (e.kind === 'habitat') nominal += CARE_HABITAT_VALUE;
      else if (e.effect.kind === 'slot') nominal += CARE_SLOT_VALUE;
    }
    const gain =
      after.growth / Math.max(1e-9, now.growth) - 1 + SEED_VALUE * (after.seeds / Math.max(1e-9, now.seeds) - 1) + nominal;
    const value = (CYCLE_HORIZON * gain) / next.cost;
    if (value > topValue) {
      top = m.id;
      topValue = value;
    }
  }
  return top;
}

/**
 * Welche Pflanze würde die Strategie als Nächstes setzen? null, wenn der Ring voll ist,
 * nichts freigeschaltet ist oder (bei bewertenden Strategien) keine Pflanze verbessert.
 * Der Zufallsspieler nimmt eine je Zustand feste, aber beliebige Pflanze (wie im früheren
 * Prototyp scripts/v2).
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
  book: { earnedDecline: number; spent: number; earnedExtras: number; spentVisitors: number },
  decisions: DecisionStat[],
  variety: VarietyStat[],
  time: number,
): void {
  // Schutz gegen Endlosschleifen: jede Strategie würfelt höchstens einmal je Begegnung.
  for (let guard = 0; state.pendingEncounters.length > 0 && guard < 50; guard++) {
    const enc = state.pendingEncounters[0]!;
    if (enc.type === 'event' || enc.type === 'visitor') {
      resolveExtra(state, strategy, rng, counts, book, variety, time);
      continue;
    }
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
      else if (option.kind !== 'animal') throw new Error('unerwarteter Begegnungstyp');
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
  // Ab einer Stunde mit Sekunden (h:mm:ss): Der Hain liegt um 60 min, Minuten zählen.
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} h`;
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
    communities: m((s) => s.communities.length),
    communityHarmony: m((s) => s.communityHarmony),
    discovered: m((s) => s.discovered),
    /** Anteil der Durchgänge, in denen die Lebensgemeinschaft gerade aktiv ist (je ID). */
    communityShare: Object.fromEntries(
      COMMUNITIES.map((c) => [c.id, reached.filter((s) => s.communities.includes(c.id)).length / Math.max(1, reached.length)]),
    ) as Record<string, number>,
    seeds: m((s) => s.seeds),
    earnedPassive: m((s) => s.earnedPassive),
    earnedDecline: m((s) => s.earnedDecline),
    spent: m((s) => s.spent),
    spentPlants: m((s) => s.spentPlants),
    spentCare: m((s) => s.spentCare),
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
/** Begegnungen mit Karten (Tier, Pflanze) – nur dort zählen Kartenzahl und Neu würfeln. */
const isCards = (v: VarietyStat) => v.type === 'animal' || v.type === 'plant';

export function varietyStats(summary: Summary, stage: number) {
  const vs = summary.runs.flatMap((r) => r.variety.filter((v) => v.stage === stage));
  const n = Math.max(1, vs.length);
  const cardsOnly = vs.filter(isCards);
  const droughts = summary.runs.map((r) => longestDrought(r, stage)).filter((d): d is number => d !== null);
  const share = (f: (v: VarietyStat) => boolean) => vs.filter(f).length / n;
  const cardShare = (f: (v: VarietyStat) => boolean) => cardsOnly.filter(f).length / Math.max(1, cardsOnly.length);
  return {
    count: vs.length,
    sameShare: share((v) => v.sameAsPrevious),
    sameAnimalShare:
      vs.filter((v) => v.type === 'animal' && v.sameAsPrevious).length / Math.max(1, vs.filter((v) => v.type === 'animal').length),
    samePlantShare:
      vs.filter((v) => v.type === 'plant' && v.sameAsPrevious).length / Math.max(1, vs.filter((v) => v.type === 'plant').length),
    fewCardsShare: cardShare((v) => v.cards <= 2),
    rerollOpenShare: cardShare((v) => v.rerollBlocked === null),
    rerollTooExpensiveShare: cardShare((v) => v.rerollBlocked === 'too-expensive'),
    rerollNoAltShare: cardShare((v) => v.rerollBlocked === 'no-alternatives' || v.rerollBlocked === 'no-cards'),
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
  // Kartenzahl und Neu würfeln nur bei Tier- und Pflanzenbegegnungen (Ereignisse/Gäste: eine Karte, kein Wurf).
  const cards = vs.filter(isCards);
  const cardShare = (f: (v: VarietyStat) => boolean) => cards.filter(f).length / Math.max(1, cards.length);
  // Längste Durststrecke je Durchgang über alle Stufen vor `beforeStage`.
  const droughts = summary.runs.map((r) => {
    const ds = Array.from({ length: beforeStage - 1 }, (_, i) => longestDrought(r, i + 1) ?? 0);
    return Math.max(0, ...ds);
  });
  return {
    sameShare: share((v) => v.sameAsPrevious),
    /** Ab Setzling (im Keimling gibt es nur 2 Pflanzen und 3 Arten – gewollt). */
    fewCardsShare: cards.filter((v) => v.stage >= 2 && v.cards <= 2).length / Math.max(1, cards.filter((v) => v.stage >= 2).length),
    rerollOpenShare: cardShare((v) => v.rerollBlocked === null),
    worthShare: share((v) => v.worthwhile),
    droughtMedian: median(droughts),
    droughtP90: quantile(droughts, 0.9),
    droughtMax: Math.max(...droughts),
  };
}

export function varietySummaryTable(summaries: Summary[], beforeStage: number): string {
  const pct = (x: number) => `${fmt(x * 100)} %`;
  const lines = [
    '| Strategie | gleiches Set wie vorige | 1–2 Karten (ab Setzling) | Neu würfeln möglich | lohnend | längste Durststrecke Median / 90 % / max |',
    '|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const v = varietyBefore(s, beforeStage);
    lines.push(
      `| ${s.strategy.name} | ${pct(v.sameShare)} | ${pct(v.fewCardsShare)} | ${pct(v.rerollOpenShare)} | ${pct(v.worthShare)} | ${formatTime(v.droughtMedian)} / ${formatTime(v.droughtP90)} / ${formatTime(v.droughtMax)} |`,
    );
  }
  return lines.join('\n');
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

/** Lebensgemeinschaften beim Erreichen einer Stufe: Anzahl, Harmonie-Anteil, häufigste. */
export function communityTable(summaries: Summary[], stage: number): string {
  const lines = [
    '| Strategie | aktiv (Ø) | ⚖️ daraus | Anteil an ⚖️ | entdeckt (Ø) | häufigste (Anteil der Durchgänge) |',
    '|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const st = stageStats(s, stage);
    const top = COMMUNITIES.map((c) => ({ name: c.name, share: st.communityShare[c.id] ?? 0 }))
      .filter((c) => c.share >= 0.05)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3)
      .map((c) => `${c.name} ${fmt(c.share * 100)} %`)
      .join(', ');
    lines.push(
      `| ${s.strategy.name} | ${fmt(st.communities, 2)} | ${fmt(st.communityHarmony, 1)} | ${fmt((st.communityHarmony / Math.max(1e-9, st.harmony)) * 100)} % | ${fmt(st.discovered, 2)} | ${top || '–'} |`,
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

/**
 * Zielzeiten (DESIGN_V2.md, Abschnitt 3 und 15.4) für den harmonie-orientierten Spieler
 * mit allen Systemen. Setzling seit Schritt 2.10 ~45 s (Wunsch des Nutzers: „45 Sekunden
 * sollte der Sweetspot sein“), vorher ~1 min.
 */
export const STAGE_TARGETS: readonly { stage: number; seconds: number; label: string }[] = [
  { stage: 1, seconds: 30, label: '< 30 s' },
  { stage: 2, seconds: 45, label: '~ 45 s' },
  { stage: 3, seconds: 4 * 60, label: '~ 4 min' },
  { stage: 4, seconds: 20 * 60, label: '~ 20 min' },
  { stage: 5, seconds: 60 * 60, label: '~ 60 min' },
  { stage: 6, seconds: 100 * 60, label: '~ 1:40 h' },
  { stage: 7, seconds: 140 * 60, label: '~ 2:20 h' },
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
    `#### Lebensgemeinschaften beim Erreichen von „${name}“`,
    '',
    communityTable(summaries, focusStage),
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
    `#### Vielfalt bis ${name} je Strategie`,
    '',
    varietySummaryTable(summaries, focusStage),
    '',
    `#### Begegnungen bis ${name} (Mittel je Durchgang)`,
    '',
    miscTable(summaries, focusStage),
  ].join('\n');
}

/**
 * Ereignisse und Durchreisende (Schritt 2.4, echte Logik): je Strategie Stufenzeiten,
 * Harmonie beim Hain, längste Durststrecke je Stufe (90-%-Quantil und Maximum), Anzahl
 * je Durchgang.
 */
export function extrasTable(summaries: Summary[]): string {
  const lines = [
    '| Strategie | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain | Durststrecke Alter Baum 90 % / max | Hain 90 % / max | Wald 90 % / max | Ereignisse / Gäste (bewirtet) je Durchgang |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of summaries) {
    const times = [4, 5, 6, 7].map((st) => formatTime(stageStats(s, st).time));
    const d = [4, 5, 6].map((st) => {
      const v = varietyStats(s, st);
      return `${formatTime(v.droughtP90)} / ${formatTime(v.droughtMax)}`;
    });
    const c = s.runs.map((r) => r.final.counts);
    const extra = `${fmt(mean(c.map((x) => x.events)), 1)} / ${fmt(mean(c.map((x) => x.visitors)), 1)} (${fmt(mean(c.map((x) => x.hosted)), 1)})`;
    lines.push(`| ${s.strategy.name} | ${times.join(' | ')} | ${fmt(stageStats(s, 5).harmony, 1)} | ${d.join(' | ')} | ${extra} |`);
  }
  return lines.join('\n');
}

/**
 * Jahreszeiten und Baumarten (grobes Modell, DESIGN_V2.md 16.5 und 17.4): je Variante
 * Stufenzeiten, Harmonie, Ø Zufriedenheit und Wachstum beim Hain, längste Durststrecke
 * (90 %) im Alten Baum und im Hain, Pflanzenbegegnungen bis Hain, Ereignisse / Gäste.
 */
export function environmentTable(rows: readonly { label: string; summary: Summary }[]): string {
  const lines = [
    '| Variante | Junger Baum | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain | Ø 😊 beim Hain | 🌿/s beim Hain | Durststrecke Alter Baum / Hain (90 %) | Pflanzenbegegnungen bis Hain | Ereignisse / Gäste |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { label, summary } of rows) {
    const times = [3, 4, 5, 6, 7].map((st) => formatTime(stageStats(summary, st).time));
    const hain = stageStats(summary, 5);
    const d = [4, 5].map((st) => formatTime(varietyStats(summary, st).droughtP90)).join(' / ');
    const c = summary.runs.map((r) => r.final.counts);
    const extra = `${fmt(mean(c.map((x) => x.events)), 1)} / ${fmt(mean(c.map((x) => x.visitors)), 1)}`;
    lines.push(
      `| ${label} | ${times.join(' | ')} | ${fmt(hain.harmony, 1)} | ${fmt(100 * hain.happiness)} % | ${fmt(hain.growth, 1)} | ${d} | ${fmt(hain.counts.plantEncounters, 1)} | ${extra} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Pflegemaßnahmen (Schritt 2.7, echte Logik): Vergleich ohne/mit Pflege – Stufenzeiten,
 * Harmonie, Samenbestand (absolut und in Minuten Produktion) beim Hain und im Wald, für
 * Pflege ausgegeben, gekaufte Ränge je Maßnahme beim Hain / am Ende.
 */
export function careTable(without: Summary[], withCare: Summary[]): string {
  const lines = [
    '| Strategie | Pflege | Alter Baum | Hain | Wald | Urwald | ⚖️ beim Hain | 🌰-Bestand beim Hain (min Produktion) | im Wald | für Pflege bis Hain / Wald | Ränge bis Hain / Urwald |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const bank = (s: Summary, stage: number) => {
    const st = stageStats(s, stage);
    return `${fmt(st.seeds)} (${fmt(st.seeds / st.seedsRate / 60, 1)})`;
  };
  for (const [label, list] of [['ohne', without], ['mit', withCare]] as const) {
    for (const s of list) {
      const times = [4, 5, 6, 7].map((st) => formatTime(stageStats(s, st).time));
      const ranks = (pick: (r: RunResult) => Snapshot | null) =>
        fmt(mean(s.runs.map((r) => Object.values(pick(r)?.careRanks ?? {}).reduce((a, b) => a + b, 0))), 1);
      const care =
        label === 'ohne'
          ? '– | –'
          : `${fmt(stageStats(s, 5).spentCare)} / ${fmt(stageStats(s, 6).spentCare)} | ${ranks((r) => r.stages[5] ?? null)} / ${ranks((r) => r.final)}`;
      lines.push(`| ${s.strategy.name} | ${label} | ${times.join(' | ')} | ${fmt(stageStats(s, 5).harmony, 1)} | ${bank(s, 5)} | ${bank(s, 6)} | ${care} |`);
    }
  }
  lines.push('', '| Maßnahme | ' + withCare.map((s) => `${s.strategy.name}: Ränge bis Hain / Urwald`).join(' | ') + ' |');
  lines.push('|---|' + withCare.map(() => '---|').join(''));
  for (const c of CARE) {
    const cells = withCare.map((s) => {
      const at = (pick: (r: RunResult) => Snapshot | null) => fmt(mean(s.runs.map((r) => pick(r)?.careRanks[c.id] ?? 0)), 2);
      return `${at((r) => r.stages[5] ?? null)} / ${at((r) => r.final)}`;
    });
    lines.push(`| ${c.icon} ${c.name} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x) * 100, 1)} %`;

/**
 * Baumarten (DESIGN_V2.md 17, Balancing 2.10): je Strategie Hain-Zeit (Median), Abstand zur
 * Eiche und Harmonie beim Hain. `rows`: Strategie → Ergebnis je Art (gleiche Seeds).
 */
export function treeTable(rows: readonly { strategy: Strategy; trees: Record<MainTreeId, Summary> }[]): string {
  const lines = [
    '| Strategie | Eiche: Hain / ⚖️ | Buche: Hain / ⚖️ / gegenüber Eiche | Kiefer: Hain / ⚖️ / gegenüber Eiche |',
    '|---|---|---|---|',
  ];
  for (const { strategy, trees } of rows) {
    const oak = stageStats(trees.oak, 5);
    const cell = (id: 'beech' | 'pine') => {
      const st = stageStats(trees[id], 5);
      return `${formatTime(st.time)} / ${fmt(st.harmony, 1)} / ${signedPct(st.time / oak.time - 1)}`;
    };
    lines.push(`| ${strategy.name} | ${formatTime(oak.time)} / ${fmt(oak.harmony, 1)} | ${cell('beech')} | ${cell('pine')} |`);
  }
  return lines.join('\n');
}

/**
 * Mehrere Zyklen am Stück (runCycles): je Strategie und Zyklus Stufenzeiten (Median),
 * Hain gegenüber Zyklus 1, Waldgedächtnis zu Beginn und Gewinn, neu entdeckte Arten,
 * Stammgäste (gewählt / eingezogen) und Harmonie beim Hain.
 */
export function cycleTable(rows: readonly { strategy: Strategy; runs: CycleRun[][] }[]): string {
  const lines = [
    '| Strategie | Zyklus | Setzling | Junger Baum | Alter Baum | Hain | Hain gegenüber Zyklus 1 | Waldgedächtnis zu Beginn / Gewinn | neue Arten | Stammgäste gewählt / eingezogen | ⚖️ beim Hain |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { strategy, runs } of rows) {
    const cycles = runs[0]?.length ?? 0;
    const hainOf = (c: number) => median(runs.map((r) => r[c]!.result.stages[5]?.time ?? NaN));
    for (let c = 0; c < cycles; c++) {
      const cs = runs.map((r) => r[c]!);
      const at = (stage: number) => formatTime(median(cs.map((r) => r.result.stages[stage]?.time ?? NaN)));
      const m = (f: (r: CycleRun) => number) => mean(cs.map(f));
      lines.push(
        `| ${strategy.name} | ${c + 1} | ${at(2)} | ${at(3)} | ${at(4)} | ${at(5)} | ${c === 0 ? '–' : signedPct(hainOf(c) / hainOf(0) - 1)} | ${fmt(m((r) => r.memory), 1)} / +${fmt(m((r) => r.memoryGain), 1)} | ${fmt(m((r) => r.newSpecies), 1)} | ${fmt(m((r) => r.regulars.length), 2)} / ${fmt(m((r) => r.regularsMovedIn), 2)} | ${fmt(m((r) => r.result.stages[5]?.harmony ?? NaN), 1)} |`,
      );
    }
  }
  return lines.join('\n');
}

/** Ein Lauf über mehrere Zyklen mit Neustart in einer bestimmten Stufe (restartTable). */
export interface RestartRow {
  /** Stufe (Index in STAGES), in der jeder Zyklus neu beginnt (= targetStage). */
  stage: number;
  strategy: Strategy;
  runs: CycleRun[][];
}

/** Zeit bis zur Ziel-Stufe in Zyklus `c` (Median, s). */
export function restartTime(row: RestartRow, c: number): number {
  return median(row.runs.map((r) => r[c]?.result.stages[row.stage]?.time ?? NaN));
}

/** Mittlerer Gedächtnis-Gewinn am Ende von Zyklus `c`. */
export function restartGain(row: RestartRow, c: number): number {
  return mean(row.runs.map((r) => r[c]?.memoryGain ?? NaN));
}

/**
 * Neustart in verschiedenen Stufen (Schritt 2.11b): je Stufe und Strategie die Zeit bis zur
 * Ziel-Stufe je Zyklus (Median), H_max und Gedächtnis-Gewinn je Zyklus (Mittel), die Summe
 * über alle Zyklen, das Verhältnis Wachstum/Harmonie je Zyklus und der Gewinn in Zyklus 1
 * gegenüber dem Neustart im Hain derselben Strategie.
 */
export function restartTable(rows: readonly RestartRow[]): string {
  const cycles = rows[0]?.runs[0]?.length ?? 0;
  const list = (f: (c: number) => string) => Array.from({ length: cycles }, (_, c) => f(c)).join(' / ');
  const lines = [
    '| Neustart | Strategie | Ziel-Stufe je Zyklus | H_max je Zyklus | Gedächtnis-Gewinn je Zyklus | Gewinn Zyklus 1 / Hain | Summe | Wachstum / Harmonie je Zyklus |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const hain = rows.find((r) => r.strategy === row.strategy && r.stage === NEW_CYCLE_MIN_STAGE);
    const harmony = rows.find((r) => r.stage === row.stage && r.strategy.id === HARMONY.id);
    const growth = rows.find((r) => r.stage === row.stage && r.strategy.id === GROWTH.id);
    const ratio = row.strategy.id === HARMONY.id && harmony && growth ? list((c) => fmt(restartTime(growth, c) / restartTime(harmony, c), 3)) : '';
    const total = Array.from({ length: cycles }, (_, c) => restartTime(row, c)).reduce((a, b) => a + b, 0);
    lines.push(
      `| ${STAGES[row.stage]?.name ?? row.stage} | ${row.strategy.name} | ${list((c) => formatTime(restartTime(row, c)))} | ${list((c) => fmt(mean(row.runs.map((r) => r[c]!.maxHarmony)), 1))} | ${list((c) => fmt(restartGain(row, c), 1))} | ${hain ? fmt(restartGain(row, 0) / restartGain(hain, 0), 2) : '–'} | ${formatTime(total)} | ${ratio} |`,
    );
  }
  return lines.join('\n');
}

/** runCycles für mehrere Durchgänge (Seeds wie monteCarlo). */
export function monteCarloCycles(strategy: Strategy, runs: number, options: Omit<CycleOptions, 'seed'>): CycleRun[][] {
  return Array.from({ length: runs }, (_, i) => runCycles(strategy, { ...options, seed: 1000 + 7 * i }));
}
