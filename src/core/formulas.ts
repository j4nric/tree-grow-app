import { DECLINE_SEEDS, REROLL_BASE_COST, REROLL_COST_GROWTH } from '../content/encounters';
import { FOREST_MEMORY_BONUS } from '../content/memory';
import { NICHES_BY_ID } from '../content/niches';
import { BASE_HAPPINESS, SPECIES, SPECIES_BY_ID, type Species } from '../content/species';
import { MAIN_TREE_NUTS_STAGE, MAIN_TREE_TAGS, MAIN_TREE_WEIGHT, STAGES } from '../content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
import { GENERA, NICHE_IDS, type Condition, type Effect, type Genus, type NicheId, type PlantGroup, type Tag } from '../content/types';
import { WAYPOINT_COUNT, WAYPOINT_THRESHOLDS, waypointThreshold } from '../content/waypoints';
import type { GameState } from './state';

/*
 * Rechenmodell v2 (Prototyp): Zufriedenheit, Harmonie, Wachstum/s, Samen/s.
 * Formeln aus docs/DESIGN_V2.md, Abschnitt 2 und 9 – vereinfacht: keine Pflanzen,
 * keine Lebensgemeinschaften, keine Fähigkeiten. Referenz: scripts/v2/model.ts
 * (ein Test vergleicht beide).
 */

/** Gewicht der Nahrung gegenüber einem einzelnen Lebensraum-Wunsch. */
export const FOOD_WEIGHT = 2;
/** Abzug je Räuber, der eine Art jagt (höchstens zwei Räuber zählen). */
export const PREDATION_PENALTY = 0.1;
export const PREDATION_MAX_HUNTERS = 2;
/** „Sonnig“: so viel Licht bleibt nach den Begleitpflanzen frei. */
export const SUNNY_MIN_LIGHT = 2;
/** Futtereinheiten je Anbieter. */
export const SUPPLY_MAIN_TREE = 2;
export const SUPPLY_ANIMAL = 1;
/** Harmonie-Multiplikator: 1 + H / HARMONY_DIVISOR (Entscheidung PO). */
export const HARMONY_DIVISOR = 100;
/** Untergrenze für (1 + Wachstumsboni − Fraßschaden). */
export const MIN_GROWTH_FACTOR = 0.5;
/** Ein Schädling gilt als unbewacht, solange mehr als dieser Anteil seines Schadens wirkt. */
export const UNGUARDED_SHARE = 0.5;
/** Harmonie-Abzug je unbewachtem Schädling. */
export const UNGUARDED_PENALTY = 4;

/** Was evaluate() braucht – ein Ausschnitt des GameState (auch für Vorschauen). */
export interface Ecosystem {
  stage: number;
  niches: Record<NicheId, readonly string[]>;
  forestMemory: number;
}

export interface AnimalStatus {
  /** Zufriedenheit 0–1. */
  happiness: number;
  /** Futter-Erfüllung 0–1. */
  food: number;
  /** Je Eintrag in `Species.needs`: erfüllt? */
  needs: boolean[];
  /** Anzahl anwesender Räuber, die diese Art jagen. */
  hunters: number;
}

export interface Evaluation {
  /** 🌿 Wachstum pro Sekunde. */
  growth: number;
  /** 🌰 Samen pro Sekunde. */
  seeds: number;
  /** ⚖️ Harmonie. */
  harmony: number;
  /** 1 + H/100. */
  multiplier: number;
  breakdown: { variety: number; happiness: number; pyramid: number };
  /** Zustand je Tier (Art-ID → Status). */
  animals: Record<string, AnimalStatus>;
  /** Ø Zufriedenheit aller Tiere (0, wenn keine). */
  avgHappiness: number;
  /** Plätze je Nische auf der aktuellen Stufe. */
  slots: Record<NicheId, number>;
  genusCounts: Record<Genus, number>;
  /** Erreichte Gattungsbonus-Stufen (0–3) je Gattung. */
  traitTiers: Record<Genus, number>;
  /** Summe der Wachstumsboni (0,08 = +8 %), Samenboni und des Fraßschadens nach Räubern. */
  growthBonus: number;
  seedsBonus: number;
  damage: number;
  /** Schädlinge, deren Schaden zu mehr als der Hälfte wirkt. */
  unguarded: number;
  sunny: boolean;
  light: number;
  water: number;
}

