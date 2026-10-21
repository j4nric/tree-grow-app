import {
  ARCHITECT,
  CALM_MIN_HAPPINESS,
  COMMUNITY_BOOST_HARMONY,
  COUNTS_AS_GENUS,
  DECOMPOSER_BOOST,
  FEAR_LIGHT_FACTOR,
  MIN_SUPPLY_FLOOR,
  NIGHT_WATCH,
  NO_WATER_GROUP,
  RARITY_BOOST_POINTS,
} from '../content/abilities';
import { COMMUNITIES, type CommunityMember } from '../content/communities';
import { DECLINE_SEEDS, RARITY_WEIGHTS, REROLL_BASE_COST, REROLL_COST_GROWTH } from '../content/encounters';
import {
  FOREST_MEMORY_BONUS,
  MEMORY_HARMONY_DIVISOR,
  MEMORY_PER_NEW_SPECIES,
  MEMORY_PER_REGULAR_SLOT,
} from '../content/memory';
import { NICHES_BY_ID } from '../content/niches';
import { PLANTS_BY_ID, PLANT_COST_BASE, PLANT_COST_GROWTH, type Plant } from '../content/plants';
import { BASE_HAPPINESS, SPECIES, SPECIES_BY_ID, type Species } from '../content/species';
import { MAIN_TREE_NUTS_STAGE, MAIN_TREE_TAGS, MAIN_TREE_WEIGHT, STAGES } from '../content/stages';
import { TRAITS, TRAIT_THRESHOLDS } from '../content/traits';
import {
  GENERA,
  NICHE_IDS,
  type AbilityId,
  type Condition,
  type Effect,
  type Genus,
  type NicheId,
  type PlantGroup,
  type Tag,
} from '../content/types';
import { WAYPOINT_COUNT, WAYPOINT_THRESHOLDS, waypointThreshold } from '../content/waypoints';
import { MAX_FOREST_MEMORY, type GameState, type PendingEncounterType } from './state';

/*
 * Rechenmodell v2: Zufriedenheit, Harmonie, Versorgung, Wachstum/s, Samen/s.
 * Formeln aus docs/DESIGN_V2.md, Abschnitt 2 und 9, mit allen 32 Arten, Störung,
 * Fähigkeiten und Lebensgemeinschaften – noch ohne Ereignisse und Durchreisende (2.4).
 * Referenz: scripts/v2/model.ts (Tests vergleichen beide).
 */

/** Gewicht der Nahrung gegenüber einem einzelnen Lebensraum-Wunsch. */
export const FOOD_WEIGHT = 2;
/** Abzug je störender Art (Wirkung `disturb`). */
export const DISTURB_PENALTY = 0.15;
/** Abzug je Räuber, der eine Art jagt (höchstens zwei Räuber zählen). */
export const PREDATION_PENALTY = 0.1;
export const PREDATION_MAX_HUNTERS = 2;
/** „Sonnig“: so viel Licht bleibt nach den Begleitpflanzen frei. */
export const SUNNY_MIN_LIGHT = 2;
/** „Schattig“: so viele Bäume (inkl. Hauptbaum). */
export const SHADY_MIN_TREES = 3;
/** Futtereinheiten je Anbieter. */
export const SUPPLY_MAIN_TREE = 2;
export const SUPPLY_PLANT = 1;
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
  /** Begleitpflanzen (Duplikate erlaubt). Fehlt das Feld, wächst nur der Hauptbaum. */
  plants?: readonly string[];
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
  /** Anzahl anwesender Arten, die diese Art stören (Wirkung `disturb`). */
  disturbers: number;
}

