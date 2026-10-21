/**
 * Grobes Modell für Ereignisse und Durchreisende im Simulator (Schritt 2.4, Inhalte aus
 * src/content/events.ts und visitors.ts). Die echte Logik fehlt noch in src/core/ –
 * darum liegt dieses Modell als „Overlay“ neben dem echten Spielstand:
 *
 * - Begegnungstyp: Zieht die echte Logik am Wegpunkt eine Tier- oder Pflanzenbegegnung,
 *   würfelt das Overlay mit eigenem Zufall nach ENCOUNTER_WEIGHTS (Pflanze bei vollem
 *   Ring × PLANT_WEIGHT_RING_FULL), ob stattdessen ein Ereignis oder ein Gast kommt.
 *   Die Verteilung entspricht damit dem Design; die gezogene Karte wird verworfen.
 * - Wirkungen wirken als Faktoren auf die echten Raten aus `evaluate` (siehe `rates`):
 *   Wachstums- und Samenboni additiv zu den Boni der Tiere, Harmonie über 1 + H/100,
 *   Licht/Wasser über die Versorgung V, Gruppenboni über den Anteil der Gruppe.
 *   Näherung: Gruppenanteile ohne Gruppenboni der Tiere, Licht macht nicht „sonnig“.
 * - Nicht modelliert (zählen 0): `habitat`, `slot` und dass Gäste für Gattungsboni zählen.
 *   `nextEncounter` wird modelliert (die nächste Begegnung wird wie im Design gebaut).
 *
 * Damit unterschätzt das Modell den Nutzen eher (konservativ).
 */
import {
  CARDS_PER_ENCOUNTER,
  ENCOUNTER_WEIGHTS,
  INTERLUDE_CHANCE,
  INTERLUDE_POSITION,
  INTERLUDE_STAGE,
  INTERLUDE_WEIGHTS,
  PLANT_WEIGHT_RING_FULL,
} from '../src/content/encounters';
import {
  EVENTS,
  SEED_SECONDS_MIN_SEEDS,
  type CycleEffect,
  type EventEffect,
  type EventOption,
  type ForcedEncounterType,
  type GameEvent,
  type TimedEffect,
} from '../src/content/events';
import { PLANTS_BY_ID } from '../src/content/plants';
import { SPECIES_BY_ID } from '../src/content/species';
import { PLANT_GROUPS, type PlantGroup } from '../src/content/types';
import { VISITORS, type Visitor, type VisitorEffect } from '../src/content/visitors';
import { evaluate, hasSpecies, nicheSlots, plantSlots, speciesAppears, thresholdFor, type Evaluation } from '../src/core/formulas';
import { pick, random, weightedIndex, type RngHolder } from '../src/core/rng';
import type { GameState, PendingEncounter } from '../src/core/state';
import { drawCards } from '../src/core/tick';

/** Zeitlich begrenzte Wirkung (Ereignis-Bonus oder bewirteter Gast). */
interface Active {
  until: number;
  effect: TimedEffect | VisitorEffect;
}

export interface Extras {
  timed: Active[];
  cycle: CycleEffect[];
  /** In diesem Zyklus gesehene Ereignisse und Gäste. */
  seen: Set<string>;
  forced: { type: ForcedEncounterType; ids: readonly string[] } | null;
  rng: RngHolder;
  /** Wegpunkt, nach dem der Zwischenhalt schon war (je Abschnitt höchstens einer). */
  interludeDone: number;
  /** Zwischenhalt an (Schritt 2.4, encounters.ts) – zum Vergleich abschaltbar. */
  interludes: boolean;
}

export function createExtras(seed: number, interludes = true): Extras {
  return {
    timed: [],
    cycle: [],
    seen: new Set(),
    forced: null,
    rng: { rngState: (seed * 2654435761) >>> 0 || 1 },
    interludeDone: -1,
    interludes,
  };
}

/** Gesamt-Wachstum des nächsten Zwischenhalts; Infinity, wenn keiner mehr ansteht. */
export function interludeThreshold(state: GameState, extras: Extras): number {
  if (!extras.interludes || state.stage < INTERLUDE_STAGE || extras.interludeDone >= state.waypoint) return Infinity;
  const from = thresholdFor(state.waypoint);
  const to = thresholdFor(state.waypoint + 1);
  if (!Number.isFinite(to)) return Infinity;
  return from + INTERLUDE_POSITION * (to - from);
}

