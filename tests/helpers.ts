import { SEASONS_BY_ID } from '../src/content/seasons';
import { SPECIES_BY_ID, type Species } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { evaluate, thresholdFor } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import { chooseEventOption, farewellVisitor, hostVisitor, tick, type TickReport } from '../src/core/tick';

/**
 * Wachstumsbonus des Frühlings (0,1 = +10 % 🌿, DESIGN_V2.md 16.3). Jeder Zyklus beginnt im
 * Frühling – Spielstände aus createInitialState/stateAt rechnen darum mit ihm (er zählt
 * additiv in `growthBonus`).
 */
export const SPRING_GROWTH =
  SEASONS_BY_ID.get('spring')!.effects.reduce((s, e) => s + (e.kind === 'growth' ? e.pct / 100 : 0), 0);

/** Spielstand genau am Anfang einer Stufe, mit diesen Tieren in ihren Nischen. */
export function stateAt(stage: number, animals: string[] = [], seed = 1): GameState {
  const state = createInitialState(0, seed);
  state.stage = stage;
  state.waypoint = STAGES[stage]!.waypoint;
  state.totalGrowth = thresholdFor(state.waypoint);
  for (const id of animals) {
    state.niches[SPECIES_BY_ID.get(id)!.niche].push(id);
    state.meta.journal.species.push(id);
  }
  return state;
}

/**
 * Registriert für die Dauer von `fn` zusätzliche Test-Arten (z. B. einen Höhlenbewohner,
 * den der Prototyp noch nicht hat). Die Logik sucht Arten über SPECIES_BY_ID.
 */
export function withFakeSpecies<T>(species: Species[], fn: () => T): T {
  const map = SPECIES_BY_ID as Map<string, Species>;
  // Überschriebene echte Arten danach wiederherstellen, statt sie zu löschen.
  const previous = species.map((s) => [s.id, map.get(s.id)] as const);
  for (const s of species) map.set(s.id, s);
  try {
    return fn();
  } finally {
    for (const [id, original] of previous) {
      if (original) map.set(id, original);
      else map.delete(id);
    }
  }
}

/** Test-Art mit schlichten Standardwerten. */
export function fakeSpecies(patch: Partial<Species> & Pick<Species, 'id' | 'niche'>): Species {
  return {
    name: patch.id,
    genus: 'birds',
    rarity: 0,
    level: 'predator',
    unlock: 1,
    food: ['insekten'],
    needs: [],
    provides: [],
    effects: [],
    summary: '-',
    text: '-',
    ...patch,
  };
}

/**
 * Tickt, bis das Gesamt-Wachstum `target` überschreitet (je Runde 1 % über die mit der
 * aktuellen Rate geschätzte Zeit hinaus). Nötig, weil die Rate an Jahreszeitgrenzen
 * wechselt. Gibt die zusammengeführten Berichte zurück.
 */
export function tickToGrowth(state: GameState, target: number): TickReport {
  const total: TickReport = {
    waypoints: 0,
    encounters: 0,
    autoDeclined: 0,
    declinedStackFull: 0,
    declinedNoCards: 0,
    declinedSeeds: 0,
    regulars: [],
    interludes: 0,
    interludesReached: 0,
    expired: [],
    seasons: [],
    weather: [],
  };
  for (let i = 0; i < 1000 && state.totalGrowth < target; i++) {
    const rate = evaluate(state).growth;
    const r = tick(state, Math.max(1e-6, ((target - state.totalGrowth) / rate) * 1.01));
    for (const k of ['waypoints', 'encounters', 'autoDeclined', 'declinedStackFull', 'declinedNoCards', 'declinedSeeds', 'interludes', 'interludesReached'] as const) {
      total[k] += r[k];
    }
    total.regulars.push(...r.regulars);
    total.expired.push(...r.expired);
    total.seasons.push(...r.seasons);
    total.weather.push(...r.weather);
  }
  return total;
}

/**
 * Löst ein Ereignis oder einen Gast an der Spitze der Warteschlange auf: Ereignis → erste
 * Option, Gast → bewirten, wenn die Samen reichen, sonst ziehen lassen. Gibt false
 * zurück, wenn dort eine Tier- oder Pflanzenbegegnung (oder nichts) wartet.
 */
export function resolveSpecial(state: GameState): boolean {
  const type = state.pendingEncounters[0]?.type;
  if (type === 'event') return chooseEventOption(state, 0, 0).ok;
  if (type === 'visitor') return hostVisitor(state, 0).ok || farewellVisitor(state, 0).ok;
  return false;
}