/** Zustand einer Lebensgemeinschaft (Reihenfolge wie COMMUNITIES). */
export interface CommunityStatus {
  id: string;
  /** Alle Mitglieder leben bzw. wachsen im Ökosystem. */
  active: boolean;
  /** Erfüllte Mitglieder (eine Alternative genügt) von `total`. */
  present: number;
  total: number;
  /**
   * Fehlende Mitglieder: je Eintrag die Art- oder Pflanzen-IDs, von denen eine genügt
   * (meist nur eine, z. B. ['bee'] oder ['chanterelle', 'porcini']). Leer, wenn aktiv.
   */
  missing: string[][];
  /** Harmonie, die sie gerade bringt (inkl. Lichterabend); 0, wenn nicht aktiv. */
  harmony: number;
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
  /**
   * Bausteine der Harmonie (Summe = harmony): `pyramid` enthält den Abzug für
   * unbewachte Schädlinge, `communities` die Lebensgemeinschaften inkl. Lichterabend,
   * `extra` die Harmonie-Wirkungen der Tiere (Glühwürmchen, Hirschkäfer).
   */
  breakdown: { variety: number; happiness: number; pyramid: number; communities: number; extra: number };
  /** Alle Lebensgemeinschaften mit Zustand (aktive und fehlende Mitglieder). */
  communities: CommunityStatus[];
  /** Zustand je Tier (Art-ID → Status). */
  animals: Record<string, AnimalStatus>;
  /** Ø Zufriedenheit aller Tiere (0, wenn keine). */
  avgHappiness: number;
  /** Plätze je Nische auf der aktuellen Stufe. */
  slots: Record<NicheId, number>;
  /** Tiere je Gattung (das Braune Langohr zählt per Fähigkeit auch als Vogel). */
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
  /** Schattig: mindestens SHADY_MIN_TREES Bäume (inkl. Hauptbaum). */
  shady: boolean;
  /** Wirksame Fähigkeiten (je einmal, in Nischen-Reihenfolge der Arten). */
  abilities: AbilityId[];
  /** Licht- und Wasserangebot (Stufe + Wirkungen der Tiere und Gattungsboni). */
  light: number;
  water: number;
  /** Licht- und Wasserbedarf aller Begleitpflanzen (Wasser negativ: Moos speichert). */
  lightNeed: number;
  waterNeed: number;
  /**
   * Versorgung V der Begleitpflanzen in [0, 1] = min(1, Licht/Bedarf, Wasser/Bedarf).
   * Bremst nur die Begleitpflanzen, nicht den Hauptbaum (DESIGN_V2.md 2.5).
   */
  supply: number;
  /** Pflanzen je Gruppe, Hauptbaum zählt als Baum. */
  groupCounts: Record<PlantGroup, number>;
  /** Anteil der Begleitpflanzen an 🌿/s und 🌰/s (schon mit V, Boni und Harmonie). */
  plantGrowth: number;
  plantSeeds: number;
  /** Pflanzplätze auf dieser Stufe (Größe des Pflanzrings). */
  plantSlots: number;
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

/** Wer stört wen (Wirkung `disturb`)? Statisch vorberechnet. */
const DISTURBERS_OF: ReadonlyMap<string, readonly string[]> = new Map(
  SPECIES.map((target) => [
    target.id,
    SPECIES.filter((o) => o.effects.some((e) => e.kind === 'disturb' && e.target === target.id)).map((o) => o.id),
  ]),
);

/** Hat die Art diese Fähigkeit? */
export function hasAbility(sp: Pick<Species, 'effects'>, id: AbilityId): boolean {
  return sp.effects.some((e) => e.kind === 'ability' && e.id === id);
}

/**
 * Plätze, die eine Art schafft: ihre Wirkungen `slot` und die der Fähigkeit Baumeister.
 * Gilt, solange die Art lebt – unabhängig von ihrer Zufriedenheit.
 */
export function slotEffects(sp: Pick<Species, 'effects'>): { niche: NicheId; amount: number }[] {
  const out: { niche: NicheId; amount: number }[] = [];
  for (const e of sp.effects) {
    if (e.kind === 'slot') out.push({ niche: e.niche, amount: e.amount });
    if (e.kind === 'ability' && e.id === 'architect') out.push(...ARCHITECT.slots);
  }
  return out;
}

/**
 * Plätze je Nische auf einer Stufe. Mit `niches` zählen auch die Plätze, die Tiere
 * schaffen (Wirkung `slot`, z. B. Borkenkäfer → +1 Höhlen). Solche Plätze öffnen eine
 * geschlossene Nische nur, wenn sie `opensEarly` hat (DESIGN_V2.md, Abschnitt 3).
 */
export function nicheSlots(stage: number, niches?: Partial<Record<NicheId, readonly string[]>>): Record<NicheId, number> {
  const slots = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) slots[id] = NICHES_BY_ID.get(id)!.slots[stage] ?? 0;
  if (!niches) return slots;
  const extra = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) extra[id] = 0;
  for (const id of NICHE_IDS) {
    for (const sid of niches[id] ?? []) {
      const sp = SPECIES_BY_ID.get(sid);
      if (sp) for (const e of slotEffects(sp)) extra[e.niche] += e.amount;
    }
  }
  for (const id of NICHE_IDS) {
    if (slots[id] > 0 || NICHES_BY_ID.get(id)!.opensEarly) slots[id] = Math.max(0, slots[id] + extra[id]);
  }
  return slots;
}

/** Wie viele Tiere je Nische keinen Platz haben (0, wenn alles passt). */
export function nicheOverflow(stage: number, niches: Partial<Record<NicheId, readonly string[]>>): Record<NicheId, number> {
  const slots = nicheSlots(stage, niches);
  const out = {} as Record<NicheId, number>;
  for (const id of NICHE_IDS) out[id] = Math.max(0, (niches[id]?.length ?? 0) - slots[id]);
  return out;
}

/** Bekannte Begleitpflanzen (unbekannte IDs werden übersprungen). */
function plantsIn(eco: Ecosystem): Plant[] {
  const out: Plant[] = [];
  for (const id of eco.plants ?? []) {
    const p = PLANTS_BY_ID.get(id);
    if (p) out.push(p);
  }
  return out;
}

/** Pflanzplätze auf einer Stufe (0 für unbekannte Stufen). */
export function plantSlots(stage: number): number {
  return STAGES[stage]?.plantSlots ?? 0;
}