/** Wer jagt wen (Räuber frisst ein Merkmal, das die Beute bereitstellt)? Statisch vorberechnet. */
const HUNTERS_OF: ReadonlyMap<string, readonly string[]> = new Map(
  SPECIES.map((prey) => [
    prey.id,
    SPECIES.filter((p) => p.id !== prey.id && p.level === 'predator' && p.food.some((t) => prey.provides.includes(t))).map(
      (p) => p.id,
    ),
  ]),
);

/** Plätze je Nische auf einer Stufe. */
export function nicheSlots(stage: number): Record<NicheId, number> {
  const slots = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) slots[id] = NICHES_BY_ID.get(id)!.slots[stage] ?? 0;
  return slots;
}

/** Bekannte Arten des Ökosystems in Nischen-Reihenfolge (unbekannte IDs werden übersprungen). */
function speciesIn(eco: Ecosystem): Species[] {
  const out: Species[] = [];
  for (const id of NICHE_IDS) {
    for (const sid of eco.niches[id] ?? []) {
      const sp = SPECIES_BY_ID.get(sid);
      if (sp) out.push(sp);
    }
  }
  return out;
}

/** Reine Berechnung ohne Cache – für Vorschauen und Tests. */
export function evaluateEcosystem(eco: Ecosystem): Evaluation {
  const stage = STAGES[eco.stage] ?? STAGES[0]!;
  const animals = speciesIn(eco);
  const present = new Set(animals.map((a) => a.id));

  // Pflanzengruppen: Im Prototyp gibt es nur den Hauptbaum (zählt als Baum).
  const groupCount: Record<PlantGroup, number> = { trees: 1, shrubs: 0, flowers: 0, mosses: 0 };

  // Futterangebot und -nachfrage je Merkmal
  const supply = new Map<Tag, number>();
  const addSupply = (tag: Tag, n: number) => supply.set(tag, (supply.get(tag) ?? 0) + n);
  for (const t of MAIN_TREE_TAGS) addSupply(t, SUPPLY_MAIN_TREE);
  if (eco.stage >= MAIN_TREE_NUTS_STAGE) addSupply('nuesse', SUPPLY_MAIN_TREE);
  for (const a of animals) for (const t of a.provides) addSupply(t, SUPPLY_ANIMAL);
  const demand = new Map<Tag, number>();
  for (const a of animals) for (const t of a.food) demand.set(t, (demand.get(t) ?? 0) + 1);

  const genusCounts = {} as Record<Genus, number>;
  for (const g of GENERA) genusCounts[g] = 0;
  for (const a of animals) genusCounts[a.genus]++;

  // Sonnig: Licht, das nach den (noch nicht vorhandenen) Begleitpflanzen frei bleibt.
  let openLight = stage.light;
  for (const a of animals) for (const e of a.effects) if (e.kind === 'light') openLight += e.amount;
  const sunny = openLight >= SUNNY_MIN_LIGHT;

  const condMet = (c: Condition): boolean => {
    switch (c.kind) {
      case 'sunny':
        return sunny;
      case 'tag':
        return (supply.get(c.tag) ?? 0) > 0;
      case 'group':
        return groupCount[c.group] >= c.min;
    }
  };

  // Zufriedenheit je Tier
  const status: Record<string, AnimalStatus> = {};
  let happinessSum = 0;
  for (const a of animals) {
    let food = 0;
    for (const t of a.food) {
      const s = supply.get(t) ?? 0;
      const d = demand.get(t) ?? 1;
      food = Math.max(food, Math.min(1, s / d));
    }
    const needs = a.needs.map(condMet);
    const met = needs.filter(Boolean).length;
    const q = (FOOD_WEIGHT * food + met) / (FOOD_WEIGHT + a.needs.length);
    const base = BASE_HAPPINESS[a.rarity] ?? 0;
    let z = base + (1 - base) * q;
    let hunters = 0;
    for (const h of HUNTERS_OF.get(a.id) ?? []) if (present.has(h)) hunters++;
    // Räuberdruck: Beute ist etwas weniger zufrieden, wenn sie gejagt wird.
    z -= PREDATION_PENALTY * Math.min(PREDATION_MAX_HUNTERS, hunters);
    z = Math.min(1, Math.max(0, z));
    status[a.id] = { happiness: z, food, needs, hunters };
    happinessSum += z;
  }

  // Wirkungen sammeln
  let growthBonus = 0;
  let seedsBonus = 0;
  let light = stage.light;
  let water = stage.water;
  const groupGrowth: Record<PlantGroup, number> = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 };
  const groupSeeds: Record<PlantGroup, number> = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 };
  const controls: { tag: Tag; strength: number }[] = [];
  const apply = (e: Effect, scale: number) => {
    switch (e.kind) {
      case 'growth':
        growthBonus += (e.pct / 100) * scale;
        break;
      case 'seeds':
        seedsBonus += (e.pct / 100) * scale;
        break;
      case 'groupGrowth':
        groupGrowth[e.group] += (e.pct / 100) * scale;
        break;
      case 'groupSeeds':
        groupSeeds[e.group] += (e.pct / 100) * scale;
        break;
      case 'water':
        water += e.amount * scale;
        break;
      case 'light':
        light += e.amount * scale;
        break;
      case 'control':
        controls.push({ tag: e.tag, strength: (e.pct / 100) * scale });
        break;
      case 'damage':
        break; // wird unten gesondert behandelt
    }
  };
  for (const a of animals) for (const e of a.effects) apply(e, status[a.id]!.happiness);
  const traitTiers = {} as Record<Genus, number>;
  for (const g of GENERA) {
    const tier = TRAIT_THRESHOLDS.filter((t) => genusCounts[g] >= t).length;
    traitTiers[g] = tier;
    for (let i = 0; i < tier; i++) for (const e of TRAITS[g][i]!.effects) apply(e, 1);
  }

  // Fraßschaden, gemindert durch Räuber (multiplikativ)
  let damage = 0;
  let unguarded = 0;
  for (const a of animals) {
    for (const e of a.effects) {
      if (e.kind !== 'damage') continue;
      let d = e.pct / 100;
      for (const c of controls) if (a.provides.includes(c.tag)) d *= Math.max(0, 1 - c.strength);
      damage += d;
      if (d > (e.pct / 100) * UNGUARDED_SHARE) unguarded++;
    }
  }

  // Nahrungspyramide (Hauptbaum zählt wie MAIN_TREE_WEIGHT Pflanzen)
  const herbivores = animals.filter((a) => a.level === 'herbivore').length;
  const predators = animals.filter((a) => a.level === 'predator');
  const decomposers = animals.filter((a) => a.level === 'decomposer').length;
  const plantWeight = MAIN_TREE_WEIGHT;
  const levels = (5 * [herbivores, predators.length, decomposers].filter((n) => n > 0).length) / 3;
  const carrying = herbivores > 0 ? 5 * Math.min(1, plantWeight / (1.5 * herbivores)) : 5;
  const fed = predators.length > 0 ? (5 * predators.reduce((s, p) => s + status[p.id]!.food, 0)) / predators.length : 0;
  const consumers = plantWeight + herbivores + predators.length;
  const cycle = 5 * Math.min(1, decomposers / (consumers / 5));
  const pyramid = levels + carrying + fed + cycle - UNGUARDED_PENALTY * unguarded;

  // Harmonie = Vielfalt + Zufriedenheit + Pyramide
  const variety = 3 * new Set(animals.map((a) => a.genus)).size + present.size;
  const avgHappiness = animals.length > 0 ? happinessSum / animals.length : 0;
  const happinessPoints = 30 * avgHappiness;
  const harmony = variety + happinessPoints + pyramid;
  const multiplier = 1 + harmony / HARMONY_DIVISOR;

  // Wachstum und Samen (Waldgedächtnis: +2 % je Punkt)
  const memory = 1 + FOREST_MEMORY_BONUS * Math.max(0, finite(eco.forestMemory));
  const factor = Math.max(MIN_GROWTH_FACTOR, 1 + growthBonus - damage);
  const growth = stage.treeGrowth * (1 + groupGrowth.trees) * factor * multiplier * memory;
  const seeds = stage.treeSeeds * (1 + groupSeeds.trees) * (1 + seedsBonus) * multiplier * memory;

  return {
    growth,
    seeds,
    harmony,
    multiplier,
    breakdown: { variety, happiness: happinessPoints, pyramid },
    animals: status,
    avgHappiness,
    slots: nicheSlots(eco.stage),
    genusCounts,
    traitTiers,
    growthBonus,
    seedsBonus,
    damage,
    unguarded,
    sunny,
    light,
    water,
  };
}