/** Zwischenhalt erreicht: Kommt ein Ereignis oder ein Gast? */
export function rollInterlude(state: GameState, extras: Extras): ExtraEncounter | null {
  extras.interludeDone = state.waypoint;
  if (random(extras.rng) >= INTERLUDE_CHANCE) return null;
  const events = eligibleEvents(state, extras);
  const visitors = eligibleVisitors(state, extras);
  const w = [events.length > 0 ? INTERLUDE_WEIGHTS[0] : 0, visitors.length > 0 ? INTERLUDE_WEIGHTS[1] : 0];
  if (w[0]! + w[1]! === 0) return null;
  if (weightedIndex(extras.rng, w) === 0) {
    const event = pick(extras.rng, events);
    extras.seen.add(event.id);
    return { type: 'event', event };
  }
  const visitor = pick(extras.rng, visitors);
  extras.seen.add(visitor.id);
  return { type: 'visitor', visitor };
}

/** Wirkungen, deren Faktor `rates` berechnet. */
type RateEffect = TimedEffect | VisitorEffect | CycleEffect;

/** Basis-Anteil jeder Pflanzengruppe am Wachstum bzw. an den Samen der Begleitpflanzen. */
function groupShares(state: GameState): { growth: Record<PlantGroup, number>; seeds: Record<PlantGroup, number> } {
  const g = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 } as Record<PlantGroup, number>;
  const s = { ...g };
  let gt = 0;
  let st = 0;
  for (const id of state.plants) {
    const p = PLANTS_BY_ID.get(id);
    if (!p) continue;
    g[p.group] += p.growth;
    s[p.group] += p.seeds;
    gt += p.growth;
    st += p.seeds;
  }
  for (const k of PLANT_GROUPS) {
    g[k] = gt > 0 ? g[k] / gt : 0;
    s[k] = st > 0 ? s[k] / st : 0;
  }
  return { growth: g, seeds: s };
}

/** Raten (🌿/s, 🌰/s) mit zusätzlichen Wirkungen – Näherung, siehe Kopfkommentar. */
export function rates(state: GameState, effects: readonly RateEffect[], ev: Evaluation = evaluate(state)) {
  if (effects.length === 0) return { growth: ev.growth, seeds: ev.seeds };
  let g = 0;
  let s = 0;
  let h = 0;
  let light = 0;
  let water = 0;
  const gg = { trees: 0, shrubs: 0, flowers: 0, mosses: 0 } as Record<PlantGroup, number>;
  const gs = { ...gg };
  for (const e of effects) {
    switch (e.kind) {
      case 'growth':
        g += e.pct / 100;
        break;
      case 'seeds':
        s += e.pct / 100;
        break;
      case 'groupGrowth':
        gg[e.group] += e.pct / 100;
        break;
      case 'groupSeeds':
        gs[e.group] += e.pct / 100;
        break;
      case 'harmony':
        h += e.points;
        break;
      case 'light':
        light += e.amount;
        break;
      case 'water':
        water += e.amount;
        break;
      case 'slot':
        break; // nicht modelliert
    }
  }
  const shares = groupShares(state);
  // Versorgung V mit zusätzlichem Licht/Wasser
  let supply = 1;
  if (ev.lightNeed > 0) supply = Math.min(supply, (ev.light + light) / ev.lightNeed);
  if (ev.waterNeed > 0) supply = Math.min(supply, (ev.water + water) / ev.waterNeed);
  supply = Math.max(ev.supply, Math.min(1, supply));
  const supplyRatio = ev.supply > 0 ? supply / ev.supply : 1;
  const plantGrowthFactor = 1 + PLANT_GROUPS.reduce((sum, k) => sum + shares.growth[k] * gg[k], 0);
  const plantSeedsFactor = 1 + PLANT_GROUPS.reduce((sum, k) => sum + shares.seeds[k] * gs[k], 0);
  const treeGrowth = (ev.growth - ev.plantGrowth) * (1 + gg.trees);
  const treeSeeds = (ev.seeds - ev.plantSeeds) * (1 + gs.trees);
  const plantGrowth = ev.plantGrowth * supplyRatio * plantGrowthFactor;
  const plantSeeds = ev.plantSeeds * supplyRatio * plantSeedsFactor;
  const rawFactor = 1 + ev.growthBonus - ev.damage;
  const factorRatio = Math.max(0.5, rawFactor + g) / Math.max(0.5, rawFactor);
  const seedsRatio = (1 + ev.seedsBonus + s) / (1 + ev.seedsBonus);
  const harmonyRatio = (ev.multiplier + h / 100) / ev.multiplier;
  return {
    growth: (treeGrowth + plantGrowth) * factorRatio * harmonyRatio,
    seeds: (treeSeeds + plantSeeds) * seedsRatio * harmonyRatio,
  };
}