/** Kosten der nächsten Pflanze, wenn schon `count` Begleitpflanzen wachsen: 20 · 1,9^count. */
export function plantCost(count: number): number {
  return PLANT_COST_BASE * Math.pow(PLANT_COST_GROWTH, Math.max(0, finite(count)));
}

/** Kosten der nächsten Pflanze in diesem Spielstand. */
export function nextPlantCost(state: Pick<GameState, 'plants'>): number {
  return plantCost(state.plants.length);
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

/** IDs, von denen eine ein Mitglied der Lebensgemeinschaft erfüllt. */
export function memberOptions(member: CommunityMember): readonly string[] {
  return typeof member === 'string' ? [member] : member;
}

/** IDs der aktiven Lebensgemeinschaften einer Auswertung. */
export function activeCommunities(ev: Pick<Evaluation, 'communities'>): string[] {
  return ev.communities.filter((c) => c.active).map((c) => c.id);
}

/** Reine Berechnung ohne Cache – für Vorschauen und Tests. */
export function evaluateEcosystem(eco: Ecosystem): Evaluation {
  const stage = STAGES[eco.stage] ?? STAGES[0]!;
  const animals = speciesIn(eco);
  const plants = plantsIn(eco);
  const present = new Set(animals.map((a) => a.id));
  // Für Wünsche „bestimmte Art“ zählen auch Pflanzen (z. B. Große Brennnessel).
  const presentOrPlanted = new Set<string>([...present, ...plants.map((p) => p.id)]);

  // Pflanzengruppen (Hauptbaum zählt als Baum)
  const groupCount: Record<PlantGroup, number> = { trees: 1, shrubs: 0, flowers: 0, mosses: 0 };
  for (const p of plants) groupCount[p.group]++;

  // Futterangebot und -nachfrage je Merkmal
  const foodSupply = new Map<Tag, number>();
  const addSupply = (tag: Tag, n: number) => foodSupply.set(tag, (foodSupply.get(tag) ?? 0) + n);
  for (const t of MAIN_TREE_TAGS) addSupply(t, SUPPLY_MAIN_TREE);
  if (eco.stage >= MAIN_TREE_NUTS_STAGE) addSupply('nuesse', SUPPLY_MAIN_TREE);
  for (const p of plants) for (const t of p.provides) addSupply(t, SUPPLY_PLANT);
  for (const a of animals) for (const t of a.provides) addSupply(t, SUPPLY_ANIMAL);
  const demand = new Map<Tag, number>();
  for (const a of animals) for (const t of a.food) demand.set(t, (demand.get(t) ?? 0) + 1);

  // Fähigkeiten wirken je einmal, solange ihre Art lebt.
  const abilities = new Set<AbilityId>();
  for (const a of animals) for (const e of a.effects) if (e.kind === 'ability') abilities.add(e.id);

  const genusCounts = {} as Record<Genus, number>;
  for (const g of GENERA) genusCounts[g] = 0;
  for (const a of animals) {
    genusCounts[a.genus]++;
    if (hasAbility(a, 'countsAsBird')) genusCounts[COUNTS_AS_GENUS]++;
  }

  // Sonnig: Licht, das nach allen Begleitpflanzen frei bleibt (Tier-Lichtboni zählen voll).
  let openLight = stage.light;
  for (const p of plants) openLight -= p.light;
  for (const a of animals) for (const e of a.effects) if (e.kind === 'light') openLight += e.amount;
  const sunny = openLight >= SUNNY_MIN_LIGHT;
  const shady = groupCount.trees >= SHADY_MIN_TREES;

  const condMet = (c: Condition): boolean => {
    switch (c.kind) {
      case 'sunny':
        return sunny;
      case 'shady':
        return shady;
      case 'tag':
        return (foodSupply.get(c.tag) ?? 0) > 0;
      case 'group':
        return groupCount[c.group] >= c.min;
      case 'species':
        return presentOrPlanted.has(c.id);
      case 'genus':
        return genusCounts[c.genus] >= c.min;
    }
  };

  // Landschaft der Angst: Beute eines Jägers mit `fear` frisst nicht und lichtet doppelt.
  const fearful = new Set<string>();
  for (const hunter of animals) {
    if (!hasAbility(hunter, 'fear')) continue;
    for (const prey of animals) if (prey.provides.some((t) => hunter.food.includes(t))) fearful.add(prey.id);
  }

  // Zufriedenheit je Tier
  const status: Record<string, AnimalStatus> = {};
  let happinessSum = 0;
  for (const a of animals) {
    let food = 0;
    for (const t of a.food) {
      const s = foodSupply.get(t) ?? 0;
      const d = demand.get(t) ?? 1;
      food = Math.max(food, Math.min(1, s / d));
    }
    const needs = a.needs.map(condMet);
    const met = needs.filter(Boolean).length;
    const q = (FOOD_WEIGHT * food + met) / (FOOD_WEIGHT + a.needs.length);
    const base = BASE_HAPPINESS[a.rarity] ?? 0;
    let z = base + (1 - base) * q;
    let disturbers = 0;
    for (const d of DISTURBERS_OF.get(a.id) ?? []) if (present.has(d)) disturbers++;
    z -= DISTURB_PENALTY * disturbers;
    let hunters = 0;
    for (const h of HUNTERS_OF.get(a.id) ?? []) if (present.has(h)) hunters++;
    // Räuberdruck: Beute ist etwas weniger zufrieden, wenn sie gejagt wird.
    z -= PREDATION_PENALTY * Math.min(PREDATION_MAX_HUNTERS, hunters);
    if (abilities.has('decomposerBoost') && a.level === DECOMPOSER_BOOST.level) z += DECOMPOSER_BOOST.happiness;
    if (abilities.has('architect') && a.niche === ARCHITECT.niche) z += ARCHITECT.happiness;
    if (hasAbility(a, 'calm')) z = Math.max(z, CALM_MIN_HAPPINESS);
    z = Math.min(1, Math.max(0, z));
    status[a.id] = { happiness: z, food, needs, hunters, disturbers };
    happinessSum += z;
  }

  // Wirkungen sammeln
  let growthBonus = 0;
  let seedsBonus = 0;
  let harmonyExtra = 0;
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
      case 'harmony':
        harmonyExtra += e.points * scale;
        break;
      case 'damage':
      case 'slot':
      case 'disturb':
      case 'ability':
        break; // Fraß unten gesondert, Plätze in nicheSlots(), Störung und Fähigkeiten oben
    }
  };
  for (const a of animals) {
    const z = status[a.id]!.happiness;
    for (const e of a.effects) apply(e, z);
    if (fearful.has(a.id)) {
      for (const e of a.effects) if (e.kind === 'light') light += e.amount * z * (FEAR_LIGHT_FACTOR - 1);
    }
  }
  const traitTiers = {} as Record<Genus, number>;
  for (const g of GENERA) {
    const tier = TRAIT_THRESHOLDS.filter((t) => genusCounts[g] >= t).length;
    traitTiers[g] = tier;
    for (let i = 0; i < tier; i++) for (const e of TRAITS[g][i]!.effects) apply(e, 1);
  }

  // Lebensgemeinschaften: Mitglieder sind Tiere oder Begleitpflanzen.
  const communityBonus = abilities.has('communityBoost') ? COMMUNITY_BOOST_HARMONY : 0;
  let communityPoints = 0;
  const communities: CommunityStatus[] = COMMUNITIES.map((c) => {
    const missing: string[][] = [];
    for (const m of c.members) {
      const options = memberOptions(m);
      if (!options.some((id) => presentOrPlanted.has(id))) missing.push([...options]);
    }
    const active = missing.length === 0;
    const points = active ? c.harmony + communityBonus : 0;
    if (active) {
      communityPoints += points;
      for (const e of c.effects) apply(e, 1);
    }
    return { id: c.id, active, present: c.members.length - missing.length, total: c.members.length, missing, harmony: points };
  });

  // Fraßschaden, gemindert durch Räuber (multiplikativ) und Fähigkeiten
  let damage = 0;
  let unguarded = 0;
  for (const a of animals) {
    for (const e of a.effects) {
      if (e.kind !== 'damage') continue;
      let d = e.pct / 100;
      if (fearful.has(a.id)) d = 0;
      for (const c of controls) if (a.provides.includes(c.tag)) d *= Math.max(0, 1 - c.strength);
      if (abilities.has('nightWatch') && a.level === NIGHT_WATCH.level) d *= 1 - NIGHT_WATCH.reduction;
      damage += d;
      if (d > (e.pct / 100) * UNGUARDED_SHARE) unguarded++;
    }
  }

  // Versorgung der Begleitpflanzen mit Licht und Wasser
  let lightNeed = 0;
  let waterNeed = 0;
  for (const p of plants) {
    lightNeed += p.light;
    // Hüter der Feuchte: Moose & Farne brauchen kein Wasser (Moos speichert weiter).
    waterNeed += abilities.has('mossNoWater') && p.group === NO_WATER_GROUP ? Math.min(0, p.water) : p.water;
  }
  let supply = 1;
  if (lightNeed > 0) supply = Math.min(supply, light / lightNeed);
  if (waterNeed > 0) supply = Math.min(supply, water / waterNeed);
  if (abilities.has('minSupply')) supply = Math.max(supply, MIN_SUPPLY_FLOOR);
  supply = Math.max(0, Math.min(1, supply));

  // Nahrungspyramide (Hauptbaum zählt wie MAIN_TREE_WEIGHT Pflanzen)
  const herbivores = animals.filter((a) => a.level === 'herbivore').length;
  const predators = animals.filter((a) => a.level === 'predator');
  const decomposers = animals.filter((a) => a.level === 'decomposer').length;
  const plantWeight = MAIN_TREE_WEIGHT + plants.length;
  const levels = (5 * [herbivores, predators.length, decomposers].filter((n) => n > 0).length) / 3;
  const carrying = herbivores > 0 ? 5 * Math.min(1, plantWeight / (1.5 * herbivores)) : 5;
  const fed = predators.length > 0 ? (5 * predators.reduce((s, p) => s + status[p.id]!.food, 0)) / predators.length : 0;
  const consumers = plantWeight + herbivores + predators.length;
  const cycle = 5 * Math.min(1, decomposers / (consumers / 5));
  const pyramid = levels + carrying + fed + cycle - UNGUARDED_PENALTY * unguarded;

  // Harmonie = Vielfalt + Zufriedenheit + Pyramide + Lebensgemeinschaften + Harmonie-Wirkungen
  // Vielfalt: 3 je Gattung und je Pflanzengruppe mit Begleitpflanzen, 1 je verschiedene Art.
  const groups = new Set<string>(animals.map((a) => a.genus));
  for (const p of plants) groups.add(`plant:${p.group}`);
  const variety = 3 * groups.size + present.size + new Set(plants.map((p) => p.id)).size;
  const avgHappiness = animals.length > 0 ? happinessSum / animals.length : 0;
  const happinessPoints = 30 * avgHappiness;
  const harmony = variety + happinessPoints + pyramid + communityPoints + harmonyExtra;
  const multiplier = 1 + harmony / HARMONY_DIVISOR;

  // Wachstum und Samen (Waldgedächtnis: +2 % je Punkt)
  const memory = 1 + FOREST_MEMORY_BONUS * Math.min(MAX_FOREST_MEMORY, Math.max(0, finite(eco.forestMemory)));
  // Begleitpflanzen wachsen mit der Versorgung V, der Hauptbaum unabhängig davon.
  let companionGrowth = 0;
  let companionSeeds = 0;
  for (const p of plants) {
    companionGrowth += p.growth * (1 + groupGrowth[p.group]);
    companionSeeds += p.seeds * (1 + groupSeeds[p.group]);
  }
  const factor = Math.max(MIN_GROWTH_FACTOR, 1 + growthBonus - damage);
  const tree = stage.treeGrowth * (1 + groupGrowth.trees);
  const growthScale = factor * multiplier * memory;
  const growth = (tree + supply * companionGrowth) * growthScale;
  const treeSeeds = stage.treeSeeds * (1 + groupSeeds.trees);
  const seedsScale = (1 + seedsBonus) * multiplier * memory;
  const seeds = (treeSeeds + supply * companionSeeds) * seedsScale;

  return {
    growth,
    seeds,
    harmony,
    multiplier,
    breakdown: { variety, happiness: happinessPoints, pyramid, communities: communityPoints, extra: harmonyExtra },
    communities,
    animals: status,
    avgHappiness,
    slots: nicheSlots(eco.stage, eco.niches),
    genusCounts,
    traitTiers,
    growthBonus,
    seedsBonus,
    damage,
    unguarded,
    sunny,
    shady,
    abilities: [...abilities],
    light,
    water,
    lightNeed,
    waterNeed,
    supply,
    groupCounts: groupCount,
    plantGrowth: supply * companionGrowth * growthScale,
    plantSeeds: supply * companionSeeds * seedsScale,
    plantSlots: plantSlots(eco.stage),
  };
}

