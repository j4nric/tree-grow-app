/**
 * Design v2 – Rechenmodell des Prototyps: Zufriedenheit, Harmonie, Wachstum/s, Samen/s.
 * Reine Funktionen, deterministisch. Formeln: docs/DESIGN_V2.md, Abschnitt 2 und 9.
 */
import {
  COMMUNITIES,
  GENERA,
  LIGHT_BUDGET,
  MAIN_TREE_NUTS_STAGE,
  MAIN_TREE_TAGS,
  MAIN_TREE_WEIGHT,
  NICHES,
  NICHE_SLOTS,
  PLANTS,
  PLANT_GROUPS,
  SPECIES,
  TRAITS,
  TRAIT_THRESHOLDS,
  TREE_GROWTH,
  TREE_SEEDS,
  VISITORS,
  WATER_BUDGET,
  type AbilityId,
  type Condition,
  type Effect,
  type Genus,
  type NicheId,
  type Plant,
  type PlantGroup,
  type Species,
  type Tag,
} from './content';

export const SPECIES_BY_ID = new Map(SPECIES.map((s) => [s.id, s]));
export const PLANTS_BY_ID = new Map(PLANTS.map((p) => [p.id, p]));
export const VISITORS_BY_ID = new Map(VISITORS.map((v) => [v.id, v]));

/** Statisch vorberechnet: Wer jagt wen (Räuber frisst ein Merkmal, das die Beute bereitstellt)? */
const HUNTERS_OF = new Map<string, string[]>(
  SPECIES.map((prey) => [
    prey.id,
    SPECIES.filter((p) => p.id !== prey.id && p.level === 'predator' && p.food.some((t) => prey.provides.includes(t))).map((p) => p.id),
  ]),
);
/** Wer stört wen? */
const DISTURBERS_OF = new Map<string, string[]>(
  SPECIES.map((target) => [
    target.id,
    SPECIES.filter((o) => o.effects.some((e) => e.kind === 'disturb' && e.target === target.id)).map((o) => o.id),
  ]),
);

/** Grundzufriedenheit je Seltenheit: seltene Arten sind wählerischer. */
export const BASE_HAPPINESS = [0.25, 0.15, 0.05, 0] as const;
/** Gewicht der Nahrung gegenüber einem einzelnen Lebensraum-Wunsch. */
export const FOOD_WEIGHT = 2;
/** Abzug je störender Art. */
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
/** Harmonie-Multiplikator: 1 + H / HARMONY_DIVISOR. */
export const HARMONY_DIVISOR = 100;
/** Untergrenze für (1 + Wachstumsboni − Schaden). */
export const MIN_GROWTH_FACTOR = 0.5;
/** Ein Schädling gilt als unbewacht, solange mehr als dieser Anteil seines Schadens wirkt. */
export const UNGUARDED_SHARE = 0.5;
/** Harmonie-Abzug je unbewachtem Schädling. */
export const UNGUARDED_PENALTY = 4;

export interface Eco {
  stage: number;
  /** Begleitpflanzen um den Hauptbaum (Duplikate erlaubt). */
  plants: string[];
  /** Tiere je Nische. Jede Art höchstens einmal im Ökosystem. */
  animals: Record<NicheId, string[]>;
  /** Merkmale aus Ereignissen (z. B. Totholz). */
  envTags: Tag[];
  /** Dauerhafte Wirkungen aus Ereignissen. */
  envEffects: Effect[];
  /** Durchreisende mit dem Wegpunkt, bis zu dem sie bleiben. */
  visitors: { id: string; until: number }[];
}

export function emptyEco(): Eco {
  return {
    stage: 0,
    plants: [],
    animals: { roots: [], litter: [], edge: [], crown: [], bark: [], hollows: [] },
    envTags: [],
    envEffects: [],
    visitors: [],
  };
}

export function cloneEco(eco: Eco): Eco {
  return {
    stage: eco.stage,
    plants: [...eco.plants],
    animals: {
      roots: [...eco.animals.roots],
      litter: [...eco.animals.litter],
      edge: [...eco.animals.edge],
      crown: [...eco.animals.crown],
      bark: [...eco.animals.bark],
      hollows: [...eco.animals.hollows],
    },
    envTags: [...eco.envTags],
    envEffects: [...eco.envEffects],
    visitors: eco.visitors.map((v) => ({ ...v })),
  };
}

export function allAnimals(eco: Eco): string[] {
  const out: string[] = [];
  for (const n of NICHES) out.push(...eco.animals[n]);
  return out;
}

export interface Breakdown {
  variety: number;
  happiness: number;
  pyramid: number;
  communities: number;
  extra: number;
}