/**
 * Abgeleitete Werte des Spielstands. Gecacht: Sie ändern sich nur durch Aktionen und
 * Stufenwechsel, nicht pro Tick. Das Ergebnis nicht verändern (wird geteilt).
 */
export function evaluate(state: GameState): Readonly<Evaluation> {
  const key = ecosystemKey(state);
  if (cache && cache.key === key) return cache.value;
  const value = evaluateEcosystem({ stage: state.stage, niches: state.niches, forestMemory: state.meta.forestMemory });
  cache = { key, value };
  return value;
}

let cache: { key: string; value: Evaluation } | null = null;

function ecosystemKey(state: GameState): string {
  let key = `${state.stage}|${state.meta.forestMemory}`;
  for (const id of NICHE_IDS) key += `|${(state.niches[id] ?? []).join(',')}`;
  return key;
}

// ---------------------------------------------------------------------------
// Wegpunkte und Stufen
// ---------------------------------------------------------------------------

/** Benötigtes Gesamt-Wachstum für Wegpunkt k (0 für k ≤ 0, Infinity hinter dem letzten). */
export function thresholdFor(k: number): number {
  if (k <= 0) return 0;
  if (k > WAYPOINT_COUNT) return Infinity;
  return WAYPOINT_THRESHOLDS[k] ?? waypointThreshold(k);
}