/**
 * Abgeleitete Werte des Spielstands. Gecacht: Sie ändern sich nur durch Aktionen und
 * Stufenwechsel, nicht pro Tick. Das Ergebnis wird geteilt und ist darum tief
 * eingefroren – Schreibversuche werfen im Strict Mode einen Fehler.
 */
export function evaluate(state: GameState): Readonly<Evaluation> {
  const key = ecosystemKey(state);
  if (cache && cache.key === key) return cache.value;
  const value = deepFreeze(
    evaluateEcosystem({
      stage: state.stage,
      niches: state.niches,
      plants: state.plants,
      forestMemory: state.meta.forestMemory,
    }),
  );
  cache = { key, value };
  return value;
}

/** Friert ein Objekt samt aller verschachtelten Objekte und Arrays ein. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

let cache: { key: string; value: Evaluation } | null = null;

function ecosystemKey(state: GameState): string {
  let key = `${state.stage}|${state.meta.forestMemory}|${(state.plants ?? []).join(',')}`;
  for (const id of NICHE_IDS) key += `|${(state.niches[id] ?? []).join(',')}`;
  return key;
}

// ---------------------------------------------------------------------------
// Tierkarten: Erscheinungsbedingungen und Seltenheitsgewichte
// ---------------------------------------------------------------------------

/**
 * Was im Ökosystem da ist – Grundlage für Erscheinungsbedingungen. Einmal berechnen und
 * für viele Arten nutzen (z. B. beim Ziehen der Tierkarten).
 */