export interface Evaluation {
  growth: number;
  seeds: number;
  harmony: number;
  multiplier: number;
  breakdown: Breakdown;
  /** Zufriedenheit je Art (0–1). */
  happiness: Map<string, number>;
  avgHappiness: number;
  /** Versorgung der Begleitpflanzen mit Licht/Wasser (0–1). */
  supply: number;
  slots: Record<NicheId, number>;
  traitTiers: Record<Genus, number>;
  communities: string[];
  /** Ebenen der Nahrungspyramide (Pflanzen gewichtet). */
  pyramid: { plants: number; herbivores: number; predators: number; decomposers: number; unguarded: number };
}

function hasAbility(sp: Species, id: AbilityId): boolean {
  return sp.effects.some((e) => e.kind === 'ability' && e.id === id);
}

/** Effektive Plätze je Nische (Grundplätze + Plätze aus Tieren/Ereignissen). */
export function nicheSlots(eco: Eco): Record<NicheId, number> {
  const slots = {} as Record<NicheId, number>;
  for (const n of NICHES) slots[n] = NICHE_SLOTS[n][eco.stage] ?? 0;
  const add = (e: Effect) => {
    if (e.kind === 'slot') slots[e.niche] += e.amount;
  };
  for (const id of allAnimals(eco)) {
    const sp = SPECIES_BY_ID.get(id)!;
    sp.effects.forEach(add);
    if (hasAbility(sp, 'architect')) {
      slots.crown += 1;
      slots.hollows += 1;
    }
  }
  eco.envEffects.forEach(add);
  // Nischen, die auf dieser Stufe noch geschlossen sind, bleiben geschlossen.
  for (const n of NICHES) if ((NICHE_SLOTS[n][eco.stage] ?? 0) === 0 && n !== 'hollows') slots[n] = 0;
  return slots;
}