/** Alle gerade wirksamen Zusatz-Wirkungen. */
export function activeEffects(extras: Extras, time: number): RateEffect[] {
  return [...extras.cycle, ...extras.timed.filter((a) => a.until > time).map((a) => a.effect)];
}

/** Faktoren auf die echten Raten: { g: Wachstum, s: Samen }. */
export function multipliers(state: GameState, extras: Extras, time: number): { g: number; s: number } {
  const ev = evaluate(state);
  const r = rates(state, activeEffects(extras, time), ev);
  return { g: ev.growth > 0 ? r.growth / ev.growth : 1, s: ev.seeds > 0 ? r.seeds / ev.seeds : 1 };
}

/** Nächster Zeitpunkt, an dem eine Wirkung abläuft (Infinity, wenn keine). */
export function nextExpiry(extras: Extras, time: number): number {
  let next = Infinity;
  for (const a of extras.timed) if (a.until > time && a.until < next) next = a.until;
  return next;
}

export function dropExpired(extras: Extras, time: number): void {
  extras.timed = extras.timed.filter((a) => a.until > time + 1e-9);
}

/** Samen-Sekunden → Samen (aktuelle Rate inkl. Boni, mindestens SEED_SECONDS_MIN_SEEDS). */
export function seedSeconds(state: GameState, extras: Extras, time: number, seconds: number): number {
  return Math.max(SEED_SECONDS_MIN_SEEDS, seconds * rates(state, activeEffects(extras, time)).seeds);
}

// ---------------------------------------------------------------------------
// Ziehen
// ---------------------------------------------------------------------------

export function eligibleEvents(state: GameState, extras: Extras): GameEvent[] {
  return EVENTS.filter((e) => e.minStage <= state.stage && !extras.seen.has(e.id) && speciesAppears(state, e));
}

export function eligibleVisitors(state: GameState, extras: Extras): Visitor[] {
  return VISITORS.filter((v) => v.minStage <= state.stage && !extras.seen.has(v.id) && speciesAppears(state, v));
}

export type ExtraEncounter = { type: 'event'; event: GameEvent } | { type: 'visitor'; visitor: Visitor };

/**
 * Am Wegpunkt: Wird aus der eben gezogenen Begegnung ein Ereignis oder ein Gast? Ein
 * erzwungener Typ (`nextEncounter`) hat Vorrang und baut die Begegnung um.
 * Gibt das Ereignis bzw. den Gast zurück und entfernt dann die gezogene Begegnung.
 */
export function rollExtra(state: GameState, extras: Extras): ExtraEncounter | null {
  const enc = state.pendingEncounters[state.pendingEncounters.length - 1];
  if (!enc || enc.rerolls !== 0) return null;
  if (extras.forced) {
    const forced = extras.forced;
    extras.forced = null;
    const built = forcedEncounter(state, forced, extras.rng);
    if (built) state.pendingEncounters[state.pendingEncounters.length - 1] = built;
    return null;
  }
  const weights = ENCOUNTER_WEIGHTS[state.stage] ?? ENCOUNTER_WEIGHTS[ENCOUNTER_WEIGHTS.length - 1]!;
  const ringFull = state.plants.length >= plantSlots(state.stage);
  const w = [weights[0], ringFull ? weights[1] * PLANT_WEIGHT_RING_FULL : weights[1], weights[2], weights[3]];
  const i = weightedIndex(extras.rng, w);
  if (i === 2) {
    const pool = eligibleEvents(state, extras);
    if (pool.length === 0) return null;
    const event = pick(extras.rng, pool);
    extras.seen.add(event.id);
    state.pendingEncounters.pop();
    return { type: 'event', event };
  }
  if (i === 3) {
    const pool = eligibleVisitors(state, extras);
    if (pool.length === 0) return null;
    const visitor = pick(extras.rng, pool);
    extras.seen.add(visitor.id);
    state.pendingEncounters.pop();
    return { type: 'visitor', visitor };
  }
  return null;
}