export interface AppearsContext {
  tags: ReadonlySet<Tag>;
  /** Arten und Pflanzen im Ökosystem. */
  ids: ReadonlySet<string>;
  /** Pflanzen je Gruppe, Hauptbaum zählt als Baum. */
  groups: Readonly<Record<PlantGroup, number>>;
  /** Tiere je Gattung – ohne Fähigkeiten (das Langohr zählt hier nicht als Vogel). */
  genera: Readonly<Record<Genus, number>>;
}

export function appearsContext(eco: Pick<Ecosystem, 'stage' | 'niches' | 'plants'>): AppearsContext {
  const animals = speciesIn({ ...eco, forestMemory: 0 });
  const plants = plantsIn({ ...eco, forestMemory: 0 });
  const tags = new Set<Tag>(MAIN_TREE_TAGS);
  if (eco.stage >= MAIN_TREE_NUTS_STAGE) tags.add('nuesse');
  for (const p of plants) for (const t of p.provides) tags.add(t);
  for (const a of animals) for (const t of a.provides) tags.add(t);
  const groups: Record<PlantGroup, number> = { trees: 1, shrubs: 0, flowers: 0, mosses: 0 };
  for (const p of plants) groups[p.group]++;
  const genera = {} as Record<Genus, number>;
  for (const g of GENERA) genera[g] = 0;
  for (const a of animals) genera[a.genus]++;
  const ids = new Set<string>([...animals.map((a) => a.id), ...plants.map((p) => p.id)]);
  return { tags, ids, groups, genera };
}