/** Wie viele Wegpunkte hat dieses Gesamt-Wachstum erreicht? */
export function waypointsForGrowth(totalGrowth: number): number {
  let k = 0;
  while (k < WAYPOINT_COUNT && totalGrowth >= thresholdFor(k + 1)) k++;
  return k;
}

/** Höchste Stufe, deren Wegpunkt erreicht ist. */
export function stageForWaypoint(waypoint: number): number {
  let stage = 0;
  for (let i = 0; i < STAGES.length; i++) if (waypoint >= STAGES[i]!.waypoint) stage = i;
  return stage;
}

/** Fortschritt zum nächsten Wegpunkt in [0, 1]; 1 nach dem letzten. */
export function waypointProgress(state: GameState): number {
  return fraction(state.totalGrowth, thresholdFor(state.waypoint), thresholdFor(state.waypoint + 1));
}

/** Sekunden bis zum nächsten Wegpunkt bei aktuellem Wachstum (Infinity nach dem letzten). */
export function secondsToNextWaypoint(state: GameState): number {
  const next = thresholdFor(state.waypoint + 1);
  if (!Number.isFinite(next)) return Infinity;
  const rate = evaluate(state).growth;
  return rate > 0 ? Math.max(0, next - state.totalGrowth) / rate : Infinity;
}