export function evaluate(eco: Eco): Evaluation {
  const animalIds = allAnimals(eco);
  const animals = animalIds.map((id) => SPECIES_BY_ID.get(id)!);
  const plants = eco.plants.map((id) => PLANTS_BY_ID.get(id)!);
  const presentSpecies = new Set<string>([...animalIds, ...eco.plants]);

  // Pflanzengruppen (Hauptbaum zählt als Baum)
  const groupCount: Record<PlantGroup, number> = { trees: 1, shrubs: 0, flowers: 0, mosses: 0 };
  for (const p of plants) groupCount[p.group]++;

  // Merkmale und Futterangebot
  const supplyByTag = new Map<Tag, number>();
  const addSupply = (tag: Tag, n: number) => supplyByTag.set(tag, (supplyByTag.get(tag) ?? 0) + n);
  for (const t of MAIN_TREE_TAGS) addSupply(t, SUPPLY_MAIN_TREE);
  if (eco.stage >= MAIN_TREE_NUTS_STAGE) addSupply('nuesse', SUPPLY_MAIN_TREE);
  for (const p of plants) for (const t of p.provides) addSupply(t, SUPPLY_PLANT);
  for (const a of animals) for (const t of a.provides) addSupply(t, SUPPLY_ANIMAL);
  for (const t of eco.envTags) addSupply(t, SUPPLY_PLANT);
  const demandByTag = new Map<Tag, number>();
  for (const a of animals) for (const t of a.food) demandByTag.set(t, (demandByTag.get(t) ?? 0) + 1);

  // Gattungen (Durchreisende zählen für die Gattungsboni mit)
  const genusCount: Record<Genus, number> = { birds: 0, insects: 0, mammals: 0, soil: 0, fungi: 0 };
  for (const a of animals) {
    genusCount[a.genus]++;
    if (hasAbility(a, 'countsAsBird')) genusCount.birds++;
  }
  const residentGenera = new Set(animals.map((a) => a.genus));
  const traitCount = { ...genusCount };
  for (const v of eco.visitors) traitCount[VISITORS_BY_ID.get(v.id)!.genus]++;

  const abilities = new Set<AbilityId>();
  for (const a of animals) for (const e of a.effects) if (e.kind === 'ability') abilities.add(e.id);

  // Sonnig: Nach allen Begleitpflanzen bleibt Licht frei (Tier-Lichtboni zählen voll).
  let openLight = (LIGHT_BUDGET[eco.stage] ?? 0) - plants.reduce((sum, p) => sum + p.light, 0);
  for (const e of eco.envEffects) if (e.kind === 'light') openLight += e.amount;
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
        return (supplyByTag.get(c.tag) ?? 0) > 0;
      case 'group':
        return groupCount[c.group] >= c.min;
      case 'species':
        return presentSpecies.has(c.id);
      case 'genus':
        return genusCount[c.genus] >= c.min;
    }
  };

  // Zufriedenheit
  const happiness = new Map<string, number>();
  const foodFulfil = new Map<string, number>();
  for (const a of animals) {
    let fed = 0;
    for (const t of a.food) {
      const s = supplyByTag.get(t) ?? 0;
      const d = demandByTag.get(t) ?? 1;
      fed = Math.max(fed, Math.min(1, s / d));
    }
    foodFulfil.set(a.id, fed);
    const met = a.needs.filter(condMet).length;
    const q = (FOOD_WEIGHT * fed + met) / (FOOD_WEIGHT + a.needs.length);
    const base = BASE_HAPPINESS[a.rarity];
    let z = base + (1 - base) * q;
    for (const d of DISTURBERS_OF.get(a.id)!) if (presentSpecies.has(d)) z -= DISTURB_PENALTY;
    let hunters = 0;
    for (const h of HUNTERS_OF.get(a.id)!) if (presentSpecies.has(h)) hunters++;
    // Räuberdruck: Beute ist etwas weniger zufrieden, wenn sie gejagt wird.
    z -= PREDATION_PENALTY * Math.min(PREDATION_MAX_HUNTERS, hunters);
    if (abilities.has('decomposerBoost') && a.level === 'decomposer') z += 0.2;
    if (abilities.has('architect') && a.niche === 'hollows') z += 0.2;
    if (hasAbility(a, 'calm')) z = Math.max(z, 0.5);
    happiness.set(a.id, Math.min(1, Math.max(0, z)));
  }

  // Effekte sammeln
  let growthPct = 0;
  let seedsPct = 0;
  let water = WATER_BUDGET[eco.stage] ?? 0;
  let light = LIGHT_BUDGET[eco.stage] ?? 0;
  let harmonyExtra = 0;
  const groupGrowth: Record<PlantGroup, number> = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 };
  const groupSeeds: Record<PlantGroup, number> = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 };
  const controls: { tag: Tag; strength: number }[] = [];
  const apply = (e: Effect, scale: number) => {
    switch (e.kind) {
      case 'growth':
        growthPct += (e.pct / 100) * scale;
        break;
      case 'seeds':
        seedsPct += (e.pct / 100) * scale;
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
      default:
        break; // damage, slot, disturb, ability werden gesondert behandelt
    }
  };
  for (const a of animals) {
    const z = happiness.get(a.id)!;
    for (const e of a.effects) apply(e, z);
    if (a.id === 'deer' && abilities.has('fear')) {
      for (const e of a.effects) if (e.kind === 'light') light += e.amount * z; // Licht ×2
    }
  }
  const traitTiers = {} as Record<Genus, number>;
  for (const g of GENERA) {
    const tier = TRAIT_THRESHOLDS.filter((t) => traitCount[g] >= t).length;
    traitTiers[g] = tier;
    for (let i = 0; i < tier; i++) for (const e of TRAITS[g][i]!) apply(e, 1);
  }
  for (const v of eco.visitors) for (const e of VISITORS_BY_ID.get(v.id)!.effects) apply(e, 1);
  for (const e of eco.envEffects) apply(e, 1);

  // Lebensgemeinschaften
  const communities: string[] = [];
  let communityPoints = 0;
  for (const c of COMMUNITIES) {
    const ok = c.members.every((m) => (Array.isArray(m) ? m.some((x) => presentSpecies.has(x)) : presentSpecies.has(m)));
    if (!ok) continue;
    communities.push(c.id);
    communityPoints += c.harmony + (abilities.has('communityBoost') ? 3 : 0);
    for (const e of c.effects) apply(e, 1);
  }

  // Fraßschaden, gemindert durch Räuber (multiplikativ)
  let damagePct = 0;
  let unguarded = 0;
  for (const a of animals) {
    for (const e of a.effects) {
      if (e.kind !== 'damage') continue;
      let d = e.pct / 100;
      if (a.id === 'deer' && abilities.has('fear')) d = 0;
      for (const c of controls) if (a.provides.includes(c.tag)) d *= Math.max(0, 1 - c.strength);
      if (abilities.has('nightWatch') && a.level === 'herbivore') d *= 0.8;
      damagePct += d;
      // Unbewachter Schädling: weniger als die Hälfte seines Schadens wird abgefangen.
      if (d > (e.pct / 100) * UNGUARDED_SHARE) unguarded++;
    }
  }

  // Versorgung mit Licht und Wasser
  let lightNeed = 0;
  let waterNeed = 0;
  for (const p of plants) {
    lightNeed += p.light;
    waterNeed += abilities.has('mossNoWater') && p.group === 'mosses' ? Math.min(0, p.water) : p.water;
  }
  let supply = 1;
  if (lightNeed > 0) supply = Math.min(supply, light / lightNeed);
  if (waterNeed > 0) supply = Math.min(supply, water / waterNeed);
  if (abilities.has('minSupply')) supply = Math.max(supply, 0.9);
  supply = Math.max(0, Math.min(1, supply));

  // Nahrungspyramide
  const herbivores = animals.filter((a) => a.level === 'herbivore').length;
  const predators = animals.filter((a) => a.level === 'predator');
  const decomposers = animals.filter((a) => a.level === 'decomposer').length;
  const plantWeight = MAIN_TREE_WEIGHT + plants.length;
  const levels = (5 * [herbivores, predators.length, decomposers].filter((n) => n > 0).length) / 3;
  const carrying = herbivores > 0 ? 5 * Math.min(1, plantWeight / (1.5 * herbivores)) : 5;
  const fed = predators.length > 0 ? (5 * predators.reduce((s, p) => s + foodFulfil.get(p.id)!, 0)) / predators.length : 0;
  const consumers = plantWeight + herbivores + predators.length;
  const cycle = 5 * Math.min(1, decomposers / (consumers / 5));
  const pyramid = levels + carrying + fed + cycle - UNGUARDED_PENALTY * unguarded;

  // Harmonie
  let groupsPresent = residentGenera.size;
  for (const g of PLANT_GROUPS) {
    const companions = plants.filter((p) => p.group === g).length;
    if (companions > 0) groupsPresent++;
  }
  const distinct = new Set(animalIds).size + new Set(eco.plants).size;
  const variety = 3 * groupsPresent + distinct;
  const avgHappiness = animals.length > 0 ? [...happiness.values()].reduce((s, z) => s + z, 0) / animals.length : 0;
  const happinessPoints = 30 * avgHappiness;
  const harmony = variety + happinessPoints + pyramid + communityPoints + harmonyExtra;
  const multiplier = 1 + harmony / HARMONY_DIVISOR;

  // Wachstum und Samen
  const tree = (TREE_GROWTH[eco.stage] ?? 0) * (1 + groupGrowth.trees);
  let companionGrowth = 0;
  let companionSeeds = 0;
  for (const p of plants) {
    companionGrowth += p.growth * (1 + groupGrowth[p.group]);
    companionSeeds += p.seeds * (1 + groupSeeds[p.group]);
  }
  const factor = Math.max(MIN_GROWTH_FACTOR, 1 + growthPct - damagePct);
  const growth = (tree + supply * companionGrowth) * factor * multiplier;
  const treeSeeds = (TREE_SEEDS[eco.stage] ?? 0) * (1 + groupSeeds.trees);
  const seeds = (treeSeeds + supply * companionSeeds) * (1 + seedsPct) * multiplier;

  return {
    growth,
    seeds,
    harmony,
    multiplier,
    breakdown: { variety, happiness: happinessPoints, pyramid, communities: communityPoints, extra: harmonyExtra },
    happiness,
    avgHappiness,
    supply,
    slots: nicheSlots(eco),
    traitTiers,
    communities,
    pyramid: { plants: plantWeight, herbivores, predators: predators.length, decomposers, unguarded },
  };
}