/**
 * Ist die Erscheinungsbedingung der Art erfüllt (DESIGN_V2.md 5.2, 7.3)? Arten ohne
 * `appears` erscheinen immer. Geprüft wird nur, was im Ökosystem da ist: Merkmale
 * (Hauptbaum, Pflanzen, Tiere), Pflanzengruppen, Arten/Pflanzen und Gattungen (ohne
 * Fähigkeiten). „sonnig“ und „schattig“ gelten hier immer als erfüllt. Gilt nur fürs
 * Anbieten: Eine schon gezogene Karte bleibt wählbar, auch wenn die Bedingung wegfällt.
 * `eco` darf ein vorberechneter Kontext (appearsContext) sein.
 */
export function speciesAppears(
  eco: Pick<Ecosystem, 'stage' | 'niches' | 'plants'> | AppearsContext,
  sp: Pick<Species, 'appears'>,
): boolean {
  if (!sp.appears || sp.appears.length === 0) return true;
  const ctx = 'tags' in eco ? eco : appearsContext(eco);
  const met = (c: Condition): boolean => {
    switch (c.kind) {
      case 'sunny':
      case 'shady':
        return true;
      case 'tag':
        return ctx.tags.has(c.tag);
      case 'group':
        return ctx.groups[c.group] >= c.min;
      case 'species':
        return ctx.ids.has(c.id);
      case 'genus':
        return ctx.genera[c.genus] >= c.min;
    }
  };
  return sp.appears.every(met);
}

/**
 * Seltenheitsgewichte [gewöhnlich, selten, besonders, legendär] für Tierkarten auf der
 * Stufe des Ökosystems (DESIGN_V2.md 7.3; RARITY_WEIGHTS in content/encounters.ts). Glückspilz (`rarityBoost`): selten, besonders
 * und legendär je +RARITY_BOOST_POINTS, gewöhnlich −3 × so viel (nie unter 0).
 */
