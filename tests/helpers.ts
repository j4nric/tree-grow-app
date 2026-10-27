import { CARE_TO_RESEARCH, RESEARCH, type ResearchEffect } from '../src/content/research';
import { SEASONS_BY_ID } from '../src/content/seasons';
import { SPECIES_BY_ID, type Species } from '../src/content/species';
import { STAGES } from '../src/content/stages';
import { OFFLINE_FULL_SECONDS, OFFLINE_YIELD } from '../src/content/offline';
import { evaluate, thresholdFor } from '../src/core/formulas';
import { createInitialState, type GameState } from '../src/core/state';
import type { AmbientMode } from '../src/core/weather';
import { chooseEventOption, chooseSowing, farewellVisitor, hostVisitor, tick, type ActionResult, type TickReport } from '../src/core/tick';

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
    sowings: 0,
    interludesReached: 0,
    expired: [],
    seasons: [],
    weather: [],
    wildwechsel: [],
    chapters: [],
    discovered: [],
    research: [],
  };
  for (let i = 0; i < 1000 && state.totalGrowth < target; i++) {
    const rate = evaluate(state).growth;
    const r = tick(state, Math.max(1e-6, ((target - state.totalGrowth) / rate) * 1.01));
    for (const k of ['waypoints', 'encounters', 'autoDeclined', 'declinedStackFull', 'declinedNoCards', 'declinedSeeds', 'interludes', 'sowings', 'interludesReached'] as const) {
      total[k] += r[k];
    }
    total.regulars.push(...r.regulars);
    total.expired.push(...r.expired);
    total.seasons.push(...r.seasons);
    total.weather.push(...r.weather);
    total.wildwechsel.push(...r.wildwechsel);
    total.chapters.push(...r.chapters);
    total.discovered.push(...r.discovered);
    total.research.push(...r.research);
  }
  return total;
}

/**
 * Setzt eine Pflanze wie aus einer Aussaat (DESIGN_V2.md 27.6), ohne Kosten und Zufall: legt
 * eine Aussaat mit genau dieser Karte offen (eine offene wird ersetzt) und wählt sie – bei
 * vollem Ring anstelle von `replaceId`. Ersetzt in Tests das frühere `plantSeed`.
 */
export function plantFromSowing(state: GameState, plantId: string, replaceId?: string): ActionResult {
  state.cycle.sowing = { cards: [plantId], rerolls: 0 };
  const result = chooseSowing(state, 0, replaceId);
  if (!result.ok) state.cycle.sowing = null;
  return result;
}

/**
 * Löst ein Ereignis oder einen Gast an der Spitze der Warteschlange auf: Ereignis → erste
 * Option, Gast → bewirten, wenn die Samen reichen, sonst ziehen lassen. Gibt false
 * zurück, wenn dort eine Tierbegegnung (oder nichts) wartet.
 */
export function resolveSpecial(state: GameState): boolean {
  const type = state.pendingEncounters[0]?.type;
  if (type === 'event') return chooseEventOption(state, 0, 0).ok;
  if (type === 'visitor') return hostVisitor(state, 0).ok || farewellVisitor(state, 0).ok;
  return false;
}

/**
 * Forschung wie aus Pflege-Rängen bis v16 (Migration v16 → v17, DESIGN_V2.md 27.9): die Knoten
 * der Ränge (CARE_TO_RESEARCH) plus alle fehlenden Voraussetzungen, in RESEARCH-Reihenfolge –
 * ein gültiger `cycle.research`, der auch Speichern und Laden übersteht. Ohne Stufenprüfung.
 */
export function researchFor(care: Readonly<Record<string, number>>): string[] {
  const owned = new Set<string>();
  for (const [id, ranks] of Object.entries(care)) for (const node of (CARE_TO_RESEARCH[id] ?? []).slice(0, ranks)) owned.add(node);
  for (let changed = true; changed; ) {
    changed = false;
    for (const node of RESEARCH) {
      if (!owned.has(node.id)) continue;
      const missing = [...(node.requires ?? [])].filter((id) => !owned.has(id));
      const any = node.requiresAny ?? [];
      if (any.length > 0 && !any.some((id) => owned.has(id))) missing.push(any[0]!);
      for (const id of missing) owned.add(id);
      if (missing.length > 0) changed = true;
    }
  }
  return RESEARCH.filter((n) => owned.has(n.id)).map((n) => n.id);
}

/**
 * Macht aus einem gespeicherten v17-Stand (JSON-Objekt) das Format bis v16 (DESIGN_V2.md 27.9):
 * Forschung → Pflege-Ränge (`cycle.care`, je Maßnahme die Zahl der Knoten ihrer Kette am Stück),
 * ohne Vorrat, Aussaat-Felder, Forschungsplan und `harmonyEarned`. Für Tests älterer Stände.
 */
export function downgradeToV16(raw: Record<string, any>): Record<string, any> {
  const research: string[] = Array.isArray(raw.cycle?.research) ? raw.cycle.research : [];
  const care: Record<string, number> = {};
  for (const [id, nodes] of Object.entries(CARE_TO_RESEARCH)) {
    let rank = 0;
    while (rank < nodes.length && research.includes(nodes[rank]!)) rank++;
    if (rank > 0) care[id] = rank;
  }
  if (raw.cycle) {
    raw.cycle.care = care;
    delete raw.cycle.research;
    delete raw.cycle.sowings;
    delete raw.cycle.sowing;
    delete raw.cycle.freeSowing;
  }
  delete raw.harmonyPoints;
  if (raw.meta) {
    delete raw.meta.research;
    if (raw.meta.stats) delete raw.meta.stats.harmonyEarned;
  }
  return raw;
}

/**
 * Ein Abschnitt einer Abwesenheit wie in simulateOffline (DESIGN_V2.md 28.3): `from` Sekunden
 * der Abwesenheit sind schon gerechnet, jetzt `dt` weitere – bis OFFLINE_FULL_SECONDS mit
 * vollem Ertrag, danach mit OFFLINE_YIELD. Für „viele kleine Ticks = simulateOffline“.
 */
export function offlineTick(state: GameState, from: number, dt: number, ambient: AmbientMode = 'average'): TickReport[] {
  const full = Math.max(0, Math.min(dt, OFFLINE_FULL_SECONDS - from));
  const reports: TickReport[] = [];
  if (full > 0) reports.push(tick(state, full, ambient, 1));
  if (dt > full) reports.push(tick(state, dt - full, ambient, OFFLINE_YIELD));
  return reports;
}

/** Ganze Abwesenheit in Schritten von `step` Sekunden (letzter Schritt ggf. kürzer), wie offlineTick. */
export function offlineTicks(state: GameState, seconds: number, step: number, ambient: AmbientMode = 'average'): void {
  for (let t = 0; t < seconds; t += step) offlineTick(state, t, Math.min(step, seconds - t), ambient);
}

/** Steckt die Wirkung `e` (mindestens so stark) in `effects`? ⚖️, ☀️, 💧: gleiche Art, Wert ≥. */
export function coversEffect(effects: readonly ResearchEffect[], e: ResearchEffect): boolean {
  if (e.kind === 'cycle') {
    const x = e.effect;
    if (x.kind === 'harmony') return effects.some((f) => f.kind === 'cycle' && f.effect.kind === 'harmony' && f.effect.points >= x.points);
    if (x.kind === 'light' || x.kind === 'water') {
      return effects.some((f) => f.kind === 'cycle' && f.effect.kind === x.kind && f.effect.amount >= x.amount);
    }
  }
  return effects.some((f) => JSON.stringify(f) === JSON.stringify(e));
}