/** Prüft, ob die Belegung zu den Plätzen passt. */
export function isValid(eco: Eco): boolean {
  const slots = nicheSlots(eco);
  for (const n of NICHES) if (eco.animals[n].length > slots[n]) return false;
  return true;
}

export function plantOf(id: string): Plant {
  return PLANTS_BY_ID.get(id)!;
}
export function speciesOf(id: string): Species {
  return SPECIES_BY_ID.get(id)!;
}

/** Erfüllt die Art ihre Erscheinungs-Bedingungen (für besonders/legendär)? */
export function appearsIn(eco: Eco, sp: Species): boolean {
  if (!sp.appears) return true;
  const ev = presence(eco);
  return sp.appears.every((c) => ev(c));
}

function presence(eco: Eco): (c: Condition) => boolean {
  const animals = allAnimals(eco).map((id) => SPECIES_BY_ID.get(id)!);
  const plants = eco.plants.map((id) => PLANTS_BY_ID.get(id)!);
  const tags = new Set<Tag>([...MAIN_TREE_TAGS, ...eco.envTags]);
  if (eco.stage >= MAIN_TREE_NUTS_STAGE) tags.add('nuesse');
  for (const p of plants) p.provides.forEach((t) => tags.add(t));
  for (const a of animals) a.provides.forEach((t) => tags.add(t));
  const ids = new Set<string>([...animals.map((a) => a.id), ...eco.plants]);
  return (c) => {
    switch (c.kind) {
      case 'sunny':
      case 'shady':
        return true;
      case 'tag':
        return tags.has(c.tag);
      case 'group':
        return (c.group === 'trees' ? 1 : 0) + plants.filter((p) => p.group === c.group).length >= c.min;
      case 'species':
        return ids.has(c.id);
      case 'genus':
        return animals.filter((a) => a.genus === c.genus).length >= c.min;
    }
  };
}