export function rarityWeights(eco: Pick<Ecosystem, 'stage' | 'niches'>): [number, number, number, number] {
  // Ungültige Stufen: auf die Tabelle begrenzen (NaN → Samen).
  const row = Math.min(Math.max(0, Math.floor(finite(eco.stage))), RARITY_WEIGHTS.length - 1);
  const base = RARITY_WEIGHTS[row]!;
  const lucky = speciesIn({ ...eco, forestMemory: 0 }).some((sp) => hasAbility(sp, 'rarityBoost'));
  const b = lucky ? RARITY_BOOST_POINTS : 0;
  return [Math.max(0, base[0] - 3 * b), base[1] + b, base[2] + b, base[3] + b];
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
  /** Nische bzw. Pflanzring voll – nur mit Ersatz (ein Tier entlassen / eine Pflanze ersetzen). */
  | 'full'
  /** Die Art lebt schon im Ökosystem (nur Tiere; Pflanzen dürfen mehrfach wachsen). */
  | 'present'
  /** Nische bzw. Pflanzring auf dieser Stufe noch geschlossen. */
  | 'closed'
  /** Unbekannte Begegnung, Karte, Art oder Pflanze. */
  | 'invalid';

/** Typ einer offenen Begegnung (undefined, wenn es sie nicht gibt). */
export function encounterType(state: GameState, encounterIndex: number): PendingEncounterType | undefined {
  return state.pendingEncounters[encounterIndex]?.type;
}

/**
 * Zustand einer Karte. Für Tierkarten zählt die Nische der Art, für Pflanzenkarten
 * („Etwas keimt“) der Pflanzring. Ob ein bestimmter Tausch erlaubt ist, sagt
 * `choiceBlocker` (z. B. 'would-evict').
 */
export function cardStatus(state: GameState, encounterIndex: number, cardIndex: number): CardStatus {
  const encounter = state.pendingEncounters[encounterIndex];
  const id = encounter?.cards[cardIndex];
  if (encounter === undefined || id === undefined) return 'invalid';
  if (encounter.type === 'plant') {
    const plant = PLANTS_BY_ID.get(id);
    if (!plant) return 'invalid';
    const slots = plantSlots(state.stage);
    // Gesperrte Pflanzen (später freigeschaltet) behandeln wie einen geschlossenen Ring.
    if (slots <= 0 || plant.unlock > state.stage) return 'closed';
    return state.plants.length < slots ? 'free' : 'full';
  }
  const sp = SPECIES_BY_ID.get(id);
  if (!sp) return 'invalid';
  if (hasSpecies(state, sp.id)) return 'present';
  const slots = nicheSlots(state.stage, state.niches)[sp.niche];
  if (slots <= 0) return 'closed';
  return (state.niches[sp.niche]?.length ?? 0) < slots ? 'free' : 'full';
}

/** Lebt die Art irgendwo im Ökosystem? */
export function hasSpecies(state: Pick<GameState, 'niches'>, speciesId: string): boolean {
  return NICHE_IDS.some((n) => (state.niches[n] ?? []).includes(speciesId));
}

/** Warum eine Karte nicht gewählt werden kann (gleiche Codes wie die Aktion chooseCard). */
export type ChoiceError =
  | 'no-encounter'
  | 'no-card'
  | 'present'
  | 'closed'
  /** Nische voll, kein Tier zum Entlassen genannt. */
  | 'niche-full'
  /** Pflanzring voll, keine Pflanze zum Ersetzen genannt. */
  | 'ring-full'
  /** Der genannte Ersatz lebt nicht in dieser Nische bzw. wächst nicht im Pflanzring. */
  | 'invalid-replace'
  /**
   * Der Tausch nähme anderen Tieren den Platz: Das entlassene Tier schafft Plätze
   * (Borkenkäfer → Höhlen), die noch bewohnt sind.
   */
  | 'would-evict';

/** Ökosystem nach einer Wahl – oder der Grund, warum sie nicht geht. */
export type ChoiceOutcome =
  | { ok: true; niches: Record<NicheId, string[]>; plants: string[] }
  | { ok: false; error: ChoiceError };

/**
 * Rechnet die Wahl einer Karte durch, ohne den Spielstand zu ändern. Grundlage für
 * chooseCard, previewChoice und choiceBlocker – alle drei sind darum immer einig.
 * `replaceId`: bei Tierkarten eine Art der Nische, bei Pflanzenkarten eine Pflanze im Ring.
 */
export function resolveChoice(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): ChoiceOutcome {
  const encounter = state.pendingEncounters[encounterIndex];
  if (!encounter) return { ok: false, error: 'no-encounter' };
  const status = cardStatus(state, encounterIndex, cardIndex);
  if (status === 'invalid') return { ok: false, error: 'no-card' };
  if (status === 'present') return { ok: false, error: 'present' };
  if (status === 'closed') return { ok: false, error: 'closed' };
  const id = encounter.cards[cardIndex]!;
  if (encounter.type === 'plant') {
    if (replaceId === undefined && status === 'full') return { ok: false, error: 'ring-full' };
    const plants = plantsAfterChoice(state, id, replaceId);
    if (!plants) return { ok: false, error: 'invalid-replace' };
    return { ok: true, niches: copyNiches(state.niches), plants };
  }
  const sp = SPECIES_BY_ID.get(id)!;
  if (replaceId !== undefined && !(state.niches[sp.niche] ?? []).includes(replaceId)) {
    return { ok: false, error: 'invalid-replace' };
  }
  if (replaceId === undefined && status === 'full') return { ok: false, error: 'niche-full' };
  // Entlassene Tiere können Plätze mitnehmen (Borkenkäfer → Höhlen): nur erlaubt,
  // wenn danach kein Tier ohne Platz dasteht.
  const niches = nichesAfterChoice(state, sp.id, replaceId);
  if (!niches) return { ok: false, error: 'would-evict' };
  return { ok: true, niches, plants: [...state.plants] };
}

/** Warum diese Wahl nicht geht – null, wenn chooseCard sie annähme. */
export function choiceBlocker(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): ChoiceError | null {
  const outcome = resolveChoice(state, encounterIndex, cardIndex, replaceId);
  return outcome.ok ? null : outcome.error;
}

/**
 * Wie sähe das Ökosystem aus, wenn diese Karte gewählt würde? null genau dann, wenn
 * chooseCard die Wahl ablehnen würde (Grund: choiceBlocker). Für Vorschauen auf
 * Tier- und Pflanzenkarten (Zufriedenheit, Harmonie, 🌿/s, 🌰/s).
 */
export function previewChoice(
  state: GameState,
  encounterIndex: number,
  cardIndex: number,
  replaceId?: string,
): Evaluation | null {
  const outcome = resolveChoice(state, encounterIndex, cardIndex, replaceId);
  if (!outcome.ok) return null;
  return evaluateEcosystem({
    stage: state.stage,
    niches: outcome.niches,
    plants: outcome.plants,
    forestMemory: state.meta.forestMemory,
  });
}

/**
 * Vorschau für „Pflanze setzen“ (Aktion plantSeed): das Ökosystem mit einer weiteren
 * Pflanze. Prüft weder Kosten noch Freischaltung (siehe plantBlocker); null bei
 * unbekannter Pflanze oder vollem Ring.
 */
export function previewPlant(state: GameState, plantId: string): Evaluation | null {
  const plants = plantsAfterChoice(state, plantId);
  if (!plants) return null;
  return evaluateEcosystem({ stage: state.stage, niches: state.niches, plants, forestMemory: state.meta.forestMemory });
}

/**
 * Pflanzring nach dem Keimen von `plantId` (optional anstelle von `replacePlantId`,
 * dessen erstes Vorkommen ersetzt wird). null, wenn die Pflanze unbekannt ist, der
 * Ersatz nicht im Ring wächst oder dieselbe Pflanze ist (Tausch ohne Wirkung), ein
 * Ersatz bei freiem Ring genannt wird (Pflanzen sterben nicht – bei Platz wird nur
 * dazugesetzt) oder der Ring ohne Ersatz voll ist.
 */
export function plantsAfterChoice(
  state: Pick<GameState, 'stage' | 'plants'>,
  plantId: string,
  replacePlantId?: string,
): string[] | null {
  if (!PLANTS_BY_ID.has(plantId)) return null;
  const plants = [...state.plants];
  if (replacePlantId !== undefined) {
    const at = plants.indexOf(replacePlantId);
    if (at < 0 || replacePlantId === plantId || plants.length < plantSlots(state.stage)) return null;
    plants[at] = plantId;
    return plants;
  }
  if (plants.length >= plantSlots(state.stage)) return null;
  plants.push(plantId);
  return plants;
}

/**
 * Nischen nach dem Einzug von `speciesId` (optional anstelle von `replaceSpeciesId`).
 * null, wenn der Ersatz nicht in der Nische lebt oder danach irgendwo mehr Tiere ohne
 * Platz wären als vorher – die Nische ist voll, oder der entlassene Borkenkäfer hat
 * Höhlenplätze geschaffen, die noch belegt sind.
 * Prüft nicht, ob die Art schon lebt oder die Nische offen ist (siehe cardStatus).
 */
export function nichesAfterChoice(
  state: Pick<GameState, 'stage' | 'niches'>,
  speciesId: string,
  replaceSpeciesId?: string,
): Record<NicheId, string[]> | null {
  const sp = SPECIES_BY_ID.get(speciesId);
  if (!sp) return null;
  const niches = copyNiches(state.niches);
  const occupants = niches[sp.niche];
  if (replaceSpeciesId !== undefined) {
    const at = occupants.indexOf(replaceSpeciesId);
    if (at < 0) return null;
    occupants[at] = sp.id;
  } else {
    occupants.push(sp.id);
  }
  const before = nicheOverflow(state.stage, state.niches);
  const after = nicheOverflow(state.stage, niches);
  return NICHE_IDS.every((id) => after[id] <= before[id]) ? niches : null;
}

function copyNiches(niches: Partial<Record<NicheId, readonly string[]>>): Record<NicheId, string[]> {
  const out = {} as Record<NicheId, string[]>;
  for (const id of NICHE_IDS) out[id] = [...(niches[id] ?? [])];
  return out;
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

// ---------------------------------------------------------------------------
// Neuer Zyklus: Waldgedächtnis und Stammgäste (DESIGN_V2.md, Abschnitt 10)
// ---------------------------------------------------------------------------

/**
 * Waldgedächtnis, das ein Neuer Zyklus einbringt: `floor(H_max / 10) + 2 · neue Arten`,
 * begrenzt, sodass der Bestand MAX_FOREST_MEMORY nicht übersteigt. Negative Harmonie
 * zählt als 0; NaN und Unsinn ergeben 0 statt kaputter Spielstände.
 */
export function cycleMemoryGain(maxHarmony: number, newSpeciesCount: number, forestMemory: number): number {
  const harmonyPoints = Math.floor(Math.max(0, finite(maxHarmony)) / MEMORY_HARMONY_DIVISOR);
  const speciesPoints = MEMORY_PER_NEW_SPECIES * Math.max(0, Math.floor(finite(newSpeciesCount)));
  const room = MAX_FOREST_MEMORY - Math.min(MAX_FOREST_MEMORY, Math.max(0, finite(forestMemory)));
  return Math.min(room, harmonyPoints + speciesPoints);
}

/** Plätze für Stammgäste: einer je 25 Punkte Waldgedächtnis. */
export function regularSlots(forestMemory: number): number {
  const memory = Math.min(MAX_FOREST_MEMORY, Math.max(0, finite(forestMemory)));
  return Math.floor(memory / MEMORY_PER_REGULAR_SLOT);
}