/** Baut die erzwungene Begegnung wie im Design (events.ts, `nextEncounter`). */
function forcedEncounter(
  state: GameState,
  forced: { type: ForcedEncounterType; ids: readonly string[] },
  rng: RngHolder,
): PendingEncounter | null {
  const slots = nicheSlots(state.stage, state.niches);
  const ok = forced.ids.filter((id) => {
    if (forced.type === 'plant') return (PLANTS_BY_ID.get(id)?.unlock ?? Infinity) <= state.stage;
    const sp = SPECIES_BY_ID.get(id);
    return !!sp && sp.unlock <= state.stage && !hasSpecies(state, id) && slots[sp.niche] > 0;
  });
  if (ok.length === 0) return null;
  const chosen: string[] = [];
  const pool = [...ok];
  while (pool.length > 0 && chosen.length < CARDS_PER_ENCOUNTER) {
    const k = Math.floor(random(rng) * pool.length);
    chosen.push(pool.splice(k, 1)[0]!);
  }
  const rest = drawCards(state, forced.type, chosen, rng).slice(0, CARDS_PER_ENCOUNTER - chosen.length);
  return { type: forced.type, cards: [...chosen, ...rest], rerolls: 0 };
}

// ---------------------------------------------------------------------------
// Auflösen
// ---------------------------------------------------------------------------

/** Wie viel Samen ist eine Sekunde Wachstum wert? (Bewertung der Strategien) */
const SEED_VALUE = 0.4;
/** Horizont für Wirkungen „bis zum Zyklusende“ (s). */
const CYCLE_HORIZON = 1800;
/** Pauschaler Wert (s Wachstum) einer erzwungenen Begegnung. */
const FORCED_VALUE = 45;

/**
 * Bewertung einer Ereignis-Option in „Sekunden Wachstum“: zusätzliche Wachstums-
 * Sekunden plus SEED_VALUE × zusätzliche Samen-Sekunden.
 */
export function optionValue(state: GameState, extras: Extras, time: number, option: EventOption): number {
  const base = activeEffects(extras, time);
  const before = rates(state, base);
  let value = 0;
  for (const e of option.effects) {
    if (e.kind === 'seedsNow') value += SEED_VALUE * (seedSeconds(state, extras, time, e.seconds) / Math.max(1e-9, before.seeds));
    else if (e.kind === 'timed' || e.kind === 'cycle') {
      const after = rates(state, [...base, e.effect]);
      const span = e.kind === 'timed' ? e.seconds : CYCLE_HORIZON;
      value += span * (after.growth / before.growth - 1 + SEED_VALUE * (after.seeds / Math.max(1e-9, before.seeds) - 1));
    } else if (e.kind === 'nextEncounter') value += FORCED_VALUE;
  }
  return value;
}

/** Wendet eine Ereignis-Option an; gibt die sofort erhaltenen Samen zurück. */
export function applyOption(state: GameState, extras: Extras, time: number, option: EventOption): number {
  let seeds = 0;
  for (const e of option.effects as readonly EventEffect[]) {
    switch (e.kind) {
      case 'seedsNow':
        seeds += seedSeconds(state, extras, time, e.seconds);
        break;
      case 'timed':
        extras.timed.push({ until: time + e.seconds, effect: e.effect });
        break;
      case 'cycle':
        extras.cycle.push(e.effect);
        break;
      case 'habitat':
        break; // nicht modelliert
      case 'nextEncounter':
        extras.forced = { type: e.type, ids: e.ids };
        break;
    }
  }
  state.seeds += seeds;
  return seeds;
}

/** Bewirtet einen Gast (wenn die Samen reichen); gibt die Kosten zurück, sonst null. */
export function hostVisitor(state: GameState, extras: Extras, time: number, visitor: Visitor): number | null {
  const cost = seedSeconds(state, extras, time, visitor.hostCost);
  if (state.seeds < cost) return null;
  state.seeds -= cost;
  for (const effect of visitor.effects) extras.timed.push({ until: time + visitor.stay, effect });
  return cost;
}

/** Lässt einen Gast ziehen; gibt den Samen-Dank zurück. */
export function farewellVisitor(state: GameState, extras: Extras, time: number, visitor: Visitor): number {
  const seeds = seedSeconds(state, extras, time, visitor.farewellSeeds);
  state.seeds += seeds;
  return seeds;
}