/** Fortschritt zur nächsten Stufe in [0, 1] (linear im Gesamt-Wachstum). 1 auf der letzten Stufe. */
export function stageProgress(state: GameState): number {
  const current = STAGES[state.stage];
  const next = STAGES[state.stage + 1];
  if (!current || !next) return 1;
  return fraction(state.totalGrowth, thresholdFor(current.waypoint), thresholdFor(next.waypoint));
}

/**
 * Kontinuierlicher Wachstumswert für die Darstellung:
 * Stufen-Index + Fortschritt zur nächsten Stufe (z. B. 2.5 = halb vom Setzling zum jungen Baum).
 */
export function growth(state: GameState): number {
  return state.stage + stageProgress(state);
}

// ---------------------------------------------------------------------------
// Begegnungen: Kosten, Erträge, Zustand einer Karte
// ---------------------------------------------------------------------------

export type CardStatus =
  /** Freier Platz – „Wählen“ geht direkt. */
  | 'free'
  /** Nische voll – nur mit `replaceSpeciesId` (ein Tier entlassen). */
  | 'full'
  /** Die Art lebt schon im Ökosystem (z. B. aus einer früheren Begegnung gewählt). */
  | 'present'
  /** Nische auf dieser Stufe noch geschlossen. */
  | 'closed'
  /** Unbekannte Begegnung, Karte oder Art. */
  | 'invalid';

export function cardStatus(state: GameState, encounterIndex: number, cardIndex: number): CardStatus {
  const id = state.pendingEncounters[encounterIndex]?.cards[cardIndex];
  const sp = id === undefined ? undefined : SPECIES_BY_ID.get(id);
  if (!sp) return 'invalid';
  if (NICHE_IDS.some((n) => state.niches[n].includes(sp.id))) return 'present';
  const slots = nicheSlots(state.stage)[sp.niche];
  if (slots <= 0) return 'closed';
  return state.niches[sp.niche].length < slots ? 'free' : 'full';
}

/**
 * Wie sähe das Ökosystem aus, wenn diese Karte gewählt würde? null, wenn die Wahl so
 * nicht möglich ist. Für Vorschauen auf Karten (Zufriedenheit, Harmonie, 🌿/s).
 */
export function previewChoice(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceSpeciesId?: string,
): Evaluation | null {
  const status = cardStatus(state, encounterIndex, cardIndex);
  const sp = SPECIES_BY_ID.get(state.pendingEncounters[encounterIndex]?.cards[cardIndex] ?? '');
  if (!sp || (status !== 'free' && status !== 'full')) return null;
  const niches = { ...state.niches };
  const occupants = state.niches[sp.niche];
  if (replaceSpeciesId !== undefined) {
    if (!occupants.includes(replaceSpeciesId)) return null;
    niches[sp.niche] = occupants.map((x) => (x === replaceSpeciesId ? sp.id : x));
  } else {
    if (status === 'full') return null;
    niches[sp.niche] = [...occupants, sp.id];
  }
  return evaluateEcosystem({ stage: state.stage, niches, forestMemory: state.meta.forestMemory });
}

/** Samen für „Ablehnen“. */
export function declineReward(): number {
  return DECLINE_SEEDS;
}

/** Kosten für „Neu würfeln“ dieser Begegnung (verdoppelt sich je Wurf). */
export function rerollCost(state: GameState, encounterIndex: number): number {
  const rerolls = state.pendingEncounters[encounterIndex]?.rerolls ?? 0;
  return REROLL_BASE_COST * Math.pow(REROLL_COST_GROWTH, Math.max(0, rerolls));
}

function fraction(value: number, from: number, to: number): number {
  if (!Number.isFinite(to) || to <= from) return 1;
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
